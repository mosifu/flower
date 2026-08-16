/**
 * submitFeedback 云函数
 * 职责：意见反馈提交——类型/内容/截图数校验 → 每日 5 条限流（事务）→ 截图内容安全检测 → 入库。
 * 入参：{ type, content, photoFileIDs? }
 *   type: suggestion 体验建议 | bug 问题反馈 | other 其他
 *   content: 反馈内容（≤500 字）
 *   photoFileIDs: 截图云存储 fileID 数组（可选，≤3 张）
 * 返回：{ ok, feedbackId }
 * 说明：
 * - 限流在写入成功后才计数（反馈无外部成本，失败不扣次数，与识别限流不同）；
 * - 截图入库前逐张 imgSecCheck，违规拒绝并清理文件；
 * - 记录保存在 feedback 集合，注销时由 deleteAccount 将 openid 匿名化（记录保留）。
 * 环境变量：无
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 每日反馈上限（条）：防刷屏，写入成功后才计数
const DAILY_LIMIT = 5;
// 反馈内容最大长度（字）：与前端 maxlength 对齐
const MAX_CONTENT_LEN = 500;
// 截图最大张数：成本/体积控制（用户确认 ≤3 张）
const MAX_PHOTOS = 3;
// 反馈类型白名单：前端三选一，服务端兜底校验防绕过
const TYPE_WHITELIST = ['suggestion', 'bug', 'other'];

function todayStr() {
  // 生成今日日期字符串 yyyyMMdd（与 rate_limits / gen_limits 格式一致）
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/**
 * 微信图片内容安全检测（与 saveCard/recognizeFlower 实现一致，修改需同步）
 * jpeg 失败自动换 png 重试；errCode 87014 判不合规；接口异常默认放行（fail-open）
 * @param {Buffer} buffer - 待检测图片二进制
 * @returns {Promise<{pass: boolean}>} pass=false 表示图片内容不合规
 */
async function checkImageSecurity(buffer) {
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
  // 接口异常（常见于未认证/类目限制）：默认放行并告警
  console.warn('submitFeedback imgSecCheck 异常:', lastError);
  return { pass: true };
}

/**
 * 批量删除云存储文件（deleteFile 单次上限 50 个，按需分批）
 * @param {string[]} fileList - 云存储 fileID 列表
 * @returns {Promise<number>} 实际删除成功的数量
 */
async function deleteFilesBatched(fileList) {
  if (!fileList || !fileList.length) return 0;
  let deleted = 0;
  for (let i = 0; i < fileList.length; i += 50) {
    const batch = fileList.slice(i, i + 50);
    try {
      const res = await cloud.deleteFile({ fileList: batch });
      deleted += (res.fileList || []).filter((f) => f.status === 0).length;
    } catch (e) {
      console.warn('deleteFile 失败:', batch.length, e);
    }
  }
  return deleted;
}

/**
 * 退还一次当日反馈名额（后续校验/入库失败时调用，与 requestFlowerGenerate 的退配额模式一致）
 * @param {string} openid - 用户唯一标识
 * @returns {Promise<void>} 失败静默
 */
async function refundLimit(openid) {
  const id = `${openid}_${todayStr()}`;
  try {
    const doc = await db.collection('feedback_limits').doc(id).get();
    if (doc.data && doc.data.count > 0) {
      await db.collection('feedback_limits').doc(id).update({ data: { count: db.command.inc(-1) } });
    }
  } catch (e) {
    console.warn('refundLimit 失败:', e);
  }
}

/**
 * 下载并检测单张截图，违规时清理文件
 * @param {string} fileID - 截图云存储文件 ID
 * @returns {Promise<{ok: boolean, result?: Object}>} ok=false 时 result 为错误返回体
 */
async function checkUploadedPhoto(fileID) {
  let buffer;
  try {
    const dl = await cloud.downloadFile({ fileID });
    buffer = dl.fileContent;
  } catch (e) {
    // 文件不存在或无权访问：文件本身无法入库，无需清理
    return { ok: false, result: { ok: false, code: 'DOWNLOAD_FAIL', message: '截图读取失败，请重试' } };
  }
  if (!buffer || !buffer.length) {
    return { ok: false, result: { ok: false, code: 'EMPTY_FILE', message: '截图内容为空' } };
  }
  const sec = await checkImageSecurity(buffer);
  if (!sec.pass) {
    // 违规图片直接删除，避免残留在云存储
    await deleteFilesBatched([fileID]);
    return { ok: false, result: { ok: false, code: 'UNSAFE_CONTENT', message: '截图内容不合规，无法提交' } };
  }
  return { ok: true };
}

exports.main = async (event) => {
  // 云函数入口：校验 → 限流 → 截图安全检测 → 入库，详细说明见文件头
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }

    // 1. 输入校验：类型白名单 + 内容长度 + 截图数量（服务端兜底，防绕过前端 maxlength）
    const type = String(event.type || '').trim();
    if (!TYPE_WHITELIST.includes(type)) {
      return { ok: false, code: 'BAD_PARAM', message: '反馈类型不合法' };
    }
    const content = String(event.content || '').trim();
    if (!content || content.length > MAX_CONTENT_LEN) {
      return { ok: false, code: 'BAD_PARAM', message: `反馈内容需在 1~${MAX_CONTENT_LEN} 字之间` };
    }
    const photoFileIDs = Array.isArray(event.photoFileIDs) ? event.photoFileIDs : [];
    if (photoFileIDs.length > MAX_PHOTOS) {
      return { ok: false, code: 'BAD_PARAM', message: `最多上传 ${MAX_PHOTOS} 张截图` };
    }

    // 2. 每日限流：事务原子读计数 → 校验 → 自增（写入成功后才计数，失败不占名额）
    const date = todayStr();
    const limitId = `${OPENID}_${date}`;
    try {
      await db.runTransaction(async (t) => {
        const doc = await t.collection('feedback_limits').doc(limitId).get().catch(() => null);
        const cur = (doc && doc.data && doc.data.count) || 0;
        if (cur >= DAILY_LIMIT) {
          const err = new Error(`今日反馈已达上限（${DAILY_LIMIT} 条）`);
          err.code = 'FEEDBACK_LIMITED';
          throw err;
        }
        await t.collection('feedback_limits').doc(limitId).set({
          data: { openid: OPENID, date, count: cur + 1 }
        });
      });
    } catch (e) {
      if (e && e.code === 'FEEDBACK_LIMITED') {
        return { ok: false, code: 'FEEDBACK_LIMITED', message: e.message };
      }
      throw e;
    }

    // 3. 截图内容安全：逐张检测，任一违规拒绝并清理；文件读取失败也拒绝（避免脏数据入库）
    //    此步失败要退还名额（见第 4 步后的 refundLimit）
    for (const fileID of photoFileIDs) {
      const sec = await checkUploadedPhoto(fileID);
      if (!sec.ok) {
        await refundLimit(OPENID);
        return sec.result;
      }
    }

    // 4. 入库 feedback（失败退还名额，避免无效提交占用每日额度）
    try {
      const addRes = await db.collection('feedback').add({
        data: {
          openid: OPENID,
          type,
          content,
          photos: photoFileIDs,
          createdAt: Date.now()
        }
      });
      return { ok: true, feedbackId: addRes._id };
    } catch (e) {
      await refundLimit(OPENID);
      throw e;
    }
  } catch (err) {
    console.error('submitFeedback error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '提交反馈失败，请稍后重试'
    };
  }
};
