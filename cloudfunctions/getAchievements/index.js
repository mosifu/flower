/**
 * getAchievements 云函数
 * 职责：实时推导花匠等级、成就徽章（33 枚）、稀有度分布、今日剩余识别次数、最近收获与识花时间线。
 *       徽章分四组（完整设计见 docs/成就系统扩展方案.md）：
 *         1) 基础收集 9 枚：初次识花 / 收集 N 种 / 收集率 / 四季拾花 / 首张传说卡
 *         2) 新收录花 6 枚：收集 AI 新花 3 + 发起收录 2 + 首发见证 1（另读 flower_gen_tasks）
 *         3) 花期季节 12 枚：四季收集量 10 + 四季进阶组合 2
 *         4) 应季与象征 6 枚：应季寻芳 / 周而复始 + 四时象征花 4
 * 入参：无
 * 返回：{ ok, level, badges[], stats, todayUsed, todayLimit, todayRemaining, recentCards[], timeline[] }
 *   timeline: 识花时间线（按整点小时分组，组间倒序前 TIMELINE_LIMIT 组；设计见 docs/识花时间线方案.md）
 * 说明：等级与徽章不落库，全部根据当前收集状态实时计算，删除卡片后自动回退；
 *       「发起收录 / 首发见证」依赖 flower_gen_tasks（status=done）任务记录，
 *       集合缺失或查询失败时对应徽章按未解锁处理，不影响其余徽章判定。
 * 环境变量：RECOGNIZE_DAILY_LIMIT（每日识别上限，默认 20，仅用于展示剩余次数）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 每日识别上限：与 recognizeFlower 保持一致，仅用于前端展示剩余次数
const DAILY_LIMIT = Number(process.env.RECOGNIZE_DAILY_LIMIT) || 20;

// 识花时间线最大小时组数：控制首页下发体积，30 组已覆盖「最近」浏览需求（设计见识花时间线方案）
const TIMELINE_LIMIT = 30;

// 花匠等级：按已收集种数划分，min 为该档最低收集数
const LEVELS = [
  { min: 1, name: '爱花萌新' },
  { min: 6, name: '拾花者' },
  { min: 16, name: '赏花人' },
  { min: 31, name: '花语师' },
  { min: 46, name: '花神' }
];

// 季节 code -> 花期字段值映射（季节类徽章 code 用英文，species.bloomSeasons 取值为中文）
const SEASON_KEYS = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

// 四时象征花徽章 -> 花种 id（均为现有知识库中该季节的代表花）
const SYMBOLIC_FLOWERS = {
  season_flower_spring: 'yingchunhua', // 迎春花
  season_flower_summer: 'hehua',       // 荷花
  season_flower_autumn: 'juhua',       // 菊花
  season_flower_winter: 'meihua'       // 梅花
};

// 成就徽章静态配置：code 唯一，判定逻辑见下方 switch（分组说明见文件头）
const BADGES = [
  // -- 基础收集（原有 9 枚）--
  { code: 'first_flower', name: '初次识花', desc: '收藏你的第一朵花', icon: '🌱' },
  { code: 'collect_5', name: '初露锋芒', desc: '收集 5 种花', icon: '🌿' },
  { code: 'collect_10', name: '拾花者', desc: '收集 10 种花', icon: '🌼' },
  { code: 'collect_25', name: '花间行者', desc: '收集 25 种花', icon: '🌸' },
  { code: 'collect_50', name: '百花朝圣', desc: '收集 50 种花', icon: '🏵️' },
  { code: 'album_50', name: '半满花田', desc: '图鉴收集率达到 50%', icon: '🌻' },
  { code: 'album_100', name: '满园花开', desc: '图鉴收集率达到 100%', icon: '🌺' },
  { code: 'four_seasons', name: '四季拾花', desc: '集齐春夏秋冬开花的各一种', icon: '🍂' },
  { code: 'first_legendary', name: '一见倾心', desc: '获得第一张传说级花卡', icon: '✨' },
  // -- 新收录花 · 收集 AI 新花（species.aiGenerated 为 true 的花种）--
  { code: 'new_collect_1', name: '新花初见', desc: '收集第一朵 AI 生成的新花', icon: '🌟' },
  { code: 'new_collect_5', name: '新花收藏家', desc: '收集 5 种 AI 生成的新花', icon: '🎆' },
  { code: 'new_collect_10', name: '拓荒集萃', desc: '收集 10 种 AI 生成的新花', icon: '🌠' },
  // -- 新收录花 · 发起收录（flower_gen_tasks 中 status=done 的任务）--
  { code: 'contributor_1', name: '花田播种人', desc: '成功发起生成并收录 1 种新花', icon: '🌾' },
  { code: 'contributor_5', name: '花谱著者', desc: '成功发起生成并收录 5 种新花', icon: '📖' },
  { code: 'first_discoverer', name: '首发见证', desc: '成为某朵 AI 新花的首位收录发起人', icon: '🏆' },
  // -- 花期 · 季节收集量（bloomSeasons 包含匹配，多季节花各季都计入）--
  { code: 'spring_3', name: '春色初醒', desc: '收集 3 种春季开花的花', icon: '🌱' },
  { code: 'spring_10', name: '春风十里', desc: '收集 10 种春季开花的花', icon: '🌿' },
  { code: 'spring_20', name: '春满人间', desc: '收集 20 种春季开花的花', icon: '🌸' },
  { code: 'summer_3', name: '夏韵初生', desc: '收集 3 种夏季开花的花', icon: '🌿' },
  { code: 'summer_10', name: '盛夏光年', desc: '收集 10 种夏季开花的花', icon: '☀️' },
  { code: 'summer_20', name: '夏花绚烂', desc: '收集 20 种夏季开花的花', icon: '🌻' },
  { code: 'autumn_3', name: '秋意初染', desc: '收集 3 种秋季开花的花', icon: '🍂' },
  { code: 'autumn_10', name: '金秋拾穗', desc: '收集 10 种秋季开花的花', icon: '🍁' },
  { code: 'winter_1', name: '凌寒初探', desc: '收集 1 种冬季开花的花', icon: '❄️' },
  { code: 'winter_3', name: '踏雪寻梅', desc: '收集 3 种冬季开花的花', icon: '🌨️' },
  // -- 花期 · 四季进阶组合 --
  { code: 'seasons_2x', name: '四季常伴', desc: '春夏秋冬开花的各收集 2 种', icon: '🗓️' },
  { code: 'seasons_master', name: '花满四季', desc: '春 10 种 + 夏 8 种 + 秋 5 种 + 冬 3 种', icon: '🏵️' },
  // -- 花期 · 应季花信（按收录时刻的真实季节判定）--
  { code: 'in_season_first', name: '应季寻芳', desc: '在当季收集 1 朵当季开花的花', icon: '🌼' },
  { code: 'season_cycle', name: '周而复始', desc: '春夏秋冬每个季节都收集过当季花', icon: '🔄' },
  // -- 花期 · 四时象征花（收集指定代表花）--
  { code: 'season_flower_spring', name: '春之信使', desc: '收集迎春花', icon: '🌼' },
  { code: 'season_flower_summer', name: '夏荷初绽', desc: '收集荷花', icon: '🌺' },
  { code: 'season_flower_autumn', name: '秋菊傲霜', desc: '收集菊花', icon: '🌼' },
  { code: 'season_flower_winter', name: '雪中寒梅', desc: '收集梅花', icon: '❄️' }
];

function todayStr() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/**
 * 时间戳映射到北京时区月份所属季节：春 3-5 / 夏 6-8 / 秋 9-11 / 冬 12-2
 * @param {number} ts - 毫秒时间戳
 * @returns {string} 春 / 夏 / 秋 / 冬
 */
