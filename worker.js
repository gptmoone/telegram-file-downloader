// ============================================================
// ربات دانلودر ملی - نسخه نهایی کامل با قابلیت‌های پیشرفته
// ============================================================

// ---- قیمت‌های پیش‌فرض (قابل تنظیم از پنل مدیریت) ----
const STARS_AMOUNT = 60;
const USD_AMOUNT = 1;
const NORMAL_DAILY_VOLUME_MB = 600;
const PRO_DAILY_VOLUME_MB = 6144;
const BROADCAST_DELAY_MS = 150;
const BROADCAST_TIMEOUT_MS = 15000;

// ---- تنظیمات صف و پردازش ----
const MAX_CONCURRENT = 6;
const MAX_RETRIES = 1;
const RETRY_INTERVAL = 30000;
const START_WAIT_INTERVAL = 30000;
const MAX_START_WAIT_ATTEMPTS = 2;
const WAIT_INTERVAL = 60000;
const MAX_WAIT_CYCLES = 60;
const REPO_SIZE_LIMIT_GB = 80;
const REPO_SIZE_WARNING_GB = 75;
const TTL_NORMAL = 3600;
const TTL_PRO = 86400;
const DAILY_LIMIT_NORMAL = 2;
const DAILY_LIMIT_PRO = 6;
const DAILY_VOLUME_NORMAL_BYTES = NORMAL_DAILY_VOLUME_MB * 1024 * 1024;
const DAILY_VOLUME_PRO_BYTES = PRO_DAILY_VOLUME_MB * 1024 * 1024;

const GITHUB_OWNER = 'gptmoone';
const GITHUB_REPO = 'telegram-file-downloader';

const lastCallbackProcessed = new Map();

// ============================================================
// کیبوردهای اصلی
// ============================================================

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📥 دریافت لینک ملی", callback_data: "new_link" }],
    [{ text: "📊 آمار لحظه‌ای", callback_data: "stats" }, { text: "👤 وضعیت من", callback_data: "status" }],
    [{ text: "⭐️ عضویت Pro", callback_data: "pro_info" }, { text: "🗑 حذف فایل من", callback_data: "delete_my_file" }],
    [{ text: "❓ راهنما", callback_data: "help" }, { text: "📢 کانال پشتیبانی", url: "https://t.me/maramidownload" }]
  ]
};

function buildAdminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔧 ریست صف", callback_data: "admin_reset_queue" }, { text: "🔧 ریست پردازش‌ها", callback_data: "admin_fix_active" }],
      [{ text: "⭐️ ارتقا به Pro", callback_data: "admin_promote" }, { text: "🔄 ریست سهمیه", callback_data: "admin_reset_quota" }],
      [{ text: "📢 افزودن کانال", callback_data: "admin_set_channel" }, { text: "📋 مشاهده کانال‌ها", callback_data: "admin_show_channels" }],
      [{ text: "📨 پیام همگانی", callback_data: "admin_broadcast" }, { text: "📩 ارسال مستقیم پیام", callback_data: "admin_direct_message" }],
      [{ text: "🎁 مدیریت تخفیف‌ها", callback_data: "admin_discount_menu" }, { text: "📊 وضعیت ارسال", callback_data: "admin_broadcast_status" }],
      [{ text: "🚀 شروع صف", callback_data: "admin_start_queue" }, { text: "💰 تنظیم قیمت‌ها", callback_data: "admin_set_prices" }],
      [{ text: "📦 تنظیم محدودیت‌ها", callback_data: "admin_set_limits" }, { text: "👑 مدیریت پلن‌های Pro", callback_data: "admin_plans_menu" }],
      [{ text: "🔴 حالت بروزرسانی", callback_data: "admin_maintenance_toggle" }, { text: "🖥 مانیتورینگ", callback_data: "admin_monitoring" }],
      [{ text: "🔙 منوی اصلی", callback_data: "back_to_main" }]
    ]
  };
}

const ADMIN_KEYBOARD = buildAdminKeyboard();

// ============================================================
// توابع کمکی ارتباط با تلگرام
// ============================================================

async function sendMessage(chatId, text, keyboard, TOKEN) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: JSON.stringify(keyboard || MAIN_KEYBOARD)
  };
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), BROADCAST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(tid);
    return res;
  } catch (err) { clearTimeout(tid); throw err; }
}

async function sendSimple(chatId, text, TOKEN) {
  return sendMessage(chatId, text, MAIN_KEYBOARD, TOKEN);
}

async function editMessage(chatId, messageId, text, keyboard, TOKEN) {
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: JSON.stringify(keyboard || MAIN_KEYBOARD) })
    });
  } catch (e) { console.error('editMessage error:', e); }
}

async function answerCallback(callbackId, TOKEN) {
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: callbackId })
    });
  } catch (e) { }
}

async function getRepoSize(env) {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`, {
      headers: { 'Authorization': `token ${env.GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Bot/1.0' }
    });
    if (res.ok) { const d = await res.json(); return d.size / (1024 * 1024); }
  } catch (e) { }
  return 0;
}

// ============================================================
// وضعیت موقت ادمین در D1
// ============================================================

async function dbGetAdminState(env, chatId) {
  try {
    const row = await env.DB.prepare('SELECT state_data FROM admin_temp_state WHERE chat_id = ?').bind(chatId).first();
    if (!row) return null;
    return JSON.parse(row.state_data);
  } catch (e) { return null; }
}

async function dbSetAdminState(env, chatId, stateObj) {
  try {
    await env.DB.prepare('INSERT OR REPLACE INTO admin_temp_state (chat_id, state_data, updated_at) VALUES (?, ?, ?)').bind(chatId, JSON.stringify(stateObj), Date.now()).run();
  } catch (e) { console.error('dbSetAdminState error:', e); }
}

async function dbDeleteAdminState(env, chatId) {
  try {
    await env.DB.prepare('DELETE FROM admin_temp_state WHERE chat_id = ?').bind(chatId).run();
  } catch (e) { }
}

// ============================================================
// وضعیت Broadcast در D1
// ============================================================

async function dbSaveBroadcastState(env, adminChatId, state) {
  try {
    await env.DB.prepare('INSERT OR REPLACE INTO broadcast_state (admin_chat_id, total, sent, fail, status, message_id, start_time, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(adminChatId, state.total || 0, state.sent || 0, state.fail || 0, state.status || 'running', state.messageId || null, state.startTime || Date.now(), Date.now()).run();
  } catch (e) { console.error('dbSaveBroadcastState:', e); }
}

async function dbGetBroadcastState(env, adminChatId) {
  try {
    const row = await env.DB.prepare('SELECT * FROM broadcast_state WHERE admin_chat_id = ?').bind(adminChatId).first();
    if (!row) return null;
    return { total: row.total, sent: row.sent, fail: row.fail, status: row.status, messageId: row.message_id, startTime: row.start_time, updatedAt: row.updated_at };
  } catch (e) { return null; }
}

async function dbSetBroadcastCancelled(env, adminChatId) {
  try { await env.DB.prepare('UPDATE broadcast_state SET status = ? WHERE admin_chat_id = ?').bind('cancelled', adminChatId).run(); } catch (e) { }
}

async function dbIsBroadcastCancelled(env, adminChatId) {
  try {
    const row = await env.DB.prepare('SELECT status FROM broadcast_state WHERE admin_chat_id = ?').bind(adminChatId).first();
    return row?.status === 'cancelled';
  } catch (e) { return false; }
}

// ============================================================
// توابع پایگاه داده D1
// ============================================================

async function ensureGlobalStats(env) {
  const row = await env.DB.prepare('SELECT id FROM global_stats WHERE id = 1').first();
  if (!row) await env.DB.prepare('INSERT INTO global_stats (id, total_links, total_volume_gb) VALUES (1, 0, 0)').run();
}

async function dbGetGlobalStats(env) {
  await ensureGlobalStats(env);
  const row = await env.DB.prepare('SELECT total_links, total_volume_gb FROM global_stats WHERE id = 1').first();
  return { total_links: row?.total_links || 0, total_volume_gb: row?.total_volume_gb || 0 };
}

async function dbIncrementLinks(env, volumeGB) {
  await env.DB.prepare('UPDATE global_stats SET total_links = total_links + 1, total_volume_gb = total_volume_gb + ? WHERE id = 1').bind(volumeGB).run();
}

async function dbGetUserState(env, chatId) {
  const row = await env.DB.prepare('SELECT status, request_data, branch_name, started_at, total_chunks, uploaded_chunks FROM user_state WHERE chat_id = ?').bind(chatId).first();
  if (!row) return null;
  return { status: row.status, requestData: row.request_data ? JSON.parse(row.request_data) : null, branchName: row.branch_name, startedAt: row.started_at, totalChunks: row.total_chunks, uploadedChunks: row.uploaded_chunks };
}

async function dbSetUserState(env, chatId, status, requestData = null, branchName = null, startedAt = null, totalChunks = null, uploadedChunks = null) {
  await env.DB.prepare('INSERT OR REPLACE INTO user_state (chat_id, status, request_data, branch_name, started_at, total_chunks, uploaded_chunks) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(chatId, status, requestData ? JSON.stringify(requestData) : null, branchName, startedAt, totalChunks, uploadedChunks).run();
}

async function dbDeleteUserState(env, chatId) {
  await env.DB.prepare('DELETE FROM user_state WHERE chat_id = ?').bind(chatId).run();
}

async function dbGetQueueCount(env, onlyPro) {
  let sql = 'SELECT COUNT(*) as count FROM queue';
  if (onlyPro === true) sql += ' WHERE priority = 1';
  else if (onlyPro === false) sql += ' WHERE priority = 0';
  const row = await env.DB.prepare(sql).first();
  return row?.count || 0;
}

async function dbAddQueue(env, chatId, fileUrl, password, fileSize, isPro = false) {
  await env.DB.prepare('INSERT INTO queue (chat_id, file_url, zip_password, file_size, enqueued_at, priority) VALUES (?, ?, ?, ?, ?, ?)').bind(chatId, fileUrl, password, fileSize, Date.now(), isPro ? 1 : 0).run();
}

async function dbPopQueue(env) {
  let row = await env.DB.prepare('SELECT position, chat_id, file_url, zip_password, file_size FROM queue WHERE priority = 1 ORDER BY position ASC LIMIT 1').first();
  if (!row) row = await env.DB.prepare('SELECT position, chat_id, file_url, zip_password, file_size FROM queue WHERE priority = 0 ORDER BY position ASC LIMIT 1').first();
  if (!row) return null;
  await env.DB.prepare('DELETE FROM queue WHERE position = ?').bind(row.position).run();
  return { chatId: row.chat_id, fileUrl: row.file_url, password: row.zip_password, fileSize: row.file_size };
}

async function dbRemoveFromQueue(env, chatId) {
  await env.DB.prepare('DELETE FROM queue WHERE chat_id = ?').bind(chatId).run();
}

async function dbGetActiveCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) as count FROM user_state WHERE status = ?').bind('processing').first();
  return row?.count || 0;
}

async function dbGetUsersCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
  return row?.count || 0;
}

async function dbAddUser(env, chatId) {
  await env.DB.prepare('INSERT OR IGNORE INTO users (chat_id, first_seen) VALUES (?, ?)').bind(chatId, Date.now()).run();
}

async function dbAddActiveBranch(env, branchName, chatId, createdAt, expiresAt) {
  await env.DB.prepare('INSERT OR REPLACE INTO active_branches (branch_name, chat_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(branchName, chatId, createdAt, expiresAt).run();
}

async function dbRemoveActiveBranch(env, branchName) {
  await env.DB.prepare('DELETE FROM active_branches WHERE branch_name = ?').bind(branchName).run();
}

async function dbGetLastBranch(env, chatId) {
  const row = await env.DB.prepare('SELECT branch_name FROM active_branches WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1').bind(chatId).first();
  return row?.branch_name || null;
}

async function dbSetBranchForUser(env, chatId, branchName, expiresAt) {
  await dbAddActiveBranch(env, branchName, chatId, Date.now(), expiresAt);
  await env.DB.prepare('UPDATE user_state SET branch_name = ? WHERE chat_id = ?').bind(branchName, chatId).run();
}

async function getAllUsers(env) {
  const rows = await env.DB.prepare('SELECT chat_id FROM users').all();
  return rows.results.map(r => r.chat_id);
}

// ============================================================
// توابع تنظیمات ربات (قابل تنظیم از پنل)
// ============================================================

async function getBotSettings(env) {
  try {
    const row = await env.DB.prepare('SELECT setting_key, setting_value FROM bot_settings').all();
    const settings = {};
    for (const r of (row.results || [])) {
      settings[r.setting_key] = r.setting_value;
    }
    return settings;
  } catch { return {}; }
}

async function setBotSetting(env, key, value) {
  try {
    await env.DB.prepare('INSERT OR REPLACE INTO bot_settings (setting_key, setting_value) VALUES (?, ?)').bind(key, String(value)).run();
  } catch (e) { console.error('setBotSetting error:', e); }
}

async function getEffectiveStarsPrice(env) {
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'stars_price'").first();
    return row ? parseInt(row.setting_value) : STARS_AMOUNT;
  } catch { return STARS_AMOUNT; }
}

async function getEffectiveUsdPrice(env) {
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'usd_price'").first();
    return row ? parseFloat(row.setting_value) : USD_AMOUNT;
  } catch { return USD_AMOUNT; }
}

async function getMaintenanceMode(env) {
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'maintenance_mode'").first();
    return row?.setting_value === '1';
  } catch { return false; }
}

async function getMaintenanceExceptions(env) {
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'maintenance_exceptions'").first();
    if (!row || !row.setting_value) return [];
    return JSON.parse(row.setting_value);
  } catch { return []; }
}

async function getNormalFileSizeLimitMB(env) {
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'normal_file_size_limit_mb'").first();
    return row ? parseInt(row.setting_value) : 200;
  } catch { return 200; }
}

async function getProFileSizeLimitMB(env) {
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'pro_file_size_limit_mb'").first();
    return row ? parseInt(row.setting_value) : 2048;
  } catch { return 2048; }
}

async function getNormalMaxTimeSec(env) {
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'normal_max_time_sec'").first();
    return row ? parseInt(row.setting_value) : TTL_NORMAL;
  } catch { return TTL_NORMAL; }
}

async function getProMaxTimeSec(env) {
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'pro_max_time_sec'").first();
    return row ? parseInt(row.setting_value) : TTL_PRO;
  } catch { return TTL_PRO; }
}

// ============================================================
// توابع محدودیت روزانه
// ============================================================

async function getDailyLimit(env, chatId) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  let row = await env.DB.prepare('SELECT file_count, reset_date, daily_volume_bytes FROM daily_limits WHERE chat_id = ?').bind(chatId).first();
  if (!row || row.reset_date < todayStart) {
    await env.DB.prepare('INSERT OR REPLACE INTO daily_limits (chat_id, file_count, reset_date, daily_volume_bytes) VALUES (?, 0, ?, 0)').bind(chatId, todayStart).run();
    row = { file_count: 0, reset_date: todayStart, daily_volume_bytes: 0 };
  }
  return { fileCount: row.file_count || 0, resetDate: row.reset_date, dailyVolumeBytes: row.daily_volume_bytes || 0 };
}

