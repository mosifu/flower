/**
 * recognizeFlower 云函数
 * 职责：每日限流 → 微信图片内容安全检测 → 百度植物识别 → 知识库匹配
 * 环境变量：BAIDU_AK / BAIDU_SK（必填）
 *          ENABLE_SEC_CHECK（默认 true）/ SEC_CHECK_STRICT（默认 false）
 *          RECOGNIZE_DAILY_LIMIT（默认 20，与 getAchievements 保持一致）
 *
 * 健壮性设计（2026-08 优化批次）：
 * - 限流用事务原子化（读计数→校验→自增），消除并发超限竞态
 * - 服务端原因失败（下载/百度/安全接口异常等）自动退还当日次数
 * - 识别失败时自动删除已上传的图片文件，避免孤儿文件
 * - 知识库列表 10 分钟实例内存缓存，减少每次识别的数据库查询
 * - 百度 Token 刷新用 Promise 锁，避免并发刷新风暴
 * - 图片 MD5 指纹识别留痕（方案 A 演进）：识别前查 photo_hashes，重复图不消耗限流次数；
 *   识别成功（百度正常返回）后写入指纹，识别结果一并留痕：命中花种记 speciesId，
 *   未识别出植物记 nonPlant=true（重复上传时前端直接提示「未识别出花朵」而非「重复照片」）；
 *   force=true 跳过查重（用户确认仍要识别）
 *
 * 复用说明：图片安全检测方式与 base64 识别链路参考自
 * dengcao/AI-Intelligent-Recognition（Apache-2.0），见 NOTICE.md。
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const DAILY_LIMIT = Number(process.env.RECOGNIZE_DAILY_LIMIT) || 20;
const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const BAIDU_PLANT_URL = 'https://aip.baidubce.com/rest/2.0/image-classify/v1/plant';

// 知识库缓存：species 变化频率极低，10 分钟内复用实例内存，减少数据库查询
const SPECIES_CACHE_TTL = 10 * 60 * 1000;
let speciesCache = { list: null, at: 0 };

// 百度 Token 并发刷新锁：多个并发请求同时发现缓存过期时只刷新一次
let tokenPromise = null;

// 服务端原因导致的失败码（可退还当日识别次数；用户过错与限流拒绝不退）
const REFUNDABLE_CODES = [
  'DOWNLOAD_FAIL',
  'EMPTY_FILE',
  'BAIDU_CONFIG',
  'BAIDU_TOKEN_ERROR',
  'BAIDU_ERROR',
  'SEC_CHECK_ERROR',
  'INTERNAL'
];

function todayStr() {
  // 生成今日日期字符串 yyyyMMdd（作为限流计数键的一部分）
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function httpJson(method, url, body, headers, timeoutMs) {
  /**
   * 通用 HTTPS 请求并解析 JSON 响应
   * @param {string} method - GET / POST
   * @param {string} url - 完整请求地址
   * @param {string|null} body - POST 请求体（表单/JSON 字符串），GET 传 null
   * @param {Object|null} headers - 请求头
   * @param {number} timeoutMs - 超时毫秒数
   * @returns {Promise<Object>} 解析后的 JSON 对象
   * @throws {Error} 网络错误、超时或 JSON 解析失败
   */
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: headers || {}
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error('响应解析失败: ' + raw.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs || 10000, () => {
      req.destroy(new Error('请求超时'));
    });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * 获取百度 Access Token（云数据库缓存，有效期约 1 个月，提前 60s 失效）
 * 并发刷新保护：缓存过期时用模块级 Promise 锁，只允许一次刷新
 */
async function getBaiduToken() {
  /**
   * 获取百度 Access Token：优先读 bd_token 集合缓存（提前 60s 失效），过期则重新获取并写回
   * @returns {Promise<string>} access_token
   * @throws {Error} code=BAIDU_CONFIG（未配置密钥）/ BAIDU_TOKEN_ERROR（获取失败）
   */
  const AK = process.env.BAIDU_AK;
  const SK = process.env.BAIDU_SK;
  if (!AK || !SK) {
    const err = new Error('未配置 BAIDU_AK / BAIDU_SK');
    err.code = 'BAIDU_CONFIG';
    throw err;
  }

  const col = db.collection('bd_token');
  try {
    const doc = await col.doc('baidu').get();
    if (doc.data && doc.data.token && doc.data.expireAt > Date.now()) {
      return doc.data.token;
    }
  } catch (e) {
    // 文档不存在，继续获取
  }

  // 并发保护：已有刷新任务在跑则直接复用其结果
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const url =
      `${BAIDU_TOKEN_URL}?grant_type=client_credentials` +
      `&client_id=${encodeURIComponent(AK)}` +
      `&client_secret=${encodeURIComponent(SK)}`;
    const data = await httpJson('GET', url, null, null, 10000);
    if (!data.access_token) {
      const err = new Error(data.error_description || '百度 Token 获取失败');
      err.code = 'BAIDU_TOKEN_ERROR';
      throw err;
    }

    await col
      .doc('baidu')
      .set({
        data: {
          token: data.access_token,
          expireAt: Date.now() + Number(data.expires_in || 2592000) * 1000 - 60000
        }
      })
      .catch(() => {});
    return data.access_token;
  })().finally(() => {
    // 无论成败都释放锁，下次请求可重新尝试
    tokenPromise = null;
  });

  return tokenPromise;
}

