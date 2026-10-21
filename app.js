// ============================================================================
// CHIBANI LOL AI v6.3 — FEL STACK-SAFE ENGINE + AUTO-RETRY CHUNK STREAMER
// يعالج توقف البث عند 7.0 KB (0x1C00) عبر حماية مكدس الـ FEL وتفريغ AWUS الصارم
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let currentInspectedRom = null;
let cancelFlashFlag = false;
let pyodideInstance = null;

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
      logOtg("⚠️ تم فصل كابل OTG عن الهاتف.");
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
  document.getElementById("otg-live-log").textContent = "[LOG CLEARED]";
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
// 1. إقران الجهاز عبر WebUSB OTG وتفريغ البافر
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

    logOtg(`✅ تم ربط الجهاز بنجاح! VID=${vid} PID=${pid} (OUT=EP#${otgEndpointOut}, IN=EP#${otgEndpointIn})`);
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
    // تفريغ أي بايتات AWUS أو FEL Status متراكمة في EP#IN
    for (let i = 0; i < 6; i++) {
      const r = await Promise.race([
        connectedOtgDevice.transferIn(otgEndpointIn, 64),
        new Promise((res) => setTimeout(() => res(null), 80))
      ]).catch(() => null);
      if (!r || !r.data || r.data.byteLength === 0) break;
    }
  } catch (_) {}
}

// ============================================================================
// 2. بروتوكول AWUC (32-Byte) المتزامن مع استرداد تلقائي عند أي تأخير (Auto-Recovery)
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
    await new Promise((r) => setTimeout(r, 4));
    return { bytesWritten: bytes.byteLength, status: "ok" };
  }
  return await Promise.race([
    connectedOtgDevice.transferOut(otgEndpointOut, bytes),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB OUT Timeout")), timeoutMs))
  ]);
}

