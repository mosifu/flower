const util = require('../../utils/util');
const config = require('../../config');

// 首页：识花入口 + 收集进度速览 + 最近收获
Page({
  data: {
    loading: true,
    stats: { total: 0, collected: 0, rate: 0 },
    levelName: '',
    todayRemaining: 0,
    recentCards: []
  },

  onShow() {
    /**
     * 页面显示：刷新统计与最近收获（带 5 秒节流）
     * @returns {void}
     */
    // 每次回到首页都刷新，但 5 秒内重复进入（tab 来回切）不重复请求
    this.loadData();
  },

  async loadData() {
    /**
     * 加载首页数据：单请求 getAchievements（含最近收获），5 秒节流
     * @returns {Promise<void>}
     */
    // 优化（评审 2.7）：getAchievements 已返回 recentCards/stats/level/今日次数，
    // 首页只调一次云函数，减少 tab 切换时的重复请求
    const now = Date.now();
    if (this._lastLoad && now - this._lastLoad < 5000) return;
    this._lastLoad = now;
    try {
      const ach = await util.callFunction('getAchievements');
      this.setData({
        loading: false,
        stats: ach.stats,
        levelName: ach.level.name,
        todayRemaining: ach.todayRemaining,
        recentCards: ach.recentCards || []
      });
    } catch (e) {
      this.setData({ loading: false });
      util.showToast(e.message || '加载失败');
    }
  },

  onChoose(e) {
    /**
     * 识花入口：拍照 / 相册选图后跳转识别页
     * @param {Object} e - 事件对象，dataset.source 为 camera / album
     * @returns {void}
     */
    // 拍照 / 相册二选一，选图后把本地路径带给识别页处理
    const source = e.currentTarget.dataset.source;
    util
      .chooseOneImage(source === 'camera' ? ['camera'] : ['album'])
      .then((tempPath) => {
        wx.navigateTo({
          url: `/pages/recognize/recognize?tempPath=${encodeURIComponent(tempPath)}`
        });
      })
      .catch((err) => {
        // 用户主动取消不提示，其余失败提示检查权限
        if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        util.showToast('无法打开相机/相册，请检查权限');
      });
  },

  goAlbum() {
    /**
     * 跳转图鉴 Tab
     * @returns {void}
     */
    wx.switchTab({ url: '/pages/album/album' });
  },

  goAchievements() {
    /**
     * 跳转成就 Tab
     * @returns {void}
     */
    wx.switchTab({ url: '/pages/achievements/achievements' });
  },

  onShareAppMessage() {
    /**
     * 转发分享（优化：补充小程序分享能力）
     * @returns {Object} 分享配置
     */
    return {
      title: config.SLOGAN,
      path: '/pages/index/index'
    };
  }
});
