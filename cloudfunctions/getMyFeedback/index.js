/**
 * getMyFeedback 云函数
 * 职责：查询当前用户的历史反馈（按提交时间倒序，分页）。
 * 入参：{ page? }
 *   page: 页码（1 起，默认 1）；每页 10 条
 * 返回：{ ok, list[], hasMore, page }
 * 说明：
 * - 仅返回当前 openid 的反馈；注销后 openid 被 deleteAccount 匿名化置空，旧记录自然不可见；
 * - 不展示处理状态（无后台标记），仅按 createdAt 倒序。
 * 环境变量：无
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 每页条数：分页加载，避免一次下发过多
const PAGE_SIZE = 10;

exports.main = async (event) => {
  // 云函数入口：按 openid 分页查反馈，createdAt 倒序，详细说明见文件头
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }

    // 页码归一化：非正整数按第 1 页处理
    const page = Math.max(1, Number(event.page) || 1);
    const res = await db
      .collection('feedback')
      .where({ openid: OPENID })
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE + 1) // 多取 1 条判断是否还有下一页
      .get();
    const hasMore = res.data.length > PAGE_SIZE;
    const list = res.data.slice(0, PAGE_SIZE).map((f) => ({
      _id: f._id,
      type: f.type,
      content: f.content,
      photos: f.photos || [],
      createdAt: f.createdAt || 0
    }));
    return { ok: true, list, hasMore, page };
  } catch (err) {
    console.error('getMyFeedback error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '获取反馈记录失败'
    };
  }
};
