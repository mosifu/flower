/**
 * deleteAccount 云函数
 * 职责：注销账号——删除该 openid 的全部个人数据：
 *   1. user_cards 全部花卡（含云存储中的照片原图）
 *   2. photo_hashes 全部图片指纹（MD5 永久去重记录）
 *   3. rate_limits 限流计数【保留】——防止恶意注销刷次数：
 *      同一微信账号 openid 不变，注销后保留当日/历史计数，无法通过注销刷新 20 次配额
 * 入参：无
 * 返回：{ ok, deletedCards, deletedPhotos, deletedHashes, keptRateLimits }
 * 说明：
 * - 照片按 50 个/批调用 deleteFile，支持超出单次上限的场景
 * - 数据库记录删除失败时跳过并继续（尽量删除），文件删除失败不阻断
 * - 由前端「我的」页注销入口调用（二次确认 + 输入确认词）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// deleteFile 单次最多 50 个文件
const DELETE_FILE_BATCH = 50;

/**
 * 批量删除云存储文件
 * @param {string[]} fileList - 云存储 fileID 列表
 * @returns {Promise<number>} 删除成功的数量
 */
async function deleteFilesBatched(fileList) {
  if (!fileList || !fileList.length) return 0;
  let deleted = 0;
  for (let i = 0; i < fileList.length; i += DELETE_FILE_BATCH) {
    const batch = fileList.slice(i, i + DELETE_FILE_BATCH);
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
 * 循环删除某集合中符合条件的所有文档（where().remove() 单次有 limit 上限）
 * @param {string} collection - 集合名
 * @param {Object} where - 查询条件
 * @returns {Promise<number>} 删除的文档数
 */
async function removeAll(collection, where) {
  let removed = 0;
  const col = db.collection(collection);
  // 每轮最多删 1000 条，循环直到删空或到达安全轮数上限（防死循环）
  for (let i = 0; i < 100; i++) {
    const res = await col.where(where).limit(1000).remove();
    const n = (res.stats && res.stats.removed) || 0;
    removed += n;
    if (n < 1000) break;
  }
  return removed;
}

exports.main = async () => {
  /**
   * 云函数入口：删除该用户全部数据与照片
   * @returns {Promise<{ok: boolean, deletedCards: number, deletedPhotos: number, deletedRateLimits: number}>}
   */
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }

    // 1. 收集该用户全部照片 fileID（花卡最多 60 张 × 每卡 30 张，分批拉取）
    const allFileIDs = [];
    let offset = 0;
    while (true) {
      const res = await db
        .collection('user_cards')
        .where({ openid: OPENID })
        .limit(1000)
        .skip(offset)
        .get();
      res.data.forEach((c) => {
        (c.photos || []).forEach((p) => {
          if (p && p.fileID) allFileIDs.push(p.fileID);
        });
      });
      if (res.data.length < 1000) break;
      offset += res.data.length;
    }

    // 2. 删除云存储照片（先删文件，再删记录；文件删除失败不阻断主流程）
    const deletedPhotos = await deleteFilesBatched(allFileIDs);

    // 3. 删除数据库记录（含图片指纹 photo_hashes）
    // 注意：rate_limits 不删除——计数与 openid 绑定，保留后注销无法刷新每日 20 次配额；
    // 其历史记录仍由 cleanupData 按 30 天保留策略自动清理
    const deletedCards = await removeAll('user_cards', { openid: OPENID });
    const deletedHashes = await removeAll('photo_hashes', { openid: OPENID });

    return {
      ok: true,
      deletedCards,
      deletedPhotos,
      deletedHashes,
      keptRateLimits: true
    };
  } catch (err) {
    console.error('deleteAccount error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '注销失败，请稍后重试'
    };
  }
};
