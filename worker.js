// ==========================================
// ربات دانلودر ملی - نسخه نهایی (با محدودیت روزانه و دستور ادمین)
// ==========================================

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📥 لینک جدید", callback_data: "new_link" }],
    [{ text: "📊 آمار لحظه‌ای", callback_data: "stats" }, { text: "📊 وضعیت من", callback_data: "status" }],
    [{ text: "⭐️ عضویت Pro", callback_data: "pro_info" }, { text: "🗑️ حذف فایل من", callback_data: "delete_my_file" }],
    [{ text: "❓ راهنما", callback_data: "help" }]
  ]
};
const MAX_CONCURRENT = 4;        // حداکثر پردازش همزمان
const MAX_RETRIES = 1;
const RETRY_INTERVAL = 30000;
const START_WAIT_INTERVAL = 30000;
const MAX_START_WAIT_ATTEMPTS = 2;
const TASK_TIMEOUT = 60 * 60 * 1000;
const WAIT_INTERVAL = 60000;
const MAX_WAIT_CYCLES = 60;
const REPO_SIZE_LIMIT_GB = 80;
const REPO_SIZE_WARNING_GB = 75;
const TTL_NORMAL = 3600;      // 1 ساعت
const TTL_PRO = 86400;        // 1 روز
const DAILY_LIMIT_NORMAL = 1;  // کاربر عادی: 1 فایل در روز
const DAILY_LIMIT_PRO = 5;     // کاربر Pro: 5 فایل در روز

const lastCallbackProcessed = new Map();

