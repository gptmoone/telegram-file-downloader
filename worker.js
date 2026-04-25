// ==========================================
// ربات دانلودر نهایی - بهینه برای کاهش عملیات Delete KV
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
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId })
  });
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
      const sizeGB = data.size / (1024 * 1024);
      return sizeGB;
    }
  } catch (e) { console.error('getRepoSize error:', e); }
  return 0;
}

async function getStats(env) {
  const now = Date.now();
  if (statsCache.data && statsCache.expires > now) return statsCache.data;
  
  const [totalUsers, activeCount, queueListRaw, totalBranches, totalVolume] = await Promise.all([
    env.QUEUE.get('totalUsers', 'json').then(v => v || 0),
    env.QUEUE.get('activeCount', 'json').then(v => v || 0),
    env.QUEUE.get('queueList', 'json').then(v => v || []),
    env.QUEUE.get('totalBranches', 'json').then(v => v || 0),
    env.QUEUE.get('totalVolume', 'json').then(v => v || 0)
  ]);
  let realActive = activeCount;
  if (realActive > MAX_CONCURRENT || realActive < 0) realActive = 0;
  if (realActive !== activeCount) await env.QUEUE.put('activeCount', realActive);
  
  const result = { totalUsers, activeCount: realActive, waiting: queueListRaw.length, totalLinks: totalBranches, totalVolume: totalVolume };
  statsCache = { data: result, expires: now + 30000 };
  return result;
}

async function updateStats(env, chatId) {
  const now = Date.now();
  const lastCheck = userCheckCache.get(chatId) || 0;
  if (now - lastCheck < 300000) return;
  userCheckCache.set(chatId, now);
  
  let totalUsers = await env.QUEUE.get('totalUsers', 'json') || 0;
  let userRecord = await env.QUEUE.get(`user_${chatId}`);
  if (!userRecord) {
    totalUsers++;
    await Promise.all([
      env.QUEUE.put(`user_${chatId}`, '1'),
      env.QUEUE.put('totalUsers', totalUsers)
    ]);
    statsCache.expires = 0;
  }
}

async function getFileSize(url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const size = head.headers.get('content-length');
    return size ? parseInt(size) : null;
  } catch { return null; }
}

