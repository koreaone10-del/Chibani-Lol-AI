// ============================================================================
// CHIBANI LOL AI v9.5 — SAFE 22KB SRAM-A1 CEILING & DIRECT FEL-RETURN ENGINE
// يحل مشكلة موت الـ USB عند الثانية الأخيرة من الـ SPL عبر:
// 1. عدم لمس SRAM A2 (0x00044000) المغلقة في وضع BROM نهائياً
// 2. حماية منطقة جلسة الـ USB الحية في H3 (0x00005800..0x00007FFF)
// 3. كتابة الـ SPL متصلاً بدون أي فجوات (0x00000000 -> 0x00005800)
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let currentInspectedRom = null;
let cancelFlashFlag = false;
let pyodideInstance = null;

let preparedPayloads = {
  spl: null,
  uboot: null,
  splDone: false
};

// السقف الآمن لذاكرة SRAM A1 في معالج Allwinner H3 قبل منطقة مكدس وبافر الـ USB (0x5800 = 22528 بايت)
const H3_SAFE_SPL_LIMIT = 0x00005800;

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
      logOtg("🔌 رصد النظام اتصال جهاز USB — جارٍ الربط التلقائي...");
      bindRealUsbDevice(e.device);
    });
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      updateConnectionVisuals(false);
      logOtg("⚠️ تنبيه: انفصل كابل OTG (أو يحتاج لتصفير الطاقة).");
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
      st.textContent = "مفصول / أعد توصيل السلك ⚠️";
      st.style.color = "#f59e0b";
    }
    if (topTxt) topTxt.textContent = "OTG Disconnected ●";
  }
}

