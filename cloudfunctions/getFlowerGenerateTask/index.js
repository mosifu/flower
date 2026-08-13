/**
 * getFlowerGenerateTask 云函数
 * 职责：查询未收录花生成任务状态（前端轮询用）。
 * 入参：{ taskId }
 * 返回：{ ok, task: { status, speciesId, error, name } }
 *   status: pending（排队中）/ generating（生成中）/ done（已完成）/ failed（失败）
 * 说明：校验任务归属（openid 一致），防止越权查询他人任务。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  // 云函数入口：按 taskId 查询任务状态，详细说明见文件头
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }
    if (!event.taskId) {
      return { ok: false, code: 'BAD_PARAM', message: '缺少任务参数' };
    }

    const doc = await db
      .collection('flower_gen_tasks')
      .doc(String(event.taskId))
      .get()
      .catch(() => null);

    if (!doc || !doc.data) {
      return { ok: false, code: 'NOT_FOUND', message: '任务不存在' };
    }
    // 任务归属校验：只能查自己的任务
    if (doc.data.openid !== OPENID) {
      return { ok: false, code: 'FORBIDDEN', message: '无权查看该任务' };
    }

    return {
      ok: true,
      task: {
        status: doc.data.status,
        speciesId: doc.data.speciesId || '',
        error: doc.data.error || '',
        name: doc.data.name || ''
      }
    };
  } catch (err) {
    console.error('getFlowerGenerateTask error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '查询任务失败'
    };
  }
};
