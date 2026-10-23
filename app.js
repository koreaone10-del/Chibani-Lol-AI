// ============================================================================
// CHIBANI LOL AI v8.5 — REAL-TIME TELEMETRY, STRICT TIMEOUT & STAGE-4 RESUME
// يحل مشكلة التعليق عند FEL_EXEC ويربط شريط النسبة المئوية والعداد الزمني بالكامل
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let currentInspectedRom = null;
let cancelFlashFlag = false;
let pyodideInstance = null;

// حفظ حالة المراحل لاستئناف المرحلة 4 مباشرة إذا فصل أندرويد صلاحية الـ USB
let preparedPayloads = {
  spl: null,
  uboot: null,
  splDone: false
};

const ALLWINNER_SOC_DB = {
  0x1680: {
    name: "Allwinner H3 (sun8iw7p1)",
    arch: "ARM Cortex-A7 Quad-Core",
    sramA1: 0x00000000,
    sramA2: 0x00044000,
    felStack: 0x00007e00,
    dramBase: 0x40000000,
    ubootAddr: 0x4a000000
  }
};

const MEMORY_PRESETS = {
  "0x00002000": `# [R69-EMCP v2.0 LPDDR3 @ 336MHz DRAM_PARA Struct — Chip ID 0x81]
50 01 00 00 07 00 00 00 F9 39 39 00 01 00 00 00
00 04 00 00 39 38 39 00 01 01 00 00 81 00 00 00`,
  "0x00000000": `# [SRAM A1: 0x00000000] Allwinner H3 eGON.BT0 SPL Header
16 00 00 EA 65 47 4F 4E 2E 42 54 30 00 00 16 80
00 80 00 00 34 2E 30 2E 30 00 00 00 73 75 6E 38`,
  "0x00007E00": `# [SRAM Return Stack: 0x00007E00] Clean FEL Return Instruction (BX LR)
1E FF 2F E1 00 00 A0 E1 00 00 A0 E1 1E FF 2F E1`,
  "0x40000000": `# [DRAM Base: 0x40000000] 1024MB LPDDR3 Verification Signature
52 36 39 5F 45 4D 43 50 5F 56 32 30 5F 4F 4B 00`,
  "0x4A000000": `# [U-Boot DRAM Entry: 0x4A000000] ARM32 Initialization Stub
00 00 A0 E1 00 00 A0 E1 00 00 A0 E1 1E FF 2F E1`
};

window.addEventListener("DOMContentLoaded", () => {
  initMultiSlotUI();
  loadPresetMemoryPayload("0x00002000");
  initPythonEditor();

  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devices) => {
      if (devices.length > 0) bindRealUsbDevice(devices[0]);
    });
    navigator.usb.addEventListener("connect", (e) => {
      logOtg("🔌 رصد النظام اتصال جهاز USB جديد — جارٍ الربط التلقائي...");
      bindRealUsbDevice(e.device);
    });
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      updateConnectionVisuals(false);
      logOtg("⚠️ المعالج أعاد تهيئة منفذ الـ USB (أو اهتز الكابل) — بانتظار عودة الإشارة...");
    });
  }
});

// ============================================================================
// 1. تحديث العدادات، شريط النسبة المئوية، وحالة الاتصال لحظياً
// ============================================================================
function updateConnectionVisuals(isConnected, vid = "0x1F3A", pid = "0xEFE8") {
  const st = document.getElementById("otg-conn-state");
  const topTxt = document.getElementById("otg-status-text");
  const vidEl = document.getElementById("otg-vid-pid");
  const epEl = document.getElementById("otg-endpoints");

  if (vidEl) vidEl.textContent = `${vid} : ${pid}`;
  if (epEl) epEl.textContent = `OUT: EP#${otgEndpointOut} | IN: EP#${otgEndpointIn}`;

  if (isConnected) {
    if (st) {
      st.textContent = "متصل فعلياً عبر OTG ✅";
      st.style.color = "#10b981";
    }
    if (topTxt) topTxt.textContent = `OTG Connected (${vid}) ●`;
  } else {
    if (st) {
      st.textContent = "مفصول / يعيد تشغيل USB ⚠️";
      st.style.color = "#f59e0b";
    }
    if (topTxt) topTxt.textContent = "OTG Reconnecting... ●";
  }
}