async function deleteUserBranch(chatId, env, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO) {
  const branchName = await env.QUEUE.get(`last_branch:${chatId}`);
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
      // فقط last_branch را حذف می‌کنیم، totalBranches را کاهش نمی‌دهیم
      await env.QUEUE.delete(`last_branch:${chatId}`);
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

    // Endpoint شروع پردازش
    if (path === '/api/started' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await env.QUEUE.put(`started:${chatId}`, Date.now().toString(), { expirationTtl: 3600 }); // TTL 1 ساعت
        await sendSimple(chatId, "🔄 پردازش فایل روی گیت‌هاب آغاز شد...", TOKEN);
      }
      return new Response('OK');
    }

    // Endpoint پیشرفت
    if (path === '/api/progress' && request.method === 'POST') {
      const { user_id, total_chunks, uploaded_chunks } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        if (total_chunks) await env.QUEUE.put(`total_chunks:${chatId}`, total_chunks, { expirationTtl: 7200 });
        if (uploaded_chunks !== undefined) await env.QUEUE.put(`uploaded_chunks:${chatId}`, uploaded_chunks, { expirationTtl: 7200 });
      }
      return new Response('OK');
    }

    // Endpoint موفقیت
    if (path === '/api/complete' && request.method === 'POST') {
      const { user_id, branch } = await request.json();
      if (user_id && branch) {
        const chatId = user_id.split('_')[0];
        await env.QUEUE.put(`branch:${chatId}`, branch, { expirationTtl: 10800 });
        await env.QUEUE.put(`status:${chatId}`, 'done');
        await env.QUEUE.put(`last_branch:${chatId}`, branch);
        
        let total = await env.QUEUE.get('totalBranches', 'json') || 0;
        await env.QUEUE.put('totalBranches', total + 1);
        
        const requestData = await env.QUEUE.get(`request:${chatId}`, 'json');
        const password = requestData?.password || '';
        const fileSizeBytes = requestData?.fileSize || 0;
        if (fileSizeBytes > 0) {
          let currentVol = await env.QUEUE.get('totalVolume', 'json') || 0;
          let newVol = currentVol + (fileSizeBytes / (1024 * 1024 * 1024));
          await env.QUEUE.put('totalVolume', newVol);
        }
        
        statsCache.expires = 0;
        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        const helpExtract = `\n\n📌 <b>نحوه استخراج فایل:</b>\nپس از دانلود، فایل ZIP را باز کنید. داخل پوشه استخراج شده، چند فایل با پسوند .001، .002 و ... می‌بینید. با نرم‌افزار <b>7-Zip</b> یا <b>WinRAR</b>، روی فایل <b>archive.7z.001</b> کلیک کرده و گزینه استخراج (Extract) را انتخاب کنید. نرم‌افزار به صورت خودکار تمام تکه‌ها را به هم چسبانده و فایل اصلی شما را با همان فرمت اولیه تحویل می‌دهد.`;
        await sendSimple(chatId, `✅ <b>فایل شما آماده شد!</b>\n\n🔗 لینک دانلود (تا ۳ ساعت معتبر):\n${link}\n\n⚠️ رمز عبور: <code>${password}</code>${helpExtract}\n\n📌 این لینک با اینترنت ملی و بدون فیلترشکن قابل دانلود است.\n\n🗑️ پس از دانلود، با دکمه «حذف فایل من» فایل را از سرور پاک کنید تا دیگران هم بتوانند از سرویس استفاده کنند.`, TOKEN);
        // حذف کلیدهای موقتی که دیگر نیاز نیستند (با TTL قبلاً منقضی می‌شوند، اما برای آزادسازی فوری حذف می‌کنیم)
        await env.QUEUE.delete(`request:${chatId}`);
        await env.QUEUE.delete(`started:${chatId}`);
        await this.finishTask(env);
      }
      return new Response('OK');
    }

    // Endpoint خطا
    if (path === '/api/failed' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await env.QUEUE.delete(`status:${chatId}`);
        await env.QUEUE.delete(`request:${chatId}`);
        await env.QUEUE.delete(`started:${chatId}`);
        await this.finishTask(env);
        await sendSimple(chatId, "❌ پردازش فایل شما با خطا مواجه شد. لطفاً دوباره تلاش کنید.", TOKEN);
      }
      return new Response('OK');
    }

    // Endpoint پاکسازی توسط cron
    if (path === '/api/cleanup' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await Promise.all([
          env.QUEUE.delete(`branch:${chatId}`),
          env.QUEUE.delete(`last_branch:${chatId}`),
          env.QUEUE.delete(`status:${chatId}`),
          env.QUEUE.delete(`started:${chatId}`),
          env.QUEUE.delete(`request:${chatId}`)
        ]);
      }
      return new Response('OK');
    }

    // وب‌هوک اصلی تلگرام
    if (path === `/bot${TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();

        if (update.message?.chat?.id) await updateStats(env, update.message.chat.id);
        if (update.callback_query?.message?.chat?.id) await updateStats(env, update.callback_query.message.chat.id);

        // دکمه‌ها
        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = cb.message.chat.id;
          const data = cb.data;
          await answerCallback(cb.id, TOKEN).catch(e => console.error(e));

          if (data === 'new_link') {
            // فقط کلیدهای ضروری را حذف می‌کنیم (state و status و started و request و ...)
            await Promise.all([
              env.QUEUE.delete(`status:${chatId}`),
              env.QUEUE.delete(`request:${chatId}`),
              env.QUEUE.delete(`state:${chatId}`),
              env.QUEUE.delete(`total_chunks:${chatId}`),
              env.QUEUE.delete(`uploaded_chunks:${chatId}`),
              env.QUEUE.delete(`started:${chatId}`)
            ]);
            await deleteUserBranch(chatId, env, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO);
            await sendSimple(chatId, "✅ وضعیت قبلی شما پاک شد. اکنون لینک جدید را ارسال کنید.\n(برای دریافت لینک مستقیم فایل تلگرام، فایل را به @filesto_bot فوروارد کنید)", TOKEN);
          }
          else if (data === 'help') {
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
            const stats = await getStats(env);
            const repoSize = await getRepoSize(env);
            const sizeMsg = repoSize ? `\n📦 حجم مخزن: ${repoSize.toFixed(1)} گیگابایت` : '';
            let warningMsg = '';
            if (repoSize >= REPO_SIZE_LIMIT_GB) warningMsg = '\n\n⚠️ <b>هشدار: حجم مخزن به حد مجاز رسیده است. لطفاً فایل‌های خود را حذف کنید تا امکان استفاده برای دیگران باقی بماند.</b>';
            else if (repoSize >= REPO_SIZE_WARNING_GB) warningMsg = '\n\n⚠️ <b>هشدار: حجم مخزن نزدیک به حد مجاز است. پس از دانلود، فایل خود را حذف کنید.</b>';
            await sendSimple(chatId, `📊 <b>آمار لحظه‌ای ربات</b>\n\n👥 کاربران کل: ${stats.totalUsers}\n🔄 در حال پردازش: ${stats.activeCount}\n⏳ در صف انتظار: ${stats.waiting}\n🔗 کل لینک‌های ملی ساخته شده: ${stats.totalLinks}\n💾 حجم کل فایل‌های دانلود شده: ${stats.totalVolume.toFixed(2)} گیگابایت${sizeMsg}${warningMsg}\n\n📢 @maramivpn`, TOKEN);
          }
          else if (data === 'status') {
            const status = await env.QUEUE.get(`status:${chatId}`);
            const total = await env.QUEUE.get(`total_chunks:${chatId}`, 'json');
            const uploaded = await env.QUEUE.get(`uploaded_chunks:${chatId}`, 'json');
            let progress = (total && uploaded) ? `\n📦 پیشرفت آپلود: ${uploaded} از ${total} تکه (${Math.round(uploaded/total*100)}%)` : '';
            if (status === 'processing') {
              await sendSimple(chatId, `🔄 وضعیت: در حال پردازش...${progress}`, TOKEN);
            } else if (status === 'waiting') {
              let q = await env.QUEUE.get('queueList', 'json') || [];
              let pos = q.findIndex(i => i.chatId === chatId) + 1;
              await sendSimple(chatId, `⏳ وضعیت: در صف انتظار (شماره صف: ${pos > 0 ? pos : '?'})`, TOKEN);
            } else if (status === 'done') {
              const branch = await env.QUEUE.get(`branch:${chatId}`);
              if (branch) {
                const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
                await sendSimple(chatId, `✅ فایل شما آماده است!\n\n🔗 لینک دانلود:\n${link}\n\n🗑️ پس از دانلود، از دکمه «حذف فایل من» برای پاک کردن آن استفاده کنید.`, TOKEN);
              } else {
                await sendSimple(chatId, "درخواستی یافت نشد.", TOKEN);
              }
            } else {
              await sendSimple(chatId, "هیچ درخواست فعالی ندارید.", TOKEN);
            }
          }
          else if (data === 'delete_my_file') {
            const branchDeleted = await deleteUserBranch(chatId, env, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO);
            if (branchDeleted) {
              await Promise.all([
                env.QUEUE.delete(`status:${chatId}`),
                env.QUEUE.delete(`request:${chatId}`),
                env.QUEUE.delete(`branch:${chatId}`),
                env.QUEUE.delete(`total_chunks:${chatId}`),
                env.QUEUE.delete(`uploaded_chunks:${chatId}`),
                env.QUEUE.delete(`started:${chatId}`)
              ]);
              await sendSimple(chatId, "✅ فایل شما از سرور حذف شد. با تشکر از همکاری شما برای مدیریت حجم مخزن.", TOKEN);
            } else {
              await sendSimple(chatId, "❌ هیچ فایل فعالی برای حذف یافت نشد (یا قبلاً حذف شده است).", TOKEN);
            }
          }
          else if (data === 'cancel' || data === 'cancel_input') {
            await Promise.all([
              env.QUEUE.delete(`status:${chatId}`),
              env.QUEUE.delete(`request:${chatId}`),
              env.QUEUE.delete(`state:${chatId}`),
              env.QUEUE.delete(`started:${chatId}`)
            ]);
            let q = await env.QUEUE.get('queueList', 'json') || [];
            await env.QUEUE.put('queueList', JSON.stringify(q.filter(i => i.chatId !== chatId)));
            await sendSimple(chatId, "❌ عملیات لغو شد.", TOKEN);
          }
          return new Response('OK');
        }

        // پیام متنی
        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim();

          if (text.startsWith('/resetstats')) {
            const secret = text.split(' ')[1];
            if (ADMIN_SECRET && secret === ADMIN_SECRET) {
              await env.QUEUE.put('activeCount', 0);
              await env.QUEUE.put('queueList', JSON.stringify([]));
              statsCache.expires = 0;
              await sendSimple(chatId, "✅ آمار پردازش‌های فعال و صف بازنشانی شد. تعداد کل لینک‌های ملی و حجم کل دست نخورده باقی ماندند.", TOKEN);
            } else {
              await sendSimple(chatId, "❌ دسترسی غیرمجاز. توکن اشتباه است.", TOKEN);
            }
            return new Response('OK');
          }

          if (text === '/start') {
            await Promise.all([
              env.QUEUE.delete(`status:${chatId}`),
              env.QUEUE.delete(`state:${chatId}`),
              env.QUEUE.delete(`started:${chatId}`)
            ]);
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

          let status = await env.QUEUE.get(`status:${chatId}`);
          if (status && status !== 'done' && status !== 'cancelled') {
            await sendSimple(chatId, `⚠️ شما یک درخواست فعال دارید (${status === 'waiting' ? 'در صف' : 'در حال پردازش'}). لطفاً صبر کنید یا از دکمه لغو استفاده کنید.`, TOKEN);
            return new Response('OK');
          }

          const userStateRaw = await env.QUEUE.get(`state:${chatId}`);
          if (!userStateRaw) {
            if (text.match(/^https?:\/\//)) {
              const repoSize = await getRepoSize(env);
              if (repoSize >= REPO_SIZE_LIMIT_GB) {
                await sendSimple(chatId, `❌ حجم مخزن به حد مجاز (${REPO_SIZE_LIMIT_GB} گیگابایت) رسیده است. لطفاً چند ساعت بعد تلاش کنید یا از دیگر کاربران بخواهید فایل‌های خود را حذف کنند.\n\n📊 حجم فعلی: ${repoSize.toFixed(1)} گیگابایت`, TOKEN);
                return new Response('OK');
              } else if (repoSize >= REPO_SIZE_WARNING_GB) {
                await sendSimple(chatId, `⚠️ هشدار: حجم مخزن نزدیک به حد مجاز است (${repoSize.toFixed(1)} از ${REPO_SIZE_LIMIT_GB} گیگابایت). لطفاً پس از دانلود فایل خود، آن را حذف کنید تا دیگران هم بتوانند استفاده کنند.`, TOKEN);
              }
              const fileSize = await getFileSize(text);
              if (fileSize && fileSize > 2 * 1024 * 1024 * 1024) {
                await se
