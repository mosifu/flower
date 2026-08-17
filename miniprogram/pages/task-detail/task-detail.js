const util = require('../../utils/util');

// 识别任务详情页（三态）：identified 已识别未入库（识别结果界面+确认入库）/ processing 识别中 / done 查看结果
Page({
  data: {
    taskId: '',
    batchName: '',
    status: '',         // identified / pending / processing / done / partial / failed
    items: [],          // 任务照片（identified 含全部候选；processing/done 含入库状态）
    loading: true,
    showResult: false,  // 是否展示识花结果（swiper 已收录花）
    successCards: [],   // 已收录成功的花（识花结果 swiper）
    successIndex: 0,
    pendingCount: 0,   // 仍在入库中的花数量
    locking: false     // identified 确认入库中（防重复）
  },

  onLoad(options) {
    /**
     * 页面加载：记录任务 id，拉取详情；非终态任务 5s 轮询
     * @param {Object} options - 路由参数，taskId 为任务 id
     * @returns {void}
     */
    this.setData({ taskId: options.taskId || '' });
    this.load();
    this._pollTimer = setInterval(() => {
      const st = this.data.status;
      if (['done', 'partial', 'failed'].includes(st)) {
        clearInterval(this._pollTimer);
        return;
      }
      this.load();
    }, 5000);
  },

  onUnload() {
    /**
     * 页面卸载：清理轮询
     * @returns {void}
     */
    if (this._pollTimer) clearInterval(this._pollTimer);
  },

  async load() {
    /**
     * 加载任务详情：按状态组装 items（identified 保留候选；processing/done 显示入库状态）
     * @returns {Promise<void>}
     */
    if (!this.data.taskId) return;
    try {
      const res = await util.callFunction('getBatchTask', { taskId: this.data.taskId });
      const t = res.task || {};
      const items = (t.items || []).map((it) => {
        let statusText = '生产中';
        let statusClass = 'task-item-generating';
        if (it.itemStatus === 'done') { statusText = '已完成'; statusClass = 'task-item-done'; }
        else if (it.itemStatus === 'fail') { statusText = '失败'; statusClass = 'task-item-fail'; }
        else if (it.itemStatus === 'nonPlant') { statusText = '未识别出花朵'; statusClass = 'task-item-fail'; }
        else if (it.itemStatus === 'duplicate') { statusText = '重复照片'; statusClass = 'task-item-fail'; }
        else if (it.itemStatus === 'incomplete') { statusText = '识别未完成'; statusClass = 'task-item-fail'; }
        else if (t.status === 'identified') { statusText = '待确认'; statusClass = 'task-item-generating'; }
        return Object.assign({}, it, {
          statusText,
          statusClass,
          // 当前选中候选（identified 显示用）
          currentCandidate: (it.candidates || [])[Number(it.selectedIndex) || 0] || null
        });
      });
      const doneCount = items.filter((x) => x.itemStatus === 'done').length;
      const pendingCount = items.filter((x) => !['done', 'fail'].includes(x.itemStatus)).length;
      this.setData({
        batchName: t.batchName || '',
        items,
        status: t.status || '',
        pendingCount,
        loading: false
      });
      // 终态/识别中：计算 successCards（识花结果）
      if (t.status !== 'identified') {
        this.buildSuccessCards(items);
      }
    } catch (e) {
      this.setData({ loading: false });
      util.showToast(e.message || '加载失败');
    }
  },

  async buildSuccessCards(items) {
    /**
     * 计算已收录成功花（识花结果 swiper），补拉花名
     * @param {Array} items - 任务照片
     * @returns {Promise<void>}
     */
    const doneItems = items.filter((x) => x.itemStatus === 'done' && x.speciesId);
    const cards = [];
    for (const x of doneItems) {
      try {
        const spRes = await util.callFunction('getCollection', { speciesId: x.speciesId });
        const sp = spRes.list && spRes.list[0];
        cards.push({
          speciesId: x.speciesId,
          cnName: (sp && sp.cnName) || '已收录',
          latinName: (sp && sp.latinName) || '',
          rarity: (sp && sp.rarity) || 'common',
          illustrationFileID: (sp && sp.illustrationFileID) || '',
          meetCount: x.meetCount,
          newCard: x.newCard
        });
      } catch (err) {
        cards.push({ speciesId: x.speciesId, cnName: '已收录', rarity: 'common', meetCount: x.meetCount });
      }
    }
    this.setData({ successCards: cards });
  },

  // ---- identified 三态操作 ----

  selectCandidate(e) {
    /**
     * identified 识别结果界面：切换某张的候选（单选）
     * @param {Object} e - 事件对象，dataset.index 照片下标，dataset.cindex 候选下标
     * @returns {void}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const cidx = Number(e.currentTarget.dataset.cindex);
    const items = this.data.items.slice();
    const it = items[idx];
    if (!it || !(it.candidates || [])[cidx]) return;
    it.selectedIndex = cidx;
    it.currentCandidate = it.candidates[cidx];
    this.setData({ items });
  },

  async confirmIdentify() {
    /**
     * identified 确认入库：锁定选中项 → 任务转 pending（后台生成/入库）→ 切识别中界面
     * @returns {Promise<void>}
     */
    if (this.data.locking) return;
    // 锁定 items：只存每张选中候选（identified 阶段存全部候选，确认后锁定）
    const items = this.data.items.map((it) => {
      const c = it.currentCandidate || null;
      if (it.itemStatus === 'nonPlant' || it.itemStatus === 'duplicate' || it.itemStatus === 'fail' || it.itemStatus === 'incomplete') {
        return { fileID: it.fileID, itemStatus: it.itemStatus, failMsg: it.failMsg || '' };
      }
      return {
        fileID: it.fileID,
        speciesId: c && c.species ? c.species._id : '',
        name: c && !c.species ? c.name : '',
        score: c && !c.species ? c.score : 0,
        baikeDesc: c && c.baike && c.baike.description ? c.baike.description : ''
      };
    });
    this.setData({ locking: true });
    wx.showLoading({ title: '提交任务', mask: true });
    try {
      await util.callFunction('updateBatchTask', { taskId: this.data.taskId, action: 'lock', items });
      wx.hideLoading();
      this.setData({ status: 'processing', locking: false, showResult: false });
      this.load(); // 立即刷新为识别中界面
      util.showToast('已开始入库，可在任务中查看进度', 'success');
    } catch (err) {
      wx.hideLoading();
      this.setData({ locking: false });
      util.showToast(err.message || '提交失败');
    }
  },

  // ---- 查看结果 ----

  viewResult() {
    /**
     * 查看识花结果：有花已入库即可查看；未完成的花提示继续入库中
     * @returns {void}
     */
    const done = this.data.successCards;
    if (!done.length) {
      util.showToast('还没有花完成入库');
      return;
    }
    const pending = this.data.pendingCount;
    const openResult = () => this.setData({ showResult: true, successIndex: 0 });
    if (pending > 0) {
      wx.showModal({
        title: '查看识花结果',
        content: `还有 ${pending} 朵花在入库中，已收录的花可先查看。确定查看吗？`,
        confirmText: '查看',
        success: (r) => { if (r.confirm) openResult(); }
      });
    } else {
      openResult();
    }
  },

  onSuccessChange(e) {
    /**
     * 识花结果 swiper 切换
     * @param {Object} e - 事件对象，e.detail.current 为当前下标
     * @returns {void}
     */
    this.setData({ successIndex: e.detail.current });
  },

  backToList() {
    /**
     * 返回任务列表
     * @returns {void}
     */
    wx.navigateBack();
  }
});