async function sendMessage(chatId, text, keyboard, TOKEN) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: JSON.stringify(keyboard || MAIN_KEYBOARD)
  };
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
async function sendSimple(chatId, text, TOKEN) {
  return sendMessage(chatId, text, MAIN_KEYBOARD, TOKEN);
}
async function answerCallback(callbackId, TOKEN) {
  const url = `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId })
    });
  } catch(e) { console.error('answerCallback failed:', e); }
}

async function getRepoSize(env) {
  const GITHUB_TOKEN = env.GH_TOKEN;
  const GITHUB_OWNER = 'gptmoone';
  const GITHUB_REPO = 'telegram-file-downloader';
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'CloudflareWorkerBot/1.0'
      }
    });
    if (res.ok) {
      const data = await res.json();
      return data.size / (1024 * 1024);
    }
  } catch (e) { console.error('getRepoSize error:', e); }
  return 0;
}

// ========== توابع D1 ==========
async function ensureGlobalStats(env) {
  const row = await env.DB.prepare('SELECT id FROM global_stats WHERE id = 1').first();
  if (!row) {
    await env.DB.prepare('INSERT INTO global_stats (id, total_links, total_volume_gb) VALUES (1, 0, 0)').run();
  }
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
  await env.DB.prepare(`
    INSERT OR REPLACE INTO user_state (chat_id, status, request_data, branch_name, started_at, total_chunks, uploaded_chunks)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(chatId, status, requestDataStr, branchName, startedAt, totalChunks, uploadedChunks).run();
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
  await env.DB.prepare(`
    INSERT INTO queue (chat_id, file_url, zip_password, file_size, enqueued_at, priority)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(chatId, fileUrl, password, fileSize, now, priority).run();
}
async function dbPopQueue(env) {
  let row = await env.DB.prepare('SELECT position, chat_id, file_url, zip_password, file_size FROM queue WHERE priority = 1 ORDER BY position ASC LIMIT 1').first();
  if (!row) {
    row = await env.DB.prepare('SELECT position, chat_id, file_url, zip_password, file_size FROM queue WHERE priority = 0 ORDER BY position ASC LIMIT 1').first();
  }
  if (!row) return null;
  await env.DB.prepare('DELETE FROM queue WHERE position = ?').bind(row.position).run();
  return {
    chatId: row.chat_id,
    fileUrl: row.file_url,
    password: row.zip_password,
    fileSize: row.file_size
  };
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
  } catch (err) {
    console.error('dbSetBranchForUser error:', err);
    throw err;
  }
}

// ========== توابع محدودیت روزانه ==========
async function getDailyLimit(env, chatId) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  let row = await env.DB.prepare('SELECT file_count, reset_date FROM daily_limits WHERE chat_id = ?').bind(chatId).first();
  if (!row || row.reset_date < todayStart) {
    // روز جدید، ریست کن
    await env.DB.prepare('INSERT OR REPLACE INTO daily_limits (chat_id, file_count, reset_date) VALUES (?, 0, ?)').bind(chatId, todayStart).run();
    row = { file_count: 0, reset_date: todayStart };
  }
  return { fileCount: row.file_count, resetDate: row.reset_date };
}
async function incrementDailyLimit(env, chatId) {
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  await env.DB.prepare(`
    INSERT INTO daily_limits (chat_id, file_count, reset_date)
    VALUES (?, 1, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      file_count = file_count + 1,
      reset_date = excluded.reset_date
    WHERE daily_limits.reset_date >= ?
  `).bind(chatId, todayStart, todayStart).run();
}
async function canUpload(env, chatId, isPro) {
  const { fileCount } = await getDailyLimit(env, chatId);
  const limit = isPro ? DAILY_LIMIT_PRO : DAILY_LIMIT_NORMAL;
  return fileCount < limit;
}

// ========== توابع Pro و NowPayments ==========
async function isProUser(env, chatId) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT expires_at FROM pro_users WHERE chat_id = ? AND expires_at > ?').bind(chatId, now).first();
  return !!row;
}
async function activateProSubscription(env, chatId, orderId, amountUSD) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (30 * 24 * 60 * 60);
  await env.DB.prepare(`
    INSERT OR REPLACE INTO pro_users (chat_id, expires_at, payment_id, activated_at)
    VALUES (?, ?, ?, ?)
  `).bind(chatId, expiresAt, orderId, now).run();
  await sendSimple(chatId, 
    `✅ عضویت **Pro** شما با موفقیت فعال شد!\n\n💎 مبلغ پرداختی: ${amountUSD} USD\n📅 تاریخ انقضا: ${new Date(expiresAt * 1000).toLocaleDateString('fa-IR')}\n\n🎁 مزایا:\n• فایل‌های شما تا ۱ روز روی سرور می‌ماند\n• اولویت بالاتر در صف پردازش\n• حداکثر ۵ فایل در روز\n\nاز اعتماد شما سپاسگزاریم! 🚀`, 
    env.TELEGRAM_TOKEN
  );
}
async function createNowPaymentsInvoice(env, chatId, amountUSD) {
  const orderId = `pro_${chatId}_${Date.now()}`;
  const webhookUrl = `https://telegram-file-bot.gptmoone.workers.dev/api/nowpayments-webhook`;
  const payload = {
    price_amount: amountUSD,
    price_currency: "usd",
    pay_currency: "ton",
    order_id: orderId,
    order_description: "اشتراک Pro - ربات دانلودر",
    ipn_callback_url: webhookUrl,
    success_url: "https://t.me/MeliDownloadBot?start=pro_success",
    cancel_url: "https://t.me/MeliDownloadBot?start=pro_cancel"
  };
  const response = await fetch('https://api.nowpayments.io/v1/invoice', {
    method: 'POST',
    headers: {
      'x-api-key': env.NOWPAYMENTS_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (data.invoice_url) {
    return { success: true, invoiceUrl: data.invoice_url, orderId: orderId };
  }
  return { success: false, error: data };
}
async function handleNowPaymentsWebhook(request, env) {
  try {
    const body = await request.json();
    const paymentStatus = body.payment_status;
    const orderId = body.order_id;
    const chatId = orderId.split('_')[1];
    if (paymentStatus === 'finished') {
      const amountUSD = body.price_amount || 0;
      await activateProSubscription(env, chatId, orderId, amountUSD);
      console.log(`✅ Pro activated for ${chatId}`);
    }
    return new Response('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response('Error', { status: 500 });
  }
}

// ========== تابع پاکسازی خودکار (Cron) ==========
async function cleanupExpiredBranches(env) {
  const GITHUB_TOKEN = env.GH_TOKEN;
  const GITHUB_OWNER = 'gptmoone';
  const GITHUB_REPO = 'telegram-file-downloader';
  const now = Math.floor(Date.now() / 1000);
  const expired = await env.DB.prepare('SELECT branch_name, chat_id FROM active_branches WHERE expires_at <= ?').bind(now).all();
  let deleted = 0;
  for (const branch of expired.results) {
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch.branch_name}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'CloudflareWorkerBot/1.0'
        }
      });
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
    if (secret !== env.ADMIN_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
    const result = await cleanupExpiredBranches(env);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Cleanup error:', err);
    return new Response('Error', { status: 500 });
  }
}

async function getFileSize(url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const size = head.headers.get('content-length');
    return size ? parseInt(size) : null;
  } catch { return null; }
}

// ========== دستور مدیریتی تبدیل کاربر به Pro ==========
async function adminPromoteToPro(env, chatId, targetChatId, adminSecret, providedSecret, TOKEN) {
  if (providedSecret !== adminSecret) return "❌ دسترسی غیرمجاز.";
  // بررسی وجود کاربر هدف در جدول users
  const userExists = await env.DB.prepare('SELECT 1 FROM users WHERE chat_id = ?').bind(targetChatId).first();
  if (!userExists) return "❌ کاربر مورد نظر یافت نشد. ممکن است هنوز ربات را استارت نکرده باشد.";
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (30 * 24 * 60 * 60);
  await env.DB.prepare(`
    INSERT OR REPLACE INTO pro_users (chat_id, expires_at, payment_id, activated_at)
    VALUES (?, ?, ?, ?)
  `).bind(targetChatId, expiresAt, `admin_${Date.now()}`, now).run();
  return `✅ کاربر ${targetChatId} با موفقیت به عضویت Pro درآمد. اشتراک تا ${new Date(expiresAt * 1000).toLocaleDateString('fa-IR')} معتبر است.`;
}

export default {
  async fetch(request, env) {
    const urlObj = new URL(request.url);
    const path = urlObj.pathname;
    const TOKEN = env.TELEGRAM_TOKEN;
    const GITHUB_TOKEN = env.GH_TOKEN;
    const GITHUB_OWNER = 'gptmoone';
    const GITHUB_REPO = 'telegram-file-downloader';
    const ADMIN_SECRET = env.ADMIN_SECRET || '';

    try {
      await ensureGlobalStats(env);
    } catch(e) { console.error('ensureGlobalStats error:', e); }

    // ========== API endpoints ==========
    if (path === '/api/cleanup-branches' && request.method === 'POST') {
      return handleCleanupBranches(request, env);
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
      } catch (err) { console.error('/api/started error:', err); return new Response('OK'); }
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
      } catch (err) { console.error('/api/progress error:', err); return new Response('OK'); }
    }
    if (path === '/api/complete' && request.method === 'POST') {
      try {
        const { user_id, branch } = await request.json();
        if (!user_id || !branch) {
          console.error('Invalid /api/complete payload:', { user_id, branch });
          return new Response('OK');
        }
        const chatId = user_id.split('_')[0];
        const isPro = await isProUser(env, chatId);
        const ttl = isPro ? TTL_PRO : TTL_NORMAL;
        const expiresAt = Math.floor(Date.now() / 1000) + ttl;

        await dbSetBranchForUser(env, chatId, branch, expiresAt);
        await env.DB.prepare('UPDATE user_state SET status = ?, branch_name = ? WHERE chat_id = ?').bind('done', branch, chatId).run();

        const reqRow = await env.DB.prepare('SELECT request_data FROM user_state WHERE chat_id = ?').bind(chatId).first();
        let fileSizeBytes = 0, password = '';
        if (reqRow && reqRow.request_data) {
          const req = JSON.parse(reqRow.request_data);
          fileSizeBytes = req.fileSize || 0;
          password = req.password || '';
        }

        const volumeGB = fileSizeBytes / (1024 * 1024 * 1024);
        await dbIncrementLinks(env, volumeGB);
        // افزایش شمارش روزانه
        await incrementDailyLimit(env, chatId);

        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        const validityMsg = isPro ? "۱ روز" : "۱ ساعت";
        const helpExtract = `\n\n📌 <b>نحوه استخراج فایل:</b>\nپس از دانلود فایل ZIP، با 7-Zip یا WinRAR فایل archive.7z.001 را استخراج کنید.`;
        await sendSimple(chatId, `✅ <b>فایل شما آماده شد!</b>\n\n🔗 لینک دانلود (${validityMsg} معتبر):\n${link}\n\n⚠️ رمز عبور: <code>${password}</code>${helpExtract}\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» فایل را از سرور پاک کنید.`, TOKEN);

        await dbDeleteUserState(env, chatId);
        await this.finishTask(env);
        return new Response('OK');
      } catch (err) {
        console.error('Error in /api/complete:', err);
        await this.finishTask(env).catch(e => console.error('finishTask error:', e));
        return new Response('OK');
      }
    }
    if (path === '/api/failed' && request.method === 'POST') {
      try {
        const { user_id } = await request.json();
        if (user_id) {
          const chatId = user_id.split('_')[0];
          await dbDeleteUserState(env, chatId);
          await this.finishTask(env);
          await sendSimple(chatId, "❌ پردازش فایل با خطا مواجه شد. لطفاً دوباره تلاش کنید.", TOKEN);
        }
        return new Response('OK');
      } catch (err) { console.error('/api/failed error:', err); return new Response('OK'); }
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
      } catch (err) { console.error('/api/cleanup error:', err); return new Response('OK'); }
    }

    // ========== وب‌هوک اصلی تلگرام ==========
    if (path === `/bot${TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();
        if (update.message?.chat?.id) await dbAddUser(env, update.message.chat.id.toString());
        if (update.callback_query?.message?.chat?.id) await dbAddUser(env, update.callback_query.message.chat.id.toString());

        // ========== دکمه‌ها ==========
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

          if (data === 'help') {
            const helpText = `📘 <b>راهنمای ربات</b>\n\n` +
              `این ربات لینک مستقیم فایل شما را به لینک قابل دانلود در <b>اینترنت ملی</b> تبدیل می‌کند.\n\n` +
              `🔹 <b>نحوه استفاده:</b>\n` +
              `1️⃣ اگر لینک مستقیم ندارید، فایل خود را به ربات <code>@filesto_bot</code> فوروارد کنید.\n` +
              `2️⃣ لینک مستقیم را در همین ربات ارسال کنید.\n` +
              `3️⃣ یک رمز عبور دلخواه برای فایل ZIP وارد کنید.\n` +
              `4️⃣ منتظر بمانید تا پردازش شود (لینک خودکار ارسال می‌شود).\n` +
              `5️⃣ پس از دانلود، روی دکمه <b>«🗑️ حذف فایل من»</b> کلیک کنید تا فایل از سرور پاک شود.\n\n` +
              `⭐️ <b>عضویت Pro</b>\n` +
              `• فایل‌های شما تا <b>۱ روز</b> روی سرور می‌ماند (عادی ۱ ساعت)\n` +
              `• اولویت بالاتر در صف پردازش\n` +
              `• حداکثر <b>۵ فایل در روز</b> (عادی ۱ فایل در روز)\n` +
              `• هزینه عضویت: ${env.PRO_PRICE || 5} USD (معادل حدود ${(env.PRO_PRICE || 5)/5} TON)\n` +
              `• برای خرید روی دکمه «⭐️ عضویت Pro» کلیک کنید.\n\n` +
              `🔹 <b>نحوه استخراج فایل پس از دانلود:</b>\n` +
              `• فایل ZIP دانلود شده را با <b>7-Zip</b> یا <b>WinRAR</b> باز کنید.\n` +
              `• داخل پوشه استخراج شده، فایل‌هایی با پسوند <code>.001</code>، <code>.002</code> و ... می‌بینید.\n` +
              `• روی فایل <b>archive.7z.001</b> کلیک کرده و گزینه <b>Extract Here</b> (یا استخراج در اینجا) را انتخاب کنید.\n` +
              `• نرم‌افزار به صورت خودکار تمام تکه‌ها را به هم چسبانده و فایل اصلی شما را تحویل می‌دهد.\n\n` +
              `⚠️ <b>توجه امنیتی و قانونی:</b>\n` +
              `• فایل‌ها در یک <b>مخزن عمومی گیت‌هاب</b> ذخیره می‌شوند. با وجود رمزنگاری، از ارسال فایل‌های شخصی، محرمانه، مستهجن یا خلاف قانون خودداری کنید.\n` +
              `• <b>مسئولیت قانونی ارسال محتوای غیرمجاز بر عهده کاربر است.</b> ربات و توسعه‌دهنده هیچ مسئولیتی در قبال محتوای ارسالی ندارد.\n` +
              `• با استفاده از ربات، شما <b>متعهد به رعایت تمام قوانین</b> جمهوری اسلامی ایران و قوانین بین‌المللی می‌شوید.\n` +
              `• لینک دانلود برای کاربران عادی <b>۱ ساعت</b> و برای کاربران Pro <b>۱ روز</b> معتبر است.\n` +
              `• حجم فایل نباید بیشتر از ۲ گیگابایت باشد.\n\n` +
              `❤️ <b>حمایت و پشتیبانی:</b>\n` +
              `• کانال تلگرام: @maramivpn\n` +
              `• عضو شوید تا از آخرین به‌روزرسانی‌ها و تخفیف‌های ویژه مطلع گردید.\n\n` +
              `📢 ما را به دوستان خود معرفی کنید.`;
            await sendSimple(chatId, helpText, TOKEN);
          }
          else if (data === 'stats') {
            try {
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
              await sendSimple(chatId, `📊 <b>آمار لحظه‌ای ربات</b>\n\n👥 کاربران کل: ${totalUsers}\n⭐️ کاربران Pro فعال: ${proUsersCount}\n🔄 در حال پردازش: ${activeCount}\n⏳ در صف انتظار: ${queueCount} (${proQueueCount} پرو)\n🔗 لینک‌های ملی ساخته شده: ${stats.total_links}\n💾 حجم کل دانلود شده: ${stats.total_volume_gb.toFixed(2)} گیگابایت${sizeMsg}${warningMsg}\n\n📢 @maramivpn`, TOKEN);
            } catch (err) { console.error(err); await sendSimple(chatId, "⚠️ خطا در دریافت آمار.", TOKEN); }
          }
          else if (data === 'status') {
            try {
              const lastBranch = await dbGetLastBranch(env, chatId);
              if (lastBranch) {
                const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${lastBranch}.zip`;
                await sendSimple(chatId, `✅ فایل شما آماده است!\n\n🔗 لینک دانلود: ${link}\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» پاک کنید.`, TOKEN);
                return;
              }
              const state = await dbGetUserState(env, chatId);
              if (!state) { await sendSimple(chatId, "📭 هیچ درخواست فعالی ندارید.", TOKEN); return; }
              let progress = '';
              if (state.totalChunks && state.uploadedChunks) {
                const percent = Math.round(state.uploadedChunks / state.totalChunks * 100);
                progress = `\n📦 پیشرفت آپلود: ${state.uploadedChunks} از ${state.totalChunks} تکه (${percent}%)`;
              }
              if (state.status === 'processing') await sendSimple(chatId, `🔄 وضعیت: در حال پردازش...${progress}`, TOKEN);
              else if (state.status === 'waiting') {
                const isPro = await isProUser(env, chatId);
                let pos = 1;
                if (isPro) {
                  const row = await env.DB.prepare('SELECT COUNT(*) as pos FROM queue WHERE priority = 1 AND position <= (SELECT position FROM queue WHERE chat_id = ?)').bind(chatId).first();
                  pos = row?.pos || '?';
                } else {
                  const row = await env.DB.prepare('SELECT COUNT(*) as pos FROM queue WHERE priority = 0 AND position <= (SELECT position FROM queue WHERE chat_id = ?)').bind(chatId).first();
                  pos = row?.pos || '?';
                }
                await sendSimple(chatId, `⏳ وضعیت: در صف انتظار (شماره صف: ${pos}${isPro ? ' - اولویت Pro' : ''})`, TOKEN);
              } else if (state.status === 'awaiting_password') {
                await sendSimple(chatId, "🔐 منتظر رمز عبور هستم. لطفاً رمز خود را ارسال کنید.", TOKEN);
              } else {
                await sendSimple(chatId, "هیچ درخواست فعالی ندارید.", TOKEN);
              }
            } catch (err) { console.error(err); await sendSimple(chatId, "⚠️ خطا در دریافت وضعیت.", TOKEN); }
          }
          else if (data === 'delete_my_file') {
            try {
              const lastBranch = await dbGetLastBranch(env, chatId);
              if (!lastBranch) { await sendSimple(chatId, "❌ هیچ فایل فعالی برای حذف یافت نشد.", TOKEN); return; }
              const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${lastBranch}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `token ${GITHUB_TOKEN}`,
                  'Accept': 'application/vnd.github.v3+json',
                  'User-Agent': 'CloudflareWorkerBot/1.0'
                }
              });
              if (res.ok || res.status === 404) {
                await dbRemoveActiveBranch(env, lastBranch);
                await sendSimple(chatId, "✅ فایل شما از سرور حذف شد.", TOKEN);
              } else { await sendSimple(chatId, "❌ خطا در حذف فایل.", TOKEN); }
            } catch (err) { console.error(err); await sendSimple(chatId, "⚠️ خطا در حذف فایل.", TOKEN); }
          }
          else if (data === 'new_link') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            const lastBranch = await dbGetLastBranch(env, chatId);
            if (lastBranch) {
              try {
                await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${lastBranch}`, {
                  method: 'DELETE',
                  headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'CloudflareWorkerBot/1.0'
                  }
                });
                await dbRemoveActiveBranch(env, lastBranch);
              } catch(e) { console.error(e); }
            }
            await sendSimple(chatId, "✅ درخواست قبلی لغو شد. اکنون لینک جدید را ارسال کنید.\n(برای لینک مستقیم تلگرام: @filesto_bot)", TOKEN);
          }
          else if (data === 'pro_info') {
            const isPro = await isProUser(env, chatId);
            if (isPro) {
              const row = await env.DB.prepare('SELECT expires_at FROM pro_users WHERE chat_id = ?').bind(chatId).first();
              const expireDate = new Date(row.expires_at * 1000).toLocaleDateString('fa-IR');
              await sendSimple(chatId, `⭐️ وضعیت اشتراک Pro شما\n✅ فعال\n📅 تاریخ انقضا: ${expireDate}\n\n🎁 مزایا:\n• فایل‌های شما تا ۱ روز می‌ماند\n• اولویت بالاتر در صف\n• حداکثر ۵ فایل در روز`, TOKEN);
            } else {
              const amountUSD = parseFloat(env.PRO_PRICE) || 5;
              const invoice = await createNowPaymentsInvoice(env, chatId, amountUSD);
              if (invoice.success) {
                const proKeyboard = {
                  inline_keyboard: [[{ text: "💰 پرداخت با ارز دیجیتال", url: invoice.invoiceUrl }], [{ text: "🔙 بازگشت", callback_data: "stats" }]]
                };
                await sendMessage(chatId, 
                  `⭐️ عضویت ویژه (Pro)\n\n💰 هزینه: ${amountUSD} USD\nپس از پرداخت خودکار فعال می‌شود.`,
                  proKeyboard, TOKEN);
              } else { await sendSimple(chatId, `❌ خطا در ایجاد فاکتور پرداخت.`, TOKEN); }
            }
          }
          return new Response('OK');
        }

        // ========== پیام متنی ==========
        if (update.message?.text) {
          const chatId = update.message.chat.id.toString();
          const text = update.message.text.trim();

          // دستورات ادمین
          if (text.startsWith('/resetstats')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              await env.DB.prepare('DELETE FROM queue').run();
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'processing').run();
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'waiting').run();
              await this.finishTask(env);
              await sendSimple(chatId, "✅ آمار پردازش‌های فعال و صف بازنشانی شد. صف در حال پردازش است.", TOKEN);
            } else {
              await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN);
            }
            return new Response('OK');
          }
          if (text.startsWith('/fixactive')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              const processingCount = (await env.DB.prepare('SELECT COUNT(*) as count FROM user_state WHERE status = ?').bind('processing').first())?.count || 0;
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'processing').run();
              await this.finishTask(env);
              await sendSimple(chatId, `✅ ${processingCount} رکورد پردازش گیر کرده لغو شد. صف در حال پردازش است.`, TOKEN);
            } else {
              await sendSimple(chatId, "❌ دسترسی غیرمجاز. توکن اشتباه است.", TOKEN);
            }
            return new Response('OK');
          }
          if (text.startsWith('/startqueue')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              await this.finishTask(env);
              await sendSimple(chatId, "✅ صف مجدداً راه‌اندازی شد.", TOKEN);
            } else {
              await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN);
            }
            return new Response('OK');
          }
          if (text.startsWith('/resetqueue')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              await env.DB.prepare('DELETE FROM queue').run();
              await sendSimple(chatId, "✅ صف با موفقیت خالی شد (پردازش‌های جاری دست نخورده).", TOKEN);
            } else {
              await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN);
            }
            return new Response('OK');
          }
          // دستور جدید: تبدیل کاربر به Pro توسط ادمین
          if (text.startsWith('/promote')) {
            const parts = text.split(' ');
            if (parts.length < 3) {
              await sendSimple(chatId, "❌ دستور صحیح: /promote <ADMIN_SECRET> <USER_ID>", TOKEN);
              return new Response('OK');
            }
            const secret = parts[1];
            const targetUserId = parts[2];
            const result = await adminPromoteToPro(env, chatId, targetUserId, ADMIN_SECRET, secret, TOKEN);
            await sendSimple(chatId, result, TOKEN);
            return new Response('OK');
          }

          if (text === '/start') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            const welcome = `🌀 <b>به ربات دانلودر خوش آمدید</b> 🌀\n\n` +
              `📌 <b>ربات ملی دانلود</b> – راه‌حل سریع و آسان برای دانلود فایل‌های فیلترشده با <b>اینترنت ملی</b>!\n\n` +
              `🔹 <b>چگونه کار می‌کند؟</b>\n` +
              `1️⃣ فایل خود را به ربات <code>@filesto_bot</code> بدهید تا لینک مستقیم بگیرید.\n` +
              `2️⃣ لینک مستقیم را در همین ربات ارسال کنید.\n` +
              `3️⃣ یک رمز عبور دلخواه برای فایل ZIP وارد کنید.\n` +
              `4️⃣ ربات فایل را دانلود، تکه‌تکه کرده و در گیت‌هاب آپلود می‌کند.\n` +
              `5️⃣ لینک دانلود (۱ ساعت معتبر) را دریافت کرده و با <b>اینترنت ملی</b> دانلود کنید.\n\n` +
              `⭐️ <b>عضویت Pro</b>\n` +
              `• فایل‌های شما تا <b>۱ روز</b> روی سرور می‌ماند (عادی ۱ ساعت)\n` +
              `• اولویت بالاتر در صف پردازش (پروها زودتر از عادی انجام می‌شوند)\n` +
              `• حداکثر <b>۵ فایل در روز</b> (عادی ۱ فایل در روز)\n` +
              `• هزینه عضویت: ${env.PRO_PRICE || 5} USD (معادل حدود ${(env.PRO_PRICE || 5)/5} TON)\n` +
              `• برای خرید روی دکمه «⭐️ عضویت Pro» کلیک کنید.\n\n` +
              `⚠️ <b>هشدار امنیتی و قانونی:</b>\n` +
              `• فایل‌ها در یک <b>مخزن عمومی گیت‌هاب</b> ذخیره می‌شوند. با وجود رمزنگاری، <b>از ارسال فایل‌های شخصی، محرمانه، مستهجن یا خلاف قانون خودداری کنید.</b>\n` +
              `• <b>مسئولیت قانونی ارسال محتوای غیرمجاز بر عهده کاربر است.</b> ربات و توسعه‌دهنده هیچ مسئولیتی در قبال محتوای ارسالی ندارد.\n` +
              `• با استفاده از ربات، شما <b>متعهد به رعایت تمام قوانین</b> جمهوری اسلامی ایران و قوانین بین‌المللی می‌شوید.\n` +
              `• لینک دانلود برای کاربران عادی <b>۱ ساعت</b> و برای کاربران Pro <b>۱ روز</b> معتبر است.\n` +
              `• پس از دانلود، حتماً روی دکمه <b>«🗑️ حذف فایل من»</b> کلیک کنید تا فایل از سرور پاک شود.\n` +
              `• از ارسال فایل‌های مستهجن خودداری کنید تا ریپازوتری بن نشود.\n\n` +
              `❤️ <b>حمایت و پشتیبانی:</b>\n` +
              `• کانال تلگرام: @maramivpn\n` +
              `• عضو شوید تا از آخرین به‌روزرسانی‌ها و تخفیف‌های ویژه مطلع گردید.\n\n` +
              `👇 با دکمه زیر شروع کنید.`;
            await sendMessage(chatId, welcome, MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // دریافت لینک جدید (با بررسی محدودیت روزانه)
          if (text.match(/^https?:\/\//)) {
            // بررسی محدودیت روزانه قبل از هر چیز
            const isPro = await isProUser(env, chatId);
            const allowed = await canUpload(env, chatId, isPro);
            if (!allowed) {
              const limit = isPro ? DAILY_LIMIT_PRO : DAILY_LIMIT_NORMAL;
              await sendSimple(chatId, `❌ شما به حداکثر سهمیه روزانه (${limit} فایل) رسیده‌اید. لطفاً فردا دوباره تلاش کنید یا اشتراک Pro تهیه کنید تا سهمیه شما به ${DAILY_LIMIT_PRO} فایل در روز افزایش یابد.`, TOKEN);
              return new Response('OK');
            }

            const lastBranch = await dbGetLastBranch(env, chatId);
            if (lastBranch) {
              try {
                await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${lastBranch}`, {
                  method: 'DELETE',
                  headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'CloudflareWorkerBot/1.0'
                  }
                });
                await dbRemoveActiveBranch(env, lastBranch);
              } catch(e) { console.error(e); }
            }
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            const repoSize = await getRepoSize(env);
            if (repoSize >= REPO_SIZE_LIMIT_GB) {
              await sendSimple(chatId, `❌ حجم مخزن به حد مجاز (${REPO_SIZE_LIMIT_GB} گیگابایت) رسیده. لطفاً چند ساعت بعد تلاش کنید.`, TOKEN);
              return new Response('OK');
            } else if (repoSize >= REPO_SIZE_WARNING_GB) {
              await sendSimple(chatId, `⚠️ هشدار: حجم مخزن نزدیک به حد مجاز (${repoSize.toFixed(1)} از ${REPO_SIZE_LIMIT_GB} گیگابایت). پس از دانلود، فایل را حذف کنید.`, TOKEN);
            }
            const fileSize = await getFileSize(text);
            if (fileSize && fileSize > 2 * 1024 * 1024 * 1024) {
              await sendSimple(chatId, "❌ حجم فایل بیشتر از ۲ گیگابایت است.", TOKEN);
              return new Response('OK');
            }
            await dbSetUserState(env, chatId, 'awaiting_password', { url: text, fileSize: fileSize || 0 });
            const cancelKeyboard = { inline_keyboard: [[{ text: "❌ لغو عملیات", callback_data: "cancel_input" }]] };
            await sendMessage(chatId, "✅ لینک دریافت شد.\n🔐 رمز عبور ZIP را وارد کنید:", cancelKeyboard, TOKEN);
            return new Response('OK');
          }

          // رمز عبور (بدون تغییر)
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
              this.runTaskWithRetry(chatId, fileUrl, password, env, TOKEN).catch(e => console.error(e));
              await sendSimple(chatId, "📤 درخواست به گیت‌هاب ارسال شد. منتظر شروع پردازش...", TOKEN);
            } else {
              await dbAddQueue(env, chatId, fileUrl, password, fileSize, isPro);
              await dbSetUserState(env, chatId, 'waiting', { url: fileUrl, password: password, fileSize: fileSize });
              const pos = await (isPro ? dbGetQueueCount(env, true) : dbGetQueueCount(env, false));
              await sendSimple(chatId, `⏳ در صف قرار گرفتید. شماره صف: ${pos}${isPro ? ' (اولویت Pro)' : ''}`, TOKEN);
            }
            return new Response('OK');
          }

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

  async runTaskWithRetry(chatId, fileUrl, password, env, TOKEN) {
    const userId = `${chatId}_${Date.now()}`;
    let retry = 0;
    let workflowSent = false;
    while (retry <= MAX_RETRIES && !workflowSent) {
      const sent = await this.sendWorkflowRequest(chatId, fileUrl, password, userId, env, TOKEN);
      if (sent) {
        workflowSent = true;
        break;
      }
      retry++;
      if (retry <= MAX_RETRIES) {
        await sendSimple(chatId, `⚠️ تلاش ${retry} ناموفق بود. تلاش مجدد...`, TOKEN);
        await new Promise(r => setTimeout(r, RETRY_INTERVAL));
      }
    }
    if (!workflowSent) {
      await sendSimple(chatId, "❌ ارسال به گیت‌هاب شکست خورد. لطفاً دوباره تلاش کنید.", TOKEN);
      await this.finishTask(env);
      return;
    }
    let started = false;
    for (let i = 0; i < MAX_START_WAIT_ATTEMPTS; i++) {
      await new Promise(r => setTimeout(r, START_WAIT_INTERVAL));
      const state = await dbGetUserState(env, chatId);
      if (state && state.startedAt) { started = true; break; }
    }
    if (!started) {
      await sendSimple(chatId, "⚠️ پردازش شروع نشد. ممکن است سرور شلوغ باشد. با دکمه «وضعیت من» بعداً پیگیری کنید.", TOKEN);
    }
    let branch = null;
    for (let i = 0; i < MAX_WAIT_CYCLES; i++) {
      await new Promise(r => setTimeout(r, WAIT_INTERVAL));
      const state = await dbGetUserState(env, chatId);
      if (state && state.branchName) { branch = state.branchName; break; }
    }
    if (!branch) {
      console.error(`Timeout for ${chatId}`);
      await sendSimple(chatId, `❌ زمان انتظار تمام شد. لطفاً بعداً با دکمه «وضعیت من» بررسی کنید.`, TOKEN);
      await this.finishTask(env);
    }
  },

  async sendWorkflowRequest(chatId, fileUrl, password, userId, env, TOKEN) {
    const GITHUB_TOKEN = env.GH_TOKEN;
    const GITHUB_OWNER = 'gptmoone';
    const GITHUB_REPO = 'telegram-file-downloader';
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/download.yml/dispatches`, {
        method: 'POST',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'CloudflareWorkerBot/1.0'
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            file_url: fileUrl,
            zip_password: password,
            user_id: userId
          }
        })
      });
      return res.ok;
    } catch { return false; }
  },

  async finishTask(env) {
    const next = await dbPopQueue(env);
    if (next) {
      await dbSetUserState(env, next.chatId, 'processing', { url: next.fileUrl, password: next.password, fileSize: next.fileSize });
      this.runTaskWithRetry(next.chatId, next.fileUrl, next.password, env, this.TOKEN).catch(e => console.error(e));
      await sendSimple(next.chatId, "🔄 نوبت شما رسید! در حال شروع پردازش فایل...", env.TELEGRAM_TOKEN);
    }
  }
};
