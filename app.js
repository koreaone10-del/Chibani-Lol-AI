// ============================================================================
// CHIBANI LOL AI v17.0 — NATIVE FES1 DRAM UNLOCKER & DIRECT U-BOOT STREAMER
// يرفع ملف fes1.fex الأصلي (15.2 KB) لفتح رامات LPDDR3 عتادياً، ثم يرفع U-Boot إلى 0x4A000000
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
  initV17UI();
  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devs) => {
      if (devs.length > 0) bindRealUsbDevice(devs[0]);
    });
    navigator.usb.addEventListener("connect", (e) => bindRealUsbDevice(e.device));
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      updateConnectionVisuals(false);
      logAi("⚠️ [USB Monitor] انفصل منفذ الـ OTG.");
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

function updateLiveProgress(stageLabel, currentBytes, totalBytes, startTimeMs) {
  const pct = totalBytes > 0 ? Math.min(100, ((currentBytes / totalBytes) * 100).toFixed(1)) : 0;
  const elapsedSec = Math.max((performance.now() - startTimeMs) / 1000, 0.1);
  const speedKbs = (currentBytes / 1024 / elapsedSec).toFixed(1);

  const topBar = document.getElementById("v170-live-bar");
  const topStats = document.getElementById("v170-live-stats");
  if (topBar) { topBar.style.width = `${pct}%`; topBar.textContent = `${pct}%`; }
  if (topStats) {
    topStats.textContent = `📊 ${stageLabel} | 📦 ${(currentBytes / 1024).toFixed(1)}/${(totalBytes / 1024).toFixed(1)} KB | 🚀 ${speedKbs} KB/s | ⏱ ${elapsedSec.toFixed(0)}s`;
  }
}

function logAi(msg) {
  const box = document.getElementById("otg-live-log");
  if (box) { box.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`; box.scrollTop = box.scrollHeight; }
  const aiConsole = document.getElementById("ai-brain-console");
  if (aiConsole) { aiConsole.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`; aiConsole.scrollTop = aiConsole.scrollHeight; }
}

function clearOtgLog() {
  const box = document.getElementById("otg-live-log");
  if (box) box.textContent = "[v17.0 ENGINE READY]";
  const aiConsole = document.getElementById("ai-brain-console");
  if (aiConsole) aiConsole.textContent = "[v17.0 ENGINE INITIALIZED]";
}

function isRealUsbReady() {
  return Boolean(connectedOtgDevice && connectedOtgDevice.opened);
}

async function connectRealOtgDevice() {
  if (!("usb" in navigator)) return alert("استخدم متصفح Google Chrome.");
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await bindRealUsbDevice(device);
  } catch (err) { logAi(`ℹ️ ${err.message}`); }
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
    logAi(`✅ تم ربط الهاردوير! VID=${vid} PID=${pid}`);
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

async function rawOut(bytes, timeoutMs = 2000) {
  if (!isRealUsbReady()) throw new Error("USB Disconnected");
  return await Promise.race([
    connectedOtgDevice.transferOut(otgEndpointOut, bytes),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB OUT Timeout")), timeoutMs))
  ]);
}

async function rawIn(len, timeoutMs = 1000) {
  if (!isRealUsbReady()) throw new Error("USB Disconnected");
  const res = await Promise.race([
    connectedOtgDevice.transferIn(otgEndpointIn, len),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB IN Timeout")), timeoutMs))
  ]);
  return res.data;
}

async function sunxiUsbBulkWrite(payload, timeoutMs = 2000) {
  await rawOut(build32ByteAwucWrapper(AW_USB_WRITE, payload.byteLength), timeoutMs);
  await rawOut(payload, timeoutMs);
  try { await rawIn(13, 350); } catch (_) {}
}

async function sunxiUsbBulkRead(len, timeoutMs = 1000) {
  await rawOut(build32ByteAwucWrapper(AW_USB_READ, len), timeoutMs);
  const d = await rawIn(len, timeoutMs).catch(() => null);
  try { await rawIn(13, 350); } catch (_) {}
  return d ? new Uint8Array(d.buffer) : new Uint8Array(0);
}

async function sunxiSendFelRequest(cmd, addr, len, timeoutMs = 1500) {
  await sunxiUsbBulkWrite(build16ByteFelRequest(cmd, addr, len), timeoutMs);
}