/**
 * 微信图片内容安全检测（参考复用项目的 imgSecCheck 用法）
 * jpeg 失败自动换 png 重试；87014 判不合规；接口异常默认放行，STRICT 模式拒绝
 */
async function checkImageSecurity(buffer) {
  /**
   * 微信图片内容安全检测（imgSecCheck），jpeg 失败自动换 png 重试
   * @param {Buffer} buffer - 待检测图片二进制
   * @returns {Promise<{pass: boolean}>} pass=false 表示图片内容不合规
   * @throws {Error} SEC_CHECK_STRICT=true 且安全接口异常时抛出
   */
  if (process.env.ENABLE_SEC_CHECK === 'false') {
    return { pass: true };
  }

  const contentTypes = ['image/jpeg', 'image/png'];
  let lastError = null;

  for (const contentType of contentTypes) {
    try {
      const result = await cloud.openapi.security.imgSecCheck({
        media: { contentType, value: buffer }
      });
      if (result && result.errCode === 87014) {
        return { pass: false };
      }
      return { pass: true };
    } catch (e) {
      if (String(e.errCode || e.code) === '87014') {
        return { pass: false };
      }
      lastError = e;
    }
  }

  // 接口异常（常见于未认证/类目限制）：默认放行并告警，STRICT 模式下拒绝
  console.warn('imgSecCheck 异常:', lastError);
  if (process.env.SEC_CHECK_STRICT === 'true') {
    const err = new Error('内容安全检测不可用');
    err.code = 'SEC_CHECK_ERROR';
    throw err;
  }
  return { pass: true };
}

/**
 * 每日限流：按 openid + 日期 事务化原子计数
 * 用数据库事务（读计数→校验→自增）避免并发请求同时通过检查导致超限
 */
async function consumeRateLimit(openid) {
  /**
   * 每用户每日识别限流：事务内读-校验-自增，保证并发下不超限
   * @param {string} openid - 用户唯一标识
   * @returns {Promise<{ok: boolean, code?: string, message?: string, remaining?: number}>}
   */
  const date = todayStr();
  const id = `${openid}_${date}`;

  let count = 0;
  try {
    await db.runTransaction(async (t) => {
      // 事务内读取当前计数（文档不存在视为 0）
      const doc = await t.collection('rate_limits').doc(id).get().catch(() => null);
      const cur = (doc && doc.data && doc.data.count) || 0;
      if (cur >= DAILY_LIMIT) {
        const err = new Error(`今日识别次数已达上限（${DAILY_LIMIT}次）`);
        err.code = 'RATE_LIMITED';
        throw err;
      }
      // set 为 upsert 语义：不存在则创建，存在则覆盖
      await t
        .collection('rate_limits')
        .doc(id)
        .set({ data: { openid, date, count: cur + 1 } });
      count = cur + 1;
    });
  } catch (e) {
    if (e && e.code === 'RATE_LIMITED') {
      return { ok: false, code: 'RATE_LIMITED', message: e.message };
    }
    throw e;
  }

  return { ok: true, remaining: Math.max(0, DAILY_LIMIT - count) };
}

/**
 * 退还一次当日识别次数（服务端原因失败时调用）
 * @param {string} openid - 用户唯一标识
 * @returns {Promise<void>} 失败静默（退款是宽容操作，不阻断主流程）
 */
async function refundRateLimit(openid) {
  const id = `${openid}_${todayStr()}`;
  try {
    const doc = await db.collection('rate_limits').doc(id).get();
    // 计数大于 0 才退还，避免扣成负数导致「剩余次数」超过上限
    if (doc.data && doc.data.count > 0) {
      await db.collection('rate_limits').doc(id).update({ data: { count: _.inc(-1) } });
    }
  } catch (e) {
    console.warn('refundRateLimit 失败:', e);
  }
}

/**
 * 拉取知识库列表（带实例内存缓存）
 * 缓存过期且查询失败时回退旧缓存（延长 1 分钟），避免单次抖动导致识别失败
 */