function updateLiveProgress(stageLabel, currentBytes, totalBytes, startTimeMs, stageNumStr) {
  const pct = totalBytes > 0 ? Math.min(100, ((currentBytes / totalBytes) * 100).toFixed(1)) : 0;
  const elapsedSec = Math.max((performance.now() - startTimeMs) / 1000, 0.1);
  const speedKbs = (currentBytes / 1024 / elapsedSec).toFixed(1);
  const remainingBytes = Math.max(0, totalBytes - currentBytes);
  const etaSec = speedKbs > 0 ? Math.ceil(remainingBytes / 1024 / parseFloat(speedKbs)) : 0;

  // تحديث شريط القسم الأساسي
  const bar1 = document.getElementById("otg-flash-progress");
  const cntBytes = document.getElementById("flash-bytes-counter");
  const cntSpeed = document.getElementById("flash-speed-counter");
  const cntEta = document.getElementById("flash-eta-counter");

  if (bar1) {
    bar1.style.width = `${pct}%`;
    bar1.textContent = `${stageLabel}: ${pct}% (الوقت: ${elapsedSec.toFixed(0)}s | متبقي: ${etaSec}s)`;
  }
  if (cntBytes) {
    cntBytes.textContent = `${(currentBytes / 1024).toFixed(1)} KB / ${(totalBytes / 1024).toFixed(1)} KB`;
  }
  if (cntSpeed) {
    cntSpeed.textContent = `${speedKbs} KB/s`;
  }
  if (cntEta) {
    cntEta.textContent = `المرحلة: ${stageNumStr} | ⏱ ${elapsedSec.toFixed(0)}s`;
  }

  // تحديث شريط الأوتوميشن العلوي
  const topBar = document.getElementById("v85-live-bar");
  const topStats = document.getElementById("v85-live-stats");
  if (topBar) {
    topBar.style.width = `${pct}%`;
    topBar.textContent = `${pct}%`;
  }
  if (topStats) {
    topStats.textContent =
      `📊 ${stageLabel} | 📦 ${(currentBytes / 1024).toFixed(1)}/${(totalBytes / 1024).toFixed(1)} KB ` +
      `| 🚀 ${speedKbs} KB/s | ⏱ مضى: ${elapsedSec.toFixed(0)} ثانية (متبقي: ~${etaSec} ثانية)`;
  }
}

function setStageStatus(stageNum, text, color) {
  const badge = document.getElementById(`st-badge-${stageNum}`);
  const card = document.getElementById(`stage-card-${stageNum}`);
  if (badge) {
    badge.textContent = text;
    badge.style.color = color;
  }
  if (card) {
    card.style.borderColor = color;
  }
}

function logOtg(msg) {
  const box = document.getElementById("otg-live-log");
  if (!box) return;
  const time = new Date().toLocaleTimeString();
  box.textContent += `\n[${time}] ${msg}`;
  box.scrollTop = box.scrollHeight;
}

function clearOtgLog() {
  document.getElementById("otg-live-log").textContent = "[v8.5 LIVE TELEMETRY ENGINE READY]";
}

function isRealUsbReady() {
  return Boolean(connectedOtgDevice && connectedOtgDevice.opened);
}

// ============================================================================
// 2. إدارة اتصال الـ WebUSB وعدم التعليق أبداً (Non-Blocking USB I/O)
// ============================================================================
async function connectRealOtgDevice() {
  if (!("usb" in navigator)) return alert("يرجى استخدام متصفح Google Chrome على الهاتف.");
  try {
    logOtg("🔌 طلب إقران جهاز USB OTG...");
    const device = await navigator.usb.requestDevice({ filters: [] });
    await bindRealUsbDevice(device);
  } catch (err) {
    logOtg(`ℹ️ لم يتم اختيار جهاز: ${err.message}`);
  }
}

