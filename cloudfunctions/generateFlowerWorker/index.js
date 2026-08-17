/**
 * generateFlowerWorker 云函数
 * 职责：定时处理未收录花生成任务：
 *   DeepSeek 生成 15 字段科普 → Seedream 生成水彩插画 → 内容安全检测 → 自动公开入库。
 * 触发：config.json 定时触发器，每 2 分钟执行一次，每次处理 1 个任务
 *       （云函数 60s 超时限制，单任务耗时 LLM 5~15s + 生图 10~30s）
 * 环境变量：
 *   DEEPSEEK_API_KEY（必填，DeepSeek 平台）
 *   ARK_API_KEY（必填，火山方舟 **Agent Plan 专属 API Key**——普通方舟 key 无法调用
 *               /api/plan/v3，获取地址见部署手册）
 *   ARK_MODEL（默认 doubao-seedream-5.0-lite）
 * 流程：
 *   1. 取最早 1 个 pending 任务 → 置 generating
 *   2. DeepSeek 生成科普 JSON（deepseek-v4-flash，严格 JSON 输出）
 *   3. Seedream 生成插画（agentplan 接口）→ 上传云存储 assets/species/{id}.jpg
 *   4. 文本 msgSecCheck + 图片 imgSecCheck（生成物同样要过内容安全）
 *   5. species 入库（aiGenerated: true）→ 任务 done
 *   失败：任务 failed；非违规失败退还当日生成配额
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const ARK_URL = 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations';
const ARK_MODEL = process.env.ARK_MODEL || 'doubao-seedream-5.0-lite';

// 插画提示词模板：与 scripts/species_prompts.json 的 60 张现有插画风格一致
const PROMPT_PREFIX = '水彩绘本风植物科普图鉴插画，一株';
const PROMPT_SUFFIX = '花朵特写居中，叶片细节清晰，柔和米白背景，清新治愈水彩风格，细腻笔触，无水印无文字';

// 生成中超过 3 分钟视为卡死（上次运行被 60s 超时强杀等），允许重新拾取
const STALE_GENERATING_MS = 3 * 60 * 1000;
// 最大重试次数：超过后任务置 failed 并退还配额
const MAX_RETRIES = 3;

function httpJson(method, url, body, headers, timeoutMs) {
  /**
   * 通用 HTTPS 请求并解析 JSON 响应
   * @param {string} method - GET / POST
   * @param {string} url - 完整请求地址
   * @param {string|null} body - POST 请求体字符串，GET 传 null
   * @param {Object|null} headers - 请求头
   * @param {number} timeoutMs - 超时毫秒数
   * @returns {Promise<Object>} 解析后的 JSON
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
    req.setTimeout(timeoutMs || 30000, () => {
      req.destroy(new Error('请求超时'));
    });
    if (body) req.write(body);
    req.end();
  });
}

function httpGetBuffer(url) {
  /**
   * HTTPS GET 下载二进制内容（下载 Seedream 返回的图片 URL 用）
   * @param {string} url - 图片地址
   * @returns {Promise<Buffer>}
   */
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('下载图片超时')));
  });
}

/**
 * 调用 DeepSeek 生成花卉科普信息（严格 JSON 输出）
 * @param {string} name - 百度识别返回的花名
 * @param {string} baikeDesc - 百度百科描述（参考资料，可为空）
 * @returns {Promise<Object>} 15 字段科普对象
 */
