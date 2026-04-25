// ==========================================
// ربات دانلودر نهایی - حذف کامل وابستگی KV از دکمه «لینک جدید»
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

// === توابع کمکی با timeout (فقط برای بخش‌های ضروری) ===
async function withTimeout(promise, ms, fallback = null) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('KV timeout')), ms);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('KV timeout/error:', err.message);
    return fallback;
  }
}
function safeKVGet(env, key, fallback = null) {
  return withTimeout(env.QUEUE.get(key), 1500, fallback);
}
function safeKVPut(env, key, value, options = {}) {
  return withTimeout(env.QUEUE.put(key, value, options), 1500, null);
}
function safeKVDelete(env, key) {
  return withTimeout(env.QUEUE.delete(key), 1500, null);
}

// ===== توابع اصلی =====
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

async function getStats(env) {
  const now = Date.now();
  if (statsCache.data && statsCache.expires > now) return statsCache.data;
  try {
    const [totalUsers, activeCount, queueListRaw, totalBranches, totalVolume] = await Promise.all([
      safeKVGet(env, 'totalUsers', 0),
      safeKVGet(env, 'activeCount', 0),
      safeKVGet(env, 'queueList', []),
      safeKVGet(env, 'totalBranches', 0),
      safeKVGet(env, 'totalVolume', 0)
    ]);
    let realActive = activeCount;
    if (realActive > MAX_CONCURRENT || realActive < 0) realActive = 0;
    if (realActive !== activeCount) await safeKVPut(env, 'activeCount', realActive);
    const result = {
      totalUsers: totalUsers || 0,
      activeCount: realActive,
      waiting: (queueListRaw || []).length,
      totalLinks: totalBranches || 0,
      totalVolume: totalVolume || 0
    };
    statsCache = { data: result, expires: now + 60000 };
    return result;
  } catch (err) {
    console.error('getStats error:', err);
    if (statsCache.data) return statsCache.data;
    return { totalUsers: 0, activeCount: 0, waiting: 0, totalLinks: 0, totalVolume: 0 };
  }
}

async function updateStats(env, chatId) {
  const now = Date.now();
  const lastCheck = userCheckCache.get(chatId) || 0;
  if (now - lastCheck < 300000) return;
  userCheckCache.set(chatId, now);
  try {
    let totalUsers = await safeKVGet(env, 'totalUsers', 0);
    let userRecord = await safeKVGet(env, `user_${chatId}`);
    if (!userRecord) {
      totalUsers++;
      await safeKVPut(env, `user_${chatId}`, '1');
      await safeKVPut(env, 'totalUsers', totalUsers);
      statsCache.expires = 0;
    }
  } catch (err) { console.error('updateStats error:', err); }
}

async function getFileSize(url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const size = head.headers.get('content-length');
    return size ? parseInt(size) : null;
  } catch { return null; }
}

