const util = require('../../utils/util');

// 成就页：花匠等级 + 稀有度分布 + 33 枚徽章墙（基础收集 9 + 新收录花 6 + 花期季节 12 + 应季与象征 6）
Page({
  data: {
    loading: true,
    level: null,
    badges: [],
    stats: null,
    todayRemaining: 0,
    rarityDist: [],
    rarityOrder: [
      { key: 'legendary', label: '传说' },
      { key: 'epic', label: '珍稀' },
      { key: 'rare', label: '少见' },
      { key: 'common', label: '常见' }
    ]
  },

  onShow() {
    /**
     * 页面显示：加载成就数据
     * @returns {void}
     */
    this.load();
  },

  async load() {
    /**
     * 加载成就：等级、徽章、稀有度分布、今日次数
     * @returns {Promise<void>}
     */
    // 成就数据全部由服务端 getAchievements 实时推导
    try {
      const res = await util.callFunction('getAchievements');
      // 徽章解锁时间格式化展示；稀有度分布补默认空值
      const badges = (res.badges || []).map((b) =>
        Object.assign({}, b, {
          achievedAtText: b.achievedAt ? util.formatDate(b.achievedAt) : ''
        })
      );
      const rarityDist = (this.data.rarityOrder || []).map((r) =>
        Object.assign({}, r, (res.stats && res.stats.rarityDist && res.stats.rarityDist[r.key]) || { total: 0, collected: 0 })
      );
      this.setData({
        loading: false,
        level: res.level,
        badges,
        stats: res.stats,
        todayRemaining: res.todayRemaining,
        rarityDist
      });
    } catch (e) {
      this.setData({ loading: false });
      util.showToast(e.message || '加载失败');
    }
  }
});