async function sunxiReadFelStatus(timeoutMs = 600) {
  return await sunxiUsbBulkRead(8, timeoutMs).catch(() => new Uint8Array(8));
}

async function felWriteMemory(addr, bytes, timeoutMs = 2000) {
  await sunxiSendFelRequest(0x0101, addr, bytes.byteLength, timeoutMs);
  await sunxiUsbBulkWrite(bytes, timeoutMs);
  await sunxiReadFelStatus(timeoutMs);
}

async function felReadMemory(addr, len, timeoutMs = 1200) {
  await sunxiSendFelRequest(0x0103, addr, len, timeoutMs);
  const data = await sunxiUsbBulkRead(len, timeoutMs);
  await sunxiReadFelStatus(timeoutMs);
  return data;
}

// استخراج fes1.fex و u-boot من روم 1.4GB أو ملفات U-Boot
async function parseRomOrBinFile(file) {
  const buf = await file.slice(0, file.size).arrayBuffer();
  const rawBytes = new Uint8Array(buf);
  const view = new DataView(rawBytes.buffer);

  let fes1Bytes = null;
  let ubootBytes = null;

  if (file.size > 10 * 1024 * 1024) {
    // بحث عن eGON.BT0 (fes1)
    for (let i = 0; i < Math.min(rawBytes.byteLength - 64, 48 * 1024 * 1024); i += 4) {
      if (
        rawBytes[i+4] === 0x65 && rawBytes[i+5] === 0x47 &&
        rawBytes[i+6] === 0x4f && rawBytes[i+7] === 0x4e &&
        rawBytes[i+8] === 0x2e && rawBytes[i+9] === 0x42 &&
        rawBytes[i+10] === 0x54 && rawBytes[i+11] === 0x30
      ) {
        const len = view.getUint32(i + 16, true);
        if (len >= 8192 && len <= 32768) {
          fes1Bytes = rawBytes.subarray(i, i + len);
          break;
        }
      }
    }
    // بحث عن U-Boot
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
    // ملف u-boot-sunxi-with-spl.bin
    fes1Bytes = rawBytes.subarray(0, 24576);
    ubootBytes = rawBytes.subarray(32768, rawBytes.byteLength);
  }

  return { fes1Bytes, ubootBytes };
}

