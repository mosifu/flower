/**
 * createBatchTask 云函数
 * 职责：创建识别任务（识别有记录原则）——
 *   mode='identified'：识别完成进入结果/清单界面时创建，items 含**全部候选**（详情页可单选）；
 *   mode 默认（确认入库）：items 为锁定后的选中信息（speciesId 或 未收录 name），转后台处理。
 * 入参：{ mode?, items: [...] }
 *   mode='identified' 时 items: [{ fileID, candidates: [{name,score,species,baike}], selectedIndex, status }]
 *   默认时 items: [{ fileID, speciesId?, name?, score?, baikeDesc?, itemStatus? }]
 * 返回：{ ok, taskId, batchName }
 * 说明：
 * - 并发上限仅针对后台执行任务（pending/processing）MAX_TASKS（3）条；identified（已识别未入库）是记录，不占名额；
 * - 批次名 YYYY-MM-DD_HH-mm-ss；创建后由 batchSaveWorker 处理（identified 需先确认入库转 pending）。
 * 环境变量：无
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 后台执行任务并发上限（条）：pending/processing 最多 3 条；identified（识别记录）不占名额
const MAX_TASKS = 3;

function nowStr() {
  // 生成批次名：YYYY-MM-DD_HH-mm-ss（本地时间）
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/**
 * 规范化一条 identified item（存全部候选，用户可单选）
 * @param {Object} it - 前端传入 item
 * @returns {Object} 规范化 item
 */
function normalizeIdentifiedItem(it) {
  const candidates = (Array.isArray(it.candidates) ? it.candidates : []).map((c) => ({
    name: String(c.name || ''),
    score: Number(c.score) || 0,
    scoreText: String(c.scoreText || ''),
    species: c.species || null,
    baike: c.baike || null
  }));
  return {
    fileID: it.fileID,
    itemStatus: it.itemStatus || 'identified',
    candidates,
    selectedIndex: Number(it.selectedIndex) || 0,
    speciesId: '',
    name: '',
    score: 0,
    baikeDesc: '',
    meetCount: 0,
    newCard: false,
    failMsg: ''
  };
}

/**
 * 规范化一条锁定 item（确认入库：只存选中项）
 * @param {Object} it - 前端传入 item
 * @returns {Object} 规范化 item
 */
function normalizeLockedItem(it) {
  return {
    fileID: it.fileID,
    itemStatus: it.itemStatus || 'pending',
    candidates: [],
    selectedIndex: 0,
    speciesId: it.speciesId || '',
    name: it.speciesId ? '' : String(it.name || '').trim(),
    score: it.speciesId ? 0 : Number(it.score) || 0,
    baikeDesc: it.speciesId ? '' : String(it.baikeDesc || '').slice(0, 1000),
    meetCount: 0,
    newCard: false,
    failMsg: ''
  };
}

exports.main = async (event) => {
  // 云函数入口：校验 → 并发上限 → 建任务
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }

    const mode = event.mode || 'locked';
    const items = Array.isArray(event.items) ? event.items : [];
    if (!items.length || items.length > 5) {
      return { ok: false, code: 'BAD_PARAM', message: '任务照片数量不合法（1~5 张）' };
    }
    // 校验 fileID + 模式特定字段
    const normItems = items.map((it) => {
      // identified 占位（识别刚开始创建时）：fileID/candidates 可空，itemStatus=incomplete，识别完成后回填；
      // 非占位（锁定模式）fileID 必填（后台 saveCard 用）
      const isPlaceholder = mode === 'identified' && it.itemStatus === 'incomplete';
      if (!isPlaceholder && (!it || typeof it.fileID !== 'string' || !it.fileID)) {
        throw Object.assign(new Error('照片 fileID 不合法'), { code: 'BAD_PARAM' });
      }
      if (mode === 'identified') {
        if (!isPlaceholder && (!Array.isArray(it.candidates) || !it.candidates.length)) {
          throw Object.assign(new Error('identified 任务需候选信息'), { code: 'BAD_PARAM' });
        }
        return normalizeIdentifiedItem(it);
      }
      if (!it.speciesId && (!it.name || !String(it.name).trim())) {
        throw Object.assign(new Error('未收录花缺少花名'), { code: 'BAD_PARAM' });
      }
      return normalizeLockedItem(it);
    });

    // 并发上限：仅针对「后台执行」任务（pending/processing）>= MAX_TASKS（3）则拒绝；
    // identified（已识别未入库）是记录性质，不占名额（识别有记录，可多条待确认）
    const existRes = await db
      .collection('batch_tasks')
      .where({
        openid: OPENID,
        status: _.in(['pending', 'processing'])
      })
      .count();
    if (existRes.total >= MAX_TASKS) {
      return {
        ok: false,
        code: 'TASK_LIMITED',
        message: `识别任务已达上限（${MAX_TASKS} 条），请稍后再试`
      };
    }

    // 建任务
    const batchName = nowStr();
    const taskStatus = mode === 'identified' ? 'identified' : 'pending';
    const addRes = await db.collection('batch_tasks').add({
      data: {
        openid: OPENID,
        batchName,
        status: taskStatus,
        items: normItems,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    });
    return { ok: true, taskId: addRes._id, batchName };
  } catch (err) {
    console.error('createBatchTask error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '创建识别任务失败'
    };
  }
};
