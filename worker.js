// ==========================================
// ربات دانلودر - نسخه نهایی با D1 (بدون KV)
// ==========================================

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📥 لینک جدید", callback_data: "new_link" }],
    [{ text: "📊 آمار لحظه‌ای", callback_data: "stats" }, { text: "📊 وضعیت من", callback_data: "status" }],
    [{ text: "❓ راهنما", callback_data: "help" }, { text: "🗑️ حذف فایل من", callback_data: "delete_my_file" }],
    [{ text: "🚫 لغو درخواست", callback_data: "cancel" }]
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

let statsCache = { data: null, expires: 0 };
let userCheckCache = new Map();

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

// ========== توابع کمکی D1 ==========
async function dbGetUser(env, chatId) {
  const stmt = await env.DB.prepare('SELECT * FROM users WHERE chat_id = ?').bind(chatId);
  const { results } = await stmt.all();
  return results[0];
}
async function dbAddUser(env, chatId) {
  const now = Date.now();
  await env.DB.prepare('INSERT OR IGNORE INTO users (chat_id, first_seen) VALUES (?, ?)').bind(chatId, now).run();
  // بدست آوردن تعداد کل کاربران
  const { results } = await env.DB.prepare('SELECT COUNT(*) as count FROM users').all();
  return results[0].count;
}
async function dbGetGlobalStats(env) {
  const { results } = await env.DB.prepare('SELECT total_links, total_volume_gb FROM global_stats WHERE id = 1').all();
  if (results.length === 0) return { total_links: 0, total_volume_gb: 0 };
  return results[0];
}
async function dbIncrementLinks(env, volumeGB) {
  await env.DB.prepare('UPDATE global_stats SET total_links = total_links + 1, total_volume_gb = total_volume_gb + ? WHERE id = 1').bind(volumeGB).run();
}
async function dbGetUserState(env, chatId) {
  const { results } = await env.DB.prepare('SELECT status, request_data, branch_name, started_at, total_chunks, uploaded_chunks FROM user_state WHERE chat_id = ?').bind(chatId).all();
  if (results.length === 0) return null;
  const row = results[0];
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
  const { results } = await env.DB.prepare('SELECT COUNT(*) as count FROM queue').all();
  return results[0].count;
}
async function dbGetQueueList(env) {
  const { results } = await env.DB.prepare('SELECT position, chat_id, file_url, zip_password, file_size, need_cleanup FROM queue ORDER BY position').all();
  return results.map(r => ({
    position: r.position,
    chatId: r.chat_id,
    fileUrl: r.file_url,
    password: r.zip_password,
    fileSize: r.file_size,
    needCleanup: r.need_cleanup === 1
  }));
}
async function dbAddQueue(env, chatId, fileUrl, password, fileSize, needCleanup = false) {
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO queue (chat_id, file_url, zip_password, file_size, need_cleanup, enqueued_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(chatId, fileUrl, password, fileSize, needCleanup ? 1 : 0, now).run();
}
async function dbPopQueue(env) {
  // ابتدا اولین ردیف را بگیریم
  const { results } = await env.DB.prepare('SELECT position, chat_id, file_url, zip_password, file_size, need_cleanup FROM queue ORDER BY position LIMIT 1').all();
  if (results.length === 0) return null;
  const row = results[0];
  await env.DB.prepare('DELETE FROM queue WHERE position = ?').bind(row.position).run();
  return {
    chatId: row.chat_id,
    fileUrl: row.file_url,
    password: row.zip_password,
    fileSize: row.file_size,
    needCleanup: row.need_cleanup === 1
  };
}
async function dbRemoveFromQueue(env, chatId) {
  await env.DB.prepare('DELETE FROM queue WHERE chat_id = ?').bind(chatId).run();
}
async function dbGetActiveCount(env) {
  const { results } = await env.DB.prepare('SELECT COUNT(*) as count FROM user_state WHERE status = ?').bind('processing').all();
  return results[0].count;
}
async function dbGetActiveBranchesCount(env) {
  const { results } = await env.DB.prepare('SELECT COUNT(*) as count FROM active_branches').all();
  return results[0].count;
}
async function dbAddActiveBranch(env, branchName, chatId, createdAt) {
  await env.DB.prepare('INSERT OR REPLACE INTO active_branches (branch_name, chat_id, created_at) VALUES (?, ?, ?)').bind(branchName, chatId, createdAt).run();
}
async function dbRemoveActiveBranch(env, branchName) {
  await env.DB.prepare('DELETE FROM active_branches WHERE branch_name = ?').bind(branchName).run();
}
async function dbGetLastBranch(env, chatId) {
  const { results } = await env.DB.prepare('SELECT branch_name FROM active_branches WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1').bind(chatId).all();
  if (results.length === 0) return null;
  return results[0].branch_name;
}
async function dbSetBranchForUser(env, chatId, branchName) {
  // ثبت شاخه جدید و حذف شاخه قبلی – اما برای حذف قبلی باید با cron انجام شود. فعلاً فقط ثبت می‌کنیم
  const now = Date.now();
  await dbAddActiveBranch(env, branchName, chatId, now);
  // به‌روزرسانی user_state برای ذکر branch_name فعلی
  await env.DB.prepare('UPDATE user_state SET branch_name = ? WHERE chat_id = ?').bind(branchName, chatId).run();
}
async function dbGetTotalVolume(env) {
  const { results } = await env.DB.prepare('SELECT total_volume_gb FROM global_stats WHERE id = 1').all();
  return results[0]?.total_volume_gb || 0;
}

// ========== بقیه توابع ==========
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

    // --- API endpoints (بدون تغییر زیاد، فقط جایگزینی KV با D1) ---
    if (path === '/api/started' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        // به‌روزرسانی شروع پردازش در user_state
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
        // به‌روزرسانی وضعیت کاربر به done و ذخیره branch
        await env.DB.prepare('UPDATE user_state SET status = ?, branch_name = ? WHERE chat_id = ?').bind('done', branch, chatId).run();
        await dbSetBranchForUser(env, chatId, branch);
        // افزایش آمار کلی
        const requestDataRow = await env.DB.prepare('SELECT request_data FROM user_state WHERE chat_id = ?').bind(chatId).first();
        let fileSizeBytes = 0;
        if (requestDataRow && requestDataRow.request_data) {
          const req = JSON.parse(requestDataRow.request_data);
          fileSizeBytes = req.fileSize || 0;
        }
        const volumeGB = fileSizeBytes / (1024 * 1024 * 1024);
        await dbIncrementLinks(env, volumeGB);
        statsCache.expires = 0;
        const password = requestDataRow ? (JSON.parse(requestDataRow.request_data)?.password || '') : '';
        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        const helpExtract = `\n\n📌 <b>نحوه استخراج فایل:</b>\nپس از دانلود، فایل ZIP را باز کنید. داخل پوشه استخراج شده، چند فایل با پسوند .001، .002 و ... می‌بینید. با نرم‌افزار <b>7-Zip</b> یا <b>WinRAR</b>، روی فایل <b>archive.7z.001</b> کلیک کرده و گزینه استخراج (Extract) را انتخاب کنید. نرم‌افزار به صورت خودکار تمام تکه‌ها را به هم چسبانده و فایل اصلی شما را با همان فرمت اولیه تحویل می‌دهد.`;
        await sendSimple(chatId, `✅ <b>فایل شما آماده شد!</b>\n\n🔗 لینک دانلود (تا ۳ ساعت معتبر):\n${link}\n\n⚠️ رمز عبور: <code>${password}</code>${helpExtract}\n\n📌 این لینک با اینترنت ملی و بدون فیلترشکن قابل دانلود است.\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» فایل را از سرور پاک کنید تا دیگران هم بتوانند از سرویس استفاده کنند.`, TOKEN);
        await env.DB.prepare('DELETE FROM user_state WHERE chat_id = ?').bind(chatId).run(); // پاک کردن user_state
        await this.finishTask(env);
      }
      return new Response('OK');
    }
    if (path === '/api/failed' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await env.DB.prepare('DELETE FROM user_state WHERE chat_id = ?').bind(chatId).run();
        await this.finishTask(env);
        await sendSimple(chatId, "❌ پردازش فایل شما با خطا مواجه شد. لطفاً دوباره تلاش کنید.", TOKEN);
      }
      return new Response('OK');
    }
    if (path === '/api/cleanup' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await env.DB.prepare('DELETE FROM user_state WHERE chat_id = ?').bind(chatId).run();
        await env.DB.prepare('DELETE FROM queue WHERE chat_id = ?').bind(chatId).run();
      }
      return new Response('OK');
    }

    // ========== Webhook اصلی تلگرام ==========
    if (path === `/bot${TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();

        // به روز رسانی آمار کاربران (اولین بار)
        if (update.message?.chat?.id) {
          const exists = await dbGetUser(env, update.message.chat.id.toString());
          if (!exists) {
            const total = await dbAddUser(env, update.message.chat.id.toString());
            statsCache.expires = 0;
          }
        }
        if (update.callback_query?.message?.chat?.id) {
          const exists = await dbGetUser(env, update.callback_query.message.chat.id.toString());
          if (!exists) {
            await dbAddUser(env, update.callback_query.message.chat.id.toString());
            statsCache.expires = 0;
          }
        }

        // ===== دکمه‌ها =====
        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = cb.message.chat.id.toString();
          const data = cb.data;
          await answerCallback(cb.id, TOKEN);

          if (data === 'help') {
            const helpText = `📘 <b>راهنمای ربات</b>\n\n` +
              `این ربات لینک مستقیم فایل را به لینک قابل دانلود در <b>اینترنت ملی</b> تبدیل می‌کند.\n\n` +
              `🔹 <b>نحوه استفاده:</b>\n` +
              `1️⃣ اگر لینک مستقیم ندارید، فایل خود را به ربات <code>@filesto_bot</code> فوروارد کنید.\n` +
              `2️⃣ لینک مستقیم را در همین ربات ارسال کنید. (توجه: با ارسال لینک جدید، درخواست قبلی شما در هر مرحله که باشد به صورت خودکار لغو می‌شود.)\n` +
              `3️⃣ یک رمز عبور دلخواه برای فایل ZIP وارد کنید.\n` +
              `4️⃣ منتظر بمانید تا پردازش شود (لینک خودکار ارسال می‌شود).\n` +
              `5️⃣ پس از دانلود، روی دکمه <b>«🗑️ حذف فایل من»</b> کلیک کنید تا فایل از سرور حذف شود و دیگران هم بتوانند استفاده کنند.\n\n` +
              `🔹 <b>نحوه استخراج فایل پس از دانلود:</b>\n` +
              `• فایل ZIP دانلود شده را با نرم‌افزارهایی مثل <b>7-Zip</b> یا <b>WinRAR</b> باز کنید.\n` +
              `• داخل پوشه استخراج شده، فایل‌هایی با پسوند <code>.001</code>، <code>.002</code> و ... می‌بینید.\n` +
              `• روی فایل <b>archive.7z.001</b> کلیک کرده و گزینه <b>Extract Here</b> (یا استخراج در اینجا) را انتخاب کنید.\n` +
              `• نرم‌افزار به صورت خودکار تمام تکه‌ها را به هم چسبانده و فایل اصلی شما را با همان فرمت اولیه تحویل می‌دهد.\n\n` +
              `⚠️ <b>توجه امنیتی:</b>\n` +
              `• فایل‌ها در یک مخزن عمومی گیت‌هاب ذخیره می‌شوند. با وجود رمزنگاری ZIP، از ارسال فایل‌های شخصی و مهم خودداری کنید.\n` +
              `• لینک دانلود تا ۳ ساعت معتبر است و پس از آن فایل حذف می‌شود.\n` +
              `• حجم فایل نباید بیشتر از ۲ گیگابایت باشد.\n` +
              `• از ارسال فایل‌های مستهجن خودداری کنید تا ریپازوتری بن نشود.\n\n` +
              `❤️ <b>حمایت:</b> عضو کانال ما شوید: @maramivpn`;
            await sendSimple(chatId, helpText, TOKEN);
          }
          else if (data === 'stats') {
            await sendSimple(chatId, "📊 در حال آماده سازی آمار...", TOKEN);
            (async () => {
              try {
                const stats = await dbGetGlobalStats(env);
                const activeCount = await dbGetActiveCount(env);
                const queueCount = await dbGetQueueCount(env);
                const totalBranches = await dbGetActiveBranchesCount(env);
                const totalUsers = (await env.DB.prepare('SELECT COUNT(*) as count FROM users').first()).count;
                const repoSize = await getRepoSize(env);
                const sizeMsg = repoSize ? `\n📦 حجم مخزن: ${repoSize.toFixed(1)} گیگابایت` : '';
                await sendSimple(chatId, `📊 <b>آمار لحظه‌ای ربات</b>\n\n👥 کاربران کل: ${totalUsers}\n🔄 در حال پردازش: ${activeCount}\n⏳ در صف انتظار: ${queueCount}\n🔗 کل لینک‌های ملی ساخته شده: ${stats.total_links}\n💾 حجم کل فایل‌های دانلود شده: ${stats.total_volume_gb.toFixed(2)} گیگابایت${sizeMsg}\n\n📢 @maramivpn`, TOKEN);
              } catch (err) {
                console.error('Stats error:', err);
                await sendSimple(chatId, "⚠️ در حال حاضر امکان دریافت آمار وجود ندارد. لطفاً چند دقیقه دیگر تلاش کنید.", TOKEN);
              }
            })().catch(e => console.error(e));
          }
          else if (data === 'status') {
            await sendSimple(chatId, "📊 در حال آماده سازی وضعیت...", TOKEN);
            (async () => {
              try {
                const state = await dbGetUserState(env, chatId);
                if (!state) {
                  await sendSimple(chatId, "هیچ درخواست فعالی ندارید.", TOKEN);
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
                  // پیدا کردن جایگاه در صف
                  const queuePos = await env.DB.prepare('SELECT COUNT(*) as pos FROM queue WHERE position <= (SELECT position FROM queue WHERE chat_id = ?)').bind(chatId).first();
                  const pos = queuePos ? queuePos.pos : '?';
                  await sendSimple(chatId, `⏳ وضعیت: در صف انتظار (شماره صف: ${pos})`, TOKEN);
                } else if (state.status === 'done') {
                  await sendSimple(chatId, `✅ فایل شما آماده است!\n\n🔗 لینک دانلود: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${state.branchName}.zip\n\n🗑️ پس از دانلود، از دکمه «حذف فایل من» برای پاک کردن آن استفاده کنید.`, TOKEN);
                } else {
                  await sendSimple(chatId, "هیچ درخواست فعالی ندارید.", TOKEN);
                }
              } catch (err) {
                console.error('Status error:', err);
                await sendSimple(chatId, "⚠️ امکان دریافت وضعیت وجود ندارد. لطفاً چند دقیقه دیگر تلاش کنید.", TOKEN);
              }
            })().catch(e => console.error(e));
          }
          else if (data === 'new_link') {
            // پاک کردن وضعیت قبلی کاربر
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            await sendSimple(chatId, "✅ درخواست قبلی شما لغو شد. اکنون لینک جدید را ارسال کنید.\n(برای دریافت لینک مستقیم فایل تلگرام، فایل را به @filesto_bot فوروارد کنید)", TOKEN);
          }
          else if (data === 'delete_my_file') {
            await sendSimple(chatId, "🗑️ در حال آماده سازی حذف فایل...", TOKEN);
            (async () => {
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
                  await sendSimple(chatId, "✅ فایل شما از سرور حذف شد. با تشکر از همکاری شما برای مدیریت حجم مخزن.", TOKEN);
                } else {
                  await sendSimple(chatId, "❌ فایل قبلاً حذف شده یا یافت نشد.", TOKEN);
                }
              } catch (err) {
                console.error(err);
                await sendSimple(chatId, "⚠️ امکان حذف فایل وجود ندارد. لطفاً چند دقیقه دیگر تلاش کنید.", TOKEN);
              }
            })().catch(e => console.error(e));
          }
          else if (data === 'cancel' || data === 'cancel_input') {
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            await sendSimple(chatId, "❌ عملیات لغو شد.", TOKEN);
          }
          return new Response('OK');
        }

        // ========== پیام متنی ==========
        if (update.message?.text) {
          const chatId = update.message.chat.id.toString();
          const text = update.message.text.trim();
          if (text.startsWith('/resetstats')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              // ریست کردن آمار (تنظیم مجدد activeCount, queue)
              await env.DB.prepare('DELETE FROM queue').run();
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'processing').run();
              await env.DB.prepare('UPDATE user_state SET status = ? WHERE status = ?').bind('cancelled', 'waiting').run();
              statsCache.expires = 0;
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
              `لینک مستقیم فایل را بفرستید تا لینک قابل دانلود در <b>اینترنت ملی</b> دریافت کنید.\n\n` +
              `🔹 برای دریافت لینک مستقیم فایل تلگرام، فایل را به @filesto_bot فوروارد کنید.\n\n` +
              `⚠️ <b>هشدار امنیتی:</b>\n` +
              `فایل‌های شما در یک مخزن <b>عمومی</b> گیت‌هاب ذخیره می‌شوند. با وجود رمزنگاری ZIP، از ارسال فایل‌های شخصی و مهم خودداری کنید.\n\n` +
              `⚠️ <b>مدیریت حجم مخزن:</b>\n` +
              `• پس از دانلود فایل خود، حتماً روی دکمه <b>«🗑️ حذف فایل من»</b> کلیک کنید تا فایل از سرور پاک شود.\n` +
              `• این کار به همه اجازه می‌دهد از سرویس استفاده کنند و حجم مخزن کنترل شود.\n\n` +
              `⚠️ لینک دانلود تا ۳ ساعت معتبر است و پس از آن فایل حذف می‌شود.\n\n` +
              `📢 حمایت: @maramivpn`;
            await sendMessage(chatId, welcome, MAIN_KEYBOARD, TOKEN);
            return new Response('OK');
          }

          // دریافت لینک جدید
          if (text.match(/^https?:\/\//)) {
            // پاکسازی وضعیت قبلی کاربر
            await dbDeleteUserState(env, chatId);
            await dbRemoveFromQueue(env, chatId);
            // حذف شاخه قبلی گیت‌هاب
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
              await sendSimple(chatId, `❌ حجم مخزن به حد مجاز (${REPO_SIZE_LIMIT_GB} گیگابایت) رسیده است. لطفاً چند ساعت بعد تلاش کنید.`, TOKEN);
              return new Response('OK');
            } else if (repoSize >= REPO_SIZE_WARNING_GB) {
              await sendSimple(chatId, `⚠️ هشدار: حجم مخزن نزدیک به حد مجاز است (${repoSize.toFixed(1)} از ${REPO_SIZE_LIMIT_GB} گیگابایت). پس از دانلود، فایل خود را حذف کنید.`, TOKEN);
            }
            const fileSize = await getFileSize(text);
            if (fileSize && fileSize > 2 * 1024 * 1024 * 1024) {
              await sendSimple(chatId, "❌ حجم فایل بیشتر از ۲ گیگابایت است. لطفاً فایل کوچک‌تری انتخاب کنید.", TOKEN);
              return new Response('OK');
            }
            // ذخیره state برای مرحله رمز عبور
            await dbSetUserState(env, chatId, 'awaiting_password', { url: text, fileSize: fileSize || 0 });
            const cancelKeyboard = { inline_keyboard: [[{ text: "❌ لغو عملیات", callback_data: "cancel_input" }]] };
            await sendMessage(chatId, "✅ لینک دریافت شد.\n🔐 رمز عبور ZIP را وارد کنید:\n(این رمز برای باز کردن فایل نهایی لازم است، حتماً آن را حفظ کنید.)", cancelKeyboard, TOKEN);
            return new Response('OK');
          }

          // مرحله رمز عبور
          const state = await dbGetUserState(env, chatId);
          if (state && state.status === 'awaiting_password') {
            const password = text;
            const fileUrl = state.requestData.url;
            const fileSize = state.requestData.fileSize || 0;
            // حذف state موقت
            await dbDeleteUserState(env, chatId);
            // اضافه کردن به صف یا اجرای مستقیم
            let activeCount = await dbGetActiveCount(env);
            let queueCount = await dbGetQueueCount(env);
            if (activeCount < MAX_CONCURRENT) {
              // شروع مستقیم
              await dbSetUserState(env, chatId, 'processing', { url: fileUrl, password: password, fileSize: fileSize });
              await this.runTaskWithRetry(chatId, fileUrl, password, env, TOKEN).catch(e => console.error(e));
              await sendSimple(chatId, "📤 درخواست به گیت‌هاب ارسال شد. منتظر شروع پردازش...\n(برای فایل‌های حجیم، ممکن است ۳۰-۴۰ دقیقه طول بکشد)", TOKEN);
            } else {
              // اضافه به صف
              await dbAddQueue(env, chatId, fileUrl, password, fileSize);
              await dbSetUserState(env, chatId, 'waiting', { url: fileUrl, password: password, fileSize: fileSize });
              await sendSimple(chatId, `⏳ در صف قرار گرفتید. شماره صف: ${queueCount + 1}`, TOKEN);
            }
            return new Response('OK');
          }

          // اگر هیچکدام نبود
          await sendSimple(chatId, "❌ لینک معتبر نیست (با http:// یا https:// شروع شود).", TOKEN);
          return new Response('OK');
        }
        return new Response('OK');
      } catch (err) {
        console.error(err);
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
        await sendSimple(chatId, `⚠️ تلاش ${retry} ناموفق بود. تلاش مجدد در ${RETRY_INTERVAL/1000} ثانیه...`, TOKEN);
        await new Promise(r => setTimeout(r, RETRY_INTERVAL));
      }
    }
    if (!workflowSent) {
      await sendSimple(chatId, "❌ پس از تلاش، درخواست به گیت‌هاب ارسال نشد. لطفاً دوباره تلاش کنید.", TOKEN);
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
      await sendSimple(chatId, "⚠️ پردازش شروع نشد. ممکن است سرور شلوغ باشد. لطفاً با دکمه «وضعیت من» بعداً پیگیری کنید.", TOKEN);
    }
    let branch = null;
    for (let i = 0; i < MAX_WAIT_CYCLES; i++) {
      await new Promise(r => setTimeout(r, WAIT_INTERVAL));
      const state = await dbGetUserState(env, chatId);
      if (state && state.branchName) { branch = state.branchName; break; }
    }
    if (!branch) {
      console.error(`Timeout waiting for branch for ${chatId}`);
      await sendSimple(chatId, `❌ زمان انتظار برای پردازش فایل (${TASK_TIMEOUT/60000} دقیقه) به پایان رسید. لطفاً بعداً با دکمه «وضعیت من» بررسی کنید.`, TOKEN);
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
    // گرفتن اولین آیتم از صف و شروع آن
    const next = await dbPopQueue(env);
    if (next) {
      await dbSetUserState(env, next.chatId, 'processing', { url: next.fileUrl, password: next.password, fileSize: next.fileSize });
      await this.runTaskWithRetry(next.chatId, next.fileUrl, next.password, env, this.TOKEN).catch(e => console.error(e));
      // ارسال پیام به کاربر که از صف خارج شده
      await sendSimple(next.chatId, "🔄 نوبت شما رسید! در حال شروع پردازش فایل...", env.TELEGRAM_TOKEN);
    }
  }
};
