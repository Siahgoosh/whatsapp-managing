# پنل مدیریت کمپین واتساپ

سامانهٔ تحت وب برای مدیریت **یک حساب WhatsApp** و ارسال پیام‌های **مجاز** به گروه‌هایی که همان حساب عضو آن‌هاست و اجازهٔ ارسال تبلیغات در آن‌ها را دارد.

پورت پیش‌فرض: **9454**

`http://SERVER-IP:9454`

## محدودهٔ مجاز استفاده

این پنل برای ارسال به گروه‌های دارای رضایت/اجازه طراحی شده است و **عمداً** این قابلیت‌ها را ندارد:

- استخراج شماره تلفن اعضای گروه
- افزودن افراد به گروه بدون رضایت
- ارسال به گروه‌هایی که حساب عضو آن‌ها نیست
- دور زدن محدودیت‌های واتساپ یا پنهان‌کاری برای رفتار غیرعادی

حداقل فاصلهٔ ارسال محافظه‌کارانه است (پیش‌فرض ۳ تا ۳۰ ثانیه) و در صورت پاسخ غیرعادی/محدودیت از سمت واتساپ، کمپین به‌صورت خودکار Pause می‌شود.

## معماری

```
/backend     HTTP API، احراز هویت، امنیت
/frontend    پنل React (RTL / فارسی)
/services    WhatsAppService و سرویس‌های دامنه
/queue       صف ارسال کمپین (هر گروه = یک Job)
/database    SQLite + schema
/uploads     فایل‌های پیوست (خارج از اجرای عمومی)
/logs        لاگ برنامه
/config      تنظیمات محیطی
/sessions    نشست پایدار واتساپ (روی دیسک، نه در Frontend)
```

کلاینت واتساپ با کتابخانهٔ معتبر **Baileys** (`@whiskeysockets/baileys`) در سرویس مستقل `WhatsAppService` پیاده شده است. کنترلرهای UI مستقیماً به واتساپ وصل نمی‌شوند.

## اجرای سریع روی VPS

```bash
git clone <REPO>
cd whatsapp-managing
cp .env.example .env
# ADMIN_PASSWORD و SESSION_SECRET را عوض کنید
chmod +x scripts/*.sh
./scripts/install.sh
./scripts/start.sh
```

پنل: `http://SERVER-IP:9454`

حساب پیش‌فرض از `.env`:

- `ADMIN_USERNAME` (پیش‌فرض `admin`)
- `ADMIN_PASSWORD`

## Docker

```bash
cp .env.example .env
docker compose up -d
```

پورت `9454` در Docker هم expose می‌شود. نشست واتساپ، دیتابیس، آپلود و لاگ با volume پایدار می‌مانند.

سلامت سرویس: `GET /health`

## اسکریپت‌ها

| اسکریپت | کار |
| --- | --- |
| `scripts/install.sh` | نصب وابستگی‌ها و build فرانت |
| `scripts/build-frontend.sh` | ساخت مجدد UI (برای دیدن منوهای جدید لازم است) |
| `scripts/start.sh` | ساخت UI در صورت نیاز و اجرا در پس‌زمینه |
| `scripts/stop.sh` | توقف |
| `scripts/restart.sh` | توقف، build فرانت، اجرا مجدد |
| `scripts/update.sh` | git pull + install + restart |
| `scripts/healthcheck.js` | بررسی `/health` |

## قابلیت‌ها

