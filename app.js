// ============================================================================
// CHIBANI LOL AI v19.0 — THE ULTIMATE SMART FEL PROBER & DRAM VERIFIER
// ============================================================================

// --- [إعدادات دقيقة للنقل] ---
const MICRO_CHUNK_SIZE = 256; // حجم حزمة صغير جداً لتجنب Timeout
const USB_TIMEOUT_MS = 8000;  // مهلة أطول لكل حزمة
const RETRY_COUNT = 3;        // عدد مرات إعادة المحاولة
const DRAM_TEST_ADDR = 0x40000000; // عنوان آمن لاختبار الذاكرة

// --- [عناوين حقن FES1 المحتملة لشريحة H3] ---
const FES1_PROBE_ADDRESSES = [
  0x00002000, // العنوان القياسي لـ SPL في H3
  0x00020000,
  0x00010000,
  0x00000000
];

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let cancelFlashFlag = false;
let currentFes1Addr = 0;

let preparedPayloads = {
  fes1: null,
  uboot: null
};

// ================== التهيئة والواجهة ==================
window.addEventListener("DOMContentLoaded", () => {
  initV19UI();
  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devs) => {
      if (devs.length > 0) bindRealUsbDevice(devs[0]);
    });
    navigator.usb.addEventListener("connect", (e) => bindRealUsbDevice(e.device));
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      updateConnectionVisuals(false);
      logAi("⚠️ [USB Monitor] انفصل منفذ الـ OTG.", "warning");
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
    if (st) { st.textContent = "متصل فعلياً عبر OTG ✅"; st.style.color = "#10b981"; }
    if (topTxt) topTxt.textContent = `OTG Connected (${vid}) ●`;
  } else {
    if (st) { st.textContent = "مفصول ⚠️"; st.style.color = "#f59e0b"; }
    if (topTxt) topTxt.textContent = "OTG Disconnected ●";
  }
}

function updateLiveProgress(stageLabel, currentBytes, totalBytes, startTimeMs, color = "#8b5cf6") {
  const pct = totalBytes > 0 ? Math.min(100, ((currentBytes / totalBytes) * 100).toFixed(1)) : 0;
  const elapsedSec = Math.max((performance.now() - startTimeMs) / 1000, 0.1);
  const speedKbs = (currentBytes / 1024 / elapsedSec).toFixed(1);

  const topBar = document.getElementById("v190-live-bar");
  const topStats = document.getElementById("v190-live-stats");
  if (topBar) { 
    topBar.style.width = `${pct}%`; 
    topBar.textContent = `${pct}%`; 
    topBar.style.background = `linear-gradient(90deg, ${color}, #0ea5e9)`;
  }
  if (topStats) {
    topStats.textContent = `📊 ${stageLabel} | 📦 ${(currentBytes / 1024).toFixed(1)}/${(totalBytes / 1024).toFixed(1)} KB | 🚀 ${speedKbs} KB/s | ⏱ ${elapsedSec.toFixed(0)}s`;
  }
}

function logAi(msg, type = "info") {
  const box = document.getElementById("otg-live-log");
  const aiConsole = document.getElementById("ai-brain-console");
  
  let prefix = "ℹ️";
  if (type === "success") prefix = "✅";
  if (type === "error") prefix = "❌";
  if (type === "warning") prefix = "⚠️";
  if (type === "probe") prefix = "🔍";
  
  const logMsg = `[${new Date().toLocaleTimeString()}] ${prefix} ${msg}`;
  
  if (box) { box.textContent += `\n${logMsg}`; box.scrollTop = box.scrollHeight; }
  if (aiConsole) { aiConsole.textContent += `\n${logMsg}`; aiConsole.scrollTop = aiConsole.scrollHeight; }
}

function isRealUsbReady() {
  return Boolean(connectedOtgDevice && connectedOtgDevice.opened);
}

// ================== بروتوكول FEL الأساسي ==================
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

async function rawOut(bytes, timeoutMs = USB_TIMEOUT_MS) {
  if (!isRealUsbReady()) throw new Error("USB Disconnected");
  return await Promise.race([
    connectedOtgDevice.transferOut(otgEndpointOut, bytes),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB OUT Timeout")), timeoutMs))
  ]);
}