async function deleteUserBranch(chatId, env, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO) {
  const branchName = await safeKVGet(env, `last_branch:${chatId}`);
  if (!branchName) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchName}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'CloudflareWorkerBot/1.0'
      }
    });
    if (res.ok) {
      await safeKVDelete(env, `last_branch:${chatId}`);
      statsCache.expires = 0;
      return true;
    }
  } catch (e) { console.error('Delete branch error:', e); }
  return false;
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

    // API endpoints (بدون تغییر)
    if (path === '/api/started' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await safeKVPut(env, `started:${chatId}`, Date.now().toString(), { expirationTtl: 3600 });
        await sendSimple(chatId, "🔄 پردازش فایل روی گیت‌هاب آغاز شد...", TOKEN);
      }
      return new Response('OK');
    }
    if (path === '/api/progress' && request.method === 'POST') {
      const { user_id, total_chunks, uploaded_chunks } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        if (total_chunks) await safeKVPut(env, `total_chunks:${chatId}`, total_chunks, { expirationTtl: 7200 });
        if (uploaded_chunks !== undefined) await safeKVPut(env, `uploaded_chunks:${chatId}`, uploaded_chunks, { expirationTtl: 7200 });
      }
      return new Response('OK');
    }
    if (path === '/api/complete' && request.method === 'POST') {
      const { user_id, branch } = await request.json();
      if (user_id && branch) {
        const chatId = user_id.split('_')[0];
        await safeKVPut(env, `branch:${chatId}`, branch, { expirationTtl: 10800 });
        await safeKVPut(env, `status:${chatId}`, 'done', { expirationTtl: 10800 });
        await safeKVPut(env, `last_branch:${chatId}`, branch);
        let total = await safeKVGet(env, 'totalBranches', 0);
        await safeKVPut(env, 'totalBranches', (total || 0) + 1);
        const requestData = await safeKVGet(env, `request:${chatId}`, null);
        const password = requestData?.password || '';
        const fileSizeBytes = requestData?.fileSize || 0;
        if (fileSizeBytes > 0) {
          let currentVol = await safeKVGet(env, 'totalVolume', 0);
          await safeKVPut(env, 'totalVolume', (currentVol || 0) + (fileSizeBytes / (1024 * 1024 * 1024)));
        }
        statsCache.expires = 0;
        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        const helpExtract = `\n\n📌 <b>نحوه استخراج فایل:</b>\nپس از دانلود، فایل ZIP را باز کنید. داخل پوشه استخراج شده، چند فایل با پسوند .001، .002 و ... می‌بینید. با نرم‌افزار <b>7-Zip</b> یا <b>WinRAR</b>، روی فایل <b>archive.7z.001</b> کلیک کرده و گزینه استخراج (Extract) را انتخاب کنید. نرم‌افزار به صورت خودکار تمام تکه‌ها را به هم چسبانده و فایل اصلی شما را با همان فرمت اولیه تحویل می‌دهد.`;
        await sendSimple(chatId, `✅ <b>فایل شما آماده شد!</b>\n\n🔗 لینک دانلود (تا ۳ ساعت معتبر):\n${link}\n\n⚠️ رمز عبور: <code>${password}</code>${helpExtract}\n\n📌 این لینک با اینترنت ملی و بدون فیلترشکن قابل دانلود است.\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» فایل را از سرور پاک کنید تا دیگران هم بتوانند از سرویس استفاده کنند.`, TOKEN);
        await safeKVDelete(env, `request:${chatId}`);
        await safeKVDelete(env, `started:${chatId}`);
        await this.finishTask(env);
      }
      return new Response('OK');
    }
    if (path === '/api/failed' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await safeKVDelete(env, `status:${chatId}`);
        await safeKVDelete(env, `request:${chatId}`);
        await safeKVDelete(env, `started:${chatId}`);
        await this.finishTask(env);
        await sendSimple(chatId, "❌ پردازش فایل شما با خطا مواجه شد. لطفاً دوباره تلاش کنید.", TOKEN);
      }
      return new Response('OK');
    }
    if (path === '/api/cleanup' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await Promise.allSettled([
          safeKVDelete(env, `branch:${chatId}`),
          safeKVDelete(env, `last_branch:${chatId}`),
          safeKVDelete(env, `status:${chatId}`),
          safeKVDelete(env, `started:${chatId}`),
          safeKVDelete(env, `request:${chatId}`)
        ]);
      }
      return new Response('OK');
    }

    if (path === `/bot${TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();
        try {
          if (update.message?.chat?.id) await updateStats(env, update.message.chat.id);
          if (update.callback_query?.message?.chat?.id) await updateStats(env, update.callback_query.message.chat.id);
        } catch(e) { console.error(e); }

        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = cb.message.chat.id;
          const data = cb.data;

          // پاسخ فوری (اجباری)
          await answerCallback(cb.id, TOKEN);

          if (data === 'help') {
            const helpText = `📘 <b>راهنمای ربات</b>\n\n` +
              `این ربات لینک مستقیم فایل را به لینک قابل دانلود در <b>اینترنت ملی</b> تبدیل می‌کند.\n\n` +
              `🔹 <b>نحوه استفاده:</b>\n` +
              `1️⃣ اگر لینک مستقیم ندارید، فایل خود را به ربات <code>@filesto_bot</code> فوروارد کنید.\n` +
              `2️⃣ لینک مستقیم را در همین ربات ارسال کنید.\n` +
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
            (async () => {
              try {
                const stats = await getStats(env);
                const repoSize = await getRepoSize(env);
                const sizeMsg = repoSize ? `\n📦 حجم مخزن: ${repoSize.toFixed(1)} گیگابایت` : '';
                await sendSimple(chatId, `📊 <b>آمار لحظه‌ای ربات</b>\n\n👥 کاربران کل: ${stats.totalUsers}\n🔄 در حال پردازش: ${stats.activeCount}\n⏳ در صف انتظار: ${stats.waiting}\n🔗 کل لینک‌های ملی ساخته شده: ${stats.totalLinks}\n💾 حجم کل فایل‌های دانلود شده: ${stats.totalVolume.toFixed(2)} گیگابایت${sizeMsg}\n\n📢 @maramivpn`, TOKEN);
              } catch (err) {
                console.error('Stats error:', err);
                await sendSimple(chatId, "⚠️ در حال حاضر امکان دریافت آمار وجود ندارد. لطفاً چند دقیقه دیگر تلاش کنید.", TOKEN);
              }
            })().catch(e => console.error(e));
          }
          else if (data === 'status') {
            (async () => {
              try {
                const status = await safeKVGet(env, `status:${chatId}`);
                const total = await safeKVGet(env, `total_chunks:${chatId}`, null);
                const uploaded = await safeKVGet(env, `uploaded_chunks:${chatId}`, null);
                let progress = (total && uploaded) ? `\n📦 پیشرفت آپلود: ${uploaded} از ${total} تکه (${Math.round(uploaded/total*100)}%)` : '';
                if (status === 'processing') {
                  await sendSimple(chatId, `🔄 وضعیت: در حال پردازش...${progress}`, TOKEN);
                } else if (status === 'waiting') {
                  let q = await safeKVGet(env, 'queueList', []);
                  let pos = (q || []).findIndex(i => i.chatId === chatId) + 1;
                  await sendSimple(chatId, `⏳ وضعیت: در صف انتظار (شماره صف: ${pos > 0 ? pos : '?'})`, TOKEN);
                } else if (status === 'done') {
                  const branch = await safeKVGet(env, `branch:${chatId}`);
                  if (branch) {
                    const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
                    await sendSimple(chatId, `✅ فایل شما آماده است!\n\n🔗 لینک دانلود:\n${link}\n\n🗑️ پس از دانلود، از دکمه «حذف فایل من» برای پاک کردن آن استفاده کنید.`, TOKEN);
                  } else {
                    await sendSimple(chatId, "درخواستی یافت نشد.", TOKEN);
                  }
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
            // ========== دکمه لینک جدید: بدون هیچ عملیات KV ==========
            await sendSimple(chatId, "✅ وضعیت قبلی شما پاک شد. اکنون لینک جدید را ارسال کنید.\n(برای دریافت لینک مستقیم فایل تلگرام، فایل را به @filesto_bot فوروارد کنید)", TOKEN);
          }
          else if (data === 'delete_my_file') {
            (async () => {
              try {
                const branchDeleted = await deleteUserBranch(chatId, env, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO);
                if (branchDeleted) {
                  await Promise.allSettled([
                    safeKVDelete(env, `status:${chatId}`),
                    safeKVDelete(env, `request:${chatId}`),
                    safeKVDelete(env, `branch:${chatId}`),
                    safeKVDelete(env, `started:${chatId}`)
                  ]);
                  await sendSimple(chatId, "✅ فایل شما از سرور حذف شد. با تشکر از همکاری شما برای مدیریت حجم مخزن.", TOKEN);
                } else {
                  await sendSimple(chatId, "❌ هیچ فایل فعالی برای حذف یافت نشد (یا قبلاً حذف شده است).", TOKEN);
                }
              } catch (err) {
                console.error(err);
                await sendSimple(chatId, "⚠️ امکان حذف فایل وجود ندارد. لطفاً چند دقیقه دیگر تلاش کنید.", TOKEN);
              }
            })().catch(e => console.error(e));
          }
          else if (data === 'cancel' || data === 'cancel_input') {
            (async () => {
              try {
                await Promise.allSettled([
                  safeKVDelete(env, `status:${chatId}`),
                  safeKVDelete(env, `request:${chatId}`),
                  safeKVDelete(env, `state:${chatId}`),
                  safeKVDelete(env, `started:${chatId}`)
                ]);
                let q = await safeKVGet(env, 'queueList', []);
                let newQ = (q || []).filter(i => i.chatId !== chatId);
                await safeKVPut(env, 'queueList', JSON.stringify(newQ));
                await sendSimple(chatId, "❌ عملیات لغو شد.", TOKEN);
              } catch (err) {
                console.error(err);
                await sendSimple(chatId, "⚠️ امکان لغو وجود ندارد. لطفاً چند دقیقه دیگر تلاش کنید.", TOKEN);
              }
            })().catch(e => console.error(e));
          }
          return new Response('OK');
        }

        // ========== پیام متنی ==========
        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim();
          if (text.startsWith('/resetstats')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              await safeKVPut(env, 'activeCount', 0);
              await safeKVPut(env, 'queueList', JSON.stringify([]));
              statsCache.expires = 0;
              await sendSimple(chatId, "✅ آمار پردازش‌های فعال و صف بازنشانی شد.", TOKEN);
            } else {
              await sendSimple(chatId, "❌ دسترسی غیرمجاز.", TOKEN);
            }
            return new Response('OK');
          }
          if (text === '/start') {
            await Promise.allSettled([
              safeKVDelete(env, `status:${chatId}`),
              safeKVDelete(env, `state:${chatId}`),
              safeKVDelete(env, `started:${chatId}`)
            });
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
          let status = await safeKVGet(env, `status:${chatId}`);
          if (status && status !== 'done' && status !== 'cancelled') {
            await sendSimple(chatId, `⚠️ شما یک درخواست فعال دارید (${status === 'waiting' ? 'در صف' : 'در حال پردازش'}). لطفاً صبر کنید یا از دکمه لغو استفاده کنید.`, TOKEN);
            return new Response('OK');
          }
          const userStateRaw = await safeKVGet(env, `state:${chatId}`);
          if (!userStateRaw) {
            if (text.match(/^https?:\/\//)) {
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
              await safeKVPut(env, `state:${chatId}`, JSON.stringify({ step: 'awaiting_password', url: text, fileSize: fileSize || 0 }), { expirationTtl: 3600 });
              const cancelKeyboard = { inline_keyboard: [[{ text: "❌ لغو عملیات", callback_data: "cancel_input" }]] };
              await sendMessage(chatId, "✅ لینک دریافت شد.\n🔐 رمز عبور ZIP را وارد کنید:\n(این رمز برای باز کردن فایل نهایی لازم است، حتماً آن را حفظ کنید.)", cancelKeyboard, TOKEN);
            } else {
              await sendSimple(chatId, "❌ لینک معتبر نیست (با http:// یا https:// شروع شود).", TOKEN);
            }
            return new Response('OK');
          }
          const userState = JSON.parse(userStateRaw);
          if (userState.step === 'awaiting_password') {
            const password = text;
            const fileUrl = userState.url;
            const fileSize = userState.fileSize || 0;
            await safeKVDelete(env, `state:${chatId}`);
            await safeKVPut(env, `request:${chatId}`, JSON.stringify({ url: fileUrl, password, fileSize }), { expirationTtl: 7200 });
            let activeCount = await safeKVGet(env, 'activeCount', 0);
            let queueList = await safeKVGet(env, 'queueList', []);
            if (!Array.isArray(queueList)) queueList = [];
            if (activeCount < MAX_CONCURRENT) {
              await safeKVPut(env, 'activeCount', activeCount + 1);
              await safeKVPut(env, `status:${chatId}`, 'processing', { expirationTtl: 7200 });
              this.runTaskWithRetry(chatId, fileUrl, password, env, TOKEN).catch(e => console.error(e));
              await sendSimple(chatId, "📤 درخواست به گیت‌هاب ارسال شد. منتظر شروع پردازش...\n(برای فایل‌های حجیم، ممکن است ۳۰-۴۰ دقیقه طول بکشد)", TOKEN);
            } else {
              queueList.push({ chatId, fileUrl, password, fileSize });
              await safeKVPut(env, 'queueList', JSON.stringify(queueList));
              await safeKVPut(env, `status:${chatId}`, 'waiting', { expirationTtl: 7200 });
              await sendSimple(chatId, `⏳ در صف قرار گرفتید. شماره صف: ${queueList.length}`, TOKEN);
            }
            return new Response('OK');
          }
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
      if (await safeKVGet(env, `started:${chatId}`)) { started = true; break; }
    }
    if (!started) {
      await sendSimple(chatId, "⚠️ پردازش شروع نشد. ممکن است سرور شلوغ باشد. لطفاً با دکمه «وضعیت من» بعداً پیگیری کنید.", TOKEN);
    }
    let branch = null;
    for (let i = 0; i < MAX_WAIT_CYCLES; i++) {
      await new Promise(r => setTimeout(r, WAIT_INTERVAL));
      branch = await safeKVGet(env, `branch:${chatId}`);
      if (branch) break;
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
        body: JSON.stringify({ ref: 'main', inputs: { file_url: fileUrl, zip_password: password, user_id: userId } })
      });
      return res.ok;
    } catch { return false; }
  },

  async finishTask(env) {
    let activeCount = await safeKVGet(env, 'activeCount', 0);
    if (activeCount > 0) activeCount--;
    await safeKVPut(env, 'activeCount', activeCount);
    statsCache.expires = 0;
    let queueList = await safeKVGet(env, 'queueList', []);
    if (queueList && queueList.length > 0) {
      const next = queueList.shift();
      await safeKVPut(env, 'queueList', JSON.stringify(queueList));
      await safeKVPut(env, 'activeCount', activeCount + 1);
      await safeKVPut(env, `status:${next.chatId}`, 'processing', { expirationTtl: 7200 });
      this.runTaskWithRetry(next.chatId, next.fileUrl, next.password, env, this.TOKEN).catch(e => console.error(e));
    }
  }
};
