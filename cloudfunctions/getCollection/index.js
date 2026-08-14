/**
 * getCollection 云函数
 * 职责：返回图鉴数据（species + 用户收集状态合并）与收集统计。
 * 入参：
 *   { speciesId?（详情页单查）, season?（按花期筛选）,
 *     status?（all/collected/uncollected/new 状态筛选，服务端过滤；
 *             new = AI 自动生成新收录的花）,
 *     sortBy?（default/letter/season/latest 排序方式） }
 * 返回：{ ok, list[], stats { total, collected, rate } }
 * 说明：
 * - 未收集的卡片也能返回科普字段，前端以 collected 标记控制展示。
 * - 排序规则（2026-08-11 图鉴排序需求，后续调整）：
 *   - 全部页签（status=all）：仅「默认」排序时已收集优先分组；主动选择
 *     letter/season/rarity/latest 等排序时全体混排（用户后续调整）
 *   - 已收集页签默认（sortBy=default）：按最近遇见时间倒序
 *   - letter 按中文名拼音（localeCompare zh，云函数 full-ICU，前端 iOS 不可靠）
 *   - season 按花期季节顺序（春→夏→秋→冬，多季节取最早）
 *   - rarity 按稀有度（传说→珍稀→少见→常见）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 稀有度排序权重：数值越小越靠前（传说 > 珍稀 > 少见 > 常见）
const RARITY_ORDER = { legendary: 0, epic: 1, rare: 2, common: 3 };
// 花期季节排序权重：春 > 夏 > 秋 > 冬
const SEASON_ORDER = { 春: 0, 夏: 1, 秋: 2, 冬: 3 };

// —— 排序比较函数 ——

function compareByDefault(a, b) {
  // 默认：稀有度降序 + 中文名拼音升序
  const ra = RARITY_ORDER[a.rarity] !== undefined ? RARITY_ORDER[a.rarity] : 9;
  const rb = RARITY_ORDER[b.rarity] !== undefined ? RARITY_ORDER[b.rarity] : 9;
  return ra - rb || a.cnName.localeCompare(b.cnName, 'zh');
}

function compareByLetter(a, b) {
  // 首字母：中文名拼音升序（localeCompare zh 在云函数 Node full-ICU 下按拼音排序）
  return a.cnName.localeCompare(b.cnName, 'zh');
}

function seasonRank(s) {
  // 花期排序值：取该花所有季节中最早的序号；无花期数据排最后
  return Math.min(
    ...(s.bloomSeasons || []).map((x) =>
      SEASON_ORDER[x] !== undefined ? SEASON_ORDER[x] : 9
    )
  );
}

function compareBySeason(a, b) {
  // 花期：春→夏→秋→冬，同季节按中文名
  return seasonRank(a) - seasonRank(b) || a.cnName.localeCompare(b.cnName, 'zh');
}

function compareByLatest(a, b) {
  // 最近遇见时间倒序；未收集（lastMetAt=0）排最后
  return (b.lastMetAt || 0) - (a.lastMetAt || 0) || compareByDefault(a, b);
}

/**
 * 图鉴主排序：按页签状态与排序方式组合
 * @param {Object} a - 合并后的花种对象
 * @param {Object} b - 合并后的花种对象
 * @param {string} status - all / collected / uncollected
 * @param {string} sortBy - default / letter / season / latest
 * @returns {number} 比较结果
 */
function compareFlowers(a, b, status, sortBy) {
  // 全部/新收录页签 + 默认排序：已收集优先分组；
  // 用户主动选择其他排序（首字母/花期/稀有度等）时全体混排，不分组
  if ((status === 'all' || status === 'new') && sortBy === 'default' && a.collected !== b.collected) {
    return a.collected ? -1 : 1;
  }
  // 已收集页签默认按最近遇见倒序
  if (status === 'collected' && sortBy === 'default') {
    return compareByLatest(a, b);
  }
  switch (sortBy) {
    case 'letter':
      return compareByLetter(a, b);
    case 'season':
      return compareBySeason(a, b);
    case 'latest':
      return compareByLatest(a, b);
    case 'rarity':
      // 稀有度：传说→珍稀→少见→常见，同级按中文名
      return compareByDefault(a, b);
    default:
      return compareByDefault(a, b);
  }
}