async function generateInfo(name, baikeDesc) {
  const systemPrompt = [
    '你是一个花卉科普知识库编辑。根据用户提供的花名与参考资料，生成一条花卉条目，严格输出 JSON，不要包含任何其他文字、解释或代码块标记。',
    'JSON 字段要求：',
    '- id: 拼音小写（如 yueji、xiangrikui），仅小写字母数字',
    '- cnName: 必须与给定花名完全一致，不要改字',
    '- latinName: 学名（拉丁名）',
    '- family: 科；genus: 属',
    '- rarity: 常见程度，取值 common/rare/epic/legendary 之一；无法判断时用 rare',
    '- bloomSeasons: 花期数组，取值 春/夏/秋/冬',
    '- colors: 常见花色数组（如 ["红","粉"]）',
    '- description: 科普简介，1~2 句话，语言轻松有温度，与"把花收进花田"的治愈风格一致',
    '- features: 识别特征，1~2 句话',
    '- flowerLanguage: 花语，1 句话',
    '- careTips: 养护要点，1 句话',
    '- distribution: 分布，1 句话',
    '- funFact: 趣味小知识，1 句话',
    '- synonyms: 别名数组，1~3 个',
    '如果参考资料不足，用常见园艺知识合理补充，但不要编造明显错误的信息。所有字符串字段都不能为空。'
  ].join('\n');
  const userPrompt = `花名：${name}\n参考资料：${baikeDesc ? baikeDesc.slice(0, 800) : '（无）'}`;

  const data = await httpJson(
    'POST',
    DEEPSEEK_URL,
    JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 2000
    }),
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY || ''}`
    },
    15000
  );

  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!content) {
    throw new Error('DeepSeek 返回为空');
  }
  // 容错：剥离可能的代码块标记后解析 JSON
  const cleaned = String(content)
    .replace(/^```(json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const info = JSON.parse(cleaned);
  // 强制 cnName 与百度返回名一致，保证下次识别全等匹配命中
  info.cnName = name;
  return info;
}

/**
 * 校验并规范化 LLM 输出的字段（防脏数据入库）
 * @param {Object} info - LLM 输出对象
 * @param {string} name - 百度花名
 * @returns {Object} 规范化后的 15 字段对象（含 id）
 */
function normalizeInfo(info, name) {
  const RARITIES = ['common', 'rare', 'epic', 'legendary'];
  const SEASONS = ['春', '夏', '秋', '冬'];
  const str = (v, max) => String(v || '').slice(0, max);
  const arr = (v, max) =>
    (Array.isArray(v) ? v : [])
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, max);

  // 拼音 id：LLM 输出不合法时回退 gen_ + 花名哈希，保证唯一且稳定
  let id = str(info.id, 20).toLowerCase();
  if (!/^[a-z][a-z0-9]{1,19}$/.test(id)) {
    id = 'gen_' + crypto.createHash('md5').update(name).digest('hex').slice(0, 10);
  }
  const rarity = RARITIES.includes(info.rarity) ? info.rarity : 'rare';
  const bloomSeasons = arr(info.bloomSeasons, 4).filter((x) => SEASONS.includes(x));

  return {
    id,
    cnName: name,
    latinName: str(info.latinName, 80) || name,
    family: str(info.family, 30) || '未知',
    genus: str(info.genus, 30) || '未知',
    rarity,
    bloomSeasons,
    colors: arr(info.colors, 6),
    description: str(info.description, 300),
    features: str(info.features, 200),
    flowerLanguage: str(info.flowerLanguage, 100),
    careTips: str(info.careTips, 150),
    distribution: str(info.distribution, 150),
    funFact: str(info.funFact, 200),
    synonyms: arr(info.synonyms, 3)
  };
}

/**
 * Seedream 生成插画（agentplan 接口），返回图片二进制
 * @param {string} prompt - 生图提示词
 * @returns {Promise<Buffer>}
 */
