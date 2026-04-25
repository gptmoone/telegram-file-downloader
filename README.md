
# ربات دانلودر اینترنت ملی (MeliDownload)

این ربات تلگرام لینک‌های مستقیم فایل‌ها را دریافت کرده، آن‌ها را به تکه‌های ۹۵ مگابایتی تقسیم می‌کند و در یک مخزن عمومی گیت‌هاب آپلود می‌کند. سپس لینک قابل دانلود با **اینترنت ملی** (بدون نیاز به فیلترشکن) در اختیار کاربر قرار می‌گیرد.

## ✨ ویژگی‌ها
- تبدیل لینک مستقیم به لینک قابل دانلود در ایران
- تقسیم فایل‌های حجیم به تکه‌های ۹۵ مگابایتی (برای عبور از محدودیت گیت‌هاب)
- رمزگذاری فایل‌ها با رمز انتخابی کاربر
- صف هوشمند با قابلیت اجرای همزمان (تا ۱۰ کار)
- حذف خودکار فایل‌ها بعد از ۳ ساعت (با cron job)
- نمایش آمار لحظه‌ای (تعداد کاربران، لینک‌های ساخته شده، حجم کل دانلود)
- دکمه‌های شیشه‌ای برای تعامل راحت
- بدون نیاز به فیلترشکن برای دانلود نهایی

