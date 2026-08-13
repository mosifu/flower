/**
 * requestFlowerGenerate 云函数
 * 职责：未收录花生成请求——同名任务去重 → 花种已存在校验 → 每日配额扣减 → 建任务。
 * 入参：{ name, score, baikeDesc? }
 *   name: 百度识别返回的花名（原样，作为生成后 cnName 保证下次命中）
 *   score: 识别置信度（0~1，仅记录）
 *   baikeDesc: 百度百科描述文本（作为 LLM 生成科普的参考资料）
 * 返回：{ ok, taskId?, reused?, alreadyExists?, speciesId? }
 *   - reused=true：同名任务已在 pending/generating，复用不重复扣配额
 *   - alreadyExists=true：该花已入库（他人已生成），直接返回 speciesId
 * 环境变量：GEN_DAILY_LIMIT（默认 3，每用户每日生成上限）
 * 说明：
 * - 任务 _id = {openid}_{normalizedName}，同名任务天然去重
 * - 配额在 gen_limits 集合（_id = {openid}_{yyyyMMdd}），事务原子自增防并发超限
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const DAILY_LIMIT = Number(process.env.GEN_DAILY_LIMIT) || 3;

function todayStr() {
  // 生成今日日期字符串 yyyyMMdd（与 rate_limits 格式一致）
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function normalizeName(s) {
  // 花名规范化（小写去空格），作为任务 id 的一部分
  return String(s || '').trim().toLowerCase();
}

/**
 * 退还一次当日生成配额（建任务失败时调用）
 * @param {string} openid - 用户唯一标识
 * @returns {Promise<void>} 失败静默
 */
async function refundGenQuota(openid) {
  const id = `${openid}_${todayStr()}`;
  try {
    const doc = await db.collection('gen_limits').doc(id).get();
    if (doc.data && doc.data.count > 0) {
      await db.collection('gen_limits').doc(id).update({ data: { count: db.command.inc(-1) } });
    }
  } catch (e) {
    console.warn('refundGenQuota 失败:', e);
  }
}

exports.main = async (event) => {
  // 云函数入口：去重 → 已入库校验 → 配额事务 → 建任务，详细说明见文件头
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }

    const name = String(event.name || '').trim();
    if (!name || name.length > 50) {
      return { ok: false, code: 'BAD_PARAM', message: '花名不合法' };
    }
    const score = Number(event.score);
    if (!(score >= 0 && score <= 1)) {
      return { ok: false, code: 'BAD_PARAM', message: '置信度不合法' };
    }

    const col = db.collection('flower_gen_tasks');
    const taskId = `${OPENID}_${normalizeName(name)}`;

    // 1. 同名任务去重：pending/generating 复用（不重复扣配额）；done 直接返回花种
    try {
      const doc = await col.doc(taskId).get();
      const st = doc.data && doc.data.status;
      if (st === 'pending' || st === 'generating') {
        return { ok: true, taskId, reused: true };
      }
      if (st === 'done' && doc.data.speciesId) {
        return { ok: true, alreadyExists: true, speciesId: doc.data.speciesId };
      }
    } catch (e) {
      // 文档不存在，继续新建
    }

    // 2. 花种已入库校验（他人已生成过同一种花）：直接返回，无需再生成
    const spRes = await db
      .collection('species')
      .where({ cnName: name, enabled: true })
      .limit(1)
      .get();
    if (spRes.data.length) {
      return { ok: true, alreadyExists: true, speciesId: spRes.data[0]._id };
    }

    // 3. 每日配额：事务原子扣减（读计数→校验→自增）
    const date = todayStr();
    const lid = `${OPENID}_${date}`;
    try {
      await db.runTransaction(async (t) => {
        const doc = await t
          .collection('gen_limits')
          .doc(lid)
          .get()
          .catch(() => null);
        const cur = (doc && doc.data && doc.data.count) || 0;
        if (cur >= DAILY_LIMIT) {
          const err = new Error(`今日生成次数已达上限（${DAILY_LIMIT}次）`);
          err.code = 'GEN_LIMITED';
          throw err;
        }
        await t
          .collection('gen_limits')
          .doc(lid)
          .set({ data: { openid: OPENID, date, count: cur + 1 } });
      });
    } catch (e) {
      if (e && e.code === 'GEN_LIMITED') {
        return { ok: false, code: 'GEN_LIMITED', message: e.message };
      }
      throw e;
    }

    // 4. 建任务（失败退还配额）
    try {
      await col.doc(taskId).set({
        data: {
          openid: OPENID,
          name,
          score,
          baikeDesc: String(event.baikeDesc || '').slice(0, 1000),
          status: 'pending',
          speciesId: '',
          error: '',
          retryCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      });
    } catch (e) {
      await refundGenQuota(OPENID);
      throw e;
    }

    return { ok: true, taskId };
  } catch (err) {
    console.error('requestFlowerGenerate error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '提交生成请求失败'
    };
  }
};
