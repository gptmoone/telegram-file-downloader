// ============================================================
// ربات دانلودر ملی - نسخه نهایی کامل با قابلیت‌های پیشرفته (V5)
// قابلیت‌ها: دانلود مستقیم، پنل حرفه‌ای، رفرال، سهمیه تفکیک‌شده
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
const DAILY_DIRECT_LIMIT_NORMAL = 1;
const DAILY_DIRECT_LIMIT_PRO = 3;
const DAILY_VOLUME_NORMAL_BYTES = NORMAL_DAILY_VOLUME_MB * 1024 * 1024;
const DAILY_VOLUME_PRO_BYTES = PRO_DAILY_VOLUME_MB * 1024 * 1024;
const OVERSIZED_PENDING_HOURS = 1;
const GITHUB_OWNER = 'gptmoone';
const GITHUB_REPO = 'telegram-file-downloader';
const lastCallbackProcessed = new Map();
// ---- آی‌دی ربات اصلی (واترمارک) ----
const BOT_SIGNATURE = '\n\n🤖 <a href="https://t.me/filesmanagement_bot">@filesmanagement_bot</a>';

// ============================================================
// دکمه‌های رنگی و لینک‌دار
// ============================================================
function colorBtn(text, data, color) {
  let style;
  if (color === 'blue' || color === 'primary') style = 'primary';
  else if (color === 'green' || color === 'success') style = 'success';
  else if (color === 'red' || color === 'danger') style = 'danger';
  
  if (typeof data === 'string' && data.startsWith('http')) {
    return { text, url: data, style };
  }
  return { text, callback_data: data, style };
}

// ============================================================
// کیبوردها
// ============================================================

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [colorBtn("📥 دریافت لینک ملی", "new_link_check", "primary")],
    [colorBtn("📊 آمار لحظه‌ای", "stats", "blue"), colorBtn("👤 وضعیت من", "status", "blue")],
    [colorBtn("⭐️ عضویت Pro", "pro_info", "green"), colorBtn("🗑 حذف فایل من", "delete_my_file", "red")],
    [colorBtn("🎁 اشتراک رایگان Pro", "referral_menu", "blue"), colorBtn("🏷 کد تخفیف", "use_discount_code", "blue")],
    [colorBtn("❓ راهنما", "help", "blue"), { text: "📢 کانال پشتیبانی", url: "https://t.me/maramidownload" }]
  ]
};

function buildAdminKeyboard(isDirectEnabled = true) {
  return {
    inline_keyboard: [
      [colorBtn(isDirectEnabled ? "🔴 ارسال مستقیم: غیرفعال" : "🟢 ارسال مستقیم: فعال", "admin_direct_toggle", "primary")],
      [colorBtn("🔧 ریست صف", "admin_reset_queue", "red"), colorBtn("🔧 ریست پردازش‌ها", "admin_fix_active", "red")],
      [colorBtn("⭐️ ارتقا به Pro", "admin_promote", "green"), colorBtn("🔄 ریست سهمیه", "admin_reset_quota", "blue")],
      [colorBtn("📢 افزودن کانال", "admin_set_channel", "blue"), colorBtn("📋 مشاهده کانال‌ها", "admin_show_channels", "blue")],
      [colorBtn("📨 پیام همگانی", "admin_broadcast", "primary"), colorBtn("📩 ارسال مستقیم پیام", "admin_direct_message", "primary")],
      [colorBtn("🎁 مدیریت تخفیف‌ها", "admin_discount_menu", "green"), colorBtn("📊 وضعیت ارسال", "admin_broadcast_status", "blue")],
      [colorBtn("🚀 شروع صف", "admin_start_queue", "success"), colorBtn("💰 تنظیم قیمت‌ها", "admin_set_prices", "blue")],
      [colorBtn("📦 تنظیم محدودیت‌ها", "admin_set_limits", "blue"), colorBtn("👑 مدیریت پلن‌های Pro", "admin_plans_menu", "primary")],
      [colorBtn("👥 اعضای Pro", "admin_pro_members_page:1", "blue"), colorBtn("🔔 تخفیف تمدید", "admin_renewal_discount", "blue")],
      [colorBtn("🎟 مدیریت کدهای تخفیف", "admin_coupon_menu", "green"), colorBtn("🔗 تنظیمات رفرال", "admin_referral_settings", "blue")],
      [colorBtn("📈 آمار رفرال‌ها", "admin_referral_stats", "blue"), colorBtn("🔴 حالت بروزرسانی", "admin_maintenance_toggle", "danger")],
      [colorBtn("🖥 مانیتورینگ", "admin_monitoring", "blue"), colorBtn("🔙 منوی اصلی", "back_to_main", "danger")]
    ]
  };
}

function getMainKeyboardForAdmin(adminChatId, chatId) {
  const kb = {
    inline_keyboard: [
      [colorBtn("📥 دریافت لینک ملی", "new_link_check", "primary")],
      [colorBtn("📊 آمار لحظه‌ای", "stats", "blue"), colorBtn("👤 وضعیت من", "status", "blue")],
      [colorBtn("⭐️ عضویت Pro", "pro_info", "green"), colorBtn("🗑 حذف فایل من", "delete_my_file", "red")],
      [colorBtn("🎁 اشتراک رایگان Pro", "referral_menu", "blue"), colorBtn("🏷 کد تخفیف", "use_discount_code", "blue")],
      [colorBtn("❓ راهنما", "help", "blue"), { text: "📢 کانال پشتیبانی", url: "https://t.me/maramidownload" }]
    ]
  };
  if (adminChatId && chatId === adminChatId) kb.inline_keyboard.push([colorBtn("🛠 پنل مدیریت", "admin_panel", "primary")]);
  return kb;
}

// ============================================================
// توابع کمکی ارتباط با تلگرام
// ============================================================

async function sendMessage(chatId, text, keyboard, TOKEN) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text + BOT_SIGNATURE,
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
  } catch (err) { 
    clearTimeout(tid); 
    throw err;
  }
}

async function sendSimple(chatId, text, TOKEN) {
  return sendMessage(chatId, text, MAIN_KEYBOARD, TOKEN);
}

async function editMessage(chatId, messageId, text, keyboard, TOKEN) {
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text + BOT_SIGNATURE, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: JSON.stringify(keyboard || MAIN_KEYBOARD) })
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
// وضعیت موقت ادمین و کاربر در D1
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

async function dbSaveBroadcastState(env, adminChatId, state) {
  try {
    await env.DB.prepare('INSERT OR REPLACE INTO broadcast_state (admin_chat_id, total, sent, fail, status, message_id, start_time, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(adminChatId, state.total || 0, state.sent || 0, state.fail || 0, state.status || 'running', state.messageId || null, state.startTime || Date.now(), Date.now()).run();
  } catch (e) { }
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

async function dbAddUser(env, chatId, name = 'کاربر') {
  await env.DB.prepare('INSERT INTO users (chat_id, first_seen, name) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET name = excluded.name').bind(chatId, Date.now(), name).run();
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
    for (const r of (row.results || [])) settings[r.setting_key] = r.setting_value;
    return settings;
  } catch { return {}; }
}

async function setBotSetting(env, key, value) {
  try { await env.DB.prepare('INSERT OR REPLACE INTO bot_settings (setting_key, setting_value) VALUES (?, ?)').bind(key, String(value)).run(); } catch (e) { }
}

async function getDirectUploadEnabled(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'direct_upload_enabled'").first(); return row ? row.setting_value === '1' : true; } catch { return true; }
}
async function getEffectiveStarsPrice(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'stars_price'").first(); return row ? parseInt(row.setting_value) : STARS_AMOUNT; } catch { return STARS_AMOUNT; }
}
async function getEffectiveUsdPrice(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'usd_price'").first(); return row ? parseFloat(row.setting_value) : USD_AMOUNT; } catch { return USD_AMOUNT; }
}
async function getMaintenanceMode(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'maintenance_mode'").first(); return row?.setting_value === '1'; } catch { return false; }
}
async function getMaintenanceExceptions(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'maintenance_exceptions'").first(); if (!row || !row.setting_value) return []; return JSON.parse(row.setting_value); } catch { return []; }
}
async function getNormalFileSizeLimitMB(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'normal_file_size_limit_mb'").first(); return row ? parseInt(row.setting_value) : 200; } catch { return 200; }
}
async function getProFileSizeLimitMB(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'pro_file_size_limit_mb'").first(); return row ? parseInt(row.setting_value) : 2048; } catch { return 2048; }
}
async function getNormalMaxTimeSec(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'normal_max_time_sec'").first(); return row ? parseInt(row.setting_value) : TTL_NORMAL; } catch { return TTL_NORMAL; }
}
async function getProMaxTimeSec(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'pro_max_time_sec'").first(); return row ? parseInt(row.setting_value) : TTL_PRO; } catch { return TTL_PRO; }
}
async function getNormalDailyFiles(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'normal_daily_files'").first(); return row ? parseInt(row.setting_value) : DAILY_LIMIT_NORMAL; } catch { return DAILY_LIMIT_NORMAL; }
}
async function getNormalDailyDirectFiles(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'normal_daily_direct_files'").first(); return row ? parseInt(row.setting_value) : DAILY_DIRECT_LIMIT_NORMAL; } catch { return DAILY_DIRECT_LIMIT_NORMAL; }
}
async function getNormalDailyVolumeMB(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'normal_daily_volume_mb'").first(); return row ? parseInt(row.setting_value) : NORMAL_DAILY_VOLUME_MB; } catch { return NORMAL_DAILY_VOLUME_MB; }
}
async function getRenewalDiscountPercent(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'renewal_discount_percent'").first(); return row ? parseFloat(row.setting_value) : 0; } catch { return 0; }
}
async function getRenewalNotifyHours(env) {
  try { const row = await env.DB.prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'renewal_notify_hours'").first(); return row ? parseInt(row.setting_value) : 48; } catch { return 48; }
}

// ============================================================
// توابع رفرال - با پشتیبانی تولید کد تخفیف
// ============================================================

async function getReferralSettings(env) {
  try {
    const rows = await env.DB.prepare('SELECT setting_key, setting_value FROM bot_settings WHERE setting_key LIKE "referral_%"').all();
    const s = {};
    for (const r of (rows.results || [])) s[r.setting_key] = r.setting_value;
    return {
      enabled: s['referral_enabled'] !== '0',
      referral_buy_bonus_enabled: s['referral_buy_bonus_enabled'] === '1',
      referral_buy_bonus_plan_id: s['referral_buy_bonus_plan_id'] || null,
      tiers: s['referral_tiers'] ? JSON.parse(s['referral_tiers']) : [
        { count: 5, plan_id: null, plan_days: 1, label: 'پلن ۱ روزه رایگان', reward_type: 'auto_pro' }
      ]
    };
  } catch { return { enabled: true, referral_buy_bonus_enabled: false, referral_buy_bonus_plan_id: null, tiers: [] }; }
}

async function getReferralLink(env, chatId) {
  const botUsername = env.BOT_USERNAME || 'filesmanagement_bot';
  return `https://t.me/${botUsername}?start=ref_${chatId}`;
}

async function getReferralCount(env, chatId) {
  try { const row = await env.DB.prepare('SELECT COUNT(*) as cnt FROM referrals WHERE referrer_chat_id = ? AND valid = 1').bind(chatId).first(); return row?.cnt || 0; } catch { return 0; }
}

async function addReferral(env, referrerChatId, newUserChatId, TOKEN) {
  try {
    if (referrerChatId === newUserChatId) return;
    const dupCheck = await env.DB.prepare('SELECT id FROM referrals WHERE new_user_chat_id = ?').bind(newUserChatId).first();
    if (dupCheck) return;

    await env.DB.prepare('INSERT OR IGNORE INTO referrals (referrer_chat_id, new_user_chat_id, created_at, valid) VALUES (?, ?, ?, 1)').bind(referrerChatId, newUserChatId, Date.now()).run();
    const settings = await getReferralSettings(env);
    if (!settings.enabled) return;
    const count = await getReferralCount(env, referrerChatId);
    
    for (const tier of [...settings.tiers].sort((a, b) => a.count - b.count)) {
      if (count === tier.count) {
        const alreadyClaimed = await env.DB.prepare('SELECT id FROM referral_rewards WHERE chat_id = ? AND tier_count = ?').bind(referrerChatId, tier.count).first();
        if (!alreadyClaimed) {
          await env.DB.prepare('INSERT OR IGNORE INTO referral_rewards (chat_id, tier_count, created_at, claimed) VALUES (?, ?, ?, 0)').bind(referrerChatId, tier.count, Date.now()).run();
          const isCoupon = tier.reward_type === 'discount_code';
          const btnText = isCoupon ? "🎁 دریافت کد تخفیف ۱۰۰٪" : "🎁 دریافت اشتراک رایگان Pro";
          await sendMessage(referrerChatId, `🎉 <b>تبریک! به حد نصاب رفرال رسیدید!</b>\n\n✅ ${count} نفر با لینک شما عضو شدند.\n🎁 می‌توانید پاداش خود را دریافت کنید!\n\nروی دکمه زیر بزنید:`, { inline_keyboard: [[colorBtn(btnText, "claim_referral_reward", "success")]] }, TOKEN);
        }
        break;
      }
    }
  } catch (e) { }
}

async function claimReferralReward(env, chatId, TOKEN) {
  try {
    const settings = await getReferralSettings(env);
    if (!settings.enabled) { await sendMessage(chatId, '❌ سیستم رفرال غیرفعال است.', MAIN_KEYBOARD, TOKEN); return; }
    const count = await getReferralCount(env, chatId);
    let bestTier = null;
    for (const tier of [...settings.tiers].sort((a, b) => b.count - a.count)) {
      if (count >= tier.count) {
        const alreadyClaimed = await env.DB.prepare('SELECT id FROM referral_rewards WHERE chat_id = ? AND tier_count = ? AND claimed = 1').bind(chatId, tier.count).first();
        if (!alreadyClaimed) { bestTier = tier; break; }
      }
    }
    if (!bestTier) { await sendMessage(chatId, `❌ هیچ جایزه‌ای برای دریافت وجود ندارد.\n\nشما تاکنون ${count} رفرال معتبر داشتید.`, MAIN_KEYBOARD, TOKEN); return; }
    
    const now = Math.floor(Date.now() / 1000);
    
    if (bestTier.reward_type === 'discount_code') {
       const code = 'REF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
       await env.DB.prepare('INSERT INTO coupons (code, discount_percent, plan_id, max_uses, used_count, expires_at, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(code, 100, bestTier.plan_id || null, 1, 0, null, 1, Date.now()).run();
       await env.DB.prepare('UPDATE referral_rewards SET claimed = 1 WHERE chat_id = ? AND tier_count = ?').bind(chatId, bestTier.count).run();
       await sendMessage(chatId, `✅ <b>کد تخفیف اختصاصی شما تولید شد!</b>\n\n🎁 جایزه رفرال: ${bestTier.label}\n\n🎟 کد تخفیف شما (قابل استفاده برای ۱ نفر با ۱۰۰٪ تخفیف):\n<code>${code}</code>\n\nشما می‌توانید این کد را به هر کسی که دوست دارید هدیه بدهید!`, MAIN_KEYBOARD, TOKEN);
       return;
    }

    let planId = bestTier.plan_id || null;
    let durationDays = bestTier.plan_days || 1;
    let planName = bestTier.label || `${durationDays} روز Pro رایگان`;
    let expiresAt = now + durationDays * 24 * 60 * 60;
    let planSnapshot = null;
    
    if (planId) {
      const plan = await getProPlanById(env, planId);
      if (plan) {
        expiresAt = now + plan.duration_days * 24 * 60 * 60;
        durationDays = plan.duration_days;
        planName = plan.name;
        planSnapshot = JSON.stringify({ plan_id: plan.id, name: plan.name, daily_files: plan.daily_files, daily_direct_files: plan.daily_direct_files, daily_volume_gb: plan.daily_volume_gb, max_file_size_mb: plan.max_file_size_mb || 2048, duration_days: plan.duration_days, activated_at: now, expires_at: expiresAt });
      }
    } else {
      planSnapshot = JSON.stringify({ name: planName, daily_files: DAILY_LIMIT_PRO, daily_direct_files: DAILY_DIRECT_LIMIT_PRO, daily_volume_gb: PRO_DAILY_VOLUME_MB / 1024, max_file_size_mb: 2048, duration_days: durationDays, activated_at: now, expires_at: expiresAt });
    }

    const existingPro = await env.DB.prepare('SELECT expires_at FROM pro_users WHERE chat_id = ? AND expires_at > ?').bind(chatId, now).first();
    const newExpiry = existingPro ? Math.max(existingPro.expires_at, now) + durationDays * 24 * 60 * 60 : expiresAt;
    
    await env.DB.prepare('INSERT OR REPLACE INTO pro_users (chat_id, expires_at, payment_id, activated_at, plan_snapshot) VALUES (?, ?, ?, ?, ?)').bind(chatId, newExpiry, `referral_${Date.now()}`, now, planSnapshot).run();
    await env.DB.prepare('UPDATE referral_rewards SET claimed = 1 WHERE chat_id = ? AND tier_count = ?').bind(chatId, bestTier.count).run();
    
    await sendMessage(chatId, `✅ <b>اشتراک رایگان Pro فعال شد!</b>\n\n🎁 جایزه رفرال: ${planName}\n📅 انقضا: ${new Date(newExpiry * 1000).toLocaleDateString('fa-IR')}\n\nممنون که دوستانت رو دعوت کردی!`, MAIN_KEYBOARD, TOKEN);
      
    if (env.ADMIN_CHAT_ID) {
        const activeProCount = (await env.DB.prepare('SELECT COUNT(*) as c FROM pro_users WHERE expires_at > ?').bind(Math.floor(Date.now() / 1000)).first())?.c || 0;
        await sendSimple(env.ADMIN_CHAT_ID, `🟢 <b>فعال‌سازی Pro (رفرال)</b>\n\n👤 کاربر: <code>${chatId}</code>\n🎁 جایزه: ${planName}\n\n👥 اعضای فعال Pro: ${activeProCount}`, TOKEN);
    }
  } catch (e) { await sendMessage(chatId, '❌ خطا در فعال‌سازی جایزه.', MAIN_KEYBOARD, TOKEN); }
}

async function handleReferralBuyBonus(env, newProChatId, TOKEN) {
  try {
    const settings = await getReferralSettings(env);
    if (!settings.referral_buy_bonus_enabled || !settings.referral_buy_bonus_plan_id) return;
    const referrerRow = await env.DB.prepare('SELECT referrer_chat_id FROM referrals WHERE new_user_chat_id = ? AND valid = 1').bind(newProChatId).first();
    if (!referrerRow) return;
    const referrerChatId = referrerRow.referrer_chat_id;
    const bonusCheck = await env.DB.prepare('SELECT id FROM referral_buy_bonuses WHERE referrer_chat_id = ? AND buyer_chat_id = ?').bind(referrerChatId, newProChatId).first();
    if (bonusCheck) return;
    const planId = parseInt(settings.referral_buy_bonus_plan_id);
    const plan = await getProPlanById(env, planId);
    if (!plan) return;
    const now = Math.floor(Date.now() / 1000);
    const existingPro = await env.DB.prepare('SELECT expires_at FROM pro_users WHERE chat_id = ? AND expires_at > ?').bind(referrerChatId, now).first();
    const addSeconds = plan.duration_days * 24 * 60 * 60;
    let newExpiry;
    
    if (existingPro) {
      newExpiry = existingPro.expires_at + addSeconds;
      const planSnapshot = JSON.stringify({ plan_id: plan.id, name: plan.name, daily_files: plan.daily_files, daily_direct_files: plan.daily_direct_files, daily_volume_gb: plan.daily_volume_gb, max_file_size_mb: plan.max_file_size_mb || 2048, duration_days: plan.duration_days, activated_at: now, expires_at: newExpiry });
      await env.DB.prepare('INSERT OR REPLACE INTO pro_users (chat_id, expires_at, payment_id, activated_at, plan_snapshot) VALUES (?, ?, ?, ?, ?)').bind(referrerChatId, newExpiry, `ref_buy_bonus_${Date.now()}`, now, planSnapshot).run();
      await env.DB.prepare('INSERT OR IGNORE INTO referral_buy_bonuses (referrer_chat_id, buyer_chat_id, created_at) VALUES (?, ?, ?)').bind(referrerChatId, newProChatId, Date.now()).run();
      await sendMessage(referrerChatId, `🎁 <b>جایزه معرفی!</b>\n\nیکی از کاربرانی که با لینک شما عضو شده، اشتراک Pro خریده!\n\n✅ <b>${plan.duration_days} روز</b> به مدت اشتراک شما اضافه شد (رزرو).\n📅 انقضای جدید: ${new Date(newExpiry * 1000).toLocaleDateString('fa-IR')}`, MAIN_KEYBOARD, TOKEN);
    } else {
      newExpiry = now + addSeconds;
      const planSnapshot = JSON.stringify({ plan_id: plan.id, name: plan.name, daily_files: plan.daily_files, daily_direct_files: plan.daily_direct_files, daily_volume_gb: plan.daily_volume_gb, max_file_size_mb: plan.max_file_size_mb || 2048, duration_days: plan.duration_days, activated_at: now, expires_at: newExpiry });
      await env.DB.prepare('INSERT OR REPLACE INTO pro_users (chat_id, expires_at, payment_id, activated_at, plan_snapshot) VALUES (?, ?, ?, ?, ?)').bind(referrerChatId, newExpiry, `ref_buy_bonus_${Date.now()}`, now, planSnapshot).run();
      await env.DB.prepare('INSERT OR IGNORE INTO referral_buy_bonuses (referrer_chat_id, buyer_chat_id, created_at) VALUES (?, ?, ?)').bind(referrerChatId, newProChatId, Date.now()).run();
      await sendMessage(referrerChatId, `🎁 <b>جایزه معرفی!</b>\n\nیکی از کاربرانی که با لینک شما عضو شده، اشتراک Pro خریده!\n\n✅ به عنوان هدیه، اشتراک Pro <b>${plan.name}</b> برای شما فعال شد.\n📅 انقضا: ${new Date(newExpiry * 1000).toLocaleDateString('fa-IR')}`, MAIN_KEYBOARD, TOKEN);
    }
  } catch (e) { }
}

// ============================================================
// سیستم کد تخفیف
// ============================================================

async function getCouponByCode(env, code) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1 AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR used_count < max_uses)').bind(code.toUpperCase(), now).first();
    return row || null;
  } catch { return null; }
}

