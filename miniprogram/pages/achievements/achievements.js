const util = require('../../utils/util');

// 成就页：花匠等级 + 稀有度分布 + 33 枚徽章墙（基础收集 9 + 新收录花 6 + 花期季节 12 + 应季与象征 6）
Page({
  data: {
    loading: true,
    level: null,
    badges: [],
    displayBadges: [], // 按筛选与排序规则计算后的徽章展示列表
    badgeFilter: 'all', // 徽章筛选：all 全部 / owned 已拥有 / unowned 未拥有（互斥，均不选时=全部）
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
      // 初始展示列表：按「已拥有在前 + 获得时间倒序」排序（进入默认展示全部）
      const displayBadges = this.sortBadges(badges);
      const rarityDist = (this.data.rarityOrder || []).map((r) =>
        Object.assign({}, r, (res.stats && res.stats.rarityDist && res.stats.rarityDist[r.key]) || { total: 0, collected: 0 })
      );
      this.setData({
        loading: false,
        level: res.level,
        badges,
        displayBadges,
        stats: res.stats,
        todayRemaining: res.todayRemaining,
        rarityDist
      });
    } catch (e) {
      this.setData({ loading: false });
      util.showToast(e.message || '加载失败');
    }
  },

  sortBadges(list) {
    /**
     * 徽章排序：已拥有在前（按获得时间 achievedAt 倒序，最近获得在前），未拥有沉底
     * @param {Array} list - 徽章数组
     * @returns {Array} 排序后的新数组
     */
    // 解锁徽章按 achievedAt 倒序；未解锁的 achievedAt 为 0，自然排到后面
    return list.slice().sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      return (b.achievedAt || 0) - (a.achievedAt || 0);
    });
  },

  setBadgeFilter(e) {
    /**
     * 徽章筛选切换：已拥有 / 未拥有 互斥，再次点击同项取消（回到全部）
     * @param {Object} e - 事件对象，dataset.filter 为 owned / unowned
     * @returns {void}
     */
    const target = e.currentTarget.dataset.filter;
    // 互斥 + toggle：点已选中的项则取消（回 all），否则切到该项
    const badgeFilter = this.data.badgeFilter === target ? 'all' : target;
    let displayBadges = this.data.badges;
    if (badgeFilter === 'owned') {
      displayBadges = displayBadges.filter((b) => b.unlocked);
    } else if (badgeFilter === 'unowned') {
      displayBadges = displayBadges.filter((b) => !b.unlocked);
    }
    // 排序规则统一：已拥有在前 + 获得时间倒序（全部/已拥有时生效；未拥有全未解锁排序无影响）
    displayBadges = this.sortBadges(displayBadges);
    this.setData({ badgeFilter, displayBadges });
  }
});
