// ==========================================
// ربات دانلودر - نسخه با ثبت خطاهای کامل GitHub
// ==========================================

async function sendMessage(chatId, text, keyboard, TELEGRAM_TOKEN) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
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

async function sendMessageSimple(chatId, text, TELEGRAM_TOKEN) {
  return sendMessage(chatId, text, null, TELEGRAM_TOKEN);
}

async function answerCallback(callbackId, TELEGRAM_TOKEN) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId })
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const TELEGRAM_TOKEN = env.TELEGRAM_TOKEN;
    
    if (url.pathname === '/api/complete' && request.method === 'POST') {
      const body = await request.json();
      const { user_id, branch } = body;
      if (user_id && branch) {
        const chatId = user_id.split('_')[0];
        await env.QUEUE.put(`branch:${chatId}`, branch, { expirationTtl: 10800 });
        await env.QUEUE.put(`status:${chatId}`, 'done');
        return new Response('OK');
      }
      return new Response('Bad Request', { status: 400 });
    }
    
    if (url.pathname === `/bot${TELEGRAM_TOKEN}` && request.method === 'POST') {
      try {
        const update = await request.json();
        
        if (update.callback_query) {
          const callback = update.callback_query;
          const chatId = callback.message.chat.id;
          const data = callback.data;
          await answerCallback(callback.id, TELEGRAM_TOKEN);
          
          if (data === 'new_link') {
            await env.QUEUE.delete(`state:${chatId}`);
            await sendMessageSimple(chatId, "لطفاً لینک مستقیم فایل را ارسال کنید.", TELEGRAM_TOKEN);
          } 
          else if (data === 'help') {
            const helpText = `📘 <b>راهنمای استفاده</b>\n\n` +
              `این ربات برای دانلود فایل‌های فیلترشده بدون نیاز به فیلترشکن طراحی شده است.\n\n` +
              `🔹 <b>مراحل:</b>\n` +
              `1️⃣ فایل خود را به ربات <code>@filesto_bot</code> فوروارد کنید تا لینک مستقیم بگیرید.\n` +
              `2️⃣ لینک مستقیم را در همین ربات ارسال کنید.\n` +
              `3️⃣ یک رمز عبور دلخواه برای فایل ZIP وارد کنید.\n` +
              `4️⃣ پس از پردازش، لینک داخلی (GitHub) دریافت می‌کنید.\n` +
              `5️⃣ لینک را با نت ملی و بدون فیلترشکن دانلود کنید.\n\n` +
              `⚠️ حجم فایل نهایی نباید از ۲ گیگابایت بیشتر باشد.\n` +
              `🔗 لینک دانلود تا ۳ ساعت معتبر است.`;
            await sendMessageSimple(chatId, helpText, TELEGRAM_TOKEN);
          }
          else if (data === 'cancel' || data === 'cancel_input') {
            await env.QUEUE.delete(`status:${chatId}`);
            await env.QUEUE.delete(`request:${chatId}`);
            await env.QUEUE.delete(`state:${chatId}`);
            let queue = await env.QUEUE.get('queue', 'json');
            if (queue) {
              const newQueue = queue.filter(id => id !== chatId);
              await env.QUEUE.put('queue', JSON.stringify(newQueue));
            }
            await sendMessageSimple(chatId, "❌ عملیات لغو شد. در صورت نیاز دوباره شروع کنید.", TELEGRAM_TOKEN);
          }
          return new Response('OK');
        }
        
        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim();
          const GITHUB_TOKEN = env.GH_TOKEN;
          const GITHUB_OWNER = 'gptmoone';
          const GITHUB_REPO = 'telegram-file-downloader';
          
          if (text === '/start') {
            const keyboard = {
              inline_keyboard: [
                [{ text: "📥 ارسال لینک جدید", callback_data: "new_link" }],
                [{ text: "❓ راهنما", callback_data: "help" }],
                [{ text: "🚫 لغو درخواست فعال", callback_data: "cancel" }]
              ]
            };
            const startText = `🌀 <b>به ربات دانلودر خوش آمدید</b> 🌀\n\n` +
              `من فایل را از لینک مستقیم دانلود کرده، به تکه‌های ۹۵ مگابایتی تقسیم می‌کنم و در گیت‌هاب آپلود می‌کنم.\n\n` +
              `🔹 <b>مراحل:</b>\n` +
              `1️⃣ لینک مستقیم فایل را بفرستید\n` +
              `2️⃣ یک رمز عبور برای ZIP انتخاب کنید\n` +
              `3️⃣ منتظر بمانید تا پردازش شود\n` +
              `4️⃣ لینک دانلود (تا ۳ ساعت معتبر) را دریافت کنید\n\n` +
              `👇 با دکمه زیر شروع کنید`;
            await sendMessage(chatId, startText, keyboard, TELEGRAM_TOKEN);
            return new Response('OK');
          }
          
          const currentStatus = await env.QUEUE.get(`status:${chatId}`);
          if (currentStatus && currentStatus !== 'done' && currentStatus !== 'cancelled') {
            await sendMessageSimple(chatId,
              `⚠️ شما یک درخواست فعال دارید (وضعیت: ${currentStatus === 'waiting' ? 'در صف انتظار' : 'در حال پردازش'})\nلطفاً صبر کنید یا از دکمه لغو استفاده کنید.`,
              TELEGRAM_TOKEN
            );
            return new Response('OK');
          }
          
          const userStateRaw = await env.QUEUE.get(`state:${chatId}`);
          if (!userStateRaw) {
            if (text.match(/^https?:\/\//)) {
              await env.QUEUE.put(`state:${chatId}`, JSON.stringify({ step: 'awaiting_password', url: text }), { expirationTtl: 3600 });
              const cancelKeyboard = {
                inline_keyboard: [[{ text: "❌ لغو عملیات", callback_data: "cancel_input" }]]
              };
              await sendMessage(chatId,
                "✅ لینک دریافت شد.\n\n🔐 <b>مرحله دوم:</b> رمز عبور فایل ZIP را وارد کنید.\nاین رمز برای باز کردن فایل نهایی لازم است. حتماً آن را حفظ کنید.",
                cancelKeyboard, TELEGRAM_TOKEN
              );
            } else {
              await sendMessageSimple(chatId, "❌ لطفاً یک لینک معتبر (با http:// یا https://) ارسال کنید.", TELEGRAM_TOKEN);
            }
            return new Response('OK');
          }
          
          const userState = JSON.parse(userStateRaw);
          if (userState.step === 'awaiting_password') {
            const password = text;
            const fileUrl = userState.url;
            
            let queue = await env.QUEUE.get('queue', 'json');
            if (!queue || !Array.isArray(queue)) queue = [];
            queue.push(chatId);
            await env.QUEUE.put('queue', JSON.stringify(queue));
            
            await env.QUEUE.put(`request:${chatId}`, JSON.stringify({ url: fileUrl, password: password, timestamp: Date.now() }));
            await env.QUEUE.put(`status:${chatId}`, 'waiting');
            await env.QUEUE.delete(`state:${chatId}`);
            
            await sendMessageSimple(chatId,
              `⏳ درخواست شما در صف قرار گرفت. شماره صف: ${queue.length}\n\nبه محض آزاد شدن سرور، فایل شما پردازش خواهد شد.`,
              TELEGRAM_TOKEN
            );
            
            processQueue(env, TELEGRAM_TOKEN, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO).catch(err => console.error(err));
            return new Response('OK');
          }
        }
        return new Response('OK');
      } catch (err) {
        console.error(err);
        return new Response('Error', { status: 500 });
      }
    }
    return new Response('Bot is running', { status: 200 });
  }
};