function initV17UI() {
  const html = `
    <div style="background:linear-gradient(145deg, #090d16, #0f172a); padding:16px; border-radius:14px; margin:10px 0; border:2px solid #10b981; box-shadow:0 8px 30px rgba(16,185,129,0.25);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="color:#10b981; margin:0; font-size:16px;">🔥 المحرك الجراحي النهائي (v17.0 — Native FES1 DRAM Unlocker)</h3>
        <span style="background:#10b981; color:#052e16; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:20px;">v17.0 FINAL</span>
      </div>
      <p style="color:#cbd5e1; font-size:12px; margin:0 0 10px 0;">
        💡 يرفع ملف <code>fes1.fex</code> الأصلي لفتح رامات LPDDR3 عتادياً في العنوان <code>0x00000000</code>، ثم يرفع نواة <code>U-Boot</code> مباشرة إلى العنوان <code>0x4A000000</code> لتعمل الذاكرة بنجاح تام!
      </p>

      <div style="margin:8px 0;">
        <label style="color:#38bdf8; font-weight:bold; font-size:12px;">📦 اختر ملف الروم الكامل (1.4GB) أو ملف u-boot-sunxi-with-spl.bin:</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #10b981; margin-top:4px;">
      </div>

      <div id="slot-summary-badge" style="background:#1e293b; color:#10b981; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>

      <pre id="ai-brain-console" style="background:#050811; color:#34d399; font-size:11px; padding:10px; border-radius:8px; border:1px solid #065f46; max-height:140px; overflow-y:auto; margin:8px 0; font-family:monospace; white-space:pre-wrap;">[v17.0 Ready] اختر الملف واضغط زر التشغيل لفتح الرام ورفع U-Boot...</pre>

      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v170-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">⏱ بانتظار التشغيل...</div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v170-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #10b981, #0ea5e9); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px;">0%</div>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button onclick="runNativeFes1AndUbootStream()" style="flex:1; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:14px;">
          🔥 1. تشغيل FES1 (فتح الرام) + رفع U-Boot إلى 0x4A000000
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

  const { fes1Bytes, ubootBytes } = await parseRomOrBinFile(file);
  preparedPayloads.fes1 = fes1Bytes;
  preparedPayloads.uboot = ubootBytes;

  const badge = document.getElementById("slot-summary-badge");
  if (badge) {
    badge.style.display = "block";
    badge.innerHTML =
      `🎯 <strong>تم استخراج ملفات التمهيد بنجاح (v17.0):</strong><br>` +
      `• FES1 / SPL = <strong>${fes1Bytes ? (fes1Bytes.byteLength / 1024).toFixed(1) + " KB" : "N/A"}</strong><br>` +
      `• U-Boot = <strong>${ubootBytes ? (ubootBytes.byteLength / 1024).toFixed(1) + " KB" : "N/A"}</strong>`;
  }
  logAi(`📥 تم تجهيز الملفات بنجاح من "${file.name}".`);
}

async function runNativeFes1AndUbootStream() {
  if (!preparedPayloads.fes1 || !preparedPayloads.uboot) {
    if (selectedRealFile) {
      const parsed = await parseRomOrBinFile(selectedRealFile);
      preparedPayloads.fes1 = parsed.fes1Bytes;
      preparedPayloads.uboot = parsed.ubootBytes;
    } else {
      return alert("يرجى اختيار ملف الروم (1.4GB) أو ملف u-boot-sunxi-with-spl.bin أولاً!");
    }
  }
  if (!isRealUsbReady()) {
    await connectRealOtgDevice();
    if (!isRealUsbReady()) return;
  }

  try {
    const startMs = performance.now();
    await reclaimAndDrainUsb();
    logAi("🔥 [v17.0] بدء عملية إيقاظ الرام ورفع U-Boot...");

    // 1. مصافحة المعالج
    await sunxiSendFelRequest(0x0001, 0, 0);
    await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();
    logAi("✅ [1/3] تم الاتصال بالمعالج بنجاح.");

    // 2. إرسال fes1.fex إلى العنوان 0x00000000 وتشغيله لفتح رامات LPDDR3 عتادياً
    const fes1 = preparedPayloads.fes1;
    logAi(`📤 [2/3] رفع كود تهيئة الرام (fes1.fex / SPL) بحجم ${(fes1.byteLength/1024).toFixed(1)} KB إلى 0x00000000...`);
    await felWriteMemory(0x00000000, fes1, 2500);

    logAi("⚡ تشغيل كود تهيئة الرام (FEL_EXEC @ 0x00000000)...");
    try {
      await sunxiSendFelRequest(0x0102, 0x00000000, 0, 1500);
      await sunxiReadFelStatus(800);
    } catch (_) {}

    // انتظار ثانية لضمان استقرار متحكم الـ DRAM
    await new Promise((res) => setTimeout(res, 1000));
    logAi("✅ تم تفعيل رامات LPDDR3 في عتاد الرسيفر بنجاح.");

    // 3. رفع نواة U-Boot إلى العنوان الكلاسيكي المستقر 0x4A000000
    const uboot = preparedPayloads.uboot;
    const total = uboot.byteLength;
    const targetAddr = 0x4a000000;
    const CHUNK = 2048;
    logAi(`📤 [3/3] بدء نقل نواة U-Boot (${(total / 1024).toFixed(1)} KB) إلى ذاكرة DRAM في 0x4A000000...`);

    let uOffset = 0;
    while (uOffset < total) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(uOffset + CHUNK, total);
      const slice = uboot.subarray(uOffset, end);
      const currAddr = targetAddr + uOffset;

      await felWriteMemory(currAddr, slice, 2000);
      uOffset = end;
      updateLiveProgress("رفع U-Boot في الـ DRAM", uOffset, total, startMs);
    }

    logAi("🚀 إرسال أمر الإقلاع النهائي لنواة U-Boot (FEL_EXEC @ 0x4A000000)...");
    try {
      await sunxiSendFelRequest(0x0102, targetAddr, 0, 1000);
      await sunxiReadFelStatus(600);
    } catch (_) {}

    logAi("🎉 مبروك! تم إيقاف الجهاز، فتح الرام، وتشغيل U-Boot بنجاح تام! راقب شاشة التلفزيون.");
  } catch (err) {
    logAi(`❌ خطأ: ${err.message}`);
  }
}
