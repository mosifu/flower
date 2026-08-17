/**
 * updateBatchTask 云函数
 * 职责：更新识别任务（识别有记录 + identified 实时同步）——
 *   action='lock'：identified → pending（锁定每张选中候选，转后台入库）；
 *   action='sync'：实时同步 identified 任务内容（清单界面操作后）；
 *   action='done'：单图已收录花直接入库后标记任务已完成。
 * 入参：{ taskId, action, items?, itemsLocked? }
 *   action='lock'：itemsLocked = [{ fileID, speciesId?, name?, score?, baikeDesc? }]（锁定后选中项）
 *   action='sync'：items = identified 全候选最新状态
 *   action='done'：无额外（或 items 已入库回填）
 * 返回：{ ok, task }
 * 说明：归属校验（只能改自己的任务）；并发上限（lock 后任务转 pending 占名额，createBatchTask 已校验，此处不重复）。
 * 环境变量：无
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/**
 * 锁定 item：identified 全候选 → 只存选中项
 * @param {Object} it - { fileID, candidates, selectedIndex } 或 { fileID, speciesId?, name?... }
 * @returns {Object} 锁定后 item
 */
function lockItem(it) {
  // 若前端已给锁定信息（speciesId/name），直接用；否则从 candidates+selectedIndex 推导
  const c = (Array.isArray(it.candidates) ? it.candidates : [])[Number(it.selectedIndex) || 0] || null;
  const species = c && c.species ? c.species : null;
  return {
    fileID: it.fileID,
    itemStatus: 'pending',
    candidates: [],
    selectedIndex: 0,
    speciesId: it.speciesId || (species ? species._id : ''),
    name: it.name || (species ? '' : String((c && c.name) || '').trim()),
    score: it.score || (species ? 0 : Number((c && c.score) || 0)),
    baikeDesc: it.baikeDesc || (species ? '' : String(((c && c.baike && c.baike.description) || '')).slice(0, 1000)),
    meetCount: 0,
    newCard: false,
    failMsg: ''
  };
}

exports.main = async (event) => {
  // 云函数入口：按 action 分发更新，归属校验
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }
    const { taskId, action } = event;
    if (!taskId || !action) {
      return { ok: false, code: 'BAD_PARAM', message: '缺少参数' };
    }

    const col = db.collection('batch_tasks');
    // 归属校验
    const doc = await col.doc(taskId).get().catch(() => null);
    const t = doc && doc.data;
    if (!t || t.openid !== OPENID) {
      return { ok: false, code: 'NOT_FOUND', message: '识别任务不存在' };
    }

    if (action === 'lock') {
      // identified → pending：items 锁定为选中项（可前端直接传锁定 items，或传 candidates 推导）
      const rawItems = Array.isArray(event.items) ? event.items : (t.items || []);
      const items = rawItems.map((it) => lockItem(it));
      await col.doc(taskId).update({
        data: { status: 'pending', items, updatedAt: Date.now() }
      });
      return { ok: true, task: { taskId, status: 'pending' } };
    }

    if (action === 'sync') {
      // identified 实时同步：items 全候选最新状态
      const items = Array.isArray(event.items) ? event.items : [];
      if (!items.length) {
        return { ok: false, code: 'BAD_PARAM', message: '同步数据不合法' };
      }
      await col.doc(taskId).update({ data: { items, updatedAt: Date.now() } });
      return { ok: true, task: { taskId, status: t.status } };
    }

    if (action === 'done') {
      // 单图已收录花直接入库：任务标记 done（items 已入库回填）
      const items = Array.isArray(event.items) && event.items.length ? event.items : (t.items || []);
      await col.doc(taskId).update({
        data: { status: 'done', items, updatedAt: Date.now() }
      });
      return { ok: true, task: { taskId, status: 'done' } };
    }

    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (err) {
    console.error('updateBatchTask error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '更新识别任务失败'
    };
  }
};
