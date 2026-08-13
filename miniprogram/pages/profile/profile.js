const config = require('../../config');
const util = require('../../utils/util');

// 我的页：使用统计 + 说明 + 注销入口 + 隐私政策
Page({
  data: {
    version: config.VERSION,
    appName: config.APP_NAME,
    stats: null,
    todayRemaining: 0,
    todayLimit: 20,
    showPrivacy: false,
    // 注销确认弹窗（自定义弹窗，替代 showModal editable——其 placeholder 在部分平台不消失）
    showLogoutConfirm: false,
    logoutInput: ''
  },

  onShow() {
    /**
     * 页面显示：加载统计
     * @returns {void}
     */
    this.load();
  },

  async load() {
    /**
     * 加载个人统计（失败静默，不打断浏览）
     * @returns {Promise<void>}
     */
    // 个人页数据加载失败不打断浏览，仅静默跳过
    try {
      const res = await util.callFunction('getAchievements');
      this.setData({
        stats: res.stats,
        todayRemaining: res.todayRemaining,
        // 每日限额以服务端为准（评审 2.4：不再硬编码 20）
        todayLimit: res.todayLimit || 20
      });
    } catch (e) {
      // 个人页数据加载失败不打断浏览
    }
  },

  openPrivacy() {
    /**
     * 打开隐私政策弹窗
     * @returns {void}
     */
    this.setData({ showPrivacy: true });
  },

  closePrivacy() {
    /**
     * 关闭隐私政策弹窗
     * @returns {void}
     */
    this.setData({ showPrivacy: false });
  },

  logoutAccount() {
    /**
     * 注销账号：说明确认 → 自定义弹窗输入确认词，删除全部个人数据（评审 1.3）
     * @returns {void}
     */
    // 注销是不可逆操作：第一层说明后果，第二层自定义弹窗输入「注销」确认
    wx.showModal({
      title: '注销账号',
      content: '注销后将删除你全部花卡、照片与识别记录，且不可恢复。\n注意：当日识别次数不会重置（防止恶意刷次数）。确定继续吗？',
      confirmText: '继续',
      confirmColor: '#c0392b',
      success: (r) => {
        if (!r.confirm) return;
        // 用页面内自定义弹窗替代 showModal editable：
        // 系统弹窗的 placeholder 在部分基础库/平台不随输入消失，需先删除才能输入
        this.setData({ showLogoutConfirm: true, logoutInput: '' });
      }
    });
  },

  onLogoutInput(e) {
    /**
     * 注销确认词输入同步
     * @param {Object} e - 输入事件，detail.value 为输入内容
     * @returns {void}
     */
    this.setData({ logoutInput: e.detail.value });
  },

  closeLogoutConfirm() {
    /**
     * 关闭注销确认弹窗（清空输入）
     * @returns {void}
     */
    this.setData({ showLogoutConfirm: false, logoutInput: '' });
  },

  async doLogout() {
    /**
     * 执行注销：校验确认词 → 调 deleteAccount
     * @returns {Promise<void>}
     */
    // 确认词必须完全匹配「注销」（按钮在匹配前也处于禁用态，双保险）
    if (this.data.logoutInput.trim() !== '注销') {
      util.showToast('请输入「注销」以确认');
      return;
    }
    wx.showLoading({ title: '注销中...', mask: true });
    try {
      await util.callFunction('deleteAccount');
      wx.hideLoading();
      this.setData({ showLogoutConfirm: false, logoutInput: '' });
      wx.showModal({
        title: '已注销',
        content: '你的全部数据已删除。随时可以重新开始收集。',
        showCancel: false,
        success: () => this.load()
      });
    } catch (e) {
      wx.hideLoading();
      util.showToast(e.message || '注销失败，请稍后重试');
    }
  },

  noop() {
    /**
     * 空事件处理：阻止弹窗内点击冒泡到遮罩
     * @returns {void}
     */
  }
});
