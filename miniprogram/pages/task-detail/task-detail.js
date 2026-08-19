const util = require('../../utils/util');

// 识别任务详情页（三态）：identified 已识别未入库（识别结果界面同款三列布局 + 花名详情弹窗 + 确认入库）/ processing 识别中 / done 查看结果
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
    locking: false,    // identified 确认入库中（防重复）
    showFlowerInfo: false, // 花信息弹窗显示（点击候选花名查看详情，与识别结果界面一致）
    flowerInfo: null       // 弹窗中的花详情（候选项内 baike/species 组装）
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
        // 识别结果界面同款展示字段：候选数组归一 + 当前选中候选（确认入库/花名弹窗用）；
        // 各状态文案与提示区均由 WXML 按 itemStatus/candidates 动态渲染（与识别结果页一致）
        const candidates = Array.isArray(it.candidates) ? it.candidates : [];
        // selectedIndex 归一并夹取到候选范围内（脏数据防御：越界会导致提示区/弹窗取不到候选）
        const selectedIndex = Math.min(Number(it.selectedIndex) || 0, Math.max(candidates.length - 1, 0));
        return Object.assign({}, it, {
          candidates,
          selectedIndex,
          currentCandidate: candidates[selectedIndex] || null
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
     * identified 识别结果界面：点击候选行仅切换选中（单选互斥），不弹窗（与识别结果界面一致）
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
    // 切换候选后同步任务（identified 阶段可编辑，实时同步）
    this.syncTask();
  },

  onItemFlowerNameTap(e) {
    /**
     * 点击候选花名：弹窗展示该候选的百科描述（与识别结果界面一致，catchtap 不触发整行选中）
     * @param {Object} e - 事件对象，dataset.index 照片下标，dataset.cindex 候选下标
     * @returns {void}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const cidx = Number(e.currentTarget.dataset.cindex);
    const it = this.data.items[idx];
    const c = it && it.candidates && it.candidates[cidx];
    if (!c) return;
    // 描述优先级：百度百科描述（baike）-> 已收录花知识库简介（species.description）-> 兜底文案
    const desc =
      (c.baike && c.baike.description) ||
      (c.species && c.species.description) ||
      (c.species ? '暂无简介' : '该花暂未收录图鉴，识别结果仅供参考');
    this.setData({
      flowerInfo: { cnName: c.species ? c.species.cnName : c.name, description: desc },
      showFlowerInfo: true
    });
  },

  closeFlowerInfo() {
    /**
     * 关闭花信息弹窗
     * @returns {void}
     */
    this.setData({ showFlowerInfo: false, flowerInfo: null });
  },

  noop() {
    /**
     * 空事件处理：阻止弹窗内点击冒泡到遮罩
     * @returns {void}
     */
  },

  async syncTask() {
    /**
     * 同步 identified 任务内容（与识别结果界面编辑一致：候选切换/重传/删除后调用）
     * @returns {Promise<void>}
     */
    // 组装 identified items：保留全部候选（用户仍可操作）
    const items = this.data.items.map((it) => ({
      fileID: it.fileID || '',
      itemStatus: it.itemStatus || 'identified',
      candidates: (it.candidates || []).map((c) => ({
        name: c.name,
        score: c.score,
        scoreText: c.scoreText,
        species: c.species || null,
        baike: c.baike || null
      })),
      selectedIndex: Number(it.selectedIndex) || 0,
      failMsg: it.failMsg || ''
    }));
    try {
      await util.callFunction('updateBatchTask', { taskId: this.data.taskId, action: 'sync', items });
    } catch (e) {
      console.warn('同步识别任务失败:', e);
    }
  },

  async onItemReupload(e) {
    /**
     * identified 界面「重新上传」：重复照片/非植物 重传一张新照片 → 上传识别 → 更新该 item 并同步
     * @param {Object} e - 事件对象，dataset.index 为照片下标
     * @returns {void}
     */
    const idx = Number(e.currentTarget.dataset.index);
    try {
      const tempPath = await util.chooseOneImage(['camera', 'album']);
      wx.showLoading({ title: '识别中...', mask: true });
      try {
        // 上传新照片 → 识别（async/await 确保 fileID 在作用域内）
        const fileID = await util.uploadImage(tempPath);
        const res = await util.callFunction('recognizeFlower', { fileID });
        wx.hideLoading();
        if (res.duplicate) {
          // 新照片仍重复：标记重复（保留新 fileID 供继续识别用）
          this.updateItemFromResult(idx, null, fileID, true);
          return;
        }
        this.updateItemFromResult(idx, res, fileID, false);
      } catch (err) {
        wx.hideLoading();
        util.showToast(err.message || '识别失败');
      }
    } catch (err) {
      // 用户取消不提示
      if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
      util.showToast('无法打开相机/相册，请检查权限');
    }
  },

  onItemRetryDuplicate(e) {
    /**
     * identified 界面「继续识别」：重复照片 force 跳过 MD5 查重 → 正常识别 → 更新该 item 并同步
     * @param {Object} e - 事件对象，dataset.index 为照片下标
     * @returns {void}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const it = this.data.items[idx];
    if (!it || !it.fileID) return;
    wx.showModal({
      title: '继续识别',
      content: '这张照片之前识别过，继续识别会消耗 1 次今日识别次数。确定继续吗？',
      confirmText: '继续识别',
      cancelText: '取消',
      success: (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '识别中...', mask: true });
        util
          .callFunction('recognizeFlower', { fileID: it.fileID, force: true })
          .then((res) => {
            wx.hideLoading();
            this.updateItemFromResult(idx, res, it.fileID);
          })
          .catch((err) => {
            wx.hideLoading();
            util.showToast(err.message || '识别失败');
          });
      }
    });
  },

  onItemRemove(e) {
    /**
     * identified 界面「删除」：从任务中移除该照片（重复/非植物可删）并同步
     * @param {Object} e - 事件对象，dataset.index 为照片下标
     * @returns {void}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const items = this.data.items.slice();
    const it = items[idx];
    if (!it) return;
    if (it.fileID) util.deleteCloudFile(it.fileID); // 清理已上传临时文件
    items.splice(idx, 1);
    this.setData({ items });
    util.showToast('已删除', 'success');
    this.syncTask();
  },

  updateItemFromResult(idx, res, fileID, isDuplicate) {
    /**
     * 用识别结果更新某 item（重传/继续识别后）：更新候选/状态并同步任务
     * @param {number} idx - 照片下标
     * @param {Object} res - recognizeFlower 返回（duplicate 时为 null）
     * @param {string} fileID - 照片云存储
     * @param {boolean} isDuplicate - 是否仍重复
     * @returns {void}
     */
    const items = this.data.items.slice();
    const it = items[idx];
    if (!it) return;
    if (isDuplicate || (res && res.duplicate)) {
      items[idx] = Object.assign({}, it, {
        fileID: fileID || it.fileID,
        itemStatus: 'duplicate',
        candidates: [],
        selectedIndex: 0,
        currentCandidate: null,
        failMsg: '这张照片之前识别过'
      });
    } else if (res) {
      // 非植物判定：未命中且候选均无 species
      const candidates = (res.candidates || []).map((c) =>
        Object.assign({}, c, { lowConfidence: typeof c.score === 'number' && c.score < 0.6 })
      );
      const isNonPlant = !res.hit && !candidates.some((c) => c.species);
      items[idx] = Object.assign({}, it, {
        fileID: fileID || it.fileID,
        itemStatus: isNonPlant ? 'nonPlant' : 'identified',
        candidates,
        selectedIndex: 0,
        currentCandidate: candidates[0] || null,
        failMsg: isNonPlant ? '暂未识别出花朵' : ''
      });
    }
    this.setData({ items });
    this.syncTask();
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

  previewItemPhoto(e) {
    /**
     * 预览任务照片（cloud:// fileID 全屏预览）
     * @param {Object} e - 事件对象，dataset.fileid 为照片 fileID
     * @returns {void}
     */
    const fileID = e.currentTarget.dataset.fileid;
    if (!fileID) return;
    wx.previewImage({ urls: [fileID], current: fileID });
  },

  backToList() {
    /**
     * 返回任务列表
     * @returns {void}
     */
    wx.navigateBack();
  }
});
