// ============================================================
// ربات دانلودر ملی - نسخه نهایی با تخفیف کامل و منوی ادمین
// ============================================================

// ---------- تنظیمات اصلی ----------
const STARS_AMOUNT = 60;                 // تعداد ستاره معمولی
const USD_AMOUNT = 1;                    // قیمت دلاری معمولی
const NORMAL_DAILY_VOLUME_MB = 600;      // محدودیت حجم روزانه کاربر عادی (مگابایت)
const PRO_DAILY_VOLUME_MB = 6144;        // محدودیت حجم روزانه کاربر Pro (6 گیگابایت)
const BROADCAST_DELAY_MS = 100;          // تأخیر بین ارسال پیام همگانی (میلی‌ثانیه)

// ---------- کیبوردهای اصلی ----------
const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📥 دریافت لینک ملی", callback_data: "new_link" }],
    [{ text: "📊 آمار لحظه‌ای", callback_data: "stats" }, { text: "📊 وضعیت من", callback_data: "status" }],
    [{ text: "⭐️ عضویت Pro", callback_data: "pro_info" }, { text: "🗑️ حذف فایل من", callback_data: "delete_my_file" }],
    [{ text: "❓ راهنما", callback_data: "help" }, { text: "📢 کانال پشتیبانی", url: "https://t.me/maramidownload" }]
  ]
};

const ADMIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "🔧 ریست صف", callback_data: "admin_reset_queue" }, { text: "🔧 ریست پردازش‌ها", callback_data: "admin_fix_active" }],
    [{ text: "⭐️ تبدیل کاربر به Pro", callback_data: "admin_promote" }, { text: "🔄 ریست سهمیه کاربر", callback_data: "admin_reset_quota" }],
    [{ text: "📢 تنظیم کانال اجباری", callback_data: "admin_set_channel" }, { text: "📋 مشاهده کانال‌ها", callback_data: "admin_show_channels" }],
    [{ text: "📨 ارسال پیام همگانی", callback_data: "admin_broadcast" }, { text: "🎁 تنظیم تخفیف", callback_data: "admin_set_discount" }],
    [{ text: "❌ لغو تخفیف", callback_data: "admin_clear_discount" }, { text: "🔙 بازگشت به منوی اصلی", callback_data: "back_to_main" }]
  ]
};

// ---------- ثابت‌های سیستمی ----------
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

// ---------- متغیرهای وضعیت ----------
const lastCallbackProcessed = new Map();
let adminTempState = new Map();
let broadcastCancelFlag = false;

// ============================================================
// توابع کمکی عمومی (ارسال پیام، پاسخ به کالبک و...)
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
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function sendSimple(chatId, text, TOKEN) {
  return sendMessage(chatId, text, MAIN_KEYBOARD, TOKEN);
}
async function answerCallback(callbackId, TOKEN) {
  const url = `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: callbackId }) });
  } catch(e) { console.error('answerCallback failed:', e); }
}

async function getRepoSize(env) {
  const GITHUB_TOKEN = env.GH_TOKEN;
  const GITHUB_OWNER = 'gptmoone';
  const GITHUB_REPO = 'telegram-file-downloader';
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CloudflareWorkerBot/1.0' }
    });
    if (res.ok) {
      const data = await res.json();
      return data.size / (1024 * 1024);
    }
  } catch (e) { console.error('getRepoSize error:', e); }
  return 0;
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
  return {
    status: row.status,
    requestData: row.request_data ? JSON.parse(row.request_data) : null,
    branchName: row.branch_name,
    startedAt: row.started_at,
    totalChunks: row.total_chunks,
    uploadedChunks: row.uploaded_chunks
  };
}
async function dbSetUserState(env, chatId, status, requestData = null, branchName = null, startedAt = null, totalChunks = null, uploadedChunks = null) {
  const requestDataStr = requestData ? JSON.stringify(requestData) : null;
  await env.DB.prepare(`INSERT OR REPLACE INTO user_state (chat_id, status, request_data, branch_name, started_at, total_chunks, uploaded_chunks) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(chatId, status, requestDataStr, branchName, startedAt, totalChunks, uploadedChunks).run();
}
async function dbDeleteUserState(env, chatId) {
  await env.DB.prepare('DELETE FROM user_state WHERE chat_id = ?').bind(chatId).run();
}
async function dbGetQueueCount(env, onlyPro = false) {
  let sql = 'SELECT COUNT(*) as count FROM queue';
  if (onlyPro) sql += ' WHERE priority = 1';
  else if (onlyPro === false) sql += ' WHERE priority = 0';
  const row = await env.DB.prepare(sql).first();
  return row?.count || 0;
}
async function dbAddQueue(env, chatId, fileUrl, password, fileSize, isPro = false) {
  const now = Date.now();
  const priority = isPro ? 1 : 0;
  await env.DB.prepare(`INSERT INTO queue (chat_id, file_url, zip_password, file_size, enqueued_at, priority) VALUES (?, ?, ?, ?, ?, ?)`).bind(chatId, fileUrl, password, fileSize, now, priority).run();
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
async function dbGetActiveBranchesCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) as count FROM active_branches').first();
  return row?.count || 0;
}
async function dbGetUsersCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
  return row?.count || 0;
}
async function dbAddUser(env, chatId) {
  const now = Date.now();
  await env.DB.prepare('INSERT OR IGNORE INTO users (chat_id, first_seen) VALUES (?, ?)').bind(chatId, now).run();
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
  const now = Date.now();
  try {
    await dbAddActiveBranch(env, branchName, chatId, now, expiresAt);
    await env.DB.prepare('UPDATE user_state SET branch_name = ? WHERE chat_id = ?').bind(branchName, chatId).run();
  } catch (err) { console.error('dbSetBranchForUser error:', err); throw err; }
}
async function getAllUsers(env) {
  const rows = await env.DB.prepare('SELECT chat_id FROM users').all();
  return rows.results.map(r => r.chat_id);
}

// ============================================================
// توابع محدودیت روزانه (حجم و تعداد)
// ============================================================
async function getDailyLimit(env, chatId) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  let row = await env.DB.prepare('SELECT file_count, reset_date, daily_volume_bytes FROM daily_limits WHERE chat_id = ?').bind(chatId).first();
  if (!row || row.reset_date < todayStart) {
    await env.DB.prepare('INSERT OR REPLACE INTO daily_limits (chat_id, file_count, reset_date, daily_volume_bytes) VALUES (?, 0, ?, 0)').bind(chatId, todayStart).run();
    row = { file_count: 0, reset_date: todayStart, daily_volume_bytes: 0 };
  }
  const fileCount = typeof row.file_count === 'number' ? row.file_count : 0;
  const dailyVolumeBytes = typeof row.daily_volume_bytes === 'number' ? row.daily_volume_bytes : 0;
  return { fileCount, resetDate: row.reset_date, dailyVolumeBytes };
}
async function incrementDailyLimit(env, chatId, addedVolumeBytes) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  await env.DB.prepare(`INSERT INTO daily_limits (chat_id, file_count, reset_date, daily_volume_bytes) VALUES (?, 1, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET file_count = file_count + 1, daily_volume_bytes = daily_volume_bytes + excluded.daily_volume_bytes, reset_date = excluded.reset_date WHERE daily_limits.reset_date >= ?`).bind(chatId, todayStart, addedVolumeBytes, todayStart).run();
}
async function canUploadByVolume(env, chatId, fileSizeBytes, isPro) {
  const { dailyVolumeBytes } = await getDailyLimit(env, chatId);
  const limitBytes = isPro ? DAILY_VOLUME_PRO_BYTES : DAILY_VOLUME_NORMAL_BYTES;
  const newTotal = dailyVolumeBytes + fileSizeBytes;
  const allowed = newTotal <= limitBytes;
  const remainingBytes = Math.max(0, limitBytes - dailyVolumeBytes);
  return { allowed, remainingBytes, newTotal, limitBytes };
}
async function canUpload(env, chatId, isPro) {
  const { fileCount } = await getDailyLimit(env, chatId);
  const limit = isPro ? DAILY_LIMIT_PRO : DAILY_LIMIT_NORMAL;
  const remaining = Math.max(0, limit - fileCount);
  return { allowed: remaining > 0, current: fileCount, limit, remaining };
}
async function resetUserQuota(env, chatId) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  await env.DB.prepare('INSERT OR REPLACE INTO daily_limits (chat_id, file_count, reset_date, daily_volume_bytes) VALUES (?, 0, ?, 0)').bind(chatId, todayStart).run();
}
async function getRemainingQuotaText(env, chatId, isPro) {
  const { remaining, limit } = await canUpload(env, chatId, isPro);
  const { remainingBytes } = await canUploadByVolume(env, chatId, 0, isPro);
  const limitMB = isPro ? DAILY_VOLUME_PRO_BYTES / (1024*1024) : DAILY_VOLUME_NORMAL_BYTES / (1024*1024);
  const remainingMB = (remainingBytes / (1024*1024)).toFixed(1);
  return `📊 سهمیه باقیمانده امروز: ${remaining} از ${limit} فایل | ${remainingMB} از ${limitMB} مگابایت`;
}

