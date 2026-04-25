// ==========================================
// ربات دانلودر نهایی - با تلاش مجدد خودکار در صورت عدم شروع پردازش
// ==========================================

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📥 لینک جدید", callback_data: "new_link" }],
    [{ text: "📊 آمار لحظه‌ای", callback_data: "stats" }, { text: "📊 وضعیت من", callback_data: "status" }],
    [{ text: "❓ راهنما", callback_data: "help" }, { text: "🚫 لغو درخواست", callback_data: "cancel" }]
  ]
};
const MAX_CONCURRENT = 10;
const MAX_RETRIES = 3;
const RETRY_INTERVAL = 30000; // 30 ثانیه

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

async function getStats(env) {
  let totalUsers = await env.QUEUE.get('totalUsers', 'json') || 0;
  let activeCount = await env.QUEUE.get('activeCount', 'json') || 0;
  let queueList = await env.QUEUE.get('queueList', 'json') || [];
  let totalBranches = await env.QUEUE.get('totalBranches', 'json') || 0;
  
  if (activeCount > MAX_CONCURRENT || activeCount < 0) {
    activeCount = 0;
    await env.QUEUE.put('activeCount', 0);
  }
  return { totalUsers, activeCount, waiting: queueList.length, totalBranches };
}

async function updateStats(env, chatId) {
  let totalUsers = await env.QUEUE.get('totalUsers', 'json') || 0;
  let userRecord = await env.QUEUE.get(`user_${chatId}`);
  if (!userRecord) {
    totalUsers++;
    await env.QUEUE.put(`user_${chatId}`, '1');
    await env.QUEUE.put('totalUsers', totalUsers);
  }
}

async function getFileSize(url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const size = head.headers.get('content-length');
    return size ? parseInt(size) : null;
  } catch {
    return null;
  }
}

async function deleteUserBranch(chatId, env, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO) {
  const branchName = await env.QUEUE.get(`last_branch:${chatId}`);
  if (branchName) {
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
        let total = await env.QUEUE.get('totalBranches', 'json') || 0;
        await env.QUEUE.put('totalBranches', total - 1);
      }
      await env.QUEUE.delete(`last_branch:${chatId}`);
    } catch (e) { console.error('Delete branch error:', e); }
  }
}

