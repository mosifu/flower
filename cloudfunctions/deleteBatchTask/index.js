/**
 * deleteBatchTask 云函数
 * 职责：删除识别任务（batch_tasks）记录——任务列表左滑删除用：
 *   仅删除任务记录本身；不删云存储照片、不删 photo_hashes 指纹。
 *   原因：done/partial 任务的照片已被 user_cards 引用，删文件会导致已入库花卡照片失效；
 *        指纹用于防同一张照片反复识别浪费次数，与任务是否存在无关。
 * 入参：{ taskId }
 * 返回：{ ok, deleted }
 * 说明：归属校验（只能删自己的任务）；入库中任务（pending/processing）拒绝删除——
 *       worker 正在处理，删除会破坏一致性（前端已在 UI 层拦截，此处双保险）。
 * 环境变量：无
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 入库中状态：后台 worker 正在处理，不允许删除
const RUNNING_STATUS = ['pending', 'processing'];

exports.main = async (event) => {
  // 云函数入口：校验参数 → 归属校验 → 状态校验 → 删除记录
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }
    const { taskId } = event;
    if (!taskId || typeof taskId !== 'string') {
      return { ok: false, code: 'BAD_PARAM', message: '缺少任务参数' };
    }

    // 归属校验：只允许删除自己的任务
    const doc = await db
      .collection('batch_tasks')
      .doc(taskId)
      .get()
      .catch(() => null);
    const t = doc && doc.data;
    if (!t || t.openid !== OPENID) {
      return { ok: false, code: 'NOT_FOUND', message: '识别任务不存在' };
    }

    // 入库中任务拒绝删除（worker 可能正在处理，删除会破坏一致性）
    if (RUNNING_STATUS.includes(t.status)) {
      return { ok: false, code: 'RUNNING', message: '任务正在入库中，暂不能删除' };
    }

    // 删除任务记录（不删云存储照片 / 指纹，见文件头说明）
    await db.collection('batch_tasks').doc(taskId).remove();
    return { ok: true, deleted: true };
  } catch (err) {
    console.error('deleteBatchTask error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '删除任务失败，请稍后重试'
    };
  }
};
