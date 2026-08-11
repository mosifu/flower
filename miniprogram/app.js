const config = require('./config');

// 应用入口：初始化云开发环境
App({
  onLaunch() {
    /**
     * 应用启动：初始化云开发
     * @returns {void}
     */
    // 基础库过低时直接提示，避免后续所有云能力静默失效
    if (!wx.cloud) {
      console.error('当前微信基础库版本过低，请使用 2.2.3 或以上版本');
      return;
    }
    // CLOUD_ENV 留空时使用当前默认云环境
    const opts = { traceUser: true };
    if (config.CLOUD_ENV) {
      opts.env = config.CLOUD_ENV;
    }
    wx.cloud.init(opts);
  },

  globalData: {
    // 知识库目录缓存（含收集标记），跨页面复用，避免重复拉取
    catalog: null
  }
});
