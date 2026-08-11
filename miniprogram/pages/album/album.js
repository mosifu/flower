const util = require('../../utils/util');

// 图鉴页：收集统计 + 状态/花期筛选 + 排序 + 花卡网格
Page({
  data: {
    loading: true,
    stats: { total: 0, collected: 0, rate: 0 },
    status: 'all',
    season: '',
    sortBy: 'default',
    // 排序方式：默认（全部页签已收集优先；已收集页签时间倒序）/ 首字母 / 花期 / 稀有度
    sortOptions: [
      { key: 'default', label: '默认' },
      { key: 'letter', label: '首字母' },
      { key: 'season', label: '花期' },
      { key: 'rarity', label: '稀有度' }
    ],
    seasons: ['春', '夏', '秋', '冬'],
    list: []
  },

  onShow() {
    /**
     * 页面显示：加载图鉴数据
     * @returns {void}
     */
    this.load();
  },

  async load() {
    /**
     * 拉取图鉴：状态/花期/排序全部走服务端过滤排序
     * @returns {Promise<void>}
     */
    // 筛选与排序统一由服务端处理（拼音排序依赖 Node full-ICU）
    wx.showLoading({ title: '加载图鉴' });
    try {
      const params = {
        status: this.data.status,
        sortBy: this.data.sortBy
      };
      if (this.data.season) params.season = this.data.season;
      const res = await util.callFunction('getCollection', params);
      this.setData({
        loading: false,
        stats: res.stats,
        list: res.list
      });
    } catch (e) {
      this.setData({ loading: false });
      util.showToast(e.message || '加载失败');
    }
    wx.hideLoading();
  },

  onStatusTap(e) {
    /**
     * 切换 全部/已收集/未收集 状态筛选（服务端过滤）
     * @param {Object} e - 事件对象，dataset.status 为筛选项
     * @returns {void}
     */
    const status = e.currentTarget.dataset.status;
    if (this.data.status === status) return;
    this.setData({ status }, () => this.load());
  },

  onSeasonTap(e) {
    /**
     * 切换花期筛选（再次点击同项则取消）
     * @param {Object} e - 事件对象，dataset.season 为花期
     * @returns {void}
     */
    const season = e.currentTarget.dataset.season;
    this.setData({ season: this.data.season === season ? '' : season }, () => this.load());
  },

  onSortTap(e) {
    /**
     * 切换排序方式（默认/首字母/花期）
     * @param {Object} e - 事件对象，dataset.sort 为排序键
     * @returns {void}
     */
    const sortBy = e.currentTarget.dataset.sort;
    if (this.data.sortBy === sortBy) return;
    this.setData({ sortBy }, () => this.load());
  },

  goRecognize() {
    /**
     * 空状态引导：跳转首页识花
     * @returns {void}
     */
    wx.switchTab({ url: '/pages/index/index' });
  }
});
