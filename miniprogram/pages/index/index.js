const util = require('../../utils/util');
const config = require('../../config');

// 首页：识花入口 + 收集进度速览 + 识花时间线（左时间轴 + 右 swiper）
Page({
  data: {
    loading: true,
    stats: { total: 0, collected: 0, rate: 0 },
    levelName: '',
    todayRemaining: 0,
    recentCards: [],
    timeline: [], // 识花时间线：按小时分组的节点数组（含 hourLabel / records[minuteLabel]）
    timelineIndex: 0 // swiper 当前节点下标（与左侧时间轴高亮联动）
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
     * 加载首页数据：单请求 getAchievements（含最近收获与识花时间线），5 秒节流
     * @returns {Promise<void>}
     */
    // 优化（评审 2.7）：getAchievements 已返回 recentCards/stats/level/今日次数/timeline，
    // 首页只调一次云函数，减少 tab 切换时的重复请求
    const now = Date.now();
    if (this._lastLoad && now - this._lastLoad < 5000) return;
    this._lastLoad = now;
    try {
      const ach = await util.callFunction('getAchievements');
      // 时间线：服务端按小时分组返回原始时间戳，前端拼展示标签（hourLabel 时间轴 / minuteLabel 记录内）
      const timeline = (ach.timeline || []).map((g) => ({
        hourTime: g.hourTime,
        hourLabel: util.formatHourLabel(g.hourTime),
        records: (g.records || []).map((r) =>
          Object.assign({}, r, { minuteLabel: util.formatMinuteLabel(r.time) })
        )
      }));
      this.setData({
        loading: false,
        stats: ach.stats,
        levelName: ach.level.name,
        todayRemaining: ach.todayRemaining,
        recentCards: ach.recentCards || [],
        timeline,
        timelineIndex: 0 // 新数据回到最新节点
      });
    } catch (e) {
      this.setData({ loading: false });
      util.showToast(e.message || '加载失败');
    }
  },

  onChoose(e) {
    /**
     * 识花入口：拍照单张 / 相册多选（≤5 张批量识别）后跳转识别页
     * @param {Object} e - 事件对象，dataset.source 为 camera / album
     * @returns {void}
     */
    const source = e.currentTarget.dataset.source;
    if (source === 'camera') {
      // 拍照保持单张：选图后把本地路径带给识别页处理
      util
        .chooseOneImage(['camera'])
        .then((tempPath) => {
          wx.navigateTo({
            url: `/pages/recognize/recognize?tempPath=${encodeURIComponent(tempPath)}`
          });
        })
        .catch((err) => {
          if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
          util.showToast('无法打开相机，请检查权限');
        });
      return;
    }
    // 相册多选（批量识别方案：单次 ≤5 张）：多图路径逗号拼接传给识别页
    util
      .chooseMultiImages(5)
      .then((paths) => {
        wx.navigateTo({
          url: `/pages/recognize/recognize?tempPaths=${encodeURIComponent(paths.join(','))}`
        });
      })
      .catch((err) => {
        // 用户主动取消不提示，其余失败提示检查权限
        if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        util.showToast('无法打开相册，请检查权限');
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

  onTimelineChange(e) {
    /**
     * swiper 纵向滑动切换时间节点：同步左侧时间轴高亮
     * @param {Object} e - 事件对象，e.detail.current 为当前节点下标
     * @returns {void}
     */
    this.setData({ timelineIndex: e.detail.current });
  },

  onTimelineTap(e) {
    /**
     * 点击左侧时间轴节点：跳转 swiper 到对应节点
     * @param {Object} e - 事件对象，dataset.index 为节点下标
     * @returns {void}
     */
    this.setData({ timelineIndex: Number(e.currentTarget.dataset.index) });
  },

  onTimelinePhotoTap(e) {
    /**
     * 预览时间线节点内的拍摄照片（cloud:// fileID 全屏预览）
     * @param {Object} e - 事件对象，dataset.fileid 为照片云存储 ID
     * @returns {void}
     */
    const fileID = e.currentTarget.dataset.fileid;
    if (!fileID) return;
    wx.previewImage({ urls: [fileID], current: fileID });
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