// ============================================================
// توابع عضویت اجباری و لینک‌های معلق
// ============================================================
async function getRequiredChannels(env) {
  const row = await env.DB.prepare('SELECT channels FROM required_channels WHERE id = 1').first();
  if (!row) return [];
  try { return JSON.parse(row.channels); } catch { return []; }
}
async function setRequiredChannels(env, channelsArray) {
  await env.DB.prepare('INSERT OR REPLACE INTO required_channels (id, channels) VALUES (1, ?)').bind(JSON.stringify(channelsArray)).run();
}
async function isUserMemberOfChannels(chatId, channels, TOKEN) {
  if (!channels || channels.length === 0) return true;
  for (const channelUsername of channels) {
    let cleanChannel = channelUsername.replace('@', '').trim();
    try {
      const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getChatMember?chat_id=@${cleanChannel}&user_id=${chatId}`);
      const data = await res.json();
      if (!data.ok || !data.result || (data.result.status !== 'member' && data.result.status !== 'creator' && data.result.status !== 'administrator')) return false;
    } catch { return false; }
  }
  return true;
}
async function savePendingLink(env, chatId, fileUrl, fileSize) {
  const now = Date.now();
  await env.DB.prepare('INSERT OR REPLACE INTO pending_links (chat_id, file_url, file_size, timestamp) VALUES (?, ?, ?, ?)').bind(chatId, fileUrl, fileSize, now).run();
}
async function getPendingLink(env, chatId) {
  const row = await env.DB.prepare('SELECT file_url, file_size FROM pending_links WHERE chat_id = ?').bind(chatId).first();
  if (!row) return null;
  await env.DB.prepare('DELETE FROM pending_links WHERE chat_id = ?').bind(chatId).run();
  return { url: row.file_url, fileSize: row.file_size };
}

// ============================================================
// آمار شخصی کاربر
// ============================================================
async function incrementUserStats(env, chatId, fileSizeBytes) {
  const volumeGB = fileSizeBytes / (1024 * 1024 * 1024);
  await env.DB.prepare(`INSERT INTO user_stats (chat_id, total_files, total_volume_gb) VALUES (?, 1, ?) ON CONFLICT(chat_id) DO UPDATE SET total_files = total_files + 1, total_volume_gb = total_volume_gb + excluded.total_volume_gb`).bind(chatId, volumeGB).run();
}
async function getUserStats(env, chatId) {
  const row = await env.DB.prepare('SELECT total_files, total_volume_gb FROM user_stats WHERE chat_id = ?').bind(chatId).first();
  if (!row) return { total_files: 0, total_volume_gb: 0 };
  return { total_files: row.total_files, total_volume_gb: row.total_volume_gb };
}

// ============================================================
// توابع Pro و تخفیف
// ============================================================
async function isProUser(env, chatId) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT expires_at FROM pro_users WHERE chat_id = ? AND expires_at > ?').bind(chatId, now).first();
  return !!row;
}
async function activateProSubscription(env, chatId, paymentId, amountDesc) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (30 * 24 * 60 * 60);
  await env.DB.prepare(`INSERT OR REPLACE INTO pro_users (chat_id, expires_at, payment_id, activated_at) VALUES (?, ?, ?, ?)`).bind(chatId, expiresAt, paymentId, now).run();
  await sendSimple(chatId, `✅ عضویت **Pro** شما با موفقیت فعال شد!\n\n💎 مبلغ پرداختی: ${amountDesc}\n📅 تاریخ انقضا: ${new Date(expiresAt * 1000).toLocaleDateString('fa-IR')}\n\n🎁 مزایا:\n• فایل‌های شما تا ۱ روز روی سرور می‌ماند\n• اولویت بالاتر در صف پردازش\n• حداکثر ${DAILY_LIMIT_PRO} فایل و ${DAILY_VOLUME_PRO_BYTES/(1024*1024)} مگابایت در روز\n\nاز اعتماد شما سپاسگزاریم! 🚀`, env.TELEGRAM_TOKEN);
}
// --- تخفیف ---
async function getDiscountSettings(env) {
  const row = await env.DB.prepare('SELECT active, stars_price, usd_price, expires_at FROM discount_settings WHERE id = 1').first();
  if (!row || row.active !== 1) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) {
    await env.DB.prepare('UPDATE discount_settings SET active = 0 WHERE id = 1').run();
    return null;
  }
  return { starsPrice: row.stars_price, usdPrice: row.usd_price, expiresAt: row.expires_at };
}
async function setDiscount(env, starsPrice, usdPrice, durationHours) {
  const expiresAt = Math.floor(Date.now() / 1000) + (durationHours * 3600);
  await env.DB.prepare(`INSERT OR REPLACE INTO discount_settings (id, active, stars_price, usd_price, expires_at) VALUES (1, 1, ?, ?, ?)`).bind(starsPrice, usdPrice, expiresAt).run();
}
async function clearDiscount(env) {
  await env.DB.prepare('UPDATE discount_settings SET active = 0 WHERE id = 1').run();
}
// --- NowPayments ---
async function createNowPaymentsInvoice(env, chatId, amountUSD) {
  const orderId = `pro_${chatId}_${Date.now()}`;
  const webhookUrl = `https://telegram-file-bot.gptmoone.workers.dev/api/nowpayments-webhook`;
  const payload = { price_amount: amountUSD, price_currency: "usd", pay_currency: "ton", order_id: orderId, order_description: "اشتراک Pro - ربات دانلودر", ipn_callback_url: webhookUrl, success_url: "https://t.me/MeliDownloadBot?start=pro_success", cancel_url: "https://t.me/MeliDownloadBot?start=pro_cancel" };
  const response = await fetch('https://api.nowpayments.io/v1/invoice', { method: 'POST', headers: { 'x-api-key': env.NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (data.invoice_url) return { success: true, invoiceUrl: data.invoice_url, orderId: orderId };
  return { success: false, error: data };
}
// --- Telegram Stars ---
async function createStarsInvoiceLink(env, chatId, starsAmount) {
  const TOKEN = env.TELEGRAM_TOKEN;
  const payload = `stars:${chatId}:${Date.now()}`;
  const url = `https://api.telegram.org/bot${TOKEN}/createInvoiceLink`;
  const body = { title: "Pro Subscription", description: `Access for 30 days (${starsAmount} Stars)`, payload: payload, provider_token: "", currency: "XTR", prices: [{ label: "Monthly Pro", amount: starsAmount }] };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.ok && data.result) return { success: true, invoiceLink: data.result, payload: payload };
    else return { success: false, error: data.description };
  } catch (err) { return { success: false, error: err.message }; }
}
async function handlePreCheckoutQuery(env, preCheckoutQuery, TOKEN) {
  const answerUrl = `https://api.telegram.org/bot${TOKEN}/answerPreCheckoutQuery`;
  try {
    const res = await fetch(answerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pre_checkout_query_id: preCheckoutQuery.id, ok: true }) });
    return res.ok;
  } catch (err) { return false; }
}
async function handleSuccessfulPayment(env, message, TOKEN) {
  const chatId = message.chat.id.toString();
  const payment = message.successful_payment;
  const payload = payment.invoice_payload;
  const stars = payment.total_amount;
  if (payload && payload.startsWith('stars:')) {
    const parts = payload.split(':');
    if (parts.length >= 2 && parts[1] === chatId) await activateProSubscription(env, chatId, `stars_${payment.telegram_payment_charge_id}`, `${stars} ستاره`);
  }
  return true;
}

