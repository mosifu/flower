/**
 * batchSaveWorker 云函数
 * 职责：定时（每 1 分钟）处理批量识别任务（batch_tasks）——
 *   已收录花：内联 saveCard create（照片入库/追加 + 内容安全检测）；
 *   未收录花：内联 requestFlowerGenerate 建生成任务 → 置 generating → 下轮查 flower_gen_tasks 状态，done 后入库；
 *   全部 item 终态后更新任务 status（done/partial/failed）。
 * 入参：无（定时触发）
 * 返回：{ ok, processedTasks, processedItems }
 * 说明：
 * - 与 requestFlowerGenerate / saveCard 的建任务/入库逻辑保持一致（云函数间不能直接调用，故内联，修改需同步）；
 * - 任务并发上限与创建校验在 createBatchTask；此处按 openid 处理不额外限流（saveCard/生成配额沿用原逻辑）；
 * - 每轮最多处理 3 个任务（60s 超时限制），updatedAt 防重入（processing 超 60s 才重新拾取）。
 * 环境变量：GEN_DAILY_LIMIT（生成上限，默认 3，与 requestFlowerGenerate 一致）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 单卡照片上限（与 saveCard MAX_PHOTOS 一致）
const MAX_PHOTOS = 30;
// 每轮最多处理任务数：60s 超时限制下保证单轮完成
const MAX_TASKS_PER_ROUND = 3;
// 生成任务重新拾取阈值：processing 超 60s 视为可重入（上轮未完成）
const STALE_PROCESSING_MS = 60 * 1000;
// 生成配额上限（与 requestFlowerGenerate GEN_DAILY_LIMIT 一致）
const GEN_DAILY_LIMIT = Number(process.env.GEN_DAILY_LIMIT) || 3;

function todayStr() {
  // 生成今日日期字符串 yyyyMMdd（与 gen_limits 键格式一致）
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function normalizeName(s) {
  // 花名规范化（小写去空格），与 requestFlowerGenerate 一致
  return String(s || '').trim().toLowerCase();
}

/**
 * 微信图片内容安全检测（与 saveCard/recognizeFlower 一致，修改需同步）
 * @param {Buffer} buffer - 待检测图片二进制
 * @returns {Promise<{pass: boolean}>}
 */
async function checkImageSecurity(buffer) {
  const contentTypes = ['image/jpeg', 'image/png'];
  let lastError = null;
  for (const contentType of contentTypes) {
    try {
      const result = await cloud.openapi.security.imgSecCheck({
        media: { contentType, value: buffer }
      });
      if (result && result.errCode === 87014) return { pass: false };
      return { pass: true };
    } catch (e) {
      if (String(e.errCode || e.code) === '87014') return { pass: false };
    }
  }
  return { pass: true };
}

/**
 * 批量删除云存储文件（与 saveCard deleteFilesBatched 一致）
 * @param {string[]} fileList
 * @returns {Promise<number>}
 */
async function deleteFilesBatched(fileList) {
  if (!fileList || !fileList.length) return 0;
  let deleted = 0;
  for (let i = 0; i < fileList.length; i += 50) {
    const batch = fileList.slice(i, i + 50);
    try {
      const res = await cloud.deleteFile({ fileList: batch });
      deleted += (res.fileList || []).filter((f) => f.status === 0).length;
    } catch (e) {
      console.warn('deleteFile 失败:', batch.length, e);
    }
  }
  return deleted;
}

/**
 * 下载并检测照片（saveCard create 前的安全检测，违规清理文件）
 * @param {string} fileID
 * @returns {Promise<{ok: boolean, result?: Object}>}
 */
async function checkUploadedPhoto(fileID) {
  let buffer;
  try {
    const dl = await cloud.downloadFile({ fileID });
    buffer = dl.fileContent;
  } catch (e) {
    return { ok: false, result: { ok: false, code: 'DOWNLOAD_FAIL', message: '图片读取失败' } };
  }
  if (!buffer || !buffer.length) {
    return { ok: false, result: { ok: false, code: 'EMPTY_FILE', message: '图片内容为空' } };
  }
  const sec = await checkImageSecurity(buffer);
  if (!sec.pass) {
    await deleteFilesBatched([fileID]);
    return { ok: false, result: { ok: false, code: 'UNSAFE_CONTENT', message: '图片内容不合规' } };
  }
  return { ok: true };
}