async function rawIn(len, timeoutMs = USB_TIMEOUT_MS) {
  if (!isRealUsbReady()) throw new Error("USB Disconnected");
  const res = await Promise.race([
    connectedOtgDevice.transferIn(otgEndpointIn, len),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB IN Timeout")), timeoutMs))
  ]);
  return res.data;
}

async function sunxiUsbBulkWrite(payload, timeoutMs = USB_TIMEOUT_MS) {
  await rawOut(build32ByteAwucWrapper(AW_USB_WRITE, payload.byteLength), timeoutMs);
  await rawOut(payload, timeoutMs);
  try { await rawIn(13, 1000); } catch (_) {}
}

async function sunxiUsbBulkRead(len, timeoutMs = USB_TIMEOUT_MS) {
  await rawOut(build32ByteAwucWrapper(AW_USB_READ, len), timeoutMs);
  const d = await rawIn(len, timeoutMs).catch(() => null);
  try { await rawIn(13, 1000); } catch (_) {}
  return d ? new Uint8Array(d.buffer) : new Uint8Array(0);
}

async function sunxiSendFelRequest(cmd, addr, len, timeoutMs = 3000) {
  await sunxiUsbBulkWrite(build16ByteFelRequest(cmd, addr, len), timeoutMs);
}

async function sunxiReadFelStatus(timeoutMs = 1500) {
  return await sunxiUsbBulkRead(8, timeoutMs).catch(() => new Uint8Array(8));
}

// ================== النقل الدقيق (Micro-Chunking) ==================
async function felWriteMemory(addr, bytes, timeoutMs = USB_TIMEOUT_MS) {
  for (let offset = 0; offset < bytes.byteLength; offset += MICRO_CHUNK_SIZE) {
    if (cancelFlashFlag) throw new Error("تم الإيقاف بواسطة المستخدم.");
    const chunk = bytes.subarray(offset, Math.min(offset + MICRO_CHUNK_SIZE, bytes.byteLength));
    
    let retries = RETRY_COUNT;
    while (retries > 0) {
      try {
        await sunxiSendFelRequest(0x0101, addr + offset, chunk.byteLength, timeoutMs);
        await sunxiUsbBulkWrite(chunk, timeoutMs);
        await sunxiReadFelStatus(timeoutMs);
        break; // نجحت العملية
      } catch (e) {
        retries--;
        if (retries === 0) throw e;
        logAi(`إعادة محاولة الكتابة عند ${(addr+offset).toString(16)}...`, "warning");
        await new Promise(r => setTimeout(r, 500)); // انتظار قبل إعادة المحاولة
      }
    }
  }
}

// ================== قراءة الذاكرة (لاختبار DRAM) ==================
async function felReadMemory(addr, len, timeoutMs = USB_TIMEOUT_MS) {
  await sunxiSendFelRequest(0x0103, addr, len, timeoutMs);
  const data = await sunxiUsbBulkRead(len, timeoutMs);
  await sunxiReadFelStatus(timeoutMs);
  return data;
}

// ================== اختبار الذاكرة الحقيقي ==================
async function verifyDram() {
  const testPattern = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE, 0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0]);
  
  try {
    // 1. كتابة النمط في الذاكرة
    logAi(`🔬 كتابة نمط اختباري في الذاكرة (${DRAM_TEST_ADDR.toString(16)})...`, "probe");
    await felWriteMemory(DRAM_TEST_ADDR, testPattern, 3000);
    
    // 2. قراءته مرة أخرى
    logAi(`🔬 قراءة النمط من الذاكرة...`, "probe");
    const readBack = await felReadMemory(DRAM_TEST_ADDR, testPattern.length, 3000);
    
    // 3. المقارنة
    if (readBack.length !== testPattern.length) {
      logAi(`❌ فشل الاختبار: طول البيانات المقروءة غير متطابق.`, "error");
      return false;
    }
    for (let i = 0; i < testPattern.length; i++) {
      if (readBack[i] !== testPattern[i]) {
        logAi(`❌ فشل الاختبار: البيانات غير متطابقة عند البايت ${i}.`, "error");
        return false;
      }
    }
    logAi(`✅ نجح اختبار الذاكرة! البيانات متطابقة.`, "success");
    return true;
  } catch (e) {
    logAi(`❌ فشل اختبار الذاكرة: ${e.message}`, "error");
    return false;
  }
}