exports.main = async (event) => {
  /**
   * 云函数入口：返回图鉴列表与收集统计
   * @param {Object} event - { speciesId?, season?, status?, sortBy? }
   * @returns {Promise<{ok: boolean, list: Array, stats: Object}>}
   *   stats = { total, collected, rate }
   */
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }

    // 1. 拉取全部启用中的花种（知识库，60 种）
    const speciesRes = await db
      .collection('species')
      .where({ enabled: true })
      .limit(1000)
      .get();
    const speciesList = speciesRes.data;

    // 2. 拉取当前用户的花卡，按 speciesId 建立索引
    const cardRes = await db
      .collection('user_cards')
      .where({ openid: OPENID })
      .limit(1000)
      .get();
    const cardBySpecies = {};
    cardRes.data.forEach((c) => {
      cardBySpecies[c.speciesId] = c;
    });

    // 3. 按参数筛选（详情单查 / 花期筛选）
    let filtered = speciesList;
    if (event.speciesId) {
      filtered = speciesList.filter((s) => s._id === event.speciesId);
    } else if (event.season) {
      filtered = speciesList.filter((s) => (s.bloomSeasons || []).includes(event.season));
    }

    // 4. 合并花种与收集状态（先合并出排序所需字段，再过滤排序）
    const merged = filtered.map((s) => {
      const c = cardBySpecies[s._id] || null;
      return {
        _id: s._id,
        cnName: s.cnName,
        latinName: s.latinName,
        family: s.family,
        genus: s.genus,
        rarity: s.rarity,
        bloomSeasons: s.bloomSeasons || [],
        colors: s.colors || [],
        description: s.description || '',
        features: s.features || '',
        flowerLanguage: s.flowerLanguage || '',
        careTips: s.careTips || '',
        distribution: s.distribution || '',
        funFact: s.funFact || '',
        illustrationFileID: s.illustrationFileID || '',
        aiGenerated: !!s.aiGenerated,
        synonyms: s.synonyms || [],
        collected: !!c,
        meetCount: c ? c.meetCount : 0,
        photos: c ? c.photos : [],
        note: c ? c.note || '' : '',
        location: c ? c.location || '' : '',
        firstMetAt: c ? c.firstMetAt : 0,
        lastMetAt: c ? c.lastMetAt : 0
      };
    });

    // 5. 状态过滤（服务端统一处理，客户端只渲染）
    const status = event.status || 'all';
    let list = merged;
    if (status === 'collected') {
      list = merged.filter((s) => s.collected);
    } else if (status === 'uncollected') {
      list = merged.filter((s) => !s.collected);
    } else if (status === 'new') {
      // 新收录：AI 自动生成进库的花（原 60 种知识库之外）
      list = merged.filter((s) => s.aiGenerated);
    }

    // 6. 排序（服务端排序：拼音排序依赖 Node full-ICU，前端 iOS 不可靠）
    const sortBy = event.sortBy || 'default';
    list = list.sort((a, b) => compareFlowers(a, b, status, sortBy));

    // 7. 收集统计基于全量知识库计算，不受筛选影响
    const collectedCount = speciesList.filter((s) => cardBySpecies[s._id]).length;
    const stats = {
      total: speciesList.length,
      collected: collectedCount,
      rate: speciesList.length
        ? Math.round((collectedCount / speciesList.length) * 10000) / 100
        : 0
    };

    return { ok: true, list, stats };
  } catch (err) {
    console.error('getCollection error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '获取图鉴失败'
    };
  }
};