async function getCatalog() {
  /**
   * 拉取全部启用中的花种知识库
   * @returns {Promise<Array>} species 文档列表（enabled=true）
   */
  if (speciesCache.list && Date.now() - speciesCache.at < SPECIES_CACHE_TTL) {
    return speciesCache.list;
  }
  try {
    const res = await db
      .collection('species')
      .where({ enabled: true })
      .limit(1000)
      .get();
    speciesCache = { list: res.data, at: Date.now() };
    return res.data;
  } catch (e) {
    // 查询失败但旧缓存可用：回退旧缓存并延长 1 分钟，防止瞬时故障中断识别
    if (speciesCache.list) {
      speciesCache.at = Date.now() - SPECIES_CACHE_TTL + 60000;
      return speciesCache.list;
    }
    throw e;
  }
}

/**
 * 删除识别流程上传的图片文件（失败时兜底清理，避免孤儿文件）
 * @param {string} fileID - 云存储文件 ID
 * @returns {Promise<void>}
 */
async function deleteUploadedFile(fileID) {
  if (!fileID) return;
  try {
    await cloud.deleteFile({ fileList: [fileID] });
  } catch (e) {
    console.warn('识别失败清理文件失败:', fileID, e);
  }
}

/**
 * 查询该用户是否识别过某张图片（按 MD5 精确指纹）
 * @param {string} openid - 用户唯一标识
 * @param {string} md5 - 图片内容 MD5
 * @returns {Promise<Object|null>} photo_hashes 文档或 null
 */
async function findDuplicate(openid, md5) {
  const res = await db
    .collection('photo_hashes')
    .where({ openid, md5 })
    .limit(1)
    .get();
  return res.data[0] || null;
}

/**
 * 写入图片指纹（幂等：固定 _id = openid_md5，重复写入覆盖）；
 * 识别结果留痕：命中花种记录 speciesId，未识别出植物（百度有返回但未匹配知识库）记录 nonPlant=true，
 * 供重复上传时前端直接提示「未识别出花朵」而非「重复照片」
 * @param {string} openid - 用户唯一标识
 * @param {string} md5 - 图片内容 MD5
 * @param {string} speciesId - 识别命中的花种 id（未命中传空串）
 * @param {boolean} nonPlant - 是否未识别出植物（!hit）
 * @returns {Promise<void>} 写入失败仅告警，不阻断主流程
 */
async function savePhotoHash(openid, md5, speciesId, nonPlant) {
  try {
    await db
      .collection('photo_hashes')
      .doc(`${openid}_${md5}`)
      .set({
        data: { openid, md5, speciesId: speciesId || '', nonPlant: !!nonPlant, createdAt: Date.now() }
      });
  } catch (e) {
    console.warn('写入照片指纹失败:', openid, md5, e);
  }
}

function normalize(s) {
  /**
   * 名称规范化：去空格、转小写，用于匹配
   * @param {string} s - 原始名称
   * @returns {string} 规范化后的名称
   */
  return String(s || '').trim().toLowerCase();
}

function matchSpecies(speciesList, name) {
  /**
   * 把百度识别结果名匹配到知识库花种（中文名/学名/别名任一命中即返回）
   * @param {Array} speciesList - 知识库花种列表
   * @param {string} name - 百度返回的识别名称
   * @returns {Object|null} 命中的花种文档；未命中返回 null
   */
  const clean = normalize(name).replace(/[（(].*?[）)]/g, '');
  return (
    speciesList.find((s) => {
      if (normalize(s.cnName) === clean) return true;
      if (normalize(s.latinName) === clean) return true;
      return (s.synonyms || []).some((x) => normalize(x) === clean);
    }) || null
  );
}