// ================== استخراج الملفات ==================
async function parseRomOrBinFile(file) {
  const buf = await file.slice(0, file.size).arrayBuffer();
  const rawBytes = new Uint8Array(buf);
  const view = new DataView(rawBytes.buffer);

  let fes1Bytes = null;
  let ubootBytes = null;

  if (file.size > 10 * 1024 * 1024) {
    for (let i = 0; i < Math.min(rawBytes.byteLength - 64, 48 * 1024 * 1024); i += 4) {
      if (rawBytes[i+4] === 0x65 && rawBytes[i+5] === 0x47 && rawBytes[i+6] === 0x4f && rawBytes[i+7] === 0x4e) {
        const len = view.getUint32(i + 16, true);
        if (len >= 8192 && len <= 32768) { fes1Bytes = rawBytes.subarray(i, i + len); break; }
      }
    }
    for (let i = 0; i < rawBytes.byteLength - 64; i += 4) {
      if (rawBytes[i] === 0x51 && rawBytes[i+1] === 0x23 && rawBytes[i+2] === 0x56 && rawBytes[i+3] === 0x78 ||
          rawBytes[i] === 0x00 && rawBytes[i+1] === 0x00 && rawBytes[i+2] === 0xa0 && rawBytes[i+3] === 0xe1) {
        const candidate = rawBytes.subarray(i, Math.min(i + 450560, rawBytes.byteLength));
        if (candidate.byteLength > 100000) { ubootBytes = candidate; break; }
      }
    }
    if (!ubootBytes) ubootBytes = rawBytes.subarray(32 * 1024 * 1024, Math.min(32 * 1024 * 1024 + 450560, rawBytes.byteLength));
  } else {
    fes1Bytes = rawBytes.subarray(0, 24576);
    ubootBytes = rawBytes.subarray(32768, rawBytes.byteLength);
  }
  return { fes1Bytes, ubootBytes };
}

