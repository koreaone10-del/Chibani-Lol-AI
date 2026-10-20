<div align="center">

# ⚡ CHIBANI LOL AI
### Next-Gen Android AI Automation Studio & Google ARTEMIS Control Center
**منصة أتمتة واختبار أجهزة أندرويد بالذكاء الاصطناعي — غرفة العمليات الشاملة لمحرك Google ARTEMIS**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)
![License](https://img.shields.io/badge/License-Apache_2.0-00f2fe?style=for-the-badge)
![Engine](https://img.shields.io/badge/Engine-Google_ARTEMIS-4facfe?style=for-the-badge)
![AI](https://img.shields.io/badge/AI-Gemini_2.5_Flash_&_Pro-10b981?style=for-the-badge)
![Languages](https://img.shields.io/badge/i18n-6_Languages_(RTL_&_LTR)-f59e0b?style=for-the-badge)
![Hosting](https://img.shields.io/badge/Render_Cloud-100%25_Free_Static-f43f5e?style=for-the-badge)

</div>

---

## 🌟 نظرة عامة | Overview

**CHIBANI LOL AI** هي منصة ويب متكاملة وخفيفة جداً (Zero-Backend Cost) مصممة كغرفة عمليات تفاعلية ومولد إعدادات شامل لإطار عمل **Google ARTEMIS** الخاص بأتمتة هواتف **Android** عبر الأوامر المكتوبة باللغة الطبيعية (Natural Language).

تجمع المنصة بين **محاكي تنفيذ ذكي متصل مباشرة بـ Google Gemini API**، و**جسر اتصال بالأجهزة الحقيقية عبر WebUSB**، و**مولد فوري لملفات `.env` وخوادم `MCP`** لربط الهواتف ببيئات البرمجة الذكية (Antigravity, Claude Code, Cursor, Codex, Windsurf, VS Code)، مع دعم كامل لـ **6 لغات عالمية** (العربية، الإنجليزية، الفرنسية، الإسبانية، التركية، والصينية).

---

## 🔥 المميزات الرئيسية | Key Features

| الميزة (Feature) | الوصف التقني (Technical Details) |
| :--- | :--- |
| **🚀 غرفة العمليات الحية (Live AI Workspace)** | محاكاة بصرية فورية لدورة حياة الوكيل (`Observe → Think → Safety Net Check → Act`) مع عرض شاشة الهاتف وشبكة الإحداثيات المعيارية المقسمة من **0 إلى 1000** (`Normalized 0-1000 Grid`). |
| **⚡ نمطي التشغيل Flash و Pro** | التبديل الفوري بين نمط **Flash** السريع (3-5 ثوانٍ للخطوة) ونمط **Pro** المتقدم (الذي يجمع بين `Planner` و `Operator` و `Checker`) مع التحكم بمستويات التدقيق (`off`, `final`, `checkpoints`, `strict`). |
| **🧠 اتصال مباشر بمفتاح Gemini API المجاني** | إمكانية إدخال مفتاح Google AI Studio المجاني مباشرة من المتصفح لتحويل أي مهمة مكتوبة بأي لغة إلى خطوات تنفيذ حقيقية وإحداثيات نقر دقيقة. |
| **🔬 شجرة الواجهة وسجل الأعطال (XML & Logcat)** | استعراض فوري لشجرة عناصر أندرويد (`UI Hierarchy XML`) وسجلات النظام (`Logcat Telemetry`) وحالة قفل الجهاز الحصري (`DeviceExecutionLock FIFO`). |
| **⚙️ مولد ملفات `.env` و `MCP` الذكي** | توليد وتحميل ملف `.env` جاهز بضغطة زر، وتوليد أوامر التثبيت التلقائي وأكواد `JSON / TOML` لخادم **MCP** لجميع محررات الأكواد الذكية. |
| **🩺 طبيب البيئة وجسر WebUSB (`Doctor`)** | أداة فحص مدمجة للتحقق من جاهزية المتصفح، ومفتاح الذكاء الاصطناعي، وإقران هواتف الأندرويد المتصلة بالكابل مباشرة عبر واجهة `WebUSB API`. |
| **🌍 دعم 6 لغات عالمية (RTL / LTR)** | ترجمة فورية لجميع الخانات والأزرار بين **العربية 🇩🇿، الإنجليزية 🇺🇸، الفرنسية 🇫🇷، الإسبانية 🇪🇸، التركية 🇹🇷، والصينية 🇨🇳** مع قلب اتجاه التصميم تلقائياً. |

---

## 📂 هيكلة المشروع | Project Structure

```text
chibani-lol-ai/
├── index.html       # الواجهة الرئيسية المتكاملة (الخانات الـ 6 + المحاكي + مولد الإعدادات)
├── style.css        # التصميم العصري المتجاوب (Cyberpunk Dark Glassmorphism + RTL/LTR)
├── i18n.js          # محرك الترجمة الفورية للغات الـ 6 المعتمدة
├── app.js           # المنطق البرمجي (Gemini API + WebUSB Bridge + 0-1000 Grid + Config Studio)
├── render.yaml      # ملف النشر السحابي التلقائي المجاني 100% على استضافة Render
└── README.md        # التوثيق الشامل للمشروع
```

---

## ☁️ النشر المجاني على استضافة Render | Free Deployment on Render

المشروع مهيأ بالكامل للعمل مجاناً مدى الحياة على خطة **Render Static Site**:

1. ارفع هذا المستودع إلى حسابك على **GitHub**.
2. سجل الدخول إلى حسابك في [Render.com](https://render.com).
3. اضغط على **New +** من الشريط العلوي واختر **Static Site** (أو اختر **Blueprint** لقراءة ملف `render.yaml` تلقائياً).
4. اربط مستودع `chibani-lol-ai` واضبط الإعدادات التالية:
   * **Build Command:** *(اتركه فارغاً)*
   * **Publish Directory:** `.`
5. اضغط **Create Static Site** — خلال ثوانٍ سيعمل موقعك على رابط رسمي آمن `https://chibani-lol-ai.onrender.com`.

---

## 💻 التشغيل المحلي السريع | Local Quick Start

لا يحتاج الموقع إلى أي تعقيدات أو خوادم خلفية لتشغيله محلياً:

```bash
# 1. استنساخ المستودع
git clone [https://github.com/YOUR_USERNAME/chibani-lol-ai.git](https://github.com/YOUR_USERNAME/chibani-lol-ai.git)
cd chibani-lol-ai

# 2. تشغيل خادم محلي بسيط (باستخدام Python أو VS Code Live Server)
python -m http.server 8080
```
ثم افتح المتصفح على العنوان: `http://localhost:8080`

---

## 🛠️ مرجع أوامر Google ARTEMIS السريع | ARTEMIS CLI Cheat Sheet

| الوظيفة | الأمر البرمجي |
| :--- | :--- |
| **التثبيت والتشغيل بنقرة واحدة (Linux/macOS)** | `./start.sh` |
| **التثبيت والتشغيل بنقرة واحدة (Windows PowerShell)** | `.\start.bat` |
| **فحص جاهزية البيئة والهاتف والمفتاح** | `uv run artemis doctor` |
| **تشغيل مهمة سريعة بنمط Flash** | `uv run artemis run "Open Settings and check Battery" --profile flash` |
| **تشغيل مهمة معقدة بنمط Pro مع تدقيق صارم** | `uv run artemis run "Test checkout flow" --profile pro --verification-level strict` |
| **تثبيت تكامل MCP لجميع محررات الأكواد** | `uv run artemis mcp --install all` |
| **تشغيل أو إيقاف واجهة الويب المحلية** | `uv run artemis ui --open` / `uv run artemis stop` |

---

## 👨‍💻 المطور والترخيص | Author & License

* **Developed & Engineered by:** **Lotfi Chibani** (`CHIBANI LOL AI`)
* **Core Automation Reference:** Google ARTEMIS (Apache 2.0 License)
* **License:** Distributed under the **Apache 2.0 License**. Free for personal and commercial use.
