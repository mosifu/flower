/**
 * getBatchTask 云函数
 * 职责：查询当前用户的批量识别任务——不传 taskId 返回全部（倒序，供首页模块/任务列表）；传 taskId 返回单任务完整信息（供详情页轮询）。
 * 入参：{ taskId? }
 * 返回：{ ok, list?, task? }
 *   list: [{ taskId, batchName, status, itemCount, doneCount, createdAt }] 倒序
 *   task: { taskId, batchName, status, items[], createdAt }（items 含 itemStatus/meetCount/newCard/failMsg）
 * 说明：只返回当前 openid 的任务（归属校验）；不提供他人任务。
 * 环境变量：无
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  // 云函数入口：按 taskId 单查 或 全量列表，详细说明见文件头
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }

    // 单任务查询：归属校验（只返回自己的任务）
    if (event.taskId) {
      const res = await db
        .collection('batch_tasks')
        .doc(event.taskId)
        .get()
        .catch(() => null);
      const t = res && res.data;
      if (!t || t.openid !== OPENID) {
        return { ok: false, code: 'NOT_FOUND', message: '识别任务不存在' };
      }
      const items = (t.items || []).map((it) => ({
        fileID: it.fileID,
        speciesId: it.speciesId || '',
        name: it.name || '',
        itemStatus: it.itemStatus || 'pending',
        candidates: Array.isArray(it.candidates) ? it.candidates : [],
        selectedIndex: Number(it.selectedIndex) || 0,
        meetCount: it.meetCount || 0,
        newCard: !!it.newCard,
        failMsg: it.failMsg || ''
      }));
      return {
        ok: true,
        task: {
          taskId: t._id,
          batchName: t.batchName,
          status: t.status,
          items,
          createdAt: t.createdAt || 0
        }
      };
    }

    // 全量列表：按 createdAt 倒序（首页模块 + 任务列表页）
    const res = await db
      .collection('batch_tasks')
      .where({ openid: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    const list = res.data.map((t) => {
      const items = t.items || [];
      const doneCount = items.filter((it) => it.itemStatus === 'done').length;
      return {
        taskId: t._id,
        batchName: t.batchName,
        status: t.status,
        itemCount: items.length,
        doneCount,
        createdAt: t.createdAt || 0
      };
    });
    return { ok: true, list };
  } catch (err) {
    console.error('getBatchTask error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '获取识别任务失败'
    };
  }
};
