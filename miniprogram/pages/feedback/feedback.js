const util = require('../../utils/util');

// 反馈页：提交表单（类型/内容/截图）+ 我的历史反馈列表（分页）
Page({
  data: {
    // 反馈类型选项：三选一，key 与云函数 type 白名单一致
    types: [
      { key: 'suggestion', label: '体验建议', icon: '😊' },
      { key: 'bug', label: '问题反馈', icon: '🐞' },
      { key: 'other', label: '其他', icon: '💡' }
    ],
    type: 'suggestion', // 当前选中类型
    content: '',
    contentLen: 0,
    contentMax: 500,
    photoFileIDs: [], // 已上传截图 fileID 数组（≤3）
    photoTempPaths: [], // 本地临时路径（上传前预览用，上传成功后替换为 fileID 预览不可行，这里保留 tempPath 展示）
    submitting: false,
    list: [], // 我的历史反馈
    page: 1,
    hasMore: false,
    loadingList: false
  },

  onLoad() {
    /**
     * 页面加载：拉取历史反馈第一页
     * @returns {void}
     */
    this.loadList(true);
  },

  onTypeTap(e) {
    /**
     * 选择反馈类型（单选切换）
     * @param {Object} e - 事件对象，dataset.type 为类型 key
     * @returns {void}
     */
    this.setData({ type: e.currentTarget.dataset.type });
  },

  onContentInput(e) {
    /**
     * 反馈内容输入：同步内容与字数
     * @param {Object} e - 输入事件，detail.value 为输入内容
     * @returns {void}
     */
    const content = e.detail.value;
    this.setData({ content, contentLen: content.length });
  },

  choosePhotos() {
    /**
     * 选择截图：最多 3 张，选后上传云存储 feedback-photos/
     * @returns {void}
     */
    if (this.data.photoTempPaths.length >= 3) {
      util.showToast('最多上传 3 张截图');
      return;
    }
    wx.chooseMedia({
      count: 3 - this.data.photoTempPaths.length,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        // 逐张压缩上传到 feedback-photos/ 前缀（与用户照片 user-photos/ 隔离）
        const tasks = res.tempFiles.map((f) =>
          util.compressImage(f.tempFilePath).then((compressed) => {
            const ext = (compressed.match(/\.(\w+)$/) || [])[1] || 'jpg';
            const cloudPath = `feedback-photos/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
            return wx.cloud.uploadFile({ cloudPath, filePath: compressed }).then((u) => u.fileID);
          })
        );
        wx.showLoading({ title: '上传中', mask: true });
        Promise.all(tasks)
          .then((fileIDs) => {
            this.setData({
              photoTempPaths: this.data.photoTempPaths.concat(res.tempFiles.map((f) => f.tempFilePath)),
              photoFileIDs: this.data.photoFileIDs.concat(fileIDs)
            });
          })
          .catch(() => util.showToast('截图上传失败，请重试'))
          .finally(() => wx.hideLoading());
      }
    });
  },

  removePhoto(e) {
    /**
     * 删除已选截图（本地预览与已上传 fileID 同步移除）
     * @param {Object} e - 事件对象，dataset.index 为截图下标
     * @returns {void}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const temp = this.data.photoTempPaths.slice();
    const fids = this.data.photoFileIDs.slice();
    temp.splice(idx, 1);
    fids.splice(idx, 1);
    this.setData({ photoTempPaths: temp, photoFileIDs: fids });
  },

  async submit() {
    /**
     * 提交反馈：类型/内容校验 → submitFeedback → 成功后清空表单并刷新历史
     * @returns {Promise<void>}
     */
    const content = this.data.content.trim();
    if (!content) {
      util.showToast('请填写反馈内容');
      return;
    }
    if (this.data.submitting) return; // 防重复提交
    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中', mask: true });
    try {
      await util.callFunction('submitFeedback', {
        type: this.data.type,
        content,
        photoFileIDs: this.data.photoFileIDs
      });
      wx.hideLoading();
      util.showToast('感谢你的反馈！', 'success');
      this.setData({ content: '', contentLen: 0, photoTempPaths: [], photoFileIDs: [] });
      this.loadList(true); // 刷新历史
    } catch (e) {
      wx.hideLoading();
      util.showToast(e.message || '提交失败，请稍后重试');
    } finally {
      this.setData({ submitting: false });
    }
  },

  async loadList(reset) {
    /**
     * 加载我的历史反馈（分页倒序）
     * @param {boolean} reset - true 从第 1 页重新加载
     * @returns {Promise<void>}
     */
    if (this.data.loadingList) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loadingList: true });
    try {
      const res = await util.callFunction('getMyFeedback', { page });
      // 类型文案映射（历史记录展示用）
      const typeMap = { suggestion: '体验建议', bug: '问题反馈', other: '其他' };
      const mapped = (res.list || []).map((f) =>
        Object.assign({}, f, {
          typeLabel: typeMap[f.type] || '其他',
          timeText: f.createdAt ? util.formatDate(f.createdAt) : ''
        })
      );
      this.setData({
        list: reset ? mapped : this.data.list.concat(mapped),
        page: res.page || page,
        hasMore: !!res.hasMore,
        loadingList: false
      });
    } catch (e) {
      this.setData({ loadingList: false });
      // 历史加载失败静默，不打断表单操作
    }
  },

  onReachBottom() {
    /**
     * 触底加载下一页（onReachBottom 页面生命周期）
     * @returns {void}
     */
    if (this.data.hasMore) this.loadList(false);
  },

  previewPhoto(e) {
    /**
     * 预览历史反馈截图（wx.previewImage 支持 cloud:// fileID）
     * @param {Object} e - 事件对象，dataset.fileid 为截图 fileID
     * @returns {void}
     */
    const fileID = e.currentTarget.dataset.fileid;
    if (!fileID) return;
    wx.previewImage({ urls: [fileID], current: fileID });
  },

  onShareAppMessage() {
    /**
     * 转发分享（反馈页分享入口为小程序默认页）
     * @returns {Object} 分享配置
     */
    return { title: '意见反馈', path: '/pages/feedback/feedback' };
  }
});
