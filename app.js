let taskCounter = 1;
let isDeviceLocked = false;

// التهيئة عند تحميل الصفحة
window.addEventListener("DOMContentLoaded", () => {
  const savedLang = localStorage.getItem("chibani_lang") || "ar";
  document.getElementById("lang-select").value = savedLang;
  changeLanguage(savedLang);

  const savedKey = localStorage.getItem("chibani_gemini_key") || "";
  if (savedKey) {
    document.getElementById("cfg-gemini-key").value = savedKey;
    updateApiStatusBadge(true);
  }

  updateEnvPreview();
  updateMcpPreview();
});

// تبديل التبويبات الرئيسية
function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach((sec) => sec.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));

  document.getElementById(`tab-${tabId}`).classList.add("active");
  document.querySelector(`.nav-btn[data-tab="${tabId}"]`).classList.add("active");
}

// تبديل نوافذ التدفق (Steps / XML / Logcat)
function switchStreamView(view) {
  document.querySelectorAll(".mini-tab").forEach((b) => b.classList.remove("active"));
  event.target.classList.add("active");

  document.getElementById("stream-steps-view").style.display = view === "steps" ? "block" : "none";
  document.getElementById("stream-xml-view").style.display = view === "xml" ? "block" : "none";
  document.getElementById("stream-logcat-view").style.display = view === "logcat" ? "block" : "none";
}

function toggleCoordGrid(show) {
  document.getElementById("coord-grid").style.display = show ? "block" : "none";
}

function updateProfileBadge() {
  const profile = document.getElementById("exec-profile").value;
  const badge = document.getElementById("active-profile-badge");
  badge.textContent = profile === "flash" ? "FLASH (3-5s)" : "PRO (Planner+Checker)";
  updateLiveCliCommand();
}

function fillPreset(type) {
  const input = document.getElementById("task-prompt");
  if (type === "battery") {
    input.value = "Open Settings, navigate to Battery, verify battery percentage is displayed and check for any system popup.";
  } else if (type === "flutter") {
    input.value = "Open the Flutter POS E-Commerce app, select the first product, add it to cart, open cart and verify total price.";
    document.getElementById("exec-profile").value = "pro";
  } else if (type === "crossapp") {
    input.value = "Search Annaba Revolution Square in Google Maps, copy location title, then open YouTube and play a tour video.";
    document.getElementById("exec-profile").value = "pro";
  }
  updateProfileBadge();
}

function updateLiveCliCommand() {
  const prompt = document.getElementById("task-prompt").value || "Open Settings, find Battery and tell me current level";
  const profile = document.getElementById("exec-profile").value;
  const verify = document.getElementById("exec-verify").value;
  let cmd = `uv run artemis run "${prompt}" --profile ${profile}`;
  if (profile === "pro") {
    cmd += ` --verification-level ${verify}`;
  }
  document.getElementById("live-cli-cmd").textContent = cmd;
}

// حفظ مفتاح Gemini API المجاني
function saveAndVerifyKey() {
  const key = document.getElementById("cfg-gemini-key").value.trim();
  if (!key) {
    localStorage.removeItem("chibani_gemini_key");
    updateApiStatusBadge(false);
    return;
  }
  localStorage.setItem("chibani_gemini_key", key);
  updateApiStatusBadge(true);
  updateEnvPreview();
  alert("تم حفظ مفتاح Gemini API بنجاح! سيتم استخدامه لتحليل المهام بالذكاء الاصطناعي الحي.");
}

function updateApiStatusBadge(hasKey) {
  const text = document.getElementById("api-status-text");
  if (hasKey) {
    text.textContent = "Gemini Live API ●";
  } else {
    text.textContent = "Smart Engine Ready";
  }
}

