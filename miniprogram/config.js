// 全局配置：云开发环境、玩法规则、稀有度定义
module.exports = {
  // 云开发环境 ID（显式指定，保证 image 渲染 cloud:// fileID 时环境匹配；
  // 之前留空导致渲染层把 cloud:// 当本地资源加载失败）
  CLOUD_ENV: 'cloud1-d2gckznjh68263f38',

  // 每用户每日识别上限（以云函数环境变量 RECOGNIZE_DAILY_LIMIT 为准，
  // 此处仅作前端展示兜底；实际限额由 getAchievements 的 todayLimit 下发）
  RECOGNIZE_DAILY_LIMIT: 20,

  // 稀有度定义（key 与数据库字段一致）
  RARITY: {
    common: { key: 'common', label: '常见', color: '#5fae5f', light: '#eaf5ea' },
    rare: { key: 'rare', label: '少见', color: '#5b9bd5', light: '#e8f1fb' },
    epic: { key: 'epic', label: '珍稀', color: '#9b59b6', light: '#f1e8f7' },
    legendary: { key: 'legendary', label: '传说', color: '#c9960a', light: '#faf3dd' }
  },

  RARITY_ORDER: ['legendary', 'epic', 'rare', 'common'],

  // 花匠等级：按已收集种数
  LEVELS: [
    { min: 1, name: '爱花萌新' },
    { min: 6, name: '拾花者' },
    { min: 16, name: '赏花人' },
    { min: 31, name: '花语师' },
    { min: 46, name: '花神' }
  ],

  SEASONS: ['春', '夏', '秋', '冬'],

  APP_NAME: '随心一拍-花知道',
  SLOGAN: '随心一拍，路边的花一拍就知道',
  VERSION: '1.0.0'
};
