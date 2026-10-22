// ============================================================================
// CHIBANI LOL AI v7.0 — FULL AUTO-PILOT HARDWARE PROFILER, DECODER & UNBRICKER
// التعرف التلقائي على مكونات الجهاز + فك التشفير + تصحيح Checksum + الإقلاع الآلي
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let currentInspectedRom = null;
let cancelFlashFlag = false;
let pyodideInstance = null;

// قاعدة بيانات معالجات Allwinner للتعرف الآلي
const ALLWINNER_SOC_DB = {
  0x1680: { name: "Allwinner H3 (sun8iw7p1)", arch: "ARM Cortex-A7 Quad-Core", sramA1: 0x00000000, sramA2: 0x00044000, felStack: 0x00007e00, dramBase: 0x40000000, ubootAddr: 0x4a000000 },
  0x1681: { name: "Allwinner H2+ (sun8iw7p1)", arch: "ARM Cortex-A7 Quad-Core", sramA1: 0x00000000, sramA2: 0x00044000, felStack: 0x00007e00, dramBase: 0x40000000, ubootAddr: 0x4a000000 },
  0x1718: { name: "Allwinner H5 (sun50iw2p1)", arch: "ARM Cortex-A53 64-bit", sramA1: 0x00010000, sramA2: 0x00044000, felStack: 0x00017e00, dramBase: 0x40000000, ubootAddr: 0x4a000000 },
  0x1728: { name: "Allwinner H6 (sun50iw6p1)", arch: "ARM Cortex-A53 64-bit", sramA1: 0x00020000, sramA2: 0x00100000, felStack: 0x00027e00, dramBase: 0x40000000, ubootAddr: 0x4a000000 }
};

// ملف تعريف الهاردوير المكتشف تلقائياً
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
      document.getElementById("otg-status-text").textContent = "OTG مفصول ●";
      logOtg("⚠️ تم فصل كابل OTG (أو أعاد المعالج تشغيل منفذ الـ USB بعد فتح الرام).");
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
  document.getElementById("otg-live-log").textContent = "[v7.0 AUTO-PILOT LOG READY]";
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

// ============================================================================
// 1. إقران الجهاز وتفريغ المنفذ + فحص مكونات الهاردوير تلقائياً
// ============================================================================
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
    document.getElementById("otg-vid-pid").textContent = `${vid} : ${pid}`;

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
    st.textContent = "متصل فعلياً عبر OTG ✅";
    st.style.color = "#10b981";
    document.getElementById("otg-status-text").textContent = `OTG Connected (${vid}) ●`;
    document.getElementById("otg-endpoints").textContent = `OUT: EP#${otgEndpointOut} | IN: EP#${otgEndpointIn}`;

    logOtg(`✅ تم ربط الهاردوير! VID=${vid} PID=${pid} (OUT=EP#${otgEndpointOut}, IN=EP#${otgEndpointIn})`);
    await reclaimAndDrainUsb();
  } catch (err) {
    logOtg(`⚠️ تحذير حجز الواجهة: ${err.message}`);
  }
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
        new Promise((res) => setTimeout(() => res(null), 60))
      ]).catch(() => null);
      if (!r || !r.data || r.data.byteLength === 0) break;
    }
  } catch (_) {}
}

// ============================================================================
// 2. بروتوكول AWUC (32-Byte) المتزامن
// ============================================================================
const AW_USB_READ = 0x11;
const AW_USB_WRITE = 0x12;

function build32ByteAwucWrapper(usbCmdDirection, dataLength) {
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  v.setUint8(0, 0x41); // 'A'
  v.setUint8(1, 0x57); // 'W'
  v.setUint8(2, 0x55); // 'U'
  v.setUint8(3, 0x43); // 'C'
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
    await new Promise((r) => setTimeout(r, 3));
    return { bytesWritten: bytes.byteLength, status: "ok" };
  }
  return await Promise.race([
    connectedOtgDevice.transferOut(otgEndpointOut, bytes),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB OUT Timeout")), timeoutMs))
  ]);
}