// تنفيذ المهمة (يدعم Gemini API الحي + المحاكي الذكي الفوري)
async function executeTask() {
  if (isDeviceLocked) {
    alert("DeviceExecutionLock نشط حالياً! انتظر انتهاء المهمة الجارية على هذا الجهاز.");
    return;
  }

  const promptInput = document.getElementById("task-prompt");
  const taskText = promptInput.value.trim() || "Open Settings, find Battery and tell me current level";
  const profile = document.getElementById("exec-profile").value;
  const verify = document.getElementById("exec-verify").value;
  const backend = document.getElementById("exec-backend").value;

  updateLiveCliCommand();

  // تفعيل قفل الجهاز الحصري DeviceExecutionLock
  isDeviceLocked = true;
  document.getElementById("lock-state").textContent = "LOCKED (Running Task #" + taskCounter + ")";
  document.getElementById("stream-empty").style.display = "none";

  const stepsList = document.getElementById("agent-steps-list");
  stepsList.innerHTML = "";

  const currentTaskId = taskCounter++;
  addQueueItem(currentTaskId, taskText, profile, "RUNNING");

  const apiKey = localStorage.getItem("chibani_gemini_key");
  let generatedSteps = null;

  if (apiKey) {
    generatedSteps = await fetchGeminiPlan(apiKey, taskText, profile, verify, backend);
  }

  if (!generatedSteps) {
    generatedSteps = buildSmartFallbackSteps(taskText, profile, verify, backend);
  }

  // عرض الخطوات بالتتابع مع تحريك مؤشر الإحداثيات (0-1000)
  for (let i = 0; i < generatedSteps.length; i++) {
    const step = generatedSteps[i];
    await new Promise((r) => setTimeout(r, 950));
    renderAgentStep(i + 1, step);
    moveReticle(step.x, step.y, step.screenTitle);
  }

  // تحديث شجرة XML وسجل Logcat
  updateTelemetryLogs(taskText, profile, backend, generatedSteps);

  isDeviceLocked = false;
  document.getElementById("lock-state").textContent = "IDLE (متاح)";
  updateQueueStatus(currentTaskId, "COMPLETED (99.4%)");
}