// ============================================================
// پاکسازی خودکار (Cron)
// ============================================================
async function cleanupExpiredBranches(env) {
  const GITHUB_TOKEN = env.GH_TOKEN;
  const GITHUB_OWNER = 'gptmoone';
  const GITHUB_REPO = 'telegram-file-downloader';
  const now = Math.floor(Date.now() / 1000);
  const expired = await env.DB.prepare('SELECT branch_name, chat_id FROM active_branches WHERE expires_at <= ?').bind(now).all();
  let deleted = 0;
  for (const branch of expired.results) {
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch.branch_name}`, { method: 'DELETE', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CloudflareWorkerBot/1.0' } });
      if (res.ok || res.status === 404) {
        await env.DB.prepare('DELETE FROM active_branches WHERE branch_name = ?').bind(branch.branch_name).run();
        deleted++;
      }
    } catch (err) { console.error(err); }
  }
  return { deleted };
}
async function handleCleanupBranches(request, env) {
  try {
    const { secret } = await request.json();
    if (secret !== env.ADMIN_SECRET) return new Response('Unauthorized', { status: 401 });
    const result = await cleanupExpiredBranches(env);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) { return new Response('Error', { status: 500 }); }
}

// ============================================================
// توابع کمکی فایل (گیت‌هاب)
// ============================================================
async function getBranchTotalSize(env, branchName) {
  const GITHUB_TOKEN = env.GH_TOKEN;
  const GITHUB_OWNER = 'gptmoone';
  const GITHUB_REPO = 'telegram-file-downloader';
  let totalSize = 0;
  let page = 1;
  const perPage = 100;
  let hasMore = true;
  while (hasMore) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${branchName}?recursive=1&per_page=${perPage}`;
    try {
      const res = await fetch(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CloudflareWorkerBot/1.0' } });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.tree && Array.isArray(data.tree)) {
        for (const item of data.tree) if (item.type === 'blob' && item.size) totalSize += item.size;
      }
      if (data.truncated && data.next) { page++; continue; }
      else hasMore = false;
    } catch (err) { return null; }
  }
  return totalSize;
}
async function getFileSize(url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const size = head.headers.get('content-length');
    return size ? parseInt(size) : null;
  } catch { return null; }
}
async function deleteBranchFromGitHub(env, branchName) {
  const GITHUB_TOKEN = env.GH_TOKEN;
  const GITHUB_OWNER = 'gptmoone';
  const GITHUB_REPO = 'telegram-file-downloader';
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchName}`, { method: 'DELETE', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CloudflareWorkerBot/1.0' } });
    return res.ok || res.status === 404;
  } catch { return false; }
}

// ============================================================
// دستورات ادمین (عملیات مدیریتی)
// ============================================================
async function adminPromoteToPro(env, targetUserId, adminSecret, providedSecret) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  const userExists = await env.DB.prepare('SELECT 1 FROM users WHERE chat_id = ?').bind(targetUserId).first();
  if (!userExists) return "❌ کاربر مورد نظر یافت نشد. ممکن است هنوز ربات را استارت نکرده باشد.";
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (30 * 24 * 60 * 60);
  await env.DB.prepare(`INSERT OR REPLACE INTO pro_users (chat_id, expires_at, payment_id, activated_at) VALUES (?, ?, ?, ?)`).bind(targetUserId, expiresAt, `admin_${Date.now()}`, now).run();
  return `✅ کاربر ${targetUserId} با موفقیت به عضویت Pro درآمد. اشتراک تا ${new Date(expiresAt * 1000).toLocaleDateString('fa-IR')} معتبر است.`;
}
async function adminResetQuota(env, targetUserId, adminSecret, providedSecret) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  const userExists = await env.DB.prepare('SELECT 1 FROM users WHERE chat_id = ?').bind(targetUserId).first();
  if (!userExists) return "❌ کاربر مورد نظر یافت نشد.";
  await resetUserQuota(env, targetUserId);
  return `✅ سهمیه روزانه کاربر ${targetUserId} با موفقیت بازنشانی شد.`;
}
async function adminResetQueue(env, adminSecret, providedSecret) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  await env.DB.prepare('DELETE FROM queue').run();
  return "✅ صف با موفقیت خالی شد (پردازش‌های جاری دست نخورده).";
}
async function adminFixActive(env, adminSecret, providedSecret) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  const processingCount = (await env.DB.prepare('SELECT COUNT(*) as count FROM user_state WHERE status = ?').bind('processing').first())?.count || 0;
  await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'processing').run();
  await finishTask(env);
  return `✅ ${processingCount} رکورد پردازش گیر کرده لغو شد. صف در حال پردازش است.`;
}
async function adminAddChannel(env, channelUsername, adminSecret, providedSecret) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  let channels = await getRequiredChannels(env);
  let clean = channelUsername.replace('@', '').trim();
  if (!clean) return "❌ نام کانال معتبر نیست.";
  if (channels.includes(clean)) return `⚠️ کانال @${clean} قبلاً اضافه شده است.`;
  channels.push(clean);
  await setRequiredChannels(env, channels);
  return `✅ کانال @${clean} با موفقیت به لیست عضویت اجباری اضافه شد.`;
}
async function adminRemoveChannel(env, channelUsername, adminSecret, providedSecret) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  let channels = await getRequiredChannels(env);
  let clean = channelUsername.replace('@', '').trim();
  if (!channels.includes(clean)) return `⚠️ کانال @${clean} در لیست وجود ندارد.`;
  channels = channels.filter(c => c !== clean);
  await setRequiredChannels(env, channels);
  return `✅ کانال @${clean} از لیست عضویت اجباری حذف شد.`;
}
async function adminRemoveAllChannels(env, adminSecret, providedSecret) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  await setRequiredChannels(env, []);
  return "✅ تمام کانال‌های اجباری با موفقیت حذف شدند.";
}
async function adminShowChannels(env, chatId, adminSecret, providedSecret, TOKEN) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  let channels = await getRequiredChannels(env);
  if (channels.length === 0) { await sendSimple(chatId, "ℹ️ هیچ کانال اجباری تنظیم نشده است.", TOKEN); return; }
  let keyboard = { inline_keyboard: [] };
  for (const ch of channels) keyboard.inline_keyboard.push([{ text: `🔗 @${ch}`, url: `https://t.me/${ch}` }, { text: `❌ حذف ${ch}`, callback_data: `admin_remove_channel:${ch}` }]);
  keyboard.inline_keyboard.push([{ text: "⚠️ حذف همه کانال‌ها", callback_data: "admin_remove_all_channels" }]);
  keyboard.inline_keyboard.push([{ text: "🔙 بازگشت به پنل مدیریت", callback_data: "admin_panel" }]);
  await sendMessage(chatId, "📢 لیست کانال‌های اجباری. برای حذف یک کانال روی دکمه مربوطه کلیک کنید:", keyboard, TOKEN);
}

// ============================================================
// ارسال پیام همگانی (Broadcast)
// ============================================================
async function startBroadcast(env, adminChatId, messageText, TOKEN) {
  const users = await getAllUsers(env);
  if (!users.length) { await sendSimple(adminChatId, "❌ هیچ کاربری در دیتابیس یافت نشد.", TOKEN); return; }
  await sendSimple(adminChatId, `📨 شروع ارسال پیام به ${users.length} کاربر...\n⚠️ برای لغو ارسال، دستور /cancel_broadcast را بفرستید.`, TOKEN);
  let successCount = 0, failCount = 0;
  broadcastCancelFlag = false;
  const discount = await getDiscountSettings(env);
  for (let i = 0; i < users.length; i++) {
    if (broadcastCancelFlag) {
      await sendSimple(adminChatId, `⛔ ارسال پیام همگانی لغو شد. ${successCount} پیام موفق، ${failCount} ناموفق.`, TOKEN);
      return;
    }
    const chatId = users[i];
    try {
      let keyboard = MAIN_KEYBOARD;
      if (discount) {
        keyboard = { inline_keyboard: [[{ text: `🎁 خرید Pro با تخفیف (${discount.starsPrice} ستاره / ${discount.usdPrice} USD)`, callback_data: "discount_pro" }], ...MAIN_KEYBOARD.inline_keyboard] };
      } else {
        keyboard = { inline_keyboard: [[{ text: `⭐️ خرید Pro (${STARS_AMOUNT} ستاره / ${USD_AMOUNT} USD)`, callback_data: "pro_info" }], ...MAIN_KEYBOARD.inline_keyboard] };
      }
      await sendMessage(chatId, messageText, keyboard, TOKEN);
      successCount++;
    } catch (err) { failCount++; console.error(`Broadcast failed for ${chatId}:`, err); }
    if (i < users.length - 1) await new Promise(r => setTimeout(r, BROADCAST_DELAY_MS));
  }
  await sendSimple(adminChatId, `✅ ارسال پیام همگانی پایان یافت.\nموفق: ${successCount}\nناموفق: ${failCount}`, TOKEN);
}