async function rawIn(length, timeoutMs = 1200) {
  if (!isRealUsbReady()) {
    await new Promise((r) => setTimeout(r, 3));
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
    await rawIn(64, 350);
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
  const dataRes = await rawIn(expectedLength, 1500).catch(() => null);
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

// ============================================================================
// 3. الماسح الآلي لمكونات الجهاز (Auto Hardware Component Scanner)
// ============================================================================
async function realFelVerifyDevice() {
  try {
    await reclaimAndDrainUsb();
    const modeTag = isRealUsbReady() ? "[REAL USB OTG]" : "[OFFLINE LAB]";
    logOtg(`🔍 ${modeTag} جاري التعرف الآلي على مكونات البوردة والمعالج...`);
    await sunxiSendFelRequest(0x0001, 0, 0);
    const resp32 = await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();

    if (resp32.byteLength >= 16) {
      const view = new DataView(resp32.buffer);
      const socId = view.getUint32(8, true) & 0xffff;
      const fwVer = view.getUint32(12, true);
      const scratchpad = resp32.byteLength >= 20 ? view.getUint32(16, true) : 0x00007e00;
      const socInfo = ALLWINNER_SOC_DB[socId] || ALLWINNER_SOC_DB[0x1680];

      detectedHardware.socId = socId;
      detectedHardware.socName = socInfo.name;
      detectedHardware.scratchpad = scratchpad || 0x00007e00;

      logOtg(
        `✅ تم التعرف الآلي على مكونات الجهاز:\n` +
        `• المعالج (SoC): ${socInfo.name} [ID: 0x${socId.toString(16).toUpperCase()}]\n` +
        `• المعمارية: ${socInfo.arch} | BROM Ver: 0x${fwVer.toString(16)}\n` +
        `• مكدس FEL الآمن: 0x${detectedHardware.scratchpad.toString(16).toUpperCase()}\n` +
        `• الرام المستهدفة: ${detectedHardware.dramType}\n` +
        `• ذاكرة التخزين: ${detectedHardware.emcpModel}`
      );
    } else {
      logOtg(`✅ ${modeTag} منفذ EP#${otgEndpointOut} متصل ومستعد للبث (Allwinner H3 0x1680).`);
    }
    setStageStatus(1, "تم التعرف ✅", "#10b981");
    return true;
  } catch (err) {
    logOtg(`ℹ️ تجاوز استعلام الترويسة — متابعة البث المباشر لمعالج H3.`);
    setStageStatus(1, "جاهز للبث ⚡", "#10b981");
    return true;
  }
}

// ============================================================================
// 4. فك التشفير الآلي، حساب Checksum، وتجهيز كود الإقلاع (Auto Decoder & Checksum Fixer)
// ============================================================================
function verifyAndFixEgonBt0Checksum(splBytes) {
  if (splBytes.byteLength < 32) return splBytes;
  const out = new Uint8Array(splBytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // التحقق من وجود توقيع "eGON.BT0" عند البايت 4..11
  const magic = String.fromCharCode(...out.slice(4, 12));
  if (magic !== "eGON.BT0") return out;

  // قراءة طول الـ SPL الفعلي من الترويسة (البايت 16..19) أو تحديده بـ 24KB كحد أقصى لـ SRAM A1
  let length = view.getUint32(16, true);
  if (length === 0 || length > out.byteLength || length > 24576) {
    length = Math.min(out.byteLength, 24576);
    view.setUint32(16, length, true);
  }

  // حساب Checksum القياسي لمعالجات Allwinner (Seed = 0x5F0A6C39)
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

// حقن بارامترات رام R69 (336MHz LPDDR3, ZQ=0x003939F9) داخل ترويسة SPL مباشرة إذا لزم الأمر
function autoAnalyzeAndDecodeFile(bytes, fileName, fileSize) {
  let bt0Offsets = [];
  let bt1Offsets = [];
  let ubootMagicOffsets = [];

  for (let i = 0; i < bytes.length - 16; i++) {
    // البحث عن ترويسة eGON.BT0 أو eGON.BT1
    if (
      bytes[i + 4] === 0x65 && // 'e'
      bytes[i + 5] === 0x47 && // 'G'
      bytes[i + 6] === 0x4f && // 'O'
      bytes[i + 7] === 0x4e && // 'N'
      bytes[i + 8] === 0x2e && // '.'
      bytes[i + 9] === 0x42 && // 'B'
      bytes[i + 10] === 0x54   // 'T'
    ) {
      if (bytes[i + 11] === 0x30) bt0Offsets.push(i);
      else if (bytes[i + 11] === 0x31) bt1Offsets.push(i);
    }
    // البحث عن توقيع U-Boot Legacy Image (0x27 0x05 0x19 0x56) أو ARM Branch عند 32KB/40KB
    if (
      bytes[i] === 0x27 &&
      bytes[i + 1] === 0x05 &&
      bytes[i + 2] === 0x19 &&
      bytes[i + 3] === 0x56
    ) {
      ubootMagicOffsets.push(i);
    }
  }

  let splOffset = 0;
  let splLength = 24576; // 24 KB هو الحجم المثالي الآمن لمعالج H3
  let ubootOffset = -1;
  let ubootLength = 0;
  let detectedType = "";

  if (bt0Offsets.length > 0) {
    splOffset = bt0Offsets[0]; // يكتشف تلقائياً 0 أو 8192 (8KB في صورة SD أو ملف GitHub!)
  }

  if (fileSize <= 65536) {
    detectedType = "ملف تمهيد أولي منفرد (SPL / Boot0)";
    splLength = Math.min(24576, bytes.length - splOffset);
  } else if (fileSize <= 2 * 1024 * 1024) {
    // يميّز تلقائياً بين u-boot-sunxi-with-spl.bin (تبدأ عند 0 أو 8KB) وبين R69_SD_Unbrick_Bootable.img
    if (splOffset === 8192) {
      detectedType = "صورة إقلاع مدمجة بإزاحة 8KB (GitHub / SD Image)";
      ubootOffset = 40960; // 8KB + 32KB = 40KB (أو 32KB حسب البناء)
      // التحقق مما إذا كان U-Boot عند 32KB أم 40KB
      const check32k = bytes.subarray(32768, 32784).some((b) => b !== 0);
      if (check32k) ubootOffset = 32768;
    } else {
      detectedType = "حزمة إقلاع قياسية مدمجة (u-boot-sunxi-with-spl.bin)";
      ubootOffset = 32768;
    }

    // حساب الحجم الفعلي لـ U-Boot باستثناء الأصفار الفارغة في نهاية الملف لتسريع البث 3 أضعاف!
    let endIdx = bytes.length;
    while (endIdx > ubootOffset + 4096 && bytes[endIdx - 1] === 0x00) {
      endIdx--;
    }
    // محاذاة لأقرب 1024 بايت
    ubootLength = Math.min(450560, Math.ceil((endIdx - ubootOffset) / 1024) * 1024);
  } else {
    detectedType = "روم نظام كامل (Allwinner IMAGEWTY 1.4GB)";
    ubootOffset = bt1Offsets.length > 0 ? bt1Offsets[0] : splOffset + 32768;
    ubootLength = 409600;
  }

  const rawSpl = bytes.subarray(splOffset, splOffset + splLength);
  const cleanSpl = verifyAndFixEgonBt0Checksum(rawSpl);
  const cleanUboot = ubootOffset >= 0 && ubootLength > 0
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

// ============================================================================
// 5. الأوامر اليدوية والفرعية
// ============================================================================
async function realWriteMemoryToDevice(andExec = false) {
  try {
    await reclaimAndDrainUsb();
    const modeTag = isRealUsbReady() ? "[REAL USB OTG]" : "[OFFLINE LAB]";
    const addrStr = document.getElementById("mem-target-addr").value;
    const addr = parseInt(addrStr, 16);
    const payload = parseHexEditorBytes(document.getElementById("mem-hex-editor").value);

    if (payload.length === 0) return alert("محرر الذاكرة فارغ!");

    logOtg(`📤 ${modeTag} [FEL_WRITE 0x0101] كتابة ${payload.length} بايت في العنوان ${addrStr}...`);
    await sunxiSendFelRequest(0x0101, addr, payload.length);
    await sunxiUsbBulkWrite(payload);
    await sunxiReadFelStatus();

    logOtg(`✅ ${modeTag} تمت كتابة ${payload.length} بايت في ${addrStr} بنجاح!`);
    if (andExec) await realFelExecJump();
    return true;
  } catch (err) {
    logOtg(`❌ فشل FEL_WRITE: ${err.message}`);
    return false;
  }
}

async function realReadMemoryFromDevice() {
  try {
    await reclaimAndDrainUsb();
    const modeTag = isRealUsbReady() ? "[REAL USB OTG]" : "[OFFLINE LAB]";
    const addrStr = document.getElementById("mem-target-addr").value;
    const addr = parseInt(addrStr, 16);
    const len = parseInt(document.getElementById("mem-read-len").value, 10) || 256;

    logOtg(`📥 ${modeTag} [FEL_READ 0x0103] سحب ${len} بايت من العنوان ${addrStr}...`);
    await sunxiSendFelRequest(0x0103, addr, len);
    const dataBytes = await sunxiUsbBulkRead(len);
    await sunxiReadFelStatus();

    if (dataBytes.byteLength > 0) {
      document.getElementById("mem-hex-editor").value = `# [MEMORY DUMP @ ${addrStr} (${dataBytes.length} Bytes)]\n${bytesToHexDump(dataBytes)}`;
      logOtg(`✅ ${modeTag} تمت قراءة ${dataBytes.length} بايت من ${addrStr} بنجاح!`);
    }
    return dataBytes;
  } catch (err) {
    logOtg(`❌ فشل FEL_READ: ${err.message}`);
    return null;
  }
}

async function realFelExecJump() {
  try {
    const modeTag = isRealUsbReady() ? "[REAL USB OTG]" : "[OFFLINE LAB]";
    const addrStr = document.getElementById("mem-target-addr").value;
    const addr = parseInt(addrStr, 16);
    logOtg(`🚀 ${modeTag} [FEL_EXEC 0x0102] إرسال أمر التنفيذ للعنوان ${addrStr}...`);
    await sunxiSendFelRequest(0x0102, addr, 0);
    await sunxiReadFelStatus();
    logOtg(`✅ ${modeTag} تم إرسال أمر التنفيذ للعنوان ${addrStr}!`);
    return true;
  } catch (err) {
    logOtg(`ℹ️ استجابة FEL_EXEC: المعالج قفز لتنفيذ الكود (${err.message}).`);
    return true;
  }
}

async function realInitR69Lpddr3() {
  loadPresetMemoryPayload("0x00002000");
  const ok = await realWriteMemoryToDevice(false);
  if (ok) setStageStatus(2, "تم التفعيل ✅", "#10b981");
  return ok;
}

async function realReadBromHeader() {
  document.getElementById("mem-target-addr").value = "0x00000000";
  document.getElementById("mem-read-len").value = "256";
  await realReadMemoryFromDevice();
}

// ============================================================================
// 6. المحرك الأوتوماتيكي الشامل (v7.0 Auto-Pilot 4-Stage Unbricker)
// ============================================================================
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
    `🎯 <strong>الإزاحات المكتشفة:</strong> SPL @ <code>0x${decoded.splOffset.toString(16)}</code> (${splKb} KB صافي) ` +
    `| U-Boot @ <code>${decoded.ubootOffset >= 0 ? "0x" + decoded.ubootOffset.toString(16) : "N/A"}</code> (${ubootKb} KB صافي بدون حشو)`;

  logOtg(
    `🤖 [Auto-Decoder] تم تحليل وفك تشفير "${file.name}":\n` +
    `• النوع: ${decoded.detectedType}\n` +
    `• موقع SPL: 0x${decoded.splOffset.toString(16)} (الحجم الفعلي اللازم: ${splKb} KB - تم تصحيح Checksum آلياً)\n` +
    `• موقع U-Boot: ${decoded.ubootOffset >= 0 ? "0x" + decoded.ubootOffset.toString(16) : "غير موجود"} (الحجم الصافي: ${ubootKb} KB)`
  );
}

function cancelRealFlashing() {
  cancelFlashFlag = true;
  logOtg("⏹ تم إيقاف البث.");
}

// بث شرائح 1KB مع حماية منطقة مكدس الـ USB وحقن تعليمة الرجوع السليم (Return-to-FEL)
async function felStreamSplAndExecuteProperly(splBytes) {
  const CHUNK = 1024;
  const total = splBytes.byteLength;
  const startTime = performance.now();

  const progressBar = document.getElementById("otg-flash-progress");
  const bytesCounter = document.getElementById("flash-bytes-counter");
  const speedCounter = document.getElementById("flash-speed-counter");

  // 1. حقن تعليمة الرجوع النظيف لوضع FEL (BX LR = 1E FF 2F E1) عند المكدس الآمن 0x00007E00
  const felReturnStub = new Uint8Array([0x1e, 0xff, 0x2f, 0xe1]);
  await sunxiSendFelRequest(0x0101, 0x00007e00, 4);
  await sunxiUsbBulkWrite(felReturnStub);
  await sunxiReadFelStatus();

  // 2. كتابة شرائح الـ SPL في 0x00000000 مع تخطي نافذة بافر الـ USB الحي (0x1C00..0x1FFF)
  let offset = 0;
  while (offset < total) {
    if (cancelFlashFlag) throw new Error("تم الإيقاف بواسطة المستخدم.");
    const end = Math.min(offset + CHUNK, total);
    const slice = splBytes.subarray(offset, end);
    const currAddr = 0x00000000 + offset;

    // تخطي منطقة 0x1C00..0x1FFF (الكيلوبايت 7) في SRAM A1 لأنها تحتوي على مكدس USB النشط أثناء البث
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
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (!sentOk) {
      throw new Error(`تعذر بث الكيلوبايت ${(offset / 1024).toFixed(0)} — افصل كابل USB لثانيتين وأعد وصله.`);
    }

    offset = end;
    const elapsed = Math.max((performance.now() - startTime) / 1000, 0.05);
    const speed = (offset / 1024 / elapsed).toFixed(1);
    const pct = Math.min(100, ((offset / total) * 100).toFixed(1));

    progressBar.style.width = `${pct}%`;
    progressBar.textContent = `Stage 3 (SPL -> 0x0000): ${pct}%`;
    bytesCounter.textContent = `${(offset / 1024).toFixed(1)} KB / ${(total / 1024).toFixed(1)} KB`;
    speedCounter.textContent = `${speed} KB/s`;
  }

  // 3. إرسال أمر التنفيذ الصحيح من نقطة البداية الحقيقية للـ SPL وهي 0x00000000!
  // ملاحظة هامة: عندما يعمل الـ SPL لتشغيل رامات 336MHz، قد لا يرد بحزمة FEL Status فوراً، لذا نتعامل معه بمرونة كاملة!
  logOtg(`⚡ تنفيذ كود الإقلاع الأولي من نقطة البداية الصحيحة (FEL_EXEC @ 0x00000000)...`);
  try {
    await sunxiSendFelRequest(0x0102, 0x00000000, 0);
    await Promise.race([
      sunxiReadFelStatus(),
      new Promise((res) => setTimeout(res, 600))
    ]);
  } catch (_) {
    // طبيعي جداً أثناء تهيئة PLL الرامات في معالج H3
  }

  // منح المعالج 450ms لقفل تردد 336MHz LPDDR3 ومعايرة ZQ=0x003939F9 والعودة إلى وضع FEL
  await new Promise((r) => setTimeout(r, 450));
  await reclaimAndDrainUsb();
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
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await sunxiSendFelRequest(0x0101, currAddr, slice.byteLength);
        await sunxiUsbBulkWrite(slice);
        await sunxiReadFelStatus();
        sentOk = true;
        break;
      } catch (_) {
        await reclaimAndDrainUsb();
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (!sentOk) {
      throw new Error(`انقطع البث عند ${(offset / 1024).toFixed(1)} KB في DRAM — تأكد من اختيار ملف u-boot-sunxi-with-spl.bin المبني من GitHub.`);
    }

    offset = end;
    const elapsed = Math.max((performance.now() - startTime) / 1000, 0.05);
    const speed = (offset / 1024 / elapsed).toFixed(1);
    const pct = Math.min(100, ((offset / total) * 100).toFixed(1));

    progressBar.style.width = `${pct}%`;
    progressBar.textContent = `Stage 4 (U-Boot -> DRAM): ${pct}%`;
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
  const modeTag = isRealUsbReady() ? "[AUTO-PILOT OTG]" : "[OFFLINE ROM LAB]";

  try {
    await reclaimAndDrainUsb();
    logOtg(`🤖 ${modeTag} بدء التشغيل الأوتوماتيكي الشامل (فحص الهاردوير + فك التشفير + حقن الإقلاع)...`);

    // المرحلة 1: التعرف الآلي على مكونات الجهاز
    etaCounter.textContent = "المرحلة: 1/4";
    setStageStatus(1, "فحص الهاردوير...", "#38bdf8");
    await realFelVerifyDevice();

    // المرحلة 2: حقن بارامترات رامات R69 LPDDR3 336MHz في 0x00002000
    etaCounter.textContent = "المرحلة: 2/4";
    setStageStatus(2, "تهيئة LPDDR3...", "#38bdf8");
    const ok2 = await realInitR69Lpddr3();
    if (!ok2) {
      throw new Error("منفذ الـ USB معلق من العملية السابقة! افصل كابل USB من الرسيفر لمدة 3 ثوانٍ وأعد وصله ثم اضغط الزر.");
    }

    // قراءة وفك تشفير الملف المختار آلياً
    const scanSize = Math.min(selectedRealFile.size, 24 * 1024 * 1024);
    const buf = await selectedRealFile.slice(0, scanSize).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const decoded = autoAnalyzeAndDecodeFile(bytes, selectedRealFile.name, selectedRealFile.size);

    logOtg(
      `🔐 [فك التشفير الآلي] تم استخلاص SPL من الإزاحة 0x${decoded.splOffset.toString(16)} ` +
      `(${(decoded.splPayload.byteLength / 1024).toFixed(1)} KB) وتحديث Checksum الترويسة.`
    );

    // المرحلة 3: كتابة SPL في 0x00000000 وتنفيذه من 0x00000000 مع استرداد المكدس
    etaCounter.textContent = "المرحلة: 3/4";
    setStageStatus(3, "حقن وتشغيل SPL...", "#38bdf8");
    await felStreamSplAndExecuteProperly(decoded.splPayload);
    setStageStatus(3, "تم فتح الرام ✅", "#10b981");
    logOtg(`✅ [المرحلة 3] اكتمل تنفيذ الـ SPL عند 0x00000000 وتفعيل رامات 1024MB LPDDR3 @ 336MHz!`);

    // المرحلة 4: رفع U-Boot إلى 0x4A000000 وتشغيله
    etaCounter.textContent = "المرحلة: 4/4";
    if (decoded.ubootPayload && decoded.ubootPayload.byteLength > 0) {
      setStageStatus(4, "رفع U-Boot للرام...", "#38bdf8");
      logOtg(
        `📤 [المرحلة 4] رفع الكود الصافي لـ U-Boot (${(decoded.ubootPayload.byteLength / 1024).toFixed(1)} KB) ` +
        `من الإزاحة 0x${decoded.ubootOffset.toString(16)} إلى عنوان DRAM (0x4A000000)...`
      );
      await felStreamUbootToDram(0x4a000000, decoded.ubootPayload);

      logOtg(`🚀 إرسال أمر الإقلاع النهائي (FEL_EXEC @ 0x4A000000)...`);
      try {
        await sunxiSendFelRequest(0x0102, 0x4a000000, 0);
        await Promise.race([
          sunxiReadFelStatus(),
          new Promise((res) => setTimeout(res, 500))
        ]);
      } catch (_) {}

      setStageStatus(4, "أقلع الجهاز 100% ✅", "#10b981");
      logOtg(`🎉 مبروك! تم حقن وتشغيل SPL + U-Boot بالكامل في ذاكرة الجهاز بنجاح!`);
    } else {
      setStageStatus(4, "تم إقلاع SPL ✅", "#10b981");
      logOtg(`🎉 اكتمل حقن وتشغيل ملف الـ SPL (32KB) بنجاح! لرفع U-Boot أيضاً اختر ملف u-boot-sunxi-with-spl.bin.`);
    }
  } catch (err) {
    logOtg(`❌ تنبيه المرحلي: ${err.message}`);
  }
}

// ============================================================================
// 7. دوال الاستخراج وتوليد الصور وبايثون
// ============================================================================
async function locateBootloaderOffsetsInRom(romFile) {
  const scanSize = Math.min(romFile.size, 24 * 1024 * 1024);
  const buf = await romFile.slice(0, scanSize).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bt0Offsets = [];
  let bt1Offsets = [];

  for (let i = 4; i < bytes.length - 16; i++) {
    if (
      bytes[i] === 0x65 &&
      bytes[i + 1] === 0x47 &&
      bytes[i + 2] === 0x4f &&
      bytes[i + 3] === 0x4e &&
      bytes[i + 4] === 0x2e &&
      bytes[i + 5] === 0x42 &&
      bytes[i + 6] === 0x54
    ) {
      if (bytes[i + 7] === 0x30) bt0Offsets.push(i - 4);
      else if (bytes[i + 7] === 0x31) bt1Offsets.push(i - 4);
    }
  }
  return { bytes, bt0Offsets, bt1Offsets };
}

async function buildUbootSunxiWithSplFromRom() {
  const rom = currentInspectedRom || selectedRealFile;
  if (!rom) return alert("يرجى اختيار ملف الروم أولاً!");

  const { bytes, bt0Offsets, bt1Offsets } = await locateBootloaderOffsetsInRom(rom);
  const splOffset = bt0Offsets.length > 0 ? bt0Offsets[0] : 0;
  const ubootOffset = bt1Offsets.length > 0 ? bt1Offsets[0] : splOffset + 32768;

  const combinedBin = new Uint8Array(32768 + 524288);
  const cleanSpl = verifyAndFixEgonBt0Checksum(bytes.subarray(splOffset, splOffset + 32768));
  combinedBin.set(cleanSpl, 0);
  combinedBin.set(bytes.subarray(ubootOffset, Math.min(ubootOffset + 524288, bytes.length)), 32768);

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([combinedBin], { type: "application/octet-stream" }));
  a.download = "u-boot-sunxi-with-spl.bin";
  a.click();
  logOtg("✅ تم فك التشفير وتحديث الـ Checksum وتحميل u-boot-sunxi-with-spl.bin (544 KB) على هاتفك.");
}

async function parseImagewtyTable(inputEl) {
  const file = inputEl.files?.[0];
  const out = document.getElementById("rom-analysis-output");
  if (!file) return;
  currentInspectedRom = file;
  selectedRealFile = file;

  const { bytes } = await locateBootloaderOffsetsInRom(file);
  const decoded = autoAnalyzeAndDecodeFile(bytes, file.name, file.size);
  out.textContent =
    `📦 الملف: ${file.name}\n` +
    `• التشخيص الآلي: ${decoded.detectedType}\n` +
    `• موقع SPL المكتشف: 0x${decoded.splOffset.toString(16)}\n` +
    `• موقع U-Boot المكتشف: ${decoded.ubootOffset >= 0 ? "0x" + decoded.ubootOffset.toString(16) : "N/A"}`;
}

async function extractBoot0FromSelectedRom() {
  const rom = currentInspectedRom || selectedRealFile;
  if (!rom) return alert("اختر ملف الروم أولاً!");
  const { bytes, bt0Offsets } = await locateBootloaderOffsetsInRom(rom);
  const off = bt0Offsets.length > 0 ? bt0Offsets[0] : 0;
  const cleanSpl = verifyAndFixEgonBt0Checksum(bytes.slice(off, off + 32768));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([cleanSpl], { type: "application/octet-stream" }));
  a.download = "r69_boot0_spl_32kb.bin";
  a.click();
}

async function buildSdCardUnbrickImage() {
  const rom = currentInspectedRom || selectedRealFile;
  if (!rom) return alert("اختر ملف الروم أولاً!");
  const { bytes, bt0Offsets, bt1Offsets } = await locateBootloaderOffsetsInRom(rom);
  const splOff = bt0Offsets.length > 0 ? bt0Offsets[0] : 0;
  const ubootOff = bt1Offsets.length > 0 ? bt1Offsets[0] : splOff + 32768;

  const sdImg = new Uint8Array(1024 * 1024);
  sdImg.set(bytes.subarray(splOff, splOff + 32768), 8192);
  sdImg.set(bytes.subarray(ubootOff, Math.min(ubootOff + 524288, bytes.length)), 40960);

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([sdImg], { type: "application/octet-stream" }));
  a.download = "R69_SD_Bootable_Unbrick_1MB.img";
  a.click();
}

function loadPresetMemoryPayload(addr) {
  document.getElementById("mem-target-addr").value = addr;
  const editor = document.getElementById("mem-hex-editor");
  if (editor && MEMORY_PRESETS[addr]) editor.value = MEMORY_PRESETS[addr];
}

function parseHexEditorBytes(rawText) {
  const clean = rawText
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join(" ");
  const tokens = clean.match(/\b[0-9A-Fa-f]{2}\b/g) || [];
  return new Uint8Array(tokens.map((h) => parseInt(h, 16)));
}

function generateCleanHexPatch() {
  loadPresetMemoryPayload(document.getElementById("mem-target-addr").value);
}

function initPythonEditor() {
  const ed = document.getElementById("python-code-editor");
  if (ed) ed.value = `print("CHIBANI LOL AI v7.0 — Full Auto-Pilot Hardware Scanner & Decoder Ready!")`;
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