async function incrementDailyLimit(env, chatId, addedVolumeBytes) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  await env.DB.prepare('INSERT INTO daily_limits (chat_id, file_count, reset_date, daily_volume_bytes) VALUES (?, 1, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET file_count = file_count + 1, daily_volume_bytes = daily_volume_bytes + excluded.daily_volume_bytes, reset_date = excluded.reset_date WHERE daily_limits.reset_date >= ?').bind(chatId, todayStart, addedVolumeBytes, todayStart).run();
}

async function canUploadByVolume(env, chatId, fileSizeBytes, isPro, planInfo) {
  const { dailyVolumeBytes } = await getDailyLimit(env, chatId);
  let limitBytes;
  if (isPro && planInfo && planInfo.daily_volume_gb) {
    limitBytes = planInfo.daily_volume_gb * 1024 * 1024 * 1024;
  } else {
    limitBytes = isPro ? DAILY_VOLUME_PRO_BYTES : DAILY_VOLUME_NORMAL_BYTES;
  }
  const remainingBytes = Math.max(0, limitBytes - dailyVolumeBytes);
  return { allowed: (dailyVolumeBytes + fileSizeBytes) <= limitBytes, remainingBytes };
}

async function canUpload(env, chatId, isPro, planInfo) {
  const { fileCount } = await getDailyLimit(env, chatId);
  let limit;
  if (isPro && planInfo && planInfo.daily_files) {
    limit = planInfo.daily_files;
  } else {
    limit = isPro ? DAILY_LIMIT_PRO : DAILY_LIMIT_NORMAL;
  }
  const remaining = Math.max(0, limit - fileCount);
  return { allowed: remaining > 0, current: fileCount, limit, remaining };
}

async function resetUserQuota(env, chatId) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  await env.DB.prepare('INSERT OR REPLACE INTO daily_limits (chat_id, file_count, reset_date, daily_volume_bytes) VALUES (?, 0, ?, 0)').bind(chatId, todayStart).run();
}

async function getRemainingQuotaText(env, chatId, isPro, planInfo) {
  const { remaining, limit } = await canUpload(env, chatId, isPro, planInfo);
  const { remainingBytes } = await canUploadByVolume(env, chatId, 0, isPro, planInfo);
  let limitMB;
  if (isPro && planInfo && planInfo.daily_volume_gb) {
    limitMB = planInfo.daily_volume_gb * 1024;
  } else {
    limitMB = isPro ? DAILY_VOLUME_PRO_BYTES / (1024 * 1024) : DAILY_VOLUME_NORMAL_BYTES / (1024 * 1024);
  }
  return `📊 سهمیه باقیمانده: ${remaining} از ${limit} فایل | ${(remainingBytes / (1024 * 1024)).toFixed(1)} از ${limitMB} مگابایت`;
}

// ============================================================
// توابع عضویت اجباری
// ============================================================

async function getRequiredChannels(env) {
  try {
    const row = await env.DB.prepare('SELECT channels FROM required_channels WHERE id = 1').first();
    if (!row) return [];
    return JSON.parse(row.channels);
  } catch { return []; }
}

async function setRequiredChannels(env, channelsArray) {
  await env.DB.prepare('INSERT OR REPLACE INTO required_channels (id, channels) VALUES (1, ?)').bind(JSON.stringify(channelsArray)).run();
}

async function isUserMemberOfChannels(chatId, channels, TOKEN) {
  if (!channels || channels.length === 0) return true;
  for (const ch of channels) {
    const clean = ch.replace('@', '').trim();
    try {
      const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getChatMember?chat_id=@${clean}&user_id=${chatId}`);
      const data = await res.json();
      if (!data.ok || !data.result || !['member', 'creator', 'administrator'].includes(data.result.status)) return false;
    } catch { return false; }
  }
  return true;
}

async function savePendingLink(env, chatId, fileUrl, fileSize) {
  await env.DB.prepare('INSERT OR REPLACE INTO pending_links (chat_id, file_url, file_size, timestamp) VALUES (?, ?, ?, ?)').bind(chatId, fileUrl, fileSize, Date.now()).run();
}

async function getPendingLink(env, chatId) {
  const row = await env.DB.prepare('SELECT file_url, file_size FROM pending_links WHERE chat_id = ?').bind(chatId).first();
  if (!row) return null;
  await env.DB.prepare('DELETE FROM pending_links WHERE chat_id = ?').bind(chatId).run();
  return { url: row.file_url, fileSize: row.file_size };
}

// ============================================================
// آمار کاربر
// ============================================================

async function incrementUserStats(env, chatId, fileSizeBytes) {
  await env.DB.prepare('INSERT INTO user_stats (chat_id, total_files, total_volume_gb) VALUES (?, 1, ?) ON CONFLICT(chat_id) DO UPDATE SET total_files = total_files + 1, total_volume_gb = total_volume_gb + excluded.total_volume_gb').bind(chatId, fileSizeBytes / (1024 * 1024 * 1024)).run();
}

async function getUserStats(env, chatId) {
  const row = await env.DB.prepare('SELECT total_files, total_volume_gb FROM user_stats WHERE chat_id = ?').bind(chatId).first();
  return row ? { total_files: row.total_files, total_volume_gb: row.total_volume_gb } : { total_files: 0, total_volume_gb: 0 };
}

// ============================================================
// توابع پلن‌های Pro
// ============================================================

async function getProPlans(env) {
  try {
    const rows = await env.DB.prepare('SELECT * FROM pro_plans WHERE is_active = 1 ORDER BY sort_order ASC, id ASC').all();
    return rows.results || [];
  } catch { return []; }
}

async function getAllProPlans(env) {
  try {
    const rows = await env.DB.prepare('SELECT * FROM pro_plans ORDER BY sort_order ASC, id ASC').all();
    return rows.results || [];
  } catch { return []; }
}

async function getProPlanById(env, planId) {
  try {
    const row = await env.DB.prepare('SELECT * FROM pro_plans WHERE id = ?').bind(planId).first();
    return row || null;
  } catch { return null; }
}

async function getUserActivePlan(env, chatId) {
  // اگر کاربر پلن فعال داشته باشد، اطلاعات پلن در زمان خرید را برمی‌گرداند
  try {
    const row = await env.DB.prepare('SELECT plan_snapshot FROM pro_users WHERE chat_id = ? AND expires_at > ?').bind(chatId, Math.floor(Date.now() / 1000)).first();
    if (!row || !row.plan_snapshot) return null;
    return JSON.parse(row.plan_snapshot);
  } catch { return null; }
}

async function getPlanDiscountForPlan(env, planId) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare('SELECT * FROM plan_discounts WHERE plan_id = ? AND active = 1 AND expires_at > ?').bind(planId, now).first();
    return row || null;
  } catch { return null; }
}

// ============================================================
// توابع Pro و پرداخت
// ============================================================

async function isProUser(env, chatId) {
  const row = await env.DB.prepare('SELECT expires_at FROM pro_users WHERE chat_id = ? AND expires_at > ?').bind(chatId, Math.floor(Date.now() / 1000)).first();
  return !!row;
}

async function activateProSubscription(env, chatId, paymentId, amountDesc, TOKEN, planId) {
  const now = Math.floor(Date.now() / 1000);
  let expiresAt = now + (30 * 24 * 60 * 60);
  let planSnapshot = null;
  let planInfo = null;
  let dailyFilesText = DAILY_LIMIT_PRO;
  let dailyVolText = DAILY_VOLUME_PRO_BYTES / (1024 * 1024);
  let planName = 'استاندارد ۳۰ روزه';

  if (planId) {
    const plan = await getProPlanById(env, planId);
    if (plan) {
      expiresAt = now + plan.duration_days * 24 * 60 * 60;
      planSnapshot = JSON.stringify({
        plan_id: plan.id,
        name: plan.name,
        daily_files: plan.daily_files,
        daily_volume_gb: plan.daily_volume_gb,
        duration_days: plan.duration_days,
        activated_at: now,
        expires_at: expiresAt
      });
      planInfo = plan;
      dailyFilesText = plan.daily_files;
      dailyVolText = plan.daily_volume_gb * 1024;
      planName = plan.name;
    }
  }

  await env.DB.prepare('INSERT OR REPLACE INTO pro_users (chat_id, expires_at, payment_id, activated_at, plan_snapshot) VALUES (?, ?, ?, ?, ?)').bind(chatId, expiresAt, paymentId, now, planSnapshot).run();

  await sendMessage(chatId,
    `✅ <b>عضویت Pro فعال شد!</b>\n\n💎 پلن: ${planName}\n💳 پرداخت: ${amountDesc}\n📅 انقضا: ${new Date(expiresAt * 1000).toLocaleDateString('fa-IR')}\n\n🎁 <b>مزایا:</b>\n• دانلود با اینترنت ملی و صرفه‌جویی در حجم وی‌پی‌ان\n• نگهداری فایل تا ${planInfo ? planInfo.duration_days + ' روز' : '۱ روز'}\n• اولویت در صف\n• ${dailyFilesText} فایل و ${dailyVolText} مگابایت در روز`,
    MAIN_KEYBOARD, TOKEN);
}

// ============================================================
// توابع تخفیف (سیستم قدیمی - برای سازگاری حفظ شده)
// ============================================================

async function getDiscountSettings(env) {
  try {
    const row = await env.DB.prepare('SELECT active, stars_price, usd_price, expires_at FROM discount_settings WHERE id = 1').first();
    if (!row || row.active !== 1) return null;
    if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) { await env.DB.prepare('UPDATE discount_settings SET active = 0 WHERE id = 1').run(); return null; }
    return { starsPrice: row.stars_price, usdPrice: row.usd_price, expiresAt: row.expires_at };
  } catch { return null; }
}

async function setDiscount(env, starsPrice, usdPrice, durationHours) {
  await env.DB.prepare('INSERT OR REPLACE INTO discount_settings (id, active, stars_price, usd_price, expires_at) VALUES (1, 1, ?, ?, ?)').bind(starsPrice, usdPrice, Math.floor(Date.now() / 1000) + durationHours * 3600).run();
}

async function clearDiscount(env) {
  await env.DB.prepare('UPDATE discount_settings SET active = 0 WHERE id = 1').run();
}

// ============================================================
// توابع پرداخت
// ============================================================

async function createNowPaymentsInvoice(env, chatId, amountUSD, planId) {
  try {
    const orderId = planId ? `pro_${chatId}_${planId}_${Date.now()}` : `pro_${chatId}_${Date.now()}`;
    const response = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: { 'x-api-key': env.NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_amount: amountUSD, price_currency: "usd", pay_currency: "ton", order_id: orderId, order_description: "اشتراک Pro", ipn_callback_url: "https://telegram-file-bot.gptmoone.workers.dev/api/nowpayments-webhook", success_url: "https://t.me/MeliDownloadBot", cancel_url: "https://t.me/MeliDownloadBot" })
    });
    const data = await response.json();
    return data.invoice_url ? { success: true, invoiceUrl: data.invoice_url, orderId } : { success: false };
  } catch { return { success: false }; }
}

async function createStarsInvoiceLink(env, chatId, starsAmount, planId) {
  try {
    const payload = planId ? `stars:${chatId}:${planId}:${Date.now()}` : `stars:${chatId}:${Date.now()}`;
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/createInvoiceLink`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: "Pro Subscription", description: "اشتراک Pro", payload, provider_token: "", currency: "XTR", prices: [{ label: "Pro", amount: starsAmount }] })
    });
    const data = await res.json();
    return data.ok ? { success: true, invoiceLink: data.result, payload } : { success: false };
  } catch { return { success: false }; }
}

// ============================================================
// توابع گیت‌هاب
// ============================================================

async function getFileSize(url) {
  try { const h = await fetch(url, { method: 'HEAD' }); const s = h.headers.get('content-length'); return s ? parseInt(s) : null; } catch { return null; }
}

async function getBranchTotalSize(env, branchName) {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${branchName}?recursive=1`, {
      headers: { 'Authorization': `token ${env.GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Bot/1.0' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.tree || []).filter(i => i.type === 'blob').reduce((s, i) => s + (i.size || 0), 0);
  } catch { return null; }
}

async function deleteBranchFromGitHub(env, branchName) {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchName}`, {
      method: 'DELETE', headers: { 'Authorization': `token ${env.GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Bot/1.0' }
    });
    return res.ok || res.status === 404;
  } catch { return false; }
}

async function deleteUserBranch(env, chatId) {
  const lastBranch = await dbGetLastBranch(env, chatId);
  if (lastBranch) { await deleteBranchFromGitHub(env, lastBranch); await dbRemoveActiveBranch(env, lastBranch); }
}

// ============================================================
// دستورات ادمین
// ============================================================

async function adminPromoteToPro(env, targetUserId, adminSecret, providedSecret) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE chat_id = ?').bind(targetUserId).first();
  if (!exists) return "❌ کاربر یافت نشد.";
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 30 * 24 * 60 * 60;
  await env.DB.prepare('INSERT OR REPLACE INTO pro_users (chat_id, expires_at, payment_id, activated_at) VALUES (?, ?, ?, ?)').bind(targetUserId, expiresAt, `admin_${Date.now()}`, now).run();
  return `✅ کاربر ${targetUserId} به Pro ارتقا یافت.\nانقضا: ${new Date(expiresAt * 1000).toLocaleDateString('fa-IR')}`;
}

async function adminResetQuota(env, targetUserId, adminSecret, providedSecret) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE chat_id = ?').bind(targetUserId).first();
  if (!exists) return "❌ کاربر یافت نشد.";
  await resetUserQuota(env, targetUserId);
  return `✅ سهمیه کاربر ${targetUserId} بازنشانی شد.`;
}

async function adminShowChannels(env, chatId, TOKEN) {
  const channels = await getRequiredChannels(env);
  if (channels.length === 0) { await sendMessage(chatId, "ℹ️ هیچ کانال اجباری تنظیم نشده است.", ADMIN_KEYBOARD, TOKEN); return; }
  const keyboard = { inline_keyboard: [] };
  for (const ch of channels) { keyboard.inline_keyboard.push([{ text: `🔗 @${ch}`, url: `https://t.me/${ch}` }, { text: `❌ حذف @${ch}`, callback_data: `admin_remove_channel:${ch}` }]); }
  keyboard.inline_keyboard.push([{ text: "⚠️ حذف همه کانال‌ها", callback_data: "admin_remove_all_channels" }]);
  keyboard.inline_keyboard.push([{ text: "🔙 بازگشت", callback_data: "admin_panel" }]);
  await sendMessage(chatId, "📢 <b>کانال‌های اجباری:</b>", keyboard, TOKEN);
}

