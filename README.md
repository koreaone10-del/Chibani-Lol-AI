# ARTEMIS R69 — Complete Diagnostic Build

واجهة ثابتة تعمل على Render Static Site، مع تحليل محلي لملفات Firmware وفحص تعريف USB بطريقة read-only.

## المزايا
- تحليل ملفات IMG/BIN محلياً على دفعات 4 MiB.
- رصد مواقع تواقيع IMAGEWTY و eGON.BT0 و ANDROID! و BOOTPKG و UBOOT_ وغيرها.
- تقرير JSON قابل للتنزيل.
- طلب إقران USB عبر WebUSB لقراءة بيانات تعريف الجهاز فقط.
- واجهة عربية متجاوبة ومناسبة للهاتف.

## حدود تقنية مقصودة
- لا يوجد FEL_WRITE أو FEL_EXEC أو تفليش eMMC.
- لا يتم فتح USB interface ولا إرسال أوامر إلى الجهاز.
- التوقيع النصي لا يحدد حدود المكونات ولا يثبت توافق Boot0/SPL.
- لا يمكن لموقع Render الوصول إلى منفذ USB المحلي للهاتف؛ WebUSB يعمل من متصفح يدعم الميزة وعلى HTTPS.
- لا يثبت اختيار VID/PID أن الجهاز دخل وضع FEL أو أن الاتصال صالح للاستعادة.

## النشر
Render: Static Site، Build Command فارغ، Publish Directory `.`.

## Termux
بعد فك ZIP في الهاتف:
```bash
pkg update -y
pkg install git -y
cd ~/storage/downloads/ARTEMIS_R69_COMPLETE
git init
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git add .
git commit -m "Replace with ARTEMIS R69 diagnostic build"
git push -u origin main
```
استبدل USERNAME وREPOSITORY باسم مستودعك. إذا كان المستودع موجوداً محلياً، انسخ محتويات هذا المجلد داخله بدلاً من تنفيذ `git init` من جديد. لا تستخدم force push.