/**
 * 入库单张照片（saveCard create 核心逻辑，与 saveCard 一致，修改需同步）
 * @param {string} openid - 用户标识
 * @param {string} speciesId - 花种 id
 * @param {string} fileID - 照片云存储
 * @returns {Promise<{ok: boolean, newCard?: boolean, meetCount?: number, message?: string}>}
 */
async function saveCardCore(openid, speciesId, fileID) {
  const col = db.collection('user_cards');
  const query = await col.where({ openid, speciesId }).limit(1).get();
  const existing = query.data[0] || null;
  const now = Date.now();

  if (existing && (existing.photos || []).length >= MAX_PHOTOS) {
    return { ok: false, message: `每张花卡最多 ${MAX_PHOTOS} 张照片` };
  }
  // 内容安全：识别时已检测过，但 saveCard 链路要求入库前再检（防绕过）
  const sec = await checkUploadedPhoto(fileID);
  if (!sec.ok) return { ok: false, message: sec.result.message };

  if (existing) {
    await col.doc(existing._id).update({
      data: {
        photos: _.push([{ fileID, addedAt: now, location: '', note: '' }]),
        lastMetAt: now,
        meetCount: _.inc(1)
      }
    });
    return { ok: true, newCard: false, meetCount: (existing.meetCount || 0) + 1 };
  }
  const card = {
    openid,
    speciesId,
    photos: [{ fileID, addedAt: now, location: '', note: '' }],
    note: '',
    location: '',
    firstMetAt: now,
    lastMetAt: now,
    meetCount: 1,
    createdAt: now
  };
  await col.add({ data: card });
  return { ok: true, newCard: true, meetCount: 1 };
}

/**
 * 建未收录花生成任务（requestFlowerGenerate 核心逻辑，修改需同步）；已存在/他人已生成时直接返回物种
 * @param {string} openid
 * @param {Object} info - { name, score, baikeDesc }
 * @returns {Promise<{ok: boolean, taskId?: string, alreadyExists?: boolean, speciesId?: string, message?: string}>}
 */
async function createGenTask(openid, info) {
  const name = String(info.name || '').trim();
  if (!name) return { ok: false, message: '花名不合法' };
  const col = db.collection('flower_gen_tasks');
  const taskId = `${openid}_${normalizeName(name)}`;

  // 1. 同名任务去重
  try {
    const doc = await col.doc(taskId).get();
    const st = doc.data && doc.data.status;
    if (st === 'pending' || st === 'generating') return { ok: true, taskId, reused: true };
    if (st === 'done' && doc.data.speciesId) return { ok: true, alreadyExists: true, speciesId: doc.data.speciesId };
  } catch (e) { /* 文档不存在继续新建 */ }

  // 2. 花种已入库校验
  const spRes = await db.collection('species').where({ cnName: name, enabled: true }).limit(1).get();
  if (spRes.data.length) return { ok: true, alreadyExists: true, speciesId: spRes.data[0]._id };

  // 3. 每日配额事务
  const date = todayStr();
  const lid = `${openid}_${date}`;
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.collection('gen_limits').doc(lid).get().catch(() => null);
      const cur = (doc && doc.data && doc.data.count) || 0;
      if (cur >= GEN_DAILY_LIMIT) {
        const err = new Error('今日生成次数已达上限');
        err.code = 'GEN_LIMITED';
        throw err;
      }
      await t.collection('gen_limits').doc(lid).set({ data: { openid, date, count: cur + 1 } });
    });
  } catch (e) {
    if (e && e.code === 'GEN_LIMITED') return { ok: false, code: 'GEN_LIMITED', message: e.message };
    throw e;
  }

  // 4. 建任务
  await col.doc(taskId).set({
    data: {
      openid,
      name,
      score: Number(info.score) || 0,
      baikeDesc: String(info.baikeDesc || '').slice(0, 1000),
      status: 'pending',
      speciesId: '',
      error: '',
      retryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  });
  return { ok: true, taskId };
}

/**
 * 处理单个任务：逐 item 推进（已收录入库 / 未收录建任务或查生成状态入库）
 * @param {Object} task - batch_tasks 文档
 * @returns {Promise<void>}
 */