// ============================================================
// Broadcast - با پشتیبانی از ارسال واقعی
// ============================================================

async function startBroadcast(env, adminChatId, messageText, TOKEN) {
  const users = await getAllUsers(env);
  const total = users.length;
  if (!total) { await sendMessage(adminChatId, "❌ هیچ کاربری یافت نشد.", ADMIN_KEYBOARD, TOKEN); return; }

  await dbSaveBroadcastState(env, adminChatId, { total, sent: 0, fail: 0, status: 'running', messageId: null, startTime: Date.now() });

  let statusMsgId = null;
  try {
    const r = await sendMessage(adminChatId, `📨 <b>ارسال پیام همگانی آغاز شد</b>\n\n👥 کل: ${total}\n📊 ۰ از ${total} (۰٪)\n✅ موفق: ۰ | ❌ ناموفق: ۰\n\n⏱️ شروع: ${new Date().toLocaleTimeString('fa-IR')}\n\nبرای لغو: /cancel_broadcast`, ADMIN_KEYBOARD, TOKEN);
    const rd = await r.json();
    statusMsgId = rd.result?.message_id;
    await dbSaveBroadcastState(env, adminChatId, { total, sent: 0, fail: 0, status: 'running', messageId: statusMsgId, startTime: Date.now() });
  } catch (e) { console.error(e); }

  const startTime = Date.now();
  let sent = 0, fail = 0;
  const discount = await getDiscountSettings(env);

  for (let i = 0; i < total; i++) {
    if (await dbIsBroadcastCancelled(env, adminChatId)) {
      const el = Math.round((Date.now() - startTime) / 1000);
      await dbSaveBroadcastState(env, adminChatId, { total, sent, fail, status: 'cancelled', messageId: statusMsgId, startTime });
      if (statusMsgId) await editMessage(adminChatId, statusMsgId, `⛔ <b>ارسال لغو شد</b>\n\n👥 کل: ${total} | ✅ ${sent} | ❌ ${fail}\n⏱️ ${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`, ADMIN_KEYBOARD, TOKEN);
      return;
    }

    const userChatId = users[i];
    const kb = discount
      ? { inline_keyboard: [[{ text: `🎁 اشتراک Pro با تخفیف`, callback_data: "discount_pro" }], ...MAIN_KEYBOARD.inline_keyboard] }
      : { inline_keyboard: [[{ text: `⭐️ خرید اشتراک Pro`, callback_data: "pro_info" }], ...MAIN_KEYBOARD.inline_keyboard] };

    try {
      const res = await Promise.race([
        fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: userChatId, text: messageText, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: JSON.stringify(kb) })
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), BROADCAST_TIMEOUT_MS))
      ]);
      const rd = await res.json().catch(() => ({ ok: false }));
      rd.ok ? sent++ : fail++;
    } catch { fail++; }

    if ((i + 1) % 15 === 0 || i === total - 1) {
      const el = Math.round((Date.now() - startTime) / 1000);
      const pct = Math.round((i + 1) / total * 100);
      await dbSaveBroadcastState(env, adminChatId, { total, sent, fail, status: 'running', messageId: statusMsgId, startTime });
      if (statusMsgId) await editMessage(adminChatId, statusMsgId, `📨 <b>در حال ارسال...</b>\n\n📊 ${i + 1} از ${total} (${pct}٪)\n✅ موفق: ${sent} | ❌ ناموفق: ${fail}\n⏱️ ${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}\n🕐 ${new Date().toLocaleTimeString('fa-IR')}\n\nلغو: /cancel_broadcast`, ADMIN_KEYBOARD, TOKEN);
    }

    if (i < total - 1) await new Promise(r => setTimeout(r, BROADCAST_DELAY_MS));
  }

  const el = Math.round((Date.now() - startTime) / 1000);
  await dbSaveBroadcastState(env, adminChatId, { total, sent, fail, status: 'completed', messageId: statusMsgId, startTime });
  if (statusMsgId) await editMessage(adminChatId, statusMsgId, `✅ <b>ارسال تکمیل شد!</b>\n\n👥 کل: ${total}\n✅ موفق: ${sent} | ❌ ناموفق: ${fail}\n📈 ${Math.round(sent / total * 100)}٪\n⏱️ ${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}\n🕐 ${new Date().toLocaleTimeString('fa-IR')}`, ADMIN_KEYBOARD, TOKEN);
}

// ============================================================
// پردازش فایل
// ============================================================

async function sendWorkflowRequest(chatId, fileUrl, password, userId, env) {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/download.yml/dispatches`, {
      method: 'POST', headers: { 'Authorization': `token ${env.GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Bot/1.0' },
      body: JSON.stringify({ ref: 'main', inputs: { file_url: fileUrl, zip_password: password, user_id: userId } })
    });
    return res.ok;
  } catch { return false; }
}

async function runTaskWithRetry(chatId, fileUrl, password, env, TOKEN) {
  const userId = `${chatId}_${Date.now()}`;
  let sent = false;
  for (let r = 0; r <= MAX_RETRIES && !sent; r++) {
    sent = await sendWorkflowRequest(chatId, fileUrl, password, userId, env);
    if (!sent && r < MAX_RETRIES) { await sendSimple(chatId, `⚠️ تلاش ${r + 1} ناموفق. تلاش مجدد...`, TOKEN); await new Promise(x => setTimeout(x, RETRY_INTERVAL)); }
  }
  if (!sent) { await sendSimple(chatId, "❌ ارسال به گیت‌هاب شکست خورد.", TOKEN); await finishTask(env); return; }

  let started = false;
  for (let i = 0; i < MAX_START_WAIT_ATTEMPTS; i++) {
    await new Promise(x => setTimeout(x, START_WAIT_INTERVAL));
    const st = await dbGetUserState(env, chatId);
    if (st?.startedAt) { started = true; break; }
  }
  if (!started) await sendSimple(chatId, "⚠️ پردازش شروع نشد. با «وضعیت من» پیگیری کنید.", TOKEN);

  for (let i = 0; i < MAX_WAIT_CYCLES; i++) {
    await new Promise(x => setTimeout(x, WAIT_INTERVAL));
    const st = await dbGetUserState(env, chatId);
    if (st?.branchName) return;
  }
  await sendSimple(chatId, "❌ زمان انتظار تمام شد. با «وضعیت من» بررسی کنید.", TOKEN);
  await finishTask(env);
}

async function finishTask(env) {
  const next = await dbPopQueue(env);
  if (next) {
    await dbSetUserState(env, next.chatId, 'processing', { url: next.fileUrl, password: next.password, fileSize: next.fileSize });
    runTaskWithRetry(next.chatId, next.fileUrl, next.password, env, env.TELEGRAM_TOKEN).catch(console.error);
    await sendSimple(next.chatId, "🔄 نوبت شما رسید! در حال پردازش...", env.TELEGRAM_TOKEN);
  }
}

// ============================================================
// پردازش لینک - با قابلیت پندینگ برای کاربران عادی با حجم زیاد
// ============================================================

async function processPendingLink(env, chatId, fileUrl, fileSize, TOKEN) {
  const isPro = await isProUser(env, chatId);
  const planInfo = isPro ? await getUserActivePlan(env, chatId) : null;
  const { allowed, remaining, limit } = await canUpload(env, chatId, isPro, planInfo);

  if (!allowed) {
    await sendMessage(chatId, `❌ به سهمیه روزانه (${limit} فایل) رسیده‌اید.`, { inline_keyboard: [[{ text: "⭐️ خرید Pro", callback_data: "pro_info" }]] }, TOKEN);
    return;
  }

  await deleteUserBranch(env, chatId);
  await dbDeleteUserState(env, chatId);
  await dbRemoveFromQueue(env, chatId);

  const repoSize = await getRepoSize(env);
  if (repoSize >= REPO_SIZE_LIMIT_GB) { await sendMessage(chatId, `❌ مخزن پر است. بعداً تلاش کنید.`, MAIN_KEYBOARD, TOKEN); return; }
  if (repoSize >= REPO_SIZE_WARNING_GB) await sendMessage(chatId, `⚠️ مخزن نزدیک به پر شدن (${repoSize.toFixed(1)} از ${REPO_SIZE_LIMIT_GB} گیگابایت).`, MAIN_KEYBOARD, TOKEN);

  const actualFileSize = fileSize || await getFileSize(fileUrl);

  // بررسی حد حجم فایل از تنظیمات پنل
  const normalSizeLimitMB = await getNormalFileSizeLimitMB(env);
  const proSizeLimitMB = await getProFileSizeLimitMB(env);
  const maxFileSizeMB = isPro ? proSizeLimitMB : 2048; // حداکثر ۲ گیگابایت
  if (actualFileSize && actualFileSize > maxFileSizeMB * 1024 * 1024) {
    await sendMessage(chatId, `❌ حجم فایل بیشتر از ${maxFileSizeMB} مگابایت است.`, MAIN_KEYBOARD, TOKEN);
    return;
  }

  // اگر کاربر عادی است و حجم فایل از حد تعیین‌شده بیشتر است - پندینگ کنید
  if (!isPro && actualFileSize && actualFileSize > normalSizeLimitMB * 1024 * 1024) {
    // فایل را پردازش کنید ولی لینک را ذخیره کنید تا بعد از Pro شدن ارسال شود
    await env.DB.prepare('INSERT OR REPLACE INTO oversized_pending (chat_id, file_url, file_size, created_at) VALUES (?, ?, ?, ?)').bind(chatId, fileUrl, actualFileSize || 0, Date.now()).run();
    await dbSetUserState(env, chatId, 'awaiting_password', { url: fileUrl, fileSize: actualFileSize || 0, oversized: true, normalLimitMB: normalSizeLimitMB });
    await sendMessage(chatId,
      `⚠️ <b>حجم فایل بیش از حد مجاز کاربران عادی است!</b>\n\n📦 حجم فایل: ${((actualFileSize || 0) / (1024 * 1024)).toFixed(1)} مگابایت\n🚫 حد مجاز عادی: ${normalSizeLimitMB} مگابایت\n\n✅ <b>آپلود شما انجام خواهد شد</b> ولی برای دریافت لینک، باید اشتراک Pro تهیه کنید.\n\n🔐 ابتدا رمز عبور ZIP را وارد کنید:\n\n📊 سهمیه: ${remaining} از ${limit} فایل`,
      { inline_keyboard: [[{ text: "❌ لغو", callback_data: "cancel_input" }]] }, TOKEN);
    return;
  }

  const vc = await canUploadByVolume(env, chatId, actualFileSize || 0, isPro, planInfo);
  if (!vc.allowed) {
    const limitMB = isPro ? (planInfo?.daily_volume_gb ? planInfo.daily_volume_gb * 1024 : DAILY_VOLUME_PRO_BYTES / (1024 * 1024)) : DAILY_VOLUME_NORMAL_BYTES / (1024 * 1024);
    await sendMessage(chatId, `❌ حجم فایل (${((actualFileSize || 0) / (1024 * 1024)).toFixed(1)} مگابایت) بیشتر از سهمیه باقیمانده (${(vc.remainingBytes / (1024 * 1024)).toFixed(1)} مگابایت) است.\nمحدودیت روزانه: ${limitMB} مگابایت`, { inline_keyboard: [[{ text: "⭐️ خرید Pro", callback_data: "pro_info" }]] }, TOKEN);
    return;
  }

  await dbSetUserState(env, chatId, 'awaiting_password', { url: fileUrl, fileSize: actualFileSize || 0 });
  await sendMessage(chatId, `✅ <b>لینک دریافت شد!</b>\n\n🔐 رمز عبور ZIP را وارد کنید:\n\n📊 سهمیه: ${remaining} از ${limit} فایل`, { inline_keyboard: [[{ text: "❌ لغو", callback_data: "cancel_input" }]] }, TOKEN);
}

// ============================================================
// نمایش پلن‌های Pro به کاربر
// ============================================================

async function showProPlansToUser(env, chatId, TOKEN) {
  const isPro = await isProUser(env, chatId);
  if (isPro) {
    const row = await env.DB.prepare('SELECT expires_at, plan_snapshot FROM pro_users WHERE chat_id = ?').bind(chatId).first();
    let planName = 'استاندارد';
    if (row?.plan_snapshot) {
      try { const ps = JSON.parse(row.plan_snapshot); planName = ps.name || 'استاندارد'; } catch {}
    }
    const planInfo = await getUserActivePlan(env, chatId);
    const dailyFiles = planInfo?.daily_files || DAILY_LIMIT_PRO;
    const dailyVolMB = planInfo?.daily_volume_gb ? planInfo.daily_volume_gb * 1024 : DAILY_VOLUME_PRO_BYTES / (1024 * 1024);
    await sendMessage(chatId,
      `⭐️ <b>اشتراک Pro فعال است</b>\n\n📦 پلن: ${planName}\n📅 انقضا: ${new Date(row.expires_at * 1000).toLocaleDateString('fa-IR')}\n\n🎁 مزایا:\n• دانلود با اینترنت ملی\n• اولویت در صف\n• ${dailyFiles} فایل و ${dailyVolMB} مگابایت در روز`,
      MAIN_KEYBOARD, TOKEN);
    return;
  }

  const plans = await getProPlans(env);
  const baseStars = await getEffectiveStarsPrice(env);
  const baseUsd = await getEffectiveUsdPrice(env);
  const globalDiscount = await getDiscountSettings(env);

  if (!plans || plans.length === 0) {
    // اگر پلنی ثبت نشده، فقط پلن پیش‌فرض نمایش داده می‌شود
    const sa = globalDiscount ? globalDiscount.starsPrice : baseStars;
    const ua = globalDiscount ? globalDiscount.usdPrice : baseUsd;
    const si = await createStarsInvoiceLink(env, chatId, sa, null);
    const ci = await createNowPaymentsInvoice(env, chatId, ua, null);
    const rows = [];
    if (si.success) rows.push([{ text: `⭐️ خرید با Stars — ${sa} ستاره`, url: si.invoiceLink }]);
    if (ci.success) rows.push([{ text: `💰 ارز دیجیتال — ${ua} USD`, url: ci.invoiceUrl }]);
    rows.push([{ text: "🔙 بازگشت", callback_data: "back_to_main" }]);
    if (rows.length === 1) { await sendMessage(chatId, "❌ روش پرداختی در دسترس نیست.", MAIN_KEYBOARD, TOKEN); return; }
    let msg = `⭐️ <b>عضویت Pro</b>\n\n🎁 مزایا:\n• دانلود با اینترنت ملی و صرفه‌جویی در حجم وی‌پی‌ان\n• نگهداری فایل تا <b>۱ روز</b> (عادی ۱ ساعت)\n• اولویت در صف\n• <b>${DAILY_LIMIT_PRO} فایل و ${DAILY_VOLUME_PRO_BYTES / (1024 * 1024)} مگابایت</b> در روز\n\n💰 هزینه:\n`;
    if (globalDiscount) {
      const tl = Math.max(0, Math.round((globalDiscount.expiresAt - Math.floor(Date.now() / 1000)) / 60));
      msg += `\n🎉 <b>تخفیف ویژه</b> ⏰ ${tl > 60 ? Math.floor(tl / 60) + ' ساعت' : tl + ' دقیقه'} باقیمانده\n<s>${baseStars}⭐ | ${baseUsd}$</s>  ➡️  <b>${sa}⭐ | ${ua}$</b>`;
    } else {
      msg += `• Stars: <b>${sa} ستاره</b>\n• ارز دیجیتال: <b>${ua} USD</b>`;
    }
    await sendMessage(chatId, msg, { inline_keyboard: rows }, TOKEN);
    return;
  }

  // نمایش پلن‌ها
  let msg = `⭐️ <b>پلن‌های عضویت Pro</b>\n\n`;
  const rows = [];

  for (const plan of plans) {
    const planDiscount = await getPlanDiscountForPlan(env, plan.id);
    const starsPrice = planDiscount ? Math.round(plan.stars_price * (1 - planDiscount.discount_percent / 100)) : plan.stars_price;
    const usdPrice = planDiscount ? parseFloat((plan.usd_price * (1 - planDiscount.discount_percent / 100)).toFixed(2)) : plan.usd_price;

    if (planDiscount) {
      const tl = Math.max(0, Math.round((planDiscount.expires_at - Math.floor(Date.now() / 1000)) / 60));
      msg += `🏷 <b>${plan.name}</b>\n`;
      msg += `   📅 مدت: ${plan.duration_days} روز\n`;
      msg += `   📁 ${plan.daily_files} فایل/روز | 💾 ${plan.daily_volume_gb} گیگابایت/روز\n`;
      msg += `   🎉 تخفیف ${planDiscount.discount_percent}٪ | ⏰ ${tl > 60 ? Math.floor(tl / 60) + ' ساعت' : tl + ' دقیقه'}\n`;
      msg += `   💰 <s>${plan.stars_price}⭐ | ${plan.usd_price}$</s>  ➡️  <b>${starsPrice}⭐ | ${usdPrice}$</b>\n\n`;
    } else {
      msg += `🔹 <b>${plan.name}</b>\n`;
      msg += `   📅 مدت: ${plan.duration_days} روز\n`;
      msg += `   📁 ${plan.daily_files} فایل/روز | 💾 ${plan.daily_volume_gb} گیگابایت/روز\n`;
      msg += `   💰 ${plan.stars_price}⭐ | ${plan.usd_price}$\n\n`;
    }

    rows.push([{ text: `${planDiscount ? '🎉' : '⭐️'} ${plan.name} — ${starsPrice}⭐`, callback_data: `buy_plan_stars:${plan.id}` }, { text: `💰 ${usdPrice}$`, callback_data: `buy_plan_usd:${plan.id}` }]);
  }

  rows.push([{ text: "🔙 بازگشت", callback_data: "back_to_main" }]);
  await sendMessage(chatId, msg, { inline_keyboard: rows }, TOKEN);
}