async function processQueue(env, TELEGRAM_TOKEN, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO) {
  let queue = await env.QUEUE.get('queue', 'json');
  if (!queue || queue.length === 0) return;
  
  const chatId = queue[0];
  const status = await env.QUEUE.get(`status:${chatId}`);
  if (status !== 'waiting') return;
  
  await env.QUEUE.put(`status:${chatId}`, 'processing');
  await sendMessageSimple(chatId, "🔄 در حال پردازش فایل روی گیت‌هاب... ممکن است چند دقیقه طول بکشد.", TELEGRAM_TOKEN);
  
  const requestData = await env.QUEUE.get(`request:${chatId}`, 'json');
  if (!requestData) {
    await removeFromQueue(env, chatId);
    await sendMessageSimple(chatId, "❌ خطا: اطلاعات درخواست یافت نشد.", TELEGRAM_TOKEN);
    return;
  }
  
  const userId = `${chatId}_${Date.now()}`;
  
  console.log(`Sending request to GitHub for user ${userId}`);
  
  const workflowResponse = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/download.yml/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'CloudflareWorker'
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: {
        file_url: requestData.url,
        zip_password: requestData.password,
        user_id: userId
      }
    })
  });
  
  console.log(`GitHub API response status: ${workflowResponse.status}`);
  
  if (!workflowResponse.ok) {
    const errorText = await workflowResponse.text();
    console.error(`GitHub API error: ${errorText}`);
    await sendMessageSimple(chatId, `❌ خطا در ارتباط با گیت‌هاب: ${workflowResponse.status}\nلطفاً بعداً تلاش کنید.`, TELEGRAM_TOKEN);
    await removeFromQueue(env, chatId);
    await env.QUEUE.delete(`status:${chatId}`);
    return;
  }
  
  let branchName = null;
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    branchName = await env.QUEUE.get(`branch:${chatId}`);
    if (branchName) break;
  }
  
  if (branchName) {
    const downloadLink = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/${branchName}.zip`;
    await sendMessageSimple(chatId,
      `✅ فایل شما آماده شد!\n\n🔗 لینک دانلود (تا ۳ ساعت معتبر):\n${downloadLink}\n\n⚠️ برای باز کردن، از رمز عبوری که خودتان انتخاب کردید استفاده کنید.\n\n📌 نکته: این لینک با نت ملی و بدون فیلترشکن قابل دانلود است.`,
      TELEGRAM_TOKEN
    );
    await env.QUEUE.put(`status:${chatId}`, 'done');
    await removeFromQueue(env, chatId);
  } else {
    await sendMessageSimple(chatId, "❌ متأسفانه عملیات با خطا مواجه شد (زمان انتظار تمام شد). لطفاً دقایقی دیگر تلاش کنید.", TELEGRAM_TOKEN);
    await env.QUEUE.delete(`status:${chatId}`);
    await removeFromQueue(env, chatId);
  }
}

async function removeFromQueue(env, chatId) {
  let queue = await env.QUEUE.get('queue', 'json');
  if (queue) {
    const newQueue = queue.filter(id => id !== chatId);
    await env.QUEUE.put('queue', JSON.stringify(newQueue));
  }
  await env.QUEUE.delete(`request:${chatId}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