## 🛠 پیش‌نیازها
- یک حساب [Cloudflare](https://cloudflare.com) (رایگان)
- یک حساب [GitHub](https://github.com) (رایگان)
- یک ربات تلگرام ساخته‌شده توسط [@BotFather](https://t.me/BotFather)

## 🚀 راه‌اندازی گام‌به‌گام

### 1️⃣ دریافت توکن ربات تلگرام
1. در تلگرام به [@BotFather](https://t.me/BotFather) بروید.
2. دستور `/newbot` را بزنید و نام و یوزرنیم ربات را انتخاب کنید.
3. توکن دریافتی (مثل `123456:ABCdef...`) را ذخیره کنید.

### 2️⃣ ساخت مخزن گیت‌هاب و دریافت توکن دسترسی (GH_TOKEN)
1. در گیت‌هاب یک مخزن جدید بسازید (مثلاً `telegram-file-downloader`).
2. به **Settings > Developer settings > Personal access tokens > Tokens (classic)** بروید.
3. روی **Generate new token (classic)** کلیک کنید.
4. نام `bot-token` و تیک گزینه‌های `repo` و `workflow` را بزنید.
5. توکن ساخته‌شده (شبیه `github_pat_...`) را کپی کنید. (**این توکن فقط یک بار دیده می‌شود**)

### 3️⃣ راه‌اندازی Cloudflare D1 (پایگاه داده)
1. وارد [Cloudflare Dashboard](https://dash.cloudflare.com/) شوید.
2. از منوی چپ به **Workers & Pages > D1** بروید.
3. روی **Create database** کلیک کنید و نام `telegram-bot-db` را وارد کنید.
4. پس از ایجاد، وارد دیتابیس شوید و برگه **Console** را باز کنید.
5. کوئری‌های زیر را یکی‌یکی اجرا کنید:

```sql
CREATE TABLE IF NOT EXISTS users (
    chat_id TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL
);
```

```sql
CREATE TABLE IF NOT EXISTS global_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_links INTEGER DEFAULT 0,
    total_volume_gb REAL DEFAULT 0
);
```

```sql
INSERT OR IGNORE INTO global_stats (id, total_links, total_volume_gb) VALUES (1, 0, 0);
```

```sql
CREATE TABLE IF NOT EXISTS user_state (
    chat_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    request_data TEXT,
    branch_name TEXT,
    started_at INTEGER,
    total_chunks INTEGER,
    uploaded_chunks INTEGER
);
```

```sql
CREATE TABLE IF NOT EXISTS queue (
    position INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    file_url TEXT NOT NULL,
    zip_password TEXT NOT NULL,
    file_size INTEGER,
    need_cleanup INTEGER DEFAULT 0,
    enqueued_at INTEGER NOT NULL
);
```

```sql
CREATE INDEX IF NOT EXISTS idx_queue_chat_id ON queue(chat_id);
```

```sql
CREATE TABLE IF NOT EXISTS active_branches (
    branch_name TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
```

```sql
CREATE INDEX IF NOT EXISTS idx_active_branches_chat_id ON active_branches(chat_id);
```

4️⃣ ساخت Worker در Cloudflare

1. به Workers & Pages بروید و روی Create application > Create Worker کلیک کنید.
2. نام Worker را telegram-file-bot بگذارید.
3. روی Deploy کلیک کنید (بعداً کد را جایگزین می‌کنیم).

5️⃣ اتصال D1 به Worker (Binding)

1. در Worker خود، به برگه Settings > Bindings بروید.
2. روی Add binding کلیک کنید.
3. Type: D1 database را انتخاب کنید.
4. Variable name: DB را وارد کنید.
5. D1 database: دیتابیسی که ساختید (telegram-bot-db) را انتخاب کنید.
6. روی Deploy کلیک کنید.

6️⃣ اضافه کردن متغیرهای محیطی

در همان صفحه Settings > Variables، متغیرهای زیر را به صورت Plain text اضافه کنید:

Variable name Value
TELEGRAM_TOKEN توکن ربات تلگرام (از مرحله 1)
GH_TOKEN توکن گیت‌هاب (از مرحله 2)
ADMIN_SECRET یک رمز دلخواه برای دستور /resetstats (اختیاری)

پس از افزودن، روی Save and Deploy کلیک کنید.

7️⃣ جایگزینی کد Worker با کد نهایی

1. در Worker خود، روی Edit code کلیک کنید.
2. تمام کد موجود را پاک کنید.
3. کد زیر را کامل کپی کرده و جایگزین کنید:

```javascript
// کد کامل worker.js (حدود 650 خط)
// لطفاً کد نهایی را از فایل پیوست شده در مخزن کپی کنید
// یا از آخرین نسخه موجود در مخزن اصلی استفاده کنید
```

نکته: کد کامل worker.js بسیار طولانی است. برای راحتی، فایل آن در مخزن گیت‌هاب قرار دارد. می‌توانید از این لینک آن را دانلود کنید.

8️⃣ تنظیم Webhook تلگرام

آدرس Worker شما چیزی شبیه https://telegram-file-bot.نام-زیردامنه.workers.dev است. برای تنظیم Webhook، لینک زیر را در مرورگر باز کنید (به جای <TOKEN> توکن خود را بگذارید و آدرس Worker را اصلاح کنید):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://telegram-file-bot.گزارش-زیردامنه.workers.dev/bot<TOKEN>
```

مثال (با استفاده از زیردامنه پیش‌فرض gptmoone):

```
https://api.telegram.org/bot123456:ABCdef/setWebhook?url=https://telegram-file-bot.gptmoone.workers.dev/bot123456:ABCdef
```

9️⃣ اضافه کردن فایل‌های GitHub Actions به مخزن

در مخزن گیت‌هاب خود، پوشه .github/workflows/ را ایجاد کنید و فایل‌های زیر را با محتوای مشخص شده بسازید.

فایل .github/workflows/download.yml

```yaml
name: Download and Split for User

on:
  workflow_dispatch:
    inputs:
      file_url:
        description: 'لینک مستقیم فایل'
        required: true
        type: string
      zip_password:
        description: 'رمز عبور ZIP'
        required: true
        type: string
      user_id:
        description: 'شناسه کاربر'
        required: true
        type: string

permissions:
  contents: write

jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - name: Notify Worker that job started
        run: |
          curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/started" \
            -H "Content-Type: application/json" \
            -d "{\"user_id\":\"${{ github.event.inputs.user_id }}\"}"

      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install 7z
        run: sudo apt-get update && sudo apt-get install -y p7zip-full

      - name: Download file with original name
        run: |
          ORIGINAL_NAME=$(basename "${{ github.event.inputs.file_url }}" | cut -d '?' -f1)
          if [ -z "$ORIGINAL_NAME" ]; then
            ORIGINAL_NAME="downloaded_file"
          fi
          echo "ORIGINAL_NAME=$ORIGINAL_NAME" >> $GITHUB_ENV
          curl -L --fail --retry 3 -o "$ORIGINAL_NAME" "${{ github.event.inputs.file_url }}"

      - name: Create archive chunks (95MB each)
        run: |
          7z a -p"${{ github.event.inputs.zip_password }}" -mhe=on -mx=3 -v95m "archive.7z" "${{ env.ORIGINAL_NAME }}"

      - name: Clean up original file
        run: rm -f "${{ env.ORIGINAL_NAME }}"

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Get total chunks count
        id: chunks
        run: |
          CHUNKS=$(ls archive.7z.* 2>/dev/null | wc -l)
          echo "total_chunks=$CHUNKS" >> $GITHUB_OUTPUT

      - name: Notify Worker about total chunks
        run: |
          curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/progress" \
            -H "Content-Type: application/json" \
            -d "{\"user_id\":\"${{ github.event.inputs.user_id }}\", \"total_chunks\":${{ steps.chunks.outputs.total_chunks }}}"

      - name: Create user branch
        run: |
          BRANCH_NAME="user_${{ github.event.inputs.user_id }}_$(date +%s)"
          git checkout --orphan "$BRANCH_NAME"
          git rm -rf --ignore-unmatch . 2>/dev/null || true
          echo "# Files for user ${{ github.event.inputs.user_id }}" > README.md
          chunks=(archive.7z.*)
          total=${#chunks[@]}
          batch_size=2
          start=0
          uploaded=0
          while [ $start -lt $total ]; do
            end=$((start + batch_size - 1))
            [ $end -ge $total ] && end=$((total - 1))
            for i in $(seq $start $end); do
              git add "${chunks[$i]}"
            done
            git add README.md
            git commit -m "Add chunks $((start+1))-$((end+1)) of $total"
            for attempt in {1..5}; do
              if git push origin "$BRANCH_NAME"; then
                echo "Push successful for chunks $((start+1))-$((end+1))"
                uploaded=$((end+1))
                break
              else
                echo "Push failed (attempt $attempt), retrying in 10 seconds..."
                sleep 10
              fi
            done
            curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/progress" \
              -H "Content-Type: application/json" \
              -d "{\"user_id\":\"${{ github.event.inputs.user_id }}\", \"uploaded_chunks\":$uploaded}"
            start=$((end + 1))
            sleep 2
          done
          echo "BRANCH_NAME=$BRANCH_NAME" >> $GITHUB_ENV

      - name: Notify Worker that job is done
        run: |
          curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/complete" \
            -H "Content-Type: application/json" \
            -d "{\"user_id\":\"${{ github.event.inputs.user_id }}\", \"branch\":\"${{ env.BRANCH_NAME }}\"}"

      - name: Notify Worker on failure
        if: failure()
        run: |
          curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/failed" \
            -H "Content-Type: application/json" \
            -d "{\"user_id\":\"${{ github.event.inputs.user_id }}\", \"error\":\"Workflow failed\"}"
```

فایل .github/workflows/cleanup.yml

```yaml
name: Clean expired branches

on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:

jobs:
  delete:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Delete branches older than 3 hours
        run: |
          NOW=$(date +%s)
          THREE_HOURS_AGO=$((NOW - 10800))
          git branch -r | grep 'origin/user_' | while read branch; do
            timestamp=$(echo "$branch" | grep -oP 'user_.*_\K\d+')
            if [[ -n "$timestamp" ]] && [[ "$timestamp" -lt "$THREE_HOURS_AGO" ]]; then
              branch_name=${branch#origin/}
              echo "Deleting $branch_name (created at $timestamp)"
              git push origin --delete "$branch_name"
              USER_ID=$(echo "$branch_name" | sed 's/user_\(.*\)_.*/\1/')
              curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/cleanup" \
                -H "Content-Type: application/json" \
                -d "{\"user_id\":\"$USER_ID\"}"
            fi
          done
```

فایل .github/workflows/deploy.yml (برای دیپلوی خودکار Worker)

```yaml
name: Deploy Worker

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          command: deploy worker.js --name telegram-file-bot --compatibility-date 2026-04-24 --var TELEGRAM_TOKEN:${{ secrets.TELEGRAM_TOKEN }} GH_TOKEN:${{ secrets.GH_TOKEN }}
```

🔟 تنظیم سکرت‌های مخزن گیت‌هاب برای دیپلوی خودکار

در مخزن گیت‌هاب خود به Settings > Secrets and variables > Actions بروید و سکرت‌های زیر را بسازید:

Name Value
CF_API_TOKEN توکن API کلودفلر (ساخت آن در مرحله 11)
CF_ACCOUNT_ID Account ID کلودفلر (از صفحه Workers & Pages)
TELEGRAM_TOKEN توکن ربات تلگرام
GH_TOKEN توکن گیت‌هاب (همان مرحله 2)

1️⃣1️⃣ ساخت توکن API کلودفلر (CF_API_TOKEN)

1. در Cloudflare Dashboard به My Profile > API Tokens بروید.
2. روی Create Token کلیک کنید.
3. الگو (Template) Edit Cloudflare Workers را انتخاب کنید.
4. نام دلخواه بگذارید و روی Continue to summary و سپس Create Token کلیک کنید.
5. توکن ساخته‌شده را کپی کنید و در سکرت CF_API_TOKEN در گیت‌هاب قرار دهید.

1️⃣2️⃣ دریافت Account ID کلودفلر (CF_ACCOUNT_ID)

1. در Cloudflare Dashboard به Workers & Pages بروید.
2. در صفحه اصلی، در بخش Account Details مقدار Account ID را کپی کنید.

1️⃣3️⃣ دیپلوی نهایی

پس از انجام تمام مراحل بالا:

1. تمام فایل‌ها (worker.js, .github/workflows/download.yml, .github/workflows/cleanup.yml, .github/workflows/deploy.yml) را به مخزن گیت‌هاب خود commit و push کنید.
2. GitHub Actions به طور خودکار فایل deploy.yml را اجرا کرده و Worker را دیپلوی می‌کند.
3. پس از اتمام، ربات را در تلگرام /start کنید.

📌 دستورات ربات

دستور / دکمه توضیح
/start نمایش پیام خوش‌آمدگویی و منو
📥 لینک جدید لغو درخواست قبلی و آماده دریافت لینک جدید
📊 آمار لحظه‌ای نمایش آمار کاربران، صف، لینک‌های ساخته شده و حجم مخزن
📊 وضعیت من نمایش وضعیت درخواست فعلی کاربر (در حال پردازش، صف، آماده)
❓ راهنما نمایش راهنمای کامل استفاده
🗑️ حذف فایل من حذف فایل آپلود شده‌ی کاربر از سرور (پس از دانلود)

⚙️ نکات فنی

· محدودیت حجم فایل: حداکثر ۲ گیگابایت.
· مدت اعتبار لینک: ۳ ساعت (پس از آن فایل حذف می‌شود).
· تعداد همزمانی: حداکثر ۱۰ فایل به صورت همزمان پردازش می‌شوند.
· ذخیره‌سازی: فایل‌ها در مخزن عمومی گیت‌هاب به صورت شاخه‌های جداگانه ذخیره می‌شوند.
· قابلیت اطمینان: بدون محدودیت KV، با استفاده از Cloudflare D1 و GitHub Actions.

❗ عیب‌یابی رایج

ربات پاسخ نمی‌دهد

· بررسی کنید Webhook به درستی تنظیم شده باشد:
  ```bash
  https://api.telegram.org/bot<TOKEN>/getWebhookInfo
  ```
· لاگ‌های Worker را در Cloudflare (بخش Logs) بررسی کنید.

پیام «شما یک درخواست فعال دارید»

با کلیک روی «لینک جدید» درخواست قبلی خودکار لغو می‌شود. اگر همچنان خطا می‌دهید، دستور /resetstats <ADMIN_SECRET> را به ربات بفرستید.

حجم مخزن زیاد شده است

· کاربران را تشویق کنید پس از دانلود، از دکمه «حذف فایل من» استفاده کنند.
· cron job cleanup.yml هر ۵ دقیقه شاخه‌های قدیمی (بیش از ۳ ساعت) را حذف می‌کند.

📄 مجوز

این پروژه تحت مجوز MIT منتشر شده است. استفاده شخصی و تجاری آزاد است.

🤝 مشارکت

برای گزارش باگ یا پیشنهاد بهبود، لطفاً یک Issue در مخزن باز کنید. خوشحال می‌شویم از ایده‌های شما استقبال کنیم.

🌐 ارتباط با ما

· کانال تلگرام: @maramivpn


---

شما می‌توانید با خیال راحت از این ربات برای دانلود فایل‌های خود با اینترنت ملی استفاده کنید. 🚀





 National Internet Downloader Bot (MeliDownload)

This Telegram bot receives direct file links, splits them into 95MB chunks, uploads them to a public GitHub repository, and returns a downloadable link that works with **Iran's national internet** (no VPN/filtering required).

## ✨ Features
- Convert any direct link to a national-internet downloadable link
- Split large files into 95MB chunks (bypass GitHub file size limit)
- Password-protected ZIP archives (user-chosen password)
- Smart queue with concurrent processing (up to 10 simultaneous jobs)
- Automatic file deletion after 3 hours (via cron job)
- Real‑time statistics (total users, links created, total downloaded volume)
- Inline keyboard buttons for easy interaction
- No VPN needed for final download

## 🛠 Prerequisites
- A [Cloudflare](https://cloudflare.com) account (free tier works)
- A [GitHub](https://github.com) account (free)
- A Telegram bot created via [@BotFather](https://t.me/BotFather)

## 🚀 Step‑by‑Step Setup

### 1️⃣ Get Telegram Bot Token
1. Open [@BotFather](https://t.me/BotFather) on Telegram.
2. Send `/newbot` and choose a name and username.
3. Copy the token (e.g., `123456:ABCdef...`). Save it.

### 2️⃣ Create GitHub Repository & Personal Access Token (GH_TOKEN)
1. Create a new repository on GitHub (e.g., `telegram-file-downloader`).
2. Go to **Settings > Developer settings > Personal access tokens > Tokens (classic)**.
3. Click **Generate new token (classic)**.
4. Name it `bot-token`, select scopes: `repo` (all) and `workflow`.
5. Copy the generated token (starts with `github_pat_...` or `ghp_...`). **Save it – you won't see it again.**

### 3️⃣ Set Up Cloudflare D1 Database
1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Go to **Workers & Pages > D1**.
3. Click **Create database**, name it `telegram-bot-db`.
4. After creation, open the database and go to the **Console** tab.
5. Execute the following SQL statements one by one:

```sql
CREATE TABLE IF NOT EXISTS users (
    chat_id TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL
);
```

```sql
CREATE TABLE IF NOT EXISTS global_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_links INTEGER DEFAULT 0,
    total_volume_gb REAL DEFAULT 0
);
```

```sql
INSERT OR IGNORE INTO global_stats (id, total_links, total_volume_gb) VALUES (1, 0, 0);
```

```sql
CREATE TABLE IF NOT EXISTS user_state (
    chat_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    request_data TEXT,
    branch_name TEXT,
    started_at INTEGER,
    total_chunks INTEGER,
    uploaded_chunks INTEGER
);
```

```sql
CREATE TABLE IF NOT EXISTS queue (
    position INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    file_url TEXT NOT NULL,
    zip_password TEXT NOT NULL,
    file_size INTEGER,
    need_cleanup INTEGER DEFAULT 0,
    enqueued_at INTEGER NOT NULL
);
```

```sql
CREATE INDEX IF NOT EXISTS idx_queue_chat_id ON queue(chat_id);
```

```sql
CREATE TABLE IF NOT EXISTS active_branches (
    branch_name TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
```

```sql
CREATE INDEX IF NOT EXISTS idx_active_branches_chat_id ON active_branches(chat_id);
```

4️⃣ Create a Cloudflare Worker

1. In Cloudflare Dashboard, go to Workers & Pages.
2. Click Create application > Create Worker.
3. Name it telegram-file-bot and click Deploy (we will replace the code later).

5️⃣ Bind D1 Database to the Worker

1. Open your Worker (telegram-file-bot).
2. Go to Settings > Bindings.
3. Click Add binding.
   · Type: D1 database
   · Variable name: DB
   · D1 database: select telegram-bot-db
4. Click Deploy.

6️⃣ Add Environment Variables

In the same Worker Settings > Variables, add these plain text variables:

Variable name Value
TELEGRAM_TOKEN Your Telegram bot token (from step 1)
GH_TOKEN GitHub personal access token (step 2)
ADMIN_SECRET A random secret for /resetstats command (optional)

Click Save and Deploy after adding them.

7️⃣ Replace Worker Code with the Final Script

1. Go to your Worker’s Edit code.
2. Delete the default code.
3. Copy the full worker.js code from below (or from the repository) and paste it.

<details>
<summary><b>Click to show full worker.js code (approx. 620 lines)</b></summary>

```javascript
// ==========================================
// Full worker.js code – copy exactly
// ==========================================
// ... (the complete code from the final answer)
```

For brevity, place the complete worker.js code here. Since it's very long, you can also store it in your repository and reference it. The code must be exactly the same as provided in the last response of this conversation.

</details>

8️⃣ Set Telegram Webhook

Your Worker URL is like https://telegram-file-bot.YOUR_SUBDOMAIN.workers.dev. Replace <TOKEN> and the URL accordingly and open this link in a browser:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://telegram-file-bot.YOUR_SUBDOMAIN.workers.dev/bot<TOKEN>
```

Example (assuming your Cloudflare subdomain is gptmoone):

```
https://api.telegram.org/bot123456:ABCdef/setWebhook?url=https://telegram-file-bot.gptmoone.workers.dev/bot123456:ABCdef
```

9️⃣ Add GitHub Actions Workflows to Your Repository

Create the following files inside .github/workflows/ in your GitHub repository.

File: .github/workflows/download.yml

```yaml
name: Download and Split for User

on:
  workflow_dispatch:
    inputs:
      file_url:
        description: 'Direct file link'
        required: true
        type: string
      zip_password:
        description: 'ZIP password'
        required: true
        type: string
      user_id:
        description: 'User ID'
        required: true
        type: string

permissions:
  contents: write

jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - name: Notify Worker that job started
        run: |
          curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/started" \
            -H "Content-Type: application/json" \
            -d "{\"user_id\":\"${{ github.event.inputs.user_id }}\"}"

      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install 7z
        run: sudo apt-get update && sudo apt-get install -y p7zip-full

      - name: Download file with original name
        run: |
          ORIGINAL_NAME=$(basename "${{ github.event.inputs.file_url }}" | cut -d '?' -f1)
          if [ -z "$ORIGINAL_NAME" ]; then
            ORIGINAL_NAME="downloaded_file"
          fi
          echo "ORIGINAL_NAME=$ORIGINAL_NAME" >> $GITHUB_ENV
          curl -L --fail --retry 3 -o "$ORIGINAL_NAME" "${{ github.event.inputs.file_url }}"

      - name: Create archive chunks (95MB each)
        run: |
          7z a -p"${{ github.event.inputs.zip_password }}" -mhe=on -mx=3 -v95m "archive.7z" "${{ env.ORIGINAL_NAME }}"

      - name: Clean up original file
        run: rm -f "${{ env.ORIGINAL_NAME }}"

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Get total chunks count
        id: chunks
        run: |
          CHUNKS=$(ls archive.7z.* 2>/dev/null | wc -l)
          echo "total_chunks=$CHUNKS" >> $GITHUB_OUTPUT

      - name: Notify Worker about total chunks
        run: |
          curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/progress" \
            -H "Content-Type: application/json" \
            -d "{\"user_id\":\"${{ github.event.inputs.user_id }}\", \"total_chunks\":${{ steps.chunks.outputs.total_chunks }}}"

      - name: Create user branch
        run: |
          BRANCH_NAME="user_${{ github.event.inputs.user_id }}_$(date +%s)"
          git checkout --orphan "$BRANCH_NAME"
          git rm -rf --ignore-unmatch . 2>/dev/null || true
          echo "# Files for user ${{ github.event.inputs.user_id }}" > README.md
          chunks=(archive.7z.*)
          total=${#chunks[@]}
          batch_size=2
          start=0
          uploaded=0
          while [ $start -lt $total ]; do
            end=$((start + batch_size - 1))
            [ $end -ge $total ] && end=$((total - 1))
            for i in $(seq $start $end); do
              git add "${chunks[$i]}"
            done
            git add README.md
            git commit -m "Add chunks $((start+1))-$((end+1)) of $total"
            for attempt in {1..5}; do
              if git push origin "$BRANCH_NAME"; then
                echo "Push successful for chunks $((start+1))-$((end+1))"
                uploaded=$((end+1))
                break
              else
                echo "Push failed (attempt $attempt), retrying in 10 seconds..."
                sleep 10
              fi
            done
            curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/progress" \
              -H "Content-Type: application/json" \
              -d "{\"user_id\":\"${{ github.event.inputs.user_id }}\", \"uploaded_chunks\":$uploaded}"
            start=$((end + 1))
            sleep 2
          done
          echo "BRANCH_NAME=$BRANCH_NAME" >> $GITHUB_ENV

      - name: Notify Worker that job is done
        run: |
          curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/complete" \
            -H "Content-Type: application/json" \
            -d "{\"user_id\":\"${{ github.event.inputs.user_id }}\", \"branch\":\"${{ env.BRANCH_NAME }}\"}"

      - name: Notify Worker on failure
        if: failure()
        run: |
          curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/failed" \
            -H "Content-Type: application/json" \
            -d "{\"user_id\":\"${{ github.event.inputs.user_id }}\", \"error\":\"Workflow failed\"}"
```

File: .github/workflows/cleanup.yml

```yaml
name: Clean expired branches

on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:

jobs:
  delete:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Delete branches older than 3 hours
        run: |
          NOW=$(date +%s)
          THREE_HOURS_AGO=$((NOW - 10800))
          git branch -r | grep 'origin/user_' | while read branch; do
            timestamp=$(echo "$branch" | grep -oP 'user_.*_\K\d+')
            if [[ -n "$timestamp" ]] && [[ "$timestamp" -lt "$THREE_HOURS_AGO" ]]; then
              branch_name=${branch#origin/}
              echo "Deleting $branch_name (created at $timestamp)"
              git push origin --delete "$branch_name"
              USER_ID=$(echo "$branch_name" | sed 's/user_\(.*\)_.*/\1/')
              curl -X POST "https://telegram-file-bot.gptmoone.workers.dev/api/cleanup" \
                -H "Content-Type: application/json" \
                -d "{\"user_id\":\"$USER_ID\"}"
            fi
          done
```

File: .github/workflows/deploy.yml (for automatic Worker deployment)

```yaml
name: Deploy Worker

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          command: deploy worker.js --name telegram-file-bot --compatibility-date 2026-04-24 --var TELEGRAM_TOKEN:${{ secrets.TELEGRAM_TOKEN }} GH_TOKEN:${{ secrets.GH_TOKEN }}
```

🔟 Add GitHub Secrets for Auto‑Deployment

In your GitHub repository, go to Settings > Secrets and variables > Actions and create the following secrets:

Name Value
CF_API_TOKEN Cloudflare API token (see next step)
CF_ACCOUNT_ID Your Cloudflare Account ID (from Workers & Pages page)
TELEGRAM_TOKEN Your Telegram bot token
GH_TOKEN Your GitHub personal access token (from step 2)

1️⃣1️⃣ Create Cloudflare API Token (CF_API_TOKEN)

1. In Cloudflare Dashboard, go to My Profile > API Tokens.
2. Click Create Token.
3. In the Templates section, select Edit Cloudflare Workers.
4. Give it a name (e.g., worker-deploy), then click Continue to summary and Create Token.
5. Copy the token immediately and store it as CF_API_TOKEN in GitHub secrets.

1️⃣2️⃣ Get Cloudflare Account ID (CF_ACCOUNT_ID)

1. In Cloudflare Dashboard, go to Workers & Pages.
2. On the right side, under Account Details, copy the Account ID.

1️⃣3️⃣ Final Deployment

1. Commit and push all files to your GitHub repository:
   · worker.js
   · .github/workflows/download.yml
   · .github/workflows/cleanup.yml
   · .github/workflows/deploy.yml
2. GitHub Actions will automatically run the Deploy Worker workflow.
3. Once finished, open Telegram and start your bot with /start.

📌 Bot Commands & Buttons

Command / Button Description
/start Shows welcome message and main menu.
📥 New Link Cancels any pending request and asks for a new direct link.
📊 Live Stats Shows total users, active jobs, queue length, total links created, volume.
📊 My Status Displays current request status (processing, waiting, ready).
❓ Help Shows detailed instructions.
🗑️ Delete My File Deletes the uploaded file from the server (after download).

⚙️ Technical Notes

· File size limit: 2 GB per file.
· Link validity: 3 hours (file auto‑deleted after that).
· Concurrent processing: Up to 10 files simultaneously (adjustable).
· Storage: Files are stored as separate branches in your public GitHub repo.
· No KV limits: Uses Cloudflare D1 database instead of KV.

❗ Troubleshooting

Bot does not respond

· Verify the webhook is set correctly:
  ```
  https://api.telegram.org/bot<TOKEN>/getWebhookInfo
  ```
· Check Worker logs in Cloudflare ( Workers & Pages > telegram-file-bot > Logs ).

"You already have an active request" message

· Click the New Link button – it automatically cancels any previous request.
· If the message persists, use the admin command (if you set ADMIN_SECRET):
  ```
  /resetstats <ADMIN_SECRET>
  ```

Repository size growing too fast

· Encourage users to click Delete My File after downloading.
· The cron job (cleanup.yml) runs every 5 minutes and deletes branches older than 3 hours.

📄 License

MIT – free for personal and commercial use.

🤝 Contributing

Issues and pull requests are welcome. Feel free to improve the bot!

🌐 Contact

· Telegram channel: @maramivpn

---

Now you can enjoy downloading files using your national internet without any VPN! 🚀

```
