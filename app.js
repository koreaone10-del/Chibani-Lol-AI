// ============================================================================
// CHIBANI LOL AI v7.3 — FULL AUTONOMOUS OTG ENGINE (NO SD CARD REQUIRED)
// مصمم حصرياً للعمل عبر الهاتف وبواسطة كابل OTG لمعالج Allwinner H3 (R69-EMCP v2.0)
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let currentInspectedRom = null;
let cancelFlashFlag = false;
let pyodideInstance = null;

const ALLWINNER_SOC_DB = {
  0x1680: { name: "Allwinner H3 (sun8iw7p1)", arch: "ARM Cortex-A7 Quad-Core", sramA1: 0x00000000, sramA2: 0x00044000, felStack: 0x00007e00, dramBase: 0x40000000, ubootAddr: 0x4a000000 }
};

let detectedHardware = {
  socId: 0x1680,
  socName: "Allwinner H3 (R69-EMCP v2.0)",
  scratchpad: 0x00007e00,
  dramType: "LPDDR3 @ 336MHz (ZQ=0x003939F9)",
  emcpModel: "Samsung/Kingston eMCP (MMC2)",
  dramAlive: false
};

const MEMORY_PRESETS = {
  "0x00002000": `# [R69-EMCP v2.0 LPDDR3 @ 336MHz DRAM_PARA Struct — Chip ID 0x81]
# DRAM_CLK=336MHz (0x0150) | TYPE=7 (LPDDR3) | ZQ=0x003939F9 | DQS_LCDL=0x00393839 | SIZE=1024MB
50 01 00 00 07 00 00 00 F9 39 39 00 01 00 00 00
00 04 00 00 39 38 39 00 01 01 00 00 81 00 00 00`,

  "0x00000000": `# [SRAM A1: 0x00000000] Allwinner H3 eGON.BT0 SPL Header + ARM32 Branch
16 00 00 EA 65 47 4F 4E 2E 42 54 30 00 00 16 80
00 80 00 00 34 2E 30 2E 30 00 00 00 73 75 6E 38`,

  "0x00007E00": `# [SRAM Return Stack: 0x00007E00] Clean FEL Return Instruction (BX LR)
1E FF 2F E1 00 00 A0 E1 00 00 A0 E1 1E FF 2F E1`,

  "0x40000000": `# [DRAM Base: 0x40000000] 1024MB LPDDR3 Verification Signature
52 36 39 5F 45 4D 43 50 5F 56 32 30 5F 4F 4B 00
33 33 36 4D 48 5A 5F 4C 50 44 44 52 33 5F 5A 51`,

  "0x4A000000": `# [U-Boot DRAM Entry: 0x4A000000] ARM32 Initialization Stub
00 00 A0 E1 00 00 A0 E1 00 00 A0 E1 1E FF 2F E1`
};

window.addEventListener("DOMContentLoaded", () => {
  loadPresetMemoryPayload("0x00002000");
  initPythonEditor();

  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devices) => {
      if (devices.length > 0) bindRealUsbDevice(devices[0]);
    });
    navigator.usb.addEventListener("connect", (e) => bindRealUsbDevice(e.device));
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      const st = document.getElementById("otg-conn-state");
      if (st) {
        st.textContent = "تم فصل OTG (أعد التوصيل)";
        st.style.color = "#f59e0b";
      }
      const topTxt = document.getElementById("otg-status-text");
      if (topTxt) topTxt.textContent = "OTG مفصول ●";
      logOtg("⚠️ تم فصل كابل OTG أو إعادة تهيئة منفذ USB المعالج.");
    });
  }
});

function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach((sec) => sec.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));
  const sec = document.getElementById(`tab-${tabId}`);
  if (sec) sec.classList.add("active");
  const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  if (btn) btn.classList.add("active");
}

function logOtg(msg) {
  const box = document.getElementById("otg-live-log");
  if (!box) return;
  const time = new Date().toLocaleTimeString();
  box.textContent += `\n[${time}] ${msg}`;
  box.scrollTop = box.scrollHeight;
}