// ============================================================
// ایجاد جداول لازم
// ============================================================

async function ensureTables(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_temp_state (chat_id TEXT PRIMARY KEY, state_data TEXT, updated_at INTEGER)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS broadcast_state (admin_chat_id TEXT PRIMARY KEY, total INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, fail INTEGER DEFAULT 0, status TEXT DEFAULT 'idle', message_id INTEGER, start_time INTEGER, updated_at INTEGER)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS bot_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pro_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, duration_days INTEGER NOT NULL, daily_files INTEGER NOT NULL, daily_volume_gb REAL NOT NULL, stars_price INTEGER NOT NULL, usd_price REAL NOT NULL, is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS plan_discounts (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, discount_percent REAL NOT NULL, active INTEGER DEFAULT 1, expires_at INTEGER NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS oversized_pending (chat_id TEXT PRIMARY KEY, file_url TEXT, file_size INTEGER, created_at INTEGER)`).run();
  // اضافه کردن ستون plan_snapshot به جدول pro_users اگر وجود نداشته باشد
  try { await env.DB.prepare(`ALTER TABLE pro_users ADD COLUMN plan_snapshot TEXT`).run(); } catch {}
}

function getMainKeyboardForAdmin(adminChatId, chatId) {
  const kb = {
    inline_keyboard: [
      [{ text: "📥 دریافت لینک ملی", callback_data: "new_link" }],
      [{ text: "📊 آمار لحظه‌ای", callback_data: "stats" }, { text: "👤 وضعیت من", callback_data: "status" }],
      [{ text: "⭐️ عضویت Pro", callback_data: "pro_info" }, { text: "🗑 حذف فایل من", callback_data: "delete_my_file" }],
      [{ text: "❓ راهنما", callback_data: "help" }, { text: "📢 کانال پشتیبانی", url: "https://t.me/maramidownload" }]
    ]
  };
  if (adminChatId && chatId === adminChatId) kb.inline_keyboard.push([{ text: "🛠 پنل مدیریت", callback_data: "admin_panel" }]);
  return kb;
}

// ============================================================
// Export اصلی
// ============================================================

export default {
  async fetch(request, env) {
    const urlObj = new URL(request.url);
    const path = urlObj.pathname;
    const TOKEN = env.TELEGRAM_TOKEN;
    const ADMIN_SECRET = env.ADMIN_SECRET || '';
    const ADMIN_CHAT_ID = env.ADMIN_CHAT_ID || '';

    try { await ensureTables(env); } catch (e) { }
    try { await ensureGlobalStats(env); } catch (e) { }

    // ============================================================
    // API Endpoints
    // ============================================================

    if (path === '/api/cleanup-branches' && request.method === 'POST') {
      try {
        const { secret } = await request.json();
        if (secret !== ADMIN_SECRET) return new Response('Unauthorized', { status: 401 });
        const now = Math.floor(Date.now() / 1000);
        const expired = await env.DB.prepare('SELECT branch_name FROM active_branches WHERE expires_at <= ?').bind(now).all();
        let deleted = 0;
        for (const b of expired.results) { if (await deleteBranchFromGitHub(env, b.branch_name)) { await dbRemoveActiveBranch(env, b.branch_name); deleted++; } }
        return new Response(JSON.stringify({ deleted }), { headers: { 'Content-Type': 'application/json' } });
      } catch { return new Response('Error', { status: 500 }); }
    }

    if (path === '/api/nowpayments-webhook' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (body.payment_status === 'finished') {
          const parts = body.order_id.split('_');
          const chatId = parts[1];
          const planId = parts[2] && !isNaN(parts[2]) ? parseInt(parts[2]) : null;
          await activateProSubscription(env, chatId, body.order_id, `${body.price_amount || 0} USD`, TOKEN, planId);
        }
        return new Response('OK');
      } catch { return new Response('Error', { status: 500 }); }
    }

    if (path === '/api/started' && request.method === 'POST') {
      try {
        const { user_id } = await request.json();
        if (user_id) { const chatId = user_id.split('_')[0]; await env.DB.prepare('UPDATE user_state SET started_at = ? WHERE chat_id = ?').bind(Date.now(), chatId).run(); await sendMessage(chatId, "🔄 پردازش روی گیت‌هاب آغاز شد...", MAIN_KEYBOARD, TOKEN); }
        return new Response('OK');
      } catch { return new Response('OK'); }
    }

    if (path === '/api/progress' && request.method === 'POST') {
      try {
        const { user_id, total_chunks, uploaded_chunks } = await request.json();
        if (user_id) { const chatId = user_id.split('_')[0]; if (total_chunks) await env.DB.prepare('UPDATE user_state SET total_chunks = ? WHERE chat_id = ?').bind(total_chunks, chatId).run(); if (uploaded_chunks !== undefined) await env.DB.prepare('UPDATE user_state SET uploaded_chunks = ? WHERE chat_id = ?').bind(uploaded_chunks, chatId).run(); }
        return new Response('OK');
      } catch { return new Response('OK'); }
    }

    if (path === '/api/complete' && request.method === 'POST') {
      try {
        const { user_id, branch } = await request.json();
        if (!user_id || !branch) return new Response('OK');
        const chatId = user_id.split('_')[0];
        const isPro = await isProUser(env, chatId);
        const planInfo = isPro ? await getUserActivePlan(env, chatId) : null;
        const totalSizeBytes = await getBranchTotalSize(env, branch) || 0;
        const vc = await canUploadByVolume(env, chatId, totalSizeBytes, isPro, planInfo);

        if (!vc.allowed) {
          await deleteBranchFromGitHub(env, branch);
          await dbRemoveActiveBranch(env, branch);
          await sendMessage(chatId, `❌ حجم فایل بیشتر از سهمیه باقیمانده است.`, { inline_keyboard: [[{ text: "⭐️ خرید Pro", callback_data: "pro_info" }]] }, TOKEN);
          await dbDeleteUserState(env, chatId);
          await finishTask(env);
          return new Response('OK');
        }

        // بررسی oversized_pending - اگر کاربر فایل بزرگ فرستاده و Pro شده، TTL را مثل Pro حساب کن
        let effectiveIsPro = isPro;
        const oversized = await env.DB.prepare('SELECT file_url FROM oversized_pending WHERE chat_id = ?').bind(chatId).first();
        if (oversized) {
          // بررسی می‌کند که آیا کاربر Pro شده است
          effectiveIsPro = isPro;
          await env.DB.prepare('DELETE FROM oversized_pending WHERE chat_id = ?').bind(chatId).run();
        }

        const normalTTL = await getNormalMaxTimeSec(env);
        const proTTL = await getProMaxTimeSec(env);
        const expiresAt = Math.floor(Date.now() / 1000) + (effectiveIsPro ? proTTL : normalTTL);
        await dbSetBranchForUser(env, chatId, branch, expiresAt);
        await env.DB.prepare('UPDATE user_state SET status = ?, branch_name = ? WHERE chat_id = ?').bind('done', branch, chatId).run();
        await dbIncrementLinks(env, totalSizeBytes / (1024 * 1024 * 1024));
        await incrementDailyLimit(env, chatId, totalSizeBytes);
        await incrementUserStats(env, chatId, totalSizeBytes);

        const reqRow = await env.DB.prepare('SELECT request_data FROM user_state WHERE chat_id = ?').bind(chatId).first();
        let password = '';
        if (reqRow?.request_data) { const rd = JSON.parse(reqRow.request_data); password = rd.password || ''; }

        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        const quotaText = await getRemainingQuotaText(env, chatId, effectiveIsPro, planInfo);
        const ttlText = effectiveIsPro ? (planInfo?.duration_days ? planInfo.duration_days + ' روز' : '۱ روز') : `${Math.round(normalTTL / 3600)} ساعت`;

        await sendMessage(chatId,
          `✅ <b>فایل آماده است!</b>\n\n🔗 لینک دانلود (${ttlText} معتبر):\n${link}\n\n🔑 رمز: <code>${password}</code>${totalSizeBytes ? `\n📦 حجم: ${(totalSizeBytes / (1024 * 1024)).toFixed(2)} MB` : ''}\n\n📌 <b>استخراج:</b> با 7-Zip فایل <code>archive.7z.001</code> را استخراج کنید.\n\n${quotaText}`,
          { inline_keyboard: [[{ text: "🗑 حذف فایل از سرور", callback_data: "delete_my_file" }], [{ text: "📥 لینک جدید", callback_data: "new_link" }]] }, TOKEN);

        await dbDeleteUserState(env, chatId);
        await finishTask(env);
        return new Response('OK');
      } catch (err) { console.error('/api/complete error:', err); await finishTask(env).catch(console.error); return new Response('OK'); }
    }

    if (path === '/api/failed' && request.method === 'POST') {
      try {
        const { user_id } = await request.json();
        if (user_id) { const chatId = user_id.split('_')[0]; await dbDeleteUserState(env, chatId); await finishTask(env); await sendMessage(chatId, "❌ پردازش با خطا مواجه شد. دوباره تلاش کنید.", MAIN_KEYBOARD, TOKEN); }
        return new Response('OK');
      } catch { return new Response('OK'); }
    }

    if (path === '/api/cleanup' && request.method === 'POST') {
      try {
        const { user_id } = await request.json();
        if (user_id) { const chatId = user_id.split('_')[0]; await dbDeleteUserState(env, chatId); await dbRemoveFromQueue(env, chatId); }
        return new Response('OK');
      } catch { return new Response('OK'); }
    }

    // ============================================================
    // وب‌هوک تلگرام
    // ============================================================

    if (path === `/bot${TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();

        if (update.message?.chat?.id) await dbAddUser(env, update.message.chat.id.toString());
        if (update.callback_query?.message?.chat?.id) await dbAddUser(env, update.callback_query.message.chat.id.toString());

        // بررسی حالت maintenance برای همه کاربران غیر از admin و exception list
        if (update.message || update.callback_query) {
          const reqChatId = (update.message?.chat?.id || update.callback_query?.message?.chat?.id)?.toString();
          const isMaintenanceActive = await getMaintenanceMode(env);
          if (isMaintenanceActive && reqChatId) {
            const exceptions = await getMaintenanceExceptions(env);
            if (reqChatId !== ADMIN_CHAT_ID && !exceptions.includes(reqChatId)) {
              if (update.callback_query) {
                await answerCallback(update.callback_query.id, TOKEN);
                await sendMessage(reqChatId, "🔧 <b>ربات در حال بروزرسانی است</b>\n\nلطفاً چند دقیقه صبر کنید و دوباره تلاش کنید.\n\nبه زودی بازخواهیم گشت! 🚀", MAIN_KEYBOARD, TOKEN);
              } else if (update.message?.text && update.message.text !== '/start') {
                await sendMessage(reqChatId, "🔧 <b>ربات در حال بروزرسانی است</b>\n\nلطفاً چند دقیقه صبر کنید و دوباره تلاش کنید.\n\nبه زودی بازخواهیم گشت! 🚀", MAIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }
            }
          }
        }

        // لغو broadcast
        if (update.message?.text === '/cancel_broadcast' && update.message.chat.id.toString() === ADMIN_CHAT_ID) {
          await dbSetBroadcastCancelled(env, ADMIN_CHAT_ID);
          await sendMessage(ADMIN_CHAT_ID, "⛔ درخواست لغو ثبت شد.", ADMIN_KEYBOARD, TOKEN);
          return new Response('OK');
        }

        if (update.pre_checkout_query) {
          await fetch(`https://api.telegram.org/bot${TOKEN}/answerPreCheckoutQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pre_checkout_query_id: update.pre_checkout_query.id, ok: true }) });
          return new Response('OK');
        }

        if (update.message?.successful_payment) {
          const chatId = update.message.chat.id.toString();
          const payment = update.message.successful_payment;
          if (payment.invoice_payload?.startsWith('stars:')) {
            const parts = payment.invoice_payload.split(':');
            const payloadChatId = parts[1];
            const planId = parts[2] && !isNaN(parts[2]) ? parseInt(parts[2]) : null;
            if (payloadChatId === chatId) {
              await activateProSubscription(env, chatId, `stars_${payment.telegram_payment_charge_id}`, `${payment.total_amount} ستاره`, TOKEN, planId);
              // بررسی oversized pending - اگر فایل بزرگ داشت لینک بفرست
              const overPend = await env.DB.prepare('SELECT file_url, file_size FROM oversized_pending WHERE chat_id = ?').bind(chatId).first();
              if (overPend) {
                await sendMessage(chatId, `✅ <b>Pro فعال شد!</b>\n\n📦 فایل بزرگ شما در صف ارسال قرار گرفت. لطفاً صبر کنید تا لینک ارسال شود.`, MAIN_KEYBOARD, TOKEN);
              }
            }
          }
          return new Response('OK');
        }

        // ============================================================
        // Callback queries
        // ============================================================

        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = cb.message.chat.id.toString();
          const data = cb.data;
          const now = Date.now();
          const lastTime = lastCallbackProcessed.get(`${chatId}_${data}`) || 0;
          if (now - lastTime < 3000) { await answerCallback(cb.id, TOKEN); return new Response('OK'); }
          lastCallbackProcessed.set(`${chatId}_${data}`, now);
          await answerCallback(cb.id, TOKEN);

          // ---- عضو شدم ----
          if (data === 'check_membership') {
            const pending = await getPendingLink(env, chatId);
            if (!pending) { await sendMessage(chatId, "❌ لینک یافت نشد. دوباره ارسال کنید.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const channels = await getRequiredChannels(env);
            const isMember = await isUserMemberOfChannels(chatId, channels, TOKEN);
            if (!isMember) {
              const jkb = { inline_keyboard: [channels.map(ch => ({ text: `🔗 @${ch}`, url: `https://t.me/${ch}` })), [{ text: "✅ عضو شدم، بررسی کن", callback_data: "check_membership" }]] };
              await sendMessage(chatId, "❌ هنوز در همه کانال‌ها عضو نشده‌اید.", jkb, TOKEN);
              await savePendingLink(env, chatId, pending.url, pending.fileSize);
            } else {
              await processPendingLink(env, chatId, pending.url, pending.fileSize || 0, TOKEN);
            }
            return new Response('OK');
          }

          // ---- لغو ----
          if (data === 'cancel_input') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            await dbDeleteAdminState(env, chatId);
            await sendMessage(chatId, "❌ لغو شد.", getMainKeyboardForAdmin(ADMIN_CHAT_ID, chatId), TOKEN);
            return new Response('OK');
          }

          // ---- منوی اصلی ----
          if (data === 'back_to_main') {
            await dbDeleteAdminState(env, chatId);
            await sendMessage(chatId, "🌀 منوی اصلی", getMainKeyboardForAdmin(ADMIN_CHAT_ID, chatId), TOKEN);
            return new Response('OK');
          }

          // ---- پنل مدیریت ----
          if (data === 'admin_panel') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await dbDeleteAdminState(env, chatId);
            await sendMessage(chatId, "🛠 <b>پنل مدیریت ربات</b>", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- مانیتورینگ ----
          if (data === 'admin_monitoring') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const settings = await getBotSettings(env);
            const starsP = await getEffectiveStarsPrice(env);
            const usdP = await getEffectiveUsdPrice(env);
            const normalVolMB = NORMAL_DAILY_VOLUME_MB;
            const proVolMB = PRO_DAILY_VOLUME_MB;
            const normalTTLh = Math.round((parseInt(settings['normal_max_time_sec'] || TTL_NORMAL)) / 3600);
            const proTTLd = Math.round((parseInt(settings['pro_max_time_sec'] || TTL_PRO)) / 86400);
            const normalSizeMB = settings['normal_file_size_limit_mb'] || '200';
            const proSizeMB = settings['pro_file_size_limit_mb'] || '2048';
            const maintenanceOn = settings['maintenance_mode'] === '1';
            const exceptions = settings['maintenance_exceptions'] ? JSON.parse(settings['maintenance_exceptions']) : [];
            const plansCount = (await getProPlans(env)).length;
            const activeCount = await dbGetActiveCount(env);
            const queueCount = await dbGetQueueCount(env);
            const usersCount = await dbGetUsersCount(env);
            const proUsersCount = (await env.DB.prepare('SELECT COUNT(*) as c FROM pro_users WHERE expires_at > ?').bind(Math.floor(Date.now() / 1000)).first())?.c || 0;
            const globalStats = await dbGetGlobalStats(env);

            await sendMessage(chatId,
              `🖥 <b>مانیتورینگ و وضعیت ربات</b>\n\n` +
              `👥 <b>کاربران:</b> ${usersCount} | ⭐️ Pro: ${proUsersCount}\n` +
              `🔄 در پردازش: ${activeCount} | ⏳ در صف: ${queueCount}\n` +
              `🔗 کل لینک‌ها: ${globalStats.total_links} | 💾 ${globalStats.total_volume_gb.toFixed(2)} GB\n\n` +
              `💰 <b>قیمت‌های فعلی:</b>\n` +
              `   ⭐️ Stars: ${starsP} | 💵 دلار: ${usdP}$\n\n` +
              `📦 <b>محدودیت‌های فعلی:</b>\n` +
              `   📁 حجم روزانه عادی: ${normalVolMB} مگابایت\n` +
              `   📁 حجم روزانه Pro: ${proVolMB} مگابایت\n` +
              `   📏 حجم فایل عادی: ${normalSizeMB} مگابایت\n` +
              `   📏 حجم فایل Pro: ${proSizeMB} مگابایت\n` +
              `   ⏱ ماندگاری عادی: ${normalTTLh} ساعت\n` +
              `   ⏱ ماندگاری Pro: ${proTTLd} روز\n\n` +
              `👑 <b>پلن‌های Pro:</b> ${plansCount} پلن فعال\n\n` +
              `🔴 <b>حالت بروزرسانی:</b> ${maintenanceOn ? 'فعال ⚡' : 'غیرفعال ✅'}\n` +
              `🧪 <b>کاربران استثنا:</b> ${exceptions.length > 0 ? exceptions.join(', ') : 'ندارد'}`,
              ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- toggle حالت بروزرسانی ----
          if (data === 'admin_maintenance_toggle') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const current = await getMaintenanceMode(env);
            if (!current) {
              // فعال کردن maintenance - سوال از چت آی دی استثنا
              await dbSetAdminState(env, chatId, { step: 'awaiting_maintenance_exception' });
              await sendMessage(chatId,
                `🔴 <b>فعال‌سازی حالت بروزرسانی</b>\n\nچت آی دی کاربر آزمایشی (استثنا) را وارد کنید:\nبرای چند کاربر، با کاما جدا کنید: <code>123456,789012</code>\nبرای رد کردن: ارسال کنید <code>skip</code>`,
                ADMIN_KEYBOARD, TOKEN);
            } else {
              await setBotSetting(env, 'maintenance_mode', '0');
              await sendMessage(chatId, "✅ حالت بروزرسانی <b>غیرفعال</b> شد.\n\nربات به حالت عادی بازگشت.", ADMIN_KEYBOARD, TOKEN);
            }
            return new Response('OK');
          }

          // ---- ارسال مستقیم پیام ----
          if (data === 'admin_direct_message') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await dbSetAdminState(env, chatId, { step: 'awaiting_direct_chat_id' });
            await sendMessage(chatId, "📩 <b>ارسال مستقیم پیام</b>\n\nچت آی دی گیرنده را ارسال کنید:", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- تنظیم قیمت‌ها ----
          if (data === 'admin_set_prices') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const starsP = await getEffectiveStarsPrice(env);
            const usdP = await getEffectiveUsdPrice(env);
            await dbSetAdminState(env, chatId, { step: 'awaiting_stars_price' });
            await sendMessage(chatId,
              `💰 <b>تنظیم قیمت پایه (بدون تخفیف)</b>\n\n⭐️ قیمت فعلی Stars: ${starsP}\n💵 قیمت فعلی دلار: ${usdP}$\n\nقیمت جدید Stars را وارد کنید (عدد صحیح):`,
              ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- تنظیم محدودیت‌ها ----
          if (data === 'admin_set_limits') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const normalSizeMB = await getNormalFileSizeLimitMB(env);
            const proSizeMB = await getProFileSizeLimitMB(env);
            const normalTTL = await getNormalMaxTimeSec(env);
            const proTTL = await getProMaxTimeSec(env);
            await dbSetAdminState(env, chatId, { step: 'awaiting_normal_size_limit' });
            await sendMessage(chatId,
              `📦 <b>تنظیم محدودیت‌های فایل</b>\n\n` +
              `📏 حجم مجاز فایل عادی: ${normalSizeMB} مگابایت\n` +
              `📏 حجم مجاز فایل Pro: ${proSizeMB} مگابایت\n` +
              `⏱ ماندگاری عادی: ${Math.round(normalTTL / 3600)} ساعت\n` +
              `⏱ ماندگاری Pro: ${Math.round(proTTL / 86400)} روز\n\n` +
              `حداکثر حجم فایل برای کاربران عادی (مگابایت) را وارد کنید:`,
              ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- مدیریت پلن‌ها ----
          if (data === 'admin_plans_menu') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const plans = await getAllProPlans(env);
            let msg = `👑 <b>مدیریت پلن‌های Pro</b>\n\n`;
            const kb = { inline_keyboard: [] };
            if (plans.length === 0) {
              msg += `هیچ پلنی تعریف نشده است.\n`;
            } else {
              for (const p of plans) {
                msg += `${p.is_active ? '✅' : '❌'} <b>${p.name}</b>\n   ${p.duration_days} روز | ${p.daily_files} فایل/روز | ${p.daily_volume_gb} GB/روز\n   ⭐️${p.stars_price} | 💵${p.usd_price}$\n\n`;
                kb.inline_keyboard.push([
                  { text: `✏️ ${p.name}`, callback_data: `admin_edit_plan:${p.id}` },
                  { text: p.is_active ? '🔴 غیرفعال' : '🟢 فعال', callback_data: `admin_toggle_plan:${p.id}` },
                  { text: '🗑', callback_data: `admin_delete_plan:${p.id}` }
                ]);
              }
            }
            kb.inline_keyboard.push([{ text: "➕ افزودن پلن جدید", callback_data: "admin_add_plan" }]);
            kb.inline_keyboard.push([{ text: "🎁 تنظیم تخفیف پلن‌ها", callback_data: "admin_plan_discounts" }]);
            kb.inline_keyboard.push([{ text: "🔙 بازگشت", callback_data: "admin_panel" }]);
            await sendMessage(chatId, msg, kb, TOKEN);
            return new Response('OK');
          }

          if (data === 'admin_add_plan') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await dbSetAdminState(env, chatId, { step: 'awaiting_plan_name' });
            await sendMessage(chatId, "➕ <b>افزودن پلن جدید Pro</b>\n\nنام پلن را ارسال کنید:\nمثال: <code>ماهانه ویژه</code>", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data.startsWith('admin_edit_plan:')) {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const planId = parseInt(data.split(':')[1]);
            const plan = await getProPlanById(env, planId);
            if (!plan) { await sendMessage(chatId, "❌ پلن یافت نشد.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
            await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_name', planId });
            await sendMessage(chatId,
              `✏️ <b>ویرایش پلن: ${plan.name}</b>\n\nنام جدید پلن را ارسال کنید (یا <code>-</code> برای نگه‌داشتن فعلی):`,
              ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data.startsWith('admin_toggle_plan:')) {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const planId = parseInt(data.split(':')[1]);
            const plan = await getProPlanById(env, planId);
            if (!plan) { await sendMessage(chatId, "❌ پلن یافت نشد.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const newStatus = plan.is_active ? 0 : 1;
            await env.DB.prepare('UPDATE pro_plans SET is_active = ? WHERE id = ?').bind(newStatus, planId).run();
            await sendMessage(chatId, `✅ پلن "${plan.name}" ${newStatus ? 'فعال' : 'غیرفعال'} شد.`, ADMIN_KEYBOARD, TOKEN);
            // نمایش مجدد لیست پلن‌ها
            const plans = await getAllProPlans(env);
            let msg = `👑 <b>مدیریت پلن‌های Pro</b>\n\n`;
            const kb = { inline_keyboard: [] };
            for (const p of plans) {
              msg += `${p.is_active ? '✅' : '❌'} <b>${p.name}</b>\n   ${p.duration_days} روز | ${p.daily_files} فایل/روز | ${p.daily_volume_gb} GB/روز\n   ⭐️${p.stars_price} | 💵${p.usd_price}$\n\n`;
              kb.inline_keyboard.push([
                { text: `✏️ ${p.name}`, callback_data: `admin_edit_plan:${p.id}` },
                { text: p.is_active ? '🔴 غیرفعال' : '🟢 فعال', callback_data: `admin_toggle_plan:${p.id}` },
                { text: '🗑', callback_data: `admin_delete_plan:${p.id}` }
              ]);
            }
            kb.inline_keyboard.push([{ text: "➕ افزودن پلن جدید", callback_data: "admin_add_plan" }]);
            kb.inline_keyboard.push([{ text: "🎁 تنظیم تخفیف پلن‌ها", callback_data: "admin_plan_discounts" }]);
            kb.inline_keyboard.push([{ text: "🔙 بازگشت", callback_data: "admin_panel" }]);
            await sendMessage(chatId, msg, kb, TOKEN);
            return new Response('OK');
          }

          if (data.startsWith('admin_delete_plan:')) {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const planId = parseInt(data.split(':')[1]);
            const plan = await getProPlanById(env, planId);
            if (!plan) { await sendMessage(chatId, "❌ پلن یافت نشد.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
            await env.DB.prepare('DELETE FROM pro_plans WHERE id = ?').bind(planId).run();
            await sendMessage(chatId, `✅ پلن "${plan.name}" حذف شد.`, ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- تخفیف پلن‌ها ----
          if (data === 'admin_plan_discounts') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const plans = await getAllProPlans(env);
            if (plans.length === 0) { await sendMessage(chatId, "❌ هیچ پلنی ثبت نشده. ابتدا پلن بسازید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const kb = { inline_keyboard: [] };
            for (const p of plans) {
              const disc = await getPlanDiscountForPlan(env, p.id);
              const discText = disc ? ` 🎉${disc.discount_percent}٪` : '';
              kb.inline_keyboard.push([{ text: `🎁 ${p.name}${discText}`, callback_data: `admin_set_plan_discount:${p.id}` }]);
            }
            kb.inline_keyboard.push([{ text: "🔙 بازگشت", callback_data: "admin_plans_menu" }]);
            await sendMessage(chatId, "🎁 <b>تنظیم تخفیف برای پلن‌ها</b>\n\nپلن مورد نظر را انتخاب کنید:", kb, TOKEN);
            return new Response('OK');
          }

          if (data.startsWith('admin_set_plan_discount:')) {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const planId = parseInt(data.split(':')[1]);
            const plan = await getProPlanById(env, planId);
            if (!plan) { await sendMessage(chatId, "❌ پلن یافت نشد.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
            await dbSetAdminState(env, chatId, { step: 'awaiting_plan_discount_percent', planId, planName: plan.name });
            await sendMessage(chatId,
              `🎁 <b>تخفیف برای پلن: ${plan.name}</b>\n\nدرصد تخفیف را وارد کنید (مثال: <code>20</code> برای ۲۰٪):\nبرای لغو تخفیف فعلی: <code>0</code>`,
              ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- منوی تخفیف ----
          if (data === 'admin_discount_menu') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const discount = await getDiscountSettings(env);
            let msg = `🎁 <b>مدیریت تخفیف</b>\n\n`;
            if (discount) {
              const tl = Math.max(0, Math.round((discount.expiresAt - Math.floor(Date.now() / 1000)) / 60));
              msg += `✅ تخفیف فعال است\n⭐️ ${discount.starsPrice} | 💵 ${discount.usdPrice}$\n⏳ ${tl > 60 ? Math.floor(tl / 60) + ' ساعت' : tl + ' دقیقه'} باقیمانده\n\n`;
            } else {
              msg += `❌ تخفیف فعال نیست\n\n`;
            }
            const kb = { inline_keyboard: [
              [{ text: "🎁 تنظیم تخفیف سراسری", callback_data: "admin_set_discount" }],
              [{ text: "❌ لغو تخفیف سراسری", callback_data: "admin_clear_discount" }],
              [{ text: "👑 تخفیف پلن‌های Pro", callback_data: "admin_plan_discounts" }],
              [{ text: "🔙 بازگشت", callback_data: "admin_panel" }]
            ]};
            await sendMessage(chatId, msg, kb, TOKEN);
            return new Response('OK');
          }

          // ---- وضعیت ارسال ----
          if (data === 'admin_broadcast_status') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const p = await dbGetBroadcastState(env, ADMIN_CHAT_ID);
            if (!p) { await sendMessage(ADMIN_CHAT_ID, "ℹ️ هیچ ارسالی انجام نشده.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const st = p.status === 'running' ? '🔄 در حال ارسال' : p.status === 'cancelled' ? '⛔ لغو شده' : '✅ تکمیل شده';
            const el = Math.round((Date.now() - (p.startTime || Date.now())) / 1000);
            await sendMessage(ADMIN_CHAT_ID, `📊 <b>وضعیت آخرین ارسال</b>\n\n${st}\n👥 کل: ${p.total}\n✅ موفق: ${p.sent} | ❌ ناموفق: ${p.fail}\n📈 ${Math.round((p.sent || 0) / Math.max(p.total, 1) * 100)}٪\n⏱️ ${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`, ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- ریست صف ----
          if (data === 'admin_reset_queue') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await env.DB.prepare('DELETE FROM queue').run();
            await sendMessage(chatId, "✅ صف خالی شد.", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- شروع صف (جایگزین /startqueue) ----
          if (data === 'admin_start_queue') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await finishTask(env);
            await sendMessage(chatId, "✅ صف راه‌اندازی شد.", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- ریست پردازش‌ها ----
          if (data === 'admin_fix_active') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const cnt = (await env.DB.prepare('SELECT COUNT(*) as c FROM user_state WHERE status = ?').bind('processing').first())?.c || 0;
            await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'processing').run();
            await finishTask(env);
            await sendMessage(chatId, `✅ ${cnt} پردازش لغو شد.`, ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- دکمه‌های ادمین که نیاز به ورودی دارند ----
          if (data === 'admin_promote') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await dbSetAdminState(env, chatId, { step: 'awaiting_promote_userid' });
            await sendMessage(chatId, "🔹 <b>ارتقا به Pro</b>\n\nشناسه عددی کاربر (Chat ID) را ارسال کنید:", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data === 'admin_reset_quota') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await dbSetAdminState(env, chatId, { step: 'awaiting_quota_userid' });
            await sendMessage(chatId, "🔹 <b>ریست سهمیه</b>\n\nشناسه عددی کاربر (Chat ID) را ارسال کنید:", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data === 'admin_set_channel') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await dbSetAdminState(env, chatId, { step: 'awaiting_add_channel' });
            await sendMessage(chatId, "🔹 <b>افزودن کانال اجباری</b>\n\nنام کاربری کانال را ارسال کنید (بدون @):\nمثال: <code>maramidownload</code>", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data === 'admin_show_channels') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await adminShowChannels(env, chatId, TOKEN);
            return new Response('OK');
          }

          if (data === 'admin_broadcast') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await dbSetAdminState(env, chatId, { step: 'awaiting_broadcast_message' });
            await sendMessage(chatId, "📨 <b>ارسال پیام همگانی</b>\n\nمتن پیام را ارسال کنید.\n(HTML پشتیبانی می‌شود)\n\nبرای لغو: /cancel", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data === 'admin_set_discount') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await dbSetAdminState(env, chatId, { step: 'awaiting_discount_duration' });
            await sendMessage(chatId, "🎁 <b>تنظیم تخفیف سراسری</b>\n\nمدت اعتبار تخفیف را به ساعت وارد کنید:\nمثال: <code>24</code>", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data === 'admin_clear_discount') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await clearDiscount(env);
            await sendMessage(chatId, "✅ تخفیف لغو شد.", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data.startsWith('admin_remove_channel:')) {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const ch = data.split(':')[1];
            const channels = await getRequiredChannels(env);
            if (!channels.includes(ch)) { await sendMessage(chatId, `⚠️ @${ch} در لیست نیست.`, ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
            await setRequiredChannels(env, channels.filter(c => c !== ch));
            await sendMessage(chatId, `✅ کانال @${ch} حذف شد.`, ADMIN_KEYBOARD, TOKEN);
            await adminShowChannels(env, chatId, TOKEN);
            return new Response('OK');
          }

          if (data === 'admin_remove_all_channels') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await setRequiredChannels(env, []);
            await sendMessage(chatId, "✅ همه کانال‌ها حذف شدند.", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- خرید پلن با Stars ----
          if (data.startsWith('buy_plan_stars:')) {
            const planId = parseInt(data.split(':')[1]);
            const plan = await getProPlanById(env, planId);
            if (!plan || !plan.is_active) { await sendMessage(chatId, "❌ این پلن در دسترس نیست.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const planDiscount = await getPlanDiscountForPlan(env, planId);
            const starsPrice = planDiscount ? Math.round(plan.stars_price * (1 - planDiscount.discount_percent / 100)) : plan.stars_price;
            const si = await createStarsInvoiceLink(env, chatId, starsPrice, planId);
            if (!si.success) { await sendMessage(chatId, "❌ خطا در ایجاد لینک پرداخت.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const kb = { inline_keyboard: [[{ text: `⭐️ پرداخت ${starsPrice} ستاره`, url: si.invoiceLink }], [{ text: "🔙 بازگشت", callback_data: "pro_info" }]] };
            await sendMessage(chatId, `⭐️ <b>خرید پلن: ${plan.name}</b>\n\n📅 ${plan.duration_days} روز\n📁 ${plan.daily_files} فایل/روز\n💾 ${plan.daily_volume_gb} GB/روز\n\n💰 قیمت: <b>${starsPrice} ستاره</b>${planDiscount ? ` (${planDiscount.discount_percent}٪ تخفیف)` : ''}`, kb, TOKEN);
            return new Response('OK');
          }

          // ---- خرید پلن با دلار ----
          if (data.startsWith('buy_plan_usd:')) {
            const planId = parseInt(data.split(':')[1]);
            const plan = await getProPlanById(env, planId);
            if (!plan || !plan.is_active) { await sendMessage(chatId, "❌ این پلن در دسترس نیست.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const planDiscount = await getPlanDiscountForPlan(env, planId);
            const usdPrice = planDiscount ? parseFloat((plan.usd_price * (1 - planDiscount.discount_percent / 100)).toFixed(2)) : plan.usd_price;
            const ci = await createNowPaymentsInvoice(env, chatId, usdPrice, planId);
            if (!ci.success) { await sendMessage(chatId, "❌ خطا در ایجاد لینک پرداخت.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const kb = { inline_keyboard: [[{ text: `💰 پرداخت ${usdPrice}$`, url: ci.invoiceUrl }], [{ text: "🔙 بازگشت", callback_data: "pro_info" }]] };
            await sendMessage(chatId, `💰 <b>خرید پلن: ${plan.name}</b>\n\n📅 ${plan.duration_days} روز\n📁 ${plan.daily_files} فایل/روز\n💾 ${plan.daily_volume_gb} GB/روز\n\n💵 قیمت: <b>${usdPrice}$</b>${planDiscount ? ` (${planDiscount.discount_percent}٪ تخفیف)` : ''}`, kb, TOKEN);
            return new Response('OK');
          }

          // ---- Pro info ----
          if (data === 'pro_info') {
            await showProPlansToUser(env, chatId, TOKEN);
            return new Response('OK');
          }

          // ---- تخفیف ویژه ----
          if (data === 'discount_pro') {
            const isPro = await isProUser(env, chatId);
            if (isPro) { await sendMessage(chatId, "✅ شما Pro هستید.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const discount = await getDiscountSettings(env);
            if (!discount) { await sendMessage(chatId, "❌ تخفیف فعال نیست.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const si = await createStarsInvoiceLink(env, chatId, discount.starsPrice, null);
            const ci = await createNowPaymentsInvoice(env, chatId, discount.usdPrice, null);
            const rows = [];
            if (si.success) rows.push([{ text: `⭐️ Stars — ${discount.starsPrice} ستاره`, url: si.invoiceLink }]);
            if (ci.success) rows.push([{ text: `💰 ارز دیجیتال — ${discount.usdPrice} USD`, url: ci.invoiceUrl }]);
            rows.push([{ text: "🔙 بازگشت", callback_data: "back_to_main" }]);
            if (rows.length === 1) { await sendMessage(chatId, "❌ خطا در لینک پرداخت.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const tl = Math.max(0, Math.round((discount.expiresAt - Math.floor(Date.now() / 1000)) / 60));
            const baseStars = await getEffectiveStarsPrice(env);
            const baseUsd = await getEffectiveUsdPrice(env);
            await sendMessage(chatId, `🎁 <b>اشتراک Pro با تخفیف ویژه</b>\n⏰ باقیمانده: ${tl > 60 ? Math.floor(tl / 60) + ' ساعت' : tl + ' دقیقه'}\n\n<s>${baseStars}⭐ | ${baseUsd}$</s>\n<b>${discount.starsPrice}⭐ | ${discount.usdPrice}$</b>\n\n✨ نگهداری ۱ روز | اولویت صف | ${DAILY_LIMIT_PRO} فایل در روز`, { inline_keyboard: rows }, TOKEN);
            return new Response('OK');
          }

          // ---- راهنما ----
          if (data === 'help') {
            const baseStars = await getEffectiveStarsPrice(env);
            const baseUsd = await getEffectiveUsdPrice(env);
            await sendMessage(chatId,
              `📘 <b>راهنمای کامل ربات دانلودر ملی</b>\n\n` +
              `🌀 به ربات دانلودر خوش آمدید! این ربات به شما کمک می‌کند فایل‌های خود را با <b>اینترنت ملی ایران</b> و بدون نیاز به وی‌پی‌ان دانلود کنید.\n\n` +
              `🔹 <b>نحوه استفاده:</b>\n` +
              `1️⃣ <b>دریافت لینک مستقیم:</b> فایل خود را به ربات <b>@filesto_bot</b> فوروارد کنید. آن ربات یک لینک مستقیم به شما می‌دهد.\n` +
              `2️⃣ <b>ارسال لینک:</b> لینک مستقیم را در همین ربات ارسال کنید.\n` +
              `3️⃣ <b>رمز عبور:</b> یک رمز عبور دلخواه برای فایل ZIP وارد کنید.\n` +
              `4️⃣ <b>دریافت لینک دانلود:</b> منتظر بمانید تا پردازش شود و لینک دانلود (با قابلیت دانلود با اینترنت ملی) را دریافت کنید.\n` +
              `5️⃣ <b>پس از دانلود:</b> حتماً روی دکمه «🗑 حذف فایل من» کلیک کنید تا فایل از سرور پاک شود.\n\n` +
              `⭐️ <b>عضویت Pro (ویژه)</b>\n` +
              `• فایل‌های شما تا <b>۱ روز</b> روی سرور می‌ماند (کاربران عادی فقط ۱ ساعت)\n` +
              `• اولویت بالاتر در صف پردازش\n` +
              `• حداکثر <b>${DAILY_LIMIT_PRO} فایل و ${DAILY_VOLUME_PRO_BYTES / (1024 * 1024)} مگابایت در روز</b>\n` +
              `• هزینه عضویت: ${baseStars} ستاره تلگرام یا ${baseUsd} دلار ارز دیجیتال\n` +
              `• برای خرید روی دکمه «⭐️ عضویت Pro» کلیک کنید.\n\n` +
              `🔹 <b>نحوه استخراج فایل پس از دانلود:</b>\n` +
              `• فایل ZIP دانلود شده را با <b>7-Zip</b> یا <b>WinRAR</b> باز کنید.\n` +
              `• داخل پوشه استخراج شده، فایل‌هایی با پسوند <code>.001</code>، <code>.002</code> و ... می‌بینید.\n` +
              `• روی فایل <b>archive.7z.001</b> کلیک راست کرده و گزینه <b>Extract Here</b> را انتخاب کنید.\n` +
              `• نرم‌افزار به صورت خودکار تمام تکه‌ها را به هم چسبانده و فایل اصلی شما را تحویل می‌دهد.\n\n` +
              `⚠️ <b>توجه امنیتی و قانونی:</b>\n` +
              `• فایل‌ها در یک <b>مخزن عمومی گیت‌هاب</b> ذخیره می‌شوند. از ارسال فایل‌های شخصی، محرمانه، مستهجن یا خلاف قانون خودداری کنید.\n` +
              `• <b>مسئولیت قانونی ارسال محتوای غیرمجاز بر عهده کاربر است.</b>\n` +
              `• با استفاده از ربات، شما <b>متعهد به رعایت تمام قوانین</b> جمهوری اسلامی ایران می‌شوید.\n` +
              `• حجم فایل نباید بیشتر از ۲ گیگابایت باشد.\n\n` +
              `📊 <b>محدودیت حجم روزانه:</b>\n` +
              `• کاربران عادی: ${DAILY_VOLUME_NORMAL_BYTES / (1024 * 1024)} مگابایت در روز\n` +
              `• کاربران Pro: ${DAILY_VOLUME_PRO_BYTES / (1024 * 1024)} مگابایت در روز\n\n` +
              `❤️ <b>حمایت و پشتیبانی:</b>\n` +
              `• کانال تلگرام: @maramidownload\n` +
              `• برای گزارش مشکلات، در کانال پیام بگذارید.\n\n` +
              `📢 ما را به دوستان خود معرفی کنید.`,
              MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- آمار ----
          if (data === 'stats') {
            try {
              const stats = await dbGetGlobalStats(env);
              const active = await dbGetActiveCount(env);
              const queue = await dbGetQueueCount(env);
              const proQueue = await dbGetQueueCount(env, true);
              const users = await dbGetUsersCount(env);
              const proUsers = (await env.DB.prepare('SELECT COUNT(*) as c FROM pro_users WHERE expires_at > ?').bind(Math.floor(Date.now() / 1000)).first())?.c || 0;
              const repo = await getRepoSize(env);
              await sendMessage(chatId,
                `📊 <b>آمار لحظه‌ای</b>\n\n👥 کل کاربران: ${users}\n⭐️ Pro فعال: ${proUsers}\n🔄 در پردازش: ${active}\n⏳ در صف: ${queue} (${proQueue} Pro)\n🔗 لینک‌های ساخته شده: ${stats.total_links}\n💾 حجم کل: ${stats.total_volume_gb.toFixed(2)} GB\n📦 حجم مخزن: ${repo.toFixed(1)} از ${REPO_SIZE_LIMIT_GB} GB${repo >= REPO_SIZE_WARNING_GB ? '\n\n⚠️ مخزن نزدیک به پر شدن!' : ''}\n\n📢 @maramidownload`,
                MAIN_KEYBOARD, TOKEN);
            } catch (e) { await sendMessage(chatId, "⚠️ خطا.", MAIN_KEYBOARD, TOKEN); }
            return new Response('OK');
          }

          // ---- وضعیت من ----
          if (data === 'status') {
            try {
              const isPro = await isProUser(env, chatId);
              const planInfo = isPro ? await getUserActivePlan(env, chatId) : null;
              const qt = await getRemainingQuotaText(env, chatId, isPro, planInfo);
              const us = await getUserStats(env, chatId);
              const st = `\n\n📈 فایل‌ها: ${us.total_files} | حجم: ${us.total_volume_gb.toFixed(2)} GB`;
              const lb = await dbGetLastBranch(env, chatId);
              if (lb) {
                const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${lb}.zip`;
                await sendMessage(chatId, `✅ <b>فایل آماده است!</b>\n\n🔗 ${link}\n\n${qt}${st}`, { inline_keyboard: [[{ text: "🗑 حذف فایل", callback_data: "delete_my_file" }], [{ text: "📥 لینک جدید", callback_data: "new_link" }]] }, TOKEN);
                return new Response('OK');
              }
              const state = await dbGetUserState(env, chatId);
              if (!state) { await sendMessage(chatId, `📭 درخواست فعالی ندارید.\n\n${qt}${st}`, MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
              let prog = '';
              if (state.totalChunks && state.uploadedChunks) prog = `\n📦 ${state.uploadedChunks}/${state.totalChunks} تکه (${Math.round(state.uploadedChunks / state.totalChunks * 100)}٪)`;
              if (state.status === 'processing') await sendMessage(chatId, `🔄 در حال پردازش...${prog}\n\n${qt}${st}`, MAIN_KEYBOARD, TOKEN);
              else if (state.status === 'waiting') {
                let pos = '?';
                try { const r = isPro ? await env.DB.prepare('SELECT COUNT(*) as p FROM queue WHERE priority=1 AND position<=(SELECT position FROM queue WHERE chat_id=?)').bind(chatId).first() : await env.DB.prepare('SELECT COUNT(*) as p FROM queue WHERE priority=0 AND position<=(SELECT position FROM queue WHERE chat_id=?)').bind(chatId).first(); pos = r?.p || '?'; } catch (e) { }
                await sendMessage(chatId, `⏳ در صف — شماره: ${pos}${isPro ? ' ⭐️' : ''}\n\n${qt}${st}`, MAIN_KEYBOARD, TOKEN);
              } else if (state.status === 'awaiting_password') await sendMessage(chatId, `🔐 منتظر رمز عبور هستم.\n\n${qt}${st}`, MAIN_KEYBOARD, TOKEN);
              else await sendMessage(chatId, `📭 درخواست فعالی ندارید.\n\n${qt}${st}`, MAIN_KEYBOARD, TOKEN);
            } catch (e) { await sendMessage(chatId, "⚠️ خطا.", MAIN_KEYBOARD, TOKEN); }
            return new Response('OK');
          }

          // ---- حذف فایل ----
          if (data === 'delete_my_file') {
            const lb = await dbGetLastBranch(env, chatId);
            if (!lb) { await sendMessage(chatId, "❌ فایل فعالی یافت نشد.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const ok = await deleteBranchFromGitHub(env, lb);
            if (ok) { await dbRemoveActiveBranch(env, lb); await sendMessage(chatId, "✅ فایل حذف شد.", MAIN_KEYBOARD, TOKEN); }
            else await sendMessage(chatId, "❌ خطا در حذف.", MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // ---- لینک جدید ----
          if (data === 'new_link') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            await deleteUserBranch(env, chatId);
            await sendMessage(chatId, "✅ آماده دریافت لینک جدید!\n\n📌 راهنما: فایل خود را به @filesto_bot بفرستید و لینک مستقیم را اینجا ارسال کنید.", MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          return new Response('OK');
        }

        // ============================================================
        // پیام متنی
        // ============================================================

        if (update.message?.text) {
          const chatId = update.message.chat.id.toString();
          const text = update.message.text.trim();

          // ---- وضعیت ادمین از DB ----
          if (chatId === ADMIN_CHAT_ID) {
            const adminState = await dbGetAdminState(env, chatId);
            if (adminState) {
              const step = adminState.step;

              if (step === 'awaiting_broadcast_message') {
                if (text === '/cancel') { await dbDeleteAdminState(env, chatId); await sendMessage(chatId, "❌ لغو شد.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbDeleteAdminState(env, chatId);
                startBroadcast(env, chatId, text, TOKEN).catch(e => console.error('Broadcast error:', e));
                await sendMessage(chatId, "✅ <b>ارسال پیام همگانی آغاز شد!</b>\n\n📊 برای مشاهده وضعیت، روی دکمه «📊 وضعیت ارسال» کلیک کنید.\n⚠️ برای لغو: /cancel_broadcast", ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_promote_userid') {
                const result = await adminPromoteToPro(env, text, ADMIN_SECRET, ADMIN_SECRET);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, result, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_quota_userid') {
                const result = await adminResetQuota(env, text, ADMIN_SECRET, ADMIN_SECRET);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, result, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_add_channel') {
                const clean = text.replace('@', '').trim();
                if (!clean) { await sendMessage(chatId, "❌ نام کانال معتبر نیست.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                const channels = await getRequiredChannels(env);
                if (channels.includes(clean)) { await dbDeleteAdminState(env, chatId); await sendMessage(chatId, `⚠️ @${clean} قبلاً اضافه شده.`, ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                channels.push(clean);
                await setRequiredChannels(env, channels);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ کانال @${clean} اضافه شد.`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_discount_duration') {
                const hours = parseInt(text);
                if (isNaN(hours) || hours <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید. مثال: 24", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_discount_stars', hours });
                await sendMessage(chatId, `✅ مدت: ${hours} ساعت\n\n⭐️ تعداد ستاره تخفیفی را ارسال کنید (عدد صحیح):`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_discount_stars') {
                const sp = parseInt(text);
                if (isNaN(sp) || sp <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید. مثال: 40", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_discount_usd', starsPrice: sp, hours: adminState.hours });
                await sendMessage(chatId, `⭐️ ستاره: ${sp}\n\n💰 قیمت دلاری تخفیفی را ارسال کنید (عدد اعشاری، مثال: 0.7):`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_discount_usd') {
                const up = parseFloat(text);
                if (isNaN(up) || up <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید. مثال: 0.7", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await setDiscount(env, adminState.starsPrice, up, adminState.hours);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ <b>تخفیف سراسری تنظیم شد!</b>\n⭐️ ${adminState.starsPrice} ستاره | 💰 ${up} USD\n⏳ اعتبار: ${adminState.hours} ساعت`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              // ---- تنظیم قیمت‌ها ----
              if (step === 'awaiting_stars_price') {
                const sp = parseInt(text);
                if (isNaN(sp) || sp <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_usd_price', starsPrice: sp });
                await sendMessage(chatId, `⭐️ Stars: ${sp}\n\n💵 قیمت دلاری (بدون تخفیف) را وارد کنید (مثال: 1.5):`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_usd_price') {
                const up = parseFloat(text);
                if (isNaN(up) || up <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید. مثال: 1.5", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await setBotSetting(env, 'stars_price', adminState.starsPrice);
                await setBotSetting(env, 'usd_price', up);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ <b>قیمت‌های پایه بروز شد!</b>\n⭐️ Stars: ${adminState.starsPrice}\n💵 دلار: ${up}$\n\n(این قیمت‌ها برای پلن پیش‌فرض و تنظیم تخفیف استفاده می‌شوند)`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              // ---- تنظیم محدودیت‌ها ----
              if (step === 'awaiting_normal_size_limit') {
                const mb = parseInt(text);
                if (isNaN(mb) || mb <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید (مگابایت).", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_pro_size_limit', normalSizeMB: mb });
                await sendMessage(chatId, `✅ حد عادی: ${mb} مگابایت\n\nحداکثر حجم فایل برای کاربران Pro (مگابایت) را وارد کنید:`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_pro_size_limit') {
                const mb = parseInt(text);
                if (isNaN(mb) || mb <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید (مگابایت).", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_normal_ttl', normalSizeMB: adminState.normalSizeMB, proSizeMB: mb });
                await sendMessage(chatId, `✅ حد Pro: ${mb} مگابایت\n\nماندگاری فایل برای کاربران عادی (ساعت) را وارد کنید:`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_normal_ttl') {
                const hours = parseInt(text);
                if (isNaN(hours) || hours <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید (ساعت).", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_pro_ttl', normalSizeMB: adminState.normalSizeMB, proSizeMB: adminState.proSizeMB, normalTTLh: hours });
                await sendMessage(chatId, `✅ TTL عادی: ${hours} ساعت\n\nماندگاری فایل برای کاربران Pro (روز) را وارد کنید:`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_pro_ttl') {
                const days = parseInt(text);
                if (isNaN(days) || days <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید (روز).", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await setBotSetting(env, 'normal_file_size_limit_mb', adminState.normalSizeMB);
                await setBotSetting(env, 'pro_file_size_limit_mb', adminState.proSizeMB);
                await setBotSetting(env, 'normal_max_time_sec', adminState.normalTTLh * 3600);
                await setBotSetting(env, 'pro_max_time_sec', days * 86400);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId,
                  `✅ <b>محدودیت‌ها بروز شد!</b>\n\n📏 حجم فایل عادی: ${adminState.normalSizeMB} مگابایت\n📏 حجم فایل Pro: ${adminState.proSizeMB} مگابایت\n⏱ ماندگاری عادی: ${adminState.normalTTLh} ساعت\n⏱ ماندگاری Pro: ${days} روز`,
                  ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              // ---- مدیریت پلن‌ها ----
              if (step === 'awaiting_plan_name') {
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_duration', name: text });
                await sendMessage(chatId, `📅 نام: ${text}\n\nمدت (روز) را وارد کنید:\nمثال: <code>30</code>`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_duration') {
                const days = parseInt(text);
                if (isNaN(days) || days <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_daily_files', name: adminState.name, days });
                await sendMessage(chatId, `📅 مدت: ${days} روز\n\nتعداد فایل مجاز روزانه را وارد کنید:`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_daily_files') {
                const files = parseInt(text);
                if (isNaN(files) || files <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_daily_volume', name: adminState.name, days: adminState.days, dailyFiles: files });
                await sendMessage(chatId, `📁 فایل روزانه: ${files}\n\nحجم روزانه (گیگابایت) را وارد کنید:\nمثال: <code>6</code>`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_daily_volume') {
                const gb = parseFloat(text);
                if (isNaN(gb) || gb <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_stars_price', name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyVolumeGB: gb });
                await sendMessage(chatId, `💾 حجم روزانه: ${gb} گیگابایت\n\nقیمت به Stars را وارد کنید (عدد صحیح):`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_stars_price') {
                const sp = parseInt(text);
                if (isNaN(sp) || sp <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_usd_price', name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyVolumeGB: adminState.dailyVolumeGB, starsPrice: sp });
                await sendMessage(chatId, `⭐️ Stars: ${sp}\n\nقیمت دلاری را وارد کنید (مثال: <code>1.5</code>):`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_usd_price') {
                const up = parseFloat(text);
                if (isNaN(up) || up <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await env.DB.prepare('INSERT INTO pro_plans (name, duration_days, daily_files, daily_volume_gb, stars_price, usd_price, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, 0)').bind(adminState.name, adminState.days, adminState.dailyFiles, adminState.dailyVolumeGB, adminState.starsPrice, up).run();
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId,
                  `✅ <b>پلن جدید ایجاد شد!</b>\n\n📦 ${adminState.name}\n📅 ${adminState.days} روز\n📁 ${adminState.dailyFiles} فایل/روز\n💾 ${adminState.dailyVolumeGB} GB/روز\n⭐️ ${adminState.starsPrice} | 💵 ${up}$`,
                  ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_name') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newName = text === '-' ? plan.name : text;
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_duration', planId, name: newName });
                await sendMessage(chatId, `📅 مدت فعلی: ${plan.duration_days} روز\nمدت جدید را وارد کنید (یا <code>-</code> برای نگه‌داشتن):`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_duration') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newDays = text === '-' ? plan.duration_days : parseInt(text);
                if (isNaN(newDays) || newDays <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_daily_files', planId, name: adminState.name, days: newDays });
                await sendMessage(chatId, `📁 تعداد فایل روزانه فعلی: ${plan.daily_files}\nمقدار جدید وارد کنید (یا <code>-</code>):`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_daily_files') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newFiles = text === '-' ? plan.daily_files : parseInt(text);
                if (isNaN(newFiles) || newFiles <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_daily_volume', planId, name: adminState.name, days: adminState.days, dailyFiles: newFiles });
                await sendMessage(chatId, `💾 حجم روزانه فعلی: ${plan.daily_volume_gb} GB\nمقدار جدید (گیگابایت، یا <code>-</code>):`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_daily_volume') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newGB = text === '-' ? plan.daily_volume_gb : parseFloat(text);
                if (isNaN(newGB) || newGB <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_stars_price', planId, name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyVolumeGB: newGB });
                await sendMessage(chatId, `⭐️ قیمت Stars فعلی: ${plan.stars_price}\nمقدار جدید (یا <code>-</code>):`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_stars_price') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newStars = text === '-' ? plan.stars_price : parseInt(text);
                if (isNaN(newStars) || newStars <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_usd_price', planId, name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyVolumeGB: adminState.dailyVolumeGB, starsPrice: newStars });
                await sendMessage(chatId, `💵 قیمت دلاری فعلی: ${plan.usd_price}$\nمقدار جدید (یا <code>-</code>):`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_usd_price') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newUsd = text === '-' ? plan.usd_price : parseFloat(text);
                if (isNaN(newUsd) || newUsd <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await env.DB.prepare('UPDATE pro_plans SET name=?, duration_days=?, daily_files=?, daily_volume_gb=?, stars_price=?, usd_price=? WHERE id=?').bind(adminState.name, adminState.days, adminState.dailyFiles, adminState.dailyVolumeGB, adminState.starsPrice, newUsd, planId).run();
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId,
                  `✅ <b>پلن ویرایش شد!</b>\n\n📦 ${adminState.name}\n📅 ${adminState.days} روز | 📁 ${adminState.dailyFiles} فایل/روز | 💾 ${adminState.dailyVolumeGB} GB/روز\n⭐️ ${adminState.starsPrice} | 💵 ${newUsd}$\n\n⚠️ کاربران با پلن فعال تغییر نمی‌کنند (snapshot محفوظ است)`,
                  ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              // ---- تخفیف پلن ----
              if (step === 'awaiting_plan_discount_percent') {
                const percent = parseFloat(text);
                if (isNaN(percent) || percent < 0 || percent > 100) { await sendMessage(chatId, "❌ عدد بین ۰ تا ۱۰۰ وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                if (percent === 0) {
                  await env.DB.prepare('UPDATE plan_discounts SET active = 0 WHERE plan_id = ?').bind(adminState.planId).run();
                  await dbDeleteAdminState(env, chatId);
                  await sendMessage(chatId, `✅ تخفیف پلن "${adminState.planName}" لغو شد.`, ADMIN_KEYBOARD, TOKEN);
                  return new Response('OK');
                }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_discount_duration', planId: adminState.planId, planName: adminState.planName, discountPercent: percent });
                await sendMessage(chatId, `🎉 تخفیف: ${percent}٪\n\nمدت اعتبار تخفیف (ساعت) را وارد کنید:`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_discount_duration') {
                const hours = parseInt(text);
                if (isNaN(hours) || hours <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                const expiresAt = Math.floor(Date.now() / 1000) + hours * 3600;
                // غیرفعال کردن تخفیف قبلی
                await env.DB.prepare('UPDATE plan_discounts SET active = 0 WHERE plan_id = ?').bind(adminState.planId).run();
                await env.DB.prepare('INSERT INTO plan_discounts (plan_id, discount_percent, active, expires_at) VALUES (?, ?, 1, ?)').bind(adminState.planId, adminState.discountPercent, expiresAt).run();
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ <b>تخفیف پلن "${adminState.planName}" تنظیم شد!</b>\n🎉 ${adminState.discountPercent}٪ تخفیف\n⏳ اعتبار: ${hours} ساعت`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              // ---- حالت maintenance ----
              if (step === 'awaiting_maintenance_exception') {
                let exceptions = [];
                if (text.toLowerCase() !== 'skip') {
                  exceptions = text.split(',').map(s => s.trim()).filter(s => s.length > 0);
                }
                await setBotSetting(env, 'maintenance_mode', '1');
                await setBotSetting(env, 'maintenance_exceptions', JSON.stringify(exceptions));
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId,
                  `🔴 <b>حالت بروزرسانی فعال شد!</b>\n\n🧪 کاربران استثنا: ${exceptions.length > 0 ? exceptions.join(', ') : 'ندارد'}\n\nبرای غیرفعال کردن دوباره روی دکمه بزنید.`,
                  ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              // ---- ارسال مستقیم پیام ----
              if (step === 'awaiting_direct_chat_id') {
                const targetId = text.trim();
                if (!targetId || isNaN(targetId)) { await sendMessage(chatId, "❌ چت آی دی معتبر نیست.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_direct_message_text', targetChatId: targetId });
                await sendMessage(chatId, `📩 پیام برای کاربر ${targetId}:\n\nمتن پیام را ارسال کنید:`, ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_direct_message_text') {
                const targetChatId = adminState.targetChatId;
                try {
                  await sendMessage(targetChatId, text, MAIN_KEYBOARD, TOKEN);
                  await dbDeleteAdminState(env, chatId);
                  await sendMessage(chatId, `✅ پیام به ${targetChatId} ارسال شد.`, ADMIN_KEYBOARD, TOKEN);
                } catch (e) {
                  await dbDeleteAdminState(env, chatId);
                  await sendMessage(chatId, `❌ خطا در ارسال پیام به ${targetChatId}.`, ADMIN_KEYBOARD, TOKEN);
                }
                return new Response('OK');
              }

              // state ناشناخته
              await dbDeleteAdminState(env, chatId);
            }
          }

          // ---- دستورات ادمین متنی ----
          const rsMatch = text.match(/^\/resetstats (.+)$/);
          if (rsMatch && rsMatch[1] === ADMIN_SECRET) {
            await env.DB.prepare('DELETE FROM queue').run();
            await env.DB.prepare('UPDATE user_state SET status=? WHERE status=?').bind('cancelled', 'processing').run();
            await finishTask(env);
            await sendMessage(chatId, "✅ بازنشانی شد.", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          const faMatch = text.match(/^\/fixactive (.+)$/);
          if (faMatch && faMatch[1] === ADMIN_SECRET) {
            const cnt = (await env.DB.prepare('SELECT COUNT(*) as c FROM user_state WHERE status=?').bind('processing').first())?.c || 0;
            await env.DB.prepare('UPDATE user_state SET status=? WHERE status=?').bind('cancelled', 'processing').run();
            await finishTask(env);
            await sendMessage(chatId, `✅ ${cnt} پردازش لغو شد.`, ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          const sqMatch = text.match(/^\/startqueue (.+)$/);
          if (sqMatch && sqMatch[1] === ADMIN_SECRET) { await finishTask(env); await sendMessage(chatId, "✅ صف راه‌اندازی شد.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }

          const rqMatch = text.match(/^\/resetqueue (.+)$/);
          if (rqMatch && rqMatch[1] === ADMIN_SECRET) { await env.DB.prepare('DELETE FROM queue').run(); await sendMessage(chatId, "✅ صف خالی شد.", ADMIN_KEYBOARD, TOKEN); return new Response('OK'); }

          const pmMatch = text.match(/^\/promote (.+) (.+)$/);
          if (pmMatch) { await sendMessage(chatId, await adminPromoteToPro(env, pmMatch[2], ADMIN_SECRET, pmMatch[1]), MAIN_KEYBOARD, TOKEN); return new Response('OK'); }

          const rmqMatch = text.match(/^\/resetquota (.+) (.+)$/);
          if (rmqMatch) { await sendMessage(chatId, await adminResetQuota(env, rmqMatch[2], ADMIN_SECRET, rmqMatch[1]), MAIN_KEYBOARD, TOKEN); return new Response('OK'); }

          if (text === '/myid') { await sendMessage(chatId, `🆔 Chat ID: <code>${chatId}</code>`, MAIN_KEYBOARD, TOKEN); return new Response('OK'); }

          // ---- /start ----
          if (text === '/start' || text.startsWith('/start ')) {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            await dbDeleteAdminState(env, chatId);
            const baseStars = await getEffectiveStarsPrice(env);
            const baseUsd = await getEffectiveUsdPrice(env);
            await sendMessage(chatId,
              `🌀 <b>به ربات دانلودر ملی خوش آمدید!</b>\n\n` +
              `📌 <b>ربات ملی دانلود</b> – راه‌حل سریع و آسان برای دانلود فایل‌های فیلترشده با <b>اینترنت ملی</b> و صرفه‌جویی در مصرف حجم وی‌پی‌ان!\n\n` +
              `🔹 <b>نحوه استفاده:</b>\n` +
              `1️⃣ فایل خود را به ربات <b>@filesto_bot</b> فوروارد کنید.\n` +
              `2️⃣ لینک مستقیم را در همین ربات ارسال کنید.\n` +
              `3️⃣ یک رمز عبور دلخواه برای فایل ZIP وارد کنید.\n` +
              `4️⃣ منتظر بمانید تا پردازش شود و لینک دانلود (با قابلیت دانلود با اینترنت ملی) را دریافت کنید.\n` +
              `5️⃣ پس از دانلود، حتماً روی دکمه <b>«🗑 حذف فایل من»</b> کلیک کنید تا فایل از سرور پاک شود.\n\n` +
              `⭐️ <b>عضویت Pro</b>\n` +
              `• فایل‌های شما تا <b>۱ روز</b> روی سرور می‌ماند (عادی ۱ ساعت)\n` +
              `• اولویت بالاتر در صف پردازش\n` +
              `• حداکثر <b>${DAILY_LIMIT_PRO} فایل و ${DAILY_VOLUME_PRO_BYTES / (1024 * 1024)} مگابایت در روز</b>\n` +
              `• هزینه عضویت: ${baseStars} ستاره تلگرام یا معادل ${baseUsd} دلار ارز دیجیتال\n` +
              `• برای خرید روی دکمه «⭐️ عضویت Pro» کلیک کنید.\n\n` +
              `⚠️ <b>هشدار امنیتی و قانونی:</b>\n` +
              `• فایل‌ها در یک <b>مخزن عمومی گیت‌هاب</b> ذخیره می‌شوند. از ارسال فایل‌های شخصی، محرمانه، مستهجن یا خلاف قانون خودداری کنید.\n` +
              `• <b>مسئولیت قانونی ارسال محتوای غیرمجاز بر عهده کاربر است.</b>\n` +
              `• با استفاده از ربات، شما <b>متعهد به رعایت تمام قوانین</b> جمهوری اسلامی ایران می‌شوید.\n` +
              `• حجم فایل نباید بیشتر از ۲ گیگابایت باشد.\n\n` +
              `📊 <b>محدودیت حجم روزانه:</b>\n` +
              `• کاربران عادی: ${DAILY_VOLUME_NORMAL_BYTES / (1024 * 1024)} مگابایت\n` +
              `• کاربران Pro: ${DAILY_VOLUME_PRO_BYTES / (1024 * 1024)} مگابایت\n\n` +
              `❤️ <b>حمایت و پشتیبانی:</b>\n` +
              `• کانال تلگرام: @maramidownload\n\n` +
              `👇 با دکمه زیر شروع کنید.`,
              getMainKeyboardForAdmin(ADMIN_CHAT_ID, chatId), TOKEN);
            return new Response('OK');
          }

          // ---- لینک ----
          if (text.match(/^https?:\/\//)) {
            const channels = await getRequiredChannels(env);
            if (channels.length > 0) {
              const isMember = await isUserMemberOfChannels(chatId, channels, TOKEN);
              if (!isMember) {
                const jkb = { inline_keyboard: [channels.map(ch => ({ text: `🔗 @${ch}`, url: `https://t.me/${ch}` })), [{ text: "✅ عضو شدم، بررسی کن", callback_data: "check_membership" }]] };
                await sendMessage(chatId, "❌ برای استفاده از ربات ابتدا باید در کانال‌های زیر عضو شوید:", jkb, TOKEN);
                await savePendingLink(env, chatId, text, await getFileSize(text) || 0);
                return new Response('OK');
              }
            }
            await processPendingLink(env, chatId, text, 0, TOKEN);
            return new Response('OK');
          }

          // ---- رمز عبور ----
          const userState = await dbGetUserState(env, chatId);
          if (userState?.status === 'awaiting_password' && userState.requestData) {
            const isPro = await isProUser(env, chatId);
            const isOversized = userState.requestData.oversized;

            if (isOversized && !isPro) {
              // کاربر رمز وارد کرد ولی هنوز Pro نشده
              // فایل را پردازش کنید ولی لینک رو نگه دارید
              await dbSetUserState(env, chatId, 'awaiting_password_oversized', { url: userState.requestData.url, password: text, fileSize: userState.requestData.fileSize || 0, oversized: true });
              await sendMessage(chatId,
                `🔐 رمز عبور ذخیره شد!\n\n📦 آپلود فایل آغاز می‌شود...\n\n⚠️ برای دریافت لینک، باید اشتراک Pro تهیه کنید:`,
                { inline_keyboard: [[{ text: "⭐️ خرید Pro و دریافت لینک", callback_data: "pro_info" }], [{ text: "❌ لغو", callback_data: "cancel_input" }]] },
                TOKEN);

              // آپلود را شروع کنید
              const active = await dbGetActiveCount(env);
              if (active < MAX_CONCURRENT) {
                await dbSetUserState(env, chatId, 'processing_oversized', { url: userState.requestData.url, password: text, fileSize: userState.requestData.fileSize || 0, oversized: true });
                runTaskWithRetry(chatId, userState.requestData.url, text, env, TOKEN).catch(console.error);
              } else {
                await dbAddQueue(env, chatId, userState.requestData.url, text, userState.requestData.fileSize || 0, false);
                await dbSetUserState(env, chatId, 'waiting_oversized', { url: userState.requestData.url, password: text, fileSize: userState.requestData.fileSize || 0, oversized: true });
              }
              return new Response('OK');
            }

            await dbDeleteUserState(env, chatId);
            const planInfo = isPro ? await getUserActivePlan(env, chatId) : null;
            const active = await dbGetActiveCount(env);
            if (active < MAX_CONCURRENT) {
              await dbSetUserState(env, chatId, 'processing', { url: userState.requestData.url, password: text, fileSize: userState.requestData.fileSize || 0 });
              runTaskWithRetry(chatId, userState.requestData.url, text, env, TOKEN).catch(console.error);
              await sendMessage(chatId, "📤 <b>درخواست ارسال شد!</b>\nمنتظر شروع پردازش باشید...", MAIN_KEYBOARD, TOKEN);
            } else {
              await dbAddQueue(env, chatId, userState.requestData.url, text, userState.requestData.fileSize || 0, isPro);
              await dbSetUserState(env, chatId, 'waiting', { url: userState.requestData.url, password: text, fileSize: userState.requestData.fileSize || 0 });
              const pos = isPro ? await dbGetQueueCount(env, true) : await dbGetQueueCount(env, false);
              await sendMessage(chatId, `⏳ در صف انتظار قرار گرفتید.\nشماره صف: ${pos}${isPro ? ' ⭐️ (اولویت Pro)' : ''}\n\nلطفاً صبور باشید.`, MAIN_KEYBOARD, TOKEN);
            }
            return new Response('OK');
          }

          await sendMessage(chatId, "❌ لینک معتبر نیست.\nلینک باید با http:// یا https:// شروع شود.\n\n📌 راهنما: برای دریافت لینک مستقیم، فایل خود را به @filesto_bot بفرستید.", MAIN_KEYBOARD, TOKEN);
          return new Response('OK');
        }

        return new Response('OK');
      } catch (err) { console.error('Webhook error:', err); return new Response('Error', { status: 500 }); }
    }

    return new Response('🤖 ربات دانلودر ملی در حال اجرا است!');
  }
};
