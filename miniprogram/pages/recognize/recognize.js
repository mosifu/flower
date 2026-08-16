const util = require('../../utils/util');
const app = getApp();

// 识别页：上传照片 → 调用识别 → 候选确认/手动纠正 → 确认入库 → 成功展示
Page({
  data: {
    // phase: idle 待选图 / recognizing 识别中 / result 候选结果 / success 入库成功
    //        batch 批量识别中 / batch_result 批量清单确认（批量识别方案）
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
    successCards: [],      // 批量入库成功后展示的多花数组（success 页 swiper 切换）
    successIndex: 0,      // success 页当前展示的花下标
    showSearch: false,
    searchKeyword: '',
    searchResults: [],
    // 未收录花生成状态：genIndex 为正在生成的候选下标（-1 表示无）
    genIndex: -1,
    // ---- 批量识别（相册多选 ≤5 张，逐张串行）----
    batchList: [],      // 批量结果清单，每项见 runBatchRecognize 注释
    batchIndex: 0,      // 当前正在识别的张下标（进度显示用）
    batchTotal: 0,      // 批量总张数
    batchExpand: -1,    // 清单中展开候选切换的张下标（-1 无）
    batchGenIndex: -1,  // 批量中正在生成未收录花的张下标（-1 无）
    batchConfirming: false, // 批量确认入库中（防重复提交）
    showFlowerInfo: false, // 花信息弹窗显示（批量清单点击识别结果核对用）
    flowerInfo: null       // 弹窗中的花详情（getCollection 拉取）
  },

  onLoad(options) {
    /**
     * 页面加载：若从首页带图进入则直接开始识别（单图 tempPath / 多图 tempPaths）
     * @param {Object} options - 路由参数，tempPath 单图路径 或 tempPaths 多图路径数组（逗号分隔编码）
     * @returns {void}
     */
    // 批量识别：首页多选相册传入 tempPaths（逗号分隔），走逐张串行批量流程
    if (options.tempPaths) {
      const paths = decodeURIComponent(options.tempPaths)
        .split(',')
        .filter(Boolean);
      if (paths.length > 1) {
        this.runBatchRecognize(paths);
        return;
      }
      // 只有 1 张也走批量（复用同一逻辑，清单确认单张）
      this.runBatchRecognize(paths);
      return;
    }
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
      // 批量重试失败：标记回清单，不打断批量流程
      if (this._batchRetryIndex !== undefined && this._batchRetryIndex >= 0) {
        const idx = this._batchRetryIndex;
        this._batchRetryIndex = -1;
        const list = this.data.batchList.slice();
        list[idx] = Object.assign({}, list[idx], {
          status: 'fail',
          failMsg: e.message || '识别失败',
          fileID: ''
        });
        this.setData({ phase: 'batch_result', batchList: list });
        wx.hideLoading();
        util.showToast(e.message || '识别失败');
        return;
      }
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

  async runBatchRecognize(tempPaths) {
    /**
     * 批量识别：逐张串行（压缩上传 → recognizeFlower），失败跳过标记，全部完成后进清单确认
     * @param {string[]} tempPaths - 多张本地图片路径数组
     * @returns {Promise<void>}
     */
    // 批量识别方案：云函数 20s 超时限制，单次调用只能处理 1 张，故逐张串行调用
    this.stopGenPolling();
    // 初始化批量清单：全部置 fail 占位，识别成功逐项更新为 ok
    const batchList = tempPaths.map((p, i) => ({
      index: i,
      tempPath: p,
      fileID: '',
      status: 'fail',
      failMsg: '',
      candidates: [],
      selectedIndex: 0,
      hit: false,
      confirmed: false,
      meetCount: 0,
      newCard: false,
      genState: 'none', // 未收录花生成状态：none / generating / done / failed / no_quota
      speciesId: '',
      duplicate: false,
      dupName: '',
      saveState: 'idle' // 入库进度：idle 待处理 / saving 入库中 / done 成功 / fail 失败
    }));
    this.setData({
      phase: 'batch',
      batchList,
      batchTotal: tempPaths.length,
      batchIndex: 0,
      batchExpand: -1,
      batchGenIndex: -1,
      batchConfirming: false
    });

    // 逐张串行：每张独立上传+识别，失败跳过继续下一张
    for (let i = 0; i < tempPaths.length; i++) {
      this.setData({ batchIndex: i });
      let fileID = '';
      try {
        fileID = await util.uploadImage(tempPaths[i]);
        const res = await util.callFunction('recognizeFlower', { fileID });
        if (res.duplicate) {
          // MD5 重复：批量中不弹窗打断，标记重复并跳过（不消耗次数）
          const hit = res.hit || {};
          const list = this.data.batchList.slice();
          list[i] = Object.assign({}, list[i], {
            status: 'fail',
            failMsg: '这张照片之前识别过',
            duplicate: true,
            dupName: hit.cnName || '',
            fileID
          });
          this.setData({ batchList: list });
          continue;
        }
        this.handleBatchResult(i, res, fileID);
      } catch (e) {
        // 识别失败：清理已上传文件（评审 1.2），标记失败继续下一张
        if (fileID) await util.deleteCloudFile(fileID);
        const list = this.data.batchList.slice();
        list[i] = Object.assign({}, list[i], {
          status: 'fail',
          failMsg: e.message || '识别失败',
          fileID: ''
        });
        this.setData({ batchList: list });
      }
    }
    // 全部处理完：进入清单确认
    this.setData({
      phase: 'batch_result',
      remaining: (this.data.remaining >= 0) ? this.data.remaining : 0
    });
  },

  handleBatchResult(i, res, fileID) {
    /**
     * 批量中单张识别成功：候选预处理后写入 batchList[i]
     * @param {number} i - 批量下标
     * @param {Object} res - recognizeFlower 正常返回
     * @param {string} fileID - 已上传云存储 fileID
     * @returns {void}
     */
    // 候选预处理与单图一致：标注低置信度（百度分数 <60%）；
    // 默认选中置信度最高候选（candidates[0]，百度按置信度降序返回），不因未收录而跳选已收录项
    const candidates = (res.candidates || []).map((c) =>
      Object.assign({}, c, {
        lowConfidence: typeof c.score === 'number' && c.score < 0.6
      })
    );
    const list = this.data.batchList.slice();
    list[i] = Object.assign({}, list[i], {
      status: 'ok',
      failMsg: '',
      fileID,
      candidates,
      selectedIndex: 0,
      hit: !!res.hit,
      remaining: res.remaining,
      limit: res.limit,
      duplicate: false,
      dupName: ''
    });
    this.setData({
      batchList: list,
      remaining: res.remaining,
      limit: res.limit
    });
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
    // 批量重试回填：从清单发起重试时（_batchRetryIndex 有效），结果写回 batchList 并回清单
    if (this._batchRetryIndex !== undefined && this._batchRetryIndex >= 0) {
      const idx = this._batchRetryIndex;
      this._batchRetryIndex = -1;
      const firstHit = candidates.findIndex((c) => c.species);
      const list = this.data.batchList.slice();
      list[idx] = Object.assign({}, list[idx], {
        status: 'ok',
        failMsg: '',
        fileID,
        candidates,
        selectedIndex: firstHit >= 0 ? firstHit : 0,
        hit: !!res.hit,
        remaining: res.remaining,
        limit: res.limit,
        duplicate: false,
        dupName: ''
      });
      this.setData({
        phase: 'batch_result',
        batchList: list,
        remaining: res.remaining,
        limit: res.limit
      });
      return;
    }
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

  async onBatchGenerateTap(e) {
    /**
     * 批量清单中触发未收录花生成（串行：同一时间只 1 个生成任务）
     * @param {Object} e - 事件对象，dataset.index 为批量下标
     * @returns {Promise<void>}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const item = this.data.batchList[idx];
    if (!item) return;
    const c = item.candidates && item.candidates[item.selectedIndex];
    if (!c || c.species) return;
    // 串行锁：批量中同一时间只允许一个生成任务（沿用单图 genIndex 思路）
    if (this.data.batchGenIndex >= 0) {
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
        // 他人已生成过：直接挂花种到清单，无需等待
        await this.attachSpeciesToBatch(idx, res.speciesId);
        util.showToast('该花已在图鉴中，可直接确认入库', 'success');
        return;
      }
      // 进入生成中状态，开始轮询（约 1 分钟）
      this.setData({ batchGenIndex: idx });
      util.showToast('已开始生成，约需 1 分钟');
      this.pollBatchGenTask(res.taskId, idx);
    } catch (err) {
      wx.hideLoading();
      // 生成配额不足等错误：标记并提示
      const list = this.data.batchList.slice();
      list[idx] = Object.assign({}, list[idx], {
        genState: err.code === 'GEN_LIMITED' ? 'no_quota' : 'failed',
        failMsg: err.message || '提交失败'
      });
      this.setData({ batchList: list });
      util.showToast(err.message || '提交失败');
    }
  },

  async attachSpeciesToBatch(idx, speciesId) {
    /**
     * 把已入库花种挂载到批量清单指定张（生成完成/已存在时调用）
     * @param {number} idx - 批量下标
     * @param {string} speciesId - 花种 _id
     * @returns {Promise<void>}
     */
    const res = await util.callFunction('getCollection', { speciesId });
    const sp = res.list && res.list[0];
    if (!sp) throw new Error('未找到该花');
    const list = this.data.batchList.slice();
    const item = list[idx];
    const old = item.candidates[item.selectedIndex];
    const newCandidate = {
      name: sp.cnName,
      score: old ? old.score : 0,
      scoreText: '已生成',
      baike: old ? old.baike : null,
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
    list[idx] = Object.assign({}, item, {
      candidates: [newCandidate],
      selectedIndex: 0,
      genState: 'done',
      speciesId,
      hit: true
    });
    this.setData({ batchList: list });
  },

  pollBatchGenTask(taskId, idx) {
    /**
     * 批量中轮询生成任务状态（每 4s，最多 45 次约 3 分钟）；返回 Promise，终态 resolve
     * @param {string} taskId - 生成任务 id
     * @param {number} idx - 批量下标
     * @returns {Promise<void>} 生成完成/失败/超时/致命错误时 resolve（供批量确认入库串行等待）
     */
    this._genAttempts = 0;
    this.stopGenPolling();
    return new Promise((resolve) => {
      // 终态统一 resolve：done/failed/超时/致命错误均结束轮询
      const finish = () => resolve();
      this._genTimer = setInterval(async () => {
        this._genAttempts++;
        // 超时兜底：任务仍在后台执行，提示用户稍后图鉴查看
        if (this._genAttempts > 45) {
          this.stopGenPolling();
          const list = this.data.batchList.slice();
          list[idx] = Object.assign({}, list[idx], {
            genState: 'failed',
            failMsg: '生成较慢，稍后请在图鉴查看该花'
          });
          this.setData({ batchList: list, batchGenIndex: -1 });
          util.showToast('生成较慢，稍后请在图鉴查看该花');
          finish();
          return;
        }
        try {
          const res = await util.callFunction('getFlowerGenerateTask', { taskId });
          const t = res.task || {};
          if (t.status === 'done' && t.speciesId) {
            this.stopGenPolling();
            await this.attachSpeciesToBatch(idx, t.speciesId);
            this.setData({ batchGenIndex: -1 });
            // 批量「确认入库」触发的生成：完成后自动入库（_autoSaveAfterGen 标记）
            if (this._autoSaveAfterGen) {
              await this.saveBatchItem(idx);
            } else {
              util.showToast('花卡生成完成，可确认入库', 'success');
            }
            finish();
          } else if (t.status === 'failed') {
            this.stopGenPolling();
            const list = this.data.batchList.slice();
            list[idx] = Object.assign({}, list[idx], {
              genState: 'failed',
              failMsg: t.error || '生成失败'
            });
            this.setData({ batchList: list, batchGenIndex: -1 });
            wx.showModal({
              title: '生成失败',
              content: t.error || '生成失败，请稍后重试',
              showCancel: false
            });
            finish();
          }
          // pending/generating：继续等待
        } catch (err) {
          // 任务不存在/无权限：停止轮询（避免傻等 3 分钟）
          if (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN' || err.code === 'BAD_PARAM') {
            this.stopGenPolling();
            this.setData({ batchGenIndex: -1 });
            util.showToast('生成任务未找到，请重新识别后再试');
            finish();
          }
        }
      }, 4000);
    });
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

  onBatchSelectCandidate(e) {
    /**
     * 清单中点击候选行：仅切换选中（单选互斥），不弹窗
     * @param {Object} e - 事件对象，dataset.index 为批量下标，dataset.cindex 为候选下标
     * @returns {void}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const cidx = Number(e.currentTarget.dataset.cindex);
    const list = this.data.batchList.slice();
    const item = list[idx];
    if (!item || !item.candidates || !item.candidates[cidx]) return;
    item.selectedIndex = cidx;
    this.setData({ batchList: list });
  },

  onBatchFlowerNameTap(e) {
    /**
     * 点击候选花名：弹窗展示该候选的百科描述（已收录/未收录统一，不展示学名科属等空字段）
     * @param {Object} e - 事件对象，dataset.index 为批量下标，dataset.cindex 为候选下标
     * @returns {void}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const cidx = Number(e.currentTarget.dataset.cindex);
    const item = this.data.batchList[idx];
    const c = item && item.candidates && item.candidates[cidx];
    if (!c) return;
    // 描述优先级：百度百科描述（baike）→ 已收录花知识库简介（species.description）→ 兜底文案
    const desc =
      (c.baike && c.baike.description) ||
      (c.species && c.species.description) ||
      (c.species ? '暂无简介' : '该花暂未收录图鉴，识别结果仅供参考');
    this.setData({
      flowerInfo: { cnName: c.species ? c.species.cnName : c.name, description: desc },
      showFlowerInfo: true
    });
  },

  async confirmBatchSave() {
    /**
     * 批量确认入库：按 batchList 顺序逐张处理（已收录直接入库、未收录先生成后入库）；
     * 确认后立即锁定所有候选（saving，其他候选不展示），全程展示每张进度（转圈 → ✓）
     * @returns {Promise<void>}
     */
    // 防重复点击：入库/生成进行中时拒绝再次触发
    if (this._batchSaving) {
      util.showToast('花卡正在生成中，请稍等');
      return;
    }
    const list = this.data.batchList;
    // 待处理张：status=ok 且未确认且非生成中（保持 batchList 原顺序）
    const pending = list
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => {
        if (item.status !== 'ok') return false;
        if (item.confirmed) return false;
        const c = item.candidates && item.candidates[item.selectedIndex];
        return c && item.saveState === 'idle';
      });
    const uncollectedCount = pending.filter(({ item }) => {
      const c = item.candidates && item.candidates[item.selectedIndex];
      return c && !c.species;
    }).length;
    if (!pending.length) {
      util.showToast('没有可确认的花（失败或生成中除外）');
      return;
    }
    // 存在未收录张：先弹确认，说明将按置信度最高候选生成花卡并入库
    if (uncollectedCount) {
      const tip = `有 ${uncollectedCount} 张花还未收录图鉴，确认入库将按识别结果（置信度最高）生成花卡并入库，约需 1 分钟。是否继续？`;
      wx.showModal({
        title: '未收录花确认',
        content: tip,
        confirmText: '确认入库',
        cancelText: '取消',
        success: (r) => {
          if (!r.confirm) return;
          this.processBatchInOrder(pending);
        }
      });
      return;
    }
    // 无未收录张：直接按顺序入库
    this.processBatchInOrder(pending);
  },

  async processBatchInOrder(pending) {
    /**
     * 按 batchList 顺序逐张入库：先锁定所有候选（saving），再逐张处理——
     * 已收录直接 saveCard；未收录先生成（pollBatchGenTask）挂花种后自动入库；完成后收集 successCards
     * @param {Array} pending - [{ item, i }] 待处理张（保持原顺序）
     * @returns {Promise<void>}
     */
    this._batchSaving = true;      // 防重复点击标记
    this._autoSaveAfterGen = true; // 生成完成后自动入库标记
    // 锁定所有候选：全部置 saving（候选区收缩为勾选花 + 转圈，其他候选不展示、不可再选）
    const list = this.data.batchList;
    const next = list.slice();
    pending.forEach(({ i }) => {
      next[i] = Object.assign({}, next[i], { saveState: 'saving' });
    });
    this.setData({ batchList: next, batchConfirming: true });
    // 按原顺序逐张处理
    for (const { item, i } of pending) {
      const c = this.data.batchList[i].candidates[this.data.batchList[i].selectedIndex];
      if (!c) continue;
      if (c.species) {
        // 已收录：直接入库
        await this.saveBatchItem(i);
      } else {
        // 未收录：先生成（用置信度最高候选 candidates[0]，与默认选中一致）再自动入库
        const genC = this.data.batchList[i].candidates[0];
        try {
          const res = await util.callFunction('requestFlowerGenerate', {
            name: genC.name,
            score: genC.score,
            baikeDesc: genC.baike && genC.baike.description ? genC.baike.description : ''
          });
          if (res.alreadyExists && res.speciesId) {
            await this.attachSpeciesToBatch(i, res.speciesId);
            await this.saveBatchItem(i);
            continue;
          }
          this.setData({ batchGenIndex: i });
          await this.pollBatchGenTask(res.taskId, i);
        } catch (err) {
          const cur = this.data.batchList.slice();
          cur[i] = Object.assign({}, cur[i], {
            genState: err.code === 'GEN_LIMITED' ? 'no_quota' : 'failed',
            failMsg: err.message || '生成失败',
            saveState: 'fail'
          });
          this.setData({ batchList: cur });
        }
      }
    }
    this._batchSaving = false;
    this._autoSaveAfterGen = false;
    this.setData({ batchConfirming: false });
    // 收集所有成功入库的花进 success 页（swiper 多花切换）
    const confirmedList = this.data.batchList.filter((x) => x.confirmed);
    const successCards = confirmedList
      .map((x) => {
        const c = x.candidates && x.candidates[x.selectedIndex];
        if (!c || !c.species) return null;
        return Object.assign({}, c.species, {
          meetCount: x.meetCount,
          newCard: x.newCard
        });
      })
      .filter(Boolean);
    if (successCards.length) {
      this.setData({
        phase: 'success',
        successCard: successCards[0],
        successCards,
        successIndex: 0
      });
    } else {
      this.setData({ phase: 'batch_result' });
      util.showToast('入库失败，请重试');
    }
  },

  async saveBatchItem(i) {
    /**
     * 单张自动入库（生成完成挂花种后调用）：成功 saveState=done（转圈→✓），失败 saveState=fail
     * @param {number} i - 批量下标
     * @returns {Promise<void>}
     */
    const list = this.data.batchList;
    const item = list[i];
    if (!item || item.status !== 'ok') return;
    const c = item.candidates && item.candidates[item.selectedIndex];
    if (!c || !c.species) return;
    try {
      const res = await util.callFunction('saveCard', {
        action: 'create',
        speciesId: c.species._id,
        photoFileID: item.fileID
      });
      const next = list.slice();
      next[i] = Object.assign({}, item, {
        confirmed: true,
        meetCount: res.meetCount,
        newCard: res.newCard,
        saveState: 'done'
      });
      this.setData({ batchList: next });
    } catch (err) {
      const next = list.slice();
      next[i] = Object.assign({}, item, {
        failMsg: err.message || '保存失败',
        saveState: 'fail'
      });
      this.setData({ batchList: next });
    }
  },

  // confirmCollectedSave 已由 processBatchInOrder（按顺序逐张入库）取代
  async onBatchRetryDuplicate(e) {
    /**
     * 清单中「继续识别」重复照片：提示将消耗次数 → force 跳过 MD5 查重正常识别 → 写回清单
     * @param {Object} e - 事件对象，dataset.index 为批量下标
     * @returns {Promise<void>}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const item = this.data.batchList[idx];
    if (!item || item.status !== 'fail' || !item.duplicate) return;
    // 明确告知：继续识别会消耗一次今日次数（此前 MD5 去重未消耗次数）
    wx.showModal({
      title: '继续识别',
      content: '这张照片之前识别过，继续识别会消耗 1 次今日识别次数。确定继续吗？',
      confirmText: '继续识别',
      cancelText: '取消',
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '识别中...', mask: true });
        try {
          // force=true：跳过 MD5 查重，正常走识别链路（本次会消耗次数）
          const res = await util.callFunction('recognizeFlower', { fileID: item.fileID, force: true });
          wx.hideLoading();
          if (res.duplicate) {
            // 理论上 force 后不会再重复，防御性处理
            util.showToast('请稍后重试');
            return;
          }
          this.handleBatchResult(idx, res, item.fileID);
        } catch (err) {
          wx.hideLoading();
          util.showToast(err.message || '识别失败');
        }
      }
    });
  },

  retryBatchItem(e) {
    /**
     * 清单中重试识别失败的单张（换图重试走 chooseNew；此方法对已失败张重新串行识别）
     * @param {Object} e - 事件对象，dataset.index 为批量下标
     * @returns {Promise<void>}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const item = this.data.batchList[idx];
    if (!item || item.status !== 'fail') return;
    // 重新走单张识别流程（复用 runRecognize），完成后回清单
    this.setData({ previewPath: item.tempPath, showSearch: false });
    // 简单实现：重新进入单张识别，识别成功后回批量清单（见 handleRecognizeResult 分支）
    this._batchRetryIndex = idx;
    this.runRecognize(item.tempPath);
  },

  onBatchRemoveDuplicate(e) {
    /**
     * 移除重复照片（之前识别过）：从清单中删除该项，未识别的照片不会入库
     * @param {Object} e - 事件对象，dataset.index 为批量下标
     * @returns {void}
     */
    const idx = Number(e.currentTarget.dataset.index);
    const list = this.data.batchList.slice();
    const item = list[idx];
    if (!item || !item.duplicate) return;
    // 清理已上传的临时文件（识别未消耗次数，文件无保留价值）
    if (item.fileID) util.deleteCloudFile(item.fileID);
    list.splice(idx, 1);
    this.setData({ batchList: list, batchTotal: list.length });
    util.showToast('已删除', 'success');
  },

  onBatchPreviewPhoto(e) {
    /**
     * 点击左侧照片：全屏预览（本地路径，无需下载）
     * @param {Object} e - 事件对象，dataset.index 为批量下标
     * @returns {void}
     */
    const item = this.data.batchList[Number(e.currentTarget.dataset.index)];
    if (!item || !item.tempPath) return;
    wx.previewImage({ urls: [item.tempPath], current: item.tempPath });
  },

  onBatchSavePhoto(e) {
    /**
     * 清单中把失败张原图保存到系统相册（兜底）
     * @param {Object} e - 事件对象，dataset.index 为批量下标
     * @returns {void}
     */
    const item = this.data.batchList[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    wx.saveImageToPhotosAlbum({
      path: item.tempPath,
      success: () => util.showToast('已保存到相册', 'success'),
      fail: () =>
        wx.showModal({
          title: '保存失败',
          content: '请在设置中允许保存图片到相册',
          showCancel: false
        })
    });
  },

  // onBatchFlowerInfo 已由 showBatchFlowerInfo（候选行点击弹详情）替代，无残留引用

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

  onSuccessChange(e) {
    /**
     * success 页 swiper 切换：更新当前展示的花（多花收录时左右切换）
     * @param {Object} e - 事件对象，e.detail.current 为当前下标
     * @returns {void}
     */
    const idx = e.detail.current;
    const cards = this.data.successCards;
    if (cards && cards[idx]) {
      this.setData({ successIndex: idx, successCard: cards[idx] });
    }
  },

  viewCard() {
    /**
     * 成功页跳转当前花卡详情
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
      genIndex: -1,
      // 批量状态清理
      batchList: [],
      batchIndex: 0,
      batchTotal: 0,
      batchExpand: -1,
      batchGenIndex: -1,
      batchConfirming: false
    });
    this._batchRetryIndex = -1;
  },

  goHome() {
    /**
     * 回到首页（识花 Tab）：switchTab 切换 tabBar 页面
     * @returns {void}
     */
    // 同时停止生成轮询，避免残留定时器
    this.stopGenPolling();
    wx.switchTab({ url: '/pages/index/index' });
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