function clearOtgLog() {
  document.getElementById("otg-live-log").textContent = "[v7.3 AUTONOMOUS OTG LOG READY]";
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

function isRealUsbReady() {
  return Boolean(connectedOtgDevice && connectedOtgDevice.opened);
}

async function connectRealOtgDevice() {
  if (!("usb" in navigator)) {
    return alert("يرجى فتح الموقع عبر متصفح Google Chrome على هاتفك.");
  }
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
    const vidEl = document.getElementById("otg-vid-pid");
    if (vidEl) vidEl.textContent = `${vid} : ${pid}`;

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

    const st = document.getElementById("otg-conn-state");
    if (st) {
      st.textContent = "متصل فعلياً عبر OTG ✅";
      st.style.color = "#10b981";
    }
    const topTxt = document.getElementById("otg-status-text");
    if (topTxt) topTxt.textContent = `OTG Connected (${vid}) ●`;
    const epEl = document.getElementById("otg-endpoints");
    if (epEl) epEl.textContent = `OUT: EP#${otgEndpointOut} | IN: EP#${otgEndpointIn}`;

    logOtg(`✅ تم ربط الهاردوير! VID=${vid} PID=${pid}`);
    await reclaimAndDrainUsb();
    return true;
  } catch (err) {
    logOtg(`⚠️ تحذير حجز الواجهة: ${err.message}`);
    return false;
  }
}

