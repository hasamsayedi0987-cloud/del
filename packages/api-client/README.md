# `@del/api-client`

کلاینت تایپ‌دار API برای همه پلتفرم‌ها: REST (fetch-based با retry و timeout)، WebSocket manager با reconnect نمایی و صف ارسال آفلاین، و نگاشت رویدادهای بلادرنگ به تایپ‌های `@del/shared-types`.

**ویژگی‌های الزامی:**
- درج خودکار `client_msg_id` برای idempotency پیام‌ها
- مدیریت توکن با چرخش refresh و صف‌بندی درخواست‌ها هنگام رفرش
- تلاش مجدد با backoff برای خطاهای شبکه

⬜ فاز ۰ (حداقلی) → تکمیل در فاز ۲