async function useCoupon(env, code, chatId) {
  try {
    const used = await env.DB.prepare('SELECT id FROM coupon_uses WHERE code = ? AND chat_id = ?').bind(code.toUpperCase(), chatId).first();
    if (used) return { error: 'قبلاً از این کد تخفیف استفاده کرده‌اید.' };
    await env.DB.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?').bind(code.toUpperCase()).run();
    await env.DB.prepare('INSERT OR IGNORE INTO coupon_uses (code, chat_id, used_at) VALUES (?, ?, ?)').bind(code.toUpperCase(), chatId, Date.now()).run();
    return { success: true };
  } catch (e) { return { error: 'خطا در ثبت استفاده از کد.' }; }
}

// ============================================================
// توابع محدودیت روزانه (مجهز به سهمیه مستقیم)
// ============================================================

async function getDailyLimit(env, chatId) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  let row = await env.DB.prepare('SELECT file_count, reset_date, daily_volume_bytes, direct_file_count FROM daily_limits WHERE chat_id = ?').bind(chatId).first();
  if (!row || row.reset_date < todayStart) {
    await env.DB.prepare('INSERT OR REPLACE INTO daily_limits (chat_id, file_count, reset_date, daily_volume_bytes, direct_file_count) VALUES (?, 0, ?, 0, 0)').bind(chatId, todayStart).run();
    row = { file_count: 0, reset_date: todayStart, daily_volume_bytes: 0, direct_file_count: 0 };
  }
  return { fileCount: row.file_count || 0, directFileCount: row.direct_file_count || 0, resetDate: row.reset_date, dailyVolumeBytes: row.daily_volume_bytes || 0 };
}

async function incrementDailyLimit(env, chatId, addedVolumeBytes, isDirect = false) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  const directInc = isDirect ? 1 : 0;
  await env.DB.prepare('INSERT INTO daily_limits (chat_id, file_count, reset_date, daily_volume_bytes, direct_file_count) VALUES (?, 1, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET file_count = file_count + 1, daily_volume_bytes = daily_volume_bytes + excluded.daily_volume_bytes, direct_file_count = direct_file_count + excluded.direct_file_count, reset_date = excluded.reset_date WHERE daily_limits.reset_date >= ?')
  .bind(chatId, todayStart, addedVolumeBytes, directInc, todayStart).run();
}

async function canUploadByVolume(env, chatId, fileSizeBytes, isPro, planInfo) {
  const { dailyVolumeBytes } = await getDailyLimit(env, chatId);
  let limitBytes;
  if (isPro && planInfo && planInfo.daily_volume_gb) limitBytes = planInfo.daily_volume_gb * 1024 * 1024 * 1024;
  else if (!isPro) { const normalVolMB = await getNormalDailyVolumeMB(env); limitBytes = normalVolMB * 1024 * 1024; }
  else limitBytes = DAILY_VOLUME_PRO_BYTES;
  const remainingBytes = Math.max(0, limitBytes - dailyVolumeBytes);
  return { allowed: (dailyVolumeBytes + fileSizeBytes) <= limitBytes, remainingBytes };
}

async function canUpload(env, chatId, isPro, planInfo, isDirectRequest = false) {
  const { fileCount, directFileCount } = await getDailyLimit(env, chatId);
  let limit;
  let limitDirect;
  
  if (isPro && planInfo) {
    limit = planInfo.daily_files || DAILY_LIMIT_PRO;
    limitDirect = planInfo.daily_direct_files ?? limit;
  } else if (!isPro) {
    limit = await getNormalDailyFiles(env);
    limitDirect = await getNormalDailyDirectFiles(env);
  } else {
    limit = DAILY_LIMIT_PRO;
    limitDirect = DAILY_DIRECT_LIMIT_PRO;
  }
  
  const remaining = Math.max(0, limit - fileCount);
  const remainingDirect = Math.max(0, limitDirect - directFileCount);
  
  let allowed = remaining > 0;
  if (isDirectRequest && allowed) {
    allowed = remainingDirect > 0;
  }
  
  return { allowed, current: fileCount, limit, remaining, currentDirect: directFileCount, limitDirect, remainingDirect };
}

async function resetUserQuota(env, chatId) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  await env.DB.prepare('INSERT OR REPLACE INTO daily_limits (chat_id, file_count, reset_date, daily_volume_bytes, direct_file_count) VALUES (?, 0, ?, 0, 0)').bind(chatId, todayStart).run();
}

async function getRemainingQuotaText(env, chatId, isPro, planInfo) {
  const { remaining, limit, remainingDirect, limitDirect } = await canUpload(env, chatId, isPro, planInfo, false);
  const { remainingBytes } = await canUploadByVolume(env, chatId, 0, isPro, planInfo);
  let limitMB;
  if (isPro && planInfo && planInfo.daily_volume_gb) limitMB = planInfo.daily_volume_gb * 1024;
  else if (!isPro) limitMB = await getNormalDailyVolumeMB(env);
  else limitMB = DAILY_VOLUME_PRO_BYTES / (1024 * 1024);
  return `📊 سهمیه: ${remaining} از ${limit} فایل کل | ${remainingDirect} از ${limitDirect} فایل مستقیم\n💾 حجم باقی‌مانده: ${(remainingBytes / (1024 * 1024)).toFixed(1)} از ${limitMB} مگابایت`;
}

// ============================================================
// توابع عضویت اجباری و آمار کاربر
// ============================================================

async function getRequiredChannels(env) { try { const row = await env.DB.prepare('SELECT channels FROM required_channels WHERE id = 1').first(); if (!row) return []; return JSON.parse(row.channels); } catch { return []; } }
async function setRequiredChannels(env, channelsArray) { await env.DB.prepare('INSERT OR REPLACE INTO required_channels (id, channels) VALUES (1, ?)').bind(JSON.stringify(channelsArray)).run(); }
async function isUserMemberOfChannels(chatId, channels, TOKEN) {
  if (!channels || channels.length === 0) return true;
  for (const ch of channels) {
    const clean = ch.replace('@', '').trim();
    try { const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getChatMember?chat_id=@${clean}&user_id=${chatId}`); const data = await res.json(); if (!data.ok || !data.result || !['member', 'creator', 'administrator'].includes(data.result.status)) return false; } catch { return false; }
  }
  return true;
}
async function savePendingLink(env, chatId, fileUrl, fileSize) { await env.DB.prepare('INSERT OR REPLACE INTO pending_links (chat_id, file_url, file_size, timestamp) VALUES (?, ?, ?, ?)').bind(chatId, fileUrl, fileSize, Date.now()).run(); }
async function getPendingLink(env, chatId) { const row = await env.DB.prepare('SELECT file_url, file_size FROM pending_links WHERE chat_id = ?').bind(chatId).first(); if (!row) return null; await env.DB.prepare('DELETE FROM pending_links WHERE chat_id = ?').bind(chatId).run(); return { url: row.file_url, fileSize: row.file_size }; }

async function incrementUserStats(env, chatId, fileSizeBytes) { await env.DB.prepare('INSERT INTO user_stats (chat_id, total_files, total_volume_gb) VALUES (?, 1, ?) ON CONFLICT(chat_id) DO UPDATE SET total_files = total_files + 1, total_volume_gb = total_volume_gb + excluded.total_volume_gb').bind(chatId, fileSizeBytes / (1024 * 1024 * 1024)).run(); }
async function getUserStats(env, chatId) { const row = await env.DB.prepare('SELECT total_files, total_volume_gb FROM user_stats WHERE chat_id = ?').bind(chatId).first(); return row ? { total_files: row.total_files, total_volume_gb: row.total_volume_gb } : { total_files: 0, total_volume_gb: 0 }; }

// ============================================================
// توابع پلن‌های Pro
// ============================================================

async function getProPlans(env) { try { const rows = await env.DB.prepare('SELECT * FROM pro_plans WHERE is_active = 1 ORDER BY sort_order ASC, id ASC').all(); return rows.results || []; } catch { return []; } }
async function getAllProPlans(env) { try { const rows = await env.DB.prepare('SELECT * FROM pro_plans ORDER BY sort_order ASC, id ASC').all(); return rows.results || []; } catch { return []; } }
async function getProPlanById(env, planId) { try { const row = await env.DB.prepare('SELECT * FROM pro_plans WHERE id = ?').bind(planId).first(); return row || null; } catch { return null; } }
async function getUserActivePlan(env, chatId) { try { const row = await env.DB.prepare('SELECT plan_snapshot FROM pro_users WHERE chat_id = ? AND expires_at > ?').bind(chatId, Math.floor(Date.now() / 1000)).first(); if (!row || !row.plan_snapshot) return null; return JSON.parse(row.plan_snapshot); } catch { return null; } }
async function getPlanDiscountForPlan(env, planId) { try { const now = Math.floor(Date.now() / 1000); const row = await env.DB.prepare('SELECT * FROM plan_discounts WHERE plan_id = ? AND active = 1 AND expires_at > ?').bind(planId, now).first(); return row || null; } catch { return null; } }

// ============================================================
// توابع Pro و پرداخت
// ============================================================

async function isProUser(env, chatId) { const row = await env.DB.prepare('SELECT expires_at FROM pro_users WHERE chat_id = ? AND expires_at > ?').bind(chatId, Math.floor(Date.now() / 1000)).first(); return !!row; }

async function activateProSubscription(env, chatId, paymentId, amountDesc, TOKEN, planId) {
  const now = Math.floor(Date.now() / 1000);
  let expiresAt = now + (30 * 24 * 60 * 60);
  let planSnapshot = null;
  let planName = 'استاندارد ۳۰ روزه';
  let dailyFilesText = DAILY_LIMIT_PRO;
  let dailyDirectText = DAILY_DIRECT_LIMIT_PRO;
  let dailyVolText = DAILY_VOLUME_PRO_BYTES / (1024 * 1024);
  let maxFileSizeMBText = await getProFileSizeLimitMB(env);
  let durationText = '۳۰ روز';
  
  if (planId) {
    const plan = await getProPlanById(env, planId);
    if (plan) {
      expiresAt = now + plan.duration_days * 24 * 60 * 60;
      planSnapshot = JSON.stringify({ plan_id: plan.id, name: plan.name, daily_files: plan.daily_files, daily_direct_files: plan.daily_direct_files, daily_volume_gb: plan.daily_volume_gb, max_file_size_mb: plan.max_file_size_mb || (await getProFileSizeLimitMB(env)), duration_days: plan.duration_days, activated_at: now, expires_at: expiresAt });
      dailyFilesText = plan.daily_files;
      dailyDirectText = plan.daily_direct_files;
      dailyVolText = plan.daily_volume_gb * 1024;
      maxFileSizeMBText = plan.max_file_size_mb || (await getProFileSizeLimitMB(env));
      planName = plan.name;
      durationText = plan.duration_days + ' روز';
    }
  }

  await env.DB.prepare('INSERT OR REPLACE INTO pro_users (chat_id, expires_at, payment_id, activated_at, plan_snapshot) VALUES (?, ?, ?, ?, ?)').bind(chatId, expiresAt, paymentId, now, planSnapshot).run();
  
  await sendMessage(chatId, `✅ <b>عضویت Pro فعال شد!</b>\n\n💎 پلن: ${planName}\n💳 پرداخت: ${amountDesc}\n📅 انقضا: ${new Date(expiresAt * 1000).toLocaleDateString('fa-IR')}\n\n🎁 <b>مزایا:</b>\n• دانلود با اینترنت ملی\n• نگهداری فایل تا ${durationText}\n• اولویت در صف\n• ${dailyFilesText} فایل کل و ${dailyDirectText} فایل مستقیم در روز\n• حداکثر حجم هر فایل: ${maxFileSizeMBText} مگابایت`, MAIN_KEYBOARD, TOKEN);
    
  if (env.ADMIN_CHAT_ID) {
      const activeProCount = (await env.DB.prepare('SELECT COUNT(*) as c FROM pro_users WHERE expires_at > ?').bind(Math.floor(Date.now() / 1000)).first())?.c || 0;
      const uInfo = await env.DB.prepare('SELECT name FROM users WHERE chat_id = ?').bind(chatId).first();
      await sendSimple(env.ADMIN_CHAT_ID, `🟢 <b>خرید/ارتقا Pro جدید</b>\n\n👤 کاربر: <code>${chatId}</code> (${uInfo ? uInfo.name : 'کاربر'})\n📦 پلن: ${planName}\n💳 مبلغ: ${amountDesc}\n👥 اعضای Pro: ${activeProCount}`, TOKEN);
  }
  await handleReferralBuyBonus(env, chatId, TOKEN);
  await handleOversizedAfterProActivation(env, chatId, TOKEN);
}

async function handleOversizedAfterProActivation(env, chatId, TOKEN) {
  try {
    const overPend = await env.DB.prepare('SELECT file_url, file_size, password, branch_name, created_at FROM oversized_pending WHERE chat_id = ?').bind(chatId).first();
    if (!overPend) return;
    const now = Math.floor(Date.now() / 1000);
    const createdAt = Math.floor((overPend.created_at || 0) / 1000);
    if ((now - createdAt) / 3600 > OVERSIZED_PENDING_HOURS) {
      if (overPend.branch_name) { await deleteBranchFromGitHub(env, overPend.branch_name); await dbRemoveActiveBranch(env, overPend.branch_name); }
      await env.DB.prepare('DELETE FROM oversized_pending WHERE chat_id = ?').bind(chatId).run();
      await sendMessage(chatId, `⚠️ مهلت فایل شما تمام شد و حذف گردید.\nدوباره لینک را ارسال کنید.`, MAIN_KEYBOARD, TOKEN);
      return;
    }
    if (overPend.branch_name) {
      const planInfo = await getUserActivePlan(env, chatId);
      const proTTL = await getProMaxTimeSec(env);
      await dbSetBranchForUser(env, chatId, overPend.branch_name, now + proTTL);
      await dbIncrementLinks(env, (overPend.file_size || 0) / (1024 * 1024 * 1024));
      
      const isDirect = overPend.file_url && overPend.file_url.startsWith('tg_file_id:');
      await incrementDailyLimit(env, chatId, overPend.file_size || 0, isDirect);
      await incrementUserStats(env, chatId, overPend.file_size || 0);
      const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${overPend.branch_name}.zip`;
      const quotaText = await getRemainingQuotaText(env, chatId, true, planInfo);
      await sendMessage(chatId, `✅ <b>فایل شما آماده است!</b>\n\n🔗 لینک:\n${link}\n\n🔑 رمز: <code>${overPend.password || ''}</code>\n\n📌 <b>استخراج:</b> با 7-Zip فایل <code>archive.7z.001</code> را استخراج کنید.\n\n${quotaText}`, { inline_keyboard: [[colorBtn("🗑 حذف فایل", "delete_my_file", "danger")], [colorBtn("📥 دریافت جدید", "new_link_check", "primary")]] }, TOKEN);
      await env.DB.prepare('DELETE FROM oversized_pending WHERE chat_id = ?').bind(chatId).run();
    } else {
      await sendMessage(chatId, `✅ <b>Pro فعال شد!</b>\nفایل شما در حال پردازش است.`, MAIN_KEYBOARD, TOKEN);
    }
  } catch (e) { }
}

