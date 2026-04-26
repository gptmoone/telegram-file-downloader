// ==========================================
// ربات دانلودر ملی - نسخه نهایی با رفع مشکلات صف و حذف تکراری
// ==========================================

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📥 لینک جدید", callback_data: "new_link" }],
    [{ text: "📊 آمار لحظه‌ای", callback_data: "stats" }, { text: "📊 وضعیت من", callback_data: "status" }],
    [{ text: "⭐️ عضویت Pro", callback_data: "pro_info" }, { text: "🗑️ حذف فایل من", callback_data: "delete_my_file" }],
    [{ text: "❓ راهنما", callback_data: "help" }]
  ]
};
const MAX_CONCURRENT = 10;
const MAX_RETRIES = 1;
const RETRY_INTERVAL = 30000;
const START_WAIT_INTERVAL = 30000;
const MAX_START_WAIT_ATTEMPTS = 2;
const TASK_TIMEOUT = 60 * 60 * 1000;
const WAIT_INTERVAL = 60000;
const MAX_WAIT_CYCLES = 60;
const REPO_SIZE_LIMIT_GB = 80;
const REPO_SIZE_WARNING_GB = 75;

// کش برای جلوگیری از پردازش مجدد دکمه در کمتر از 3 ثانیه
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
  else if (onlyPro === false && onlyPro !== undefined) sql += ' WHERE priority = 0'; // اگر false داده شده باشد
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
  await dbAddActiveBranch(env, branchName, chatId, now, expiresAt);
  await env.DB.prepare('UPDATE user_state SET branch_name = ? WHERE chat_id = ?').bind(branchName, chatId).run();
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
    `✅ عضویت **Pro** شما با موفقیت فعال شد!\n\n💎 مبلغ پرداختی: ${amountUSD} USD\n📅 تاریخ انقضا: ${new Date(expiresAt * 1000).toLocaleDateString('fa-IR')}\n\n🎁 مزایا:\n• فایل‌های شما تا ۳ روز روی سرور می‌ماند\n• اولویت بالاتر در صف پردازش\n\nاز اعتماد شما سپاسگزاریم! 🚀`, 
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
        console.log(`✅ Deleted expired branch: ${branch.branch_name}`);
      } else {
        console.error(`Failed to delete ${branch.branch_name}: ${res.status}`);
      }
    } catch (err) { console.error(err); }
  }
  await env.DB.prepare('DELETE FROM user_state WHERE status = ? AND started_at <= ?').bind('done', now - 86400).run();
  await env.DB.prepare('DELETE FROM queue WHERE enqueued_at <= ?').bind(now * 1000 - 172800000).run();
  return { deleted: expired.results.length };
}