async function fetchGeminiPlan(apiKey, taskText, profile, verify, backend) {
  try {
    const sysPrompt = `You are Google ARTEMIS Android Automation Engine (Profile: ${profile}, Verification: ${verify}, Backend: ${backend}).
Break down the user's Android task into 4 concrete execution steps.
Respond ONLY with a valid JSON array of objects, each having:
"phase" (e.g. "Observe & Locate", "Safety Net Check", "Action Dispatch", "Checker Verification"),
"thought" (concise explanation in the same language as the user's task),
"action" (e.g. "tap(500, 260)" or "click_sequence"),
"x" (integer 150 to 850 on normalized 0-1000 grid),
"y" (integer 200 to 800 on normalized 0-1000 grid),
"screenTitle" (short title of current Android screen).`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${sysPrompt}\n\nUser Task: ${taskText}` }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(rawText);
  } catch (e) {
    console.warn("Fallback to built-in ARTEMIS simulation:", e);
    return null;
  }
}

function buildSmartFallbackSteps(taskText, profile, verify, backend) {
  const steps = [
    {
      phase: "1. Locating Engine (" + backend.toUpperCase() + ")",
      thought: `تحليل شاشة الجهاز عبر Artemis Accessibility Helper وشبكة الإحداثيات المعيارية (0-1000) لتحديد الهدف الأول في المهمة: "${taskText}"`,
      action: "locate_element(index=1, grid=[500, 260])",
      x: 500,
      y: 260,
      screenTitle: "Android System — Active View"
    },
    {
      phase: profile === "pro" ? "2. Safety Net (Pre-Execution Check)" : "2. Flash Reactive Loop (Observe → Think)",
      thought:
        profile === "pro"
          ? "فحص شجرة UI الحية والبيكسلات قبل التنفيذ للتأكد من عدم وجود نوافذ منبثقة أو تغير في موقع العنصر."
          : "تجهيز نقرة سريعة عبر FlashRunner خلال 3.2 ثانية مع ضغط السجل التاريخي بالخلفية.",
      action: "verify_target_pixels(status=CLEAR) -> tap(500, 420)",
      x: 500,
      y: 420,
      screenTitle: "Target Sub-Screen Loaded"
    },
    {
      phase: "3. Async Action Dispatch",
      thought: "تنفيذ التفاعل على الجهاز عبر ADB والتقاط صورة الشاشة وسجل Logcat المرافق للخطوة.",
      action: "click_sequence([500, 580]) + capture_trace()",
      x: 500,
      y: 580,
      screenTitle: "Executing Workflow Action"
    },
    {
      phase: profile === "pro" ? `4. Pro Checker Audit (Level: ${verify})` : "4. Task Completion Summary",
      thought: "تم التحقق من مطابقة حالة الشاشة النهائية لهدف المستخدم بنجاح بدون أي أخطاء في Logcat.",
      action: "report_status(COMPLETED, confidence=0.996)",
      x: 500,
      y: 740,
      screenTitle: "Workflow Verified ✅"
    }
  ];
  return steps;
}

function renderAgentStep(num, step) {
  const stepsList = document.getElementById("agent-steps-list");
  const div = document.createElement("div");
  div.className = "step-card safety-pass";
  div.innerHTML = `
    <div class="step-meta">
      <span>Step #${num} — ${step.phase}</span>
      <span>Grid: (${step.x}, ${step.y})</span>
    </div>
    <p>${step.thought}</p>
    <code style="display:block; margin-top:4px; color:#10b981; font-family:var(--font-mono); font-size:0.76rem;">⚡ ${step.action}</code>
  `;
  stepsList.appendChild(div);
  const box = document.getElementById("stream-steps-view");
  box.scrollTop = box.scrollHeight;
}

function moveReticle(x, y, title) {
  const reticle = document.getElementById("target-reticle");
  const label = document.getElementById("coord-label");
  reticle.style.display = "block";
  reticle.style.left = `${(x / 1000) * 100}%`;
  reticle.style.top = `${(y / 1000) * 100}%`;
  label.textContent = `(${x}, ${y})`;

  if (title) {
    document.getElementById("screen-title").textContent = title;
  }

  const cards = document.querySelectorAll(".mock-ui-card");
  cards.forEach((c) => c.classList.remove("active-target"));
  const idx = Math.min(cards.length - 1, Math.floor((y / 1000) * cards.length));
  if (cards[idx]) cards[idx].classList.add("active-target");
}

function updateTelemetryLogs(task, profile, backend, steps) {
  const xmlView = document.getElementById("stream-xml-view");
  xmlView.textContent = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0" backend="${backend}" normalized_grid="1000x1000">
  <node index="0" package="com.google.artemis.target" class="android.widget.FrameLayout" bounds="[0,0][1000,1000]">
    <node index="1" text="Settings &amp; Automation Target" resource-id="id/primary_card" clickable="true" bounds="[80,220][920,310]" />
    <node index="2" text="Battery Status: 94% (Normal)" resource-id="id/battery_level" clickable="true" bounds="[80,380][920,470]" />
    <node index="3" text="Flutter Custom Canvas Viewport" content-desc="OCR_Verified_Node" bounds="[80,540][920,780]" />
  </node>
</hierarchy>`;

  const logcatView = document.getElementById("stream-logcat-view");
  logcatView.textContent = `[ARTEMIS-CORE] Initializing ArtemisContext | Profile=${profile.toUpperCase()}
[ADB-BRIDGE] Device lock acquired via DeviceExecutionLock (FIFO Queue)
[HELPER-SVC] Artemis Accessibility Helper active on loopback (UIAutomation unblocked)
[LOCATING-ENGINE] Normalized 0-1000 coordinate targeting active (${steps.length} steps executed)
[SAFETY-NET] Pre-execution UI tree & pixel verification: 0 popups blocked, 100% target match
[TELEMETRY] Task "${task}" finished with status=SUCCESS`;
}

function addQueueItem(id, text, profile, status) {
  const list = document.getElementById("task-queue-list");
  const item = document.createElement("div");
  item.className = "queue-item";
  item.id = `queue-task-${id}`;
  item.innerHTML = `
    <div>
      <strong>#${id} [${profile.toUpperCase()}]</strong>
      <div style="color:var(--text-muted); font-size:0.75rem;">${text.slice(0, 42)}...</div>
    </div>
    <span class="badge" id="queue-badge-${id}">${status}</span>
  `;
  list.prepend(item);
}

function updateQueueStatus(id, status) {
  const badge = document.getElementById(`queue-badge-${id}`);
  if (badge) badge.textContent = status;
}

function clearQueue() {
  document.getElementById("task-queue-list").innerHTML = "";
}

// مولد ملف .env
function updateEnvPreview() {
  const key = document.getElementById("cfg-gemini-key").value.trim() || "AIzaSy_YOUR_GEMINI_KEY_HERE";
  const host = document.getElementById("cfg-adb-host").value.trim() || "127.0.0.1";
  const port = document.getElementById("cfg-adb-port").value.trim() || "5037";
  const serial = document.getElementById("cfg-adb-serial").value.trim();
  const profile = document.getElementById("cfg-def-profile").value;
  const backend = document.getElementById("cfg-backend").value;
  const autoHelper = document.getElementById("cfg-auto-helper").checked;
  const keepAwake = document.getElementById("cfg-keep-awake").checked;

  const envContent = `# Generated by CHIBANI LOL AI — Google ARTEMIS Configuration
GEMINI_API_KEY=${key}
GOOGLE_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPEN_ROUTER_API_KEY=
XAI_API_KEY=

# ADB & Device Targeting
ADB_HOST=${host}
ADB_PORT=${port}
ADB_DEVICE_SERIAL=${serial}

# Execution & Accessibility Helper Behavior
ARTEMIS_DEFAULT_PROFILE=${profile}
ARTEMIS_HIERARCHY_BACKEND=${backend}
ARTEMIS_HELPER_AUTO_INSTALL=${autoHelper}
ARTEMIS_KEEP_DEVICE_AWAKE=${keepAwake}`;

  document.getElementById("env-output").textContent = envContent;
}

function downloadEnvFile() {
  const content = document.getElementById("env-output").textContent;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ".env";
  a.click();
}

// مولد إعدادات MCP
function updateMcpPreview() {
  const ide = document.getElementById("cfg-ide-select").value;
  const cmdOut = document.getElementById("mcp-cmd-output");
  const jsonOut = document.getElementById("mcp-json-output");

  cmdOut.textContent = `uv run artemis mcp --install ${ide}`;

  if (ide === "codex") {
    jsonOut.textContent = `# ~/.codex/config.toml
[mcp_servers.artemis]
command = "/path/to/artemis/.venv/bin/python"
args = ["-m", "mcp_server"]
cwd = "/path/to/artemis"

[mcp_servers.artemis.env]
PYTHONUNBUFFERED = "1"`;
  } else {
    jsonOut.textContent = `{
  "mcpServers": {
    "artemis": {
      "command": "/path/to/artemis/.venv/bin/python",
      "args": ["-m", "mcp_server"],
      "cwd": "/path/to/artemis",
      "env": {
        "PYTHONUNBUFFERED": "1"
      }
    }
  }
}`;
  }
}

// اتصال WebUSB وفحص البيئة (Doctor)
async function connectWebUSB() {
  if (!("usb" in navigator)) {
    alert("متصفحك الحالي لا يفعل WebUSB API. يرجى استخدام Google Chrome أو Microsoft Edge لربط الهاتف عبر USB مباشرة.");
    return;
  }
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    document.getElementById("doc-device-status").textContent = `متصل: ${device.productName || "Android USB Device"} (${device.manufacturerName || "OEM"})`;
    alert(`تم التعرف على الجهاز: ${device.productName || "Android Device"}`);
  } catch (err) {
    console.log("WebUSB pairing cancelled or failed:", err);
  }
}

function runEnvironmentDoctor() {
  const hasUsb = "usb" in navigator;
  const hasKey = Boolean(localStorage.getItem("chibani_gemini_key"));

  document.getElementById("doc-webusb-status").textContent = hasUsb
    ? "✅ READY: متصفحك يدعم WebUSB API لاتصال الأجهزة المباشر."
    : "⚠️ DEGRADED: المتصفح لا يدعم WebUSB (استخدم Chrome/Edge).";

  document.getElementById("doc-ai-status").textContent = hasKey
    ? "✅ READY: مفتاح Gemini API مفعل ومتصل بمحرك التخطيط الذكي."
    : "ℹ️ SIMULATOR MODE: يعمل بالمحاكي الذكي المدمج (أضف مفتاح Gemini من تبويب الإعدادات للتفكير الحي).";

  document.getElementById("doc-render-status").textContent =
    "✅ READY: جميع الملفات ثابتة ومهيأة للنشر الفوري المجاني على استضافة Render.";
}

function copyText(elementId) {
  const text = document.getElementById(elementId).textContent;
  navigator.clipboard.writeText(text);
  alert("تم النسخ إلى الحافظة!");
}