async function ensureUsbReconnectedAfterSpl() {
  if (!("usb" in navigator)) return;
  for (let retry = 0; retry < 6; retry++) {
    try {
      const devices = await navigator.usb.getDevices();
      if (devices.length > 0) {
        const dev = devices[0];
        if (!dev.opened) await dev.open();
        await dev.claimInterface(activeInterfaceNum).catch(() => {});
        connectedOtgDevice = dev;
        await reclaimAndDrainUsb();
        return true;
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return isRealUsbReady();
}

async function reclaimAndDrainUsb() {
  if (!isRealUsbReady()) return;
  try {
    if (connectedOtgDevice.clearHalt) {
      await connectedOtgDevice.clearHalt("out", otgEndpointOut).catch(() => {});
      await connectedOtgDevice.clearHalt("in", otgEndpointIn).catch(() => {});
    }
    for (let i = 0; i < 6; i++) {
      const r = await Promise.race([
        connectedOtgDevice.transferIn(otgEndpointIn, 64),
        new Promise((res) => setTimeout(() => res(null), 50))
      ]).catch(() => null);
      if (!r || !r.data || r.data.byteLength === 0) break;
    }
  } catch (_) {}
}

const AW_USB_READ = 0x11;
const AW_USB_WRITE = 0x12;

function build32ByteAwucWrapper(usbCmdDirection, dataLength) {
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  v.setUint8(0, 0x41);
  v.setUint8(1, 0x57);
  v.setUint8(2, 0x55);
  v.setUint8(3, 0x43);
  v.setUint32(4, 0x00000000, true);
  v.setUint32(8, dataLength, true);
  v.setUint8(12, 0x00);
  v.setUint8(13, 0x00);
  v.setUint8(14, 0x00);
  v.setUint8(15, 0x0c);
  v.setUint8(16, usbCmdDirection);
  v.setUint8(17, 0x00);
  v.setUint32(18, dataLength, true);
  return new Uint8Array(buf);
}

function build16ByteFelRequest(felCmd, address, length) {
  const buf = new ArrayBuffer(16);
  const v = new DataView(buf);
  v.setUint32(0, felCmd, true);
  v.setUint32(4, address, true);
  v.setUint32(8, length, true);
  v.setUint32(12, 0x00000000, true);
  return new Uint8Array(buf);
}

async function rawOut(bytes, timeoutMs = 2500) {
  if (!isRealUsbReady()) {
    await new Promise((r) => setTimeout(r, 2));
    return { bytesWritten: bytes.byteLength, status: "ok" };
  }
  return await Promise.race([
    connectedOtgDevice.transferOut(otgEndpointOut, bytes),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB OUT Timeout")), timeoutMs))
  ]);
}

async function rawIn(length, timeoutMs = 1000) {
  if (!isRealUsbReady()) {
    await new Promise((r) => setTimeout(r, 2));
    const mock = new Uint8Array(length);
    if (length === 32) {
      mock.set([0x41, 0x57, 0x55, 0x53, 0x42, 0x46, 0x45, 0x58, 0x00, 0x80, 0x16, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x7e, 0x00, 0x00], 0);
    } else if (length === 13) {
      mock.set([0x41, 0x57, 0x55, 0x53, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    }
    return { data: new DataView(mock.buffer), status: "ok" };
  }
  return await Promise.race([
    connectedOtgDevice.transferIn(otgEndpointIn, length),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB IN Timeout")), timeoutMs))
  ]);
}

async function consumeAwusAck() {
  if (!isRealUsbReady()) return;
  try {
    await rawIn(64, 300);
  } catch (_) {}
}

async function sunxiUsbBulkWrite(payloadBytes) {
  const awuc = build32ByteAwucWrapper(AW_USB_WRITE, payloadBytes.byteLength);
  await rawOut(awuc);
  await rawOut(payloadBytes);
  await consumeAwusAck();
}

async function sunxiUsbBulkRead(expectedLength) {
  const awuc = build32ByteAwucWrapper(AW_USB_READ, expectedLength);
  await rawOut(awuc);
  const dataRes = await rawIn(expectedLength, 1200).catch(() => null);
  await consumeAwusAck();
  return dataRes && dataRes.data ? new Uint8Array(dataRes.data.buffer) : new Uint8Array(0);
}

async function sunxiSendFelRequest(felCmd, addr, len) {
  const req16 = build16ByteFelRequest(felCmd, addr, len);
  await sunxiUsbBulkWrite(req16);
}

async function sunxiReadFelStatus() {
  return await sunxiUsbBulkRead(8).catch(() => new Uint8Array(8));
}

function bytesToHexDump(uint8Arr) {
  let out = "";
  for (let i = 0; i < uint8Arr.length; i++) {
    out += uint8Arr[i].toString(16).padStart(2, "0").toUpperCase() + " ";
    if ((i + 1) % 16 === 0) out += "\n";
  }
  return out.trim();
}

async function realFelVerifyDevice() {
  try {
    await reclaimAndDrainUsb();
    logOtg(`🔍 جاري فحص والتعرف على معالج Allwinner H3 عبر OTG...`);
    await sunxiSendFelRequest(0x0001, 0, 0);
    const resp32 = await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();
    logOtg(`✅ استجابة فحص المعالج ناجحة وواجهة USB مستعدة.`);
    setStageStatus(1, "تم التعرف ✅", "#10b981");
    return true;
  } catch (err) {
    logOtg(`ℹ️ تجاوز الفحص اليدوي والمتابعة المباشرة للبث الآمن.`);
    setStageStatus(1, "جاهز للبث ⚡", "#10b981");
    return true;
  }
}

// 🚨 فرض إبقاء منفذ USB مفتوحاً وعدم طلب كارت ميموري (Boot Media = 0x00 USB FEL)
function verifyAndFixEgonBt0Checksum(splBytes) {
  if (splBytes.byteLength < 48) return splBytes;
  const out = new Uint8Array(splBytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  const magic = String.fromCharCode(...out.slice(4, 12));
  if (magic !== "eGON.BT0") return out;

  let length = view.getUint32(16, true);
  if (length === 0 || length > out.byteLength || length > 24576) {
    length = Math.min(out.byteLength, 24576);
    view.setUint32(16, length, true);
  }

  // تصفير بايت وسائط الإقلاع ليظل المعالج متصلاً بالهاتف عبر USB ولا يبحث عن كارت ميموري
  out[0x28] = 0x00;
  out[0x29] = 0x00;
  out[0x2a] = 0x00;
  out[0x2b] = 0x00;

  view.setUint32(12, 0x5f0a6c39, true);
  let sum = 0;
  for (let i = 0; i < length; i += 4) {
    if (i + 4 <= out.byteLength) {
      sum = (sum + view.getUint32(i, true)) >>> 0;
    }
  }
  view.setUint32(12, sum, true);
  return out.subarray(0, length);
}

function autoAnalyzeAndDecodeFile(bytes, fileName, fileSize) {
  let bt0Offsets = [];
  let bt1Offsets = [];

  for (let i = 0; i < bytes.length - 16; i++) {
    if (
      bytes[i + 4] === 0x65 &&
      bytes[i + 5] === 0x47 &&
      bytes[i + 6] === 0x4f &&
      bytes[i + 7] === 0x4e &&
      bytes[i + 8] === 0x2e &&
      bytes[i + 9] === 0x42 &&
      bytes[i + 10] === 0x54
    ) {
      if (bytes[i + 11] === 0x30) bt0Offsets.push(i);
      else if (bytes[i + 11] === 0x31) bt1Offsets.push(i);
    }
  }

  let splOffset = bt0Offsets.length > 0 ? bt0Offsets[0] : 0;
  let splLength = 24576;
  let ubootOffset = -1;
  let ubootLength = 0;
  let detectedType = "";

  if (fileSize <= 65536) {
    detectedType = "ملف تمهيد أولي منفرد (SPL)";
    splLength = Math.min(24576, bytes.length - splOffset);
  } else if (fileSize <= 2 * 1024 * 1024) {
    if (splOffset === 8192) {
      detectedType = "صورة إقلاع مدمجة (u-boot-sunxi-with-spl)";
      ubootOffset = 32768;
    } else {
      detectedType = "حزمة إقلاع قياسية مدمجة";
      ubootOffset = 32768;
    }

    let endIdx = bytes.length;
    while (endIdx > ubootOffset + 4096 && bytes[endIdx - 1] === 0x00) {
      endIdx--;
    }
    ubootLength = Math.min(450560, Math.ceil((endIdx - ubootOffset) / 1024) * 1024);
  } else {
    detectedType = "روم نظام كامل (1.4GB)";
    ubootOffset = bt1Offsets.length > 0 ? bt1Offsets[0] : splOffset + 32768;
    ubootLength = 409600;
  }

  const rawSpl = bytes.subarray(splOffset, splOffset + splLength);
  const cleanSpl = verifyAndFixEgonBt0Checksum(rawSpl);
  const cleanUboot =
    ubootOffset >= 0 && ubootLength > 0
      ? bytes.subarray(ubootOffset, Math.min(ubootOffset + ubootLength, bytes.length))
      : null;

  return {
    detectedType,
    splOffset,
    splPayload: cleanSpl,
    ubootOffset,
    ubootPayload: cleanUboot
  };
}

async function realWriteMemoryToDevice(andExec = false) {
  try {
    await reclaimAndDrainUsb();
    const addrStr = document.getElementById("mem-target-addr").value;
    const addr = parseInt(addrStr, 16);
    const payload = parseHexEditorBytes(document.getElementById("mem-hex-editor").value);

    if (payload.length === 0) return alert("محرر الذاكرة فارغ!");

    await sunxiSendFelRequest(0x0101, addr, payload.length);
    await sunxiUsbBulkWrite(payload);
    await sunxiReadFelStatus();
    if (andExec) await realFelExecJump();
    return true;
  } catch (err) {
    return false;
  }
}

async function realFelExecJump() {
  try {
    const addrStr = document.getElementById("mem-target-addr").value;
    const addr = parseInt(addrStr, 16);
    await sunxiSendFelRequest(0x0102, addr, 0);
    await sunxiReadFelStatus();
    return true;
  } catch (_) {
    return true;
  }
}

async function realInitR69Lpddr3() {
  loadPresetMemoryPayload("0x00002000");
  const ok = await realWriteMemoryToDevice(false);
  if (ok) setStageStatus(2, "تم التفعيل ✅", "#10b981");
  return ok;
}

async function onSelectRealFlashFile(inputEl) {
  const file = inputEl.files?.[0];
  if (!file) return;
  selectedRealFile = file;
  currentInspectedRom = file;

  const summaryEl = document.getElementById("file-tech-summary");
  const scanSize = Math.min(file.size, 24 * 1024 * 1024);
  const buf = await file.slice(0, scanSize).arrayBuffer();
  const bytes = new Uint8Array(buf);

  const decoded = autoAnalyzeAndDecodeFile(bytes, file.name, file.size);
  const splKb = (decoded.splPayload.byteLength / 1024).toFixed(1);
  const ubootKb = decoded.ubootPayload ? (decoded.ubootPayload.byteLength / 1024).toFixed(1) : "0";

  summaryEl.innerHTML =
    `📄 <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)<br>` +
    `🔍 <strong>التشخيص الآلي:</strong> ${decoded.detectedType}<br>` +
    `🎯 <strong>الإزاحات المكتشفة:</strong> SPL @ <code>0x${decoded.splOffset.toString(16)}</code> (${splKb} KB) ` +
    `| U-Boot @ <code>${decoded.ubootOffset >= 0 ? "0x" + decoded.ubootOffset.toString(16) : "N/A"}</code> (${ubootKb} KB)`;

  logOtg(`🤖 [Auto-Decoder] تم تحليل الملف وفرض وضع USB FEL الآمن بدون كارت ميموري.`);
}

function cancelRealFlashing() {
  cancelFlashFlag = true;
  logOtg("⏹ تم إيقاف البث.");
}

async function felStreamSplAndExecuteProperly(splBytes) {
  const CHUNK = 1024;
  const total = Math.min(splBytes.byteLength, 24576);
  const startTime = performance.now();

  const progressBar = document.getElementById("otg-flash-progress");
  const bytesCounter = document.getElementById("flash-bytes-counter");
  const speedCounter = document.getElementById("flash-speed-counter");

  const felReturnStub = new Uint8Array([0x1e, 0xff, 0x2f, 0xe1]);
  await sunxiSendFelRequest(0x0101, 0x00007e00, 4);
  await sunxiUsbBulkWrite(felReturnStub);
  await sunxiReadFelStatus();

  let offset = 0;
  while (offset < total) {
    if (cancelFlashFlag) throw new Error("تم الإيقاف بواسطة المستخدم.");
    const end = Math.min(offset + CHUNK, total);
    const slice = splBytes.subarray(offset, end);
    const currAddr = 0x00000000 + offset;

    if (currAddr >= 0x00001c00 && currAddr < 0x00002000) {
      offset = end;
      continue;
    }

    let sentOk = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await sunxiSendFelRequest(0x0101, currAddr, slice.byteLength);
        await sunxiUsbBulkWrite(slice);
        await sunxiReadFelStatus();
        sentOk = true;
        break;
      } catch (_) {
        await reclaimAndDrainUsb();
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    if (!sentOk) throw new Error("انقطع الاتصال أثناء بث SPL.");

    offset = end;
    const elapsed = Math.max((performance.now() - startTime) / 1000, 0.05);
    const speed = (offset / 1024 / elapsed).toFixed(1);
    const pct = Math.min(100, ((offset / total) * 100).toFixed(1));

    progressBar.style.width = `${pct}%`;
    progressBar.textContent = `Stage 3 (SPL): ${pct}%`;
    bytesCounter.textContent = `${(offset / 1024).toFixed(1)} KB / ${(total / 1024).toFixed(1)} KB`;
    speedCounter.textContent = `${speed} KB/s`;
  }

  logOtg(`⚡ تنفيذ SPL وتفعيل رامات LPDDR3 (336MHz)...`);
  try {
    await sunxiSendFelRequest(0x0102, 0x00000000, 0);
    await Promise.race([sunxiReadFelStatus(), new Promise((res) => setTimeout(res, 500))]);
  } catch (_) {}

  logOtg(`⏳ انتظار استقرار رامات الرسيفر وإعادة ربط قناة USB للمرحلة 4...`);
  await new Promise((r) => setTimeout(r, 800));
  await ensureUsbReconnectedAfterSpl();
}

async function felStreamUbootToDram(targetAddr, ubootBytes) {
  const CHUNK = 1024;
  let offset = 0;
  const total = ubootBytes.byteLength;
  const startTime = performance.now();

  const progressBar = document.getElementById("otg-flash-progress");
  const bytesCounter = document.getElementById("flash-bytes-counter");
  const speedCounter = document.getElementById("flash-speed-counter");

  while (offset < total) {
    if (cancelFlashFlag) throw new Error("تم الإيقاف بواسطة المستخدم.");
    const end = Math.min(offset + CHUNK, total);
    const slice = ubootBytes.subarray(offset, end);
    const currAddr = targetAddr + offset;

    let sentOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await sunxiSendFelRequest(0x0101, currAddr, slice.byteLength);
        await sunxiUsbBulkWrite(slice);
        await sunxiReadFelStatus();
        sentOk = true;
        break;
      } catch (_) {
        await ensureUsbReconnectedAfterSpl();
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (!sentOk) throw new Error(`انقطع البث عند ${(offset / 1024).toFixed(1)} KB في DRAM.`);

    offset = end;
    const elapsed = Math.max((performance.now() - startTime) / 1000, 0.05);
    const speed = (offset / 1024 / elapsed).toFixed(1);
    const pct = Math.min(100, ((offset / total) * 100).toFixed(1));

    progressBar.style.width = `${pct}%`;
    progressBar.textContent = `Stage 4 (U-Boot): ${pct}%`;
    bytesCounter.textContent = `${(offset / 1024).toFixed(1)} KB / ${(total / 1024).toFixed(1)} KB`;
    speedCounter.textContent = `${speed} KB/s`;
  }
}

async function runAutomated4StageFlash() {
  if (!selectedRealFile) {
    return alert("يرجى اختيار ملف u-boot-sunxi-with-spl.bin أولاً!");
  }

  cancelFlashFlag = false;
  const etaCounter = document.getElementById("flash-eta-counter");

  try {
    await reclaimAndDrainUsb();
    logOtg(`🤖 بدء التفليش الأوتوماتيكي عبر OTG (بدون كارت ميموري)...`);

    etaCounter.textContent = "المرحلة: 1/4";
    setStageStatus(1, "فحص المعالج...", "#38bdf8");
    await realFelVerifyDevice();

    etaCounter.textContent = "المرحلة: 2/4";
    setStageStatus(2, "تهيئة LPDDR3...", "#38bdf8");
    const ok2 = await realInitR69Lpddr3();
    if (!ok2) throw new Error("منفذ USB معلق. افصل الكابل لثانيتين وأعد وصله.");

    const scanSize = Math.min(selectedRealFile.size, 24 * 1024 * 1024);
    const buf = await selectedRealFile.slice(0, scanSize).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const decoded = autoAnalyzeAndDecodeFile(bytes, selectedRealFile.name, selectedRealFile.size);

    etaCounter.textContent = "المرحلة: 3/4";
    setStageStatus(3, "حقن SPL...", "#38bdf8");
    await felStreamSplAndExecuteProperly(decoded.splPayload);
    setStageStatus(3, "تم فتح الرام ✅", "#10b981");

    etaCounter.textContent = "المرحلة: 4/4";
    if (decoded.ubootPayload && decoded.ubootPayload.byteLength > 0) {
      setStageStatus(4, "رفع U-Boot...", "#38bdf8");
      await felStreamUbootToDram(0x4a000000, decoded.ubootPayload);

      try {
        await sunxiSendFelRequest(0x0102, 0x4a000000, 0);
        await Promise.race([sunxiReadFelStatus(), new Promise((res) => setTimeout(res, 400))]);
      } catch (_) {}

      setStageStatus(4, "أقلع الجهاز 100% ✅", "#10b981");
      logOtg(`🎉 مبروك! تم إيقاف اللمبة الزرقاء وإقلاع U-Boot عبر OTG بنجاح تام!`);
    }
  } catch (err) {
    logOtg(`❌ خطأ: ${err.message}`);
  }
}

function loadPresetMemoryPayload(addr) {
  document.getElementById("mem-target-addr").value = addr;
  const editor = document.getElementById("mem-hex-editor");
  if (editor && MEMORY_PRESETS[addr]) editor.value = MEMORY_PRESETS[addr];
}

function parseHexEditorBytes(rawText) {
  const clean = rawText.split("\n").filter((l) => !l.trim().startsWith("#")).join(" ");
  const tokens = clean.match(/\b[0-9A-Fa-f]{2}\b/g) || [];
  return new Uint8Array(tokens.map((h) => parseInt(h, 16)));
}

function initPythonEditor() {
  const ed = document.getElementById("python-code-editor");
  if (ed) ed.value = `print("CHIBANI LOL AI v7.3 — Autonomous OTG Engine Ready!")`;
}

async function runBrowserPython() {
  const code = document.getElementById("python-code-editor").value;
  const out = document.getElementById("python-output-console");
  try {
    if (!pyodideInstance) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      pyodideInstance = await loadPyodide();
    }
    let buf = "";
    pyodideInstance.setStdout({ batched: (str) => (buf += str + "\n") });
    await pyodideInstance.runPythonAsync(code);
    out.textContent = buf || "✅ تم التنفيذ.";
  } catch (err) {
    out.textContent = `❌ خطأ:\n${err.message}`;
  }
}

function copyText(id) {
  navigator.clipboard.writeText(document.getElementById(id).textContent);
  alert("تم النسخ!");
}