async function getFileSize(url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const size = head.headers.get('content-length');
    return size ? parseInt(size) : null;
  } catch { return null; }
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

    try { await ensureGlobalStats(env); } catch(e) { console.error(e); }

    // Cron trigger
    if (path === '/__cron' && request.method === 'GET') {
      const result = await cleanupExpiredBranches(env);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Webhook NowPayments
    if (path === '/api/nowpayments-webhook' && request.method === 'POST') {
      return handleNowPaymentsWebhook(request, env);
    }

    // API endpoints (بدون تغییر)
    if (path === '/api/started' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await env.DB.prepare('UPDATE user_state SET started_at = ? WHERE chat_id = ?').bind(Date.now(), chatId).run();
        await sendSimple(chatId, "🔄 پردازش فایل روی گیت‌هاب آغاز شد...", TOKEN);
      }
      return new Response('OK');
    }
    if (path === '/api/progress' && request.method === 'POST') {
      const { user_id, total_chunks, uploaded_chunks } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        if (total_chunks) await env.DB.prepare('UPDATE user_state SET total_chunks = ? WHERE chat_id = ?').bind(total_chunks, chatId).run();
        if (uploaded_chunks !== undefined) await env.DB.prepare('UPDATE user_state SET uploaded_chunks = ? WHERE chat_id = ?').bind(uploaded_chunks, chatId).run();
      }
      return new Response('OK');
    }
    if (path === '/api/complete' && request.method === 'POST') {
      const { user_id, branch } = await request.json();
      if (user_id && branch) {
        const chatId = user_id.split('_')[0];
        const isPro = await isProUser(env, chatId);
        const ttlSeconds = isPro ? 3 * 24 * 60 * 60 : 3 * 60 * 60;
        const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
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
        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        const validityMsg = isPro ? "۳ روز" : "۳ ساعت";
        const helpExtract = `\n\n📌 <b>نحوه استخراج فایل:</b>\nپس از دانلود فایل ZIP، با 7-Zip یا WinRAR فایل archive.7z.001 را استخراج کنید.`;
        await sendSimple(chatId, `✅ <b>فایل شما آماده شد!</b>\n\n🔗 لینک دانلود (${validityMsg} معتبر):\n${link}\n\n⚠️ رمز عبور: <code>${password}</code>${helpExtract}\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» فایل را از سرور پاک کنید.`, TOKEN);
        await dbDeleteUserState(env, chatId);
        await this.finishTask(env);
      }
      return new Response('OK');
    }
    if (path === '/api/failed' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await dbDeleteUserState(env, chatId);
        await this.finishTask(env);
        await sendSimple(chatId, "❌ پردازش فایل با خطا مواجه شد. لطفاً دوباره تلاش کنید.", TOKEN);
      }
      return new Response('OK');
    }
    if (path === '/api/cleanup' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await dbDeleteUserState(env, chatId);
        await dbRemoveFromQueue(env, chatId);
      }
      return new Response('OK');
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
          
          // جلوگیری از پردازش مجدد یک دکمه در کمتر از 3 ثانیه
          const now = Date.now();
          const lastTime = lastCallbackProcessed.get(`${chatId}_${data}`) || 0;
          if (now - lastTime < 3000) {
            return new Response('OK');
          }
          lastCallbackProcessed.set(`${chatId}_${data}`, now);
          
          await answerCallback(callbackId, TOKEN);

          if (data === 'help') {
            const helpText = `📘 <b>راهنمای ربات</b>\n\n` +
              `این ربات لینک مستقیم را به لینک قابل دانلود در اینترنت ملی تبدیل می‌کند.\n\n` +
              `🔹 نحوه استفاده:\n1️⃣ فایل خود را به @filesto_bot بدهید تا لینک مستقیم بگیرید.\n2️⃣ لینک را در همین ربات ارسال کنید.\n3️⃣ رمز عبور دلخواه وارد کنید.\n4️⃣ منتظر پردازش شوید (لینک خودکار ارسال می‌شود).\n5️⃣ پس از دانلود، روی دکمه «حذف فایل من» کلیک کنید.\n\n` +
              `⭐️ عضویت Pro:\n• فایل‌های شما تا ۳ روز روی سرور می‌ماند (عادی ۳ ساعت)\n• اولویت بالاتر در صف پردازش\n• هزینه عضویت: ${env.PRO_PRICE || 5} USD (معادل حدود ${(env.PRO_PRICE || 5)/5} TON)\n\n` +
              `⚠️ توجه امنیتی:\nمخزن عمومی است، از ارسال فایل‌های شخصی و مهم خودداری کنید.\n❤️ حمایت: @maramivpn`;
            await sendSimple(chatId, helpText, TOKEN);
          }
          else if (data === 'stats') {
            try {
              const stats = await dbGetGlobalStats(env);
              const activeCount = await dbGetActiveCount(env);
              const queueCount = await dbGetQueueCount(env);
              const proQueueCount = await dbGetQueueCount(env, true);
              const totalBranches = await dbGetActiveBranchesCount(env);
              const totalUsers = await dbGetUsersCount(env);
              const nowUnix = Math.floor(Date.now() / 1000);
              const proUsersCount = (await env.DB.prepare('SELECT COUNT(*) as count FROM pro_users WHERE expires_at > ?').bind(nowUnix).first()).count;
              const repoSize = await getRepoSize(env);
              const sizeMsg = repoSize ? `\n📦 حجم مخزن: ${repoSize.toFixed(1)} گیگابایت` : '';
              let warningMsg = '';
              if (repoSize >= REPO_SIZE_LIMIT_GB) warningMsg = '\n\n⚠️ هشدار: حجم مخزن پر است. لطفاً فایل‌های خود را حذف کنید.';
              else if (repoSize >= REPO_SIZE_WARNING_GB) warningMsg = '\n\n⚠️ هشدار: حجم مخزن نزدیک به حد مجاز است. پس از دانلود، فایل خود را حذف کنید.';
              await sendSimple(chatId, `📊 <b>آمار لحظه‌ای ربات</b>\n\n👥 کاربران کل: ${totalUsers}\n⭐️ کاربران Pro فعال: ${proUsersCount}\n🔄 در حال پردازش: ${activeCount}\n⏳ در صف انتظار: ${queueCount} (${proQueueCount} پرو)\n🔗 لینک‌های ملی ساخته شده: ${stats.total_links}\n💾 حجم کل دانلود شده: ${stats.total_volume_gb.toFixed(2)} گیگابایت${sizeMsg}${warningMsg}\n\n📢 @maramivpn`, TOKEN);
            } catch (err) { console.error(err); await sendSimple(chatId, "⚠️ خطا در دریافت آمار. لطفاً چند دقیقه دیگر تلاش کنید.", TOKEN); }
          }
          else if (data === 'status') {
            try {
              const state = await dbGetUserState(env, chatId);
              if (!state) { await sendSimple(chatId, "📭 هیچ درخواست فعالی ندارید.", TOKEN); return; }
              let progress = '';
              if (state.totalChunks && state.uploadedChunks) {
                const percent = Math.round(state.uploadedChunks / state.totalChunks * 100);
                progress = `\n📦 پیشرفت آپلود: ${state.uploadedChunks} از ${state.totalChunks} تکه (${percent}%)`;
              }
              if (state.status === 'processing') {
                await sendSimple(chatId, `🔄 وضعیت: در حال پردازش...${progress}`, TOKEN);
              } else if (state.status === 'waiting') {
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
              } else if (state.status === 'done') {
                await sendSimple(chatId, `✅ فایل شما آماده است!\n\n🔗 لینک دانلود: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${state.branchName}.zip\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» پاک کنید.`, TOKEN);
              } else if (state.status === 'awaiting_password') {
                await sendSimple(chatId, "🔐 منتظر رمز عبور هستم. لطفاً رمز خود را ارسال کنید.", TOKEN);
              } else {
                await sendSimple(chatId, "هیچ درخواست فعالی ندارید.", TOKEN);
              }
            } catch (err) { console.error(err); await sendSimple(chatId, "⚠️ خطا در دریافت وضعیت. لطفاً بعداً تلاش کنید.", TOKEN); }
          }
          else if (data === 'delete_my_file') {
            try {
              const lastBranch = await dbGetLastBranch(env, chatId);
              if (!lastBranch) {
                await sendSimple(chatId, "❌ هیچ فایل فعالی برای حذف یافت نشد.", TOKEN);
                return;
              }
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
                await sendSimple(chatId, "✅ فایل شما از سرور حذف شد. سپاس از همکاری شما.", TOKEN);
              } else {
                await sendSimple(chatId, "❌ خطا در حذف فایل. لطفاً بعداً تلاش کنید.", TOKEN);
              }
            } catch (err) { console.error(err); await sendSimple(chatId, "⚠️ خطا در حذف فایل. لطفاً بعداً تلاش کنید.", TOKEN); }
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
              await sendSimple(chatId, `⭐️ وضعیت اشتراک Pro شما\n\n✅ فعال\n📅 تاریخ انقضا: ${expireDate}\n\n💡 برای تمدید، مجدداً روی دکمه Pro کلیک کنید.`, TOKEN);
            } else {
              const amountUSD = parseFloat(env.PRO_PRICE) || 5;
              const invoice = await createNowPaymentsInvoice(env, chatId, amountUSD);
              if (invoice.success) {
                const proKeyboard = {
                  inline_keyboard: [
                    [{ text: "💰 پرداخت با ارز دیجیتال", url: invoice.invoiceUrl }],
                    [{ text: "🔙 بازگشت", callback_data: "stats" }]
                  ]
                };
                await sendMessage(chatId, 
                  `⭐️ <b>عضویت ویژه (Pro)</b>\n\n` +
                  `با فعال‌سازی اشتراک Pro از مزایای زیر بهره‌مند شوید:\n` +
                  `• 🔥 فایل‌های شما تا <b>۳ روز</b> روی سرور می‌ماند\n` +
                  `• 🚀 اولویت بالاتر در صف پردازش\n` +
                  `• 💖 پشتیبانی ویژه\n\n` +
                  `💰 هزینه اشتراک یک ماهه: <b>${amountUSD} دلار</b> (معادل حدود ${(amountUSD/5).toFixed(2)} TON)\n\n` +
                  `⚠️ پس از پرداخت، اشتراک شما به طور خودکار فعال می‌شود.`,
                  proKeyboard, TOKEN);
              } else { await sendSimple(chatId, `❌ خطا در ایجاد فاکتور پرداخت. لطفاً بعداً تلاش کنید.`, TOKEN); }
            }
          }
          return new Response('OK');
        }

        // ========== پیام متنی ==========
        if (update.message?.text) {
          const chatId = update.message.chat.id.toString();
          const text = update.message.text.trim();
          
          // دستور /resetstats (ریست کامل صف و پردازش‌ها)
          if (text.startsWith('/resetstats')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              await env.DB.prepare('DELETE FROM queue').run();
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'processing').run();
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'waiting').run();
              await this.finishTask(env);
              await sendSimple(chatId, "✅ آمار پردازش‌های فعال و صف بازنشانی شد. صف در حال پردازش است.", TOKEN);
            } else { await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN); }
            return new Response('OK');
          }
          
          // دستور /fixactive (فقط لغو processingهای گیر کرده و شروع صف)
          if (text === '/fixactive') {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              const processingUsers = await env.DB.prepare('SELECT COUNT(*) as count FROM user_state WHERE status = ?').bind('processing').first();
              const count = processingUsers?.count || 0;
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'processing').run();
              await this.finishTask(env);
              await sendSimple(chatId, `✅ ${count} رکورد پردازش گیر کرده لغو شد. صف در حال پردازش است.`, TOKEN);
            } else { await sendSimple(chatId, "❌ دسترسی غیرمجاز. توکن اشتباه است.", TOKEN); }
            return new Response('OK');
          }
          
          // دستور /startqueue (فقط شروع صف بدون تغییر در پردازش‌ها)
          if (text === '/startqueue') {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              await this.finishTask(env);
              await sendSimple(chatId, "✅ صف مجدداً راه‌اندازی شد.", TOKEN);
            } else { await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN); }
            return new Response('OK');
          }
          
          if (text === '/start') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            const welcome = `🌀 <b>به ربات دانلودر خوش آمدید</b> 🌀\n\n` +
              `لینک مستقیم فایل را بفرستید تا لینک قابل دانلود در اینترنت ملی دریافت کنید.\n\n` +
              `🔹 برای دریافت لینک مستقیم فایل تلگرام، فایل را به @filesto_bot فوروارد کنید.\n\n` +
              `⭐️ <b>عضویت Pro</b>\nبرای پردازش بدون صف و اولویت بالاتر، روی دکمه «⭐️ عضویت Pro» کلیک کنید.\n\n` +
              `⚠️ <b>هشدار امنیتی:</b>\n` +
              `فایل‌ها در مخزن عمومی گیت‌هاب ذخیره می‌شوند. با وجود رمزنگاری، از ارسال فایل‌های شخصی خودداری کنید.\n\n` +
              `⚠️ <b>مدیریت حجم مخزن:</b>\n` +
              `• پس از دانلود، حتماً روی دکمه «🗑️ حذف فایل من» کلیک کنید تا فایل پاک شود.\n` +
              `• این کار به همه اجازه می‌دهد از سرویس استفاده کنند.\n\n` +
              `⚠️ لینک دانلود برای کاربران عادی ۳ ساعت و برای کاربران Pro ۳ روز معتبر است.\n\n` +
              `📢 حمایت: @maramivpn`;
            await sendMessage(chatId, welcome, MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // دریافت لینک جدید
          if (text.match(/^https?:\/\//)) {
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
            const repoSize = await getRepoSize(env);
            if (repoSize >= REPO_SIZE_LIMIT_GB) {
              await sendSimple(chatId, `❌ حجم مخزن به حد مجاز (${REPO_SIZE_LIMIT_GB} گیگابایت) رسیده. لطفاً چند ساعت بعد تلاش کنید.`, TOKEN);
              return new Response('OK');
            } else if (repoSize >= REPO_SIZE_WARNING_GB) {
              await sendSimple(chatId, `⚠️ هشدار: حجم مخزن نزدیک به حد مجاز (${repoSize.toFixed(1)} از ${REPO_SIZE_LIMIT_GB} گیگابایت). پس از دانلود، فایل را حذف کنید.`, TOKEN);
            }
            const fileSize = await getFileSize(text);
            if (fileSize && fileSize > 2 * 1024 * 1024 * 1024) {
              await sendSimple(chatId, "❌ حجم فایل بیشتر از ۲ گیگابایت است. لطفاً فایل کوچک‌تری انتخاب کنید.", TOKEN);
              return new Response('OK');
            }
            await dbSetUserState(env, chatId, 'awaiting_password', { url: text, fileSize: fileSize || 0 });
            const cancelKeyboard = { inline_keyboard: [[{ text: "❌ لغو عملیات", callback_data: "cancel_input" }]] };
            await sendMessage(chatId, "✅ لینک دریافت شد.\n🔐 رمز عبور ZIP را وارد کنید:\n(این رمز برای باز کردن فایل نهایی لازم است، حتماً آن را حفظ کنید.)", cancelKeyboard, TOKEN);
            return new Response('OK');
          }

          // مرحله رمز عبور
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
              await sendSimple(chatId, "📤 درخواست به گیت‌هاب ارسال شد. منتظر شروع پردازش...\n(برای فایل‌های حجیم، ممکن است ۳۰-۴۰ دقیقه طول بکشد)", TOKEN);
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
