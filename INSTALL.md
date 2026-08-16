# راهنمای نصب روی VPS لینوکس

این راهنما برای نصب پنل مدیریت کمپین واتساپ روی سرور لینوکس است. پورت برنامه **9454** است.

## پیش‌نیاز

- Ubuntu 22.04+ یا Debian 12+
- Node.js 20 یا 22
- اختیاری: Docker + Docker Compose
- اختیاری: Nginx برای Reverse Proxy و SSL

---

## 1. Clone

```bash
sudo apt update
sudo apt install -y git curl build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/Siahgoosh/whatsapp-managing.git
cd whatsapp-managing
```

---

## 2. Install dependencies

```bash
chmod +x scripts/*.sh
./scripts/install.sh
```

یا دستی:

```bash
npm install
npm --prefix frontend install
npm --prefix frontend run build
```

---

## 3. Configure `.env`

```bash
cp .env.example .env
nano .env
```

حتماً این موارد را عوض کنید:

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=یک-رمز-قوی
SESSION_SECRET=یک-رشته-تصادفی-بلند
APP_URL=https://your-domain.example
CORS_ORIGIN=https://your-domain.example
PORT=9454
```

اختیاری:

```
AI_ENABLED=true
AI_API_KEY=...
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

---

## 4. Database

دیتابیس SQLite در مسیر زیر به‌صورت خودکار ساخته می‌شود:

```
database/app.sqlite
```

پوشه را از قبل بسازید:

```bash
mkdir -p database uploads logs sessions
```

نیازی به نصب Postgres/MySQL نیست.

---

## 5. Start

بدون Docker:

```bash
./scripts/start.sh
```

توقف / راه‌اندازی مجدد:

```bash
./scripts/stop.sh
./scripts/restart.sh
```

با Docker:

```bash
docker compose up -d
```

بررسی سلامت:

```bash
curl http://127.0.0.1:9454/health
```

---

## 6. Open port 9454

اگر بدون Reverse Proxy استفاده می‌کنید:

```bash
sudo ufw allow 9454/tcp
sudo ufw reload
```

سپس در مرورگر:

`http://SERVER-IP:9454`

---

## 7. Reverse Proxy

نمونه Nginx:

```nginx
server {
    listen 80;
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:9454;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 20m;
    }
}
```

---

## 8. SSL

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example
```

در `.env` مقدار `APP_URL` و `CORS_ORIGIN` را روی `https://...` بگذارید و سرویس را Restart کنید.

اگر از HTTPS استفاده می‌کنید، کوکی نشست به‌صورت Secure ارسال می‌شود.

---

## 9. Persistent WhatsApp Session

نشست واتساپ در پوشهٔ `sessions/` روی دیسک ذخیره می‌شود.

- این پوشه را پاک نکنید مگر بخواهید دوباره QR اسکن شود.
- در Docker، volume مربوط به `./sessions` همین کار را می‌کند.
- پس از Restart سرور، اگر فایل‌های نشست معتبر باشند، نیازی به اسکن مجدد QR نیست.
- اعتبار نشست و QR در لاگ یا رابط کاربری متنی نمایش داده نمی‌شوند.

---

## 10. Backup

حداقل این مسیرها را پشتیبان بگیرید:

```bash
tar czf wcm-backup-$(date +%F).tar.gz \
  database \
  sessions \
  uploads \
  .env
```

بازیابی:

```bash
./scripts/stop.sh
tar xzf wcm-backup-YYYY-MM-DD.tar.gz
./scripts/start.sh
```

از پنل (نقش مدیر) نیز می‌توان خروجی JSON بدون رمز عبور و بدون فایل نشست واتساپ گرفت.

---

## به‌روزرسانی

```bash
./scripts/stop.sh
git pull
./scripts/install.sh
./scripts/start.sh
```

---

## عیب‌یابی

| مشکل | بررسی |
| --- | --- |
| صفحه باز نمی‌شود | `curl /health` ، فایروال، `logs/stdout.log` |
| QR نمی‌آید | دکمهٔ شروع اتصال، وضعیت Connecting / QR Required |
| بعد از Restart دوباره QR می‌خواهد | وجود داشتن `sessions/default` و permission پوشه |
| کمپین Pause شد | قطع واتساپ، خطای محدودیت، یا تعداد خطاهای متوالی |
| آپلود رد می‌شود | فرمت و سقف `MAX_UPLOAD_MB` |
