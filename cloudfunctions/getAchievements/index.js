/**
 * getAchievements 云函数
 * 职责：由 user_cards 实时推导花匠等级、9 枚成就徽章、稀有度分布与今日剩余识别次数。
 * 入参：无
 * 返回：{ ok, level, badges[], stats, todayUsed, todayLimit, todayRemaining }
 * 说明：等级与徽章不落库，全部根据当前收集状态计算，删除卡片后自动回退。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const DAILY_LIMIT = Number(process.env.RECOGNIZE_DAILY_LIMIT) || 20;

// 花匠等级：按已收集种数划分，min 为该档最低收集数
const LEVELS = [
  { min: 1, name: '爱花萌新' },
  { min: 6, name: '拾花者' },
  { min: 16, name: '赏花人' },
  { min: 31, name: '花语师' },
  { min: 46, name: '花神' }
];

// 成就徽章静态配置：code 唯一，判定逻辑见下方 switch
const BADGES = [
  { code: 'first_flower', name: '初次识花', desc: '收藏你的第一朵花', icon: '🌱' },
  { code: 'collect_5', name: '初露锋芒', desc: '收集 5 种花', icon: '🌿' },
  { code: 'collect_10', name: '拾花者', desc: '收集 10 种花', icon: '🌼' },
  { code: 'collect_25', name: '花间行者', desc: '收集 25 种花', icon: '🌸' },
  { code: 'collect_50', name: '百花朝圣', desc: '收集 50 种花', icon: '🏵️' },
  { code: 'album_50', name: '半满花田', desc: '图鉴收集率达到 50%', icon: '🌻' },
  { code: 'album_100', name: '满园花开', desc: '图鉴收集率达到 100%', icon: '🌺' },
  { code: 'four_seasons', name: '四季拾花', desc: '集齐春夏秋冬开花的各一种', icon: '🍂' },
  { code: 'first_legendary', name: '一见倾心', desc: '获得第一张传说级花卡', icon: '✨' }
];

function todayStr() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

exports.main = async () => {
  /**
   * 云函数入口：实时推导等级、徽章、统计与今日剩余次数
   * @returns {Promise<{ok: boolean, level: Object, badges: Array, stats: Object,
   *   todayUsed: number, todayLimit: number, todayRemaining: number}>}
   */
  const { OPENID } = cloud.getWXContext();

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }

    const speciesRes = await db
      .collection('species')
      .where({ enabled: true })
      .limit(1000)
      .get();
    const speciesList = speciesRes.data;

    const cardRes = await db
      .collection('user_cards')
      .where({ openid: OPENID })
      .limit(1000)
      .get();
    const cards = cardRes.data;

    const cardBySpecies = {};
    cards.forEach((c) => {
      cardBySpecies[c.speciesId] = c;
    });

    // 已收集花种集合
    const collected = speciesList.filter((s) => cardBySpecies[s._id]);
    const collectedCount = collected.length;
    const total = speciesList.length;
    const rate = total ? Math.round((collectedCount / total) * 10000) / 100 : 0;

    // 1. 花匠等级：找到最后一个满足 min <= 收集数的档位
    let level = LEVELS[0];
    let nextLevel = null;
    for (let i = 0; i < LEVELS.length; i++) {
      if (collectedCount >= LEVELS[i].min) {
        level = LEVELS[i];
        nextLevel = LEVELS[i + 1] || null;
      }
    }
    const tierSpan = nextLevel ? nextLevel.min - level.min : 1;
    const progressInTier = nextLevel
      ? Math.min(100, Math.round(((collectedCount - level.min + 1) / tierSpan) * 100))
      : 100;

    // 2. 稀有度分布：四档各自的总数与已收集数
    const rarityDist = {};
    ['legendary', 'epic', 'rare', 'common'].forEach((r) => {
      rarityDist[r] = {
        total: speciesList.filter((s) => s.rarity === r).length,
        collected: collected.filter((s) => s.rarity === r).length
      };
    });

    // 3. 四季覆盖：收集到的花期集合（用于「四季拾花」徽章）
    const seasons = new Set();
    collected.forEach((s) => (s.bloomSeasons || []).forEach((x) => seasons.add(x)));

    const firstTimes = cards
      .map((c) => c.firstMetAt)
      .filter(Boolean)
      .sort((a, b) => a - b);
    const hasLegendary = collected.some((s) => s.rarity === 'legendary');

    // 4. 徽章判定：achievedAt 取触发该徽章的那张卡 firstMetAt
    const badges = BADGES.map((b) => {
      let unlocked = false;
      let achievedAt = 0;
      switch (b.code) {
        case 'first_flower':
          unlocked = collectedCount >= 1;
          achievedAt = firstTimes[0] || 0;
          break;
        case 'collect_5':
          unlocked = collectedCount >= 5;
          achievedAt = firstTimes[4] || 0;
          break;
        case 'collect_10':
          unlocked = collectedCount >= 10;
          achievedAt = firstTimes[9] || 0;
          break;
        case 'collect_25':
          unlocked = collectedCount >= 25;
          achievedAt = firstTimes[24] || 0;
          break;
        case 'collect_50':
          unlocked = collectedCount >= 50;
          achievedAt = firstTimes[49] || 0;
          break;
        case 'album_50':
          unlocked = rate >= 50;
          achievedAt = unlocked ? (firstTimes[firstTimes.length - 1] || 0) : 0;
          break;
        case 'album_100':
          unlocked = rate >= 100;
          achievedAt = unlocked ? (firstTimes[firstTimes.length - 1] || 0) : 0;
          break;
        case 'four_seasons':
          unlocked = ['春', '夏', '秋', '冬'].every((x) => seasons.has(x));
          achievedAt = unlocked ? (firstTimes[firstTimes.length - 1] || 0) : 0;
          break;
        case 'first_legendary':
          unlocked = hasLegendary;
          achievedAt = unlocked
            ? Math.min(
                ...collected
                  .filter((s) => s.rarity === 'legendary')
                  .map((s) => cardBySpecies[s._id].firstMetAt)
              )
            : 0;
          break;
      }
      return {
        code: b.code,
        name: b.name,
        desc: b.desc,
        icon: b.icon,
        unlocked,
        achievedAt
      };
    });

    // 5. 今日剩余识别次数：读取 rate_limits 当日计数
    let todayUsed = 0;
    try {
      const doc = await db
        .collection('rate_limits')
        .doc(`${OPENID}_${todayStr()}`)
        .get();
      todayUsed = (doc.data && doc.data.count) || 0;
    } catch (e) {
      todayUsed = 0;
    }

    // 6. 最近收获：已收集花卡按最近遇见时间排序，返回前 6 张（首页单请求使用）
    // 按 speciesId 建立索引，避免每张卡线性查找知识库
    const speciesById = {};
    speciesList.forEach((s) => {
      speciesById[s._id] = s;
    });
    const recentCards = cards
      .map((c) => {
        const sp = speciesById[c.speciesId];
        if (!sp) return null; // 花种被禁用/删除时不展示
        return {
          _id: sp._id,
          cnName: sp.cnName,
          latinName: sp.latinName,
          rarity: sp.rarity,
          illustrationFileID: sp.illustrationFileID || '',
          meetCount: c.meetCount || 0,
          lastMetAt: c.lastMetAt || 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.lastMetAt || 0) - (a.lastMetAt || 0))
      .slice(0, 6);

    return {
      ok: true,
      level: {
        name: level.name,
        count: collectedCount,
        nextName: nextLevel ? nextLevel.name : null,
        nextMin: nextLevel ? nextLevel.min : null,
        progress: progressInTier
      },
      badges,
      stats: {
        total,
        collected: collectedCount,
        rate,
        rarityDist,
        seasonsCovered: [...seasons]
      },
      todayUsed,
      todayLimit: DAILY_LIMIT,
      todayRemaining: Math.max(0, DAILY_LIMIT - todayUsed),
      recentCards
    };
  } catch (err) {
    console.error('getAchievements error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '获取成就失败'
    };
  }
};