exports.main = async (event) => {
  // 云函数入口：下载 → 指纹查重 → 限流 → 内容安全 → 百度识别 → 知识库匹配，详细说明见文件头
  const { OPENID } = cloud.getWXContext();
  let rateConsumed = false;

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }
    if (!event.fileID) {
      return { ok: false, code: 'NO_FILE', message: '缺少图片参数' };
    }

    // 1. 下载图片（提前下载：需要 buffer 计算 MD5 指纹）
    let buffer;
    try {
      const dl = await cloud.downloadFile({ fileID: event.fileID });
      buffer = dl.fileContent;
    } catch (e) {
      await deleteUploadedFile(event.fileID);
      return { ok: false, code: 'DOWNLOAD_FAIL', message: '图片下载失败，请重试' };
    }
    if (!buffer || !buffer.length) {
      await deleteUploadedFile(event.fileID);
      return { ok: false, code: 'EMPTY_FILE', message: '图片内容为空' };
    }

    // 2. 图片指纹永久查重（MD5 精确指纹，方案 A）
    //    在限流之前：命中重复直接返回，不消耗当日次数；force=true 跳过（用户确认仍要识别）
    const md5 = crypto.createHash('md5').update(buffer).digest('hex');
    if (event.force !== true) {
      const dup = await findDuplicate(OPENID, md5);
      if (dup) {
        // 附带命中花种名，供前端弹窗展示
        let cnName = '';
        if (dup.speciesId) {
          const sp = await db
            .collection('species')
            .doc(dup.speciesId)
            .get()
            .catch(() => null);
          cnName = sp && sp.data ? sp.data.cnName : '';
        }
        // 附带今日剩余次数（未识别出植物的重复图前端直接进结果页，配额条需要展示）
        let remaining = 0;
        try {
          const rateDoc = await db
            .collection('rate_limits')
            .doc(`${OPENID}_${todayStr()}`)
            .get()
            .catch(() => null);
          const count = (rateDoc && rateDoc.data && rateDoc.data.count) || 0;
          remaining = Math.max(0, DAILY_LIMIT - count);
        } catch (e) {
          console.warn('查重命中读取剩余次数失败:', e);
        }
        return {
          ok: true,
          duplicate: true,
          remaining,
          limit: DAILY_LIMIT,
          hit: {
            speciesId: dup.speciesId,
            cnName,
            createdAt: dup.createdAt,
            // 老数据无 nonPlant 字段时按 speciesId 是否为空兜底（空=未识别出植物）
            nonPlant: !!dup.nonPlant || !dup.speciesId
          }
        };
      }
    }

    // 3. 限流（事务原子化）
    const rl = await consumeRateLimit(OPENID);
    if (!rl.ok) return rl;
    rateConsumed = true;

    // 4. 内容安全（用户过错：不合规不退还次数，但清理文件）
    const sec = await checkImageSecurity(buffer);
    if (!sec.pass) {
      await deleteUploadedFile(event.fileID);
      return { ok: false, code: 'UNSAFE_CONTENT', message: '图片内容不合规，无法识别' };
    }

    // 5. 百度植物识别
    const token = await getBaiduToken();
    const body = `image=${encodeURIComponent(buffer.toString('base64'))}&baike_num=3`;
    const data = await httpJson(
      'POST',
      `${BAIDU_PLANT_URL}?access_token=${encodeURIComponent(token)}`,
      body,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      10000
    );

    if (data.error_code) {
      // 百度服务错误属服务端原因：退还次数并清理文件
      await refundRateLimit(OPENID);
      await deleteUploadedFile(event.fileID);
      return {
        ok: false,
        code: 'BAIDU_ERROR',
        message: data.error_msg || '识别服务异常，请稍后重试'
      };
    }

    // 6. 知识库匹配
    const catalog = await getCatalog();
    const results = (data.result || []).slice(0, 3);
    const candidates = results.map((r) => {
      const sp = matchSpecies(catalog, r.name);
      return {
        name: r.name || '',
        score: Math.round((r.score || 0) * 1000) / 1000,
        scoreText: ((r.score || 0) * 100).toFixed(1) + '%',
        baike: r.baike_info || null,
        species: sp
          ? {
              _id: sp._id,
              cnName: sp.cnName,
              latinName: sp.latinName,
              family: sp.family,
              genus: sp.genus,
              rarity: sp.rarity,
              bloomSeasons: sp.bloomSeasons,
              colors: sp.colors,
              description: sp.description,
              illustrationFileID: sp.illustrationFileID
            }
          : null
      };
    });

    const hit = candidates.some((c) => c.species);
    // 7. 写入指纹（识别成功即写，防止同一张图反复消耗次数）
    //    识别结果留痕：命中花种记录 speciesId；未识别出植物（!hit）记录 nonPlant=true，
    //    供重复上传时前端直接提示「未识别出花朵」而非「重复照片」
    const hitSpecies = candidates.find((c) => c.species);
    await savePhotoHash(OPENID, md5, hitSpecies ? hitSpecies.species._id : '', !hit);

    return {
      ok: true,
      hit,
      candidates,
      remaining: rl.remaining,
      limit: DAILY_LIMIT
    };
  } catch (err) {
    console.error('recognizeFlower error:', err);
    // 服务端原因异常：退还次数并清理文件
    const code = err.code || 'INTERNAL';
    if (rateConsumed && REFUNDABLE_CODES.includes(code)) {
      await refundRateLimit(OPENID);
    }
    if (rateConsumed && event.fileID) {
      await deleteUploadedFile(event.fileID);
    }
    return {
      ok: false,
      code,
      message: err.message || '识别失败，请稍后重试'
    };
  }
};