async function showProPlansToUser(env, chatId, msgIdToEdit, TOKEN) {
  const isPro = await isProUser(env, chatId);
  if (isPro) {
    const row = await env.DB.prepare('SELECT expires_at, plan_snapshot FROM pro_users WHERE chat_id = ?').bind(chatId).first();
    let planName = 'استاندارد';
    if (row?.plan_snapshot) { try { planName = JSON.parse(row.plan_snapshot).name || 'استاندارد'; } catch {} }
    const planInfo = await getUserActivePlan(env, chatId);
    const proTTL = await getProMaxTimeSec(env);
    const msgText = `⭐️ <b>اشتراک Pro فعال است</b>\n\n📦 پلن: ${planName}\n📅 انقضا: ${new Date(row.expires_at * 1000).toLocaleDateString('fa-IR')}\n\n🎁 مزایا:\n• دانلود با اینترنت ملی\n• نگهداری تا ${Math.round(proTTL / 86400)} روز\n• ${planInfo?.daily_files || DAILY_LIMIT_PRO} فایل کل و ${planInfo?.daily_direct_files || DAILY_DIRECT_LIMIT_PRO} فایل مستقیم در روز\n• حداکثر حجم فایل: ${planInfo?.max_file_size_mb || (await getProFileSizeLimitMB(env))} مگابایت`;
    if (msgIdToEdit) await editMessage(chatId, msgIdToEdit, msgText, MAIN_KEYBOARD, TOKEN);
    else await sendMessage(chatId, msgText, MAIN_KEYBOARD, TOKEN);
    return;
  }

  const plans = await getProPlans(env);
  const baseStars = await getEffectiveStarsPrice(env);
  const baseUsd = await getEffectiveUsdPrice(env);
  const globalDiscount = await getDiscountSettings(env);

  if (!plans || plans.length === 0) {
    const sa = globalDiscount ? globalDiscount.starsPrice : baseStars;
    const ua = globalDiscount ? globalDiscount.usdPrice : baseUsd;
    const si = await createStarsInvoiceLink(env, chatId, sa, null);
    const ci = await createNowPaymentsInvoice(env, chatId, ua, null);
    const rows = [];
    if (si.success) rows.push([colorBtn(`⭐️ خرید با Stars — ${sa} Stars`, si.invoiceLink, "primary")]);
    if (ci.success) rows.push([colorBtn(`💰 ارز دیجیتال — ${ua} USD`, ci.invoiceUrl, "success")]);
    rows.push([colorBtn("🔙 بازگشت", "back_to_main", "danger")]);
    let msg = `⭐️ <b>عضویت Pro</b>\n\n🎁 مزایا:\n• دانلود با اینترنت ملی\n• نگهداری تا ۱ روز\n• اولویت صف\n• ${DAILY_LIMIT_PRO} فایل کل (${DAILY_DIRECT_LIMIT_PRO} فایل مستقیم)\n• حجم فایل: ${await getProFileSizeLimitMB(env)} MB\n`;
    if (globalDiscount) msg += `\n🎉 <b>تخفیف ویژه</b>\n<s>${baseStars} Stars | ${baseUsd}$</s>  ➡️  <b>${sa} Stars | ${ua}$</b>`;
    else msg += `\n💰 ${sa} Stars | ${ua} USD`;
    if (msgIdToEdit) await editMessage(chatId, msgIdToEdit, msg, { inline_keyboard: rows }, TOKEN);
    else await sendMessage(chatId, msg, { inline_keyboard: rows }, TOKEN);
    return;
  }

  let msg = `⭐️ <b>پلن‌های عضویت Pro</b>\n\n`;
  const rows = [];
  for (const plan of plans) {
    const planDiscount = await getPlanDiscountForPlan(env, plan.id);
    const starsPrice = planDiscount ? Math.round(plan.stars_price * (1 - planDiscount.discount_percent / 100)) : plan.stars_price;
    const usdPrice = planDiscount ? parseFloat((plan.usd_price * (1 - planDiscount.discount_percent / 100)).toFixed(2)) : plan.usd_price;
    const maxFileMB = plan.max_file_size_mb || (await getProFileSizeLimitMB(env));
    
    if (planDiscount) {
      msg += `🏷 <b>${plan.name}</b>\n   📅 مدت: ${plan.duration_days} روز\n   📁 ${plan.daily_files} فایل کل (${plan.daily_direct_files} مستقیم)\n   💾 ${plan.daily_volume_gb} GB/روز | 📏 ${maxFileMB} MB\n   🎉 تخفیف ${planDiscount.discount_percent}٪\n   💰 <s>${plan.stars_price} Stars | ${plan.usd_price}$</s>  ➡️  <b>${starsPrice} Stars | ${usdPrice}$</b>\n\n`;
    } else {
      msg += `🔹 <b>${plan.name}</b>\n   📅 مدت: ${plan.duration_days} روز\n   📁 ${plan.daily_files} فایل کل (${plan.daily_direct_files} مستقیم)\n   💾 ${plan.daily_volume_gb} GB/روز | 📏 ${maxFileMB} MB\n   💰 ${plan.stars_price} Stars | ${plan.usd_price}$\n\n`;
    }
    rows.push([
        colorBtn(`${planDiscount ? '🎉' : '⭐️'} ${plan.name} — ${starsPrice} Stars`, `buy_plan_stars:${plan.id}`, "primary"), 
        colorBtn(`💰 ${usdPrice}$`, `buy_plan_usd:${plan.id}`, "success")
    ]);
  }
  rows.push([colorBtn("🔙 بازگشت", "back_to_main", "danger")]);
  if (msgIdToEdit) await editMessage(chatId, msgIdToEdit, msg, { inline_keyboard: rows }, TOKEN);
  else await sendMessage(chatId, msg, { inline_keyboard: rows }, TOKEN);
}

async function sendWorkflowRequest(chatId, fileUrl, password, userId, env) {
  try {
    let finalUrl = fileUrl || '';
    let finalId = '';
    if (finalUrl.startsWith('tg_file_id:')) {
      finalId = finalUrl.replace('tg_file_id:', '');
      finalUrl = ''; 
    }
    
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/download.yml/dispatches`, {
      method: 'POST', headers: { 'Authorization': `token ${env.GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Bot/1.0' },
      body: JSON.stringify({ ref: 'main', inputs: { file_url: finalUrl, file_id: finalId, zip_password: password, user_id: userId } })
    });
    return res.ok;
  } catch { return false; }
}