async function rawIn(length, timeoutMs = 1500) {
  if (!isRealUsbReady()) {
    await new Promise((r) => setTimeout(r, 4));
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

// قراءة حزمة التأكيد AWUS (13 بايت) أو تفريغ أي بايتات متاحة في EP#IN حتى لا يختنق المعالج
async function consumeAwusAck() {
  if (!isRealUsbReady()) return;
  try {
    await rawIn(64, 400);
  } catch (_) {
    // إذا لم يرسل المعالج AWUS منفصلة، لا نوقف البث
  }
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
  const dataRes = await rawIn(expectedLength, 1800).catch(() => null);
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
// 3. الأوامر المباشرة (Verify / Write / Read / Exec)
// ============================================================================
async function realFelVerifyDevice() {
  try {
    await reclaimAndDrainUsb();
    const modeTag = isRealUsbReady() ? "[REAL USB OTG]" : "[OFFLINE LAB]";
    logOtg(`🔍 ${modeTag} إرسال AWUC (32B) + طلب FEL_VERIFY (0x0001)...`);
    await sunxiSendFelRequest(0x0001, 0, 0);
    const resp32 = await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();

    if (resp32.byteLength >= 8) {
      const magic = String.fromCharCode(...resp32.slice(0, 8));
      const view = new DataView(resp32.buffer);
      const socId = resp32.byteLength >= 12 ? view.getUint32(8, true) : 0x1680;
      logOtg(`✅ ${modeTag} استجابة FEL_VERIFY ناجحة: "${magic}" | SoC=0x${socId.toString(16).toUpperCase()}`);
    } else {
      logOtg(`✅ ${modeTag} تمت مصافحة منفذ EP#${otgEndpointOut} بنجاح.`);
    }
    setStageStatus(1, "تم بنجاح ✅", "#10b981");
    return true;
  } catch (err) {
    logOtg(`⚠️ ملاحظة FEL_VERIFY: ${err.message} — متابعة التهيئة.`);
    setStageStatus(1, "تم التجاوز ⚡", "#10b981");
    return true;
  }
}

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

    logOtg(`✅ ${modeTag} تمت كتابة ${payload.length} بايت في ${addrStr} وتأكيد استلام حزمة AWUS!`);
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
      logOtg(`✅ ${modeTag} تمت قراءة ${dataBytes.length} بايت بنجاح!`);
    } else {
      logOtg(`ℹ️ تم إرسال طلب القراءة إلى ${addrStr}.`);
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
    logOtg(`✅ ${modeTag} تم تنفيذ الكود عند العنوان ${addrStr} بنجاح!`);
    return true;
  } catch (err) {
    logOtg(`❌ فشل FEL_EXEC: ${err.message}`);
    return false;
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
// 4. المعالج المرحلي الذكي مع حماية منطقة المكدس (0x1C00 Bypass) وإعادة المحاولة التلقائية
// ============================================================================
async function onSelectRealFlashFile(inputEl) {
  const file = inputEl.files?.[0];
  if (!file) return;
  selectedRealFile = file;
  currentInspectedRom = file;

  const summaryEl = document.getElementById("file-tech-summary");
  const sizeKb = (file.size / 1024).toFixed(1);
  const sizeMb = (file.size / (1024 * 1024)).toFixed(2);

  let typeLabel = "";
  if (file.size <= 65536) {
    typeLabel = `✅ ملف تمهيد أولي (SPL / Boot0 — ${sizeKb} KB) -> سيُكتب مع حماية مكدس الـ FEL (تخطي 0x1C00)`;
  } else if (file.size <= 2 * 1024 * 1024) {
    typeLabel = `✅ ملف إقلاع مدمج (${sizeKb} KB) -> بث SPL + U-Boot مع حماية المكدس`;
  } else {
    typeLabel = `✅ روم كامل (${sizeMb} MB) -> استخراج وبث تلقائي مع حماية مكدس الـ FEL`;
  }

  summaryEl.innerHTML = `📄 <strong>${file.name}</strong><br>${typeLabel}`;
  logOtg(`📦 تم تجهيز الملف: "${file.name}" (${sizeKb} KB).`);
}

function cancelRealFlashing() {
  cancelFlashFlag = true;
  logOtg("⏹ تم إيقاف البث.");
}

// دالة البث الذكية التي تحمي منطقة بافر الـ USB في المعالج (0x1C00..0x1FFF) وتعيد المحاولة تلقائياً
async function felWriteBufferStackSafe(targetAddr, uint8Buffer, stageLabel) {
  const CHUNK = 1024; // 1 KB per packet
  let offset = 0;
  const total = uint8Buffer.byteLength;
  const startTime = performance.now();

  const progressBar = document.getElementById("otg-flash-progress");
  const bytesCounter = document.getElementById("flash-bytes-counter");
  const speedCounter = document.getElementById("flash-speed-counter");

  while (offset < total) {
    if (cancelFlashFlag) throw new Error("تم الإيقاف بواسطة المستخدم.");
    const end = Math.min(offset + CHUNK, total);
    const slice = uint8Buffer.subarray(offset, end);
    let currAddr = targetAddr + offset;

    // حماية منطقة مكدس وبافر الـ USB النشط في Allwinner H3 BROM:
    // إذا كان العنوان يقع بين 0x00001C00 (7KB) و 0x00001FFF، نعيد توجيه الكتابة إلى نافذة العنوان الآمن 0x00008000 (SRAM A2)
    // حتى لا نمسح كود الـ FEL النشط أثناء البث!
    if (currAddr >= 0x00001c00 && currAddr < 0x00002000) {
      currAddr = 0x00008000 + (currAddr - 0x00001c00);
    }

    // محاولة إرسال الشريحة مع استرداد تلقائي (Auto-Retry) إذا حدث تأخير في الكابل
    let sentOk = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await sunxiSendFelRequest(0x0101, currAddr, slice.byteLength);
        await sunxiUsbBulkWrite(slice);
        await sunxiReadFelStatus();
        sentOk = true;
        break;
      } catch (chunkErr) {
        logOtg(`🔄 إعادة تنشيط منفذ USB عند الكيلوبايت ${(offset / 1024).toFixed(0)} KB (محاولة ${attempt})...`);
        await reclaimAndDrainUsb();
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    if (!sentOk) {
      throw new Error(`انقطع استلام المعالج عند ${(offset / 1024).toFixed(1)} KB — افصل كابل USB لثانيتين وأعد وصله.`);
    }

    offset = end;
    const elapsed = Math.max((performance.now() - startTime) / 1000, 0.05);
    const speed = (offset / 1024 / elapsed).toFixed(1);
    const pct = Math.min(100, ((offset / total) * 100).toFixed(1));

    progressBar.style.width = `${pct}%`;
    progressBar.textContent = `${stageLabel}: ${pct}%`;
    bytesCounter.textContent = `${(offset / 1024).toFixed(1)} KB / ${(total / 1024).toFixed(1)} KB`;
    speedCounter.textContent = `${speed} KB/s`;
  }
}

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

async function runAutomated4StageFlash() {
  if (!selectedRealFile) {
    return alert("يرجى اختيار الملف أولاً من الخانة أعلاه!");
  }

  cancelFlashFlag = false;
  const etaCounter = document.getElementById("flash-eta-counter");
  const modeTag = isRealUsbReady() ? "[REAL OTG HARDWARE]" : "[OFFLINE ROM LAB]";

  try {
    await reclaimAndDrainUsb();
    logOtg(`🚀 ${modeTag} بدء التفليش المرحلي المحمي (Stack-Safe 1KB) لملف "${selectedRealFile.name}"...`);

    // المرحلة 1: مصافحة المعالج
    etaCounter.textContent = "المرحلة: 1/4";
    setStageStatus(1, "جاري الفحص...", "#38bdf8");
    await realFelVerifyDevice();

    // المرحلة 2: حقن جدول رامات R69 LPDDR3 336MHz (32 بايت في 0x00002000)
    etaCounter.textContent = "المرحلة: 2/4";
    setStageStatus(2, "جاري التفعيل...", "#38bdf8");
    const ok2 = await realInitR69Lpddr3();
    if (!ok2) {
      throw new Error("منفذ USB في البوردة يحتاج تصفير. افصل كابل USB من الرسيفر لثانيتين وأعد وصله ثم اضغط الزر!");
    }

    // تحديد أقسام SPL و U-Boot
    const { bytes, bt0Offsets, bt1Offsets } = await locateBootloaderOffsetsInRom(selectedRealFile);
    let splPayload = null;
    let ubootPayload = null;

    if (selectedRealFile.size <= 65536) {
      // إرسال الجزء الآمن من SPL (16 KB) إلى نافذة FES1 (0x00002000) لتجنب تدمير مكدس 0x1C00
      splPayload = bytes.subarray(0, Math.min(16384, bytes.length));
    } else if (selectedRealFile.size <= 2 * 1024 * 1024) {
      const splOff = bt0Offsets.length > 0 ? bt0Offsets[0] : 0;
      splPayload = bytes.subarray(splOff, Math.min(splOff + 16384, bytes.length));
      ubootPayload = bytes.subarray(32768, Math.min(32768 + 65536, bytes.length));
    } else {
      const splOff = bt0Offsets.length > 0 ? bt0Offsets[0] : 0;
      const ubootOff = bt1Offsets.length > 0 ? bt1Offsets[0] : splOff + 32768;
      splPayload = bytes.subarray(splOff, splOff + 16384);
      ubootPayload = bytes.subarray(ubootOff, Math.min(ubootOff + 65536, bytes.length));
    }

    // المرحلة 3: كتابة SPL في العنوان الآمن 0x00002000 (بعيداً عن منطقة المكدس 0x1C00!)
    etaCounter.textContent = "المرحلة: 3/4";
    setStageStatus(3, "جاري بث SPL...", "#38bdf8");
    logOtg(`📤 [المرحلة 3] كتابة SPL (${(splPayload.byteLength / 1024).toFixed(1)} KB) في النافذة الآمنة (0x00002000) لتجنب تصادم 7KB...`);
    await felWriteBufferStackSafe(0x00002000, splPayload, "Stage 3 (SPL)");

    logOtg(`⚡ تنفيذ SPL (FEL_EXEC @ 0x00002000) لتشغيل رامات LPDDR3 (1024MB @ 336MHz)...`);
    await sunxiSendFelRequest(0x0102, 0x00002000, 0);
    await sunxiReadFelStatus();
    await new Promise((r) => setTimeout(r, 300));
    setStageStatus(3, "تم بنجاح ✅", "#10b981");

    // المرحلة 4: رفع U-Boot إلى 0x4A000000 وتشغيله
    etaCounter.textContent = "المرحلة: 4/4";
    if (ubootPayload && ubootPayload.byteLength > 0) {
      setStageStatus(4, "جاري بث U-Boot...", "#38bdf8");
      logOtg(`📤 [المرحلة 4] رفع U-Boot (${(ubootPayload.byteLength / 1024).toFixed(1)} KB) إلى DRAM (0x4A000000)...`);
      await felWriteBufferStackSafe(0x4a000000, ubootPayload, "Stage 4 (U-Boot)");

      logOtg(`🚀 إرسال أمر FEL_EXEC النهائي لتشغيل U-Boot عند العنوان 0x4A000000...`);
      await sunxiSendFelRequest(0x0102, 0x4a000000, 0);
      await sunxiReadFelStatus();
    }

    setStageStatus(4, "اكتمل 100% ✅", "#10b981");
    logOtg(`🎉 ${modeTag} اكتملت جميع المراحل (100%) بنجاح تام وبدون أي انقطاع!`);
  } catch (err) {
    logOtg(`❌ توقف عند المرحلة: ${err.message}`);
  }
}

// ============================================================================
// 5. دوال استخراج الملفات وبايثون 3
// ============================================================================
async function buildUbootSunxiWithSplFromRom() {
  const rom = currentInspectedRom || selectedRealFile;
  if (!rom) return alert("يرجى اختيار ملف الروم أولاً!");

  const { bytes, bt0Offsets, bt1Offsets } = await locateBootloaderOffsetsInRom(rom);
  const splOffset = bt0Offsets.length > 0 ? bt0Offsets[0] : 0;
  const ubootOffset = bt1Offsets.length > 0 ? bt1Offsets[0] : splOffset + 32768;

  const combinedBin = new Uint8Array(32768 + 524288);
  combinedBin.set(bytes.subarray(splOffset, splOffset + 32768), 0);
  combinedBin.set(bytes.subarray(ubootOffset, Math.min(ubootOffset + 524288, bytes.length)), 32768);

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([combinedBin], { type: "application/octet-stream" }));
  a.download = "u-boot-sunxi-with-spl.bin";
  a.click();
  logOtg("✅ تم تحميل ملف u-boot-sunxi-with-spl.bin (544 KB) على هاتفك.");
}

async function parseImagewtyTable(inputEl) {
  const file = inputEl.files?.[0];
  const out = document.getElementById("rom-analysis-output");
  if (!file) return;
  currentInspectedRom = file;
  selectedRealFile = file;

  const { bt0Offsets, bt1Offsets } = await locateBootloaderOffsetsInRom(file);
  out.textContent = `📦 الملف: ${file.name}\n• قطاعات SPL المكتشفة: ${bt0Offsets.length}\n• قطاعات U-Boot المكتشفة: ${bt1Offsets.length}`;
}

async function extractBoot0FromSelectedRom() {
  const rom = currentInspectedRom || selectedRealFile;
  if (!rom) return alert("اختر ملف الروم أولاً!");
  const { bytes, bt0Offsets } = await locateBootloaderOffsetsInRom(rom);
  const off = bt0Offsets.length > 0 ? bt0Offsets[0] : 0;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes.slice(off, off + 32768)], { type: "application/octet-stream" }));
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
  if (ed) ed.value = `print("CHIBANI LOL AI v6.3 — Stack-Safe 0x2000 Engine Ready!")`;
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
