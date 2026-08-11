/**
 * saveCard 云函数
 * 职责：花卡入库与维护，通过 action 区分操作类型。
 * 入参：{ action, speciesId, photoFileID?, location?, note?, photoIndex? }
 *   action: create（确认入库）/ addPhoto（追加照片）/ updateNote（改备注）
 *           / updateLocation（改地点）/ deletePhoto（删单张照片）/ deleteCard（删整卡）
 * 返回：{ ok, newCard?, meetCount?, cardId? }
 * 说明：
 * - 同一 openid + speciesId 唯一对应一张花卡；重复识别只追加照片并累加 meetCount。
 * - create / addPhoto 均做微信内容安全检测（图片下载后检查，违规拒绝并清理文件）。
 * - deletePhoto / deleteCard 删除数据库记录的同时清理云存储文件，避免孤儿文件。
 * - 输入长度与服务端校验：note ≤ 200 字、location ≤ 100 字、单卡照片 ≤ 30 张。
 * 环境变量：无（内容安全走云开发 openapi 权限，见 config.json）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 单卡照片数量上限：防止 photos 数组无限膨胀（超出单文档容量/下发性能下降）
const MAX_PHOTOS = 30;
// 备注 / 地点最大长度（与前端 maxlength 对齐，云函数侧兜底防绕过）
const MAX_NOTE_LEN = 200;
const MAX_LOCATION_LEN = 100;

/**
 * 微信图片内容安全检测（与 recognizeFlower 中的实现保持一致，修改需同步）
 * jpeg 失败自动换 png 重试；errCode 87014 判不合规；接口异常默认放行（fail-open）
 * @param {Buffer} buffer - 待检测图片二进制
 * @returns {Promise<{pass: boolean}>} pass=false 表示图片内容不合规
 */
async function checkImageSecurity(buffer) {
  const contentTypes = ['image/jpeg', 'image/png'];
  let lastError = null;

  for (const contentType of contentTypes) {
    try {
      const result = await cloud.openapi.security.imgSecCheck({
        media: { contentType, value: buffer }
      });
      if (result && result.errCode === 87014) {
        return { pass: false };
      }
      return { pass: true };
    } catch (e) {
      if (String(e.errCode || e.code) === '87014') {
        return { pass: false };
      }
      lastError = e;
    }
  }

  // 接口异常（常见于未认证/类目限制）：默认放行并告警
  console.warn('saveCard imgSecCheck 异常:', lastError);
  return { pass: true };
}

/**
 * 构造单张照片记录
 * @param {string} fileID - 云存储文件 ID
 * @param {string} location - 可选拍摄地点
 * @param {string} note - 可选照片备注
 * @returns {Object} 照片对象 { fileID, addedAt, location, note }
 */
function makePhoto(fileID, location, note) {
  // 每张照片附带拍摄时间与可选的地点、备注
  return {
    fileID,
    addedAt: Date.now(),
    location: location || '',
    note: note || ''
  };
}

/**
 * 批量删除云存储文件（deleteFile 单次上限 50 个，按需分批）
 * @param {string[]} fileList - 云存储 fileID 列表
 * @returns {Promise<number>} 实际删除成功的数量
 */
async function deleteFilesBatched(fileList) {
  if (!fileList || !fileList.length) return 0;
  let deleted = 0;
  for (let i = 0; i < fileList.length; i += 50) {
    const batch = fileList.slice(i, i + 50);
    try {
      // 删除文件失败不阻断主流程（数据库已删，文件可后续人工/生命周期清理）
      const res = await cloud.deleteFile({ fileList: batch });
      deleted += (res.fileList || []).filter((f) => f.status === 0).length;
    } catch (e) {
      console.warn('deleteFile 失败:', batch.length, e);
    }
  }
  return deleted;
}

/**
 * 输入校验：统一返回 null 或 { ok:false, code, message }
 * @param {Object} event - 云函数入参
 * @param {string} action - 当前操作
 * @returns {Object|null} 校验失败返回错误结果，通过返回 null
 */