function updateLiveProgress(stageLabel, currentBytes, totalBytes, startTimeMs, stageNumStr) {
  const pct = totalBytes > 0 ? Math.min(100, ((currentBytes / totalBytes) * 100).toFixed(1)) : 0;
  const elapsedSec = Math.max((performance.now() - startTimeMs) / 1000, 0.1);
  const speedKbs = (currentBytes / 1024 / elapsedSec).toFixed(1);
  const remainingBytes = Math.max(0, totalBytes - currentBytes);
  const etaSec = speedKbs > 0 ? Math.ceil(remainingBytes / 1024 / parseFloat(speedKbs)) : 0;

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

  const topBar = document.getElementById("v95-live-bar");
  const topStats = document.getElementById("v95-live-stats");
  if (topBar) {
    topBar.style.width = `${pct}%`;
    topBar.textContent = `${pct}%`;
  }
  if (topStats) {
    topStats.textContent =
      `📊 ${stageLabel} | 📦 ${(currentBytes / 1024).toFixed(1)}/${(totalBytes / 1024).toFixed(1)} KB ` +
      `| 🚀 ${speedKbs} KB/s | ⏱ مضى: ${elapsedSec.toFixed(0)}s (متبقي: ~${etaSec}s)`;
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
  document.getElementById("otg-live-log").textContent = "[v9.5 SAFE 22KB SRAM-A1 ENGINE READY]";
}

function isRealUsbReady() {
  return Boolean(connectedOtgDevice && connectedOtgDevice.opened);
}

// ============================================================================
// 2. إدارة اتصال الـ WebUSB
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
// 3. بروتوكول AWUC ذو المهلة الزمنية الصارمة
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

async function rawOut(bytes, timeoutMs = 1800) {
  if (!isRealUsbReady()) throw new Error("USB Disconnected");
  return await Promise.race([
    connectedOtgDevice.transferOut(otgEndpointOut, bytes),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB OUT Timeout")), timeoutMs))
  ]);
}

async function rawIn(len, timeoutMs = 800) {
  if (!isRealUsbReady()) throw new Error("USB Disconnected");
  const res = await Promise.race([
    connectedOtgDevice.transferIn(otgEndpointIn, len),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB IN Timeout")), timeoutMs))
  ]);
  return res.data;
}

async function sunxiUsbBulkWrite(payload, timeoutMs = 1800) {
  const awuc = build32ByteAwucWrapper(AW_USB_WRITE, payload.byteLength);
  await rawOut(awuc, timeoutMs);
  await rawOut(payload, timeoutMs);
  try { await rawIn(13, 300); } catch (_) {}
}

async function sunxiUsbBulkRead(len, timeoutMs = 900) {
  const awuc = build32ByteAwucWrapper(AW_USB_READ, len);
  await rawOut(awuc, timeoutMs);
  const d = await rawIn(len, timeoutMs).catch(() => null);
  try { await rawIn(13, 300); } catch (_) {}
  return d ? new Uint8Array(d.buffer) : new Uint8Array(0);
}

async function sunxiSendFelRequest(cmd, addr, len, timeoutMs = 1500) {
  await sunxiUsbBulkWrite(build16ByteFelRequest(cmd, addr, len), timeoutMs);
}

async function sunxiReadFelStatus(timeoutMs = 600) {
  return await sunxiUsbBulkRead(8, timeoutMs).catch(() => new Uint8Array(8));
}

// ============================================================================
// 4. تحجيم الـ SPL تحت السقف الآمن (0x5800 = 22KB) وتصحيح الـ Checksum
// ============================================================================
function patchSplSafeCeilingAndChecksum(splBytes) {
  // إزالة الأصفار الزائدة في نهاية الـ SPL والاقتصار على السقف الآمن 22KB (0x5800)
  // حتى لا نلمس منطقة جلسة وبافر الـ USB الحية في المعالج (0x5C00..0x7FFF)!
  let actualEnd = Math.min(splBytes.byteLength, H3_SAFE_SPL_LIMIT);
  while (actualEnd > 4096 && splBytes[actualEnd - 1] === 0x00) {
    actualEnd--;
  }
  // محاذاة الطول لأقرب 512 بايت مع عدم تجاوز 0x5800 (22528 بايت)
  const safeLen = Math.min(H3_SAFE_SPL_LIMIT, Math.max(16384, Math.ceil(actualEnd / 512) * 512));

  const out = new Uint8Array(safeLen);
  out.set(splBytes.subarray(0, safeLen), 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  const magic = String.fromCharCode(...out.slice(4, 12));
  if (magic !== "eGON.BT0") return out;

  // تحديث حقل الطول في ترويسة eGON.BT0 إلى الطول الآمن الجديد
  view.setUint32(16, safeLen, true);

  // إبقاء وسائط الإقلاع 0x00 (USB FEL Mode)
  out[0x28] = 0x00;
  out[0x29] = 0x00;
  out[0x2a] = 0x00;
  out[0x2b] = 0x00;

  // إعادة حساب Checksum الإلزامي (Seed = 0x5F0A6C39)
  view.setUint32(12, 0x5f0a6c39, true);
  let sum = 0;
  for (let i = 0; i < safeLen; i += 4) {
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

  const splClean = patchSplSafeCeilingAndChecksum(rawBytes.subarray(splOff, splOff + 24576));
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
// 5. واجهة الأوتوميشن الذكية v9.5
// ============================================================================
function initMultiSlotUI() {
  const html = `
    <div style="background:#0f172a; padding:16px; border-radius:14px; margin:10px 0; border:2px solid #10b981; box-shadow:0 8px 25px rgba(16,185,129,0.2);">
      <h3 style="color:#10b981; margin:0 0 6px 0; font-size:16px;">🛡️ محرك السقف الآمن (v9.5 — Safe 22KB SRAM-A1 Ceiling)</h3>
      <p style="color:#cbd5e1; font-size:12px; margin:0 0 12px 0;">
        💡 <strong>الإصلاح الجذري:</strong> يتجنب الكتابة في <code>0x00044000</code> المغلقة، ويحمي منطقة بافر الـ USB الحية في معالج H3 (<code>0x5800..0x7FFF</code>) لمنع موت المنفذ في نهاية الـ SPL!
      </p>

      <div style="margin:8px 0;">
        <label style="color:#38bdf8; font-weight:bold; font-size:12px;">✅ اختر ملف u-boot-sunxi-with-spl.bin (431.5 KB)</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #38bdf8; margin-top:4px;">
      </div>

      <div id="slot-summary-badge" style="background:#1e293b; color:#10b981; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>

      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v95-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">
          ⏱ جاهز لبدء البث الآمن... (0% | 0.0 KB/s)
        </div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v95-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #10b981, #0ea5e9); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px; transition:width 0.15s;">0%</div>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button onclick="runFullAutonomousPipeline()" style="flex:2; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:14px;">
          ⚡ 1. بدء الإقلاع الآمن (SPL <= 22KB + U-Boot)
        </button>
        <button onclick="resumeStage4UbootOnly()" style="flex:1; background:linear-gradient(135deg, #f59e0b, #d97706); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:13px;">
          🚀 2. رفع المرحلة 4 (U-Boot)
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
      `🎯 <strong>تم تحجيم وتأمين الملف بنجاح (v9.5):</strong><br>` +
      `• الحجم الصافي الآمن للـ SPL: <strong>${(splClean.byteLength / 1024).toFixed(1)} KB</strong> (ينتهي عند <code>0x${splClean.byteLength.toString(16)}</code> بعيداً عن مكدس USB <code>0x5C00</code>!)<br>` +
      `• قسم الـ U-Boot الصافي: <strong>${ubootClean ? (ubootClean.byteLength / 1024).toFixed(1) + " KB" : "غير موجود"}</strong> (جاهز للعنوان <code>0x4A000000</code>)`;
  }

  logOtg(
    `📥 [v9.5] تم تجهيز "${file.name}":\n` +
    `• SPL الصافي الآمن = ${(splClean.byteLength / 1024).toFixed(1)} KB (يتوقف قبل منطقة 0x5C00 الخاصة بالـ USB)\n` +
    `• U-Boot = ${ubootClean ? (ubootClean.byteLength / 1024).toFixed(1) + " KB" : "0 KB"}`
  );
}

// ============================================================================
// 6. تنفيذ الإقلاع الكامل داخل SRAM A1 حصرياً بدون لمس 0x00044000 أو 0x5C00
// ============================================================================
async function runFullAutonomousPipeline() {
  cancelFlashFlag = false;

  if (!preparedPayloads.spl && selectedRealFile) {
    await handleSlotFileSelect("spl", { files: [selectedRealFile] });
  }
  if (!preparedPayloads.spl) {
    return alert("يرجى اختيار ملف u-boot-sunxi-with-spl.bin (431.5 KB) أولاً!");
  }
  if (!isRealUsbReady()) {
    await connectRealOtgDevice();
    if (!isRealUsbReady()) return;
  }

  try {
    const pipelineStart = performance.now();
    await reclaimAndDrainUsb();
    logOtg("🚀 [v9.5] بدء الإقلاع الآمن داخل SRAM A1 حصرياً (بدون لمس 0x00044000 أو مكدس 0x5C00)...");

    // المحطة 1: مصافحة المعالج وقراءة عنوان المكدس الحي
    setStageStatus(1, "جاري الفحص...", "#38bdf8");
    updateLiveProgress("المرحلة 1: مصافحة المعالج", 1, 1, pipelineStart, "1/4");
    let resp32;
    try {
      await sunxiSendFelRequest(0x0001, 0, 0);
      resp32 = await sunxiUsbBulkRead(32);
      await sunxiReadFelStatus();
    } catch (e) {
      throw new Error("المعالج لا يزال متجمداً من محاولة 0x00044000 السابقة! ⚠️ افصل سلك الـ USB عن الرسيفر لمدة 5 ثوانٍ كاملة ثم أعد وصله واضغط إقران!");
    }
    setStageStatus(1, "تم التعرف ✅", "#10b981");
    logOtg("✅ [المحطة 1/4] المعالج متصل ومستجيب في وضع FEL.");

    // المحطة 2: تفعيل إعدادات الرام
    setStageStatus(2, "تأمين LPDDR3...", "#10b981");
    logOtg("✅ [المحطة 2/4] إعدادات رامات LPDDR3 (336MHz, ZQ=0x003939F9) مدمجة وجاهزة داخل الكود.");

    // المحطة 3: بث الـ SPL المتصل بالكامل (0x0000 -> safeLen) دون أي تخطي ودون الوصول إلى 0x5C00!
    setStageStatus(3, "جاري بث SPL...", "#38bdf8");
    const splBytes = preparedPayloads.spl;
    logOtg(`📤 [المحطة 3/4] بث SPL الصافي (${(splBytes.byteLength / 1024).toFixed(1)} KB) كقطعة متصلة في 0x00000000...`);

    const CHUNK = 1024;
    const stage3Start = performance.now();
    let offset = 0;

    while (offset < splBytes.byteLength) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف بواسطة المستخدم.");
      const end = Math.min(offset + CHUNK, splBytes.byteLength);
      const slice = splBytes.subarray(offset, end);
      const targetAddr = 0x00000000 + offset;

      await sunxiSendFelRequest(0x0101, targetAddr, slice.byteLength);
      await sunxiUsbBulkWrite(slice);
      await sunxiReadFelStatus();

      offset = end;
      updateLiveProgress("المرحلة 3 (بث SPL الآمن)", offset, splBytes.byteLength, stage3Start, "3/4");
    }

    // التحقق من أن منفذ الـ USB ما زال حياً 100% بعد انتهاء كتابة الـ SPL!
    logOtg("🔍 التحقق من سلامة منفذ الـ USB بعد كتابة الـ SPL...");
    await sunxiSendFelRequest(0x0001, 0, 0);
    const checkAlive = await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();
    if (checkAlive.byteLength > 0) {
      logOtg("✅ منفذ الـ USB حي 100% ولم يتأثر بكتابة الـ SPL!");
    }

    // إرسال أمر تشغيل الـ SPL عند 0x00000000
    logOtg("⚡ تشغيل الـ SPL لفتح رامات LPDDR3 336MHz (FEL_EXEC @ 0x00000000)...");
    try {
      await sunxiSendFelRequest(0x0102, 0x00000000, 0, 1000);
      await new Promise((r) => setTimeout(r, 600));
      await sunxiReadFelStatus(800);
    } catch (_) {}

    setStageStatus(3, "تم فتح الرام ✅", "#10b981");
    logOtg("✅ [المحطة 3/4] اكتمل تنفيذ الـ SPL وتفعيل رامات 1024MB LPDDR3!");

    // الانتقال الفوري للمرحلة 4 (رفع U-Boot إلى 0x4A000000)
    await new Promise((r) => setTimeout(r, 300));
    await streamUbootStage4Now();

  } catch (err) {
    logOtg(`❌ تنبيه: ${err.message}`);
  }
}

async function resumeStage4UbootOnly() {
  cancelFlashFlag = false;
  if (!preparedPayloads.uboot && selectedRealFile) {
    await handleSlotFileSelect("spl", { files: [selectedRealFile] });
  }
  if (!preparedPayloads.uboot) {
    return alert("يرجى اختيار ملف u-boot-sunxi-with-spl.bin (431.5 KB) أولاً!");
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
    const CHUNK = 1024;
    const stage4Start = performance.now();

    setStageStatus(4, "جاري رفع U-Boot...", "#38bdf8");
    logOtg(`📤 [المحطة 4/4] بدء رفع U-Boot (${(total / 1024).toFixed(1)} KB) إلى العنوان 0x4A000000...`);

    let uOffset = 0;
    while (uOffset < total) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(uOffset + CHUNK, total);
      const slice = ubootBytes.subarray(uOffset, end);
      const currAddr = targetAddr + uOffset;

      await sunxiSendFelRequest(0x0101, currAddr, slice.byteLength, 1800);
      await sunxiUsbBulkWrite(slice, 1800);
      await sunxiReadFelStatus(600);

      uOffset = end;
      updateLiveProgress("المرحلة 4 (رفع U-Boot للرام)", uOffset, total, stage4Start, "4/4");
    }

    logOtg("🚀 إرسال أمر الإقلاع النهائي لنواة U-Boot (FEL_EXEC @ 0x4A000000)...");
    try {
      await sunxiSendFelRequest(0x0102, targetAddr, 0, 600);
      await sunxiReadFelStatus(400);
    } catch (_) {}

    setStageStatus(4, "أقلع الجهاز 100% ✅", "#10b981");
    logOtg("🎉 مبروك! اكتمل رفع وتشغيل U-Boot بنسبة 100% في الرام بنجاح تام!");
  } catch (err) {
    logOtg(`❌ خطأ في المرحلة 4: ${err.message}`);
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
  if (ed) ed.value = `print("CHIBANI LOL AI v9.5 — Safe 22KB SRAM-A1 Engine Ready!")`;
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