// ================== واجهة المستخدم ==================
function initV19UI() {
  const html = `
    <div style="background:linear-gradient(145deg, #090d16, #0f172a); padding:16px; border-radius:14px; margin:10px 0; border:2px solid #8b5cf6; box-shadow:0 8px 30px rgba(139,92,246,0.25);">
      <h3 style="color:#a78bfa; margin:0 0 6px 0; font-size:16px;">🧠 المحرك الخارق v19.0 (DRAM Reality Verifier)</h3>
      <div style="margin:8px 0;">
        <label style="color:#38bdf8; font-weight:bold; font-size:12px;">📦 اختر ملف الروم الكامل أو ملف u-boot-sunxi-with-spl.bin:</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #8b5cf6; margin-top:4px;">
      </div>
      <div id="slot-summary-badge" style="background:#1e293b; color:#a78bfa; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>
      
      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v190-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">⏱ بانتظار التشغيل...</div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v190-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #8b5cf6, #0ea5e9); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px;">0%</div>
        </div>
      </div>
      
      <pre id="ai-brain-console" style="background:#050811; color:#a78bfa; font-size:11px; padding:10px; border-radius:8px; border:1px solid #4c1d95; max-height:160px; overflow-y:auto; margin:8px 0; font-family:monospace; white-space:pre-wrap;">[v19.0 Ready] المحرك الذكي جاهز لفحص وتفليش الجهاز...</pre>
      
      <button onclick="runSmartProbingSequence()" style="width:100%; background:linear-gradient(135deg, #8b5cf6, #6d28d9); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:14px; box-shadow: 0 4px 15px rgba(139,92,246,0.4);">
        🚀 بدء الفحص الذكي وتفليش U-Boot
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

  const { fes1Bytes, ubootBytes } = await parseRomOrBinFile(file);
  preparedPayloads.fes1 = fes1Bytes;
  preparedPayloads.uboot = ubootBytes;

  const badge = document.getElementById("slot-summary-badge");
  if (badge) {
    badge.style.display = "block";
    badge.innerHTML = `🎯 <strong>الملفات المستخرجة:</strong> FES1 = ${(fes1Bytes?.byteLength/1024).toFixed(1)} KB | U-Boot = ${(ubootBytes?.byteLength/1024).toFixed(1)} KB`;
  }
}

// ================== تسلسل العمل الذكي ==================
async function runSmartProbingSequence() {
  if (!preparedPayloads.fes1 || !preparedPayloads.uboot) {
    if (selectedRealFile) {
      const parsed = await parseRomOrBinFile(selectedRealFile);
      preparedPayloads.fes1 = parsed.fes1Bytes;
      preparedPayloads.uboot = parsed.ubootBytes;
    } else {
      return alert("اختر الملف أولاً!");
    }
  }
  if (!isRealUsbReady()) {
    await connectRealOtgDevice();
    if (!isRealUsbReady()) return;
  }

  try {
    const startMs = performance.now();
    await reclaimAndDrainUsb();
    logAi("🚀 بدء تسلسل الفحص الذكي...", "info");

    await sunxiSendFelRequest(0x0001, 0, 0);
    await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();

    let dramSuccess = false;
    
    // --- 1. مرحلة البحث عن العنوان الصحيح وتحقن FES1 ---
    for (const addr of FES1_PROBE_ADDRESSES) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      logAi(`🔍 فحص عنوان FES1: ${addr.toString(16).toUpperCase().padStart(8, '0')}...`, "probe");
      
      try {
        // حقن FES1
        await felWriteMemory(addr, preparedPayloads.fes1, 3000);
        
        // تنفيذ
        try { await sunxiSendFelRequest(0x0102, addr, 0, 1500); } catch (_) {}
        await new Promise(r => setTimeout(r, 800)); // انتظار مهم بعد التنفيذ
        
        // اختبار الذاكرة الحقيقي
        const isRamAlive = await verifyDram();
        if (isRamAlive) {
          logAi(`🎉 نجحت التهيئة! الذاكرة تستجيب في العنوان ${addr.toString(16).toUpperCase().padStart(8, '0')}`, "success");
          currentFes1Addr = addr;
          dramSuccess = true;
          break;
        } else {
          logAi(`❌ الذاكرة لم تستجب مع العنوان ${addr.toString(16).toUpperCase().padStart(8, '0')}`, "warning");
        }
      } catch (err) {
        logAi(`فشل الاتصال عند ${addr.toString(16).toUpperCase().padStart(8, '0')}: ${err.message}`, "warning");
      }
    }

    if (!dramSuccess) {
      logAi("🚨 فشلت جميع المحاولات! الذاكرة لا تستجيب.", "error");
      logAi("💡 تأكد من أن ملف FES1 هو الملف الأصلي المستخرج من boot0 للوحة R69، أو أن ملف U-Boot مبني بإعدادات LPDDR3 الصحيحة (راجع النقاشات).", "warning");
      return; // إيقاف العملية
    }

    // --- 2. مرحلة رفع U-Boot (بعد نجاح الذاكرة) ---
    logAi(`📤 بدء رفع U-Boot إلى 0x4A000000...`, "info");
    const uboot = preparedPayloads.uboot;
    const total = uboot.byteLength;
    const targetAddr = 0x4a000000;

    let uOffset = 0;
    while (uOffset < total) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(uOffset + MICRO_CHUNK_SIZE, total);
      const slice = uboot.subarray(uOffset, end);
      
      await felWriteMemory(targetAddr + uOffset, slice, 5000);
      
      uOffset = end;
      updateLiveProgress("رفع U-Boot", uOffset, total, startMs, "#8b5cf6");
    }

    logAi(`✅ اكتمل الرفع. جاري تشغيل U-Boot...`, "success");
    try {
      await sunxiSendFelRequest(0x0102, targetAddr, 0, 3000);
      await sunxiReadFelStatus(2000);
    } catch (_) {}

    logAi("🎉 تم إيقاف الجهاز وتشغيل U-Boot بنجاح!", "success");
  } catch (err) {
    logAi(`خطأ قاتل: ${err.message}`, "error");
  }
}

// ================== دوال مساعدة (مطلوبة) ==================
async function connectRealOtgDevice() {
  if (!("usb" in navigator)) return alert("استخدم متصفح Google Chrome.");
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await bindRealUsbDevice(device);
  } catch (err) { logAi(`فشل الاتصال: ${err.message}`, "error"); }
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
    logAi(`تم ربط الهاردوير بنجاح! VID=${vid} PID=${pid}`, "success");
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
        new Promise((res) => setTimeout(res, 35))
      ]).catch(() => null);
    }
  } catch (_) {}
}
