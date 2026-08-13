const util = require('../../utils/util');

// 花卡详情页：水彩卡头 + 拍摄照片管理 + 备注 + 科普档案
Page({
  data: {
    loading: true,
    sp: null,
    showNoteModal: false,
    noteDraft: '',
    showLocationModal: false,
    locationDraft: ''
  },

  onLoad(options) {
    /**
     * 页面加载：读取路由中的花种 id
     * @param {Object} options - 路由参数，speciesId 为花种 id
     * @returns {void}
     */
    this.speciesId = options.speciesId;
    this.load();
  },

  async load() {
    /**
     * 加载花种详情（含用户收集状态）
     * @returns {Promise<void>}
     */
    // 单查该花种并合并用户收集状态；未收集也可查看公开科普
    wx.showLoading({ title: '加载中' });
    try {
      const res = await util.callFunction('getCollection', { speciesId: this.speciesId });
      const sp = res.list[0];
      if (!sp) {
        throw new Error('未找到该花');
      }
      this.setData({
        loading: false,
        sp: Object.assign({}, sp, {
          rarityLabel: util.rarityInfo(sp.rarity).label,
          firstMetAtText: util.formatDate(sp.firstMetAt),
          lastMetAtText: util.formatDate(sp.lastMetAt)
        })
      });
    } catch (e) {
      util.showToast(e.message || '加载失败');
    }
    wx.hideLoading();
  },

  addPhoto() {
    /**
     * 为已收集花卡追加照片
     * @returns {void}
     */
    // 为已收集花卡追加一张照片（走 saveCard addPhoto，meetCount 也会 +1；服务端做内容安全检测）
    util
      .chooseOneImage(['album', 'camera'])
      .then(async (tempPath) => {
        wx.showLoading({ title: '上传中', mask: true });
        try {
          const fileID = await util.uploadImage(tempPath);
          await util.callFunction('saveCard', {
            action: 'addPhoto',
            speciesId: this.speciesId,
            photoFileID: fileID
          });
          await this.load();
          util.showToast('已添加', 'success');
        } catch (e) {
          util.showToast(e.message || '添加失败');
        }
        wx.hideLoading();
      })
      .catch((err) => {
        // 用户取消不提示
        if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        util.showToast('无法打开相机/相册，请检查权限');
      });
  },

  onPreviewPhoto(e) {
    /**
     * 全屏预览拍摄照片
     * @param {Object} e - 事件对象，dataset.index 为照片下标
     * @returns {void}
     */
    const urls = this.data.sp.photos.map((p) => p.fileID);
    wx.previewImage({
      urls,
      current: urls[Number(e.currentTarget.dataset.index)]
    });
  },

  onDeletePhoto(e) {
    /**
     * 删除指定照片（二次确认）
     * @param {Object} e - 事件对象，dataset.index 为照片下标
     * @returns {void}
     */
    // 删除单张照片，删除前二次确认
    const idx = Number(e.currentTarget.dataset.index);
    wx.showModal({
      title: '删除照片',
      content: '确定删除这张照片吗？',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await util.callFunction('saveCard', {
            action: 'deletePhoto',
            speciesId: this.speciesId,
            photoIndex: idx
          });
          await this.load();
        } catch (e) {
          util.showToast(e.message || '删除失败');
        }
      }
    });
  },

  openNoteModal() {
    /**
     * 打开备注编辑弹窗
     * @returns {void}
     */
    this.setData({
      showNoteModal: true,
      noteDraft: (this.data.sp && this.data.sp.note) || ''
    });
  },

  closeNoteModal() {
    /**
     * 关闭备注编辑弹窗
     * @returns {void}
     */
    this.setData({ showNoteModal: false });
  },

  onNoteInput(e) {
    /**
     * 备注输入同步
     * @param {Object} e - 输入事件，detail.value 为备注内容
     * @returns {void}
     */
    this.setData({ noteDraft: e.detail.value });
  },

  async saveNote() {
    /**
     * 保存备注到云端
     * @returns {Promise<void>}
     */
    // 保存卡片级备注
    try {
      await util.callFunction('saveCard', {
        action: 'updateNote',
        speciesId: this.speciesId,
        note: this.data.noteDraft
      });
      this.setData({ showNoteModal: false });
      await this.load();
    } catch (e) {
      util.showToast(e.message || '保存失败');
    }
  },

  openLocationModal() {
    /**
     * 打开地点编辑弹窗
     * @returns {void}
     */
    this.setData({
      showLocationModal: true,
      locationDraft: (this.data.sp && this.data.sp.location) || ''
    });
  },

  closeLocationModal() {
    /**
     * 关闭地点编辑弹窗
     * @returns {void}
     */
    this.setData({ showLocationModal: false });
  },

  onLocationInput(e) {
    /**
     * 地点输入同步
     * @param {Object} e - 输入事件，detail.value 为地点内容
     * @returns {void}
     */
    this.setData({ locationDraft: e.detail.value });
  },

  async saveLocation() {
    /**
     * 保存地点到云端（评审 2.9：落地 updateLocation 前端入口）
     * @returns {Promise<void>}
     */
    // 保存卡片级地点（如「小区后山」「玄武湖」），供卡片与未来地域图鉴使用
    try {
      await util.callFunction('saveCard', {
        action: 'updateLocation',
        speciesId: this.speciesId,
        location: this.data.locationDraft
      });
      this.setData({ showLocationModal: false });
      await this.load();
    } catch (e) {
      util.showToast(e.message || '保存失败');
    }
  },

  deleteCard() {
    /**
     * 删除整张花卡（二次确认）
     * @returns {void}
     */
    // 删除整卡：图鉴、等级、徽章由服务端实时重算；云端照片一并清理
    wx.showModal({
      title: '删除花卡',
      content: '删除后将从图鉴中移除，云端照片也会一并删除，确认删除吗？',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await util.callFunction('saveCard', {
            action: 'deleteCard',
            speciesId: this.speciesId
          });
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 600);
        } catch (e) {
          util.showToast(e.message || '删除失败');
        }
      }
    });
  },

  previewIllustration() {
    /**
     * 插画全屏预览：长按可保存到相册（与拍摄记录交互一致）
     * @returns {void}
     */
    const sp = this.data.sp;
    if (!sp || !sp.illustrationFileID) return;
    // 预览组件内自带长按保存，无需独立下载按钮（避免破坏插画观感）
    wx.previewImage({
      urls: [sp.illustrationFileID],
      current: sp.illustrationFileID
    });
  },

  onShareAppMessage() {
    /**
     * 转发分享花卡
     * @returns {Object} 分享配置
     */
    const sp = this.data.sp;
    return {
      title: sp ? `我在花知道收集了「${sp.cnName}」🌸` : '随心一拍，路边的花一拍就知道',
      path: `/pages/detail/detail?speciesId=${this.speciesId}`
    };
  },

  goRecognize() {
    /**
     * 未收集状态引导跳首页识花
     * @returns {void}
     */
    wx.switchTab({ url: '/pages/index/index' });
  },

  noop() {
    /**
     * 空事件处理：阻止弹窗内点击冒泡到遮罩
     * @returns {void}
     */
    // 阻止事件冒泡
  }
});