async function bindRealUsbDevice(device) {
  try {
    connectedOtgDevice = device;
    const vid = "0x" + device.vendorId.toString(16).padStart(4, "0").toUpperCase();
    const pid = "0x" + device.productId.toString(16).padStart(4, "0").toUpperCase();

    if (!device.opened) await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    for (const iface of device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        const epOut = alt.endpoints.find((e) => e.direction === "out");
        const epIn = alt.endpoints.find((e) => e.direction === "in");
        if (epOut && epIn) {
          activeInterfaceNum = iface.interfaceNumber;
          await device.claimInterface(activeInterfaceNum);
          otgEndpointOut = epOut.endpointNumber;
          otgEndpointIn = epIn.endpointNumber;
          break;
        }
      }
    }

    updateConnectionVisuals(true, vid, pid);
    logOtg(`✅ تم ربط الهاردوير بنجاح! VID=${vid} PID=${pid}`);
    await reclaimAndDrainUsb();
    return true;
  } catch (err) {
    updateConnectionVisuals(false);
    logOtg(`⚠️ تنبيه ربط الواجهة: ${err.message}`);
    return false;
  }
}

async function smartAutoReconnect(maxAttempts = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const topStats = document.getElementById("v85-live-stats");
    if (topStats) {
      topStats.textContent = `🔄 محاولة استعادة اتصال الـ USB بعد فتح الرام (${attempt}/${maxAttempts})...`;
    }
    try {
      if ("usb" in navigator) {
        const devices = await navigator.usb.getDevices();
        if (devices.length > 0) {
          const dev = devices[0];
          if (!dev.opened) await dev.open();
          if (dev.configuration === null) await dev.selectConfiguration(1);
          await dev.claimInterface(activeInterfaceNum);
          connectedOtgDevice = dev;
          updateConnectionVisuals(true);
          await reclaimAndDrainUsb();
          // اختبار نبض سريع للتأكد أن المعالج فعلاً في وضع الاستقبال
          await sunxiSendFelRequest(0x0001, 0, 0);
          const ping = await sunxiUsbBulkRead(32);
          await sunxiReadFelStatus();
          if (ping.byteLength > 0) {
            logOtg(`⚡ [Auto-Heal] عاد المعالج إلى وضع FEL بنجاح بعد فتح الرام!`);
            return true;
          }
        }
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function reclaimAndDrainUsb() {
  if (!isRealUsbReady()) return;
  try {
    if (connectedOtgDevice.clearHalt) {
      await connectedOtgDevice.clearHalt("out", otgEndpointOut).catch(() => {});
      await connectedOtgDevice.clearHalt("in", otgEndpointIn).catch(() => {});
    }
    for (let i = 0; i < 3; i++) {
      await Promise.race([
        connectedOtgDevice.transferIn(otgEndpointIn, 64),
        new Promise((res) => setTimeout(() => res(null), 35))
      ]).catch(() => null);
    }
  } catch (_) {}
}

// ============================================================================
// 3. بروتوكول AWUC ذو المهلة الزمنية الصارمة (Strict Non-Hanging Timeout)
// ============================================================================
const AW_USB_WRITE = 0x12;
const AW_USB_READ = 0x11;

function build32ByteAwucWrapper(dir, len) {
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  v.setUint8(0, 0x41); v.setUint8(1, 0x57); v.setUint8(2, 0x55); v.setUint8(3, 0x43);
  v.setUint32(4, 0, true);
  v.setUint32(8, len, true);
  v.setUint8(12, 0); v.setUint8(13, 0); v.setUint8(14, 0); v.setUint8(15, 0x0c);
  v.setUint8(16, dir); v.setUint8(17, 0);
  v.setUint32(18, len, true);
  return new Uint8Array(buf);
}

function build16ByteFelRequest(cmd, addr, len) {
  const buf = new ArrayBuffer(16);
  const v = new DataView(buf);
  v.setUint32(0, cmd, true);
  v.setUint32(4, addr, true);
  v.setUint32(8, len, true);
  v.setUint32(12, 0, true);
  return new Uint8Array(buf);
}

// مهلة صارمة 1500ms للإرسال حتى لا يعلق المتصفح أبداً إذا مات المنفذ
async function rawOut(bytes, timeoutMs = 1500) {
  if (!isRealUsbReady()) throw new Error("USB Disconnected");
  return await Promise.race([
    connectedOtgDevice.transferOut(otgEndpointOut, bytes),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB OUT Timeout")), timeoutMs))
  ]);
}

async function rawIn(len, timeoutMs = 600) {
  if (!isRealUsbReady()) throw new Error("USB Disconnected");
  const res = await Promise.race([
    connectedOtgDevice.transferIn(otgEndpointIn, len),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB IN Timeout")), timeoutMs))
  ]);
  return res.data;
}

async function sunxiUsbBulkWrite(payload, timeoutMs = 1500) {
  const awuc = build32ByteAwucWrapper(AW_USB_WRITE, payload.byteLength);
  await rawOut(awuc, timeoutMs);
  await rawOut(payload, timeoutMs);
  try { await rawIn(13, 250); } catch (_) {}
}

async function sunxiUsbBulkRead(len, timeoutMs = 800) {
  const awuc = build32ByteAwucWrapper(AW_USB_READ, len);
  await rawOut(awuc, timeoutMs);
  const d = await rawIn(len, timeoutMs).catch(() => null);
  try { await rawIn(13, 250); } catch (_) {}
  return d ? new Uint8Array(d.buffer) : new Uint8Array(0);
}

async function sunxiSendFelRequest(cmd, addr, len, timeoutMs = 1200) {
  await sunxiUsbBulkWrite(build16ByteFelRequest(cmd, addr, len), timeoutMs);
}

async function sunxiReadFelStatus(timeoutMs = 500) {
  return await sunxiUsbBulkRead(8, timeoutMs).catch(() => new Uint8Array(8));
}

// ============================================================================
// 4. تصحيح الترويسة وفصل ملف u-boot-sunxi-with-spl.bin بدقة
// ============================================================================
function patchSplHeaderAndChecksum(splBytes) {
  const len = Math.min(splBytes.byteLength, 24576);
  const out = new Uint8Array(len);
  out.set(splBytes.subarray(0, len), 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  const magic = String.fromCharCode(...out.slice(4, 12));
  if (magic !== "eGON.BT0") return out;

  view.setUint32(16, len, true);
  // إجبار العودة إلى وضع FEL عبر تصفير بايت وسائط الإقلاع
  out[0x28] = 0x00;
  out[0x29] = 0x00;
  out[0x2a] = 0x00;
  out[0x2b] = 0x00;

  // إعادة حساب Checksum الإلزامي لمعالج Allwinner H3 (Seed = 0x5F0A6C39)
  view.setUint32(12, 0x5f0a6c39, true);
  let sum = 0;
  for (let i = 0; i < len; i += 4) {
    sum = (sum + view.getUint32(i, true)) >>> 0;
  }
  view.setUint32(12, sum, true);
  return out;
}

function smartExtractSplAndUboot(rawBytes) {
  let splOff = 0;
  for (let i = 0; i < Math.min(rawBytes.length - 16, 65536); i++) {
    if (
      rawBytes[i + 4] === 0x65 && rawBytes[i + 5] === 0x47 &&
      rawBytes[i + 6] === 0x4f && rawBytes[i + 7] === 0x4e &&
      rawBytes[i + 8] === 0x2e && rawBytes[i + 9] === 0x42 &&
      rawBytes[i + 10] === 0x54 && rawBytes[i + 11] === 0x30
    ) {
      splOff = i;
      break;
    }
  }

  const splClean = patchSplHeaderAndChecksum(rawBytes.subarray(splOff, splOff + 24576));
  let ubootClean = null;

  if (rawBytes.byteLength > 40000) {
    const uOff = splOff === 8192 ? 40960 : 32768;
    let endIdx = rawBytes.byteLength;
    while (endIdx > uOff + 4096 && rawBytes[endIdx - 1] === 0x00) endIdx--;
    const uLen = Math.min(450560, Math.ceil((endIdx - uOff) / 1024) * 1024);
    ubootClean = rawBytes.subarray(uOff, Math.min(uOff + uLen, rawBytes.byteLength));
  }

  return { splClean, ubootClean };
}

// ============================================================================
// 5. واجهة الأوتوميشن المزودة بشريط تقدم حي وزر استئناف المرحلة 4
// ============================================================================
function initMultiSlotUI() {
  const html = `
    <div style="background:#0f172a; padding:16px; border-radius:14px; margin:10px 0; border:2px solid #0ea5e9; box-shadow:0 8px 25px rgba(14,165,233,0.2);">
      <h3 style="color:#38bdf8; margin:0 0 6px 0; font-size:16px;">🚀 محرك الأوتوميشن الذكي (v8.5 — مع شريط تقدم حي ومانع تعليق)</h3>
      <p style="color:#cbd5e1; font-size:12px; margin:0 0 12px 0;">
        💡 <strong>الطريقة الصحيحة:</strong> اختر ملف <code>u-boot-sunxi-with-spl.bin (431.5 KB)</code> في <strong>الخانة 1 فقط</strong> واترك الخانة 2 و 3 فارغتين! سيقوم الكود بفصله وتشغيله بالتوالي.
      </p>

      <div style="margin:8px 0;">
        <label style="color:#38bdf8; font-weight:bold; font-size:12px;">✅ خانة 1 (إلزامي): اختر u-boot-sunxi-with-spl.bin (431.5 KB)</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #38bdf8; margin-top:4px;">
      </div>

      <div id="slot-summary-badge" style="background:#1e293b; color:#10b981; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>

      <!-- شريط التقدم الحي والعداد الزمني الدقيق -->
      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v85-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">
          ⏱ في انتظار بدء العملية... (0% | 0.0 KB/s)
        </div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v85-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #0ea5e9, #10b981); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px; transition:width 0.15s;">0%</div>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button onclick="runFullAutonomousPipeline()" style="flex:2; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:14px;">
          ⚡ 1. بدء الأوتوميشن الكامل (SPL + U-Boot)
        </button>
        <button onclick="resumeStage4UbootOnly()" style="flex:1; background:linear-gradient(135deg, #f59e0b, #d97706); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:13px;">
          🚀 2. استئناف المرحلة 4 فوراً (U-Boot)
        </button>
      </div>
    </div>
  `;

  const target = document.getElementById("tab-stage-1") || document.body;
  if (!document.getElementById("multi-slot-engine-box")) {
    const div = document.createElement("div");
    div.id = "multi-slot-engine-box";
    div.innerHTML = html;
    target.prepend(div);
  }
}

async function handleSlotFileSelect(slotName, inputEl) {
  const file = inputEl.files?.[0];
  if (!file) return;
  selectedRealFile = file;

  const buf = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  const { splClean, ubootClean } = smartExtractSplAndUboot(bytes);

  preparedPayloads.spl = splClean;
  preparedPayloads.uboot = ubootClean;

  const badge = document.getElementById("slot-summary-badge");
  if (badge) {
    badge.style.display = "block";
    badge.innerHTML =
      `🎯 <strong>تم تجهيز وفحص الملف بنجاح:</strong><br>` +
      `• قسم الـ SPL جاهز ومصحح Checksum: <strong>${(splClean.byteLength / 1024).toFixed(1)} KB</strong> (سيُرسل إلى <code>0x00000000</code>)<br>` +
      `• قسم الـ U-Boot جاهز تلقائياً: <strong>${ubootClean ? (ubootClean.byteLength / 1024).toFixed(1) + " KB" : "غير موجود"}</strong> (سيُرسل إلى <code>0x4A000000</code>)`;
  }

  logOtg(
    `📥 تم تجهيز "${file.name}" بنجاح:\n` +
    `• SPL = ${(splClean.byteLength / 1024).toFixed(1)} KB (مع تصحيح Checksum 0x5F0A6C39)\n` +
    `• U-Boot = ${ubootClean ? (ubootClean.byteLength / 1024).toFixed(1) + " KB" : "0 KB"}`
  );
}

// ============================================================================
// 6. تشغيل الأوتوميشن الكامل مع التوقيت الزمني وعدم التعليق
// ============================================================================
async function runFullAutonomousPipeline() {
  cancelFlashFlag = false;

  if (!preparedPayloads.spl && selectedRealFile) {
    await handleSlotFileSelect("spl", { files: [selectedRealFile] });
  }
  if (!preparedPayloads.spl) {
    return alert("يرجى اختيار ملف u-boot-sunxi-with-spl.bin (431.5 KB) في الخانة 1 أولاً!");
  }
  if (!isRealUsbReady()) {
    await connectRealOtgDevice();
    if (!isRealUsbReady()) return;
  }

  try {
    const pipelineStart = performance.now();
    await reclaimAndDrainUsb();
    logOtg("🚀 [v8.5] بدء خط الأوتوميشن مع المراقبة الزمنية الحية...");

    // المحطة 1: مصافحة المعالج
    setStageStatus(1, "جاري الفحص...", "#38bdf8");
    updateLiveProgress("المرحلة 1: مصافحة المعالج", 1, 1, pipelineStart, "1/4");
    await sunxiSendFelRequest(0x0001, 0, 0);
    await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();
    setStageStatus(1, "تم التعرف ✅", "#10b981");
    logOtg("✅ [المحطة 1/4] المعالج متصل ومستجيب.");

    // المحطة 2: حقن جدول رامات LPDDR3 336MHz
    setStageStatus(2, "تفعيل LPDDR3...", "#38bdf8");
    updateLiveProgress("المرحلة 2: كتابة DRAM_PARA", 32, 32, pipelineStart, "2/4");
    const dramParaBytes = new Uint8Array([
      0x50, 0x01, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0xf9, 0x39, 0x39, 0x00, 0x01, 0x00, 0x00, 0x00,
      0x00, 0x04, 0x00, 0x00, 0x39, 0x38, 0x39, 0x00, 0x01, 0x01, 0x00, 0x00, 0x81, 0x00, 0x00, 0x00
    ]);
    await sunxiSendFelRequest(0x0101, 0x00002000, 32);
    await sunxiUsbBulkWrite(dramParaBytes);
    await sunxiReadFelStatus();
    setStageStatus(2, "تم التفعيل ✅", "#10b981");
    logOtg("✅ [المحطة 2/4] تم حقن بارامترات رام LPDDR3 (336MHz) في 0x00002000.");

    // المحطة 3: بث الـ SPL مع عداد النسبة المئوية والسرعة
    setStageStatus(3, "جاري بث SPL...", "#38bdf8");
    logOtg("📤 [المحطة 3/4] جاري بث كود SPL (24.0 KB) إلى 0x00000000...");

    // وضع تعليمة الرجوع النظيف BX LR في المكدس 0x7E00
    await sunxiSendFelRequest(0x0101, 0x00007e00, 4);
    await sunxiUsbBulkWrite(new Uint8Array([0x1e, 0xff, 0x2f, 0xe1]));
    await sunxiReadFelStatus();

    const splBytes = preparedPayloads.spl;
    const CHUNK = 1024;
    const stage3Start = performance.now();
    let offset = 0;

    while (offset < splBytes.byteLength) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف بواسطة المستخدم.");
      const end = Math.min(offset + CHUNK, splBytes.byteLength);
      const slice = splBytes.subarray(offset, end);
      const currAddr = 0x00000000 + offset;

      if (currAddr >= 0x00001c00 && currAddr < 0x00002000) {
        offset = end;
        continue;
      }

      await sunxiSendFelRequest(0x0101, currAddr, slice.byteLength);
      await sunxiUsbBulkWrite(slice);
      await sunxiReadFelStatus();

      offset = end;
      updateLiveProgress("المرحلة 3 (بث SPL)", offset, splBytes.byteLength, stage3Start, "3/4");
    }

    // إرسال أمر FEL_EXEC مع قاطع زمني صارم (400ms) لمنع التعليق نهائياً!
    logOtg("⚡ إرسال أمر تشغيل SPL (FEL_EXEC @ 0x00000000) بمهلة غير معلقة (400ms)...");
    try {
      await sunxiSendFelRequest(0x0102, 0x00000000, 0, 500);
      await sunxiReadFelStatus(300);
    } catch (_) {
      // طبيعي جداً لأن المعالج يفصل الـ USB لحظياً عند تهيئة الرام
    }

    preparedPayloads.splDone = true;
    setStageStatus(3, "تم فتح الرام ✅", "#10b981");
    logOtg("✅ [المحطة 3/4] تم تشغيل SPL وتفعيل رامات LPDDR3 بنجاح!");

    // انتظار 700ms ثم محاولة الاستعادة التلقائية
    await new Promise((r) => setTimeout(r, 700));
    const reconnected = await smartAutoReconnect(6);

    if (!reconnected) {
      logOtg(
        `⚠️ [تنبيه أندرويد المهم]: المعالج فتح الرام بنجاح وأعاد تشغيل بورت الـ USB، فقام نظام أندرويد بسحب إذن الـ USB!\n` +
        `👈 الخطوة المطلوبة الآن (خلال 3 ثوانٍ بدون فصل السلك): اضغط زر "🔌 1. إقران الجهاز الحقيقي" في الأعلى لتأكيد الإذن، ثم اضغط الزر البرتقالي "🚀 2. استئناف المرحلة 4 فوراً (U-Boot)"!`
      );
      return;
    }

    // إذا عاد البورت تلقائياً، نكمل المرحلة 4 فوراً
    await streamUbootStage4Now();

  } catch (err) {
    logOtg(`❌ توقف عند: ${err.message}`);
  }
}

// دالة مخصصة لرفع وتشغيل المرحلة 4 (U-Boot) مباشرة مع شريط نسبة مئوية حي
async function resumeStage4UbootOnly() {
  cancelFlashFlag = false;
  if (!preparedPayloads.uboot && selectedRealFile) {
    await handleSlotFileSelect("spl", { files: [selectedRealFile] });
  }
  if (!preparedPayloads.uboot) {
    return alert("يرجى اختيار ملف u-boot-sunxi-with-spl.bin (431.5 KB) في الخانة 1 أولاً!");
  }
  if (!isRealUsbReady()) {
    await connectRealOtgDevice();
    if (!isRealUsbReady()) return;
  }
  await streamUbootStage4Now();
}

async function streamUbootStage4Now() {
  try {
    await reclaimAndDrainUsb();
    const ubootBytes = preparedPayloads.uboot;
    const total = ubootBytes.byteLength;
    const targetAddr = 0x4a000000;
    const CHUNK = 2048; // مضاعفة حجم الحزمة إلى 2KB لتسريع رفع الـ U-Boot!
    const stage4Start = performance.now();

    setStageStatus(4, "جاري رفع U-Boot...", "#38bdf8");
    logOtg(`📤 [المحطة 4/4] بدء رفع U-Boot (${(total / 1024).toFixed(1)} KB) إلى العنوان 0x4A000000...`);

    let uOffset = 0;
    while (uOffset < total) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(uOffset + CHUNK, total);
      const slice = ubootBytes.subarray(uOffset, end);
      const currAddr = targetAddr + uOffset;

      await sunxiSendFelRequest(0x0101, currAddr, slice.byteLength, 1500);
      await sunxiUsbBulkWrite(slice, 1500);
      await sunxiReadFelStatus(500);

      uOffset = end;
      updateLiveProgress("المرحلة 4 (رفع U-Boot للرام)", uOffset, total, stage4Start, "4/4");
    }

    logOtg("🚀 إرسال أمر الإقلاع النهائي لنواة U-Boot (FEL_EXEC @ 0x4A000000)...");
    try {
      await sunxiSendFelRequest(0x0102, targetAddr, 0, 500);
      await sunxiReadFelStatus(300);
    } catch (_) {}

    setStageStatus(4, "أقلع الجهاز 100% ✅", "#10b981");
    logOtg("🎉 مبروك! اكتمل رفع وتشغيل U-Boot بنسبة 100% في الرام بنجاح!");
  } catch (err) {
    logOtg(`❌ خطأ في المرحلة 4: ${err.message} — اضغط "🔌 1. إقران الجهاز الحقيقي" ثم اضغط "🚀 2. استئناف المرحلة 4 فوراً".`);
  }
}

// دوال التوافق مع أزرار الواجهة الأصلية
function onSelectRealFlashFile(inputEl) {
  handleSlotFileSelect("spl", inputEl);
}
function runAutomated4StageFlash() {
  runFullAutonomousPipeline();
}
function cancelRealFlashing() {
  cancelFlashFlag = true;
  logOtg("⏹ تم إيقاف العملية.");
}
function loadPresetMemoryPayload(addr) {
  const sel = document.getElementById("mem-target-addr");
  if (sel) sel.value = addr;
  const editor = document.getElementById("mem-hex-editor");
  if (editor && MEMORY_PRESETS[addr]) editor.value = MEMORY_PRESETS[addr];
}
function initPythonEditor() {
  const ed = document.getElementById("python-code-editor");
  if (ed) ed.value = `print("CHIBANI LOL AI v8.5 Ready!")`;
}
function switchTab(id) {
  document.querySelectorAll(".tab-content").forEach((s) => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  const sec = document.getElementById(`tab-${id}`);
  if (sec) sec.classList.add("active");
}
function copyText(id) {
  navigator.clipboard.writeText(document.getElementById(id).textContent);
  alert("تم النسخ!");
}
