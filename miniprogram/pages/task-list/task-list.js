const util = require('../../utils/util');

// 识别任务列表页：正在识别 + 识别历史 两部分；任务卡片支持左滑删除（入库中任务提示不可删）
Page({
  data: {
    running: [],  // 进行中任务（identified/pending/processing + 可删标记）
    history: [],  // 已终态任务（done/partial/failed）
    loading: true,
    openedTaskId: '' // 当前展开左滑操作区的任务 id（同屏仅一个）
  },

  /** 左滑判定阈值（px）：滑动距离超过该值视为左滑展开 */
  SWIPE_THRESHOLD: 50,

  /** 滑动起始横坐标缓存（区分左滑/右滑/竖向滚动） */
  _touchStartX: 0,

  /** 禁止删除状态：后台 worker 正在入库中（pending/processing），UI 层展示「正在入库中」 */
  RUNNING_STATUS: ['pending', 'processing'],

  onShow() {
    /**
     * 页面显示：加载任务列表
     * @returns {void}
     */
    this.load();
  },

  async load() {
    /**
     * 加载任务：按状态分「正在识别」与「识别历史」；给每条任务标记是否入库中（决定左滑露删除/提示）
     * @returns {Promise<void>}
     */
    try {
      const res = await util.callFunction('getBatchTask');
      const list = res.list || [];
      // identified（已识别未入库）也归入「正在识别」区，可继续确认入库
      const running = list.filter((t) => ['identified', 'pending', 'processing'].includes(t.status));
      const history = list.filter((t) => !['identified', 'pending', 'processing'].includes(t.status));
      // 状态文案映射
      const statusMap = { identified: '已识别，待入库', pending: '等待处理', processing: '生成入库中', done: '已完成', partial: '部分完成', failed: '失败' };
      const fmt = (arr) =>
        arr.map((t) =>
          Object.assign({}, t, {
            statusText: statusMap[t.status] || t.status,
            progressText: t.doneCount + '/' + t.itemCount,
            timeText: t.createdAt ? util.formatDate(t.createdAt) : '',
            // 入库中任务（pending/processing）左滑只提示，不提供删除
            swipeRunning: this.RUNNING_STATUS.includes(t.status)
          })
        );
      this.setData({
        running: fmt(running),
        history: fmt(history),
        loading: false,
        openedTaskId: '' // 数据刷新后重置展开态
      });
    } catch (e) {
      this.setData({ loading: false });
      util.showToast(e.message || '加载失败');
    }
  },

  openTask(e) {
    /**
     * 点击任务内容区：跳转任务详情页；若当前任务已展开则先收回（点击内容视为收起）
     * @param {Object} e - 事件对象，dataset.id 为任务 id
     * @returns {void}
     */
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    // 已展开的任务点击内容区 → 只收回不跳转（避免误入详情）
    if (this.data.openedTaskId === id) {
      this.setData({ openedTaskId: '' });
      return;
    }
    wx.navigateTo({ url: `/pages/task-detail/task-detail?taskId=${id}` });
  },

  onTaskTouchStart(e) {
    /**
     * 触摸开始：记录起始横坐标（判定左滑/右滑）
     * @param {Object} e - 触摸事件
     * @returns {void}
     */
    this._touchStartX = e.touches && e.touches[0] ? e.touches[0].clientX : 0;
  },

  onTaskTouchEnd(e) {
    /**
     * 触摸结束：横移距离超过阈值视为左滑意图——展开删除/提示（右滑/短滑不动作）
     * 仅比较 clientX 差值，竖向滚动不会误触
     * @param {Object} e - 触摸事件
     * @returns {void}
     */
    const endX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0;
    const diff = endX - this._touchStartX;
    const taskId = e.currentTarget.dataset.taskid;
    const running = e.currentTarget.dataset.running === true || e.currentTarget.dataset.running === 'true';
    // 左滑（差值为负且超过阈值）→ 展开该任务
    if (diff < -this.SWIPE_THRESHOLD && taskId) {
      this.setData({ openedTaskId: taskId });
      // 入库中任务：仅提示（删除按钮不展示）
      if (running) util.showToast('任务正在入库中，暂不能删除');
      return;
    }
    // 向右滑动（正向超过阈值）→ 收回展开态
    if (diff > this.SWIPE_THRESHOLD && this.data.openedTaskId) {
      this.setData({ openedTaskId: '' });
    }
    // 短滑/轻触不动（避免误触发），展开态保持不变
  },

  onDeleteTask(e) {
    /**
     * 点击删除按钮：二次确认 → 调用 deleteBatchTask（仅删任务记录，保留照片与指纹）→ 刷新列表
     * @param {Object} e - 事件对象，dataset.id 为任务 id
     * @returns {void}
     */
    const taskId = e.currentTarget.dataset.id;
    if (!taskId) return;
    wx.showModal({
      title: '删除识别任务',
      content: '删除后该任务从列表移除，已入库的花卡与照片不受影响。确定删除吗？',
      confirmText: '删除',
      confirmColor: '#c0392b',
      cancelText: '取消',
      success: async (r) => {
        if (!r.confirm) {
          // 取消：收回展开态
          this.setData({ openedTaskId: '' });
          return;
        }
        wx.showLoading({ title: '删除中...', mask: true });
        try {
          await util.callFunction('deleteBatchTask', { taskId });
          wx.hideLoading();
          this.setData({ openedTaskId: '' });
          util.showToast('已删除', 'success');
          this.load(); // 刷新列表
        } catch (err) {
          wx.hideLoading();
          this.setData({ openedTaskId: '' });
          util.showToast(err.message || '删除失败');
        }
      }
    });
  }
});