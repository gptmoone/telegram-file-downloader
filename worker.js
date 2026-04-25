// ==========================================
// ربات دانلودر - نسخه نهایی با رفع تکراری پیام‌ها
// ==========================================

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📥 لینک جدید", callback_data: "new_link" }],
    [{ text: "📊 آمار لحظه‌ای", callback_data: "stats" }, { text: "📊 وضعیت من", callback_data: "status" }],
    [{ text: "❓ راهنما", callback_data: "help" }, { text: "🗑️ حذف فایل من", callback_data: "delete_my_file" }]
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

// کش برای جلوگیری از اجرای مجدد یک دکمه در 3 ثانیه
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
async function dbGetQueueCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) as count FROM queue').first();
  return row?.count || 0;
}
async function dbAddQueue(env, chatId, fileUrl, password, fileSize) {
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO queue (chat_id, file_url, zip_password, file_size, enqueued_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(chatId, fileUrl, password, fileSize, now).run();
}
async function dbPopQueue(env) {
  const row = await env.DB.prepare('SELECT position, chat_id, file_url, zip_password, file_size FROM queue ORDER BY position LIMIT 1').first();
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
async function dbGetUsersCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
  return row?.count || 0;
}
async function dbAddUser(env, chatId) {
  const now = Date.now();
  await env.DB.prepare('INSERT OR IGNORE INTO users (chat_id, first_seen) VALUES (?, ?)').bind(chatId, now).run();
}
async function dbGetActiveCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) as count FROM user_state WHERE status = ?').bind('processing').first();
  return row?.count || 0;
}
async function dbGetActiveBranchesCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) as count FROM active_branches').first();
  return row?.count || 0;
}
async function dbAddActiveBranch(env, branchName, chatId, createdAt) {
  await env.DB.prepare('INSERT OR REPLACE INTO active_branches (branch_name, chat_id, created_at) VALUES (?, ?, ?)').bind(branchName, chatId, createdAt).run();
}
async function dbRemoveActiveBranch(env, branchName) {
  await env.DB.prepare('DELETE FROM active_branches WHERE branch_name = ?').bind(branchName).run();
}
async function dbGetLastBranch(env, chatId) {
  const row = await env.DB.prepare('SELECT branch_name FROM active_branches WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1').bind(chatId).first();
  return row?.branch_name || null;
}
async function dbSetBranchForUser(env, chatId, branchName) {
  const now = Date.now();
  await dbAddActiveBranch(env, branchName, chatId, now);
  await env.DB.prepare('UPDATE user_state SET branch_name = ? WHERE chat_id = ?').bind(branchName, chatId).run();
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

    // API endpoints
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
        await env.DB.prepare('UPDATE user_state SET status = ?, branch_name = ? WHERE chat_id = ?').bind('done', branch, chatId).run();
        await dbSetBranchForUser(env, chatId, branch);
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
        const helpExtract = `\n\n📌 <b>نحوه استخراج فایل:</b>\nپس از دانلود فایل ZIP، با 7-Zip یا WinRAR فایل archive.7z.001 را استخراج کنید.`;
        await sendSimple(chatId, `✅ <b>فایل شما آماده شد!</b>\n\n🔗 لینک دانلود (۳ ساعت معتبر):\n${link}\n\n⚠️ رمز عبور: <code>${password}</code>${helpExtract}\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» فایل را از سرور پاک کنید.`, TOKEN);
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

    // وب‌هوک اصلی
    if (path === `/bot${TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();

        // ثبت کاربر جدید
        if (update.message?.chat?.id) await dbAddUser(env, update.message.chat.id.toString());
        if (update.callback_query?.message?.chat?.id) await dbAddUser(env, update.callback_query.message.chat.id.toString());

        // دکمه‌ها
        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = cb.message.chat.id.toString();
          const data = cb.data;
          const callbackId = cb.id;

          // جلوگیری از پردازش مجدد یک دکمه در 3 ثانیه
          const now = Date.now();
          const lastTime = lastCallbackProcessed.get(`${chatId}_${data}`) || 0;
          if (now - lastTime < 3000) {
            return new Response('OK'); // تکراری، نادیده بگیر
          }
          lastCallbackProcessed.set(`${chatId}_${data}`, now);

          // پاسخ فوری به تلگرام (ابتدا)
          await answerCallback(callbackId, TOKEN);

          // راهنما
          if (data === 'help') {
            const helpText = `📘 <b>راهنمای ربات</b>\n\n` +
              `این ربات لینک مستقیم را به لینک قابل دانلود در اینترنت ملی تبدیل می‌کند.\n\n` +
              `🔹 <b>نحوه استفاده:</b>\n` +
              `1️⃣ فایل خود را به @filesto_bot بدهید تا لینک مستقیم بگیرید.\n` +
              `2️⃣ لینک را در همین ربات ارسال کنید (درخواست قبلی خودکار لغو می‌شود).\n` +
              `3️⃣ رمز عبور دلخواه وارد کنید.\n` +
              `4️⃣ منتظر بمانید تا پردازش شود (لینک خودکار ارسال می‌شود).\n` +
              `5️⃣ پس از دانلود، روی دکمه «حذف فایل من» کلیک کنید.\n\n` +
              `🔹 <b>نحوه استخراج:</b>\n` +
              `فایل ZIP را با 7-Zip یا WinRAR باز کنید. فایل archive.7z.001 را استخراج کنید.\n\n` +
              `⚠️ <b>توجه:</b>\n` +
              `• مخزن عمومی است، فایل شخصی نفرستید.\n` +
              `• لینک دانلود ۳ ساعت معتبر است.\n` +
              `• حجم فایل حداکثر ۲ گیگابایت.\n` +
              `• از ارسال محتوای غیرمجاز خودداری کنید.\n\n` +
              `❤️ حمایت: @maramivpn`;
            await sendSimple(chatId, helpText, TOKEN);
          }
          // آمار
          else if (data === 'stats') {
            try {
              const stats = await dbGetGlobalStats(env);
              const activeCount = await dbGetActiveCount(env);
              const queueCount = await dbGetQueueCount(env);
              const totalBranches = await dbGetActiveBranchesCount(env);
              const totalUsers = await dbGetUsersCount(env);
              const repoSize = await getRepoSize(env);
              const sizeMsg = repoSize ? `\n📦 حجم مخزن: ${repoSize.toFixed(1)} گیگابایت` : '';
              let warningMsg = '';
              if (repoSize >= REPO_SIZE_LIMIT_GB) warningMsg = '\n\n⚠️ <b>هشدار: حجم مخزن پر است. لطفاً فایل‌های خود را حذف کنید.</b>';
              else if (repoSize >= REPO_SIZE_WARNING_GB) warningMsg = '\n\n⚠️ <b>هشدار: حجم مخزن نزدیک به حد مجاز است. پس از دانلود، فایل خود را حذف کنید.</b>';
              await sendSimple(chatId, `📊 <b>آمار لحظه‌ای ربات</b>\n\n👥 کاربران کل: ${totalUsers}\n🔄 در حال پردازش: ${activeCount}\n⏳ در صف انتظار: ${queueCount}\n🔗 لینک‌های ملی ساخته شده: ${stats.total_links}\n💾 حجم کل دانلود شده: ${stats.total_volume_gb.toFixed(2)} گیگابایت${sizeMsg}${warningMsg}\n\n📢 @maramivpn`, TOKEN);
            } catch (err) {
              console.error('Stats error:', err);
              await sendSimple(chatId, "⚠️ خطا در دریافت آمار. لطفاً چند دقیقه دیگر تلاش کنید.", TOKEN);
            }
          }
          // وضعیت من
          else if (data === 'status') {
            try {
              const state = await dbGetUserState(env, chatId);
              if (!state) {
                await sendSimple(chatId, "📭 هیچ درخواست فعالی ندارید.", TOKEN);
                return;
              }
              let progress = '';
              if (state.totalChunks && state.uploadedChunks) {
                const percent = Math.round(state.uploadedChunks / state.totalChunks * 100);
                progress = `\n📦 پیشرفت آپلود: ${state.uploadedChunks} از ${state.totalChunks} تکه (${percent}%)`;
              }
              if (state.status === 'processing') {
                await sendSimple(chatId, `🔄 وضعیت: در حال پردازش...${progress}`, TOKEN);
              } else if (state.status === 'waiting') {
                const posRow = await env.DB.prepare('SELECT COUNT(*) as pos FROM queue WHERE position <= (SELECT position FROM queue WHERE chat_id = ?)').bind(chatId).first();
                const pos = posRow ? posRow.pos : '?';
                await sendSimple(chatId, `⏳ وضعیت: در صف انتظار (شماره صف: ${pos})`, TOKEN);
              } else if (state.status === 'done') {
                await sendSimple(chatId, `✅ فایل شما آماده است!\n\n🔗 لینک دانلود: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${state.branchName}.zip\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» پاک کنید.`, TOKEN);
              } else if (state.status === 'awaiting_password') {
                await sendSimple(chatId, "🔐 منتظر رمز عبور هستم. لطفاً رمز خود را ارسال کنید.", TOKEN);
              } else {
                await sendSimple(chatId, "هیچ درخواست فعالی ندارید.", TOKEN);
              }
            } catch (err) {
              console.error('Status error:', err);
              await sendSimple(chatId, "⚠️ خطا در دریافت وضعیت. لطفاً بعداً تلاش کنید.", TOKEN);
            }
          }
          // حذف فایل من
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
              if (res.ok) {
                await dbRemoveActiveBranch(env, lastBranch);
                await sendSimple(chatId, "✅ فایل شما از سرور حذف شد. سپاس از همکاری شما.", TOKEN);
              } else {
                await sendSimple(chatId, "❌ فایل قبلاً حذف شده یا یافت نشد.", TOKEN);
              }
            } catch (err) {
              console.error('Delete error:', err);
              await sendSimple(chatId, "⚠️ خطا در حذف فایل. لطفاً بعداً تلاش کنید.", TOKEN);
            }
          }
          // لینک جدید
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
          return new Response('OK');
        }

        // پیام متنی
        if (update.message?.text) {
          const chatId = update.message.chat.id.toString();
          const text = update.message.text.trim();
          if (text.startsWith('/resetstats')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              await env.DB.prepare('DELETE FROM queue').run();
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'processing').run();
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'waiting').run();
              await sendSimple(chatId, "✅ آمار پردازش‌های فعال و صف بازنشانی شد.", TOKEN);
            } else {
              await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN);
            }
            return new Response('OK');
          }
          if (text === '/start') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            const welcome = `🌀 <b>به ربات دانلودر خوش آمدید</b> 🌀\n\n` +
              `لینک مستقیم فایل را بفرستید تا لینک قابل دانلود در اینترنت ملی دریافت کنید.\n\n` +
              `🔹 برای دریافت لینک مستقیم فایل تلگرام، فایل را به @filesto_bot فوروارد کنید.\n\n` +
              `⚠️ <b>هشدار امنیتی:</b>\n` +
              `فایل‌ها در مخزن عمومی گیت‌هاب ذخیره می‌شوند. با وجود رمزنگاری، از ارسال فایل‌های شخصی خودداری کنید.\n\n` +
              `⚠️ <b>مدیریت حجم مخزن:</b>\n` +
              `• پس از دانلود، حتماً روی دکمه «🗑️ حذف فایل من» کلیک کنید تا فایل پاک شود.\n` +
              `• این کار به همه اجازه می‌دهد از سرویس استفاده کنند.\n\n` +
              `⚠️ لینک دانلود تا ۳ ساعت معتبر است.\n\n` +
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
            await dbDeleteUserState(env, chatId);
            const activeCount = await dbGetActiveCount(env);
            const queueCount = await dbGetQueueCount(env);
            if (activeCount < MAX_CONCURRENT) {
              await dbSetUserState(env, chatId, 'processing', { url: fileUrl, password: password, fileSize: fileSize });
              this.runTaskWithRetry(chatId, fileUrl, password, env, TOKEN).catch(e => console.error(e));
              await sendSimple(chatId, "📤 درخواست به گیت‌هاب ارسال شد. منتظر شروع پردازش...\n(برای فایل‌های حجیم، ممکن است ۳۰-۴۰ دقیقه طول بکشد)", TOKEN);
            } else {
              await dbAddQueue(env, chatId, fileUrl, password, fileSize);
              await dbSetUserState(env, chatId, 'waiting', { url: fileUrl, password: password, fileSize: fileSize });
              await sendSimple(chatId, `⏳ در صف قرار گرفتید. شماره صف: ${queueCount + 1}`, TOKEN);
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
