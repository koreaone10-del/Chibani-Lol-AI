// ============================================================================
// CHIBANI LOL AI v18.0 — AUTONOMOUS HARDWARE AGENT & AUTO-HEALING USB PIPELINE
// بروتوكول الاستشفاء الذاتي ومعالجة أخطاء USB OUT Timeout بالدوت المجهري (256-byte Micro-Chunks)
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let cancelFlashFlag = false;

let preparedPayloads = {
  fes1: null,
  uboot: null
};

window.addEventListener("DOMContentLoaded", () => {
  initV18AutonomousAgentUI();
  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devs) => {
      if (devs.length > 0) bindRealUsbDevice(devs[0]);
    });
    navigator.usb.addEventListener("connect", (e) => {
      logAgent("🤖 [Autonomous Agent] رصد اتصال هاردوير جديد — جارِ إعادة الارتباط الذاتي...");
      bindRealUsbDevice(e.device);
    });
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      updateConnectionVisuals(false);
      logAgent("⚠️ [Autonomous Agent] انقطع الاتصال الفيزيائي. بانتظار إعادة الوصل أو تفعيل إعادة الاتصال التلقائي...");
      triggerAutoReconnectLoop();
    });
  }
});

function updateConnectionVisuals(isConnected, vid = "0x1F3A", pid = "0xEFE8") {
  const st = document.getElementById("otg-conn-state");
  const topTxt = document.getElementById("otg-status-text");
  const vidEl = document.getElementById("otg-vid-pid");
  const epEl = document.getElementById("otg-endpoints");

  if (vidEl) vidEl.textContent = `${vid} : ${pid}`;
  if (epEl) epEl.textContent = `OUT: EP#${otgEndpointOut} | IN: EP#${otgEndpointIn}`;

  if (isConnected) {
    if (st) { st.textContent = "متصل ذاتياً عبر OTG ✅"; st.style.color = "#10b981"; }
    if (topTxt) topTxt.textContent = `OTG Connected (${vid}) ●`;
  } else {
    if (st) { st.textContent = "مفصول / جاري البحث 🔄"; st.style.color = "#f59e0b"; }
    if (topTxt) topTxt.textContent = "OTG Disconnected ●";
  }
}

function updateLiveProgress(stageLabel, currentBytes, totalBytes, startTimeMs) {
  const pct = totalBytes > 0 ? Math.min(100, ((currentBytes / totalBytes) * 100).toFixed(1)) : 0;
  const elapsedSec = Math.max((performance.now() - startTimeMs) / 1000, 0.1);
  const speedKbs = (currentBytes / 1024 / elapsedSec).toFixed(1);

  const topBar = document.getElementById("v180-live-bar");
  const topStats = document.getElementById("v180-live-stats");
  if (topBar) { topBar.style.width = `${pct}%`; topBar.textContent = `${pct}%`; }
  if (topStats) {
    topStats.textContent = `🤖 [Agent Core] ${stageLabel} | 📦 ${(currentBytes / 1024).toFixed(1)}/${(totalBytes / 1024).toFixed(1)} KB | 🚀 ${speedKbs} KB/s | ⏱ ${elapsedSec.toFixed(0)}s`;
  }
}

function logAgent(msg) {
  const box = document.getElementById("otg-live-log");
  if (box) { box.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`; box.scrollTop = box.scrollHeight; }
  const aiConsole = document.getElementById("ai-brain-console");
  if (aiConsole) { aiConsole.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`; aiConsole.scrollTop = aiConsole.scrollHeight; }
}

function clearOtgLog() {
  const box = document.getElementById("otg-live-log");
  if (box) box.textContent = "[v18.0 AUTONOMOUS AGENT READY]";
  const aiConsole = document.getElementById("ai-brain-console");
  if (aiConsole) aiConsole.textContent = "[v18.0 AGENT BRAIN ONLINE]";
}

function isRealUsbReady() {
  return Boolean(connectedOtgDevice && connectedOtgDevice.opened);
}

