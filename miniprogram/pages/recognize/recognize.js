const util = require('../../utils/util');
const app = getApp();

// 识别页：上传照片 → 调用识别 → 候选确认/手动纠正 → 确认入库 → 成功展示
Page({
  data: {
    // phase: idle 待选图 / recognizing 识别中 / result 候选结果 / success 入库成功
    phase: 'idle',
    previewPath: '',
    candidates: [],
    selectedIndex: 0,
    hit: false,
    remaining: 0,
    limit: 20,
    resultMsg: '',
    photoFileID: '',
    successCard: null,
    showSearch: false,
    searchKeyword: '',
    searchResults: [],
    // 未收录花生成状态：genIndex 为正在生成的候选下标（-1 表示无）
    genIndex: -1
  },

  onLoad(options) {
    /**
     * 页面加载：若从首页带图进入则直接开始识别
     * @param {Object} options - 路由参数，tempPath 为本地图片路径
     * @returns {void}
     */
    if (options.tempPath) {
      const tempPath = decodeURIComponent(options.tempPath);
      this.setData({ previewPath: tempPath });
      this.runRecognize(tempPath);
    }
  },

  async runRecognize(tempPath) {
    /**
     * 执行识别：压缩上传 → 调用 recognizeFlower → 渲染候选
     * @param {string} tempPath - 本地图片路径
     * @returns {Promise<void>}
     */
    // 同图去重（评审 3.3）：60 秒内同一张本地图不重复识别，防误触浪费限流次数
    const now = Date.now();
    if (tempPath === this.data.lastPath && now - this.data.lastTime < 60000) {
      util.showToast('这张图刚识别过，换一张试试');
      this.setData({ phase: 'idle' });
      return;
    }

    // 核心识别流程：压缩上传 → recognizeFlower（MD5查重+限流+内容安全+百度识别+知识库匹配）
    wx.showLoading({ title: '识别中...', mask: true });
    this.setData({ phase: 'recognizing', resultMsg: '' });
    let fileID = '';
    try {
      fileID = await util.uploadImage(tempPath);
      const res = await util.callFunction('recognizeFlower', { fileID });
      if (res.duplicate) {
        // MD5 永久去重（方案 A）：命中历史指纹，未消耗限流次数，询问是否仍要识别
        const hit = res.hit || {};
        wx.hideLoading();
        wx.showModal({
          title: '这张照片识别过',
          content: hit.speciesId
            ? `你之前识别过这张照片（${hit.cnName || '花'}），今日不重复消耗识别次数。仍要识别吗？`
            : '这张照片之前识别过，今日不重复消耗识别次数。仍要识别吗？',
          confirmText: '仍要识别',
          cancelText: '取消',
          success: async (r) => {
            if (!r.confirm) {
              // 取消：清理本次上传的临时文件，避免孤儿图片
              if (fileID) await util.deleteCloudFile(fileID);
              this.setData({ phase: 'idle' });
              return;
            }
            wx.showLoading({ title: '识别中...', mask: true });
            try {
              // 用户确认：force=true 跳过查重，正常走识别链路（本次会消耗次数）
              const res2 = await util.callFunction('recognizeFlower', { fileID, force: true });
              this.handleRecognizeResult(res2, tempPath, now, fileID);
            } catch (e2) {
              if (fileID) await util.deleteCloudFile(fileID);
              this.setData({ phase: 'idle' });
              util.showToast(e2.message || '识别失败');
            } finally {
              wx.hideLoading();
            }
          }
        });
        return;
      }
      this.handleRecognizeResult(res, tempPath, now, fileID);
    } catch (e) {
      // 识别失败：清理已上传的文件，避免孤儿图片占用存储（评审 1.2）
      if (fileID) await util.deleteCloudFile(fileID);
      this.setData({ phase: 'idle', resultMsg: e.message || '识别失败' });
      wx.showModal({
        title: '识别失败',
        content: e.message || '请稍后重试',
        showCancel: false
      });
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 处理识别成功返回：候选渲染 + 记录去重状态
   * @param {Object} res - recognizeFlower 返回（duplicate 之外的正常结果）
   * @param {string} tempPath - 本地图片路径
   * @param {number} now - 本次识别时间戳
   * @param {string} fileID - 已上传的云存储 fileID
   * @returns {void}
   */
  handleRecognizeResult(res, tempPath, now, fileID) {
    // 候选预处理：标注低置信度（百度分数 <60%），提示用户人工核对
    const candidates = (res.candidates || []).map((c) =>
      Object.assign({}, c, {
        lowConfidence: typeof c.score === 'number' && c.score < 0.6
      })
    );
    // 默认选中第一个命中知识库的候选，避免用户选到未收录项
    const firstHit = candidates.findIndex((c) => c.species);
    this.setData({
      phase: 'result',
      photoFileID: fileID,
      candidates,
      hit: !!res.hit,
      remaining: res.remaining,
      limit: res.limit,
      selectedIndex: firstHit >= 0 ? firstHit : 0,
      resultMsg: candidates.length ? '' : '未识别出花朵，请换一张更清晰的照片试试',
      // 记录本次图片路径与时间，供 30 秒同图去重判断
      lastPath: tempPath,
      lastTime: now
    });
  },

  chooseNew() {
    /**
     * 重新选择照片（拍照或相册）
     * @returns {void}
     */
    util
      .chooseOneImage(['camera', 'album'])
      .then((tempPath) => {
        this.setData({ previewPath: tempPath, showSearch: false });
        this.runRecognize(tempPath);
      })
      .catch((err) => {
        // 用户取消不提示
        if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        util.showToast('无法打开相机/相册，请检查权限');
      });
  },

  onSelectCandidate(e) {
    /**
     * 切换选中的候选花种
     * @param {Object} e - 事件对象，dataset.index 为候选下标
     * @returns {void}
     */
    this.setData({ selectedIndex: Number(e.currentTarget.dataset.index) });
  },

  toggleSearch() {
    /**
     * 展开/收起手动搜索面板
     * @returns {void}
     */
    this.setData({
      showSearch: !this.data.showSearch,
      searchKeyword: '',
      searchResults: []
    });
  },

  async onSearchInput(e) {
    /**
     * 搜索输入：按中文名/别名过滤知识库（目录为空时自动补拉）
     * @param {Object} e - 输入事件，detail.value 为关键字
     * @returns {void}
     */
    // 手动纠正：按中文名/别名在知识库目录中搜索
    const kw = e.detail.value.trim();
    this.setData({ searchKeyword: kw });
    if (!kw) {
      this.setData({ searchResults: [] });
      return;
    }
    const list = await this.getCatalog();
    const results = list
      .filter(
        (s) =>
          (s.cnName || '').includes(kw) ||
          (s.synonyms || []).some((x) => x.includes(kw))
      )
      .slice(0, 10);
    this.setData({ searchResults: results });
  },

  async getCatalog() {
    /**
     * 获取知识库目录：优先用全局缓存；为空时主动拉取一次（评审 2.8）
     * @returns {Promise<Array>} 花种列表
     */
    if (app.globalData.catalog && app.globalData.catalog.length) {
      return app.globalData.catalog;
    }
    // 兜底：冷启动直进识别页（如分享链接）时全局缓存为空，拉一次全量目录并缓存
    try {
      const res = await util.callFunction('getCollection');
      if (res.list && res.list.length) {
        app.globalData.catalog = res.list;
        return res.list;
      }
    } catch (e) {
      console.warn('拉取知识库目录失败:', e);
    }
    // 最终兜底：仅用当前候选里已命中的花种
    return this.data.candidates.map((c) => c.species).filter(Boolean);
  },

  onSearchPick(e) {
    /**
     * 从搜索结果中选花种，置顶为第一候选
     * @param {Object} e - 事件对象，dataset.index 为搜索结果下标
     * @returns {void}
     */
    const sp = this.data.searchResults[Number(e.currentTarget.dataset.index)];
    if (!sp) return;
    const candidate = {
      name: sp.cnName,
      scoreText: '手动选择',
      lowConfidence: false,
      species: {
        _id: sp._id,
        cnName: sp.cnName,
        latinName: sp.latinName,
        family: sp.family,
        genus: sp.genus,
        rarity: sp.rarity,
        illustrationFileID: sp.illustrationFileID,
        description: sp.description,
        bloomSeasons: sp.bloomSeasons,
        colors: sp.colors
      }
    };
    const others = this.data.candidates.filter(
      (c) => c.species && c.species._id !== sp._id
    );
    this.setData({
      showSearch: false,
      candidates: [candidate].concat(others),
      selectedIndex: 0,
      hit: true
    });
  },

  async onGenerateTap(e) {
    /**
     * 未收录花生成入口：提交生成请求 → 进入轮询等待插画与科普生成完成
     * @param {Object} e - 事件对象，dataset.index 为候选下标
     * @returns {Promise<void>}
     */
    // 生成流程（未收录花自动生成方案）：请求建任务 → 轮询 → 完成后挂载花种到候选
    const idx = Number(e.currentTarget.dataset.index);
    const c = this.data.candidates[idx];
    if (!c || c.species) return;
    // 同一时间只允许一个生成任务，避免并发轮询混乱
    if (this.data.genIndex >= 0) {
      util.showToast('正在生成另一张花卡，请稍候');
      return;
    }
    wx.showLoading({ title: '提交生成请求' });
    try {
      const res = await util.callFunction('requestFlowerGenerate', {
        name: c.name,
        score: c.score,
        baikeDesc: c.baike && c.baike.description ? c.baike.description : ''
      });
      wx.hideLoading();
      if (res.alreadyExists && res.speciesId) {
        // 他人已生成过：直接取花种挂到候选，无需等待
        await this.attachSpecies(idx, res.speciesId);
        util.showToast('该花已在图鉴中，可直接确认入库', 'success');
        return;
      }
      // 进入生成中状态，开始轮询（约 1 分钟）
      this.setData({ genIndex: idx });
      util.showToast('已开始生成，约需 1 分钟');
      this.pollGenTask(res.taskId, idx);
    } catch (e) {
      wx.hideLoading();
      util.showToast(e.message || '提交失败');
    }
  },

  async attachSpecies(idx, speciesId) {
    /**
     * 把已入库的花种挂载到指定候选（生成完成/已存在时调用）
     * @param {number} idx - 候选下标
     * @param {string} speciesId - 花种 _id
     * @returns {Promise<void>}
     */
    const res = await util.callFunction('getCollection', { speciesId });
    const sp = res.list && res.list[0];
    if (!sp) throw new Error('未找到该花');
    const candidates = this.data.candidates.slice();
    const old = candidates[idx];
    candidates[idx] = {
      name: old.name,
      score: old.score,
      scoreText: '已生成',
      baike: old.baike,
      lowConfidence: false,
      species: {
        _id: sp._id,
        cnName: sp.cnName,
        latinName: sp.latinName,
        family: sp.family,
        genus: sp.genus,
        rarity: sp.rarity,
        illustrationFileID: sp.illustrationFileID,
        description: sp.description,
        bloomSeasons: sp.bloomSeasons,
        colors: sp.colors,
        aiGenerated: sp.aiGenerated
      }
    };
    this.setData({ candidates, selectedIndex: idx, hit: true });
  },

  pollGenTask(taskId, idx) {
    /**
     * 轮询生成任务状态（每 4s，最多 45 次约 3 分钟）
     * @param {string} taskId - 生成任务 id
     * @param {number} idx - 候选下标
     * @returns {void}
     */
    this._genAttempts = 0;
    this.stopGenPolling();
    this._genTimer = setInterval(async () => {
      this._genAttempts++;
      // 超时兜底：任务仍在后台执行，提示用户稍后图鉴查看
      if (this._genAttempts > 45) {
        this.stopGenPolling();
        this.setData({ genIndex: -1 });
        util.showToast('生成较慢，稍后请在图鉴查看该花');
        return;
      }
      try {
        const res = await util.callFunction('getFlowerGenerateTask', { taskId });
        const t = res.task || {};
        if (t.status === 'done' && t.speciesId) {
          this.stopGenPolling();
          await this.attachSpecies(idx, t.speciesId);
          this.setData({ genIndex: -1 });
          util.showToast('花卡生成完成，可确认入库', 'success');
        } else if (t.status === 'failed') {
          this.stopGenPolling();
          this.setData({ genIndex: -1 });
          wx.showModal({
            title: '生成失败',
            content: t.error || '生成失败，请稍后重试',
            showCancel: false
          });
        }
        // pending/generating：继续等待
      } catch (e) {
        // 任务不存在/无权限：任务可能未创建成功，停止轮询并提示（避免傻等 3 分钟）
        if (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN' || e.code === 'BAD_PARAM') {
          this.stopGenPolling();
          this.setData({ genIndex: -1 });
          util.showToast('生成任务未找到，请重新识别后再试');
        }
        // 其余单次轮询失败忽略，下次继续
      }
    }, 4000);
  },

  stopGenPolling() {
    /**
     * 停止生成任务轮询
     * @returns {void}
     */
    if (this._genTimer) {
      clearInterval(this._genTimer);
      this._genTimer = null;
    }
  },

  onUnload() {
    /**
     * 页面卸载：清理轮询定时器，防止后台继续请求
     * @returns {void}
     */
    this.stopGenPolling();
  },

  async confirmSave() {
    /**
     * 确认入库：saveCard create，返回成功态
     * @returns {Promise<void>}
     */
    // 用户确认后入库：saveCard create，已收集过则自动转为追加照片
    const c = this.data.candidates[this.data.selectedIndex];
    if (!c || !c.species) {
      util.showToast('请先选择一个花种');
      return;
    }
    wx.showLoading({ title: '收录中...', mask: true });
    try {
      const res = await util.callFunction('saveCard', {
        action: 'create',
        speciesId: c.species._id,
        photoFileID: this.data.photoFileID
      });
      this.setData({
        phase: 'success',
        successCard: Object.assign({}, c.species, {
          meetCount: res.meetCount,
          newCard: res.newCard
        })
      });
    } catch (e) {
      util.showToast(e.message || '保存失败');
    } finally {
      wx.hideLoading();
    }
  },

  viewCard() {
    /**
     * 成功页跳转花卡详情
     * @returns {void}
     */
    const sp = this.data.successCard;
    if (!sp) return;
    wx.navigateTo({ url: `/pages/detail/detail?speciesId=${sp._id}` });
  },

  again() {
    /**
     * 重置页面状态，准备识别下一株花
     * @returns {void}
     */
    // 同时停止生成轮询，避免残留定时器
    this.stopGenPolling();
    this.setData({
      phase: 'idle',
      previewPath: '',
      photoFileID: '',
      candidates: [],
      successCard: null,
      resultMsg: '',
      genIndex: -1
    });
  },

  saveToAlbum() {
    /**
     * 把原图保存到系统相册（未收录时兜底）
     * @returns {void}
     */
    // 未收录/识别失败时仍可把原图保存到系统相册
    if (!this.data.previewPath) {
      util.showToast('没有可保存的照片');
      return;
    }
    wx.saveImageToPhotosAlbum({
      path: this.data.previewPath,
      success: () => util.showToast('已保存到相册', 'success'),
      fail: () =>
        wx.showModal({
          title: '保存失败',
          content: '请在设置中允许保存图片到相册',
          showCancel: false
        })
    });
  }
});
