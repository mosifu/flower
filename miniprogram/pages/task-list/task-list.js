const util = require('../../utils/util');

// 识别任务列表页：正在识别 + 识别历史 两部分；长按任务弹出删除操作（入库中任务提示不可删）
Page({
  data: {
    running: [],  // 进行中任务（identified/pending/processing + 可删标记）
    history: [],  // 已终态任务（done/partial/failed）
    loading: true
  },

  /** 禁止删除状态：后台 worker 正在入库中（pending/processing），长按仅提示 */
  RUNNING_STATUS: ['pending', 'processing'],

  /** 长按待删除的任务 id（action sheet 选择后使用） */
  _longPressTaskId: '',

  onShow() {
    /**
     * 页面显示：加载任务列表
     * @returns {void}
     */
    this.load();
  },

  async load() {
    /**
     * 加载任务：按状态分「正在识别」与「识别历史」；给每条任务标记是否入库中（决定长按露删除/提示）
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
            // 入库中任务（pending/processing）长按只提示，不提供删除
            runningLocked: this.RUNNING_STATUS.includes(t.status)
          })
        );
      this.setData({
        running: fmt(running),
        history: fmt(history),
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false });
      util.showToast(e.message || '加载失败');
    }
  },

  openTask(e) {
    /**
     * 点击任务：跳转任务详情页
     * @param {Object} e - 事件对象，dataset.id 为任务 id
     * @returns {void}
     */
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/task-detail/task-detail?taskId=${id}` });
  },

  onTaskLongPress(e) {
    /**
     * 长按任务卡片：弹出删除操作（action sheet）；入库中任务仅提示不可删
     * @param {Object} e - 事件对象，dataset.taskid 任务 id、dataset.running 是否入库中
     * @returns {void}
     */
    const taskId = e.currentTarget.dataset.taskid;
    const running = e.currentTarget.dataset.running === true || e.currentTarget.dataset.running === 'true';
    if (!taskId) return;
    // 入库中任务：不可删除，仅提示（pending/processing 正在后台处理）
    if (running) {
      util.showToast('任务正在入库中，暂不能删除');
      return;
    }
    this._longPressTaskId = taskId;
    wx.showActionSheet({
      itemList: ['删除'],
      itemColor: '#c0392b',
      success: (r) => {
        // 用户选择了「删除」→ 进入二次确认
        if (r.tapIndex === 0) this.confirmDelete(this._longPressTaskId);
      }
    });
  },

  confirmDelete(taskId) {
    /**
     * 二次确认后删除任务：调用 deleteBatchTask（仅删任务记录，保留照片与指纹）→ 刷新列表
     * @param {string} taskId - 任务 id
     * @returns {void}
     */
    if (!taskId) return;
    wx.showModal({
      title: '删除识别任务',
      content: '删除后该任务从列表移除，已入库的花卡与照片不受影响。确定删除吗？',
      confirmText: '删除',
      confirmColor: '#c0392b',
      cancelText: '取消',
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '删除中...', mask: true });
        try {
          await util.callFunction('deleteBatchTask', { taskId });
          wx.hideLoading();
          util.showToast('已删除', 'success');
          this.load(); // 刷新列表
        } catch (err) {
          wx.hideLoading();
          util.showToast(err.message || '删除失败');
        }
      }
    });
  }
});