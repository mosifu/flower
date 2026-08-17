const util = require('../../utils/util');

// 识别任务列表页：正在识别 + 识别历史 两部分
Page({
  data: {
    running: [],  // 进行中任务（pending/processing）
    history: [],  // 已终态任务（done/partial/failed）
    loading: true
  },

  onShow() {
    /**
     * 页面显示：加载任务列表
     * @returns {void}
     */
    this.load();
  },

  async load() {
    /**
     * 加载任务：按状态分「正在识别」与「识别历史」
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
            timeText: t.createdAt ? util.formatDate(t.createdAt) : ''
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
  }
});
