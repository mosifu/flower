/**
 * cleanupData 云函数
 * 职责：定时清理过期数据：
 *   - rate_limits 限流计数历史（保留 30 天）
 *   - photo_hashes 图片指纹（MD5 永久去重记录，保留 90 天）
 * 入参：无
 * 返回：{ ok, removedRateLimits, removedHashes }
 * 触发：config.json 配置定时触发器，每周日 03:00 执行
 * 说明：
 * - rate_limits 文档按 openid+日期 生成，永久累积且无业务价值，保留 30 天
 * - photo_hashes 保留 90 天：太久远的去重价值低，同时控制集合体积
 * - date 为 yyyyMMdd 字符串，与 30 天前日期字符串比较删除
 * - 循环分批删除（where().remove() 单次有 limit 上限），最多 100 轮防死循环
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 限流记录保留天数：超过后无任何用途，定期清理防止无限增长
const RETENTION_DAYS = 30;
// 图片指纹保留天数：去重窗口 90 天，兼顾防重复与集合体积
const HASH_RETENTION_DAYS = 90;

function dateStr(ts) {
  // 时间戳转 yyyyMMdd（与 rate_limits.date 字段格式一致）
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

exports.main = async () => {
  /**
   * 云函数入口：清理过期 rate_limits（30 天）与 photo_hashes（90 天）
   * @returns {Promise<{ok: boolean, removedRateLimits: number, removedHashes: number}>}
   */
  try {
    // 1. 清理 30 天前的限流记录
    const boundary = dateStr(Date.now() - RETENTION_DAYS * 86400000);
    let removedRateLimits = 0;
    const rlCol = db.collection('rate_limits');
    for (let i = 0; i < 100; i++) {
      // date 字符串同长度同格式，字典序比较等价于时间比较
      const res = await rlCol.where({ date: _.lt(boundary) }).limit(1000).remove();
      const n = (res.stats && res.stats.removed) || 0;
      removedRateLimits += n;
      if (n < 1000) break;
    }

    // 2. 清理 90 天前的图片指纹（按 createdAt 时间戳比较）
    const hashBoundary = Date.now() - HASH_RETENTION_DAYS * 86400000;
    let removedHashes = 0;
    const hashCol = db.collection('photo_hashes');
    for (let i = 0; i < 100; i++) {
      const res = await hashCol
        .where({ createdAt: _.lt(hashBoundary) })
        .limit(1000)
        .remove();
      const n = (res.stats && res.stats.removed) || 0;
      removedHashes += n;
      if (n < 1000) break;
    }

    return { ok: true, removedRateLimits, removedHashes };
  } catch (err) {
    console.error('cleanupData error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '清理失败'
    };
  }
};