function seasonOfTs(ts) {
  // 云函数时区不保证为北京时间，显式 +8 小时后取 UTC 月份，保证按北京日期判定季节
  const m = new Date(ts + 8 * 60 * 60 * 1000).getUTCMonth() + 1;
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

exports.main = async () => {
  /**
   * 云函数入口：实时推导等级、徽章、统计、今日剩余次数与最近收获
   * @returns {Promise<{ok: boolean, level: Object, badges: Array, stats: Object,
   *   todayUsed: number, todayLimit: number, todayRemaining: number, recentCards: Array}>}
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

    // 花种索引（仅启用中）：供应季判定与最近收获映射，避免逐卡线性查找
    const speciesById = {};
    speciesList.forEach((s) => {
      speciesById[s._id] = s;
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

    // 3. 四季覆盖与季节时刻序列：seasons 供「四季拾花」判定；
    //    seasonTimes 为各季节已收集花的 firstMetAt 升序数组，第 N 项即「收集到第 N 种该季花」的时刻
    const seasons = new Set();
    const seasonTimes = { 春: [], 夏: [], 秋: [], 冬: [] };
    collected.forEach((s) => {
      const t = cardBySpecies[s._id].firstMetAt || 0;
      (s.bloomSeasons || []).forEach((x) => {
        seasons.add(x);
        if (seasonTimes[x]) seasonTimes[x].push(t);
      });
    });
    Object.keys(seasonTimes).forEach((k) => seasonTimes[k].sort((a, b) => a - b));

    // 新收录花（AI 生成）已收集时刻升序：new_collect_* 徽章判定用
    const newCollectedTimes = collected
      .filter((s) => s.aiGenerated)
      .map((s) => cardBySpecies[s._id].firstMetAt || 0)
      .sort((a, b) => a - b);

    // 应季收录记录：收录时刻所在的真实季节恰在该花花期内（in_season_first / season_cycle 用）
    const inSeasonMets = cards
      .map((c) => {
        const sp = speciesById[c.speciesId];
        if (!sp || !c.firstMetAt) return null; // 花种被禁用/删除或时间缺失时不参与
        const season = seasonOfTs(c.firstMetAt);
        return (sp.bloomSeasons || []).includes(season)
          ? { season, firstMetAt: c.firstMetAt }
          : null;
      })
      .filter(Boolean);

    const firstTimes = cards
      .map((c) => c.firstMetAt)
      .filter(Boolean)
      .sort((a, b) => a - b);
    const hasLegendary = collected.some((s) => s.rarity === 'legendary');

    // 发起收录任务：当前用户 status=done 且回填 speciesId 的生成任务；
    // flower_gen_tasks 按 openid+花名去重，每种新花至多一条 done 任务，无需二次去重
    let myDoneTasks = [];
    try {
      const genRes = await db
        .collection('flower_gen_tasks')
        .where({ openid: OPENID, status: 'done' })
        .orderBy('createdAt', 'asc')
        .limit(1000)
        .get();
      myDoneTasks = genRes.data.filter((t) => t.speciesId);
    } catch (e) {
      // 集合未创建/查询失败：按 0 条处理，对应徽章保持未解锁，不中断其余成就计算
      myDoneTasks = [];
    }

    // 首发见证：对我发起的每种新花，查全库最早 done 任务，最早发起人是我才解锁；
    // 正常去重流程下同一花仅一位发起人，此判定兜底并发竞态
    let firstDiscovererAt = 0;
    const myGenSpeciesIds = Array.from(new Set(myDoneTasks.map((t) => t.speciesId)));
    if (myGenSpeciesIds.length) {
      try {
        const firstChecks = await Promise.all(
          myGenSpeciesIds.map((sid) =>
            db
              .collection('flower_gen_tasks')
              .where({ speciesId: sid, status: 'done' })
              .orderBy('createdAt', 'asc')
              .limit(1)
              .get()
          )
        );
        const mineFirsts = firstChecks
          .map((res) => (res.data && res.data[0]) || null)
          .filter((t) => t && t.openid === OPENID)
          .map((t) => t.createdAt || 0)
          .filter((t) => t > 0);
        if (mineFirsts.length) firstDiscovererAt = Math.min(...mineFirsts);
      } catch (e) {
        firstDiscovererAt = 0; // 查询失败按未解锁处理
      }
    }

    // 4. 徽章判定：achievedAt 取触发该徽章的那张卡 firstMetAt（发起收录类取任务 createdAt）
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
        // -- 新收录花 · 收集 AI 新花：code 形如 new_collect_N，取第 N 朵新花收录时刻 --
        case 'new_collect_1':
        case 'new_collect_5':
        case 'new_collect_10': {
          const need = Number(b.code.split('_')[2]);
          unlocked = newCollectedTimes.length >= need;
          achievedAt = unlocked ? newCollectedTimes[need - 1] || 0 : 0;
          break;
        }
        // -- 新收录花 · 发起收录：code 形如 contributor_N，取第 N 个 done 任务建出时刻 --
        case 'contributor_1':
        case 'contributor_5': {
          const need = Number(b.code.split('_')[1]);
          unlocked = myDoneTasks.length >= need;
          achievedAt = unlocked ? myDoneTasks[need - 1].createdAt || 0 : 0;
          break;
        }
        // -- 新收录花 · 首发见证：成为某朵新花最早 done 任务的发起人 --
        case 'first_discoverer':
          unlocked = firstDiscovererAt > 0;
          achievedAt = firstDiscovererAt;
          break;
        // -- 花期 · 季节收集量：code 形如 spring_10，取该季第 N 种花收录时刻 --
        case 'spring_3':
        case 'spring_10':
        case 'spring_20':
        case 'summer_3':
        case 'summer_10':
        case 'summer_20':
        case 'autumn_3':
        case 'autumn_10':
        case 'winter_1':
        case 'winter_3': {
          const [key, num] = b.code.split('_');
          const need = Number(num);
          const times = seasonTimes[SEASON_KEYS[key]] || [];
          unlocked = times.length >= need;
          achievedAt = unlocked ? times[need - 1] || 0 : 0;
          break;
        }
        // -- 花期 · 四季进阶：各季达到要求种数，取最晚补齐的季节时刻 --
        //    冬季可收集花最少（当前仅 5 种），门槛为全组最低（见扩展方案 5.6）
        case 'seasons_2x':
        case 'seasons_master': {
          const needMap =
            b.code === 'seasons_2x'
              ? { 春: 2, 夏: 2, 秋: 2, 冬: 2 }
              : { 春: 10, 夏: 8, 秋: 5, 冬: 3 };
          const times = ['春', '夏', '秋', '冬'].map(
            (s) => (seasonTimes[s] || [])[needMap[s] - 1] || 0
          );
          unlocked = times.every((t) => t > 0);
          achievedAt = unlocked ? Math.max(...times) : 0;
          break;
        }
        // -- 花期 · 应季寻芳：任一次「当季收录当季花」即解锁，取最早一次 --
        case 'in_season_first':
          unlocked = inSeasonMets.length >= 1;
          achievedAt = unlocked ? Math.min(...inSeasonMets.map((x) => x.firstMetAt)) : 0;
          break;
        // -- 花期 · 周而复始：四个真实季节各有当季收录，取最晚补齐季节的时刻 --
        case 'season_cycle': {
          const perSeason = ['春', '夏', '秋', '冬'].map((s) => {
            const arr = inSeasonMets.filter((x) => x.season === s).map((x) => x.firstMetAt);
            return arr.length ? Math.min(...arr) : 0;
          });
          unlocked = perSeason.every((t) => t > 0);
          achievedAt = unlocked ? Math.max(...perSeason) : 0;
          break;
        }
        // -- 花期 · 四时象征花：收集指定代表花（花种须仍在知识库中启用）--
        case 'season_flower_spring':
        case 'season_flower_summer':
        case 'season_flower_autumn':
        case 'season_flower_winter': {
          const id = SYMBOLIC_FLOWERS[b.code];
          const card = id ? cardBySpecies[id] : null;
          unlocked = !!(card && speciesById[id]); // 花种被禁用/删除时不解锁
          achievedAt = unlocked ? card.firstMetAt || 0 : 0;
          break;
        }
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
    // 复用开头建立的 speciesById 索引；花种被禁用/删除时不展示
    const recentCards = cards
      .map((c) => {
        const sp = speciesById[c.speciesId];
        if (!sp) return null;
        return {
          _id: sp._id,
          cnName: sp.cnName,
          latinName: sp.latinName,
          rarity: sp.rarity,
          illustrationFileID: sp.illustrationFileID || '',
          aiGenerated: !!sp.aiGenerated,
          meetCount: c.meetCount || 0,
          lastMetAt: c.lastMetAt || 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.lastMetAt || 0) - (a.lastMetAt || 0))
      .slice(0, 6);

    // 7. 识花时间线：把每张卡的 photos 展开为记录（每张照片 = 一次识别入库事件），
    //    按「整点小时」分组（北京时区 +8h 口径），组内按 addedAt 升序、组间按小时倒序，取前 TIMELINE_LIMIT 组
    //    数据基础：saveCard 的 create/addPhoto 都会向 photos push 一条 { fileID, addedAt }，addedAt 即识别时刻
    const hourKeyOf = (ts) => {
      // 小时分组键：YYYY-MM-DD-HH（按北京时区），与 seasonOfTs 的 +8h 口径保持一致
      const d = new Date(ts + 8 * 60 * 60 * 1000);
      const p = (n) => (n < 10 ? '0' + n : '' + n);
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}`;
    };
    const hourGroups = new Map(); // 小时键 -> { hourTime, records: [] }
    cards.forEach((c) => {
      const sp = speciesById[c.speciesId];
      if (!sp) return; // 花种被禁用/删除时该卡不参与时间线
      (c.photos || []).forEach((ph, i) => {
        const t = ph.addedAt || 0;
        if (!t) return; // 旧数据无 addedAt 的记录跳过
        const key = hourKeyOf(t);
        const group = hourGroups.get(key) || { hourTime: t, records: [] };
        group.hourTime = Math.min(group.hourTime, t); // 组锚点取组内最早时间
        hourGroups.set(key, group); // 回写 Map，否则新组不生效（首查遗漏 bug）
        group.records.push({
          time: t,
          meetIndex: i + 1, // photos 下标 +1 即该卡第几次遇见（photos 按 push 顺序追加）
          species: {
            _id: sp._id,
            cnName: sp.cnName,
            latinName: sp.latinName,
            rarity: sp.rarity,
            illustrationFileID: sp.illustrationFileID || '',
            aiGenerated: !!sp.aiGenerated
          },
          photo: {
            fileID: ph.fileID || '',
            location: ph.location || '',
            note: ph.note || ''
          }
        });
      });
    });
    // 组内按 addedAt 升序、组间按小时倒序（最新在前），截断到 TIMELINE_LIMIT 组
    const timeline = Array.from(hourGroups.values())
      .map((g) => ({
        hourTime: g.hourTime,
        records: g.records.sort((a, b) => a.time - b.time)
      }))
      .sort((a, b) => b.hourTime - a.hourTime)
      .slice(0, TIMELINE_LIMIT);

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
      recentCards,
      timeline
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