// ============================================================
// تابع اصلی (fetch) و مدیریت وب‌هوک
// ============================================================
export default {
  async fetch(request, env) {
    const urlObj = new URL(request.url);
    const path = urlObj.pathname;
    const TOKEN = env.TELEGRAM_TOKEN;
    const GITHUB_TOKEN = env.GH_TOKEN;
    const GITHUB_OWNER = 'gptmoone';
    const GITHUB_REPO = 'telegram-file-downloader';
    const ADMIN_SECRET = env.ADMIN_SECRET || '';
    const ADMIN_CHAT_ID = env.ADMIN_CHAT_ID || '';

    try { await ensureGlobalStats(env); } catch(e) { console.error(e); }

    // ---------- API endpoints ----------
    if (path === '/api/cleanup-branches' && request.method === 'POST') return handleCleanupBranches(request, env);
    if (path === '/api/nowpayments-webhook' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (body.payment_status === 'finished') {
          const orderId = body.order_id;
          const chatId = orderId.split('_')[1];
          await activateProSubscription(env, chatId, orderId, `${body.price_amount || 0} USD`);
        }
        return new Response('OK');
      } catch (err) { return new Response('Error', { status: 500 }); }
    }
    if (path === '/api/started' && request.method === 'POST') {
      try {
        const { user_id } = await request.json();
        if (user_id) {
          const chatId = user_id.split('_')[0];
          await env.DB.prepare('UPDATE user_state SET started_at = ? WHERE chat_id = ?').bind(Date.now(), chatId).run();
          await sendSimple(chatId, "🔄 پردازش فایل روی گیت‌هاب آغاز شد...", TOKEN);
        }
        return new Response('OK');
      } catch (err) { return new Response('OK'); }
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
      } catch (err) { return new Response('OK'); }
    }
    if (path === '/api/complete' && request.method === 'POST') {
      try {
        const { user_id, branch } = await request.json();
        if (!user_id || !branch) return new Response('OK');
        const chatId = user_id.split('_')[0];
        const isPro = await isProUser(env, chatId);
        let totalSizeBytes = await getBranchTotalSize(env, branch);
        if (!totalSizeBytes) totalSizeBytes = 0;
        
        // بررسی محدودیت حجم روزانه
        const volumeCheck = await canUploadByVolume(env, chatId, totalSizeBytes, isPro);
        if (!volumeCheck.allowed) {
          await deleteBranchFromGitHub(env, branch);
          await dbRemoveActiveBranch(env, branch);
          const limitMB = isPro ? DAILY_VOLUME_PRO_BYTES/(1024*1024) : DAILY_VOLUME_NORMAL_BYTES/(1024*1024);
          const proKeyboard = { inline_keyboard: [[{ text: "⭐️ خرید اشتراک Pro", callback_data: "pro_info" }], [{ text: "📊 وضعیت من", callback_data: "status" }]] };
          await sendMessage(chatId, `❌ حجم فایل شما (${(totalSizeBytes/(1024*1024)).toFixed(1)} مگابایت) با سهمیه باقیمانده امروز شما (${(volumeCheck.remainingBytes/(1024*1024)).toFixed(1)} مگابایت) همخوانی ندارد.\n\nمحدودیت حجم روزانه برای کاربران ${isPro ? "Pro" : "عادی"} ${limitMB} مگابایت است.\nبرای افزایش سهمیه و استفاده از امکانات بیشتر، اشتراک Pro تهیه کنید.`, proKeyboard, TOKEN);
          await dbDeleteUserState(env, chatId);
          await finishTask(env);
          return new Response('OK');
        }
        
        const ttl = isPro ? TTL_PRO : TTL_NORMAL;
        const expiresAt = Math.floor(Date.now() / 1000) + ttl;
        await dbSetBranchForUser(env, chatId, branch, expiresAt);
        await env.DB.prepare('UPDATE user_state SET status = ?, branch_name = ? WHERE chat_id = ?').bind('done', branch, chatId).run();
        
        let volumeGB = totalSizeBytes / (1024 * 1024 * 1024);
        await dbIncrementLinks(env, volumeGB);
        await incrementDailyLimit(env, chatId, totalSizeBytes);
        await incrementUserStats(env, chatId, totalSizeBytes);
        
        const reqRow2 = await env.DB.prepare('SELECT request_data FROM user_state WHERE chat_id = ?').bind(chatId).first();
        let password = '';
        if (reqRow2 && reqRow2.request_data) password = JSON.parse(reqRow2.request_data).password || '';
        
        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        const validityMsg = isPro ? "۱ روز" : "۱ ساعت";
        const sizeText = totalSizeBytes ? `\n📦 حجم فایل: ${(totalSizeBytes / (1024 * 1024)).toFixed(2)} MB` : '';
        const helpExtract = `\n\n📌 <b>نحوه استخراج فایل:</b>\nپس از دانلود فایل ZIP، با 7-Zip یا WinRAR فایل archive.7z.001 را استخراج کنید.`;
        const quotaText = await getRemainingQuotaText(env, chatId, isPro);
        await sendSimple(chatId, `✅ <b>فایل شما آماده شد!</b>\n\n🔗 لینک دانلود (${validityMsg} معتبر):\n${link}\n\n⚠️ رمز عبور: <code>${password}</code>${sizeText}${helpExtract}\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» فایل را از سرور پاک کنید.\n\n${quotaText}`, TOKEN);
        
        await dbDeleteUserState(env, chatId);
        await finishTask(env);
        return new Response('OK');
      } catch (err) {
        console.error('/api/complete error:', err);
        await finishTask(env);
        return new Response('OK');
      }
    }
    if (path === '/api/failed' && request.method === 'POST') {
      try {
        const { user_id } = await request.json();
        if (user_id) {
          const chatId = user_id.split('_')[0];
          await dbDeleteUserState(env, chatId);
          await finishTask(env);
          await sendSimple(chatId, "❌ پردازش فایل با خطا مواجه شد. لطفاً دوباره تلاش کنید.", TOKEN);
        }
        return new Response('OK');
      } catch (err) { return new Response('OK'); }
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
      } catch (err) { return new Response('OK'); }
    }

    // ---------- وب‌هوک اصلی تلگرام ----------
    if (path === `/bot${TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();
        if (update.message?.chat?.id) await dbAddUser(env, update.message.chat.id.toString());
        if (update.callback_query?.message?.chat?.id) await dbAddUser(env, update.callback_query.message.chat.id.toString());

        // لغو broadcast (دستور متنی)
        if (update.message?.text === '/cancel_broadcast' && update.message.chat.id.toString() === ADMIN_CHAT_ID) {
          broadcastCancelFlag = true;
          await sendSimple(ADMIN_CHAT_ID, "⛔ درخواست لغو ارسال همگانی ثبت شد.", TOKEN);
          return new Response('OK');
        }

        // PreCheckout و SuccessfulPayment
        if (update.pre_checkout_query) {
          await handlePreCheckoutQuery(env, update.pre_checkout_query, TOKEN);
          return new Response('OK');
        }
        if (update.message?.successful_payment) {
          await handleSuccessfulPayment(env, update.message, TOKEN);
          return new Response('OK');
        }

        // ---------- مدیریت دکمه‌های شیشه‌ای ----------
        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = cb.message.chat.id.toString();
          const data = cb.data;
          const callbackId = cb.id;
          const now = Date.now();
          const lastTime = lastCallbackProcessed.get(`${chatId}_${data}`) || 0;
          if (now - lastTime < 3000) return new Response('OK');
          lastCallbackProcessed.set(`${chatId}_${data}`, now);
          await answerCallback(callbackId, TOKEN);

          // دکمه "عضو شدم"
          if (data === 'check_membership') {
            (async () => {
              const pending = await getPendingLink(env, chatId);
              if (!pending) { await sendSimple(chatId, "❌ لینک معلقی یافت نشد.", TOKEN); return; }
              const requiredChannels = await getRequiredChannels(env);
              const isMember = await isUserMemberOfChannels(chatId, requiredChannels, TOKEN);
              if (!isMember) {
                const channelsList = requiredChannels.map(c => `@${c}`).join(', ');
                const joinKeyboard = { inline_keyboard: [requiredChannels.map(ch => ({ text: `🔗 عضویت در ${ch}`, url: `https://t.me/${ch}` })), [{ text: "✅ عضو شدم", callback_data: "check_membership" }]] };
                await sendMessage(chatId, `❌ شما هنوز عضو کانال‌های زیر نشده‌اید:\n${channelsList}\nلطفاً ابتدا عضو شوید سپس روی دکمه «عضو شدم» کلیک کنید.`, joinKeyboard, TOKEN);
                await savePendingLink(env, chatId, pending.url, pending.fileSize);
                return;
              }
              await processPendingLink(env, chatId, pending.url, pending.fileSize, TOKEN);
            })();
            return new Response('OK');
          }

          // دکمه تخفیف جداگانه
          if (data === 'discount_pro') {
            const isPro = await isProUser(env, chatId);
            if (isPro) { await sendSimple(chatId, "✅ شما قبلاً عضو Pro هستید.", TOKEN); return new Response('OK'); }
            const discount = await getDiscountSettings(env);
            if (!discount) { await sendSimple(chatId, "❌ تخفیف فعلاً فعال نیست.", TOKEN); return new Response('OK'); }
            const starsInvoice = await createStarsInvoiceLink(env, chatId, discount.starsPrice);
            const cryptoInvoice = await createNowPaymentsInvoice(env, chatId, discount.usdPrice);
            let keyboardRows = [];
            if (starsInvoice.success) keyboardRows.push([{ text: `⭐️ خرید با Stars (${discount.starsPrice} ستاره)`, url: starsInvoice.invoiceLink }]);
            if (cryptoInvoice.success) keyboardRows.push([{ text: `💰 خرید با ارز دیجیتال (${discount.usdPrice} USD)`, url: cryptoInvoice.invoiceUrl }]);
            if (keyboardRows.length === 0) await sendSimple(chatId, "❌ خطا در ایجاد لینک پرداخت.", TOKEN);
            else await sendMessage(chatId, `🎁 تخفیف ویژه! اشتراک Pro فقط با ${discount.starsPrice} ستاره یا ${discount.usdPrice} دلار.\n\nاین پیشنهاد تا ${new Date(discount.expiresAt * 1000).toLocaleString('fa-IR')} معتبر است.`, { inline_keyboard: keyboardRows }, TOKEN);
            return new Response('OK');
          }

          // منوی مدیریت
          if (data === 'admin_panel' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            await sendMessage(chatId, "🛠 <b>پنل مدیریت ربات</b>\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }
          if (data === 'back_to_main' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            const welcomeKeyboard = getMainKeyboardForAdmin(ADMIN_CHAT_ID, chatId);
            await sendMessage(chatId, "🌀 بازگشت به منوی اصلی", welcomeKeyboard, TOKEN);
            return new Response('OK');
          }
          // سایر عملیات مدیریتی
          if (data === 'admin_reset_queue' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            adminTempState.delete(chatId);
            const result = await adminResetQueue(env, ADMIN_SECRET, ADMIN_SECRET);
            await sendSimple(chatId, result, TOKEN);
            await sendMessage(chatId, "🛠 پنل مدیریت", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }
          if (data === 'admin_fix_active' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            const result = await adminFixActive(env, ADMIN_SECRET, ADMIN_SECRET);
            await sendSimple(chatId, result, TOKEN);
            await sendMessage(chatId, "🛠 پنل مدیریت", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }
          if (data === 'admin_promote' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            adminTempState.set(chatId, { step: 'awaiting_promote_userid' });
            await sendSimple(chatId, "🔹 لطفاً شناسه عددی کاربر (chat id) مورد نظر را وارد کنید:", TOKEN);
            return new Response('OK');
          }
          if (data === 'admin_reset_quota' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            adminTempState.set(chatId, { step: 'awaiting_quota_userid' });
            await sendSimple(chatId, "🔹 لطفاً شناسه عددی کاربر (chat id) که می‌خواهید سهمیه‌اش ریست شود را وارد کنید:", TOKEN);
            return new Response('OK');
          }
          if (data === 'admin_set_channel' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            adminTempState.set(chatId, { step: 'awaiting_add_channel' });
            await sendSimple(chatId, "🔹 لطفاً نام کاربری کانال را وارد کنید (مثال: maramidownload). نیازی به @ نیست.", TOKEN);
            return new Response('OK');
          }
          if (data === 'admin_show_channels' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            await adminShowChannels(env, chatId, ADMIN_SECRET, ADMIN_SECRET, TOKEN);
            return new Response('OK');
          }
          if (data === 'admin_broadcast' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            adminTempState.set(chatId, { step: 'awaiting_broadcast_message' });
            await sendSimple(chatId, "📨 لطفاً متن پیام همگانی را ارسال کنید.\n(برای لغو /cancel را بفرستید)", TOKEN);
            return new Response('OK');
          }
          if (data === 'admin_set_discount' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            adminTempState.set(chatId, { step: 'awaiting_discount_duration' });
            await sendSimple(chatId, "🎁 لطفاً مدت اعتبار تخفیف را به ساعت وارد کنید (مثال: 24):", TOKEN);
            return new Response('OK');
          }
          if (data === 'admin_clear_discount' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            await clearDiscount(env);
            await sendSimple(chatId, "✅ تخفیف فعلی لغو شد.", TOKEN);
            await sendMessage(chatId, "🛠 پنل مدیریت", ADMIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }
          if (data.startsWith('admin_remove_channel:')) {
            const channel = data.split(':')[1];
            const result = await adminRemoveChannel(env, channel, ADMIN_SECRET, ADMIN_SECRET);
            await sendSimple(chatId, result, TOKEN);
            await adminShowChannels(env, chatId, ADMIN_SECRET, ADMIN_SECRET, TOKEN);
            return new Response('OK');
          }
          if (data === 'admin_remove_all_channels' && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            const result = await adminRemoveAllChannels(env, ADMIN_SECRET, ADMIN_SECRET);
            await sendSimple(chatId, result, TOKEN);
            await adminShowChannels(env, chatId, ADMIN_SECRET, ADMIN_SECRET, TOKEN);
            return new Response('OK');
          }

          // دکمه Pro عادی (با تخفیف اگر فعال باشد)
          if (data === 'pro_info') {
            const isPro = await isProUser(env, chatId);
            if (isPro) {
              const row = await env.DB.prepare('SELECT expires_at FROM pro_users WHERE chat_id = ?').bind(chatId).first();
              const expireDate = new Date(row.expires_at * 1000).toLocaleDateString('fa-IR');
              await sendSimple(chatId, `⭐️ وضعیت اشتراک Pro شما\n✅ فعال\n📅 تاریخ انقضا: ${expireDate}\n\n🎁 مزایا:\n• فایل‌های شما تا ۱ روز می‌ماند\n• اولویت بالاتر در صف\n• حداکثر ${DAILY_LIMIT_PRO} فایل و ${DAILY_VOLUME_PRO_BYTES/(1024*1024)} مگابایت در روز`, TOKEN);
            } else {
              const discount = await getDiscountSettings(env);
              let starsAmount = STARS_AMOUNT, usdAmount = USD_AMOUNT, discountText = "";
              if (discount) {
                starsAmount = discount.starsPrice;
                usdAmount = discount.usdPrice;
                discountText = `\n🎁 تخفیف ویژه: ${starsAmount} ستاره (به جای ${STARS_AMOUNT}) / ${usdAmount} USD (به جای ${USD_AMOUNT}) تا ${new Date(discount.expiresAt * 1000).toLocaleString('fa-IR')}`;
              }
              const starsInvoice = await createStarsInvoiceLink(env, chatId, starsAmount);
              const cryptoInvoice = await createNowPaymentsInvoice(env, chatId, usdAmount);
              let keyboardRows = [];
              if (starsInvoice.success) keyboardRows.push([{ text: `⭐️ خرید با Telegram Stars (${starsAmount} ستاره)`, url: starsInvoice.invoiceLink }]);
              if (cryptoInvoice.success) keyboardRows.push([{ text: `💰 خرید با ارز دیجیتال (${usdAmount} USD)`, url: cryptoInvoice.invoiceUrl }]);
              if (keyboardRows.length === 0) await sendSimple(chatId, "❌ در حال حاضر روش پرداختی در دسترس نیست.", TOKEN);
              else {
                keyboardRows.push([{ text: "🔙 بازگشت", callback_data: "stats" }]);
                await sendMessage(chatId, `⭐️ عضویت ویژه (Pro)\n\n💰 هزینه:\n• Telegram Stars: ${starsAmount} ستاره (حدود ${(starsAmount * 0.013).toFixed(2)} دلار)${discountText}\n• ارز دیجیتال: ${usdAmount} USD (معادل TON)${discountText}\n\nپس از پرداخت، اشتراک شما بلافاصله فعال می‌شود.`, { inline_keyboard: keyboardRows }, TOKEN);
              }
            }
            return new Response('OK');
          }

          // دکمه‌های معمولی (help, stats, status, delete_my_file, new_link)
          if (data === 'help') {
            const helpText = `📘 <b>راهنمای ربات</b>\n\nاین ربات لینک مستقیم فایل را به لینک قابل دانلود در <b>اینترنت ملی</b> تبدیل می‌کند.\n\n🔹 <b>نحوه استفاده:</b>\n1️⃣ اگر لینک مستقیم ندارید، فایل خود را به ربات @filesto_bot فوروارد کنید.\n2️⃣ لینک مستقیم را در همین ربات ارسال کنید.\n3️⃣ یک رمز عبور دلخواه برای فایل ZIP وارد کنید.\n4️⃣ منتظر بمانید تا پردازش شود (لینک خودکار ارسال می‌شود).\n5️⃣ پس از دانلود، روی دکمه <b>«🗑️ حذف فایل من»</b> کلیک کنید.\n\n⭐️ <b>عضویت Pro</b>\n• فایل‌های شما تا <b>۱ روز</b> روی سرور می‌ماند (عادی ۱ ساعت)\n• اولویت بالاتر در صف پردازش\n• حداکثر <b>${DAILY_LIMIT_PRO} فایل و ${DAILY_VOLUME_PRO_BYTES/(1024*1024)} مگابایت در روز</b> (عادی ${DAILY_LIMIT_NORMAL} فایل و ${DAILY_VOLUME_NORMAL_BYTES/(1024*1024)} مگابایت)\n• هزینه عضویت: ${STARS_AMOUNT} ستاره تلگرام یا معادل ${USD_AMOUNT} دلار ارز دیجیتال\n• برای خرید روی دکمه «⭐️ عضویت Pro» کلیک کنید.\n\n🔹 <b>نحوه استخراج فایل پس از دانلود:</b>\n• فایل ZIP دانلود شده را با <b>7-Zip</b> یا <b>WinRAR</b> باز کنید.\n• داخل پوشه استخراج شده، فایل‌هایی با پسوند <code>.001</code>، <code>.002</code> و ... می‌بینید.\n• روی فایل <b>archive.7z.001</b> کلیک کرده و گزینه <b>Extract Here</b> را انتخاب کنید.\n• نرم‌افزار به صورت خودکار تمام تکه‌ها را به هم چسبانده و فایل اصلی را تحویل می‌دهد.\n\n⚠️ <b>توجه امنیتی و قانونی:</b>\n• فایل‌ها در یک <b>مخزن عمومی گیت‌هاب</b> ذخیره می‌شوند. از ارسال فایل‌های شخصی، محرمانه، مستهجن یا خلاف قانون خودداری کنید.\n• <b>مسئولیت قانونی ارسال محتوای غیرمجاز بر عهده کاربر است.</b>\n• با استفاده از ربات، شما <b>متعهد به رعایت تمام قوانین</b> جمهوری اسلامی ایران می‌شوید.\n• لینک دانلود برای کاربران عادی <b>۱ ساعت</b> و برای کاربران Pro <b>۱ روز</b> معتبر است.\n• حجم فایل نباید بیشتر از ۲ گیگابایت باشد.\n• محدودیت حجم روزانه: عادی ${DAILY_VOLUME_NORMAL_BYTES/(1024*1024)} مگابایت، Pro ${DAILY_VOLUME_PRO_BYTES/(1024*1024)} مگابایت.\n\n❤️ <b>حمایت و پشتیبانی:</b>\n• کانال تلگرام: @maramidownload\n\n📢 ما را به دوستان خود معرفی کنید.`;
            await sendSimple(chatId, helpText, TOKEN);
            return new Response('OK');
          }
          if (data === 'stats') {
            const stats = await dbGetGlobalStats(env);
            const activeCount = await dbGetActiveCount(env);
            const queueCount = await dbGetQueueCount(env);
            const proQueueCount = await dbGetQueueCount(env, true);
            const totalUsers = await dbGetUsersCount(env);
            const nowUnix = Math.floor(Date.now() / 1000);
            const proUsersCount = (await env.DB.prepare('SELECT COUNT(*) as count FROM pro_users WHERE expires_at > ?').bind(nowUnix).first()).count;
            const repoSize = await getRepoSize(env);
            const sizeMsg = repoSize ? `\n📦 حجم مخزن: ${repoSize.toFixed(1)} گیگابایت` : '';
            let warningMsg = '';
            if (repoSize >= REPO_SIZE_LIMIT_GB) warningMsg = '\n\n⚠️ هشدار: حجم مخزن پر است. لطفاً فایل‌های خود را حذف کنید.';
            else if (repoSize >= REPO_SIZE_WARNING_GB) warningMsg = '\n\n⚠️ هشدار: حجم مخزن نزدیک به حد مجاز است. پس از دانلود، فایل خود را حذف کنید.';
            await sendSimple(chatId, `📊 <b>آمار لحظه‌ای ربات</b>\n\n👥 کاربران کل: ${totalUsers}\n⭐️ کاربران Pro فعال: ${proUsersCount}\n🔄 در حال پردازش: ${activeCount}\n⏳ در صف انتظار: ${queueCount} (${proQueueCount} پرو)\n🔗 لینک‌های ملی ساخته شده: ${stats.total_links}\n💾 حجم کل دانلود شده: ${stats.total_volume_gb.toFixed(2)} گیگابایت${sizeMsg}${warningMsg}\n\n📢 @maramidownload`, TOKEN);
            return new Response('OK');
          }
          if (data === 'status') {
            const isPro = await isProUser(env, chatId);
            const quotaText = await getRemainingQuotaText(env, chatId, isPro);
            const userStats = await getUserStats(env, chatId);
            const statsText = `\n📊 آمار شخصی شما:\n• کل فایل‌های دانلود شده: ${userStats.total_files}\n• حجم کل دانلود شده: ${userStats.total_volume_gb.toFixed(2)} گیگابایت`;
            const lastBranch = await dbGetLastBranch(env, chatId);
            if (lastBranch) {
              const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${lastBranch}.zip`;
              await sendSimple(chatId, `✅ فایل شما آماده است!\n\n🔗 لینک دانلود: ${link}\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» پاک کنید.\n\n${quotaText}${statsText}`, TOKEN);
              return new Response('OK');
            }
            const state = await dbGetUserState(env, chatId);
            if (!state) {
              await sendSimple(chatId, `📭 هیچ درخواست فعالی ندارید.\n\n${quotaText}${statsText}`, TOKEN);
              return new Response('OK');
            }
            let progress = '';
            if (state.totalChunks && state.uploadedChunks) progress = `\n📦 پیشرفت آپلود: ${state.uploadedChunks} از ${state.totalChunks} تکه (${Math.round(state.uploadedChunks / state.totalChunks * 100)}%)`;
            if (state.status === 'processing') await sendSimple(chatId, `🔄 وضعیت: در حال پردازش...${progress}\n\n${quotaText}${statsText}`, TOKEN);
            else if (state.status === 'waiting') {
              let pos = 1;
              if (isPro) { const row = await env.DB.prepare('SELECT COUNT(*) as pos FROM queue WHERE priority = 1 AND position <= (SELECT position FROM queue WHERE chat_id = ?)').bind(chatId).first(); pos = row?.pos || '?'; }
              else { const row = await env.DB.prepare('SELECT COUNT(*) as pos FROM queue WHERE priority = 0 AND position <= (SELECT position FROM queue WHERE chat_id = ?)').bind(chatId).first(); pos = row?.pos || '?'; }
              await sendSimple(chatId, `⏳ وضعیت: در صف انتظار (شماره صف: ${pos}${isPro ? ' - اولویت Pro' : ''})\n\n${quotaText}${statsText}`, TOKEN);
            }
            else if (state.status === 'awaiting_password') await sendSimple(chatId, `🔐 منتظر رمز عبور هستم. لطفاً رمز خود را ارسال کنید.\n\n${quotaText}${statsText}`, TOKEN);
            else await sendSimple(chatId, `هیچ درخواست فعالی ندارید.\n\n${quotaText}${statsText}`, TOKEN);
            return new Response('OK');
          }
          if (data === 'delete_my_file') {
            const lastBranch = await dbGetLastBranch(env, chatId);
            if (!lastBranch) { await sendSimple(chatId, "❌ هیچ فایل فعالی برای حذف یافت نشد.", TOKEN); return new Response('OK'); }
            const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${lastBranch}`, { method: 'DELETE', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CloudflareWorkerBot/1.0' } });
            if (res.ok || res.status === 404) { await dbRemoveActiveBranch(env, lastBranch); await sendSimple(chatId, "✅ فایل شما از سرور حذف شد.", TOKEN); }
            else await sendSimple(chatId, "❌ خطا در حذف فایل.", TOKEN);
            return new Response('OK');
          }
          if (data === 'new_link') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            const lastBranch = await dbGetLastBranch(env, chatId);
            if (lastBranch) {
              try { await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${lastBranch}`, { method: 'DELETE', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CloudflareWorkerBot/1.0' } }); await dbRemoveActiveBranch(env, lastBranch); } catch(e) { console.error(e); }
            }
            await sendSimple(chatId, "✅ درخواست قبلی لغو شد. اکنون لینک جدید را ارسال کنید.\n(برای لینک مستقیم تلگرام: @filesto_bot)", TOKEN);
            return new Response('OK');
          }
          return new Response('OK');
        }

        // ---------- پیام متنی (با اولویت وضعیت موقت ادمین) ----------
        if (update.message?.text) {
          const chatId = update.message.chat.id.toString();
          const text = update.message.text.trim();

          // === اولویت 1: وضعیت موقت ادمین ===
          if (adminTempState.has(chatId) && ADMIN_CHAT_ID && chatId === ADMIN_CHAT_ID) {
            const state = adminTempState.get(chatId);
            
            if (state.step === 'awaiting_discount_duration') {
              const hours = parseInt(text);
              if (isNaN(hours) || hours <= 0) {
                await sendSimple(chatId, "❌ لطفاً یک عدد صحیح مثبت (ساعت) وارد کنید. مثال: 24", TOKEN);
                return new Response('OK');
              }
              adminTempState.set(chatId, { step: 'awaiting_discount_stars', hours });
              await sendSimple(chatId, `✅ مدت تخفیف ${hours} ساعت تنظیم شد.\n⭐️ حالا تعداد ستاره تخفیفی را وارد کنید (عدد صحیح):`, TOKEN);
              return new Response('OK');
            }
            if (state.step === 'awaiting_discount_stars') {
              const starsPrice = parseInt(text);
              if (isNaN(starsPrice) || starsPrice <= 0) {
                await sendSimple(chatId, "❌ لطفاً یک عدد صحیح مثبت (ستاره) وارد کنید. مثال: 40", TOKEN);
                return new Response('OK');
              }
              adminTempState.set(chatId, { step: 'awaiting_discount_usd', starsPrice, hours: state.hours });
              await sendSimple(chatId, `⭐️ قیمت ستاره تخفیفی: ${starsPrice} تنظیم شد.\n💰 حالا قیمت دلاری تخفیفی را وارد کنید (مثال: 0.7):`, TOKEN);
              return new Response('OK');
            }
            if (state.step === 'awaiting_discount_usd') {
              const usdPrice = parseFloat(text);
              if (isNaN(usdPrice) || usdPrice <= 0) {
                await sendSimple(chatId, "❌ لطفاً یک عدد مثبت (دلار) وارد کنید. مثال: 0.7", TOKEN);
                return new Response('OK');
              }
              await setDiscount(env, state.starsPrice, usdPrice, state.hours);
              await sendSimple(chatId, `✅ تخفیف با موفقیت تنظیم شد.\n💰 قیمت تخفیفی: ${state.starsPrice} ستاره / ${usdPrice} USD\n⏳ اعتبار: ${state.hours} ساعت`, TOKEN);
              adminTempState.delete(chatId);
              await sendMessage(chatId, "🛠 پنل مدیریت", ADMIN_KEYBOARD, TOKEN);
              return new Response('OK');
            }
            if (state.step === 'awaiting_broadcast_message') {
              if (text === '/cancel') {
                adminTempState.delete(chatId);
                await sendSimple(chatId, "❌ ارسال همگانی لغو شد.", TOKEN);
                await sendMessage(chatId, "🛠 پنل مدیریت", ADMIN_KEYBOARD, TOKEN);
                return new Response('OK');
              }
              adminTempState.delete(chatId);
              await startBroadcast(env, chatId, text, TOKEN);
              await sendMessage(chatId, "🛠 پنل مدیریت", ADMIN_KEYBOARD, TOKEN);
              return new Response('OK');
            }
            if (state.step === 'awaiting_promote_userid') {
              const targetUserId = text;
              const result = await adminPromoteToPro(env, targetUserId, ADMIN_SECRET, ADMIN_SECRET);
              await sendSimple(chatId, result, TOKEN);
              adminTempState.delete(chatId);
              await sendMessage(chatId, "🛠 پنل مدیریت", ADMIN_KEYBOARD, TOKEN);
              return new Response('OK');
            }
            if (state.step === 'awaiting_quota_userid') {
              const targetUserId = text;
              const result = await adminResetQuota(env, targetUserId, ADMIN_SECRET, ADMIN_SECRET);
              await sendSimple(chatId, result, TOKEN);
              adminTempState.delete(chatId);
              await sendMessage(chatId, "🛠 پنل مدیریت", ADMIN_KEYBOARD, TOKEN);
              return new Response('OK');
            }
            if (state.step === 'awaiting_add_channel') {
              const channel = text;
              const result = await adminAddChannel(env, channel, ADMIN_SECRET, ADMIN_SECRET);
              await sendSimple(chatId, result, TOKEN);
              adminTempState.delete(chatId);
              await sendMessage(chatId, "🛠 پنل مدیریت", ADMIN_KEYBOARD, TOKEN);
              return new Response('OK');
            }
            // اگر مرحله ناشناخته بود پاک کن
            adminTempState.delete(chatId);
          }

          // === اولویت 2: دستورات ادمین متنی ===
          if (text.startsWith('/resetstats')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              await env.DB.prepare('DELETE FROM queue').run();
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'processing').run();
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'waiting').run();
              await finishTask(env);
              await sendSimple(chatId, "✅ آمار پردازش‌های فعال و صف بازنشانی شد.", TOKEN);
            } else await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN);
            return new Response('OK');
          }
          if (text.startsWith('/fixactive')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              const processingCount = (await env.DB.prepare('SELECT COUNT(*) as count FROM user_state WHERE status = ?').bind('processing').first())?.count || 0;
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'processing').run();
              await finishTask(env);
              await sendSimple(chatId, `✅ ${processingCount} رکورد پردازش گیر کرده لغو شد.`, TOKEN);
            } else await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN);
            return new Response('OK');
          }
          if (text.startsWith('/startqueue')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) { await finishTask(env); await sendSimple(chatId, "✅ صف مجدداً راه‌اندازی شد.", TOKEN); }
            else await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN);
            return new Response('OK');
          }
          if (text.startsWith('/resetqueue')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) { await env.DB.prepare('DELETE FROM queue').run(); await sendSimple(chatId, "✅ صف با موفقیت خالی شد.", TOKEN); }
            else await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN);
            return new Response('OK');
          }
          if (text.startsWith('/promote')) {
            const parts = text.split(' ');
            if (parts.length < 3) await sendSimple(chatId, "❌ دستور صحیح: /promote <ADMIN_SECRET> <USER_ID>", TOKEN);
            else {
              const secret = parts[1];
              const targetUserId = parts[2];
              const result = await adminPromoteToPro(env, targetUserId, ADMIN_SECRET, secret);
              await sendSimple(chatId, result, TOKEN);
            }
            return new Response('OK');
          }
          if (text.startsWith('/resetquota')) {
            const parts = text.split(' ');
            if (parts.length < 3) await sendSimple(chatId, "❌ دستور صحیح: /resetquota <ADMIN_SECRET> <USER_ID>", TOKEN);
            else {
              const secret = parts[1];
              const targetUserId = parts[2];
              const result = await adminResetQuota(env, targetUserId, ADMIN_SECRET, secret);
              await sendSimple(chatId, result, TOKEN);
            }
            return new Response('OK');
          }
          if (text === '/myid') {
            await sendSimple(chatId, `🆔 شناسه چت (Chat ID) شما: <code>${chatId}</code>`, TOKEN);
            return new Response('OK');
          }

          // === اولویت 3: /start ===
          if (text === '/start') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            const welcome = `🌀 <b>به ربات دانلودر خوش آمدید</b> 🌀\n\n📌 <b>ربات ملی دانلود</b> – راه‌حل سریع و آسان برای دانلود فایل‌های فیلترشده با <b>اینترنت ملی</b>!\n\n🔹 <b>نحوه دریافت لینک مستقیم:</b>\n• فایل خود را به ربات <b>@filesto_bot</b> فوروارد کنید.\n• آن ربات یک لینک مستقیم به شما می‌دهد. <b>لطفاً به پیام دانلود داخل آن ربات توجه نکنید</b>؛ فقط لینک مستقیم را کپی کنید.\n• سپس لینک مستقیم را در همین ربات ارسال کنید.\n• رمز عبور دلخواه وارد کنید.\n• منتظر بمانید تا پردازش شود و لینک دانلود (با نت ملی) را دریافت کنید.\n\n⭐️ <b>عضویت Pro</b>\n• فایل‌های شما تا <b>۱ روز</b> روی سرور می‌ماند (عادی ۱ ساعت)\n• اولویت بالاتر در صف پردازش\n• حداکثر <b>${DAILY_LIMIT_PRO} فایل و ${DAILY_VOLUME_PRO_BYTES/(1024*1024)} مگابایت در روز</b> (عادی ${DAILY_LIMIT_NORMAL} فایل و ${DAILY_VOLUME_NORMAL_BYTES/(1024*1024)} مگابایت)\n• برای عضویت روی دکمه «⭐️ عضویت Pro» کلیک کنید.\n\n⚠️ <b>هشدار امنیتی و قانونی:</b>\n• فایل‌ها در یک مخزن عمومی گیت‌هاب ذخیره می‌شوند. از ارسال فایل‌های شخصی، محرمانه، مستهجن یا خلاف قانون خودداری کنید.\n• مسئولیت قانونی ارسال محتوای غیرمجاز بر عهده کاربر است.\n• با استفاده از ربات، شما متعهد به رعایت تمام قوانین جمهوری اسلامی ایران می‌شوید.\n• لینک دانلود برای کاربران عادی ۱ ساعت و برای کاربران Pro ۱ روز معتبر است.\n• پس از دانلود، حتماً روی دکمه «🗑️ حذف فایل من» کلیک کنید.\n\n❤️ <b>حمایت و پشتیبانی:</b>\n• کانال تلگرام: @maramidownload\n\n👇 با دکمه زیر شروع کنید.`;
            const welcomeKeyboard = getMainKeyboardForAdmin(ADMIN_CHAT_ID, chatId);
            await sendMessage(chatId, welcome, welcomeKeyboard, TOKEN);
            return new Response('OK');
          }

          // === اولویت 4: لینک ===
          if (text.match(/^https?:\/\//)) {
            const requiredChannels = await getRequiredChannels(env);
            if (requiredChannels.length > 0) {
              const isMember = await isUserMemberOfChannels(chatId, requiredChannels, TOKEN);
              if (!isMember) {
                const channelsList = requiredChannels.map(c => `@${c}`).join(', ');
                const joinKeyboard = { inline_keyboard: [requiredChannels.map(ch => ({ text: `🔗 عضویت در ${ch}`, url: `https://t.me/${ch}` })), [{ text: "✅ عضو شدم", callback_data: "check_membership" }]] };
                await sendMessage(chatId, `❌ برای استفاده از ربات ابتدا باید در کانال‌های زیر عضو شوید:\n${channelsList}\n\nپس از عضویت، روی دکمه «عضو شدم» کلیک کنید.`, joinKeyboard, TOKEN);
                const fileSize = await getFileSize(text);
                await savePendingLink(env, chatId, text, fileSize || 0);
                return new Response('OK');
              }
            }
            await processPendingLink(env, chatId, text, 0, TOKEN);
            return new Response('OK');
          }

          // === اولویت 5: رمز عبور ===
          const state = await dbGetUserState(env, chatId);
          if (state && state.status === 'awaiting_password' && state.requestData) {
            const password = text;
            const fileUrl = state.requestData.url;
            const fileSize = state.requestData.fileSize || 0;
            const isPro = await isProUser(env, chatId);
            await dbDeleteUserState(env, chatId);
            const activeCount = await dbGetActiveCount(env);
            if (activeCount < MAX_CONCURRENT) {
              await dbSetUserState(env, chatId, 'processing', { url: fileUrl, password: password, fileSize: fileSize });
              runTaskWithRetry(chatId, fileUrl, password, env, TOKEN).catch(e => console.error(e));
              await sendSimple(chatId, "📤 درخواست به گیت‌هاب ارسال شد. منتظر شروع پردازش...", TOKEN);
            } else {
              await dbAddQueue(env, chatId, fileUrl, password, fileSize, isPro);
              await dbSetUserState(env, chatId, 'waiting', { url: fileUrl, password: password, fileSize: fileSize });
              const pos = await (isPro ? dbGetQueueCount(env, true) : dbGetQueueCount(env, false));
              await sendSimple(chatId, `⏳ در صف قرار گرفتید. شماره صف: ${pos}${isPro ? ' (اولویت Pro)' : ''}`, TOKEN);
            }
            return new Response('OK');
          }

          // === در غیر این صورت خطا ===
          await sendSimple(chatId, "❌ لینک معتبر نیست (با http:// یا https:// شروع شود).", TOKEN);
          return new Response('OK');
        }
        return new Response('OK');
      } catch (err) {
        console.error('Webhook error:', err);
        return new Response('Error', { status: 500 });
      }
    }
    return new Response('Bot is running');
  },

  // ---------- متدهای پردازش تسک ----------
  async runTaskWithRetry(chatId, fileUrl, password, env, TOKEN) {
    const userId = `${chatId}_${Date.now()}`;
    let retry = 0;
    let workflowSent = false;
    while (retry <= MAX_RETRIES && !workflowSent) {
      const sent = await this.sendWorkflowRequest(chatId, fileUrl, password, userId, env, TOKEN);
      if (sent) { workflowSent = true; break; }
      retry++;
      if (retry <= MAX_RETRIES) {
        await sendSimple(chatId, `⚠️ تلاش ${retry} ناموفق بود. تلاش مجدد...`, TOKEN);
        await new Promise(r => setTimeout(r, RETRY_INTERVAL));
      }
    }
    if (!workflowSent) {
      await sendSimple(chatId, "❌ ارسال به گیت‌هاب شکست خورد. لطفاً دوباره تلاش کنید.", TOKEN);
      await finishTask(env);
      return;
    }
    let started = false;
    for (let i = 0; i < MAX_START_WAIT_ATTEMPTS; i++) {
      await new Promise(r => setTimeout(r, START_WAIT_INTERVAL));
      const state = await dbGetUserState(env, chatId);
      if (state && state.startedAt) { started = true; break; }
    }
    if (!started) await sendSimple(chatId, "⚠️ پردازش شروع نشد. ممکن است سرور شلوغ باشد. با دکمه «وضعیت من» بعداً پیگیری کنید.", TOKEN);
    let branch = null;
    for (let i = 0; i < MAX_WAIT_CYCLES; i++) {
      await new Promise(r => setTimeout(r, WAIT_INTERVAL));
      const state = await dbGetUserState(env, chatId);
      if (state && state.branchName) { branch = state.branchName; break; }
    }
    if (!branch) {
      console.error(`Timeout for ${chatId}`);
      await sendSimple(chatId, "❌ زمان انتظار تمام شد. لطفاً بعداً با دکمه «وضعیت من» بررسی کنید.", TOKEN);
      await finishTask(env);
    }
  },

  async sendWorkflowRequest(chatId, fileUrl, password, userId, env, TOKEN) {
    const GITHUB_TOKEN = env.GH_TOKEN;
    const GITHUB_OWNER = 'gptmoone';
    const GITHUB_REPO = 'telegram-file-downloader';
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/download.yml/dispatches`, {
        method: 'POST',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CloudflareWorkerBot/1.0' },
        body: JSON.stringify({ ref: 'main', inputs: { file_url: fileUrl, zip_password: password, user_id: userId } })
      });
      return res.ok;
    } catch { return false; }
  }
};

// ============================================================
// توابع کمکی خارج از کلاس (برای تکمیل)
// ============================================================
async function finishTask(env) {
  const next = await dbPopQueue(env);
  if (next) {
    await dbSetUserState(env, next.chatId, 'processing', { url: next.fileUrl, password: next.password, fileSize: next.fileSize });
    runTaskWithRetry(next.chatId, next.fileUrl, next.password, env, env.TELEGRAM_TOKEN).catch(e => console.error(e));
    await sendSimple(next.chatId, "🔄 نوبت شما رسید! در حال شروع پردازش فایل...", env.TELEGRAM_TOKEN);
  }
}
async function runTaskWithRetry(chatId, fileUrl, password, env, TOKEN) {
  const userId = `${chatId}_${Date.now()}`;
  let retry = 0;
  let workflowSent = false;
  const maxRetries = 1;
  const retryInterval = 30000;
  while (retry <= maxRetries && !workflowSent) {
    const sent = await sendWorkflowRequestDirect(chatId, fileUrl, password, userId, env);
    if (sent) { workflowSent = true; break; }
    retry++;
    if (retry <= maxRetries) {
      await sendSimple(chatId, `⚠️ تلاش ${retry} ناموفق بود. تلاش مجدد...`, TOKEN);
      await new Promise(r => setTimeout(r, retryInterval));
    }
  }
  if (!workflowSent) {
    await sendSimple(chatId, "❌ ارسال به گیت‌هاب شکست خورد. لطفاً دوباره تلاش کنید.", TOKEN);
    await finishTask(env);
    return;
  }
  let started = false;
  const maxStartWaitAttempts = 2;
  const startWaitInterval = 30000;
  for (let i = 0; i < maxStartWaitAttempts; i++) {
    await new Promise(r => setTimeout(r, startWaitInterval));
    const state = await dbGetUserState(env, chatId);
    if (state && state.startedAt) { started = true; break; }
  }
  if (!started) await sendSimple(chatId, "⚠️ پردازش شروع نشد. ممکن است سرور شلوغ باشد. با دکمه «وضعیت من» بعداً پیگیری کنید.", TOKEN);
  let branch = null;
  const maxWaitCycles = 60;
  const waitInterval = 60000;
  for (let i = 0; i < maxWaitCycles; i++) {
    await new Promise(r => setTimeout(r, waitInterval));
    const state = await dbGetUserState(env, chatId);
    if (state && state.branchName) { branch = state.branchName; break; }
  }
  if (!branch) {
    console.error(`Timeout for ${chatId}`);
    await sendSimple(chatId, "❌ زمان انتظار تمام شد. لطفاً بعداً با دکمه «وضعیت من» بررسی کنید.", TOKEN);
    await finishTask(env);
  }
}
async function sendWorkflowRequestDirect(chatId, fileUrl, password, userId, env) {
  const GITHUB_TOKEN = env.GH_TOKEN;
  const GITHUB_OWNER = 'gptmoone';
  const GITHUB_REPO = 'telegram-file-downloader';
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/download.yml/dispatches`, {
      method: 'POST',
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CloudflareWorkerBot/1.0' },
      body: JSON.stringify({ ref: 'main', inputs: { file_url: fileUrl, zip_password: password, user_id: userId } })
    });
    return res.ok;
  } catch { return false; }
}
async function processPendingLink(env, chatId, fileUrl, fileSize, TOKEN) {
  const GITHUB_TOKEN = env.GH_TOKEN;
  const GITHUB_OWNER = 'gptmoone';
  const GITHUB_REPO = 'telegram-file-downloader';
  const isPro = await isProUser(env, chatId);
  const { allowed, remaining, limit } = await canUpload(env, chatId, isPro);
  if (!allowed) {
    await sendSimple(chatId, `❌ شما به حداکثر سهمیه روزانه (${limit} فایل) رسیده‌اید. لطفاً فردا دوباره تلاش کنید یا اشتراک Pro تهیه کنید.`, TOKEN);
    return;
  }
  const quotaMsg = `📊 سهمیه باقیمانده امروز: ${remaining} از ${limit} فایل`;
  const lastBranch = await dbGetLastBranch(env, chatId);
  if (lastBranch) {
    try {
      await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${lastBranch}`, { method: 'DELETE', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'CloudflareWorkerBot/1.0' } });
      await dbRemoveActiveBranch(env, lastBranch);
    } catch(e) { console.error(e); }
  }
  await dbDeleteUserState(env, chatId);
  await dbRemoveFromQueue(env, chatId);
  const repoSize = await getRepoSize(env);
  if (repoSize >= REPO_SIZE_LIMIT_GB) { await sendSimple(chatId, `❌ حجم مخزن به حد مجاز (${REPO_SIZE_LIMIT_GB} گیگابایت) رسیده. لطفاً چند ساعت بعد تلاش کنید.`, TOKEN); return; }
  else if (repoSize >= REPO_SIZE_WARNING_GB) await sendSimple(chatId, `⚠️ هشدار: حجم مخزن نزدیک به حد مجاز (${repoSize.toFixed(1)} از ${REPO_SIZE_LIMIT_GB} گیگابایت). پس از دانلود، فایل را حذف کنید.`, TOKEN);
  const actualFileSize = fileSize || await getFileSize(fileUrl);
  if (actualFileSize && actualFileSize > 2 * 1024 * 1024 * 1024) { await sendSimple(chatId, "❌ حجم فایل بیشتر از ۲ گیگابایت است.", TOKEN); return; }
  const volumeCheck = await canUploadByVolume(env, chatId, actualFileSize || 0, isPro);
  if (!volumeCheck.allowed) {
    const limitMB = isPro ? DAILY_VOLUME_PRO_BYTES/(1024*1024) : DAILY_VOLUME_NORMAL_BYTES/(1024*1024);
    const proKeyboard = { inline_keyboard: [[{ text: "⭐️ خرید اشتراک Pro", callback_data: "pro_info" }], [{ text: "📊 وضعیت من", callback_data: "status" }]] };
    await sendMessage(chatId, `❌ حجم فایل شما (${((actualFileSize || 0)/(1024*1024)).toFixed(1)} مگابایت) با سهمیه باقیمانده امروز شما (${(volumeCheck.remainingBytes/(1024*1024)).toFixed(1)} مگابایت) همخوانی ندارد.\n\nمحدودیت حجم روزانه برای ${isPro ? "کاربران Pro" : "کاربران عادی"} ${limitMB} مگابایت است.\nبرای افزایش سهمیه، اشتراک Pro تهیه کنید.`, proKeyboard, TOKEN);
    return;
  }
  await dbSetUserState(env, chatId, 'awaiting_password', { url: fileUrl, fileSize: actualFileSize || 0 });
  const cancelKeyboard = { inline_keyboard: [[{ text: "❌ لغو عملیات", callback_data: "cancel_input" }]] };
  await sendMessage(chatId, `✅ لینک دریافت شد.\n🔐 رمز عبور ZIP را وارد کنید:\n\n${quotaMsg}`, cancelKeyboard, TOKEN);
}
function getMainKeyboardForAdmin(adminChatId, currentChatId) {
  let keyboard = {
    inline_keyboard: [
      [{ text: "📥 دریافت لینک ملی", callback_data: "new_link" }],
      [{ text: "📊 آمار لحظه‌ای", callback_data: "stats" }, { text: "📊 وضعیت من", callback_data: "status" }],
      [{ text: "⭐️ عضویت Pro", callback_data: "pro_info" }, { text: "🗑️ حذف فایل من", callback_data: "delete_my_file" }],
      [{ text: "❓ راهنما", callback_data: "help" }, { text: "📢 کانال پشتیبانی", url: "https://t.me/maramidownload" }]
    ]
  };
  if (adminChatId && currentChatId === adminChatId) keyboard.inline_keyboard.push([{ text: "🛠 پنل مدیریت", callback_data: "admin_panel" }]);
  return keyboard;
}