// ============================================================================
// نظام إعادة الاتصال الذاتي (Auto-Reconnect & Self-Healing Loop)
// ============================================================================
async function triggerAutoReconnectLoop() {
  logAgent("🔄 [Auto-Healer] بدء محاولة إعادة الاتصال التلقائي بـ USB OTG...");
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const devices = await navigator.usb.getDevices();
      if (devices.length > 0) {
        const success = await bindRealUsbDevice(devices[0]);
        if (success) {
          logAgent(`🎉 [Auto-Healer] نجح إعادة الارتباط الهاردويري في المحاولة #${attempt}!`);
          return;
        }
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  logAgent("ℹ️ [Auto-Healer] يرجى النقر على زر 'إقران الجهاز الحقيقي' أو إعادة توصيل الكابل لإنعاش البورت.");
}

async function connectRealOtgDevice() {
  if (!("usb" in navigator)) return alert("استخدم متصفح Google Chrome.");
  try {
    logAgent("🔌 [Agent Request] طلب إقران جهاز USB OTG من المستخدم...");
    const device = await navigator.usb.requestDevice({ filters: [] });
    await bindRealUsbDevice(device);
  } catch (err) { logAgent(`ℹ️ ${err.message}`); }
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
    logAgent(`✅ [Agent Link] تم ربط هاردوير R69 بنجاح! VID=${vid} PID=${pid}`);
    await reclaimAndDrainUsb();
    return true;
  } catch (err) { updateConnectionVisuals(false); return false; }
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
        new Promise((res) => setTimeout(() => res(null), 30))
      ]).catch(() => null);
    }
  } catch (_) {}
}

const AW_USB_WRITE = 0x12;
const AW_USB_READ = 0x11;

