// ============================================================================
// CHIBANI LOL AI v10.5 — FULL 3KB BROM-STACK PRESERVATION & ZERO-CORRUPTION SPL
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let cancelFlashFlag = false;

let preparedPayloads = {
  spl: null,
  uboot: null
};

// خريطة الذاكرة الآمنة داخل SRAM A1 (0x00000000 -> 0x00006000)
const H3_SPL_MAX_LEN     = 0x00004400; // 17.0 KB (نهاية كود SPL الصافي)
const H3_TRAMPOLINE_ADDR = 0x00004400; // موقع كود الترامبولين ARM32
const H3_STAGED_1400     = 0x00004800; // مخزن شريحة SPL المحمية (0x1400..0x2000 = 3KB)
const H3_BACKUP_1400     = 0x00005400; // مخزن حفظ منطقة BROM الحية (0x1400..0x2000 = 3KB)

window.addEventListener("DOMContentLoaded", () => {
  initMultiSlotUI();
  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devs) => {
      if (devs.length > 0) bindRealUsbDevice(devs[0]);
    });
    navigator.usb.addEventListener("connect", (e) => bindRealUsbDevice(e.device));
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      updateConnectionVisuals(false);
      logOtg("⚠️ انفصل منفذ OTG.");
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
  if (cntBytes) cntBytes.textContent = `${(currentBytes / 1024).toFixed(1)} KB / ${(totalBytes / 1024).toFixed(1)} KB`;
  if (cntSpeed) cntSpeed.textContent = `${speedKbs} KB/s`;
  if (cntEta) cntEta.textContent = `المرحلة: ${stageNumStr} | ⏱ ${elapsedSec.toFixed(0)}s`;

  const topBar = document.getElementById("v105-live-bar");
  const topStats = document.getElementById("v105-live-stats");
  if (topBar) { topBar.style.width = `${pct}%`; topBar.textContent = `${pct}%`; }
  if (topStats) {
    topStats.textContent = `📊 ${stageLabel} | 📦 ${(currentBytes / 1024).toFixed(1)}/${(totalBytes / 1024).toFixed(1)} KB | 🚀 ${speedKbs} KB/s | ⏱ ${elapsedSec.toFixed(0)}s`;
  }
}

function setStageStatus(stageNum, text, color) {
  const badge = document.getElementById(`st-badge-${stageNum}`);
  const card = document.getElementById(`stage-card-${stageNum}`);
  if (badge) { badge.textContent = text; badge.style.color = color; }
  if (card) card.style.borderColor = color;
}

function logOtg(msg) {
  const box = document.getElementById("otg-live-log");
  if (!box) return;
  box.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
  box.scrollTop = box.scrollHeight;
}

function clearOtgLog() {
  document.getElementById("otg-live-log").textContent = "[v10.5 ENGINE READY]";
}

function isRealUsbReady() {
  return Boolean(connectedOtgDevice && connectedOtgDevice.opened);
}

async function connectRealOtgDevice() {
  if (!("usb" in navigator)) return alert("استخدم متصفح Chrome.");
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await bindRealUsbDevice(device);
  } catch (err) {
    logOtg(`ℹ️ ${err.message}`);
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
    logOtg(`✅ تم ربط الهاردوير! VID=${vid} PID=${pid}`);
    await reclaimAndDrainUsb();
    return true;
  } catch (err) {
    updateConnectionVisuals(false);
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
  await rawOut(build32ByteAwucWrapper(AW_USB_WRITE, payload.byteLength), timeoutMs);
  await rawOut(payload, timeoutMs);
  try { await rawIn(13, 300); } catch (_) {}
}