export default {
  async fetch(request, env) {
    const urlObj = new URL(request.url);
    const path = urlObj.pathname;
    const TOKEN = env.TELEGRAM_TOKEN;
    const GITHUB_TOKEN = env.GH_TOKEN;
    const GITHUB_OWNER = 'gptmoone';
    const GITHUB_REPO = 'telegram-file-downloader';

    // ===== اطلاع از شروع پردازش =====
    if (path === '/api/started' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        // ثبت زمان شروع برای جلوگیری از انتظار بیشتر
        await env.QUEUE.put(`started:${chatId}`, Date.now().toString());
        await sendSimple(chatId, "🔄 پردازش فایل روی گیت‌هاب آغاز شد. این عملیات ممکن است چند دقیقه طول بکشد...", TOKEN);
      }
      return new Response('OK');
    }

    // ===== دریافت پیشرفت =====
    if (path === '/api/progress' && request.method === 'POST') {
      const { user_id, total_chunks, uploaded_chunks } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        if (total_chunks) await env.QUEUE.put(`total_chunks:${chatId}`, total_chunks);
        if (uploaded_chunks !== undefined) await env.QUEUE.put(`uploaded_chunks:${chatId}`, uploaded_chunks);
      }
      return new Response('OK');
    }

    // ===== اتمام کار =====
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
        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        const helpExtract = `\n\n📌 <b>نحوه استخراج فایل:</b>\nپس از دانلود، فایل ZIP را باز کنید. داخل پوشه استخراج شده، چند فایل با پسوند .001، .002 و ... می‌بینید. با نرم‌افزار <code>7-Zip</code> یا <code>WinRAR</code>، فایل <b>archive.7z.001</b> را باز کنید. نرم‌افزار به صورت خودکار همه تکه‌ها را به هم چسبانده و فایل اصلی شما را با همان فرمت اولیه تحویل می‌دهد.`;
        await sendSimple(chatId, `✅ <b>فایل شما آماده شد!</b>\n\n🔗 لینک دانلود (تا ۳ ساعت معتبر):\n${link}\n\n⚠️ رمز عبور: <code>${password}</code>${helpExtract}\n\n📌 این لینک با اینترنت ملی و بدون فیلترشکن قابل دانلود است.`, TOKEN);
        await env.QUEUE.delete(`request:${chatId}`);
        await env.QUEUE.delete(`started:${chatId}`);
        await env.QUEUE.delete(`retry:${chatId}`);
        await this.finishTask(env);
      }
      return new Response('OK');
    }

    // ===== پاکسازی توسط cron =====
    if (path === '/api/cleanup' && request.method === 'POST') {
      const { user_id } = await request.json();
      if (user_id) {
        const chatId = user_id.split('_')[0];
        await env.QUEUE.delete(`branch:${chatId}`);
        await env.QUEUE.delete(`last_branch:${chatId}`);
        await env.QUEUE.delete(`status:${chatId}`);
        await env.QUEUE.delete(`started:${chatId}`);
        await env.QUEUE.delete(`retry:${chatId}`);
      }
      return new Response('OK');
    }

    // ===== وب‌هوک اصلی تلگرام =====
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
            await env.QUEUE.delete(`status:${chatId}`);
            await env.QUEUE.delete(`request:${chatId}`);
            await env.QUEUE.delete(`state:${chatId}`);
            await env.QUEUE.delete(`total_chunks:${chatId}`);
            await env.QUEUE.delete(`uploaded_chunks:${chatId}`);
            await env.QUEUE.delete(`started:${chatId}`);
            await env.QUEUE.delete(`retry:${chatId}`);
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
              `4️⃣ منتظر بمانید تا پردازش شود (لینک خودکار ارسال می‌شود).\n\n` +
              `🔹 <b>نحوه استخراج فایل پس از دانلود:</b>\n` +
              `• فایل ZIP دانلود شده را با نرم‌افزارهایی مثل 7-Zip یا WinRAR باز کنید.\n` +
              `• داخل پوشه استخراج شده، فایل‌هایی با پسوند <code>.001</code>، <code>.002</code> و ... می‌بینید.\n` +
              `• روی فایل <b>archive.7z.001</b> کلیک راست کرده و گزینه Extract Here را انتخاب کنید.\n` +
              `• نرم‌افزار به صورت خودکار تمام تکه‌ها را به هم چسبانده و فایل اصلی شما را با همان فرمت اولیه تحویل می‌دهد.\n\n` +
              `⚠️ <b>توجه:</b>\n` +
              `• حجم فایل نباید بیشتر از ۲ گیگابایت باشد.\n` +
              `• از ارسال فایل‌های مستهجن خودداری کنید تا ریپازوتری بن نشود.\n` +
              `• لینک دانلود تا ۳ ساعت معتبر است و پس از آن فایل شما حذف می‌شود.\n\n` +
              `❤️ <b>حمایت:</b> عضو کانال ما شوید: @maramivpn`;
            await sendSimple(chatId, helpText, TOKEN);
          }
          else if (data === 'stats') {
            const { totalUsers, activeCount, waiting, totalBranches } = await getStats(env);
            await sendSimple(chatId, `📊 <b>آمار لحظه‌ای ربات</b>\n\n👥 کاربران کل: ${totalUsers}\n🔄 در حال پردازش: ${activeCount}\n⏳ در صف انتظار: ${waiting}\n📁 فایل‌های فعال روی سرور: ${totalBranches}\n\n📢 @maramivpn`, TOKEN);
          }
          else if (data === 'status') {
            const status = await env.QUEUE.get(`status:${chatId}`);
            const total = await env.QUEUE.get(`total_chunks:${chatId}`, 'json');
            const uploaded = await env.QUEUE.get(`uploaded_chunks:${chatId}`, 'json');
            let progress = '';
            if (total && uploaded) progress = `\n📦 پیشرفت آپلود: ${uploaded} از ${total} تکه (${Math.round(uploaded/total*100)}%)`;
            if (status === 'processing') {
              await sendSimple(chatId, `🔄 وضعیت: در حال پردازش...${progress}`, TOKEN);
            } else if (status === 'waiting') {
              let queueList = await env.QUEUE.get('queueList', 'json') || [];
              let pos = queueList.findIndex(i => i.chatId === chatId) + 1;
              await sendSimple(chatId, `⏳ وضعیت: در صف انتظار (شماره صف: ${pos > 0 ? pos : '?'})`, TOKEN);
            } else if (status === 'done') {
              const branch = await env.QUEUE.get(`branch:${chatId}`);
              if (branch) {
                const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
                await sendSimple(chatId, `✅ فایل شما آماده است!\n\n🔗 لینک دانلود:\n${link}`, TOKEN);
              } else {
                await sendSimple(chatId, "درخواستی یافت نشد.", TOKEN);
              }
            } else {
              await sendSimple(chatId, "هیچ درخواست فعالی ندارید.", TOKEN);
            }
          }
          else if (data === 'cancel' || data === 'cancel_input') {
            await env.QUEUE.delete(`status:${chatId}`);
            await env.QUEUE.delete(`request:${chatId}`);
            await env.QUEUE.delete(`state:${chatId}`);
            await env.QUEUE.delete(`started:${chatId}`);
            await env.QUEUE.delete(`retry:${chatId}`);
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

          // دستور مخفی ریست آمار (اختیاری)
          if (text.startsWith('/resetstats')) {
            const secret = text.split(' ')[1];
            const adminSecret = env.ADMIN_SECRET;
            if (adminSecret && secret === adminSecret) {
              await env.QUEUE.put('activeCount', 0);
              await env.QUEUE.put('queueList', JSON.stringify([]));
              await env.QUEUE.put('totalBranches', 0);
              await sendSimple(chatId, "✅ آمار ربات بازنشانی شد.\n`activeCount` = 0، صف خالی شد.", TOKEN);
            } else {
              await sendSimple(chatId, "❌ دسترسی غیرمجاز. توکن اشتباه است.", TOKEN);
            }
            return new Response('OK');
          }

          if (text === '/start') {
            await env.QUEUE.delete(`status:${chatId}`);
            await env.QUEUE.delete(`state:${chatId}`);
            await env.QUEUE.delete(`started:${chatId}`);
            await env.QUEUE.delete(`retry:${chatId}`);
            const welcome = `🌀 <b>به ربات دانلودر خوش آمدید</b> 🌀\n\n` +
              `لینک مستقیم فایل را بفرستید تا لینک قابل دانلود در <b>اینترنت ملی</b> دریافت کنید.\n\n` +
              `🔹 برای دریافت لینک مستقیم فایل تلگرام، فایل را به @filesto_bot فوروارد کنید.\n\n` +
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
              const fileSize = await getFileSize(text);
              if (fileSize && fileSize > 2 * 1024 * 1024 * 1024) {
                await sendSimple(chatId, "❌ حجم فایل بیشتر از ۲ گیگابایت است. لطفاً فایل کوچک‌تری انتخاب کنید.", TOKEN);
                return new Response('OK');
              }
              await env.QUEUE.put(`state:${chatId}`, JSON.stringify({ step: 'awaiting_password', url: text }), { expirationTtl: 3600 });
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
            await env.QUEUE.delete(`state:${chatId}`);
            await env.QUEUE.put(`request:${chatId}`, JSON.stringify({ url: fileUrl, password }));

            let activeCount = await env.QUEUE.get('activeCount', 'json') || 0;
            let queueList = await env.QUEUE.get('queueList', 'json') || [];

            if (activeCount < MAX_CONCURRENT) {
              await env.QUEUE.put('activeCount', activeCount + 1);
              await env.QUEUE.put(`status:${chatId}`, 'processing');
              // شروع فرآیند با قابلیت تلاش مجدد
              this.runTaskWithRetry(chatId, fileUrl, password, env, TOKEN).catch(e => console.error(e));
              await sendSimple(chatId, "📤 درخواست به گیت‌هاب ارسال شد. منتظر شروع پردازش...", TOKEN);
            } else {
              queueList.push({ chatId, fileUrl, password });
              await env.QUEUE.put('queueList', JSON.stringify(queueList));
              await env.QUEUE.put(`status:${chatId}`, 'waiting');
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

  // اجرای تسک با قابلیت تلاش مجدد خودکار
  async runTaskWithRetry(chatId, fileUrl, password, env, TOKEN) {
    const userId = `${chatId}_${Date.now()}`;
    let retryCount = 0;
    let success = false;

    while (retryCount < MAX_RETRIES && !success) {
      // ارسال درخواست به گیت‌هاب
      const ghRes = await this.sendWorkflowRequest(chatId, fileUrl, password, userId, env, TOKEN);
      if (!ghRes) {
        // خطا در ارسال، یک بار دیگر تلاش کن
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          await sendSimple(chatId, `⚠️ تلاش ${retryCount} ناموفق بود. تلاش مجدد در ${RETRY_INTERVAL/1000} ثانیه...`, TOKEN);
          await new Promise(r => setTimeout(r, RETRY_INTERVAL));
          continue;
        } else {
          await sendSimple(chatId, `❌ پس از ${MAX_RETRIES} تلاش، درخواست به گیت‌هاب ارسال نشد. لطفاً دوباره تلاش کنید.`, TOKEN);
          await this.finishTask(env);
          return;
        }
      }

      // منتظر پیام شروع از سمت گیت‌هاب (حداکثر RETRY_INTERVAL ثانیه)
      const started = await this.waitForStart(chatId, env, RETRY_INTERVAL);
      if (started) {
        success = true;
        break;
      } else {
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          await sendSimple(chatId, `⚠️ پردازش شروع نشد. تلاش مجدد ${retryCount} از ${MAX_RETRIES}...`, TOKEN);
          // درخواست بعدی با همان userId فرستاده می‌شود (تکراری)
        } else {
          await sendSimple(chatId, `❌ پس از ${MAX_RETRIES} تلاش، پردازش آغاز نشد. لطفاً دوباره تلاش کنید.`, TOKEN);
          await this.finishTask(env);
          return;
        }
      }
    }

    // حالا که شروع شد، منتظر پایان باشیم (کار توسط endpoint /api/complete انجام می‌شود)
    // فقط اگر timeout شد، finishTask اجرا می‌شود.
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
          inputs: { file_url: fileUrl, zip_password: password, user_id: userId }
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error(`GitHub error ${res.status}: ${errText}`);
        return null;
      }
      return true;
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async waitForStart(chatId, env, timeoutMs) {
    const startKey = `started:${chatId}`;
    await env.QUEUE.delete(startKey);
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const started = await env.QUEUE.get(startKey);
      if (started) return true;
      await new Promise(r => setTimeout(r, 5000)); // هر 5 ثانیه چک کن
    }
    return false;
  },

  async finishTask(env) {
    let activeCount = await env.QUEUE.get('activeCount', 'json') || 0;
    if (activeCount > 0) activeCount--;
    await env.QUEUE.put('activeCount', activeCount);

    let queueList = await env.QUEUE.get('queueList', 'json') || [];
    if (queueList.length > 0) {
      const next = queueList.shift();
      await env.QUEUE.put('queueList', JSON.stringify(queueList));
      await env.QUEUE.put('activeCount', activeCount + 1);
      await env.QUEUE.put(`status:${next.chatId}`, 'processing');
      this.runTaskWithRetry(next.chatId, next.fileUrl, next.password, env, this.TOKEN).catch(e => console.error(e));
    }
  },

  //تست نسخه آخر لازم نیست تابع runTask قدیمی حذف شود، ولی از runTaskWithRetry استفاده می‌کنیم.
};