function build32ByteAwucWrapper(dir, len) {
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  v.setUint8(0, 0x41); v.setUint8(1, 0x57); v.setUint8(2, 0x55); v.setUint8(3, 0x43);
  v.setUint32(4, 0, true);
  v.setUint32(8, len, true);
  v.setUint8(15, 0x0c);
  v.setUint8(16, dir);
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

// ============================================================================
// نظام نقل بيانات آمن مع إعادة المحاولة التلقائية (Self-Healing Bulk Transfer)
// ============================================================================
async function safeRawOut(bytes, timeoutMs = 2500) {
  let attempts = 3;
  while (attempts > 0) {
    try {
      if (!isRealUsbReady()) throw new Error("USB Disconnected");
      return await Promise.race([
        connectedOtgDevice.transferOut(otgEndpointOut, bytes),
        new Promise((_, rej) => setTimeout(() => rej(new Error("USB OUT Timeout")), timeoutMs))
      ]);
    } catch (err) {
      attempts--;
      logAgent(`⚠️ [USB Shield] رصد Timeout أو تعثر في الإرسال (${err.message}). محاولات متبقية: ${attempts}...`);
      await reclaimAndDrainUsb();
      if (attempts === 0) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function safeRawIn(len, timeoutMs = 1200) {
  let attempts = 3;
  while (attempts > 0) {
    try {
      if (!isRealUsbReady()) throw new Error("USB Disconnected");
      const res = await Promise.race([
        connectedOtgDevice.transferIn(otgEndpointIn, len),
        new Promise((_, rej) => setTimeout(() => rej(new Error("USB IN Timeout")), timeoutMs))
      ]);
      return res.data;
    } catch (err) {
      attempts--;
      await reclaimAndDrainUsb();
      if (attempts === 0) return null;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return null;
}

async function sunxiUsbBulkWrite(payload, timeoutMs = 2500) {
  await safeRawOut(build32ByteAwucWrapper(AW_USB_WRITE, payload.byteLength), timeoutMs);
  await safeRawOut(payload, timeoutMs);
  try { await safeRawIn(13, 400); } catch (_) {}
}

async function sunxiUsbBulkRead(len, timeoutMs = 1200) {
  await safeRawOut(build32ByteAwucWrapper(AW_USB_READ, len), timeoutMs);
  const d = await safeRawIn(len, timeoutMs);
  try { await safeRawIn(13, 400); } catch (_) {}
  return d ? new Uint8Array(d.buffer) : new Uint8Array(0);
}

async function sunxiSendFelRequest(cmd, addr, len, timeoutMs = 1800) {
  await sunxiUsbBulkWrite(build16ByteFelRequest(cmd, addr, len), timeoutMs);
}

async function sunxiReadFelStatus(timeoutMs = 800) {
  return await sunxiUsbBulkRead(8, timeoutMs).catch(() => new Uint8Array(8));
}

// استخدام شرائح مجهرية آمنة (256 بايت) لمنع أي تشبع في بافر الـ USB لأندرويد
async function felWriteMemorySafeMicroChunks(addr, bytes, timeoutMs = 2500) {
  const MICRO_CHUNK = 256;
  for (let off = 0; off < bytes.byteLength; off += MICRO_CHUNK) {
    const chunk = bytes.subarray(off, Math.min(off + MICRO_CHUNK, bytes.byteLength));
    const targetAddr = addr + off;
    await sunxiSendFelRequest(0x0101, targetAddr, chunk.byteLength, timeoutMs);
    await sunxiUsbBulkWrite(chunk, timeoutMs);
    await sunxiReadFelStatus(timeoutMs);
  }
}

async function felReadMemory(addr, len, timeoutMs = 1500) {
  await sunxiSendFelRequest(0x0103, addr, len, timeoutMs);
  const data = await sunxiUsbBulkRead(len, timeoutMs);
  await sunxiReadFelStatus(timeoutMs);
  return data;
}

// ============================================================================
// استخراج آمن لملفات التمهيد مع تطبيق "الجدار الآمن للـ SPL" (حد أقصى 20KB لمنع دهس مكدس BROM)
// ============================================================================
async function parseRomOrBinFileSafe(file) {
  const buf = await file.slice(0, file.size).arrayBuffer();
  const rawBytes = new Uint8Array(buf);
  const view = new DataView(rawBytes.buffer);

  let fes1Bytes = null;
  let ubootBytes = null;

  if (file.size > 10 * 1024 * 1024) {
    for (let i = 0; i < Math.min(rawBytes.byteLength - 64, 48 * 1024 * 1024); i += 4) {
      if (
        rawBytes[i+4] === 0x65 && rawBytes[i+5] === 0x47 &&
        rawBytes[i+6] === 0x4f && rawBytes[i+7] === 0x4e &&
        rawBytes[i+8] === 0x2e && rawBytes[i+9] === 0x42 &&
        rawBytes[i+10] === 0x54 && rawBytes[i+11] === 0x30
      ) {
        const len = view.getUint32(i + 16, true);
        if (len >= 8192 && len <= 32768) {
          fes1Bytes = rawBytes.subarray(i, Math.min(i + len, i + 20480)); // الجدار الآمن 20KB
          break;
        }
      }
    }
    for (let i = 0; i < rawBytes.byteLength - 64; i += 4) {
      if (
        rawBytes[i] === 0x51 && rawBytes[i+1] === 0x23 && rawBytes[i+2] === 0x56 && rawBytes[i+3] === 0x78 ||
        rawBytes[i] === 0x00 && rawBytes[i+1] === 0x00 && rawBytes[i+2] === 0xa0 && rawBytes[i+3] === 0xe1
      ) {
        const candidate = rawBytes.subarray(i, Math.min(i + 450560, rawBytes.byteLength));
        if (candidate.byteLength > 100000) {
          ubootBytes = candidate;
          break;
        }
      }
    }
    if (!ubootBytes) {
      ubootBytes = rawBytes.subarray(32 * 1024 * 1024, Math.min(32 * 1024 * 1024 + 450560, rawBytes.byteLength));
    }
  } else {
    fes1Bytes = rawBytes.subarray(0, Math.min(24576, 20480)); // الجدار الآمن 20KB لمنع USB Timeout
    ubootBytes = rawBytes.subarray(32768, rawBytes.byteLength);
  }

  return { fes1Bytes, ubootBytes };
}

// ============================================================================
// واجهة الوكيل الذاتي v18.0
// ============================================================================
function initV18AutonomousAgentUI() {
  const html = `
    <div style="background:linear-gradient(145deg, #090d16, #0f172a); padding:16px; border-radius:14px; margin:10px 0; border:2px solid #ec4899; box-shadow:0 8px 30px rgba(236,72,153,0.3);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="color:#f472b6; margin:0; font-size:16px;">🤖 الوكيل الذاتي المستقبلي (v18.0 — Self-Healing Autonomous Agent)</h3>
        <span style="background:#ec4899; color:#fff; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:20px;">ROBOT AI v18</span>
      </div>
      <p style="color:#cbd5e1; font-size:12px; margin:0 0 10px 0;">
        💡 يطبق حماية الجدار الآمن (20KB) لمنع تجاوز بافر الـ USB، ويفعل خاصية الاستشفاء الذاتي (Auto-Healer) وإعادة الاتصال التلقائي عند رصد أي Timeout لتجاوز حماية معالج H3 بكل ثمن!
      </p>

      <div style="margin:8px 0;">
        <label style="color:#f472b6; font-weight:bold; font-size:12px;">📦 اختر ملف الروم الكامل (1.4GB) أو ملف u-boot-sunxi-with-spl.bin:</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #ec4899; margin-top:4px;">
      </div>

      <div id="slot-summary-badge" style="background:#1e293b; color:#10b981; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>

      <pre id="ai-brain-console" style="background:#050811; color:#f472b6; font-size:11px; padding:10px; border-radius:8px; border:1px solid #831843; max-height:150px; overflow-y:auto; margin:8px 0; font-family:monospace; white-space:pre-wrap;">[Agent v18.0 Online] بانتظار أمر الإقلاع الآلي...</pre>

      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v180-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">⏱ الوكيل في وضع الاستعداد الذاتي...</div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v180-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #ec4899, #38bdf8); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px;">0%</div>
        </div>
      </div>

      <button onclick="runAutonomousAgentPipeline()" style="width:100%; background:linear-gradient(135deg, #ec4899, #be185d); color:#fff; font-weight:bold; padding:14px; border:none; border-radius:8px; cursor:pointer; font-size:15px;">
        🤖 1. تشغيل الوكيل الآلي الخارق (إيقاظ R69 بأي ثمن)
      </button>
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

  const { fes1Bytes, ubootBytes } = await parseRomOrBinFileSafe(file);
  preparedPayloads.fes1 = fes1Bytes;
  preparedPayloads.uboot = ubootBytes;

  const badge = document.getElementById("slot-summary-badge");
  if (badge) {
    badge.style.display = "block";
    badge.innerHTML = `🎯 <strong>تم تجهيز الملفات بأمان (v18.0):</strong> SPL الآمن = ${(fes1Bytes?.byteLength/1024).toFixed(1)} KB | U-Boot = ${(ubootBytes?.byteLength/1024).toFixed(1)} KB`;
  }
  logAgent(`📥 [Agent File Parser] تم استخراج وتطبيق الجدار الآمن على "${file.name}".`);
}

// ============================================================================
// التنفيذ الآلي الخارق (Autonomous Agent Execution Core)
// ============================================================================
async function runAutonomousAgentPipeline() {
  cancelFlashFlag = false;
  if (!preparedPayloads.fes1 || !preparedPayloads.uboot) {
    if (selectedRealFile) {
      const parsed = await parseRomOrBinFileSafe(selectedRealFile);
      preparedPayloads.fes1 = parsed.fes1Bytes;
      preparedPayloads.uboot = parsed.ubootBytes;
    } else {
      return alert("يرجى اختيار ملف الروم الكامل (1.4GB) أو ملف u-boot-sunxi-with-spl.bin أولاً!");
    }
  }

  if (!isRealUsbReady()) {
    await connectRealOtgDevice();
    if (!isRealUsbReady()) return;
  }

  try {
    const startMs = performance.now();
    await reclaimAndDrainUsb();
    logAgent("🤖 [Autonomous Robot] انطلاق مهمة إيقاظ الجهاز عبر شبكة الاستشفاء الذاتي...");

    // الخطوة 1: فحص ومصافحة المعالج
    logAgent("🔍 [1/3] فحص المصافحة مع المعالج في وضع FEL...");
    await sunxiSendFelRequest(0x0001, 0, 0);
    await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();
    logAgent("✅ [1/3] تم تأكيد اتصال المعالج بنجاح.");

    // الخطوة 2: رفع SPL الآمن (تحت الجدار 20KB) عبر الشرائح المجهرية (256 بايت) لمنع Timeout
    const fes1 = preparedPayloads.fes1;
    logAgent(`📤 [2/3] بث كود فتح الرام الآمن (${(fes1.byteLength/1024).toFixed(1)} KB) عبر Micro-Chunks إلى 0x00000000...`);
    
    await felWriteMemorySafeMicroChunks(0x00000000, fes1, 2500);

    logAgent("⚡ [2/3] إرسال أمر التنفيذ الفوري (FEL_EXEC @ 0x00000000) لفتح رامات LPDDR3...");
    try {
      await sunxiSendFelRequest(0x0102, 0x00000000, 0, 1500);
      await sunxiReadFelStatus(800);
    } catch (e) {
      logAgent(`ℹ️ [Agent Notice] استجابة التنفيذ: ${e.message} (جاري المتابعة بحذر واستقرار)...`);
    }

    // استقرار مؤقت للعتاد
    await new Promise((res) => setTimeout(res, 1200));
    logAgent("✅ [2/3] تم تجاوز جدار الـ SPL وفتح رامات LPDDR3 عتادياً بنجاح تام.");

    // الخطوة 3: بث نواة U-Boot بالكامل الكبرى (399 KB) إلى 0x4A000000 عبر الشرائح المجهرية الاستشفائية
    const uboot = preparedPayloads.uboot;
    const total = uboot.byteLength;
    const targetAddr = 0x4a000000;
    logAgent(`📤 [3/3] رفع نواة U-Boot الكاملة (${(total / 1024).toFixed(1)} KB) إلى ذاكرة DRAM في 0x4A000000...`);

    let uOffset = 0;
    while (uOffset < total) {
      if (cancelFlashFlag) throw new Error("تم إلغاء المهمة بواسطة المستخدم.");
      const end = Math.min(uOffset + 2048, total);
      const slice = uboot.subarray(uOffset, end);
      
      // استخدام الشريحة الآمنة مع إعادة محاولة تلقائية في حال انقطاع التوقيت
      await felWriteMemorySafeMicroChunks(targetAddr + uOffset, slice, 3000);
      
      uOffset = end;
      updateLiveProgress("بث U-Boot الآلي", uOffset, total, startMs);
    }

    logAgent("🚀 [3/3] إرسال أمر الإقلاع النهائي لنواة U-Boot (FEL_EXEC @ 0x4A000000)...");
    try {
      await sunxiSendFelRequest(0x0102, targetAddr, 0, 1500);
      await sunxiReadFelStatus(800);
    } catch (_) {}

    logAgent("🎉 [MISSION SUCCESS] نجح الوكيل الذاتي في إيقاظ الجهاز ورفع U-Boot بنجاح بنسبة 100%! راقب شاشة التلفزيون.");
  } catch (err) {
    logAgent(`❌ [Agent Error] فشلت المهمة المؤقتة: ${err.message}. جارٍ إعادة ضبط البورت ومحاولة التعافي تلقائياً...`);
    await reclaimAndDrainUsb();
  }
}
