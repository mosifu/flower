const config = require('../config');

/**
 * 压缩图片：最长边不超过 1080、质量 75，
 * 同时满足百度植物识别（≤4M）与微信内容安全检测（≤1M）的体积要求。
 */
function getImageSize(src) {
  /**
   * 读取本地图片尺寸（用于按比例压缩）
   * @param {string} src - 本地图片路径
   * @returns {Promise<{width: number, height: number}|null>} 读取失败返回 null
   */
  return new Promise((resolve) => {
    wx.getImageInfo({
      src,
      success: (res) => resolve({ width: res.width, height: res.height }),
      fail: () => resolve(null)
    });
  });
}

async function compressImage(filePath) {
  /**
   * 压缩图片：最长边不超过 1080、质量 75
   * @param {string} filePath - 原图本地路径
   * @returns {Promise<string>} 压缩后的本地路径；压缩失败时返回原路径
   */
  const size = await getImageSize(filePath);
  const maxEdge = 1080;
  const opts = { src: filePath, quality: 75 };
  if (size && size.width && size.height) {
    const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
    if (scale < 1) {
      opts.compressedWidth = Math.round(size.width * scale);
      opts.compressedHeight = Math.round(size.height * scale);
    }
  }
  return new Promise((resolve) => {
    wx.compressImage({
      ...opts,
      success: (res) => resolve(res.tempFilePath),
      fail: () => resolve(filePath)
    });
  });
}

/**
 * 压缩并上传到云存储，返回 fileID
 */
async function uploadImage(filePath) {
  /**
   * 压缩并上传图片到云存储
   * @param {string} filePath - 本地图片路径
   * @returns {Promise<string>} 云存储 fileID
   */
  const compressed = await compressImage(filePath);
  const ext = (compressed.match(/\.(\w+)$/) || [])[1] || 'jpg';
  const cloudPath = `user-photos/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await wx.cloud.uploadFile({ cloudPath, filePath: compressed });
  return res.fileID;
}

/**
 * 调用云函数统一入口：错误处理 + Promise
 */
function callFunction(name, data = {}) {
  /**
   * 统一云函数调用入口：错误处理 + Promise 化
   * @param {string} name - 云函数名
   * @param {Object} data - 传给云函数的参数
   * @returns {Promise<Object>} 云函数返回结果；ok=false 时抛出带 code 的 Error
   */
  return wx.cloud.callFunction({ name, data }).then((res) => {
    const r = res.result || {};
    if (r.ok === false) {
      const err = new Error(r.message || '服务异常');
      err.code = r.code;
      throw err;
    }
    return r;
  });
}

function pad(n) {
  /**
   * 数字补零到两位
   * @param {number} n
   * @returns {string} 如 1 -> "01"
   */
  return n < 10 ? '0' + n : '' + n;
}

function formatDate(ts) {
  /**
   * 时间戳转 yyyy-MM-dd
   * @param {number} ts - 毫秒时间戳
   * @returns {string} 格式化日期；无值返回空串
   */
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStr() {
  /**
   * 生成今日 yyyyMMdd（与云函数限流键格式一致）
   * @returns {string}
   */
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function rarityInfo(key) {
  /**
   * 稀有度配置查询
   * @param {string} key - common/rare/epic/legendary
   * @returns {Object} 稀有度配置对象，未知值回退到 common
   */
  return config.RARITY[key] || config.RARITY.common;
}

function showToast(title, icon = 'none') {
  /**
   * 轻提示封装
   * @param {string} title - 提示文案
   * @param {string} icon - success/none/error，默认 none
   */
  wx.showToast({ title, icon, duration: 1800 });
}

/**
 * 选择一张图片：chooseMedia 优先，低基础库自动降级 chooseImage
 * @param {string[]} sourceType - ['camera'] / ['album'] / ['camera','album']
 * @returns {Promise<string>} 本地图片路径；用户取消时 reject 原始错误
 */
function chooseOneImage(sourceType) {
  /**
   * 单图选择封装（chooseMedia 2.10.0+，老版本降级 chooseImage）
   * @param {Array<string>} sourceType - 图片来源：camera/album
   * @returns {Promise<string>} 图片本地路径
   */
  return new Promise((resolve, reject) => {
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType,
        sizeType: ['compressed'],
        success: (res) => {
          const f = res.tempFiles && res.tempFiles[0];
          if (f && f.tempFilePath) resolve(f.tempFilePath);
          else reject(new Error('未获取到图片'));
        },
        fail: reject
      });
    } else {
      // 低版本基础库降级：能力等价，路径经 tempFilePaths 返回
      wx.chooseImage({
        count: 1,
        sourceType,
        sizeType: ['compressed'],
        success: (res) => {
          const p = res.tempFilePaths && res.tempFilePaths[0];
          if (p) resolve(p);
          else reject(new Error('未获取到图片'));
        },
        fail: reject
      });
    }
  });
}

/**
 * 删除云存储文件（静默失败，不阻断主流程）
 * @param {string} fileID - 云存储文件 ID
 * @returns {Promise<void>}
 */
async function deleteCloudFile(fileID) {
  if (!fileID) return;
  try {
    await wx.cloud.deleteFile({ fileList: [fileID] });
  } catch (e) {
    // 删除失败不阻断（文件会留存，可后续生命周期/人工清理）
  }
}

module.exports = {
  compressImage,
  uploadImage,
  callFunction,
  formatDate,
  todayStr,
  rarityInfo,
  showToast,
  chooseOneImage,
  deleteCloudFile
};
