// ==========================================
// ربات دانلودر پیشرفته - با آمار کاربران، صف هوشمند، وضعیت دانلود
// ==========================================
// برای دریافت لینک مستقیم فایل‌های تلگرام، فایل خود را به @filesto_bot فوروارد کنید.
// سپس لینک دریافتی را در این ربات وارد کنید.
// ==========================================

async function sendMessage(chatId, text, keyboard, TOKEN) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (keyboard) body.reply_markup = JSON.stringify(keyboard);
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function sendSimple(chatId, text, TOKEN) {
  return sendMessage(chatId, text, null, TOKEN);
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
  let totalUsers = await env.QUEUE.get('totalUsers', 'json');
  if (totalUsers === null) totalUsers = 0;
  let activeCount = await env.QUEUE.get('activeCount', 'json');
  if (activeCount === null) activeCount = 0;
  let queueList = await env.QUEUE.get('queueList', 'json');
  if (!queueList || !Array.isArray(queueList)) queueList = [];
  const waiting = queueList.length;
  return { totalUsers, activeCount, waiting };
}

async function updateStats(env, chatId) {
  let totalUsers = await env.QUEUE.get('totalUsers', 'json');
  if (totalUsers === null) totalUsers = 0;
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

export default {
  async fetch(request, env) {
    const url = new URL(request.path);
    const TOKEN = env.TELEGRAM_TOKEN;

    // Endpoint اعلام اتمام کار توسط GitHub Actions
    if (url.pathname === '/api/complete' && request.method === 'POST') {
      const { user_id, branch } = await request.json();
      if (user_id && branch) {
        const chatId = user_id.split('_')[0];
        await env.QUEUE.put(`branch:${chatId}`, branch, { expirationTtl: 10800 });
        await env.QUEUE.put(`status:${chatId}`, 'done');
      }
      return new Response('OK');
    }

    // Webhook اصلی تلگرام
    if (url.pathname === `/bot${TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();

        // افزایش آمار کاربران هنگام فعالیت (در پیام یا کلیک)
        if (update.message?.chat?.id) {
          await updateStats(env, update.message.chat.id);
        }
        if (update.callback_query?.message?.chat?.id) {
          await updateStats(env, update.callback_query.message.chat.id);
        }

        // ===== دکمه‌های شیشه‌ای =====
        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = cb.message.chat.id;
          const data = cb.data;
          await answerCallback(cb.id, TOKEN).catch(e => console.error(e));

          if (data === 'new_link') {
            await env.QUEUE.delete(`state:${chatId}`);
            await sendSimple(chatId, "📥 لطفاً لینک مستقیم فایل خود را ارسال کنید.\n(می‌توانید از ربات @filesto_bot برای دریافت لینک مستقیم فایل‌های تلگرام استفاده کنید)", TOKEN);
          }
          else if (data === 'help') {
            const helpText = `📘 <b>راهنمای ربات</b>\n\n` +
              `این ربات لینک مستقیم فایل شما را به لینک قابل دانلود در <b>اینترنت ملی</b> تبدیل می‌کند.\n\n` +
              `🔹 <b>نحوه استفاده:</b>\n` +
              `1️⃣ اگر لینک مستقیم ندارید، فایل خود را به ربات <code>@filesto_bot</code> فوروارد کنید تا لینک مستقیم بگیرید.\n` +
              `2️⃣ لینک مستقیم را در همین ربات ارسال کنید.\n` +
              `3️⃣ یک رمز عبور دلخواه برای فایل ZIP وارد کنید.\n` +
              `4️⃣ ربات فایل را دانلود، تکه‌تکه کرده و در گیت‌هاب آپلود می‌کند.\n` +
              `5️⃣ پس از اتمام، لینک دانلود (تا ۳ ساعت معتبر) دریافت می‌کنید.\n\n` +
              `⚠️ <b>توجه:</b>\n` +
              `• حجم فایل نباید بیشتر از ۲ گیگابایت باشد.\n` +
              `• از ارسال فایل‌های مستهجن خودداری کنید تا ریپازوتری بن نشود.\n` +
              `• لینک خروجی با اینترنت ملی و بدون فیلترشکن قابل دانلود است.\n\n` +
              `❤️ <b>حمایت:</b> عضو کانال ما شوید: @maramivpn`;
            await sendSimple(chatId, helpText, TOKEN);
          }
          else if (data === 'stats') {
            const { totalUsers, activeCount, waiting } = await getStats(env);
            const statsText = `📊 <b>آمار ربات</b>\n\n` +
              `👥 کاربران کل: ${totalUsers}\n` +
              `🔄 در حال پردازش: ${activeCount}\n` +
              `⏳ در صف انتظار: ${waiting}\n\n` +
              `📢 برای حمایت و اطلاع از روش‌های جدید، به کانال ما بپیوندید:\nhttps://t.me/maramivpn`;
            await sendSimple(chatId, statsText, TOKEN);
          }
          else if (data === 'status') {
            const status = await env.QUEUE.get(`status:${chatId}`);
            const queueList = await env.QUEUE.get('queueList', 'json');
            let position = -1;
            if (queueList && Array.isArray(queueList)) {
              position = queueList.findIndex(item => item.chatId === chatId);
            }
            if (status === 'processing') {
              await sendSimple(chatId, "🔄 <b>وضعیت:</b> فایل شما در حال پردازش روی گیت‌هاب است. لطفاً چند دقیقه صبر کنید...", TOKEN);
            } else if (status === 'waiting' && position >= 0) {
              await sendSimple(chatId, `⏳ <b>وضعیت:</b> در صف انتظار هستید. شماره صف شما: ${position + 1}`, TOKEN);
            } else if (status === 'done') {
              const branch = await env.QUEUE.get(`branch:${chatId}`);
              if (branch) {
                const link = `https://github.com/gptmoone/telegram-file-downloader/archive/${branch}.zip`;
                await sendSimple(chatId, `✅ فایل شما آماده است!\n\n🔗 لینک دانلود (تا ۳ ساعت معتبر):\n${link}\n\n⚠️ رمز عبور همان رمزی است که خودتان انتخاب کردید.`, TOKEN);
              } else {
                await sendSimple(chatId, "✅ آخرین درخواست شما قبلاً تکمیل شده است. لطفاً در صورت نیاز درخواست جدید بدهید.", TOKEN);
              }
            } else {
              await sendSimple(chatId, "📭 شما هیچ درخواست فعال یا تکمیل شده‌ای ندارید. از دکمه «ارسال لینک جدید» استفاده کنید.", TOKEN);
            }
          }
          else if (data === 'cancel' || data === 'cancel_input') {
            await env.QUEUE.delete(`status:${chatId}`);
            await env.QUEUE.delete(`request:${chatId}`);
            await env.QUEUE.delete(`state:${chatId}`);
            let q = await env.QUEUE.get('queueList', 'json');
            if (q && Array.isArray(q)) {
              const newQ = q.filter(item => item.chatId !== chatId);
              await env.QUEUE.put('queueList', JSON.stringify(newQ));
            }
            await sendSimple(chatId, "❌ عملیات لغو شد. در صورت نیاز دوباره شروع کنید.", TOKEN);
          }
          return new Response('OK');
        }

        // ===== پیام متنی =====
        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim();

          if (text === '/start') {
            const keyboard = {
              inline_keyboard: [
                [{ text: "📥 ارسال لینک جدید", callback_data: "new_link" }],
                [{ text: "📊 آمار ربات", callback_data: "stats" }, { text: "📊 وضعیت من", callback_data: "status" }],
                [{ text: "❓ راهنما", callback_data: "help" }, { text: "🚫 لغو درخواست", callback_data: "cancel" }]
              ]
            };
            const welcome = `🌀 <b>به ربات دانلودر خوش آمدید</b> 🌀\n\n` +
              `این ربات لینک مستقیم فایل شما را به لینک قابل دانلود در <b>اینترنت ملی</b> تبدیل می‌کند.\n\n` +
              `🔹 <b>قابلیت ویژه:</b> برای دریافت لینک مستقیم فایل‌های تلگرام، فایل خود را به ربات <code>@filesto_bot</code> فوروارد کنید و سپس لینک دریافتی را در این ربات وارد نمایید.\n\n` +
              `🔸 <b>مزایا:</b>\n` +
              `• بدون نیاز به فیلترشکن\n` +
              `• دانلود با سرعت داخلی\n` +
              `• تقسیم خودکار فایل‌های حجیم به تکه‌های ۹۵ مگابایتی\n` +
              `• حفظ امنیت با رمزگذاری ZIP\n\n` +
              `📢 <b>حمایت:</b> عضو کانال ما شوید: @maramivpn\n\n` +
              `👇 با دکمه زیر شروع کنید.`;
            await sendMessage(chatId, welcome, keyboard, TOKEN);
            return new Response('OK');
          }

          const currentStatus = await env.QUEUE.get(`status:${chatId}`);
          if (currentStatus && currentStatus !== 'done' && currentStatus !== 'cancelled') {
            await sendSimple(chatId, `⚠️ شما یک درخواست فعال دارید (${currentStatus === 'waiting' ? 'در صف' : 'در حال پردازش'}). لطفاً صبر کنید یا از دکمه «لغو» استفاده کنید.`, TOKEN);
            return new Response('OK');
          }

          const userStateRaw = await env.QUEUE.get(`state:${chatId}`);
          if (!userStateRaw) {
            if (text.match(/^https?:\/\//)) {
              const fileSize = await getFileSize(text);
              const MAX_SIZE = 2 * 1024 * 1024 * 1024;
              if (fileSize !== null && fileSize > MAX_SIZE) {
                await sendSimple(chatId, "❌ حجم فایل بیشتر از ۲ گیگابایت است. لطفاً فایل کوچک‌تری انتخاب کنید.", TOKEN);
                return new Response('OK');
              }
              await env.QUEUE.put(`state:${chatId}`, JSON.stringify({ step: 'awaiting_password', url: text }), { expirationTtl: 3600 });
              const cancelKeyboard = { inline_keyboard: [[{ text: "❌ لغو عملیات", callback_data: "cancel_input" }]] };
              await sendMessage(chatId, "✅ لینک دریافت شد.\n\n🔐 <b>مرحله دوم:</b> رمز عبور فایل ZIP را وارد کنید.\n(این رمز برای باز کردن فایل نهایی لازم است، حتماً آن را حفظ کنید.)", cancelKeyboard, TOKEN);
            } else {
              await sendSimple(chatId, "❌ لطفاً یک لینک معتبر (با http:// یا https://) ارسال کنید.", TOKEN);
            }
            return new Response('OK');
          }

          const userState = JSON.parse(userStateRaw);
          if (userState.step === 'awaiting_password') {
            const password = text;
            const fileUrl = userState.url;
            await env.QUEUE.delete(`state:${chatId}`);

            const MAX_CONCURRENT = 10;
            let activeCount = await env.QUEUE.get('activeCount', 'json');
            if (activeCount === null) activeCount = 0;
            let queueList = await env.QUEUE.get('queueList', 'json');
            if (!queueList || !Array.isArray(queueList)) queueList = [];

            if (activeCount < MAX_CONCURRENT) {
              await env.QUEUE.put('activeCount', activeCount + 1);
              await env.QUEUE.put(`status:${chatId}`, 'processing');
              this.runTask(chatId, fileUrl, password, env, TOKEN).catch(e => console.error(e));
              await sendSimple(chatId, "🔄 در حال ارسال به GitHub و دانلود فایل... این عملیات ممکن است چند دقیقه طول بکشد.\n\nمی‌توانید از دکمه «وضعیت من» مطلع شوید.", TOKEN);
            } else {
              queueList.push({ chatId, fileUrl, password });
              await env.QUEUE.put('queueList', JSON.stringify(queueList));
              await env.QUEUE.put(`status:${chatId}`, 'waiting');
              await sendSimple(chatId, `⏳ در حال حاضر ${activeCount} فایل در حال پردازش هستند.\nشماره صف شما: ${queueList.length}\nبه محض آزاد شدن سرور، فایل شما پردازش می‌شود.\n\nبرای اطلاع از وضعیت، از دکمه «وضعیت من» استفاده کنید.`, TOKEN);
            }
            return new Response('OK');
          }
        }
        return new Response('OK');
      } catch (err) {
        console.error('Webhook error:', err);
        return new Response('Error', { status: 500 });
      }
    }
    return new Response('Bot is running');
  },

  async runTask(chatId, fileUrl, password, env, TOKEN) {
    const userId = `${chatId}_${Date.now()}`;
    const GITHUB_TOKEN = env.GH_TOKEN;
    const GITHUB_OWNER = 'gptmoone';
    const GITHUB_REPO = 'telegram-file-downloader';

    try {
      const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/download.yml/dispatches`, {
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
      if (!ghRes.ok) {
        const errText = await ghRes.text();
        console.error(`GitHub error ${ghRes.status}: ${errText}`);
        await sendSimple(chatId, `❌ خطا در ارتباط با گیت‌هاب (${ghRes.status}). لطفاً بعداً تلاش کنید.`, TOKEN);
        await this.finishTask(env, chatId);
        return;
      }

      let branch = null;
      for (let i = 0; i < 360; i++) {
        await new Promise(r => setTimeout(r, 10000));
        branch = await env.QUEUE.get(`branch:${chatId}`);
        if (branch) break;
      }

      if (branch) {
        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        await sendSimple(chatId, `✅ <b>فایل شما آماده شد!</b>\n\n🔗 لینک دانلود (تا ۳ ساعت معتبر):\n${link}\n\n⚠️ رمز عبور: <code>${password}</code>\n\n📌 این لینک با اینترنت ملی و بدون فیلترشکن قابل دانلود است.`, TOKEN);
        await env.QUEUE.put(`status:${chatId}`, 'done');
      } else {
        await sendSimple(chatId, "❌ متأسفانه عملیات با خطا مواجه شد (زمان انتظار طولانی). لطفاً بعداً تلاش کنید.", TOKEN);
        await env.QUEUE.delete(`status:${chatId}`);
      }
      await this.finishTask(env, chatId);
    } catch (err) {
      console.error('Task error:', err);
      await sendSimple(chatId, "❌ خطای داخلی در ربات. لطفاً دوباره تلاش کنید.", TOKEN);
      await this.finishTask(env, chatId);
    }
  },

  async finishTask(env, finishedChatId = null) {
    let activeCount = await env.QUEUE.get('activeCount', 'json');
    if (activeCount === null) activeCount = 0;
    if (activeCount > 0) activeCount--;
    await env.QUEUE.put('activeCount', activeCount);

    let queueList = await env.QUEUE.get('queueList', 'json');
    if (queueList && queueList.length > 0) {
      const nextTask = queueList.shift();
      await env.QUEUE.put('queueList', JSON.stringify(queueList));
      await env.QUEUE.put('activeCount', activeCount + 1);
      await env.QUEUE.put(`status:${nextTask.chatId}`, 'processing');
      this.runTask(nextTask.chatId, nextTask.fileUrl, nextTask.password, env, this.TOKEN).catch(e => console.error(e));
    }
  }
};