async function generateImage(prompt) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.ARK_API_KEY || ''}`
  };
  // 按官方 agentplan 接口文档（docs/火山agentplan接入视觉模型.md）：
  // size 取 "2K"（3K/4K 更贵）；output_format jpeg（控制体积，满足 imgSecCheck ≤1M）
  // response_format url → 下载后上传云存储
  const data = await httpJson(
    'POST',
    ARK_URL,
    JSON.stringify({
      model: ARK_MODEL,
      prompt,
      size: '2K',
      output_format: 'jpeg',
      response_format: 'url',
      watermark: false
    }),
    headers,
    25000
  );

  const item = (data && data.data && data.data[0]) || {};
  if (item.b64_json) {
    return Buffer.from(item.b64_json, 'base64');
  }
  if (item.url) {
    return httpGetBuffer(item.url);
  }
  // 解析平台错误：输入敏感检测（如花名触发 Seedream 内容安全）属外部策略拒绝，
  // 重试无意义（每次都会撞同一堵墙），带 code 供上层立即置 failed 并提示用户
  const errCode = (data && data.error && data.error.code) || '';
  if (errCode === 'InputTextSensitiveContentDetected') {
    const err = new Error('该花名未通过生图平台内容检测，无法生成花卡');
    err.code = 'SEEDREAM_SENSITIVE';
    throw err;
  }
  throw new Error('Seedream 未返回图片: ' + JSON.stringify(data).slice(0, 200));
}

/**
 * 文本内容安全检测（生成科普文案）；接口异常默认放行
 * @param {string} text - 待检测文本
 * @returns {Promise<{pass: boolean}>}
 */
async function checkTextSecurity(text) {
  try {
    const result = await cloud.openapi.security.msgSecCheck({
      content: String(text || '').slice(0, 2400)
    });
    if (result && result.errCode === 87014) {
      return { pass: false };
    }
    return { pass: true };
  } catch (e) {
    if (String(e.errCode || e.code) === '87014') {
      return { pass: false };
    }
    // 接口异常默认放行（与图片检测策略一致）
    console.warn('msgSecCheck 异常:', e);
    return { pass: true };
  }
}

/**
 * 图片内容安全检测（生成插画）；jpeg 失败换 png 重试
 * @param {Buffer} buffer - 图片二进制
 * @returns {Promise<{pass: boolean}>}
 */
async function checkImageSecurity(buffer) {
  const contentTypes = ['image/jpeg', 'image/png'];
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
      console.warn('imgSecCheck 异常:', e);
    }
  }
  return { pass: true };
}

/**
 * 上传图片到云存储 assets/species/
 * @param {Buffer} buffer - 图片二进制
 * @param {string} id - 花种 id（作为文件名）
 * @returns {Promise<string>} fileID
 */
async function uploadImage(buffer, id) {
  const res = await cloud.uploadFile({
    cloudPath: `assets/species/${id}.jpg`,
    fileContent: buffer
  });
  return res.fileID;
}

/**
 * 退还一次当日生成配额（任务失败时调用，违规失败不退）
 * @param {string} openid - 用户唯一标识
 * @returns {Promise<void>}
 */
async function refundGenQuota(openid) {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const id = `${openid}_${date}`;
  try {
    const doc = await db.collection('gen_limits').doc(id).get();
    if (doc.data && doc.data.count > 0) {
      await db.collection('gen_limits').doc(id).update({ data: { count: db.command.inc(-1) } });
    }
  } catch (e) {
    console.warn('refundGenQuota 失败:', e);
  }
}

exports.main = async () => {
  // 云函数入口：取 1 个 pending 任务执行完整生成流程，详细说明见文件头
  try {
    // 密钥前置校验：缺失直接返回，避免逐任务报错
    if (!process.env.DEEPSEEK_API_KEY || !process.env.ARK_API_KEY) {
      console.error('缺少 DEEPSEEK_API_KEY / ARK_API_KEY');
      return { ok: false, code: 'CONFIG_MISSING', message: '未配置生成服务密钥' };
    }

    // 1. 取任务：优先最早 pending；其次拾取卡死的 generating（超过 5 分钟未更新，
    //    说明上次运行被超时强杀，任务悬死，需要重试续命）
    const taskCol = db.collection('flower_gen_tasks');
    const pendingRes = await taskCol
      .where({ status: 'pending' })
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get();
    let task = pendingRes.data[0] || null;
    if (!task) {
      const staleRes = await taskCol
        .where({
          status: 'generating',
          updatedAt: db.command.lt(Date.now() - STALE_GENERATING_MS)
        })
        .orderBy('updatedAt', 'asc')
        .limit(1)
        .get();
      task = staleRes.data[0] || null;
    }
    if (!task) {
      return { ok: true, processed: 0 };
    }

    // 重试上限：超限任务直接置 failed（不再占用 worker），退配额
    const retryCount = Number(task.retryCount || 0);
    if (retryCount >= MAX_RETRIES) {
      await taskCol.doc(task._id).update({
        data: {
          status: 'failed',
          error: '多次重试失败',
          retryCount,
          updatedAt: Date.now()
        }
      });
      await refundGenQuota(task.openid);
      return { ok: true, processed: 0 };
    }

    await taskCol.doc(task._id).update({
      data: { status: 'generating', updatedAt: Date.now() }
    });

    try {
      // 2. DeepSeek 生成科普
      const rawInfo = await generateInfo(task.name, task.baikeDesc || '');
      const info = normalizeInfo(rawInfo, task.name);

      // 3. 文本内容安全（违规失败不退还配额）
      const textToCheck = [
        info.description,
        info.features,
        info.flowerLanguage,
        info.careTips,
        info.distribution,
        info.funFact
      ].join('；');
      const textSec = await checkTextSecurity(textToCheck);
      if (!textSec.pass) {
        throw Object.assign(new Error('生成文案未通过内容安全检测'), { code: 'UNSAFE_TEXT' });
      }

      // 4. Seedream 生图 + 图片内容安全
      const prompt = `${PROMPT_PREFIX}${task.name}（${info.latinName}），${info.colors.join('、') || '常见'}色${PROMPT_SUFFIX}`;
      const imageBuffer = await generateImage(prompt);
      const imgSec = await checkImageSecurity(imageBuffer);
      if (!imgSec.pass) {
        throw Object.assign(new Error('生成图片未通过内容安全检测'), { code: 'UNSAFE_IMAGE' });
      }

      // 5. 上传插画 + 入库（幂等：固定 _id 覆盖写）
      const fileID = await uploadImage(imageBuffer, info.id);
      await db
        .collection('species')
        .doc(info.id)
        .set({
          data: Object.assign({}, info, {
            illustrationFileID: fileID,
            enabled: true,
            aiGenerated: true,
            source: 'llm',
            createdAt: Date.now()
          })
        });

      // 6. 任务完成
      await taskCol.doc(task._id).update({
        data: {
          status: 'done',
          speciesId: info.id,
          error: '',
          updatedAt: Date.now()
        }
      });
      return { ok: true, processed: 1, speciesId: info.id };
    } catch (e) {
      // 任务失败：违规立即置 failed 不退配额；否则进入重试队列，
      // 超过重试上限才置 failed 并退配额（避免重复退还）
      console.error('generateFlowerWorker 任务失败:', task._id, e);
      // 内容策略拒绝（含生成文案/图片违规、Seedream 输入敏感）：立即置 failed，不重试不退配额
      const isUnsafe = e && (e.code === 'UNSAFE_TEXT' || e.code === 'UNSAFE_IMAGE' || e.code === 'SEEDREAM_SENSITIVE');
      const newRetry = retryCount + 1;
      if (isUnsafe || newRetry >= MAX_RETRIES) {
        await taskCol.doc(task._id).update({
          data: {
            status: 'failed',
            error: (e && e.message) || '生成失败',
            retryCount: newRetry,
            updatedAt: Date.now()
          }
        });
        if (!isUnsafe) {
          await refundGenQuota(task.openid);
        }
      } else {
        // 回到 pending 等待下一轮重试
        await taskCol.doc(task._id).update({
          data: {
            status: 'pending',
            error: (e && e.message) || '生成失败',
            retryCount: newRetry,
            updatedAt: Date.now()
          }
        });
      }
      return { ok: true, processed: 0, error: (e && e.message) || '生成失败' };
    }
  } catch (err) {
    console.error('generateFlowerWorker error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '生成任务处理失败'
    };
  }
};