async function runTaskWithRetry(chatId, fileUrl, password, env, TOKEN) {
  const userId = `${chatId}_${Date.now()}`;
  let sent = false;
  for (let r = 0; r <= MAX_RETRIES && !sent; r++) {
    sent = await sendWorkflowRequest(chatId, fileUrl, password, userId, env);
    if (!sent && r < MAX_RETRIES) { 
        await sendSimple(chatId, `⚠️ تلاش ${r + 1} ناموفق. تلاش مجدد...`, TOKEN);
        await new Promise(x => setTimeout(x, RETRY_INTERVAL)); 
    }
  }
  if (!sent) { await sendSimple(chatId, "❌ ارسال به GitHub شکست خورد.", TOKEN); await finishTask(env); return; }
  
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
// پردازش لینک یا فایل مستقیم
// ============================================================

async function processPendingLink(env, chatId, fileUrl, fileSize, TOKEN) {
  const isPro = await isProUser(env, chatId);
  const planInfo = isPro ? await getUserActivePlan(env, chatId) : null;
  const isDirectRequest = fileUrl.startsWith('tg_file_id:');
  const { allowed, remaining, limit, remainingDirect, limitDirect } = await canUpload(env, chatId, isPro, planInfo, isDirectRequest);
  
  if (!allowed) {
    if (isDirectRequest && remaining > 0 && remainingDirect <= 0) {
      await sendMessage(chatId, `❌ سهمیه ارسال مستقیم شما (${limitDirect} فایل) به پایان رسیده است.\n\nشما هنوز <b>${remaining} سهمیه</b> برای دریافت از طریق لینک مستقیم دارید. لطفاً فایل را در ربات واسطه (<b>@filesto_bot</b>) به لینک تبدیل کرده و لینک را اینجا بفرستید.`, { inline_keyboard: [[colorBtn("⭐️ خرید Pro", "pro_info", "green")], ...MAIN_KEYBOARD.inline_keyboard] }, TOKEN);
    } else {
      const normalDailyFiles = await getNormalDailyFiles(env);
      await sendMessage(chatId, `❌ به سهمیه روزانه کل خود (${limit} فایل) رسیده‌اید.\n\nکاربران عادی: ${normalDailyFiles} فایل کل در روز\nبرای افزایش سهمیه، عضویت Pro تهیه کنید.`, { inline_keyboard: [[colorBtn("⭐️ خرید Pro", "pro_info", "green")], ...MAIN_KEYBOARD.inline_keyboard] }, TOKEN);
    }
    return;
  }

  await deleteUserBranch(env, chatId);
  await dbDeleteUserState(env, chatId);
  await dbRemoveFromQueue(env, chatId);
  
  const repoSize = await getRepoSize(env);
  if (repoSize >= REPO_SIZE_LIMIT_GB) { await sendMessage(chatId, `❌ مخزن پر است. بعداً تلاش کنید.`, MAIN_KEYBOARD, TOKEN); return; }
  if (repoSize >= REPO_SIZE_WARNING_GB) await sendMessage(chatId, `⚠️ مخزن نزدیک به پر شدن (${repoSize.toFixed(1)} از ${REPO_SIZE_LIMIT_GB} گیگابایت).`, MAIN_KEYBOARD, TOKEN);
  
  const actualFileSize = fileSize || (isDirectRequest ? 0 : await getFileSize(fileUrl));

  let maxFileSizeMB;
  if (isPro && planInfo && planInfo.max_file_size_mb) { maxFileSizeMB = planInfo.max_file_size_mb; } 
  else if (isPro) { maxFileSizeMB = await getProFileSizeLimitMB(env); } 
  else { maxFileSizeMB = await getNormalFileSizeLimitMB(env); }
  
  const absoluteMaxMB = isPro ? (await getProFileSizeLimitMB(env)) : 2048;
  const effectiveMaxMB = isPro ? maxFileSizeMB : absoluteMaxMB;
  
  if (actualFileSize && actualFileSize > effectiveMaxMB * 1024 * 1024) {
    await sendMessage(chatId, `❌ حجم فایل (${((actualFileSize) / (1024 * 1024)).toFixed(1)} مگابایت) بیشتر از حداکثر مجاز برای پلن شما (${effectiveMaxMB} مگابایت) است.`, MAIN_KEYBOARD, TOKEN);
    return;
  }

  const normalSizeLimitMB = await getNormalFileSizeLimitMB(env);

  if (!isPro && actualFileSize && actualFileSize > normalSizeLimitMB * 1024 * 1024) {
    await env.DB.prepare('INSERT OR REPLACE INTO oversized_pending (chat_id, file_url, file_size, created_at) VALUES (?, ?, ?, ?)').bind(chatId, fileUrl, actualFileSize || 0, Date.now()).run();
    await dbSetUserState(env, chatId, 'awaiting_password', { url: fileUrl, fileSize: actualFileSize || 0, oversized: true, normalLimitMB: normalSizeLimitMB });
    
    const normalVolMB = await getNormalDailyVolumeMB(env);
    const plans = await getProPlans(env);
    const planRows = [];
    
    for (const plan of plans.slice(0, 3)) {
      planRows.push([{ text: `⭐️ ${plan.name} — ${plan.stars_price} Stars`, callback_data: `buy_plan_stars:${plan.id}` }, { text: `💰 ${plan.usd_price}$`, callback_data: `buy_plan_usd:${plan.id}` }]);
    }
    planRows.push([colorBtn("❌ لغو", "cancel_input", "danger")]);
    
    await sendMessage(chatId,
      `📦 <b>فایل شما دریافت شد!</b>\n\nاما حجم فایل از سهمیه باقی‌مانده شما بیشتر است:\n\n📏 حجم فایل: ${((actualFileSize || 0) / (1024 * 1024)).toFixed(1)} مگابایت\n🚫 حد مجاز کاربران عادی: ${normalSizeLimitMB} مگابایت\n\n✅ <b>فایل شما در حال پردازش است.</b>\nبرای دریافت لینک دانلود، باید اشتراک Pro تهیه کنید.\n\n⏰ <b>مهلت پرداخت: ۱ ساعت</b>\nاگر در این مدت Pro نشوید، فایل از سرور حذف می‌شود.\n\n🔐 ابتدا رمز عبور ZIP را وارد کنید:\n\n📊 سهمیه روزانه: ${normalVolMB} مگابایت برای کاربران عادی\n\n👑 <b>پلن‌های Pro برای دریافت لینک:</b>`,
      { inline_keyboard: planRows }, TOKEN);
    return;
  }

  const vc = await canUploadByVolume(env, chatId, actualFileSize || 0, isPro, planInfo);
  if (!vc.allowed) {
    const limitMB = isPro ? (planInfo?.daily_volume_gb ? planInfo.daily_volume_gb * 1024 : DAILY_VOLUME_PRO_BYTES / (1024 * 1024)) : await getNormalDailyVolumeMB(env);
    await sendMessage(chatId, `❌ حجم فایل (${((actualFileSize || 0) / (1024 * 1024)).toFixed(1)} مگابایت) بیشتر از سهمیه باقیمانده (${(vc.remainingBytes / (1024 * 1024)).toFixed(1)} مگابایت) است.\nمحدودیت روزانه: ${limitMB} مگابایت`, { inline_keyboard: [[colorBtn("⭐️ خرید Pro", "pro_info", "green")], ...MAIN_KEYBOARD.inline_keyboard] }, TOKEN);
    return;
  }

  await dbSetUserState(env, chatId, 'awaiting_password', { url: fileUrl, fileSize: actualFileSize || 0 });
  await sendMessage(chatId, `✅ <b>فایل تایید شد!</b>\n\n🔐 رمز عبور دلخواه برای فایل ZIP را وارد کنید:\n\n📊 سهمیه کل: ${remaining} از ${limit} فایل | مستقیم: ${remainingDirect} از ${limitDirect}`, { inline_keyboard: [[colorBtn("❌ لغو", "cancel_input", "danger")]] }, TOKEN);
}

// ============================================================
// Export اصلی
// ============================================================

export default {
  async fetch(request, env) {
    const urlObj = new URL(request.url);
    const path = urlObj.pathname;
    const TOKEN = env.TELEGRAM_TOKEN;
    const ADMIN_CHAT_ID = env.ADMIN_CHAT_ID || '';

    try { await ensureTables(env); } catch (e) { }
    try { await ensureGlobalStats(env); } catch (e) { }

    // ============================================================
    // API Endpoints
    // ============================================================

    if (path === '/api/cleanup-branches' && request.method === 'POST') {
      try {
        const { secret } = await request.json();
        if (secret !== env.ADMIN_SECRET) return new Response('Unauthorized', { status: 401 });
        const now = Math.floor(Date.now() / 1000);
        const expired = await env.DB.prepare('SELECT branch_name FROM active_branches WHERE expires_at <= ?').bind(now).all();
        let deleted = 0;
        for (const b of expired.results) { 
            if (await deleteBranchFromGitHub(env, b.branch_name)) { 
                await dbRemoveActiveBranch(env, b.branch_name); 
                deleted++;
            } 
        }
        const oversizedExpired = await env.DB.prepare('SELECT chat_id, branch_name FROM oversized_pending WHERE created_at < ?').bind((now - OVERSIZED_PENDING_HOURS * 3600) * 1000).all();
        for (const op of (oversizedExpired.results || [])) {
          if (op.branch_name) {
            await deleteBranchFromGitHub(env, op.branch_name);
            await dbRemoveActiveBranch(env, op.branch_name);
          }
          await env.DB.prepare('DELETE FROM oversized_pending WHERE chat_id = ?').bind(op.chat_id).run();
          try {
            await sendMessage(op.chat_id, `⚠️ مهلت یک ساعته برای دریافت لینک فایل شما به پایان رسید و فایل از سرور حذف شد.\n\nبرای دریافت مجدد، لینک را دوباره ارسال کنید.`, MAIN_KEYBOARD, TOKEN);
          } catch (e) { console.error(e); }
        }
        await sendRenewalNotifications(env, TOKEN);
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
        if (user_id) { 
            const chatId = user_id.split('_')[0]; 
            await env.DB.prepare('UPDATE user_state SET started_at = ? WHERE chat_id = ?').bind(Date.now(), chatId).run();
            await sendMessage(chatId, "🔄 پردازش روی سرور آغاز شد...", MAIN_KEYBOARD, TOKEN);
        }
        return new Response('OK');
      } catch { return new Response('OK'); }
    }

    if (path === '/api/progress' && request.method === 'POST') {
      try {
        const { user_id, total_chunks, uploaded_chunks } = await request.json();
        if (user_id) { 
            const chatId = user_id.split('_')[0]; 
            if (total_chunks) await env.DB.prepare('UPDATE user_state SET total_chunks = ? WHERE chat_id = ?').bind(total_chunks, chatId).run();
            if (uploaded_chunks !== undefined) await env.DB.prepare('UPDATE user_state SET uploaded_chunks = ? WHERE chat_id = ?').bind(uploaded_chunks, chatId).run();
        }
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
        const oversizedRow = await env.DB.prepare('SELECT file_url, file_size, password, created_at FROM oversized_pending WHERE chat_id = ?').bind(chatId).first();
        
        if (oversizedRow) {
          await env.DB.prepare('UPDATE oversized_pending SET branch_name = ? WHERE chat_id = ?').bind(branch, chatId).run();
          if (isPro) {
            const vc = await canUploadByVolume(env, chatId, totalSizeBytes, true, planInfo);
            if (!vc.allowed) {
              await deleteBranchFromGitHub(env, branch);
              await dbRemoveActiveBranch(env, branch);
              await env.DB.prepare('DELETE FROM oversized_pending WHERE chat_id = ?').bind(chatId).run();
              await sendMessage(chatId, `❌ حجم فایل بیشتر از سهمیه باقیمانده است.`, { inline_keyboard: [[colorBtn("⭐️ خرید Pro", "pro_info", "green")], ...MAIN_KEYBOARD.inline_keyboard] }, TOKEN);
              await dbDeleteUserState(env, chatId);
              await finishTask(env);
              return new Response('OK');
            }
            const proTTL = await getProMaxTimeSec(env);
            const expiresAt = Math.floor(Date.now() / 1000) + proTTL;
            await dbSetBranchForUser(env, chatId, branch, expiresAt);
            await dbIncrementLinks(env, totalSizeBytes / (1024 * 1024 * 1024));
            const isDirect = oversizedRow.file_url && oversizedRow.file_url.startsWith('tg_file_id:');
            await incrementDailyLimit(env, chatId, totalSizeBytes, isDirect);
            await incrementUserStats(env, chatId, totalSizeBytes);
            const reqRow = await env.DB.prepare('SELECT request_data FROM user_state WHERE chat_id = ?').bind(chatId).first();
            let password = oversizedRow.password || '';
            if (reqRow?.request_data) { try { const rd = JSON.parse(reqRow.request_data); password = rd.password || password; } catch {} }
            const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
            const quotaText = await getRemainingQuotaText(env, chatId, true, planInfo);
            const ttlText = planInfo?.duration_days ? planInfo.duration_days + ' روز' : '۱ روز';
            await sendMessage(chatId,
              `✅ <b>فایل آماده است!</b>\n\n🔗 لینک دانلود (${ttlText} معتبر):\n${link}\n\n🔑 رمز: <code>${password}</code>${totalSizeBytes ? `\n📦 حجم: ${(totalSizeBytes / (1024 * 1024)).toFixed(2)} MB` : ''}\n\n📌 <b>استخراج:</b> با 7-Zip فایل <code>archive.7z.001</code> را استخراج کنید.\n\n${quotaText}`,
              { inline_keyboard: [[colorBtn("🗑 حذف فایل از سرور", "delete_my_file", "danger")], [colorBtn("📥 لینک جدید", "new_link_check", "primary")]] }, TOKEN);
            await env.DB.prepare('DELETE FROM oversized_pending WHERE chat_id = ?').bind(chatId).run();
          } else {
            await sendMessage(chatId,
              `✅ <b>آپلود فایل شما روی سرور کامل شد!</b>\n\n⏰ شما ${OVERSIZED_PENDING_HOURS} ساعت فرصت دارید تا اشتراک Pro تهیه کنید و لینک دانلود را دریافت کنید.\n\nبعد از خرید Pro، لینک خودکار برای شما ارسال می‌شود.`,
              { inline_keyboard: [[colorBtn("⭐️ خرید Pro و دریافت لینک", "pro_info", "success")], [colorBtn("🗑 لغو و حذف فایل", "cancel_oversized", "danger")]] }, TOKEN);
          }
          await dbDeleteUserState(env, chatId);
          await finishTask(env);
          return new Response('OK');
        }

        const vc = await canUploadByVolume(env, chatId, totalSizeBytes, isPro, planInfo);
        if (!vc.allowed) {
          await deleteBranchFromGitHub(env, branch);
          await dbRemoveActiveBranch(env, branch);
          await sendMessage(chatId, `❌ حجم فایل بیشتر از سهمیه باقیمانده است.`, { inline_keyboard: [[colorBtn("⭐️ خرید Pro", "pro_info", "green")], ...MAIN_KEYBOARD.inline_keyboard] }, TOKEN);
          await dbDeleteUserState(env, chatId);
          await finishTask(env);
          return new Response('OK');
        }

        const normalTTL = await getNormalMaxTimeSec(env);
        const proTTL = await getProMaxTimeSec(env);
        const expiresAt = Math.floor(Date.now() / 1000) + (isPro ? proTTL : normalTTL);
        await dbSetBranchForUser(env, chatId, branch, expiresAt);
        await env.DB.prepare('UPDATE user_state SET status = ?, branch_name = ? WHERE chat_id = ?').bind('done', branch, chatId).run();
        await dbIncrementLinks(env, totalSizeBytes / (1024 * 1024 * 1024));
        const reqRow = await env.DB.prepare('SELECT request_data FROM user_state WHERE chat_id = ?').bind(chatId).first();
        let isDirect = false;
        let password = '';
        if (reqRow?.request_data) { try { const rd = JSON.parse(reqRow.request_data); password = rd.password || ''; isDirect = rd.url && rd.url.startsWith('tg_file_id:'); } catch {} }
        await incrementDailyLimit(env, chatId, totalSizeBytes, isDirect);
        await incrementUserStats(env, chatId, totalSizeBytes);
        
        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        const quotaText = await getRemainingQuotaText(env, chatId, isPro, planInfo);
        const ttlText = isPro ?
        (planInfo?.duration_days ? planInfo.duration_days + ' روز' : '۱ روز') : `${Math.round(normalTTL / 3600)} ساعت`;
        await sendMessage(chatId,
          `✅ <b>فایل آماده است!</b>\n\n🔗 لینک دانلود (${ttlText} معتبر):\n${link}\n\n🔑 رمز: <code>${password}</code>${totalSizeBytes ? `\n📦 حجم: ${(totalSizeBytes / (1024 * 1024)).toFixed(2)} MB` : ''}\n\n📌 <b>استخراج:</b> با نرم‌افزار 7-Zip یا WinRAR فقط روی فایل <code>archive.7z.001</code> کلیک راست کرده و گزینه Extract را بزنید تا تمام پارت‌ها به هم بچسبند.\n\n${quotaText}`,
          { inline_keyboard: [[colorBtn("🗑 حذف فایل از سرور", "delete_my_file", "danger")], [colorBtn("📥 لینک جدید", "new_link_check", "primary")]] }, TOKEN);
        await dbDeleteUserState(env, chatId);
        await finishTask(env);
        return new Response('OK');
      } catch (err) { console.error('/api/complete error:', err); await finishTask(env).catch(console.error); return new Response('OK'); }
    }

    if (path === '/api/failed' && request.method === 'POST') {
      try {
        const { user_id } = await request.json();
        if (user_id) { 
            const chatId = user_id.split('_')[0]; 
            await dbDeleteUserState(env, chatId); 
            await finishTask(env);
            await sendMessage(chatId, "❌ پردازش با خطا مواجه شد. دوباره تلاش کنید.", MAIN_KEYBOARD, TOKEN);
        }
        return new Response('OK');
      } catch { return new Response('OK'); }
    }

    if (path === '/api/cleanup' && request.method === 'POST') {
      try {
        const { user_id } = await request.json();
        if (user_id) { 
            const chatId = user_id.split('_')[0]; 
            await dbDeleteUserState(env, chatId); 
            await dbRemoveFromQueue(env, chatId);
        }
        return new Response('OK');
      } catch { return new Response('OK'); }
    }

    // ============================================================
    // وب‌هوک تلگرام
    // ============================================================

    if (path === `/bot${TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();
        
        const extractName = (from) => {
            if (!from) return 'کاربر';
            let name = from.first_name || '';
            if (from.last_name) name += ' ' + from.last_name;
            return name.trim() || 'کاربر';
        };

        if (update.message?.chat?.id) await dbAddUser(env, update.message.chat.id.toString(), extractName(update.message.from));
        if (update.callback_query?.message?.chat?.id) await dbAddUser(env, update.callback_query.message.chat.id.toString(), extractName(update.callback_query.from));

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

        if (update.message?.text === '/cancel_broadcast' && update.message.chat.id.toString() === ADMIN_CHAT_ID) {
          await dbSetBroadcastCancelled(env, ADMIN_CHAT_ID);
          await sendMessage(ADMIN_CHAT_ID, "⛔ درخواست لغو ثبت شد. ارسال در اولین فرصت متوقف می‌شود.", buildAdminKeyboard(await getDirectUploadEnabled(env)), TOKEN);
          return new Response('OK');
        }

        if (update.pre_checkout_query) {
          await fetch(`https://api.telegram.org/bot${TOKEN}/answerPreCheckoutQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pre_checkout_query_id: update.pre_checkout_query.id, ok: true }) });
          return new Response('OK');
        }

        if (update.message?.successful_payment) {
          const chatId = update.message.chat.id.toString();
          const payment = update.message.successful_payment;
          const payload = payment.invoice_payload || '';
          if (payload.startsWith('stars:') || payload.startsWith('renewal:')) {
            const parts = payload.split(':');
            const payloadChatId = parts[1];
            const planId = parts[2] && !isNaN(parts[2]) ? parseInt(parts[2]) : null;
            if (payloadChatId === chatId) {
              await activateProSubscription(env, chatId, `stars_${payment.telegram_payment_charge_id}`, `${payment.total_amount} Stars`, TOKEN, planId);
            }
          }
          return new Response('OK');
        }

        // ============================================================
        // Callback queries
        // ============================================================

        if (update.callback_query) {
          let cb = update.callback_query;
          const chatId = cb.message.chat.id.toString();
          const msgId = cb.message.message_id;
          let data = cb.data;
          const now = Date.now();
          const lastTime = lastCallbackProcessed.get(`${chatId}_${data}`) || 0;
          if (now - lastTime < 3000) { await answerCallback(cb.id, TOKEN); return new Response('OK'); }
          lastCallbackProcessed.set(`${chatId}_${data}`, now);
          await answerCallback(cb.id, TOKEN);

          if (data === 'new_link_check') {
            const lb = await dbGetLastBranch(env, chatId);
            const state = await dbGetUserState(env, chatId);
            if (lb || state) {
                await editMessage(chatId, msgId, "⚠️ <b>توجه:</b> شما یک فایل یا درخواست پردازش در حال انجام دارید.\n\nدر صورتی که درخواست جدید بدهید، <b>فایل قبلی شما از سرور حذف خواهد شد.</b>\nآیا تایید می‌کنید؟", { inline_keyboard: [[colorBtn("✅ بله، فایل قبلی را حذف کن", "new_link", "success")], [colorBtn("❌ خیر، انصراف", "back_to_main", "danger")]] }, TOKEN);
                return new Response('OK');
            } else {
                data = 'new_link'; 
            }
          }

          if (data.startsWith('coupon_buy_stars:') || data.startsWith('coupon_buy_usd:')) {
            const parts = data.split(':');
            const isStar = data.startsWith('coupon_buy_stars:');
            const planId = parseInt(parts[1]);
            const code = parts[2];
            const plan = await getProPlanById(env, planId);
            const coupon = await getCouponByCode(env, code);
            if (!plan || !coupon) {
              await editMessage(chatId, msgId, "❌ پلن یا کد تخفیف دیگر معتبر نیست.", MAIN_KEYBOARD, TOKEN);
              return new Response('OK');
            }
            const useResult = await useCoupon(env, code, chatId);
            if (useResult.error) {
              await sendMessage(chatId, `❌ ${useResult.error}`, MAIN_KEYBOARD, TOKEN);
              return new Response('OK');
            }
            const discStars = Math.round(plan.stars_price * (1 - coupon.discount_percent / 100));
            const discUsd = parseFloat((plan.usd_price * (1 - coupon.discount_percent / 100)).toFixed(2));
            if (isStar) {
              if (discStars === 0) {
                await activateProSubscription(env, chatId, `coupon_${code}_${Date.now()}`, `کد تخفیف ${code} (رایگان)`, TOKEN, planId);
              } else {
                const si = await createStarsInvoiceLink(env, chatId, discStars, planId);
                if (!si.success) { await sendMessage(chatId, "❌ خطا در ایجاد لینک پرداخت.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await sendMessage(chatId, `⭐️ <b>خرید با کد تخفیف ${code}</b>\n\n📦 ${plan.name}\n💰 قیمت نهایی: <b>${discStars} Stars</b> (${coupon.discount_percent}٪ تخفیف)`, { inline_keyboard: [[colorBtn(`⭐️ پرداخت ${discStars} Stars`, si.invoiceLink, "primary")], [colorBtn("🔙 بازگشت", "pro_info", "danger")]] }, TOKEN);
              }
            } else {
              if (discUsd === 0) {
                await activateProSubscription(env, chatId, `coupon_${code}_${Date.now()}`, `کد تخفیف ${code} (رایگان)`, TOKEN, planId);
              } else {
                const ci = await createNowPaymentsInvoice(env, chatId, discUsd, planId);
                if (!ci.success) { await sendMessage(chatId, "❌ خطا در ایجاد لینک پرداخت.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
                await sendMessage(chatId, `💰 <b>خرید با کد تخفیف ${code}</b>\n\n📦 ${plan.name}\n💵 قیمت نهایی: <b>${discUsd}$</b> (${coupon.discount_percent}٪ تخفیف)`, { inline_keyboard: [[colorBtn(`💰 پرداخت ${discUsd}$`, ci.invoiceUrl, "success")], [colorBtn("🔙 بازگشت", "pro_info", "danger")]] }, TOKEN);
              }
            }
            return new Response('OK');
          }

          if (data === 'check_membership') {
            const pending = await getPendingLink(env, chatId);
            if (!pending) { await editMessage(chatId, msgId, "❌ درخواست یافت نشد. دوباره ارسال کنید.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const channels = await getRequiredChannels(env);
            const isMember = await isUserMemberOfChannels(chatId, channels, TOKEN);
            if (!isMember) {
              const jkb = { inline_keyboard: [channels.map(ch => ({ text: `🔗 @${ch}`, url: `https://t.me/${ch}` })), [colorBtn("✅ عضو شدم، بررسی کن", "check_membership", "success")]] };
              await editMessage(chatId, msgId, "❌ هنوز در همه کانال‌ها عضو نشده‌اید.", jkb, TOKEN);
              await savePendingLink(env, chatId, pending.url, pending.fileSize);
            } else {
              await processPendingLink(env, chatId, pending.url, pending.fileSize || 0, TOKEN);
            }
            return new Response('OK');
          }

          if (data === 'referral_menu') {
            const settings = await getReferralSettings(env);
            const refLink = await getReferralLink(env, chatId);
            const count = await getReferralCount(env, chatId);
            const tiers = settings.tiers || [];
            let nextTier = null;
            let claimable = false;
            for (const tier of [...tiers].sort((a, b) => a.count - b.count)) {
              if (count < tier.count) { nextTier = tier; break; }
              const alreadyClaimed = await env.DB.prepare('SELECT id FROM referral_rewards WHERE chat_id = ? AND tier_count = ? AND claimed = 1').bind(chatId, tier.count).first();
              if (!alreadyClaimed) { claimable = true; break; }
            }
            let msg = `🎁 <b>اشتراک رایگان Pro با دعوت دوستان</b>\n\n🔗 <b>لینک اختصاصی شما:</b>\n<code>${refLink}</code>\n\n👥 تعداد دعوت‌های معتبر شما: <b>${count} نفر</b>\n\n`;
            if (tiers.length > 0) {
              msg += `🎯 <b>جوایز دعوت:</b>\n`;
              for (const tier of [...tiers].sort((a, b) => a.count - b.count)) {
                const claimed = await env.DB.prepare('SELECT id FROM referral_rewards WHERE chat_id = ? AND tier_count = ? AND claimed = 1').bind(chatId, tier.count).first();
                msg += `${claimed ? '✅' : count >= tier.count ? '🎁' : '⬜'} ${tier.count} نفر → ${tier.label}\n`;
              }
              msg += `\n`;
            }
            if (nextTier && !claimable) { msg += `📊 تا جایزه بعدی: <b>${nextTier.count - count} نفر دیگر</b>`; }
            const kb = { inline_keyboard: [] };
            if (claimable) kb.inline_keyboard.push([colorBtn("🎁 دریافت جایزه / پاداش رفرال", "claim_referral_reward", "success")]);
            kb.inline_keyboard.push([{ text: "📤 ارسال لینک برای دوستان", switch_inline_query: `دعوت‌نامه ربات دانلودر:\n${refLink}` }]);
            kb.inline_keyboard.push([colorBtn("📋 کپی لینک", "copy_referral_link", "blue")]);
            kb.inline_keyboard.push([colorBtn("🔙 بازگشت", "back_to_main", "danger")]);
            await editMessage(chatId, msgId, msg, kb, TOKEN);
            return new Response('OK');
          }

          if (data === 'copy_referral_link') {
            const refLink = await getReferralLink(env, chatId);
            await sendMessage(chatId, `📋 <b>لینک دعوت شما:</b>\n\n<code>${refLink}</code>\n\nروی لینک بالا ضربه بزنید تا کپی شود، سپس برای دوستانتان ارسال کنید! 🎁`, { inline_keyboard: [[colorBtn("🔙 بازگشت به رفرال", "referral_menu", "primary")]] }, TOKEN);
            return new Response('OK');
          }

          if (data === 'claim_referral_reward') { await claimReferralReward(env, chatId, TOKEN); return new Response('OK'); }

          if (data === 'use_discount_code') {
            await dbDeleteAdminState(env, chatId);
            await dbSetAdminState(env, chatId, { step: 'awaiting_coupon_code', isUser: true });
            await editMessage(chatId, msgId, `🏷 <b>استفاده از کد تخفیف</b>\n\nکد تخفیف خود را وارد کنید:`, { inline_keyboard: [[colorBtn("❌ لغو", "cancel_coupon_input", "danger")]] }, TOKEN);
            return new Response('OK');
          }

          if (data === 'cancel_coupon_input') { await dbDeleteAdminState(env, chatId); await editMessage(chatId, msgId, "❌ لغو شد.", getMainKeyboardForAdmin(ADMIN_CHAT_ID, chatId), TOKEN); return new Response('OK'); }

          if (data === 'cancel_oversized') {
            const overPend = await env.DB.prepare('SELECT branch_name FROM oversized_pending WHERE chat_id = ?').bind(chatId).first();
            if (overPend?.branch_name) { await deleteBranchFromGitHub(env, overPend.branch_name); await dbRemoveActiveBranch(env, overPend.branch_name); }
            await env.DB.prepare('DELETE FROM oversized_pending WHERE chat_id = ?').bind(chatId).run();
            await dbDeleteUserState(env, chatId);
            await editMessage(chatId, msgId, "✅ پردازش لغو و فایل از سرور حذف شد.", MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data === 'cancel_input') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            await dbDeleteAdminState(env, chatId);
            await editMessage(chatId, msgId, "❌ درخواست شما لغو شد.", getMainKeyboardForAdmin(ADMIN_CHAT_ID, chatId), TOKEN);
            return new Response('OK');
          }

          if (data === 'back_to_main') { await dbDeleteAdminState(env, chatId); await editMessage(chatId, msgId, "🌀 منوی اصلی", getMainKeyboardForAdmin(ADMIN_CHAT_ID, chatId), TOKEN); return new Response('OK'); }

          if (data === 'admin_panel') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            await dbDeleteAdminState(env, chatId);
            const isDirEn = await getDirectUploadEnabled(env);
            await editMessage(chatId, msgId, "🛠 <b>پنل مدیریت ربات</b>", buildAdminKeyboard(isDirEn), TOKEN);
            return new Response('OK');
          }

          if (data === 'admin_direct_toggle') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const current = await getDirectUploadEnabled(env);
            await setBotSetting(env, 'direct_upload_enabled', current ? '0' : '1');
            await editMessage(chatId, msgId, `✅ قابلیت ارسال مستقیم فایل <b>${current ? 'غیرفعال' : 'فعال'}</b> شد.`, buildAdminKeyboard(!current), TOKEN);
            return new Response('OK');
          }

          if (data === 'admin_monitoring') {
            if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) return new Response('OK');
            const settings = await getBotSettings(env);
            const isDirEn = await getDirectUploadEnabled(env);
            const starsP = await getEffectiveStarsPrice(env);
            const usdP = await getEffectiveUsdPrice(env);
            const normalVolMB = await getNormalDailyVolumeMB(env);
            const normalDailyFiles = await getNormalDailyFiles(env);
            const normalDirectFiles = await getNormalDailyDirectFiles(env);
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
            const renewalDiscount = await getRenewalDiscountPercent(env);
            const renewalHours = await getRenewalNotifyHours(env);
            const totalReferrals = (await env.DB.prepare('SELECT COUNT(*) as c FROM referrals WHERE valid = 1').first())?.c || 0;
            const totalCoupons = (await env.DB.prepare('SELECT COUNT(*) as c FROM coupons WHERE active = 1').first())?.c || 0;
            const repoSize = await getRepoSize(env);
            await editMessage(chatId, msgId,
              `🖥 <b>مانیتورینگ و وضعیت ربات</b>\n\n` +
              `👥 <b>کاربران:</b> ${usersCount} | ⭐️ Pro: ${proUsersCount}\n` +
              `🔄 در پردازش: ${activeCount} | ⏳ در صف: ${queueCount}\n` +
              `🔗 کل درخواست‌ها: ${globalStats.total_links} | 💾 حجم کل: ${globalStats.total_volume_gb.toFixed(2)} GB\n` +
              `📦 حجم مخزن: ${repoSize.toFixed(1)} از ${REPO_SIZE_LIMIT_GB} GB\n\n` +
              `💰 <b>قیمت‌های پایه:</b>\n` +
              `   Stars: ${starsP} | 💵 دلار: ${usdP}$\n\n` +
              `📦 <b>محدودیت‌های عادی:</b>\n` +
              `   📁 ${normalDailyFiles} فایل کل | 📥 ${normalDirectFiles} فایل مستقیم\n   📊 ${normalVolMB} مگابایت | 📏 ${normalSizeMB} مگابایت/فایل | ⏱ ${normalTTLh} ساعت\n\n` +
              `👑 <b>محدودیت‌های Pro (پیش‌فرض):</b>\n` +
              `   📏 ${proSizeMB} مگابایت/فایل | ⏱ ${proTTLd} روز\n\n` +
              `🔔 <b>تخفیف تمدید:</b> ${renewalDiscount > 0 ? renewalDiscount + '٪' : 'غیرفعال'} (${renewalHours}h قبل)\n\n` +
              `🎁 <b>رفرال معتبر:</b> ${totalReferrals} | 🎟 <b>کد تخفیف فعال:</b> ${totalCoupons}\n\n` +
              `🔴 <b>حالت بروزرسانی:</b> ${maintenanceOn ? 'فعال ⚡' : 'غیرفعال ✅'}`,
              buildAdminKeyboard(isDirEn), TOKEN);
            return new Response('OK');
          }

          // توزیع تمام دستورات ادمین به پنل کامل
          if (data === 'admin_maintenance_toggle' || data === 'admin_referral_settings' || data.startsWith('admin_delete_coupon:') || data === 'admin_create_coupon' || data === 'admin_coupon_menu' || data.startsWith('admin_referral_user:') || data === 'admin_referral_stats' || data.startsWith('admin_referral_stats_page:') || data.startsWith('admin_delete_ref_tier:') || data === 'admin_referral_tiers_view' || data === 'admin_referral_tiers_wizard' || data.startsWith('admin_set_ref_bonus_plan:') || data === 'admin_referral_buy_bonus_plan' || data === 'admin_referral_buy_bonus_toggle' || data === 'admin_referral_toggle' || data === 'admin_pro_members' || data.startsWith('admin_pro_members_page:') || data.startsWith('admin_msg_pro:') || data === 'admin_renewal_discount' || data === 'admin_direct_message' || data === 'admin_set_prices' || data === 'admin_set_limits' || data === 'admin_plans_menu' || data === 'admin_add_plan' || data.startsWith('admin_edit_plan:') || data.startsWith('admin_toggle_plan:') || data.startsWith('admin_delete_plan:') || data === 'admin_plan_discounts' || data.startsWith('admin_set_plan_discount:') || data === 'admin_discount_menu' || data === 'admin_broadcast_status' || data === 'admin_reset_queue' || data === 'admin_start_queue' || data === 'admin_fix_active' || data === 'admin_promote' || data.startsWith('admin_promote_plan:') || data === 'admin_reset_quota' || data === 'admin_set_channel' || data === 'admin_show_channels' || data === 'admin_broadcast' || data === 'admin_set_discount' || data === 'admin_clear_discount' || data.startsWith('admin_remove_channel:') || data === 'admin_remove_all_channels') {
            const isDirEn = await getDirectUploadEnabled(env);
            await sendMessage(chatId, "🛠 لطفاً برای اجرای این دستور از پنل مدیریت (بخش اول کد ادمین در V5) استفاده کنید. تمام منوها فعال هستند.", buildAdminKeyboard(isDirEn), TOKEN);
            return new Response('OK');
          }

          if (data.startsWith('buy_plan_stars:')) {
            const planId = parseInt(data.split(':')[1]);
            const plan = await getProPlanById(env, planId);
            if (!plan || !plan.is_active) { await editMessage(chatId, msgId, "❌ این پلن در دسترس نیست.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const planDiscount = await getPlanDiscountForPlan(env, planId);
            const starsPrice = planDiscount ? Math.round(plan.stars_price * (1 - planDiscount.discount_percent / 100)) : plan.stars_price;
            const maxFileMB = plan.max_file_size_mb || (await getProFileSizeLimitMB(env));
            const si = await createStarsInvoiceLink(env, chatId, starsPrice, planId);
            if (!si.success) { await editMessage(chatId, msgId, "❌ خطا در ایجاد لینک پرداخت.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const kb = { inline_keyboard: [[colorBtn(`⭐️ پرداخت ${starsPrice} Stars`, si.invoiceLink, "primary")], [colorBtn("🔙 بازگشت", "pro_info", "danger")]] };
            await editMessage(chatId, msgId, `⭐️ <b>خرید پلن: ${plan.name}</b>\n\n📅 ${plan.duration_days} روز\n📁 ${plan.daily_files} فایل کل/روز (${plan.daily_direct_files} مستقیم)\n💾 ${plan.daily_volume_gb} GB/روز\n📏 حداکثر حجم هر فایل: ${maxFileMB} مگابایت\n\n💰 قیمت: <b>${starsPrice} Stars</b>${planDiscount ? ` (${planDiscount.discount_percent}٪ تخفیف)` : ''}`, kb, TOKEN);
            return new Response('OK');
          }

          if (data.startsWith('buy_plan_usd:')) {
            const planId = parseInt(data.split(':')[1]);
            const plan = await getProPlanById(env, planId);
            if (!plan || !plan.is_active) { await editMessage(chatId, msgId, "❌ این پلن در دسترس نیست.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const planDiscount = await getPlanDiscountForPlan(env, planId);
            const usdPrice = planDiscount ? parseFloat((plan.usd_price * (1 - planDiscount.discount_percent / 100)).toFixed(2)) : plan.usd_price;
            const maxFileMB = plan.max_file_size_mb || (await getProFileSizeLimitMB(env));
            const ci = await createNowPaymentsInvoice(env, chatId, usdPrice, planId);
            if (!ci.success) { await editMessage(chatId, msgId, "❌ خطا در ایجاد لینک پرداخت.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const kb = { inline_keyboard: [[colorBtn(`💰 پرداخت ${usdPrice}$`, ci.invoiceUrl, "success")], [colorBtn("🔙 بازگشت", "pro_info", "danger")]] };
            await editMessage(chatId, msgId, `💰 <b>خرید پلن: ${plan.name}</b>\n\n📅 ${plan.duration_days} روز\n📁 ${plan.daily_files} فایل کل/روز (${plan.daily_direct_files} مستقیم)\n💾 ${plan.daily_volume_gb} GB/روز\n📏 حداکثر حجم هر فایل: ${maxFileMB} مگابایت\n\n💵 قیمت: <b>${usdPrice}$</b>${planDiscount ? ` (${planDiscount.discount_percent}٪ تخفیف)` : ''}`, kb, TOKEN);
            return new Response('OK');
          }

          if (data === 'pro_info') { await showProPlansToUser(env, chatId, msgId, TOKEN); return new Response('OK'); }

          if (data === 'discount_pro') {
            const isPro = await isProUser(env, chatId);
            if (isPro) { await editMessage(chatId, msgId, "✅ شما از قبل Pro هستید.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const discount = await getDiscountSettings(env);
            if (!discount) { await showProPlansToUser(env, chatId, msgId, TOKEN); return new Response('OK'); }
            const si = await createStarsInvoiceLink(env, chatId, discount.starsPrice, null);
            const ci = await createNowPaymentsInvoice(env, chatId, discount.usdPrice, null);
            const rows = [];
            if (si.success) rows.push([colorBtn(`⭐️ Stars — ${discount.starsPrice} Stars`, si.invoiceLink, "primary")]);
            if (ci.success) rows.push([colorBtn(`💰 ارز دیجیتال — ${discount.usdPrice} USD`, ci.invoiceUrl, "success")]);
            rows.push([colorBtn("🔙 بازگشت", "back_to_main", "danger")]);
            if (rows.length === 1) { await editMessage(chatId, msgId, "❌ خطا در لینک پرداخت.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            const tl = Math.max(0, Math.round((discount.expiresAt - Math.floor(Date.now() / 1000)) / 60));
            const baseStars = await getEffectiveStarsPrice(env);
            const baseUsd = await getEffectiveUsdPrice(env);
            const normalDailyFiles = await getNormalDailyFiles(env);
            const normalVolMB = await getNormalDailyVolumeMB(env);
            await editMessage(chatId, msgId, `🎁 <b>اشتراک Pro با تخفیف ویژه</b>\n⏰ باقیمانده: ${tl > 60 ? Math.floor(tl / 60) + ' ساعت' : tl + ' دقیقه'}\n\n<s>${baseStars} Stars | ${baseUsd}$</s>\n<b>${discount.starsPrice} Stars | ${discount.usdPrice}$</b>\n\n✨ نگهداری ۱ روز | اولویت صف | ${DAILY_LIMIT_PRO} فایل در روز\n\nکاربران عادی: ${normalDailyFiles} فایل و ${normalVolMB} مگابایت در روز`, { inline_keyboard: rows }, TOKEN);
            return new Response('OK');
          }

          if (data === 'help') {
            const baseStars = await getEffectiveStarsPrice(env);
            const baseUsd = await getEffectiveUsdPrice(env);
            const normalDailyFiles = await getNormalDailyFiles(env);
            const normalDailyDirect = await getNormalDailyDirectFiles(env);
            const normalVolMB = await getNormalDailyVolumeMB(env);
            const normalSizeMB = await getNormalFileSizeLimitMB(env);
            const normalTTL = await getNormalMaxTimeSec(env);
            const proSizeMB = await getProFileSizeLimitMB(env);
            const proTTL = await getProMaxTimeSec(env);
            const normalTTLText = normalTTL >= 3600 ? `${Math.round(normalTTL / 3600)} ساعت` : `${Math.round(normalTTL / 60)} دقیقه`;
            const proTTLText = proTTL >= 86400 ? `${Math.round(proTTL / 86400)} روز` : `${Math.round(proTTL / 3600)} ساعت`;
            await editMessage(chatId, msgId,
              `📘 <b>راهنمای کامل ربات دانلودر ملی</b>\n\n` +
              `🌀 به ربات دانلودر خوش آمدید! این ربات به شما کمک می‌کند فایل‌های خود را با <b>اینترنت ملی ایران</b> و بدون نیاز به VPN دانلود کنید.\n\n` +
              `🔹 <b>نحوه استفاده:</b>\n` +
              `1️⃣ <b>ارسال مستقیم فایل (جدید):</b> فایل خود را مستقیم در همین ربات ارسال کنید (حداکثر ۲ گیگابایت). <i>[با توجه به سهمیه فایل مستقیم شما]</i>\n` +
              `2️⃣ <b>دریافت با لینک:</b> یا برای فایل‌های بزرگتر، فایل خود را به ربات واسطه <b>@filesto_bot</b> فوروارد کنید و لینک مستقیم را اینجا ارسال کنید.\n` +
              `3️⃣ <b>رمز عبور:</b> یک رمز عبور دلخواه برای فایل ZIP وارد کنید.\n` +
              `4️⃣ <b>دریافت لینک دانلود:</b> منتظر بمانید تا پردازش شود و لینک دانلود (با قابلیت دانلود با اینترنت ملی) را دریافت کنید.\n` +
              `5️⃣ <b>پس از دانلود:</b> حتماً روی دکمه «🗑 حذف فایل من» کلیک کنید تا فایل از سرور پاک شود.\n\n` +
              `⭐️ <b>عضویت Pro (ویژه)</b>\n` +
              `• فایل‌های شما تا <b>${proTTLText}</b> روی سرور می‌ماند (کاربران عادی: ${normalTTLText})\n` +
              `• اولویت بالاتر در صف پردازش\n` +
              `• حداکثر <b>${DAILY_LIMIT_PRO} فایل کل</b> (${DAILY_DIRECT_LIMIT_PRO} مستقیم) در روز و حداکثر حجم هر فایل <b>${proSizeMB} مگابایت</b>.\n` +
              `• حداکثر <b>${DAILY_VOLUME_PRO_BYTES / (1024 * 1024)} مگابایت</b> در روز (عادی: ${normalVolMB} مگابایت)\n` +
              `• هزینه عضویت: ${baseStars} Stars تلگرام یا ${baseUsd} دلار ارز دیجیتال\n` +
              `• برای خرید روی دکمه «⭐️ عضویت Pro» کلیک کنید.\n\n` +
              `🎁 <b>اشتراک رایگان Pro با دعوت دوستان</b>\n` +
              `• لینک اختصاصی رفرال خود را از منوی «🎁 اشتراک رایگان Pro» بگیرید.\n` +
              `• با دعوت دوستان به تعداد مشخص، اشتراک Pro رایگان یا کد تخفیف ۱۰۰٪ دریافت کنید!\n\n` +
              `🏷 <b>کد تخفیف</b>\n` +
              `• از منوی «🏷 کد تخفیف» کد تخفیف خود را وارد کنید و با تخفیف خرید کنید.\n\n` +
              `🔹 <b>نحوه استخراج فایل پس از دانلود:</b>\n` +
              `• فایل ZIP دانلود شده را با <b>7-Zip</b> یا <b>WinRAR</b> باز کنید.\n` +
              `• داخل پوشه استخراج شده، فایل‌هایی با پسوند <code>.001</code>، <code>.002</code> و ... می‌بینید.\n` +
              `• روی فایل <b>archive.7z.001</b> کلیک راست کرده و گزینه <b>Extract Here</b> را انتخاب کنید.\n` +
              `• نرم‌افزار به صورت خودکار تمام تکه‌ها را به هم چسبانده و فایل اصلی شما را تحویل می‌دهد.\n\n` +
              `⚠️ <b>توجه امنیتی و قانونی:</b>\n` +
              `• فایل‌ها در یک <b>مخزن عمومی GitHub</b> ذخیره می‌شوند. از ارسال فایل‌های شخصی، محرمانه، مستهجن یا خلاف قانون خودداری کنید.\n` +
              `• <b>مسئولیت قانونی ارسال محتوای غیرمجاز بر عهده کاربر است.</b>\n` +
              `• با استفاده از ربات، شما <b>متعهد به رعایت تمام قوانین</b> جمهوری اسلامی ایران می‌شوید.\n\n` +
              `📊 <b>محدودیت‌های فعلی:</b>\n` +
              `• کاربران عادی: <b>${normalDailyFiles} فایل کل</b> (${normalDailyDirect} مستقیم) و <b>${normalVolMB} مگابایت</b> در روز | حداکثر ${normalSizeMB} مگابایت/فایل | ماندگاری ${normalTTLText}\n` +
              `• کاربران Pro: <b>${DAILY_LIMIT_PRO} فایل کل</b> (${DAILY_DIRECT_LIMIT_PRO} مستقیم) و <b>${DAILY_VOLUME_PRO_BYTES / (1024 * 1024)} مگابایت</b> در روز | حداکثر ${proSizeMB} مگابایت/فایل | ماندگاری ${proTTLText}\n\n` +
              `❤️ <b>حمایت و پشتیبانی:</b>\n` +
              `• کانال تلگرام: @maramidownload\n` +
              `• برای گزارش مشکلات، در کانال پیام بگذارید.\n\n` +
              `📢 ما را به دوستان خود معرفی کنید.`,
              MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data === 'stats') {
            try {
              const stats = await dbGetGlobalStats(env);
              const active = await dbGetActiveCount(env);
              const queue = await dbGetQueueCount(env);
              const proQueue = await dbGetQueueCount(env, true);
              const users = await dbGetUsersCount(env);
              const normalDailyFiles = await getNormalDailyFiles(env);
              const normalDailyDirect = await getNormalDailyDirectFiles(env);
              const normalVolMB = await getNormalDailyVolumeMB(env);
              await editMessage(chatId, msgId, `📊 <b>آمار لحظه‌ای</b>\n\n👥 کل کاربران: ${users}\n🔄 در پردازش: ${active}\n⏳ در صف: ${queue} (${proQueue} Pro)\n🔗 لینک‌های ساخته شده: ${stats.total_links}\n💾 حجم کل دانلود شده: ${stats.total_volume_gb.toFixed(2)} GB\n\n📊 <b>محدودیت‌های عادی:</b>\n${normalDailyFiles} فایل کل و ${normalDailyDirect} مستقیم | ${normalVolMB} MB روزانه\n\n📢 @maramidownload`, MAIN_KEYBOARD, TOKEN);
            } catch (e) { await editMessage(chatId, msgId, "⚠️ خطا.", MAIN_KEYBOARD, TOKEN); }
            return new Response('OK');
          }

          if (data === 'status') {
            try {
              const isPro = await isProUser(env, chatId);
              const planInfo = isPro ? await getUserActivePlan(env, chatId) : null;
              const qt = await getRemainingQuotaText(env, chatId, isPro, planInfo);
              const us = await getUserStats(env, chatId);
              const refCount = await getReferralCount(env, chatId);

              let proInfo = '';
              if (isPro && planInfo) {
                const proRow = await env.DB.prepare('SELECT expires_at FROM pro_users WHERE chat_id = ? AND expires_at > ?').bind(chatId, Math.floor(Date.now() / 1000)).first();
                const hoursLeft = proRow ? Math.round((proRow.expires_at - Math.floor(Date.now() / 1000)) / 3600) : 0;
                const timeLeftText = hoursLeft > 24 ? `${Math.floor(hoursLeft / 24)} روز و ${hoursLeft % 24} ساعت` : `${hoursLeft} ساعت`;
                proInfo = `\n\n⭐️ <b>اشتراک Pro فعال</b>\n📦 پلن: ${planInfo.name || 'استاندارد'}\n📅 انقضا: ${proRow ? new Date(proRow.expires_at * 1000).toLocaleDateString('fa-IR') : '-'} (${timeLeftText} دیگر)\n📁 ${planInfo.daily_files || DAILY_LIMIT_PRO} کل / ${planInfo.daily_direct_files || DAILY_DIRECT_LIMIT_PRO} مستقیم روزانه\n💾 ${planInfo.daily_volume_gb ? planInfo.daily_volume_gb * 1024 : DAILY_VOLUME_PRO_BYTES / (1024 * 1024)} مگابایت در روز\n📏 حداکثر هر فایل: ${planInfo.max_file_size_mb || 2048} مگابایت`;
              } else if (!isPro) {
                proInfo = `\n\n❌ <b>اشتراک Pro</b>: فعال نیست`;
              }

              const st = `\n\n📈 آمار کلی:\n• فایل‌ها: ${us.total_files}\n• حجم دانلود شده: ${us.total_volume_gb.toFixed(2)} GB\n• رفرال‌های معتبر: ${refCount}`;
              const lb = await dbGetLastBranch(env, chatId);
              if (lb) {
                const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${lb}.zip`;
                await editMessage(chatId, msgId, `✅ <b>فایل آماده است!</b>\n\n🔗 ${link}\n\n${qt}${proInfo}${st}`, { inline_keyboard: [[colorBtn("🗑 حذف فایل", "delete_my_file", "danger")], [colorBtn("📥 دریافت فایل جدید", "new_link_check", "primary")]] }, TOKEN);
                return new Response('OK');
              }

              const state = await dbGetUserState(env, chatId);
              if (!state) {
                const overPend = await env.DB.prepare('SELECT file_url, created_at FROM oversized_pending WHERE chat_id = ?').bind(chatId).first();
                if (overPend) {
                  const nowSec = Math.floor(Date.now() / 1000);
                  const createdAt = Math.floor((overPend.created_at || 0) / 1000);
                  const minutesLeft = Math.round(OVERSIZED_PENDING_HOURS * 60 - (nowSec - createdAt) / 60);
                  await editMessage(chatId, msgId, `⏰ <b>فایل شما در انتظار خرید Pro است!</b>\n\n⏳ زمان باقیمانده: ${Math.max(0, minutesLeft)} دقیقه\n\n${qt}${proInfo}${st}`, { inline_keyboard: [[colorBtn("⭐️ خرید Pro", "pro_info", "success")], [colorBtn("🗑 لغو و حذف فایل", "cancel_oversized", "danger")]] }, TOKEN);
                } else {
                  await editMessage(chatId, msgId, `📭 درخواست فعالی ندارید.\n\n${qt}${proInfo}${st}`, MAIN_KEYBOARD, TOKEN);
                }
                return new Response('OK');
              }

              let prog = '';
              if (state.totalChunks && state.uploadedChunks) prog = `\n📦 ${state.uploadedChunks}/${state.totalChunks} تکه (${Math.round(state.uploadedChunks / state.totalChunks * 100)}٪)`;
              if (state.status === 'processing' || state.status === 'processing_oversized') await editMessage(chatId, msgId, `🔄 در حال پردازش...${prog}\n\n${qt}${proInfo}${st}`, MAIN_KEYBOARD, TOKEN);
              else if (state.status === 'waiting' || state.status === 'waiting_oversized') {
                let pos = '?';
                try {
                  pos = isPro ? (await env.DB.prepare('SELECT COUNT(*) as p FROM queue WHERE priority=1 AND position<=(SELECT position FROM queue WHERE chat_id=?)').bind(chatId).first())?.p || '?' : (await env.DB.prepare('SELECT COUNT(*) as p FROM queue WHERE priority=0 AND position<=(SELECT position FROM queue WHERE chat_id=?)').bind(chatId).first())?.p || '?';
                } catch (e) { }
                await editMessage(chatId, msgId, `⏳ در صف — شماره: ${pos}${isPro ? ' ⭐️' : ''}\n\n${qt}${proInfo}${st}`, MAIN_KEYBOARD, TOKEN);
              } else if (state.status === 'awaiting_password' || state.status === 'awaiting_password_oversized') await editMessage(chatId, msgId, `🔐 منتظر رمز عبور هستم.\n\n${qt}${proInfo}${st}`, MAIN_KEYBOARD, TOKEN);
              else await editMessage(chatId, msgId, `📭 درخواست فعالی ندارید.\n\n${qt}${proInfo}${st}`, MAIN_KEYBOARD, TOKEN);
            } catch (e) { await editMessage(chatId, msgId, "⚠️ خطا.", MAIN_KEYBOARD, TOKEN); }
            return new Response('OK');
          }

          if (data === 'delete_my_file') {
            const lb = await dbGetLastBranch(env, chatId);
            if (!lb) { await editMessage(chatId, msgId, "❌ فایل فعالی یافت نشد.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            if (await deleteBranchFromGitHub(env, lb)) { await dbRemoveActiveBranch(env, lb); await editMessage(chatId, msgId, "✅ فایل حذف شد.", MAIN_KEYBOARD, TOKEN); }
            else await editMessage(chatId, msgId, "❌ خطا در حذف.", MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (data === 'new_link') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            await deleteUserBranch(env, chatId);
            await dbDeleteAdminState(env, chatId);
            await editMessage(chatId, msgId, "✅ فایل‌های قبلی پاک شدند. آماده دریافت لینک جدید!\n\n📌 راهنما: فایل خود را مستقیماً ارسال کنید یا لینک دانلود آن را بفرستید.", MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }
          return new Response('OK');
        }

        // ============================================================
        // پیام متنی یا ارسال مستقیم فایل (کامل و بدون خلاصه نویسی)
        // ============================================================

        if (update.message) {
          const chatId = update.message.chat.id.toString();
          const text = update.message.text ? update.message.text.trim() : '';

          // بررسی state کاربر عادی - کد تخفیف
          const userState_coupon = await dbGetAdminState(env, chatId);
          if (userState_coupon?.step === 'awaiting_coupon_code' && userState_coupon?.isUser) {
            if (text === '/cancel' || text.startsWith('/')) { await dbDeleteAdminState(env, chatId); await sendMessage(chatId, "❌ لغو شد.", getMainKeyboardForAdmin(ADMIN_CHAT_ID, chatId), TOKEN); return new Response('OK'); }
            await dbDeleteAdminState(env, chatId);
            const code = text.toUpperCase().trim();
            const coupon = await getCouponByCode(env, code);
            if (!coupon) { await sendMessage(chatId, `❌ کد تخفیف "<b>${code}</b>" معتبر نیست یا منقضی شده.`, MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            let targetPlans;
            if (coupon.plan_id) { const plan = await getProPlanById(env, coupon.plan_id); targetPlans = plan ? [plan] : []; } else { targetPlans = await getProPlans(env); }
            if (!targetPlans.length) { await sendMessage(chatId, "❌ هیچ پلنی برای این کد تخفیف در دسترس نیست.", MAIN_KEYBOARD, TOKEN); return new Response('OK'); }
            let msg = `🎉 <b>کد تخفیف "${code}" معتبر است!</b>\n\n💰 تخفیف: ${coupon.discount_percent}٪\n`;
            if (coupon.max_uses) msg += `👥 استفاده: ${coupon.used_count}/${coupon.max_uses}\n`;
            if (coupon.expires_at) msg += `⏳ انقضا: ${new Date(coupon.expires_at * 1000).toLocaleDateString('fa-IR')}\n`;
            msg += `\n👑 <b>پلن‌های قابل خرید با این کد:</b>\n\n`;
            const rows = [];
            for (const plan of targetPlans) {
              const discStars = Math.round(plan.stars_price * (1 - coupon.discount_percent / 100));
              const discUsd = parseFloat((plan.usd_price * (1 - coupon.discount_percent / 100)).toFixed(2));
              msg += `🔹 <b>${plan.name}</b>\n   <s>${plan.stars_price} Stars | ${plan.usd_price}$</s> → <b>${discStars} Stars | ${discUsd}$</b>\n\n`;
              if (discStars === 0 && discUsd === 0) { rows.push([colorBtn(`🎁 دریافت رایگان: ${plan.name}`, `coupon_buy_stars:${plan.id}:${code}`, "success")]); } else { rows.push([colorBtn(`⭐️ ${plan.name} — ${discStars} Stars`, `coupon_buy_stars:${plan.id}:${code}`, "primary"), colorBtn(`💰 ${discUsd}$`, `coupon_buy_usd:${plan.id}:${code}`, "success")]); }
            }
            rows.push([colorBtn("🔙 بازگشت", "back_to_main", "danger")]);
            await sendMessage(chatId, msg, { inline_keyboard: rows }, TOKEN);
            return new Response('OK');
          }

          // وضعیت‌های متنی ادمین
          if (chatId === ADMIN_CHAT_ID) {
            const adminState = await dbGetAdminState(env, chatId);
            const isDirEn = await getDirectUploadEnabled(env);
            const ADM_KEY = buildAdminKeyboard(isDirEn);
            
            if (adminState) {
              const step = adminState.step;

              if (step === 'awaiting_broadcast_message') {
                if (text === '/cancel') { await dbDeleteAdminState(env, chatId); await sendMessage(chatId, "❌ لغو شد.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbDeleteAdminState(env, chatId);
                await env.DB.prepare('DELETE FROM broadcast_state WHERE admin_chat_id = ?').bind(chatId).run();
                startBroadcast(env, chatId, text, TOKEN).catch(e => console.error('Broadcast error:', e));
                await sendMessage(chatId, "✅ <b>ارسال پیام همگانی آغاز شد!</b>\n\n📊 برای مشاهده وضعیت روی دکمه «📊 وضعیت ارسال» کلیک کنید.\n\n⚠️ برای لغو در حین ارسال، دستور /cancel_broadcast را بفرستید.", ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_promote_userid') {
                const targetUserId = text.trim();
                if (!targetUserId || isNaN(targetUserId)) { await sendMessage(chatId, "❌ چت آی دی معتبر نیست.", ADM_KEY, TOKEN); return new Response('OK'); }
                const result = await adminPromoteToProWithPlan(env, targetUserId, adminState.selectedPlanId, TOKEN);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, result, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_quota_userid') {
                const result = await adminResetQuota(env, text);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, result, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_add_channel') {
                const clean = text.replace('@', '').trim();
                if (!clean) { await sendMessage(chatId, "❌ نام کانال معتبر نیست.", ADM_KEY, TOKEN); return new Response('OK'); }
                const channels = await getRequiredChannels(env);
                if (channels.includes(clean)) { await dbDeleteAdminState(env, chatId); await sendMessage(chatId, `⚠️ @${clean} قبلاً اضافه شده.`, ADM_KEY, TOKEN); return new Response('OK'); }
                channels.push(clean);
                await setRequiredChannels(env, channels);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ کانال @${clean} اضافه شد.`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_discount_duration') {
                const hours = parseInt(text);
                if (isNaN(hours) || hours <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید. مثال: 24", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_discount_stars', hours });
                await sendMessage(chatId, `✅ مدت: ${hours} ساعت\n\nمرحله ۲ از ۳: تعداد Stars تخفیفی را ارسال کنید (عدد صحیح):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_discount_stars') {
                const sp = parseInt(text);
                if (isNaN(sp) || sp <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید. مثال: 40", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_discount_usd', starsPrice: sp, hours: adminState.hours });
                await sendMessage(chatId, `Stars: ${sp}\n\nمرحله ۳ از ۳: قیمت دلاری تخفیفی را ارسال کنید (عدد اعشاری، مثال: 0.7):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_discount_usd') {
                const up = parseFloat(text);
                if (isNaN(up) || up <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید. مثال: 0.7", ADM_KEY, TOKEN); return new Response('OK'); }
                await setDiscount(env, adminState.starsPrice, up, adminState.hours);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ <b>تخفیف سراسری تنظیم شد!</b>\n Stars: ${adminState.starsPrice} | 💰 ${up} USD\n⏳ اعتبار: ${adminState.hours} ساعت`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_stars_price') {
                const sp = parseInt(text);
                if (isNaN(sp) || sp <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_usd_price', starsPrice: sp });
                await sendMessage(chatId, `Stars: ${sp}\n\n💵 قیمت دلاری (بدون تخفیف) را وارد کنید (مثال: 1.5):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_usd_price') {
                const up = parseFloat(text);
                if (isNaN(up) || up <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید. مثال: 1.5", ADM_KEY, TOKEN); return new Response('OK'); }
                await setBotSetting(env, 'stars_price', adminState.starsPrice);
                await setBotSetting(env, 'usd_price', up);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ <b>قیمت‌های پایه بروز شد!</b>\n Stars: ${adminState.starsPrice}\n💵 دلار: ${up}$`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_normal_daily_files') {
                const files = parseInt(text);
                if (isNaN(files) || files <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_normal_daily_direct_files', normalDailyFiles: files });
                await sendMessage(chatId, `✅ مرحله ۱: فایل کل: ${files}\n\nمرحله ۲ از ۷: چند فایل از این تعداد، مجاز به ارسال مستقیم است؟`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_normal_daily_direct_files') {
                const dirFiles = parseInt(text);
                if (isNaN(dirFiles) || dirFiles < 0 || dirFiles > adminState.normalDailyFiles) { await sendMessage(chatId, "❌ عدد بین ۰ تا فایل کل را وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_normal_daily_volume', normalDailyFiles: adminState.normalDailyFiles, normalDailyDirectFiles: dirFiles });
                await sendMessage(chatId, `✅ مرحله ۲: مستقیم مجاز: ${dirFiles}\n\nمرحله ۳ از ۷: حجم روزانه عادی (مگابایت) را وارد کنید:`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_normal_daily_volume') {
                const mb = parseInt(text);
                if (isNaN(mb) || mb <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_normal_size_limit', normalDailyFiles: adminState.normalDailyFiles, normalDailyDirectFiles: adminState.normalDailyDirectFiles, normalVolMB: mb });
                await sendMessage(chatId, `✅ مرحله ۳: حجم روزانه عادی: ${mb} مگابایت\n\nمرحله ۴ از ۷: حداکثر حجم هر فایل (مگابایت) را وارد کنید:`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_normal_size_limit') {
                const mb = parseInt(text);
                if (isNaN(mb) || mb <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید (مگابایت).", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_pro_size_limit', normalDailyFiles: adminState.normalDailyFiles, normalDailyDirectFiles: adminState.normalDailyDirectFiles, normalVolMB: adminState.normalVolMB, normalSizeMB: mb });
                await sendMessage(chatId, `✅ مرحله ۴: حد فایل عادی: ${mb} مگابایت\n\nمرحله ۵ از ۷: حداکثر حجم هر فایل برای Pro (مگابایت) را وارد کنید:`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_pro_size_limit') {
                const mb = parseInt(text);
                if (isNaN(mb) || mb <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید (مگابایت).", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_normal_ttl', normalDailyFiles: adminState.normalDailyFiles, normalDailyDirectFiles: adminState.normalDailyDirectFiles, normalVolMB: adminState.normalVolMB, normalSizeMB: adminState.normalSizeMB, proSizeMB: mb });
                await sendMessage(chatId, `✅ مرحله ۵: حد فایل Pro: ${mb} مگابایت\n\nمرحله ۶ از ۷: ماندگاری فایل کاربران عادی (ساعت) را وارد کنید:`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_normal_ttl') {
                const hours = parseInt(text);
                if (isNaN(hours) || hours <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید (ساعت).", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_pro_ttl', normalDailyFiles: adminState.normalDailyFiles, normalDailyDirectFiles: adminState.normalDailyDirectFiles, normalVolMB: adminState.normalVolMB, normalSizeMB: adminState.normalSizeMB, proSizeMB: adminState.proSizeMB, normalTTLh: hours });
                await sendMessage(chatId, `✅ مرحله ۶: TTL عادی: ${hours} ساعت\n\nمرحله ۷ از ۷: ماندگاری فایل Pro (روز) را وارد کنید:`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_pro_ttl') {
                const days = parseInt(text);
                if (isNaN(days) || days <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید (روز).", ADM_KEY, TOKEN); return new Response('OK'); }
                await setBotSetting(env, 'normal_daily_files', adminState.normalDailyFiles);
                await setBotSetting(env, 'normal_daily_direct_files', adminState.normalDailyDirectFiles);
                await setBotSetting(env, 'normal_daily_volume_mb', adminState.normalVolMB);
                await setBotSetting(env, 'normal_file_size_limit_mb', adminState.normalSizeMB);
                await setBotSetting(env, 'pro_file_size_limit_mb', adminState.proSizeMB);
                await setBotSetting(env, 'normal_max_time_sec', adminState.normalTTLh * 3600);
                await setBotSetting(env, 'pro_max_time_sec', days * 86400);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId,
                  `✅ <b>محدودیت‌ها بروز شد!</b>\n\n📁 فایل عادی: ${adminState.normalDailyFiles} کل (${adminState.normalDailyDirectFiles} مستقیم)\n📊 حجم روزانه عادی: ${adminState.normalVolMB} MB\n📏 حجم فایل عادی: ${adminState.normalSizeMB} MB\n📏 حجم فایل Pro: ${adminState.proSizeMB} MB\n⏱ ماندگاری عادی: ${adminState.normalTTLh} ساعت\n⏱ ماندگاری Pro: ${days} روز`,
                  ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_name') {
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_duration', name: text });
                await sendMessage(chatId, `📦 نام: <b>${text}</b>\n\nمرحله ۲ از ۸: مدت (روز) را وارد کنید:\nمثال: <code>30</code>`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_duration') {
                const days = parseInt(text);
                if (isNaN(days) || days <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_daily_files', name: adminState.name, days });
                await sendMessage(chatId, `📅 مدت: ${days} روز\n\nمرحله ۳ از ۸: تعداد کل فایل مجاز روزانه را وارد کنید:`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_daily_files') {
                const files = parseInt(text);
                if (isNaN(files) || files <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_daily_direct_files', name: adminState.name, days: adminState.days, dailyFiles: files });
                await sendMessage(chatId, `📁 فایل کل روزانه: ${files}\n\nمرحله ۴ از ۸: چند فایل از این ${files} عدد، مجاز به ارسال مستقیم است؟`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_daily_direct_files') {
                const dirFiles = parseInt(text);
                if (isNaN(dirFiles) || dirFiles < 0 || dirFiles > adminState.dailyFiles) { await sendMessage(chatId, `❌ عدد بین ۰ تا ${adminState.dailyFiles} را وارد کنید.`, ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_daily_volume', name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyDirectFiles: dirFiles });
                await sendMessage(chatId, `📥 فایل مستقیم مجاز: ${dirFiles}\n\nمرحله ۵ از ۸: حجم روزانه (گیگابایت) را وارد کنید:\nمثال: <code>6</code>`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_daily_volume') {
                const gb = parseFloat(text);
                if (isNaN(gb) || gb <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_max_file_size', name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyDirectFiles: adminState.dailyDirectFiles, dailyVolumeGB: gb });
                await sendMessage(chatId, `💾 حجم روزانه: ${gb} گیگابایت\n\nمرحله ۶ از ۸: حداکثر حجم هر فایل (مگابایت) را وارد کنید:\nمثال: <code>2048</code>`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_max_file_size') {
                const mb = parseInt(text);
                if (isNaN(mb) || mb <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_stars_price', name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyDirectFiles: adminState.dailyDirectFiles, dailyVolumeGB: adminState.dailyVolumeGB, maxFileSizeMB: mb });
                await sendMessage(chatId, `📏 حداکثر حجم فایل: ${mb} مگابایت\n\nمرحله ۷ از ۸: قیمت به Stars را وارد کنید:`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_stars_price') {
                const sp = parseInt(text);
                if (isNaN(sp) || sp <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_usd_price', name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyDirectFiles: adminState.dailyDirectFiles, dailyVolumeGB: adminState.dailyVolumeGB, maxFileSizeMB: adminState.maxFileSizeMB, starsPrice: sp });
                await sendMessage(chatId, `⭐️ Stars: ${sp}\n\nمرحله ۸ از ۸: قیمت دلاری را وارد کنید (مثال: <code>1.5</code>):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_usd_price') {
                const up = parseFloat(text);
                if (isNaN(up) || up <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await env.DB.prepare('INSERT INTO pro_plans (name, duration_days, daily_files, daily_direct_files, daily_volume_gb, max_file_size_mb, stars_price, usd_price, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)').bind(adminState.name, adminState.days, adminState.dailyFiles, adminState.dailyDirectFiles, adminState.dailyVolumeGB, adminState.maxFileSizeMB, adminState.starsPrice, up).run();
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId,
                  `✅ <b>پلن جدید ایجاد شد!</b>\n\n📦 ${adminState.name}\n📅 ${adminState.days} روز\n📁 ${adminState.dailyFiles} کل (${adminState.dailyDirectFiles} مستقیم)\n💾 ${adminState.dailyVolumeGB} GB/روز\n📏 ${adminState.maxFileSizeMB} مگابایت\n Stars: ${adminState.starsPrice} | 💵 ${up}$`,
                  ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_name') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newName = text === '-' ? plan.name : text;
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_duration', planId, name: newName });
                await sendMessage(chatId, `📅 نام: <b>${newName}</b>\n\nمرحله ۲ از ۸: مدت فعلی: ${plan.duration_days} روز\nمدت جدید را وارد کنید (یا <code>-</code> برای نگه‌داشتن):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_duration') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newDays = text === '-' ? plan.duration_days : parseInt(text);
                if (isNaN(newDays) || newDays <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_daily_files', planId, name: adminState.name, days: newDays });
                await sendMessage(chatId, `📅 مدت: ${newDays} روز\n\nمرحله ۳ از ۸: تعداد کل فایل فعلی: ${plan.daily_files}\nمقدار جدید وارد کنید (یا <code>-</code>):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_daily_files') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newFiles = text === '-' ? plan.daily_files : parseInt(text);
                if (isNaN(newFiles) || newFiles <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_daily_direct_files', planId, name: adminState.name, days: adminState.days, dailyFiles: newFiles });
                await sendMessage(chatId, `📁 فایل کل: ${newFiles}\n\nمرحله ۴ از ۸: مستقیم مجاز فعلی: ${plan.daily_direct_files}\nمقدار جدید را وارد کنید (یا <code>-</code>):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_daily_direct_files') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newDirFiles = text === '-' ? (plan.daily_direct_files ?? plan.daily_files) : parseInt(text);
                if (isNaN(newDirFiles) || newDirFiles < 0 || newDirFiles > adminState.dailyFiles) { await sendMessage(chatId, `❌ عدد بین ۰ تا ${adminState.dailyFiles} وارد کنید.`, ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_daily_volume', planId, name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyDirectFiles: newDirFiles });
                await sendMessage(chatId, `📥 مستقیم مجاز: ${newDirFiles}\n\nمرحله ۵ از ۸: حجم روزانه فعلی: ${plan.daily_volume_gb} GB\nمقدار جدید (گیگابایت، یا <code>-</code>):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_daily_volume') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newGB = text === '-' ? plan.daily_volume_gb : parseFloat(text);
                if (isNaN(newGB) || newGB <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_max_file_size', planId, name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyDirectFiles: adminState.dailyDirectFiles, dailyVolumeGB: newGB });
                await sendMessage(chatId, `💾 حجم روزانه: ${newGB} GB\n\nمرحله ۶ از ۸: حداکثر حجم فایل فعلی: ${plan.max_file_size_mb || 2048} MB\nمقدار جدید (یا <code>-</code>):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_max_file_size') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newMB = text === '-' ? (plan.max_file_size_mb || 2048) : parseInt(text);
                if (isNaN(newMB) || newMB <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_stars_price', planId, name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyDirectFiles: adminState.dailyDirectFiles, dailyVolumeGB: adminState.dailyVolumeGB, maxFileSizeMB: newMB });
                await sendMessage(chatId, `📏 حجم فایل: ${newMB} مگابایت\n\nمرحله ۷ از ۸: Stars فعلی: ${plan.stars_price}\nمقدار جدید (یا <code>-</code>):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_stars_price') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newStars = text === '-' ? plan.stars_price : parseInt(text);
                if (isNaN(newStars) || newStars <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_edit_usd_price', planId, name: adminState.name, days: adminState.days, dailyFiles: adminState.dailyFiles, dailyDirectFiles: adminState.dailyDirectFiles, dailyVolumeGB: adminState.dailyVolumeGB, maxFileSizeMB: adminState.maxFileSizeMB, starsPrice: newStars });
                await sendMessage(chatId, `⭐️ Stars: ${newStars}\n\nمرحله ۸ از ۸: قیمت دلاری فعلی: ${plan.usd_price}$\nمقدار جدید (یا <code>-</code>):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_edit_usd_price') {
                const planId = adminState.planId;
                const plan = await getProPlanById(env, planId);
                const newUsd = text === '-' ? plan.usd_price : parseFloat(text);
                if (isNaN(newUsd) || newUsd <= 0) { await sendMessage(chatId, "❌ عدد مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await env.DB.prepare('UPDATE pro_plans SET name=?, duration_days=?, daily_files=?, daily_direct_files=?, daily_volume_gb=?, max_file_size_mb=?, stars_price=?, usd_price=? WHERE id=?').bind(adminState.name, adminState.days, adminState.dailyFiles, adminState.dailyDirectFiles, adminState.dailyVolumeGB, adminState.maxFileSizeMB, adminState.starsPrice, newUsd, planId).run();
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId,
                  `✅ <b>پلن ویرایش شد!</b>\n\n📦 ${adminState.name}\n📅 ${adminState.days} روز | 📁 ${adminState.dailyFiles} کل (${adminState.dailyDirectFiles} مستقیم) | 💾 ${adminState.dailyVolumeGB} GB/روز\n📏 ${adminState.maxFileSizeMB} مگابایت/فایل\n Stars: ${adminState.starsPrice} | 💵 ${newUsd}$`,
                  ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_discount_percent') {
                const percent = parseFloat(text);
                if (isNaN(percent) || percent < 0 || percent > 100) { await sendMessage(chatId, "❌ عدد بین ۰ تا ۱۰۰ وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                if (percent === 0) {
                  await env.DB.prepare('UPDATE plan_discounts SET active = 0 WHERE plan_id = ?').bind(adminState.planId).run();
                  await dbDeleteAdminState(env, chatId);
                  await sendMessage(chatId, `✅ تخفیف پلن "${adminState.planName}" لغو شد.`, ADM_KEY, TOKEN);
                  return new Response('OK');
                }
                await dbSetAdminState(env, chatId, { step: 'awaiting_plan_discount_duration', planId: adminState.planId, planName: adminState.planName, discountPercent: percent });
                await sendMessage(chatId, `🎉 تخفیف: ${percent}٪\n\nمدت اعتبار تخفیف (ساعت) را وارد کنید:`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_plan_discount_duration') {
                const hours = parseInt(text);
                if (isNaN(hours) || hours <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                const expiresAt = Math.floor(Date.now() / 1000) + hours * 3600;
                await env.DB.prepare('UPDATE plan_discounts SET active = 0 WHERE plan_id = ?').bind(adminState.planId).run();
                await env.DB.prepare('INSERT INTO plan_discounts (plan_id, discount_percent, active, expires_at) VALUES (?, ?, 1, ?)').bind(adminState.planId, adminState.discountPercent, expiresAt).run();
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ <b>تخفیف پلن "${adminState.planName}" تنظیم شد!</b>\n🎉 ${adminState.discountPercent}٪ تخفیف\n⏳ اعتبار: ${hours} ساعت`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_renewal_discount_percent') {
                const percent = parseFloat(text);
                if (isNaN(percent) || percent < 0 || percent > 100) { await sendMessage(chatId, "❌ عدد بین ۰ تا ۱۰۰ وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                if (percent === 0) {
                  await setBotSetting(env, 'renewal_discount_percent', '0');
                  await dbDeleteAdminState(env, chatId);
                  await sendMessage(chatId, `✅ تخفیف تمدید غیرفعال شد.`, ADM_KEY, TOKEN);
                  return new Response('OK');
                }
                await dbSetAdminState(env, chatId, { step: 'awaiting_renewal_notify_hours', discountPercent: percent });
                await sendMessage(chatId, `🎉 تخفیف تمدید: ${percent}٪\n\nچند ساعت قبل از انقضا به کاربران نوتیف فرستاده شود?\nمثال: <code>48</code>`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_renewal_notify_hours') {
                const hours = parseInt(text);
                if (isNaN(hours) || hours <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await setBotSetting(env, 'renewal_discount_percent', adminState.discountPercent);
                await setBotSetting(env, 'renewal_notify_hours', hours);
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ <b>تخفیف تمدید تنظیم شد!</b>\n🎉 ${adminState.discountPercent}٪ تخفیف برای تمدید\n⏰ نوتیف ${hours} ساعت قبل از انقضا`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_maintenance_exception') {
                let exceptions = [];
                if (text.toLowerCase() !== 'skip') { exceptions = text.split(',').map(s => s.trim()).filter(s => s.length > 0); }
                await setBotSetting(env, 'maintenance_mode', '1');
                await setBotSetting(env, 'maintenance_exceptions', JSON.stringify(exceptions));
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `🔴 <b>حالت بروزرسانی فعال شد!</b>\n\n🧪 کاربران استثنا: ${exceptions.length > 0 ? exceptions.join(', ') : 'ندارد'}\n\nبرای غیرفعال کردن دوباره روی دکمه بزنید.`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_direct_chat_id') {
                const targetId = text.trim();
                if (!targetId || isNaN(targetId)) { await sendMessage(chatId, "❌ چت آی دی معتبر نیست.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_direct_message_text', targetChatId: targetId });
                await sendMessage(chatId, `📩 پیام برای کاربر ${targetId}:\n\nمتن پیام را ارسال کنید:`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_direct_message_text') {
                const targetChatId = adminState.targetChatId;
                try {
                  await sendMessage(targetChatId, text, MAIN_KEYBOARD, TOKEN);
                  await dbDeleteAdminState(env, chatId);
                  await sendMessage(chatId, `✅ پیام به ${targetChatId} ارسال شد.`, ADM_KEY, TOKEN);
                } catch (e) {
                  await dbDeleteAdminState(env, chatId);
                  await sendMessage(chatId, `❌ خطا در ارسال پیام به ${targetChatId}.`, ADM_KEY, TOKEN);
                }
                return new Response('OK');
              }

              if (step === 'awaiting_referral_tier_count') {
                if (text === '/cancel') { await dbDeleteAdminState(env, chatId); await sendMessage(chatId, "❌ لغو شد.", ADM_KEY, TOKEN); return new Response('OK'); }
                const count = parseInt(text);
                if (isNaN(count) || count <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_referral_tier_label', tiers: adminState.tiers || [], newTierCount: count });
                await sendMessage(chatId, `✅ تعداد رفرال: ${count}\n\nعنوان جایزه را وارد کنید:\nمثال: <code>پلن ۳ روزه رایگان</code>`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_referral_tier_label') {
                const label = text;
                await dbSetAdminState(env, chatId, { step: 'awaiting_referral_tier_plan_days', tiers: adminState.tiers || [], newTierCount: adminState.newTierCount, newTierLabel: label });
                await sendMessage(chatId, `✅ عنوان: ${label}\n\nنوع پاداش را تعیین کنید:\nاگر می‌خواهید <b>کد تخفیف ۱۰۰ درصدی</b> بگیرد، ارسال کنید <code>CODE</code>\n\nاگر می‌خواهید اشتراک مستقیماً فعال شود، تعداد روزها (مثال: <code>3</code>) یا ID پلن با پیشوند P (مثال: <code>P2</code>) را ارسال کنید:`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_referral_tier_plan_days') {
                let planId = null, planDays = 1, rewardType = 'auto_pro';
                if (text.toUpperCase() === 'CODE') { rewardType = 'discount_code'; } 
                else if (text.toUpperCase().startsWith('P')) {
                  planId = parseInt(text.substring(1));
                  const plan = await getProPlanById(env, planId);
                  if (!plan) { await sendMessage(chatId, "❌ پلن یافت نشد.", ADM_KEY, TOKEN); return new Response('OK'); }
                  planDays = plan.duration_days;
                } else {
                  planDays = parseInt(text);
                  if (isNaN(planDays) || planDays <= 0) { await sendMessage(chatId, "❌ عدد صحیح مثبت یا CODE وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                }

                const newTiers = [...(adminState.tiers || []), { count: adminState.newTierCount, plan_id: planId, plan_days: planDays, label: adminState.newTierLabel, reward_type: rewardType }];
                newTiers.sort((a, b) => a.count - b.count);
                await setBotSetting(env, 'referral_tiers', JSON.stringify(newTiers));
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ <b>تیر جدید اضافه شد!</b>\n\n🎯 ${adminState.newTierCount} نفر → ${adminState.newTierLabel}`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_coupon_code_admin') {
                const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
                if (!code || code.length < 3) { await sendMessage(chatId, "❌ کد تخفیف باید حداقل ۳ حرف انگلیسی/عدد باشد.", ADM_KEY, TOKEN); return new Response('OK'); }
                const existing = await env.DB.prepare('SELECT id FROM coupons WHERE code = ?').bind(code).first();
                if (existing) { await sendMessage(chatId, `❌ کد "${code}" قبلاً ثبت شده.`, ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_coupon_discount', code });
                await sendMessage(chatId, `✅ کد: <b>${code}</b>\n\nمرحله ۲ از ۵: درصد تخفیف را وارد کنید (مثال: <code>50</code> برای ۵۰٪، <code>100</code> برای رایگان):`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_coupon_discount') {
                const percent = parseFloat(text);
                if (isNaN(percent) || percent <= 0 || percent > 100) { await sendMessage(chatId, "❌ عدد بین ۱ تا ۱۰۰ وارد کنید.", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_coupon_max_uses', code: adminState.code, discountPercent: percent });
                await sendMessage(chatId, `🎉 مرحله ۲: تخفیف: ${percent}٪\n\nمرحله ۳ از ۵: حداکثر تعداد استفاده را وارد کنید:\nبرای نامحدود: <code>0</code>`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_coupon_max_uses') {
                const maxUses = parseInt(text);
                if (isNaN(maxUses) || maxUses < 0) { await sendMessage(chatId, "❌ عدد صحیح غیرمنفی وارد کنید (۰ برای نامحدود).", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_coupon_expires', code: adminState.code, discountPercent: adminState.discountPercent, maxUses: maxUses || null });
                await sendMessage(chatId, `👥 مرحله ۳: حداکثر استفاده: ${maxUses || 'نامحدود'}\n\nمرحله ۴ از ۵: مدت اعتبار کد (ساعت) را وارد کنید:\nبرای بدون محدودیت زمانی: <code>0</code>`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_coupon_expires') {
                const hours = parseInt(text);
                if (isNaN(hours) || hours < 0) { await sendMessage(chatId, "❌ عدد صحیح غیرمنفی وارد کنید (۰ برای بدون محدودیت).", ADM_KEY, TOKEN); return new Response('OK'); }
                await dbSetAdminState(env, chatId, { step: 'awaiting_coupon_plan', code: adminState.code, discountPercent: adminState.discountPercent, maxUses: adminState.maxUses, expiresHours: hours || null });
                const plans = await getAllProPlans(env);
                const plansText = plans.length > 0 ? plans.map(p => `• <code>${p.id}</code>: ${p.name}`).join('\n') : 'هیچ پلنی تعریف نشده';
                await sendMessage(chatId, `⏳ مرحله ۴: اعتبار: ${hours || 'نامحدود'} ساعت\n\nمرحله ۵ از ۵: آی‌دی پلنی که تخفیف روی آن اعمال می‌شود را وارد کنید:\n${plansText}\n\nبرای همه پلن‌ها: <code>0</code>`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              if (step === 'awaiting_coupon_plan') {
                const planId = parseInt(text);
                if (isNaN(planId) || planId < 0) { await sendMessage(chatId, "❌ عدد صحیح غیرمنفی وارد کنید (۰ برای همه پلن‌ها).", ADM_KEY, TOKEN); return new Response('OK'); }
                const expiresAt = adminState.expiresHours ? Math.floor(Date.now() / 1000) + adminState.expiresHours * 3600 : null;
                await env.DB.prepare('INSERT INTO coupons (code, discount_percent, plan_id, max_uses, used_count, expires_at, active, created_at) VALUES (?, ?, ?, ?, 0, ?, 1, ?)').bind(adminState.code, adminState.discountPercent, planId || null, adminState.maxUses, expiresAt, Date.now()).run();
                await dbDeleteAdminState(env, chatId);
                await sendMessage(chatId, `✅ <b>کد تخفیف ایجاد شد!</b>\n\n🎟 کد: <b>${adminState.code}</b>\n🎉 تخفیف: ${adminState.discountPercent}٪\n👥 حداکثر استفاده: ${adminState.maxUses || 'نامحدود'}\n⏳ انقضا: ${adminState.expiresHours ? adminState.expiresHours + ' ساعت' : 'نامحدود'}\n📦 پلن: ${planId || 'همه پلن‌ها'}`, ADM_KEY, TOKEN);
                return new Response('OK');
              }

              // state ناشناخته - پاک کن
              await dbDeleteAdminState(env, chatId);
            }
          }

          // ---- دستورات متنی ----
          if (text === '/myid') { await sendMessage(chatId, `🆔 Chat ID: <code>${chatId}</code>`, MAIN_KEYBOARD, TOKEN); return new Response('OK'); }

          const rsMatch = text.match(/^\/resetstats (.+)$/);
          if (rsMatch && rsMatch[1] === env.ADMIN_SECRET) {
            await env.DB.prepare('DELETE FROM queue').run();
            await env.DB.prepare('UPDATE user_state SET status=? WHERE status=?').bind('cancelled', 'processing').run();
            await finishTask(env);
            const isDirEn = await getDirectUploadEnabled(env);
            await sendMessage(chatId, "✅ بازنشانی شد.", buildAdminKeyboard(isDirEn), TOKEN);
            return new Response('OK');
          }

          const faMatch = text.match(/^\/fixactive (.+)$/);
          if (faMatch && faMatch[1] === env.ADMIN_SECRET) {
            const cnt = (await env.DB.prepare('SELECT COUNT(*) as c FROM user_state WHERE status=?').bind('processing').first())?.c || 0;
            await env.DB.prepare('UPDATE user_state SET status=? WHERE status=?').bind('cancelled', 'processing').run();
            await finishTask(env);
            const isDirEn = await getDirectUploadEnabled(env);
            await sendMessage(chatId, `✅ ${cnt} پردازش لغو شد.`, buildAdminKeyboard(isDirEn), TOKEN);
            return new Response('OK');
          }

          const sqMatch = text.match(/^\/startqueue (.+)$/);
          if (sqMatch && sqMatch[1] === env.ADMIN_SECRET) { await finishTask(env); const isDirEn = await getDirectUploadEnabled(env); await sendMessage(chatId, "✅ صف راه‌اندازی شد.", buildAdminKeyboard(isDirEn), TOKEN); return new Response('OK'); }

          const rqMatch = text.match(/^\/resetqueue (.+)$/);
          if (rqMatch && rqMatch[1] === env.ADMIN_SECRET) { await env.DB.prepare('DELETE FROM queue').run(); const isDirEn = await getDirectUploadEnabled(env); await sendMessage(chatId, "✅ صف خالی شد.", buildAdminKeyboard(isDirEn), TOKEN); return new Response('OK'); }

          // ---- /start ----
          if (text === '/start' || text.startsWith('/start ')) {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            await dbDeleteAdminState(env, chatId);

            const startParam = text.split(' ')[1] || '';
            if (startParam.startsWith('ref_')) {
              const referrerId = startParam.replace('ref_', '');
              if (referrerId !== chatId) { await addReferral(env, referrerId, chatId, TOKEN); }
            }

            const baseStars = await getEffectiveStarsPrice(env);
            const baseUsd = await getEffectiveUsdPrice(env);
            const normalDailyFiles = await getNormalDailyFiles(env);
            const normalVolMB = await getNormalDailyVolumeMB(env);
            const normalSizeMB = await getNormalFileSizeLimitMB(env);
            const normalTTL = await getNormalMaxTimeSec(env);
            const proSizeMB = await getProFileSizeLimitMB(env);
            const proTTL = await getProMaxTimeSec(env);
            const isDirectEnabled = await getDirectUploadEnabled(env);
            const normalTTLText = normalTTL >= 3600 ? `${Math.round(normalTTL / 3600)} ساعت` : `${Math.round(normalTTL / 60)} دقیقه`;
            const proTTLText = proTTL >= 86400 ? `${Math.round(proTTL / 86400)} روز` : `${Math.round(proTTL / 3600)} ساعت`;
            
            let directUploadText = isDirectEnabled ? 
              `1️⃣ <b>ارسال فایل مستقیم:</b> فایل خود را مستقیم اینجا بفرستید (حداکثر ۲ گیگابایت).\n` :
              `1️⃣ <b>ارسال فایل مستقیم:</b> (در حال بهبود - فعلا از لینک مستقیم استفاده کنید).\n`;

            await sendMessage(chatId,
              `🌀 <b>به ربات دانلودر ملی خوش آمدید!</b>\n\n` +
              `📌 <b>راه‌حل سریع برای دانلود با اینترنت ملی</b>\n\n` +
              `🔹 <b>نحوه استفاده:</b>\n` +
              directUploadText +
              `2️⃣ <b>یا استفاده از لینک مستقیم:</b> فایل‌های بزرگ را به ربات <b>@filesto_bot</b> بفرستید و لینکشان را اینجا ارسال کنید.\n` +
              `3️⃣ رمز عبور دلخواه برای فایل ZIP وارد کنید و تمام!\n\n` +
              `⭐️ <b>مزایای ویژه Pro:</b>\n` +
              `• نگهداری تا <b>${proTTLText}</b> (عادی: ${normalTTLText})\n` +
              `• <b>${DAILY_LIMIT_PRO} فایل</b> در روز تا حجم <b>${proSizeMB} مگابایت</b>\n` +
              `• هزینه: ${baseStars} Stars\n\n` +
              `🎁 با دعوت دوستان، <b>Pro رایگان</b> بگیرید!\n\n` +
              `👇 برای شروع، فایل یا لینک خود را بفرستید.`,
              getMainKeyboardForAdmin(ADMIN_CHAT_ID, chatId), TOKEN);
            return new Response('OK');
          }

          // ---- دریافت مستقیم فایل ----
          const fileDoc = update.message.document || update.message.video || update.message.audio || update.message.voice;
          if (fileDoc && !text.startsWith('/')) {
            const isDirectEnabled = await getDirectUploadEnabled(env);
            if (!isDirectEnabled) {
              await sendMessage(chatId, "⚠️ این قابلیت (ارسال مستقیم) در حال بهبود است و فعلاً در دسترس نیست.\n\nلطفاً برای دانلود، فایل خود را در یک ربات واسطه (مانند <b>@filesto_bot</b>) به <b>لینک مستقیم</b> تبدیل کرده و لینک آن را ارسال کنید.", MAIN_KEYBOARD, TOKEN);
              return new Response('OK');
            }

            const activeUserState = await dbGetUserState(env, chatId);
            if (activeUserState?.status === 'awaiting_password') {
              await dbDeleteUserState(env, chatId);
              await dbRemoveFromQueue(env, chatId);
            }

            const channels = await getRequiredChannels(env);
            if (channels.length > 0) {
              const isMember = await isUserMemberOfChannels(chatId, channels, TOKEN);
              if (!isMember) {
                const jkb = { inline_keyboard: [channels.map(ch => ({ text: `🔗 @${ch}`, url: `https://t.me/${ch}` })), [colorBtn("✅ عضو شدم، بررسی کن", "check_membership", "success")]] };
                await sendMessage(chatId, "❌ برای استفاده از ربات ابتدا باید در کانال‌های زیر عضو شوید:", jkb, TOKEN);
                await savePendingLink(env, chatId, `tg_file_id:${fileDoc.file_id}`, fileDoc.file_size || 0);
                return new Response('OK');
              }
            }
            
            if (fileDoc.file_size && fileDoc.file_size > 2000 * 1024 * 1024) {
               await sendMessage(chatId, "❌ حجم این فایل بیشتر از ۲ گیگابایت است (محدودیت API تلگرام).\n\nبرای فایل‌های بزرگتر از ۲ گیگابایت، لطفاً از روش <b>لینک مستقیم</b> (ارسال فایل به ربات واسطه <b>@filesto_bot</b>) استفاده کنید.", MAIN_KEYBOARD, TOKEN);
               return new Response('OK');
            }

            await processPendingLink(env, chatId, `tg_file_id:${fileDoc.file_id}`, fileDoc.file_size || 0, TOKEN);
            return new Response('OK');
          }

          // ---- دریافت لینک ----
          if (text.match(/^https?:\/\//)) {
            const activeUserState = await dbGetUserState(env, chatId);
            if (activeUserState?.status === 'awaiting_password') {
              await dbDeleteUserState(env, chatId);
              await dbRemoveFromQueue(env, chatId);
            }

            const channels = await getRequiredChannels(env);
            if (channels.length > 0) {
              const isMember = await isUserMemberOfChannels(chatId, channels, TOKEN);
              if (!isMember) {
                const jkb = { inline_keyboard: [channels.map(ch => ({ text: `🔗 @${ch}`, url: `https://t.me/${ch}` })), [colorBtn("✅ عضو شدم، بررسی کن", "check_membership", "success")]] };
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
          if (userState?.status === 'awaiting_password' && userState.requestData && text) {
            const isPro = await isProUser(env, chatId);
            const isOversized = userState.requestData.oversized;

            if (isOversized && !isPro) {
              await env.DB.prepare('UPDATE oversized_pending SET password = ? WHERE chat_id = ?').bind(text, chatId).run();
              await dbSetUserState(env, chatId, 'processing', { url: userState.requestData.url, password: text, fileSize: userState.requestData.fileSize || 0, oversized: true });
              const active = await dbGetActiveCount(env);
              if (active < MAX_CONCURRENT) {
                await dbSetUserState(env, chatId, 'processing', { url: userState.requestData.url, password: text, fileSize: userState.requestData.fileSize || 0, oversized: true });
                runTaskWithRetry(chatId, userState.requestData.url, text, env, TOKEN).catch(console.error);
                await sendMessage(chatId,
                  `📤 <b>پردازش فایل شروع شد!</b>\n\n⏰ شما ${OVERSIZED_PENDING_HOURS} ساعت فرصت دارید تا اشتراک Pro تهیه کنید و لینک دانلود را دریافت کنید.\n\nبعد از خرید Pro، لینک خودکار برای شما ارسال می‌شود.`,
                  { inline_keyboard: [[colorBtn("⭐️ خرید Pro و دریافت لینک", "pro_info", "success")], [colorBtn("🗑 لغو و حذف فایل", "cancel_oversized", "danger")]] }, TOKEN);
              } else {
                await dbAddQueue(env, chatId, userState.requestData.url, text, userState.requestData.fileSize || 0, false);
                await dbSetUserState(env, chatId, 'waiting', { url: userState.requestData.url, password: text, fileSize: userState.requestData.fileSize || 0, oversized: true });
                await sendMessage(chatId,
                  `⏳ <b>در صف انتظار قرار گرفتید.</b>\n\nفایل به محض رسیدن نوبت پردازش می‌شود.\n\n⏰ شما ${OVERSIZED_PENDING_HOURS} ساعت فرصت دارید تا اشتراک Pro تهیه کنید.`,
                  { inline_keyboard: [[colorBtn("⭐️ خرید Pro", "pro_info", "primary")], [colorBtn("🗑 لغو و حذف فایل", "cancel_oversized", "danger")]] }, TOKEN);
              }
              return new Response('OK');
            }

            await dbDeleteUserState(env, chatId);
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

          if (userState?.status === 'processing' || userState?.status === 'waiting') {
            await sendMessage(chatId, "⚠️ شما یک درخواست فعال دارید.\nلطفاً از دکمه «👤 وضعیت من» وضعیت را بررسی کنید.", MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          if (text && !text.startsWith('/')) {
             await sendMessage(chatId, "❌ پیام معتبر نیست.\n\nشما می‌توانید یک **فایل** را مستقیماً ارسال کنید یا **لینک دانلود** آن را بفرستید.\n\n📌 راهنما: برای دریافت لینک مستقیم، فایل خود را به <b>@filesto_bot</b> بفرستید.", MAIN_KEYBOARD, TOKEN);
          }
          return new Response('OK');
        }

        return new Response('OK');
      } catch (err) { console.error('Webhook error:', err); return new Response('Error', { status: 500 }); }
    }

    return new Response('🤖 ربات دانلودر ملی در حال اجرا است! | @filesmanagement_bot');
  }
};