function validateInput(event, action) {
  // 云函数可被直接调用，必须服务端校验长度，防止绕过前端 maxlength
  if (event.note !== undefined && String(event.note).length > MAX_NOTE_LEN) {
    return { ok: false, code: 'BAD_PARAM', message: `备注不能超过 ${MAX_NOTE_LEN} 字` };
  }
  if (event.location !== undefined && String(event.location).length > MAX_LOCATION_LEN) {
    return { ok: false, code: 'BAD_PARAM', message: `地点不能超过 ${MAX_LOCATION_LEN} 字` };
  }
  if (event.photoFileID !== undefined && typeof event.photoFileID !== 'string') {
    return { ok: false, code: 'BAD_PARAM', message: '照片参数不合法' };
  }
  if (action === 'deletePhoto') {
    // 照片下标必须是有效数字
    const idx = Number(event.photoIndex);
    if (!(idx >= 0) || !Number.isInteger(idx)) {
      return { ok: false, code: 'BAD_PARAM', message: '照片参数不合法' };
    }
  }
  return null;
}

exports.main = async (event) => {
  // 云函数入口：按 action 分发到对应维护操作，详细说明见文件头
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'create';

  try {
    if (!OPENID) {
      return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
    }

    const speciesId = event.speciesId;
    if (!speciesId) {
      return { ok: false, code: 'NO_SPECIES', message: '缺少花种参数' };
    }

    const invalid = validateInput(event, action);
    if (invalid) return invalid;

    // 删除整卡不需要校验花种存在；其余操作必须先确认花种有效
    if (action !== 'deleteCard') {
      const sp = await db
        .collection('species')
        .doc(speciesId)
        .get()
        .catch(() => null);
      if (!sp || !sp.data || sp.data.enabled === false) {
        return { ok: false, code: 'NO_SPECIES', message: '该花种不存在或未收录' };
      }
    }

    const col = db.collection('user_cards');
    const query = await col.where({ openid: OPENID, speciesId }).limit(1).get();
    const existing = query.data[0] || null;
    const now = Date.now();

    switch (action) {
      case 'create': {
        // 确认入库：已收集过则追加照片并累加次数，否则新建花卡
        if (!event.photoFileID) {
          return { ok: false, code: 'NO_PHOTO', message: '缺少照片参数' };
        }
        if (existing && (existing.photos || []).length >= MAX_PHOTOS) {
          return { ok: false, code: 'PHOTO_LIMIT', message: `每张花卡最多 ${MAX_PHOTOS} 张照片` };
        }
        // 内容安全：下载图片检查（防绕过识别链路直接调本函数入库违规图片）
        const sec = await checkUploadedPhoto(event.photoFileID);
        if (!sec.ok) return sec.result;

        if (existing) {
          await col.doc(existing._id).update({
            data: {
              photos: _.push([makePhoto(event.photoFileID, event.location, event.note)]),
              lastMetAt: now,
              meetCount: _.inc(1)
            }
          });
          return {
            ok: true,
            newCard: false,
            meetCount: (existing.meetCount || 0) + 1,
            cardId: existing._id
          };
        }
        const card = {
          openid: OPENID,
          speciesId,
          photos: [makePhoto(event.photoFileID, event.location, event.note)],
          note: '',
          location: '',
          firstMetAt: now,
          lastMetAt: now,
          meetCount: 1,
          createdAt: now
        };
        const addRes = await col.add({ data: card });
        return { ok: true, newCard: true, meetCount: 1, cardId: addRes._id };
      }

      case 'addPhoto': {
        // 已收集花追加一张新照片，同时更新最近遇见时间与次数
        if (!existing) {
          return { ok: false, code: 'NOT_COLLECTED', message: '请先确认入库' };
        }
        if (!event.photoFileID) {
          return { ok: false, code: 'NO_PHOTO', message: '缺少照片参数' };
        }
        if ((existing.photos || []).length >= MAX_PHOTOS) {
          return { ok: false, code: 'PHOTO_LIMIT', message: `每张花卡最多 ${MAX_PHOTOS} 张照片` };
        }
        // 内容安全：与 create 相同，追加照片同样必须过检（评审 1.1）
        const sec = await checkUploadedPhoto(event.photoFileID);
        if (!sec.ok) return sec.result;

        await col.doc(existing._id).update({
          data: {
            photos: _.push([makePhoto(event.photoFileID, event.location, event.note)]),
            lastMetAt: now,
            meetCount: _.inc(1)
          }
        });
        return {
          ok: true,
          newCard: false,
          meetCount: (existing.meetCount || 0) + 1,
          cardId: existing._id
        };
      }

      case 'updateNote': {
        // 更新卡片级备注（如地点、心情、故事）
        if (!existing) {
          return { ok: false, code: 'NOT_COLLECTED', message: '尚未收集该花' };
        }
        await col.doc(existing._id).update({ data: { note: event.note || '' } });
        return { ok: true, cardId: existing._id };
      }

      case 'updateLocation': {
        // 更新卡片级地点信息（手动填写，不依赖定位权限）
        if (!existing) {
          return { ok: false, code: 'NOT_COLLECTED', message: '尚未收集该花' };
        }
        await col.doc(existing._id).update({ data: { location: event.location || '' } });
        return { ok: true, cardId: existing._id };
      }

      case 'deletePhoto': {
        // 删除指定下标的照片：先删数据库记录，再清理云存储文件（失败不阻断）
        if (!existing) {
          return { ok: false, code: 'NOT_COLLECTED', message: '尚未收集该花' };
        }
        const idx = Number(event.photoIndex);
        if (!existing.photos || !existing.photos[idx]) {
          return { ok: false, code: 'BAD_INDEX', message: '照片不存在' };
        }
        const removedPhoto = existing.photos[idx];
        const photos = existing.photos.slice();
        photos.splice(idx, 1);
        await col.doc(existing._id).update({ data: { photos } });
        // 删除云存储原图，避免孤儿文件（评审 1.2）
        await deleteFilesBatched([removedPhoto.fileID]);
        return { ok: true, cardId: existing._id };
      }

      case 'deleteCard': {
        // 删除整张花卡：先删数据库记录，再批量清理云存储照片（评审 1.2）
        if (existing) {
          const fileIDs = (existing.photos || []).map((p) => p.fileID).filter(Boolean);
          await col.doc(existing._id).remove();
          await deleteFilesBatched(fileIDs);
        }
        return { ok: true, deleted: !!existing };
      }

      default:
        return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
    }
  } catch (err) {
    console.error('saveCard error:', err);
    return {
      ok: false,
      code: err.code || 'INTERNAL',
      message: err.message || '保存失败，请稍后重试'
    };
  }
};

/**
 * 下载并检测待入库照片，违规时清理文件
 * @param {string} fileID - 云存储文件 ID
 * @returns {Promise<{ok: boolean, result?: Object}>} ok=false 时 result 为错误返回体
 */
async function checkUploadedPhoto(fileID) {
  let buffer;
  try {
    const dl = await cloud.downloadFile({ fileID });
    buffer = dl.fileContent;
  } catch (e) {
    // 文件不存在或无权访问：文件本身无法入库，无需清理
    return { ok: false, result: { ok: false, code: 'DOWNLOAD_FAIL', message: '图片读取失败，请重试' } };
  }
  if (!buffer || !buffer.length) {
    return { ok: false, result: { ok: false, code: 'EMPTY_FILE', message: '图片内容为空' } };
  }

  const sec = await checkImageSecurity(buffer);
  if (!sec.pass) {
    // 违规图片直接删除，避免残留在云存储
    await deleteFilesBatched([fileID]);
    return { ok: false, result: { ok: false, code: 'UNSAFE_CONTENT', message: '图片内容不合规，无法收录' } };
  }
  return { ok: true };
}