async function processTask(task) {
  const col = db.collection('batch_tasks');
  const openid = task.openid;
  const items = (task.items || []).slice();
  let changed = false;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // 终态/特殊态跳过：done/fail 终态；nonPlant（未识别出花朵）/duplicate（重复照片）不入库，任务中如实保留供详情展示
    if (it.itemStatus === 'done' || it.itemStatus === 'fail') continue;
    if (it.itemStatus === 'nonPlant' || it.itemStatus === 'duplicate') continue;

    if (it.speciesId) {
      // 已收录花：直接入库
      const r = await saveCardCore(openid, it.speciesId, it.fileID);
      items[i] = Object.assign({}, it, r.ok
        ? { itemStatus: 'done', meetCount: r.meetCount, newCard: r.newCard, failMsg: '' }
        : { itemStatus: 'fail', failMsg: r.message || '入库失败' });
      changed = true;
    } else if (it.itemStatus === 'pending') {
      // 未收录花：建生成任务
      const r = await createGenTask(openid, { name: it.name, score: it.score, baikeDesc: it.baikeDesc });
      if (r.alreadyExists && r.speciesId) {
        // 已存在：直接入库
        const sr = await saveCardCore(openid, r.speciesId, it.fileID);
        items[i] = Object.assign({}, it, { speciesId: r.speciesId }, sr.ok
          ? { itemStatus: 'done', meetCount: sr.meetCount, newCard: sr.newCard, failMsg: '' }
          : { itemStatus: 'fail', failMsg: sr.message || '入库失败' });
      } else if (r.ok && r.taskId) {
        items[i] = Object.assign({}, it, { itemStatus: 'generating', genTaskId: r.taskId });
      } else {
        items[i] = Object.assign({}, it, { itemStatus: 'fail', failMsg: r.message || '创建生成任务失败' });
      }
      changed = true;
    } else if (it.itemStatus === 'generating') {
      // 未收录花：查生成任务状态
      const gid = it.genTaskId || `${openid}_${normalizeName(it.name)}`;
      const gRes = await db.collection('flower_gen_tasks').doc(gid).get().catch(() => null);
      const g = gRes && gRes.data;
      if (g && g.status === 'done' && g.speciesId) {
        const sr = await saveCardCore(openid, g.speciesId, it.fileID);
        items[i] = Object.assign({}, it, { speciesId: g.speciesId }, sr.ok
          ? { itemStatus: 'done', meetCount: sr.meetCount, newCard: sr.newCard, failMsg: '' }
          : { itemStatus: 'fail', failMsg: sr.message || '入库失败' });
        changed = true;
      } else if (g && g.status === 'failed') {
        items[i] = Object.assign({}, it, { itemStatus: 'fail', failMsg: g.error || '生成失败' });
        changed = true;
      }
      // pending/generating：继续等待（下轮再查）
    }
  }

  if (changed) {
    // 更新任务：items + 状态 + updatedAt
    const statuses = items.map((x) => x.itemStatus);
    const allDone = statuses.every((s) => s === 'done');
    const allTerminal = statuses.every((s) => s === 'done' || s === 'fail');
    let status = task.status;
    if (allDone) status = 'done';
    else if (allTerminal) status = statuses.some((s) => s === 'done') ? 'partial' : 'failed';
    else status = 'processing';
    await col.doc(task._id).update({ data: { items, status, updatedAt: Date.now() } });
  } else {
    // 无变化也要刷新 updatedAt，避免被误判为 stale 重入（生成中等待场景）
    await col.doc(task._id).update({ data: { updatedAt: Date.now() } });
  }
}

exports.main = async () => {
  // 云函数入口：取待处理任务 → 逐个处理，详细说明见文件头
  try {
    // 取任务：优先 pending；其次 processing 且 updatedAt 超 60s（防重入）
    const col = db.collection('batch_tasks');
    const pendingRes = await col.where({ status: 'pending' }).limit(MAX_TASKS_PER_ROUND).get();
    let tasks = pendingRes.data;
    if (tasks.length < MAX_TASKS_PER_ROUND) {
      const staleRes = await col
        .where({ status: 'processing', updatedAt: _.lt(Date.now() - STALE_PROCESSING_MS) })
        .limit(MAX_TASKS_PER_ROUND - tasks.length)
        .get();
      tasks = tasks.concat(staleRes.data);
    }
    if (!tasks.length) return { ok: true, processedTasks: 0 };

    // 标记 processing（防并发重入）
    for (const t of tasks) {
      await col.doc(t._id).update({ data: { status: 'processing', updatedAt: Date.now() } });
    }
    for (const t of tasks) {
      await processTask(t);
    }
    return { ok: true, processedTasks: tasks.length };
  } catch (err) {
    console.error('batchSaveWorker error:', err);
    return { ok: false, code: err.code || 'INTERNAL', message: err.message || '后台任务处理失败' };
  }
};
