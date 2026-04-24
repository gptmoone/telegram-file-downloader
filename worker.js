// ==========================================
// ربات دانلودر پیشرفته - نسخه نهایی با رفع تمام مشکلات
// ==========================================
// برای دریافت لینک مستقیم فایل‌های تلگرام، فایل خود را به @filesto_bot فوروارد کنید.
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

async function deleteUserBranch(chatId, env, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO) {
  const branchName = await env.QUEUE.get(`last_branch:${chatId}`);
  if (branchName) {
    try {
      await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchName}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'CloudflareWorkerBot/1.0'
        }
      });
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

    // ===== Endpoint دریافت پیشرفت از GitHub Actions =====
    if (path === '/api/progress' && request.method === 'POST') {
      const { user_id, total_chunks, uploaded_chunks } = await request.json();
      if (user_id && (total_chunks || uploaded_chunks)) {
        const chatId = user_id.split('_')[0];
        if (total_chunks) await env.QUEUE.put(`total_chunks:${chatId}`, total_chunks);
        if (uploaded_chunks !== undefined) await env.QUEUE.put(`uploaded_chunks:${chatId}`, uploaded_chunks);
      }
      return new Response('OK');
    }

    // ===== Endpoint اعلام اتمام کار =====
    if (path === '/api/complete' && request.method === 'POST') {
      const { user_id, branch } = await request.json();
      if (user_id && branch) {
        const chatId = user_id.split('_')[0];
        await env.QUEUE.put(`branch:${chatId}`, branch, { expirationTtl: 10800 });
        await env.QUEUE.put(`status:${chatId}`, 'done');
        await env.QUEUE.put(`last_branch:${chatId}`, branch);
        // ارسال خودکار پیام موفقیت به کاربر
        const password = (await env.QUEUE.get(`request:${chatId}`, 'json'))?.password || '';
        const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
        await sendSimple(chatId, `✅ <b>فایل شما آماده شد!</b>\n\n🔗 لینک دانلود (تا ۳ ساعت معتبر):\n${link}\n\n⚠️ رمز عبور: <code>${password}</code>\n\n📌 این لینک با اینترنت ملی و بدون فیلترشکن قابل دانلود است.`, TOKEN);
        await env.QUEUE.delete(`request:${chatId}`);
      }
      return new Response('OK');
    }

    // ===== Webhook اصلی تلگرام =====
    if (path === `/bot${TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();

        if (update.message?.chat?.id) await updateStats(env, update.message.chat.id);
        if (update.callback_query?.message?.chat?.id) await updateStats(env, update.callback_query.message.chat.id);

        // ===== دکمه‌ها =====
        if (update.callback_query) {
          const cb = update.callback_query;
          const chatId = cb.message.chat.id;
          const data = cb.data;
          await answerCallback(cb.id, TOKEN).catch(e => console.error(e));

          if (data === 'new_link') {
            // پاکسازی کامل وضعیت قبلی
            await env.QUEUE.delete(`status:${chatId}`);
            await env.QUEUE.delete(`request:${chatId}`);
            await env.QUEUE.delete(`state:${chatId}`);
            await env.QUEUE.delete(`total_chunks:${chatId}`);
            await env.QUEUE.delete(`uploaded_chunks:${chatId}`);
            // حذف شاخه قبلی از گیت‌هاب
            await deleteUserBranch(chatId, env, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO);
            await sendSimple(chatId, "📥 لطفاً لینک مستقیم فایل خود را ارسال کنید.\n(می‌توانید از ربات @filesto_bot برای دریافت لینک مستقیم فایل‌های تلگرام استفاده کنید)", TOKEN);
          }
          else if (data === 'help') {
            const helpText = `📘 <b>راهنمای ربات</b>\n\n` +
              `این ربات لینک مستقیم فایل را به لینک قابل دانلود در <b>اینترنت ملی</b> تبدیل می‌کند.\n\n` +
              `🔹 <b>نحوه استفاده:</b>\n` +
              `1️⃣ اگر لینک مستقیم ندارید، فایل خود را به ربات <code>@filesto_bot</code> فوروارد کنید.\n` +
              `2️⃣ لینک مستقیم را در همین ربات ارسال کنید.\n` +
              `3️⃣ یک رمز عبور دلخواه برای فایل ZIP وارد کنید.\n` +
              `4️⃣ منتظر بمانید تا پردازش شود (لینک خودکار ارسال می‌شود).\n` +
              `5️⃣ لینک دانلود (تا ۳ ساعت معتبر) را دریافت کنید.\n\n` +
              `⚠️ حجم فایل نباید بیشتر از ۲ گیگابایت باشد.\n` +
              `❤️ حمایت: عضو کانال ما شوید: @maramivpn`;
            await sendSimple(chatId, helpText, TOKEN);
          }
          else if (data === 'stats') {
            const { totalUsers, activeCount, waiting } = await getStats(env);
            const statsText = `📊 <b>آمار ربات</b>\n\n👥 کاربران کل: ${totalUsers}\n🔄 در حال پردازش: ${activeCount}\n⏳ در صف انتظار: ${waiting}\n\n📢 @maramivpn`;
            await sendSimple(chatId, statsText, TOKEN);
          }
          else if (data === 'status') {
            const status = await env.QUEUE.get(`status:${chatId}`);
            const total = await env.QUEUE.get(`total_chunks:${chatId}`, 'json');
            const uploaded = await env.QUEUE.get(`uploaded_chunks:${chatId}`, 'json');
            let progress = '';
            if (total && uploaded) progress = `\n📦 پیشرفت آپلود: ${uploaded} از ${total} تکه (${Math.round(uploaded/total*100)}%)`;
            if (status === 'processing') {
              await sendSimple(chatId, `🔄 در حال پردازش...${progress}`, TOKEN);
            } else if (status === 'waiting') {
              let queueList = await env.QUEUE.get('queueList', 'json');
              let pos = queueList?.findIndex(i => i.chatId === chatId) + 1 || '?';
              await sendSimple(chatId, `⏳ در صف هستید. شماره صف: ${pos}`, TOKEN);
            } else if (status === 'done') {
              const branch = await env.QUEUE.get(`branch:${chatId}`);
              if (branch) {
                const link = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branch}.zip`;
                await sendSimple(chatId, `✅ فایل آماده است!\n\n🔗 لینک دانلود:\n${link}`, TOKEN);
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
            let q = await env.QUEUE.get('queueList', 'json');
            if (q) await env.QUEUE.put('queueList', JSON.stringify(q.filter(i => i.chatId !== chatId)));
            await sendSimple(chatId, "❌ عملیات لغو شد.", TOKEN);
          }
          return new Response('OK');
        }

        // ===== پیام متنی =====
        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim();

          if (text === '/start') {
            // پاکسازی وضعیت گیر کرده
            await env.QUEUE.delete(`status:${chatId}`);
            await env.QUEUE.delete(`state:${chatId}`);
            const keyboard = {
              inline_keyboard: [
                [{ text: "📥 لینک جدید", callback_data: "new_link" }],
                [{ text: "📊 آمار", callback_data: "stats" }, { text: "📊 وضعیت من", callback_data: "status" }],
                [{ text: "❓ راهنما", callback_data: "help" }, { text: "🚫 لغو", callback_data: "cancel" }]
              ]
            };
            const welcome = `🌀 <b>به ربات دانلودر خوش آمدید</b> 🌀\n\n` +
              `لینک مستقیم فایل را بفرستید تا لینک قابل دانلود در اینترنت ملی دریافت کنید.\n\n` +
              `🔹 برای دریافت لینک مستقیم فایل تلگرام، فایل را به @filesto_bot فوروارد کنید.\n\n` +
              `📢 حمایت: @maramivpn`;
            await sendMessage(chatId, welcome, keyboard, TOKEN);
            return new Response('OK');
          }

          let status = await env.QUEUE.get(`status:${chatId}`);
          if (status && status !== 'done' && status !== 'cancelled') {
            await sendSimple(chatId, `⚠️ شما یک درخواست فعال دارید (${status === 'waiting' ? 'در صف' : 'در حال پردازش'}). لطفاً صبر کنید یا لغو کنید.`, TOKEN);
            return new Response('OK');
          }

          const userStateRaw = await env.QUEUE.get(`state:${chatId}`);
          if (!userStateRaw) {
            if (text.match(/^https?:\/\//)) {
              const fileSize = await getFileSize(text);
              if (fileSize && fileSize > 2 * 1024 * 1024 * 1024) {
                await sendSimple(chatId, "❌ حجم فایل بیشتر از ۲ گیگابایت است.", TOKEN);
                return new Response('OK');
              }
              await env.QUEUE.put(`state:${chatId}`, JSON.stringify({ step: 'awaiting_password', url: text }), { expirationTtl: 3600 });
              const cancelKeyboard = { inline_keyboard: [[{ text: "❌ لغو", callback_data: "cancel_input" }]] };
              await sendMessage(chatId, "✅ لینک دریافت شد.\n🔐 رمز عبور ZIP را وارد کنید:", cancelKeyboard, TOKEN);
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

            const MAX_CONCURRENT = 10;
            let activeCount = await env.QUEUE.get('activeCount', 'json') || 0;
            let queueList = await env.QUEUE.get('queueList', 'json') || [];

            if (activeCount < MAX_CONCURRENT) {
              await env.QUEUE.put('activeCount', activeCount + 1);
              await env.QUEUE.put(`status:${chatId}`, 'processing');
              this.runTask(chatId, fileUrl, password, env, TOKEN).catch(e => console.error(e));
              await sendSimple(chatId, "🔄 در حال ارسال به GitHub... ممکن است چند دقیقه طول بکشد.", TOKEN);
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
          inputs: { file_url: fileUrl, zip_password: password, user_id: userId }
        })
      });
      if (!ghRes.ok) {
        const errText = await ghRes.text();
        console.error(`GitHub error: ${errText}`);
        await sendSimple(chatId, `❌ خطا در ارتباط با گیت‌هاب.`, TOKEN);
        await this.finishTask(env, chatId);
        return;
      }

      // منتظر ماندن برای اتمام (بدون تایم اوت سخت)
      let branch = null;
      while (!branch) {
        await new Promise(r => setTimeout(r, 10000));
        branch = await env.QUEUE.get(`branch:${chatId}`);
      }

      // پیام موفقیت توسط /api/complete ارسال می‌شود، اینجا فقط تسک را تمام می‌کنیم
      await this.finishTask(env, chatId);
    } catch (err) {
      console.error(err);
      await sendSimple(chatId, "❌ خطای داخلی.", TOKEN);
      await this.finishTask(env, chatId);
    }
  },

  async finishTask(env, chatId) {
    let activeCount = await env.QUEUE.get('activeCount', 'json') || 0;
    if (activeCount > 0) activeCount--;
    await env.QUEUE.put('activeCount', activeCount);

    let queueList = await env.QUEUE.get('queueList', 'json') || [];
    if (queueList.length > 0) {
      const next = queueList.shift();
      await env.QUEUE.put('queueList', JSON.stringify(queueList));
      await env.QUEUE.put('activeCount', activeCount + 1);
      await env.QUEUE.put(`status:${next.chatId}`, 'processing');
      this.runTask(next.chatId, next.fileUrl, next.password, env, this.TOKEN).catch(e => console.error(e));
    }
  }
};
