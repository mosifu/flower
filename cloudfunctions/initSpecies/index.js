/**
 * initSpecies 云函数
 * 职责：把 species-data.js 的 60 种花知识库幂等导入云数据库。
 * 入参：无
 * 返回：{ ok, count }
 * 环境变量：ADMIN_OPENIDS（可选，逗号分隔；配置后仅白名单 openid 可执行）
 * 说明：以 species-data.js 中的 id 作为文档 _id，重复调用只会覆盖更新，不会产生重复数据。
 *       config.json 配置 timeout 60s；写入按每批 10 条并行执行，避免串行超时。
 */
const cloud = require('wx-server-sdk');
const speciesData = require('./species-data');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async () => {
  /**
   * 云函数入口：幂等导入知识库
   * @returns {Promise<{ok: boolean, count: number, message: string}>}
   */
  const { OPENID } = cloud.getWXContext();

  try {
    // 管理员校验：未配置 ADMIN_OPENIDS 时任何人均可导入（仅建议开发期使用）
    const admins = (process.env.ADMIN_OPENIDS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (admins.length && !admins.includes(OPENID)) {
      return { ok: false, code: 'FORBIDDEN', message: '无导入权限' };
    }

    const col = db.collection('species');
    let count = 0;
    // 并行写入（每批 10 条）：60 条串行 set 会超出云函数默认超时（-504003）
    const BATCH = 10;
    for (let i = 0; i < speciesData.length; i += BATCH) {
      const batch = speciesData.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((item) =>
          // 幂等导入：固定 _id = id，保证重复执行不产生脏数据；单条失败不影响其余
          col
            .doc(item.id)
            .set({ data: Object.assign({}, item, { enabled: true }) })
            .then(() => 1)
            .catch((e) => {
              console.warn(`导入 ${item.id} 失败:`, e);
              return 0;
            })
        )
      );
      count += results.reduce((a, b) => a + b, 0);
    }

    return { ok: true, count, message: `已导入 ${count} 种花` };
  } catch (err) {
    console.error('initSpecies error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '导入失败'
    };
  }
};