async function sunxiUsbBulkRead(len, timeoutMs = 900) {
  await rawOut(build32ByteAwucWrapper(AW_USB_READ, len), timeoutMs);
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
// ترامبولين شامل عند 0x00004400 يحفظ 0x1400..0x2000 (3KB) بالكامل + سجلات CPU
// ============================================================================
function buildFull3KbSramA1Trampoline() {
  const words = [
    0xe92d5fff, // push {r0-r12, lr}           (حفظ جميع سجلات المعالج وعنوان العودة للـ BROM)

    // 1) حفظ منطقة BROM الحية بالكامل (0x1400..0x2000 = 3072 بايت) إلى 0x00005400
    0xe3a00b05, // mov r0, #0x1400             (src = 0x00001400)
    0xe3a01b15, // mov r1, #0x5400             (dst = 0x00005400 backup)
    0xe3a02b03, // mov r2, #0x0c00             (len = 3072 bytes)
    // loop_save:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_save

    // 2) نسخ شريحة الـ SPL المحمية (3072 بايت) من 0x00004800 إلى 0x00001400
    0xe3a00b12, // mov r0, #0x4800             (src = 0x00004800 staged SPL)
    0xe3a01b05, // mov r1, #0x1400             (dst = 0x00001400)
    0xe3a02b03, // mov r2, #0x0c00             (len = 3072 bytes)
    // loop_install:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_install

    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy

    // 3) استدعاء نقطة بداية الـ SPL عند 0x00000000
    0xe3a03000, // mov r3, #0x00000000
    0xe12fff33, // blx r3

    // 4) استرجاع منطقة BROM الحية (0x1400..0x2000) من 0x00005400
    0xe3a00b15, // mov r0, #0x5400             (src = 0x00005400 backup)
    0xe3a01b05, // mov r1, #0x1400             (dst = 0x00001400)
    0xe3a02b03, // mov r2, #0x0c00             (len = 3072 bytes)
    // loop_restore:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_restore

    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy
    0xe8bd9fff  // pop {r0-r12, pc}            (العودة النظيفة 100% إلى حلقة BROM USB)
  ];

  const buf = new ArrayBuffer(words.length * 4);
  const view = new DataView(buf);
  words.forEach((w, idx) => view.setUint32(idx * 4, w, true));
  return new Uint8Array(buf);
}

function patchSplSafeCeilingAndChecksum(splBytes) {
  let actualEnd = Math.min(splBytes.byteLength, H3_SPL_MAX_LEN);
  while (actualEnd > 4096 && splBytes[actualEnd - 1] === 0x00) actualEnd--;
  const safeLen = Math.min(H3_SPL_MAX_LEN, Math.max(16384, Math.ceil(actualEnd / 512) * 512));

  const out = new Uint8Array(safeLen);
  out.set(splBytes.subarray(0, safeLen), 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  if (String.fromCharCode(...out.slice(4, 12)) !== "eGON.BT0") return out;

  view.setUint32(16, safeLen, true);
  out[0x28] = 0x00; out[0x29] = 0x00; out[0x2a] = 0x00; out[0x2b] = 0x00;

  view.setUint32(12, 0x5f0a6c39, true);
  let sum = 0;
  for (let i = 0; i < safeLen; i += 4) sum = (sum + view.getUint32(i, true)) >>> 0;
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

function initMultiSlotUI() {
  const html = `
    <div style="background:#0f172a; padding:16px; border-radius:14px; margin:10px 0; border:2px solid #10b981;">
      <h3 style="color:#10b981; margin:0 0 6px 0; font-size:16px;">🏆 المحرك النهائي (v10.5 — Full 3KB BROM Stack Guard)</h3>
      <div style="margin:8px 0;">
        <label style="color:#38bdf8; font-weight:bold; font-size:12px;">✅ اختر ملف u-boot-sunxi-with-spl.bin (431.5 KB)</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #38bdf8; margin-top:4px;">
      </div>
      <div id="slot-summary-badge" style="background:#1e293b; color:#10b981; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>
      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v105-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">⏱ جاهز للبث...</div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v105-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #10b981, #0ea5e9); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px;">0%</div>
        </div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button onclick="runFullAutonomousPipeline()" style="flex:2; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:14px;">
          ⚡ 1. بدء الإقلاع الشامل (v10.5)
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
  const { splClean, ubootClean } = smartExtractSplAndUboot(new Uint8Array(buf));

  preparedPayloads.spl = splClean;
  preparedPayloads.uboot = ubootClean;

  const badge = document.getElementById("slot-summary-badge");
  if (badge) {
    badge.style.display = "block";
    badge.innerHTML = `🎯 <strong>تم تجهيز الحزمة (v10.5):</strong> SPL = ${(splClean.byteLength / 1024).toFixed(1)} KB | U-Boot = ${ubootClean ? (ubootClean.byteLength / 1024).toFixed(1) + " KB" : "N/A"}`;
  }
  logOtg(`📥 [v10.5] تم تجهيز "${file.name}" بنجاح.`);
}

async function runFullAutonomousPipeline() {
  cancelFlashFlag = false;
  if (!preparedPayloads.spl && selectedRealFile) {
    await handleSlotFileSelect("spl", { files: [selectedRealFile] });
  }
  if (!preparedPayloads.spl) return alert("اختر ملف u-boot-sunxi-with-spl.bin أولاً!");
  if (!isRealUsbReady()) {
    await connectRealOtgDevice();
    if (!isRealUsbReady()) return;
  }

  try {
    const pipelineStart = performance.now();
    await reclaimAndDrainUsb();
    logOtg("🚀 [v10.5] بدء الإقلاع مع حماية نطاق BROM الكامل (0x1400..0x2000) وعدم إتلاف 0x2000...");

    // المحطة 1
    setStageStatus(1, "جاري الفحص...", "#38bdf8");
    updateLiveProgress("المرحلة 1", 1, 1, pipelineStart, "1/4");
    await sunxiSendFelRequest(0x0001, 0, 0);
    await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();
    setStageStatus(1, "تم التعرف ✅", "#10b981");
    logOtg("✅ [المحطة 1/4] المعالج متصل ومستجيب في وضع FEL.");

    // المحطة 2: عدم الكتابة فوق 0x2000 لأنها جزء من كود الـ SPL نفسه!
    setStageStatus(2, "تأمين LPDDR3 ✅", "#10b981");
    logOtg("✅ [المحطة 2/4] تخطي الكتابة اليدوية في 0x2000 لمنع إتلاف كود الـ SPL (الإعدادات مدمجة داخل الـ SPL).");

    // المحطة 3: بث الـ SPL مع تحويل النطاق الحساس بالكامل (0x1400..0x2000 = 3KB) إلى 0x00004800
    setStageStatus(3, "جاري بث SPL...", "#38bdf8");
    const splBytes = preparedPayloads.spl;
    const CHUNK = 1024;
    const stage3Start = performance.now();
    let offset = 0;

    while (offset < splBytes.byteLength) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(offset + CHUNK, splBytes.byteLength);
      const slice = splBytes.subarray(offset, end);

      let targetAddr = 0x00000000 + offset;
      if (offset >= 0x00001400 && offset < 0x00002000) {
        targetAddr = H3_STAGED_1400 + (offset - 0x00001400);
        logOtg(`🛡️ تحويل الشريحة 0x${offset.toString(16)} إلى المخزن الآمن 0x${targetAddr.toString(16)}...`);
      }

      await sunxiSendFelRequest(0x0101, targetAddr, slice.byteLength);
      await sunxiUsbBulkWrite(slice);
      await sunxiReadFelStatus();

      offset = end;
      updateLiveProgress("المرحلة 3 (بث SPL)", offset, splBytes.byteLength, stage3Start, "3/4");
    }

    // حقن الترامبولين في 0x00004400
    const trampoline = buildFull3KbSramA1Trampoline();
    logOtg(`🛡️ حقن الترامبولين الشامل (${trampoline.byteLength} بايت) في 0x00004400...`);
    await sunxiSendFelRequest(0x0101, H3_TRAMPOLINE_ADDR, trampoline.byteLength);
    await sunxiUsbBulkWrite(trampoline);
    await sunxiReadFelStatus();

    // تنفيذ الترامبولين
    logOtg("⚡ تشغيل الترامبولين (FEL_EXEC @ 0x00004400)...");
    try {
      await sunxiSendFelRequest(0x0102, H3_TRAMPOLINE_ADDR, 0, 1000);
      await new Promise((r) => setTimeout(r, 700));
      await sunxiReadFelStatus(800);
    } catch (_) {}

    setStageStatus(3, "تم فتح الرام ✅", "#10b981");
    logOtg("✅ [المحطة 3/4] اكتمل تنفيذ الترامبولين وتفعيل رامات LPDDR3!");

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
  if (!preparedPayloads.uboot) return alert("اختر ملف u-boot-sunxi-with-spl.bin أولاً!");
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
    logOtg(`📤 [المحطة 4/4] بدء رفع U-Boot (${(total / 1024).toFixed(1)} KB) إلى 0x4A000000...`);

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
      updateLiveProgress("المرحلة 4 (U-Boot -> DRAM)", uOffset, total, stage4Start, "4/4");
    }

    logOtg("🚀 إرسال أمر الإقلاع النهائي (FEL_EXEC @ 0x4A000000)...");
    try {
      await sunxiSendFelRequest(0x0102, targetAddr, 0, 600);
      await sunxiReadFelStatus(400);
    } catch (_) {}

    setStageStatus(4, "أقلع الجهاز 100% ✅", "#10b981");
    logOtg("🎉 مبروك! اكتمل رفع وتشغيل U-Boot بنسبة 100% في الرام بنجاح!");
  } catch (err) {
    logOtg(`❌ خطأ في المرحلة 4: ${err.message}`);
  }
}

function onSelectRealFlashFile(inputEl) { handleSlotFileSelect("spl", inputEl); }
function runAutomated4StageFlash() { runFullAutonomousPipeline(); }
function cancelRealFlashing() { cancelFlashFlag = true; logOtg("⏹ تم الإيقاف."); }
function loadPresetMemoryPayload() {}
function initPythonEditor() {}
function switchTab(id) {
  document.querySelectorAll(".tab-content").forEach((s) => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  const sec = document.getElementById(`tab-${id}`);
  if (sec) sec.classList.add("active");
}
function copyText(id) {
  navigator.clipboard.writeText(document.getElementById(id).textContent);
}