- اتصال واتساپ با QR و نشست پایدار پس از Restart
- وضعیت‌ها: Disconnected, Connecting, QR Required, Connected, Reconnecting, Authentication Failed
- همگام‌سازی گروه‌های عضو، جستجو، فیلتر، انتخاب تکی/چندتایی
- ویزارد کمپین ۸ مرحله‌ای + پیش‌نمایش شبیه واتساپ + تأیید نهایی
- صف ارسال، تأخیر ثابت/تصادفی، Start / Pause / Resume / Stop
- پیشرفت زنده با WebSocket
- گزارش کامل و خروجی CSV
- Inbox، پاسخ خودکار کلیدواژه‌ای، پاسخ سریع، قالب پیام
- دستیار AI اختیاری (فقط پیشنهاد، مگر قوانین مشخص)
- زمان‌بندی، شرایط توقف ایمن، اعلان داخلی و تلگرام اختیاری
- نقش Admin / Operator، تم تاریک/روشن، معماری آمادهٔ چند نشست
- **جستجوی گروه عمومی** برای لینک‌های `chat.whatsapp.com` که در وب منتشر شده‌اند (با API رسمی گوگل/بینگ، رعایت robots.txt، بدون Join خودکار)
- **Admin Outreach** برای شناسایی مدیران گروه‌های عضو، پیام شخصی‌سازی‌شده، پیش‌نمایش و ارسال فقط با تأیید صریح
- **Discovered Groups** برای استخراج لینک دعوت عمومی از پیام گروه‌های عضو، اعتبارسنجی، صف بررسی و Join دستی

اگر Search API در `.env` نباشد، اسکن وب خطا می‌دهد ولی افزودن دستی و CSV کار می‌کند.

### Admin Outreach و کشف لینک گروه

پس از اتصال واتساپ:

1. از **Admin Outreach** گروه‌های عضو را انتخاب کنید و مدیران در دسترس را شناسایی کنید. اعضای عادی ذخیره نمی‌شوند.
2. قالب را با `{{admin_name}}`، `{{group_name}}`، `{{city}}` و `{{office_name}}` ویرایش کنید، پیش‌نمایش ببینید و Approve کنید.
3. Send / Send Selected فقط بعد از تأیید «You are about to contact N group administrators» پیام می‌فرستد. تماس تکراری به‌صورت پیش‌فرض مسدود است.
4. پاسخ مدیر در **Admin Inbox** می‌آید. اجازهٔ تبلیغات (Unknown / Requested / Approved / Declined) را دستی ثبت کنید.
5. لینک‌های `chat.whatsapp.com` که در گروه‌های عضو ارسال شوند وارد **Discovered Groups** می‌شوند، اعتبارسنجی می‌گردند و بدون Join خودکار در صف می‌مانند. Review & Join لینک را باز می‌کند تا خودتان در واتساپ عضو شوید؛ سپس **Add To Marketing Groups**.

در Campaign Manager به‌صورت پیش‌فرض فقط گروه‌های عضو با `Advertising Permission = Approved` انتخاب می‌شوند و Badge 🟢 Permission Granted نمایش داده می‌شود.

سیستم عمداً این کارها را نمی‌کند: استخراج شماره اعضای عادی، Join خودکار تعداد زیاد گروه، ارسال انبوه بدون تأیید به مدیران، دور زدن CAPTCHA/ورود/محدودیت واتساپ.

راهنمای نصب کامل: [INSTALL.md](./INSTALL.md)

## توسعه

```bash
cp .env.example .env
npm install
npm --prefix frontend install
npm test
npm run build
NODE_ENV=development npm run dev
# ترمینال دیگر:
npm run dev:frontend
```

## امنیت

- نشست HttpOnly، CSRF، Helmet، Rate Limit
- اعتبارسنجی ورودی و فایل، سقف حجم، پوشهٔ آپلود غیرقابل اجرا
- هش رمز با bcrypt
- عدم ثبت QR/اعتبار نشست در لاگ یا Frontend (فقط تصویر QR در زمان نیاز)
- جستجوی گروه عمومی فقط صفحات عمومی؛ بدون دور زدن CAPTCHA/ورود، بدون SSRF، بدون استخراج شماره اعضا
- Admin Outreach فقط مدیران گروه‌های عضو را ذخیره می‌کند؛ ارسال به مدیر نیازمند تأیید صریح است و Follow-up خودکار ارسال نمی‌شود
- کشف لینک گروه Join خودکار ندارد و فقط لینک دعوت عمومی واتساپ را از پیام گروه‌های عضو استخراج می‌کند

## پشتیبان‌گیری

پوشه‌های زیر را نگه دارید:

- `database/`
- `sessions/`  (برای عدم نیاز به اسکن مجدد QR)
- `uploads/`
- `.env`
