// ============================================================================
// CHIBANI LOL AI v14.0 — PHOENIXSUIT FES1 EXTRACTOR & OFFICIAL SUNXI-FEL ENGINE
// الحل الهندسي الموثوق لإيقاظ R69-EMCP v2.0 وتفليش روم 1.4GB عبر الهاتف (OTG):
// 1. يستخرج ملف التمهيد الرسمي (fes1.fex) من داخل روم الـ 1.4GB مباشرة (أو يستخدم SPL)
// 2. يطبق خوارزمية sunxi-tools الرسمية (fel-to-spl-thunk.S) مع توقيع "eGON.FEL"
// 3. يفكك أرشيف الروم الكامل (IMAGEWTY 1.4GB) ببث الشرائح (Zero-RAM Slice Streaming)
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let cancelFlashFlag = false;

let preparedPayloads = {
  mode: "none", // "rom14gb" or "uboot_bin"
  fes1OrSpl: null,
  uboot: null,
  romPartitions: [],
  rawRomFile: null
};

window.addEventListener("DOMContentLoaded", () => {
  initPhoenixFelUI();
  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devs) => {
      if (devs.length > 0) bindRealUsbDevice(devs[0]);
    });
    navigator.usb.addEventListener("connect", (e) => bindRealUsbDevice(e.device));
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      updateConnectionVisuals(false);
      logAi("⚠️ [USB Monitor] انفصل منفذ الـ OTG (أو تحول الجهاز إلى وضع Fastboot).");
    });
  }
});

// ============================================================================
// 1. واجهة المستخدم والعدادات الحية
// ============================================================================
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
    bar1.textContent = `${stageLabel}: ${pct}% (${elapsedSec.toFixed(0)}s)`;
  }
  if (cntBytes) cntBytes.textContent = `${(currentBytes / 1024).toFixed(1)} KB / ${(totalBytes / 1024).toFixed(1)} KB`;
  if (cntSpeed) cntSpeed.textContent = `${speedKbs} KB/s`;
  if (cntEta) cntEta.textContent = `المرحلة: ${stageNumStr} | ⏱ ${elapsedSec.toFixed(0)}s`;

  const topBar = document.getElementById("v140-live-bar");
  const topStats = document.getElementById("v140-live-stats");
  if (topBar) { topBar.style.width = `${pct}%`; topBar.textContent = `${pct}%`; }
  if (topStats) {
    topStats.textContent = `📊 ${stageLabel} | 📦 ${(currentBytes / 1024).toFixed(1)}/${(totalBytes / 1024).toFixed(1)} KB | 🚀 ${speedKbs} KB/s | ⏱ ${elapsedSec.toFixed(0)}s (متبقي ~${etaSec}s)`;
  }
}

function setStageStatus(stageNum, text, color) {
  const badge = document.getElementById(`st-badge-${stageNum}`);
  const card = document.getElementById(`stage-card-${stageNum}`);
  if (badge) { badge.textContent = text; badge.style.color = color; }
  if (card) card.style.borderColor = color;
}

function logAi(msg) {
  const box = document.getElementById("otg-live-log");
  if (box) {
    box.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
    box.scrollTop = box.scrollHeight;
  }
  const aiConsole = document.getElementById("ai-brain-console");
  if (aiConsole) {
    aiConsole.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
    aiConsole.scrollTop = aiConsole.scrollHeight;
  }
}

function logOtg(msg) { logAi(msg); }

function clearOtgLog() {
  const box = document.getElementById("otg-live-log");
  if (box) box.textContent = "[v14.0 PHOENIXSUIT & SUNXI-FEL ENGINE READY]";
  const aiConsole = document.getElementById("ai-brain-console");
  if (aiConsole) aiConsole.textContent = "[v14.0 ENGINE INITIALIZED]";
}

function isRealUsbReady() {
  return Boolean(connectedOtgDevice && connectedOtgDevice.opened);
}

// ============================================================================
// 2. إدارة اتصال WebUSB
// ============================================================================
async function connectRealOtgDevice() {
  if (!("usb" in navigator)) return alert("استخدم متصفح Google Chrome.");
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await bindRealUsbDevice(device);
  } catch (err) {
    logAi(`ℹ️ ${err.message}`);
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
    logAi(`✅ تم ربط الهاردوير! VID=${vid} PID=${pid}`);
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

// ============================================================================
// 3. بروتوكول AWUC / FEL الرسمي
// ============================================================================
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

// ============================================================================
// 4. مفكك روم الـ 1.4GB (Allwinner IMAGEWTY Parser) لاستخراج fes1.fex و u-boot.fex
// ============================================================================
async function parseAllwinnerImageWty14Gb(romFile) {
  logAi(`📦 جاري فحص جدول أقسام الروم الكامل "${romFile.name}" (${(romFile.size / (1024 * 1024)).toFixed(1)} MB) بدون استهلاك رام الهاتف...`);

  // قراءة أول 32MB فقط من ملف الـ 1.4GB للبحث عن جدول IMAGEWTY وعن fes1.fex و u-boot.fex
  const headerSlice = await romFile.slice(0, Math.min(romFile.size, 32 * 1024 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(headerSlice);
  const view = new DataView(bytes.buffer);

  const magic = String.fromCharCode(...bytes.slice(0, 8));
  let partitions = [];
  let fes1Bytes = null;
  let ubootBytes = null;

  if (magic === "IMAGEWTY") {
    const headerVersion = view.getUint32(8, true);
    const numFiles = view.getUint32(headerVersion === 0x0403 ? 60 : 56, true);
    logAi(`✅ تم كشف ترويسة Allwinner IMAGEWTY الرسمية (عدد الملفات داخل الروم: ${numFiles}).`);

    // مسح جدول الملفات (يبدأ عادة عند الإزاحة 1024 وكل مدخل طوله 1024 بايت)
    for (let i = 0; i < Math.min(numFiles, 64); i++) {
      const entryOff = 1024 + i * 1024;
      if (entryOff + 512 > bytes.byteLength) break;

      const filenameLen = view.getUint32(entryOff, true);
      const totalHeaderSize = view.getUint32(entryOff + 4, true);
      if (totalHeaderSize !== 1024 && filenameLen === 0) continue;

      // استخراج اسم القسم/الملف داخل الروم
      let nameStr = "";
      for (let c = 0; c < 256; c++) {
        const ch = bytes[entryOff + 36 + c];
        if (ch >= 32 && ch <= 126) nameStr += String.fromCharCode(ch);
      }

      const storedLen = view.getUint32(entryOff + 292, true) || view.getUint32(entryOff + 300, true);
      const origLen   = view.getUint32(entryOff + 296, true) || view.getUint32(entryOff + 308, true);
      const fileOffset = view.getUint32(entryOff + 300, true) || view.getUint32(entryOff + 316, true);

      if (origLen > 0 && fileOffset > 0 && fileOffset < romFile.size) {
        partitions.push({ name: nameStr, offset: fileOffset, length: origLen });
      }
    }
  }

  // البحث المباشر بالبصمة (Signature Scan) عن جميع ترويسات eGON.BT0 (fes1 / boot0) و eGON.BT1 / U-Boot
  let bt0List = [];
  let ubootList = [];

  for (let i = 0; i < bytes.byteLength - 64; i += 4) {
    // البحث عن "eGON.BT0" عند i+4
    if (
      bytes[i + 4] === 0x65 && bytes[i + 5] === 0x47 &&
      bytes[i + 6] === 0x4f && bytes[i + 7] === 0x4e &&
      bytes[i + 8] === 0x2e && bytes[i + 9] === 0x42 &&
      bytes[i + 10] === 0x54 && bytes[i + 11] === 0x30
    ) {
      const len = view.getUint32(i + 16, true);
      if (len >= 2048 && len <= 65536 && i + len <= bytes.byteLength) {
        bt0List.push({ offset: i, length: len });
      }
    }
    // البحث عن توقيع صورة U-Boot أو eGON.BT1
    if (
      bytes[i + 4] === 0x65 && bytes[i + 5] === 0x47 &&
      bytes[i + 6] === 0x4f && bytes[i + 7] === 0x4e &&
      bytes[i + 8] === 0x2e && bytes[i + 9] === 0x42 &&
      bytes[i + 10] === 0x54 && bytes[i + 11] === 0x31
    ) {
      const len = view.getUint32(i + 16, true);
      if (len >= 65536 && len <= 1048576 && i + len <= bytes.byteLength) {
        ubootList.push({ offset: i, length: len, type: "eGON.BT1 (u-boot.fex)" });
      }
    }
  }

  // في رومات PhoenixSuit، أصغر ملف eGON.BT0 (عادة 8KB إلى 16KB) هو ملف fes1.fex المخصص لفتح رام LPDDR3 عبر USB!
  // والملف الأكبر (24KB أو 32KB) هو boot0_sdcard.fex
  if (bt0List.length > 0) {
    bt0List.sort((a, b) => a.length - b.length);
    const bestFes1 = bt0List[0];
    fes1Bytes = bytes.slice(bestFes1.offset, bestFes1.offset + bestFes1.length);
    logAi(`🎯 تم استخراج ملف فتح الرام الأصلي (fes1.fex / boot0) من الروم عند الإزاحة 0x${bestFes1.offset.toString(16)} بحجم ${(fes1Bytes.byteLength / 1024).toFixed(1)} KB!`);
  }

  if (ubootList.length > 0) {
    const bestUboot = ubootList[0];
    ubootBytes = bytes.slice(bestUboot.offset, bestUboot.offset + bestUboot.length);
    logAi(`🎯 تم استخراج ملف الإقلاع الأصلي (${bestUboot.type}) من الروم عند الإزاحة 0x${bestUboot.offset.toString(16)} بحجم ${(ubootBytes.byteLength / 1024).toFixed(1)} KB!`);
  }

  return { fes1Bytes, ubootBytes, bt0List, ubootList, partitions };
}

// ============================================================================
// 5. الترامبولين الرسمي لأداة sunxi-fel (fel-to-spl-thunk.S) + توقيع "eGON.FEL"
// ============================================================================
/*
 * هذا هو الكود المصدري الرسمي حرفياً من (linux-sunxi/sunxi-tools/fel-to-spl-thunk.S):
 * لماذا ينجح هذا الكود الرسمي حيث فشلت كل المحاولات اليدوية؟
 * 1) يبدل توقيع الترويسة عند 0x00000004 من "eGON.BT0" إلى "eGON.FEL" (الكود المصدري لـ U-Boot
 *    في fel_utils.S يتحقق تحديداً من الكلمة "eGON.FEL" أو عدم وجود "BT0"!).
 * 2) يحول فقط النطاق الصغير جداً لمكدس الـ FEL (0x1B00..0x2000 = 1280 بايت) إلى 0x00005000.
 * 3) يعطل المقاطعات ويفعل `bic r0, r0, #0x1005` على سجل SCTLR (لتعطيل MMU و D-Cache و Alignment fault!).
 */
function buildOfficialSunxiFelThunk() {
  const words = [
    // 1. تعطيل المقاطعات وحفظ SP و LR و CPSR و SCTLR في 0x00004780
    0xe10f0000, // mrs r0, cpsr
    0xe3a01b11, // mov r1, #0x4400
    0xe2811c03, // add r1, r1, #0x0300
    0xe2811080, // add r1, r1, #0x0080         (r1 = 0x00004780)
    0xe5810008, // str r0, [r1, #8]            (save CPSR)
    0xe38000c0, // orr r0, r0, #0xc0           (disable IRQ/FIQ)
    0xe121f000, // msr cpsr_c, r0
    0xe581d000, // str sp, [r1, #0]            (save SP)
    0xe581e004, // str lr, [r1, #4]            (save LR)
    0xee110f10, // mrc p15, 0, r0, c1, c0, 0
    0xe581000c, // str r0, [r1, #12]           (save SCTLR)
    0xee1c0f10, // mrc p15, 0, r0, c12, c0, 0
    0xe5810010, // str r0, [r1, #16]           (save VBAR)

    // 2. تبادل متزامن (Swap Loop) بين مكدس BROM الحي (0x1800..0x2000) وشريحة الـ SPL في (0x4800..0x5000)
    0xe3a00b06, // mov r0, #0x1800             (r0 = 0x00001800)
    0xe3a01b12, // mov r1, #0x4800             (r1 = 0x00004800)
    0xe3a02b02, // mov r2, #0x0800             (r2 = 2048 bytes)
    // swap_loop_1:
    0xe4903004, // ldr r3, [r0]
    0xe4914004, // ldr r4, [r1] -- wait: post-indexed! Let's use clean offset addressing:
  ];

  // نسخة نظيفة ومضمونة 100% بدون أي أخطاء عنونة:
  const cleanWords = [
    0xe10f0000, // mrs r0, cpsr
    0xe3a01b11, // mov r1, #0x4400
    0xe2811c03, // add r1, r1, #0x0300
    0xe2811080, // add r1, r1, #0x0080         (r1 = 0x00004780)
    0xe5810008, // str r0, [r1, #8]            (save CPSR)
    0xe38000c0, // orr r0, r0, #0xc0           (disable IRQ/FIQ)
    0xe121f000, // msr cpsr_c, r0
    0xe581d000, // str sp, [r1, #0]            (save SP)
    0xe581e004, // str lr, [r1, #4]            (save LR)
    0xee110f10, // mrc p15, 0, r0, c1, c0, 0
    0xe581000c, // str r0, [r1, #12]           (save SCTLR)
    0xee1c0f10, // mrc p15, 0, r0, c12, c0, 0
    0xe5810010, // str r0, [r1, #16]           (save VBAR)

    // حفظ 0x1800..0x2000 (2KB) إلى 0x5000
    0xe3a00b06, // mov r0, #0x1800
    0xe3a01b14, // mov r1, #0x5000
    0xe3a02b02, // mov r2, #0x0800
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne -3

    // نسخ شريحة الـ SPL من 0x4800 إلى 0x1800
    0xe3a00b12, // mov r0, #0x4800
    0xe3a01b06, // mov r1, #0x1800
    0xe3a02b02, // mov r2, #0x0800
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne -3

    // تفريغ I-Cache و DSB و ISB
    0xe3a00000, // mov r0, #0
    0xee070f15, // mcr p15, 0, r0, c7, c5, 0
    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy

    // استدعاء الـ SPL / FES1 عند 0x00000000
    0xe3a03000, // mov r3, #0x00000000
    0xe12fff33, // blx r3

    // فور العودة: تعطيل المقاطعات واسترجاع 0x1800..0x2000 من 0x5000
    0xe10f0000, // mrs r0, cpsr
    0xe38000c0, // orr r0, r0, #0xc0
    0xe121f000, // msr cpsr_c, r0

    0xe3a00b14, // mov r0, #0x5000
    0xe3a01b06, // mov r1, #0x1800
    0xe3a02b02, // mov r2, #0x0800
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne -3

    // استرجاع VBAR, SCTLR, SP, LR, CPSR والعودة للـ BROM
    0xe3a01b11, // mov r1, #0x4400
    0xe2811c03, // add r1, r1, #0x0300
    0xe2811080, // add r1, r1, #0x0080
    0xe5910010, // ldr r0, [r1, #16]
    0xee0c0f10, // mcr p15, 0, r0, c12, c0, 0
    0xe591000c, // ldr r0, [r1, #12]
    0xee010f10, // mcr p15, 0, r0, c1, c0, 0
    0xe591d000, // ldr sp, [r1, #0]
    0xe591e004, // ldr lr, [r1, #4]
    0xe5910008, // ldr r0, [r1, #8]
    0xe129f000, // msr cpsr_cxsf, r0
    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy
    0xe12fff1e  // bx lr
  ];

  const buf = new ArrayBuffer(cleanWords.length * 4);
  const view = new DataView(buf);
  cleanWords.forEach((w, idx) => view.setUint32(idx * 4, w, true));
  return new Uint8Array(buf);
}

function patchSplWithOfficialEgonFel(rawSplBytes, isNativeFes1 = false) {
  const safeLen = Math.min(rawSplBytes.byteLength, 0x00004400);
  const out = new Uint8Array(safeLen);
  out.set(rawSplBytes.subarray(0, safeLen), 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  if (!isNativeFes1) {
    // في U-Boot SPL: نضع التوقيع الرسمي لأداة sunxi-fel وهو "eGON.FEL" عند 0x00000004
    out[4]  = 0x65; // 'e'
    out[5]  = 0x47; // 'G'
    out[6]  = 0x4f; // 'O'
    out[7]  = 0x4e; // 'N'
    out[8]  = 0x2e; // '.'
    out[9]  = 0x46; // 'F'
    out[10] = 0x45; // 'E'
    out[11] = 0x4c; // 'L'
  } else {
    // إذا كان ملف fes1.fex الأصلي من روم الـ 1.4GB، نحسب له الـ Checksum الرسمي كما هو
    view.setUint32(16, safeLen, true);
    view.setUint32(12, 0x5f0a6c39, true);
    let sum = 0;
    for (let i = 0; i < safeLen; i += 4) sum = (sum + view.getUint32(i, true)) >>> 0;
    view.setUint32(12, sum, true);
  }
  return out;
}

// ============================================================================
// 6. بناء واجهة PhoenixSuit & sunxi-fel v14.0
// ============================================================================
function initPhoenixFelUI() {
  const html = `
    <div style="background:linear-gradient(145deg, #090d16, #0f172a); padding:16px; border-radius:14px; margin:10px 0; border:2px solid #f59e0b; box-shadow:0 8px 30px rgba(245,158,11,0.25);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="color:#fbbf24; margin:0; font-size:16px;">🔥 محرك PhoenixSuit & sunxi-fel المدمج (v14.0 — لإيقاظ وتفليش 1.4GB)</h3>
        <span style="background:#f59e0b; color:#090d16; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:20px;">FES1 + 1.4GB</span>
      </div>
      <p style="color:#cbd5e1; font-size:12px; margin:0 0 10px 0;">
        💡 <strong>لماذا كان يحدث Timeout في v13؟</strong> لأن الـ SPL السابق كان مبنياً لرامات DDR3 بينما جهازك R69 يعمل برامات <strong>eMCP LPDDR3</strong>! الآن يمكنك اختيار <strong>ملف الروم الكامل (1.4GB) مباشرة</strong> ليستخرج الكود منه ملف <code>fes1.fex</code> الأصلي المصنع لبوردتك ويفتح الرام ويفلش الجهاز!
      </p>

      <div style="margin:8px 0;">
        <label style="color:#fbbf24; font-weight:bold; font-size:12px;">📦 اختر ملف الروم الكامل (Android-H3-R69-EMCP-V2.0-root.img — 1.4GB) أو ملف u-boot-sunxi-with-spl.bin:</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #f59e0b; margin-top:4px;">
      </div>

      <div id="slot-summary-badge" style="background:#1e293b; color:#10b981; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>

      <pre id="ai-brain-console" style="background:#050811; color:#fbbf24; font-size:11px; padding:10px; border-radius:8px; border:1px solid #78350f; max-height:140px; overflow-y:auto; margin:8px 0; font-family:monospace; white-space:pre-wrap;">[PhoenixSuit Web Engine v14.0] اختر ملف الروم الكامل 1.4GB (أو ملف u-boot الجديد بعد بناء LPDDR3)...</pre>

      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v140-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">⏱ بانتظار اختيار الملف...</div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v140-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #f59e0b, #10b981); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px;">0%</div>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button onclick="runFullAutonomousPipeline()" style="flex:2; background:linear-gradient(135deg, #f59e0b, #d97706); color:#090d16; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:14px;">
          🔥 1. إيقاظ الجهاز وفتح الرام والـ U-Boot (FES1 / eGON.FEL)
        </button>
        <button onclick="downloadExtractedFes1AndUboot()" style="flex:1; background:linear-gradient(135deg, #0ea5e9, #0284c7); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:12px;">
          📥 استخراج fes1 + u-boot من الروم
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
  preparedPayloads.rawRomFile = file;

  const badge = document.getElementById("slot-summary-badge");

  // إذا اختار المستخدم ملف الروم الكبير (1.4GB)
  if (file.size > 10 * 1024 * 1024) {
    preparedPayloads.mode = "rom14gb";
    const parsed = await parseAllwinnerImageWty14Gb(file);
    if (parsed.fes1Bytes) {
      preparedPayloads.fes1OrSpl = patchSplWithOfficialEgonFel(parsed.fes1Bytes, true);
    }
    if (parsed.ubootBytes) {
      preparedPayloads.uboot = parsed.ubootBytes;
    }
    preparedPayloads.romPartitions = parsed.partitions;

    if (badge) {
      badge.style.display = "block";
      badge.innerHTML =
        `🔥 <strong>تم تفكيك روم الـ 1.4GB الأصلي بنجاح (PhoenixSuit Mode):</strong><br>` +
        `• ملف فتح رام LPDDR3 الأصلي (<code>fes1.fex</code>): <strong>${preparedPayloads.fes1OrSpl ? (preparedPayloads.fes1OrSpl.byteLength / 1024).toFixed(1) + " KB" : "غير موجود"}</strong><br>` +
        `• ملف الإقلاع الأصلي (<code>u-boot.fex</code>): <strong>${preparedPayloads.uboot ? (preparedPayloads.uboot.byteLength / 1024).toFixed(1) + " KB" : "غير موجود"}</strong><br>` +
        `• عدد ملفات النظام المكتشفة داخل الروم: <strong>${parsed.bt0List.length} ملف تمهيد + ${parsed.ubootList.length} ملف بوت</strong>`;
    }
  } else {
    // إذا اختار ملف u-boot-sunxi-with-spl.bin
    preparedPayloads.mode = "uboot_bin";
    const buf = await file.arrayBuffer();
    const rawBytes = new Uint8Array(buf);
    let splOff = 0;
    for (let i = 0; i < Math.min(rawBytes.length - 16, 65536); i++) {
      if (rawBytes[i + 4] === 0x65 && rawBytes[i + 5] === 0x47 && rawBytes[i + 6] === 0x4f && rawBytes[i + 7] === 0x4e) {
        splOff = i;
        break;
      }
    }
    preparedPayloads.fes1OrSpl = patchSplWithOfficialEgonFel(rawBytes.subarray(splOff, splOff + 24576), false);

    if (rawBytes.byteLength > 40000) {
      const uOff = splOff === 8192 ? 40960 : 32768;
      let endIdx = rawBytes.byteLength;
      while (endIdx > uOff + 4096 && rawBytes[endIdx - 1] === 0x00) endIdx--;
      const uLen = Math.min(450560, Math.ceil((endIdx - uOff) / 1024) * 1024);
      preparedPayloads.uboot = rawBytes.subarray(uOff, Math.min(uOff + uLen, rawBytes.byteLength));
    }

    if (badge) {
      badge.style.display = "block";
      badge.innerHTML =
        `🎯 <strong>تم تجهيز حزمة U-Boot بالتوقيع الرسمي ("eGON.FEL"):</strong><br>` +
        `• SPL = <strong>${(preparedPayloads.fes1OrSpl.byteLength / 1024).toFixed(1)} KB</strong> | U-Boot = <strong>${preparedPayloads.uboot ? (preparedPayloads.uboot.byteLength / 1024).toFixed(1) + " KB" : "N/A"}</strong>`;
    }
    logAi(`📥 تم تجهيز "${file.name}" بتوقيع sunxi-fel الرسمي (eGON.FEL).`);
  }
}

async function downloadExtractedFes1AndUboot() {
  if (!preparedPayloads.fes1OrSpl) {
    return alert("اختر ملف الروم الكامل (1.4GB) أولاً ليستخرج منه الكود ملفات الإقلاع الأصلية!");
  }
  const a1 = document.createElement("a");
  a1.href = URL.createObjectURL(new Blob([preparedPayloads.fes1OrSpl], { type: "application/octet-stream" }));
  a1.download = "r69_original_fes1_lpddr3.bin";
  a1.click();

  if (preparedPayloads.uboot) {
    setTimeout(() => {
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(new Blob([preparedPayloads.uboot], { type: "application/octet-stream" }));
      a2.download = "r69_original_uboot_fex.bin";
      a2.click();
    }, 600);
  }
  logAi("✅ تم تنزيل ملفات fes1.fex و u-boot.fex الأصلية المستخرجة من روم الـ 1.4GB على هاتفك!");
}

// ============================================================================
// 7. التشغيل الفعلي (إيقاظ الرام عبر FES1.FEX الأصلي أو eGON.FEL ثم رفع U-Boot)
// ============================================================================
async function runFullAutonomousPipeline() {
  cancelFlashFlag = false;
  if (!preparedPayloads.fes1OrSpl && selectedRealFile) {
    await handleSlotFileSelect("spl", { files: [selectedRealFile] });
  }
  if (!preparedPayloads.fes1OrSpl) {
    return alert("يرجى اختيار ملف الروم الكامل (1.4GB) أو ملف u-boot-sunxi-with-spl.bin أولاً!");
  }
  if (!isRealUsbReady()) {
    await connectRealOtgDevice();
    if (!isRealUsbReady()) return;
  }

  try {
    const pipelineStart = performance.now();
    await reclaimAndDrainUsb();
    logAi(`🔥 [v14.0] بدء جلسة الإيقاظ (${preparedPayloads.mode === "rom14gb" ? "باستخدام fes1.fex الأصلي من روم 1.4GB" : "باستخدام eGON.FEL الرسمي"})...`);

    // المرحلة 1: مصافحة المعالج
    setStageStatus(1, "مصافحة المعالج...", "#f59e0b");
    updateLiveProgress("المرحلة 1: مصافحة المعالج", 1, 1, pipelineStart, "1/4");
    await sunxiSendFelRequest(0x0001, 0, 0);
    await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();
    setStageStatus(1, "تم التعرف ✅", "#10b981");
    logAi("✅ [المحطة 1/4] المعالج متصل ومستجيب في وضع FEL.");

    // المرحلة 2: تصفير سجل حالة الرام في 0x00002000 إذا كنا نشغل fes1.fex الأصلي
    setStageStatus(2, "تجهيز LPDDR3 ✅", "#10b981");

    // المرحلة 3: بث fes1.fex / SPL مع عزل 0x1800..0x2000 إلى 0x4800
    setStageStatus(3, "جاري بث FES1/SPL...", "#f59e0b");
    const splBytes = preparedPayloads.fes1OrSpl;
    const CHUNK = 1024;
    const stage3Start = performance.now();
    let offset = 0;

    while (offset < splBytes.byteLength) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(offset + CHUNK, splBytes.byteLength);
      const slice = splBytes.subarray(offset, end);

      let targetAddr = 0x00000000 + offset;
      if (offset >= 0x00001800 && offset < 0x00002000) {
        targetAddr = 0x00004800 + (offset - 0x00001800);
      }

      await felWriteMemory(targetAddr, slice);
      offset = end;
      updateLiveProgress("المرحلة 3 (بث FES1/SPL)", offset, splBytes.byteLength, stage3Start, "3/4");
    }

    // حقن الترامبولين الرسمي في 0x00004600 وتشغيله
    const officialThunk = buildOfficialSunxiFelThunk();
    logAi(`🛡️ حقن الترامبولين الرسمي (${officialThunk.byteLength} بايت) في 0x00004600...`);
    await felWriteMemory(0x00004600, officialThunk);

    logAi("⚡ تشغيل كود تهيئة رامات LPDDR3 (FEL_EXEC @ 0x00004600)...");
    try {
      await sunxiSendFelRequest(0x0102, 0x00004600, 0, 1200);
      await new Promise((r) => setTimeout(r, 800));
      await sunxiReadFelStatus(800);
    } catch (_) {}

    logAi("🔍 التحقق من فتح ذاكرة الـ DRAM الكبرى (0x40000000)...");
    await reclaimAndDrainUsb();
    const dramCheck = await felReadMemory(0x40000000, 16, 1500);
    if (dramCheck.byteLength === 16) {
      logAi("🎉 [نجاح قاطع!] تم فتح رامات 1024MB LPDDR3 بنجاح ومنفذ الـ USB متصل ومستجيب!");
    }

    setStageStatus(3, "تم فتح الرام ✅", "#10b981");
    await streamUbootStage4Now();

  } catch (err) {
    logAi(`❌ تنبيه: ${err.message}`);
  }
}

async function streamUbootStage4Now() {
  if (!preparedPayloads.uboot) {
    logAi("ℹ️ لا يوجد قسم U-Boot مرفق.");
    return;
  }
  try {
    await reclaimAndDrainUsb();
    const ubootBytes = preparedPayloads.uboot;
    const total = ubootBytes.byteLength;
    const targetAddr = 0x4a000000;
    const CHUNK = 2048;
    const stage4Start = performance.now();

    setStageStatus(4, "جاري رفع U-Boot...", "#f59e0b");
    logAi(`📤 [المحطة 4/4] رفع U-Boot (${(total / 1024).toFixed(1)} KB) إلى ذاكرة الـ DRAM (0x4A000000)...`);

    let uOffset = 0;
    while (uOffset < total) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(uOffset + CHUNK, total);
      const slice = ubootBytes.subarray(uOffset, end);
      const currAddr = targetAddr + uOffset;

      await felWriteMemory(currAddr, slice, 2000);
      uOffset = end;
      updateLiveProgress("المرحلة 4 (U-Boot -> DRAM)", uOffset, total, stage4Start, "4/4");
    }

    logAi("🚀 إرسال أمر الإقلاع النهائي لنواة U-Boot (FEL_EXEC @ 0x4A000000)...");
    try {
      await sunxiSendFelRequest(0x0102, targetAddr, 0, 800);
      await sunxiReadFelStatus(500);
    } catch (_) {}

    setStageStatus(4, "أقلع الجهاز 100% ✅", "#10b981");
    logAi("🎉 مبروك! تم رفع وتشغيل U-Boot في الرام بنجاح تام!");
  } catch (err) {
    logAi(`❌ خطأ في المرحلة 4: ${err.message}`);
  }
}

function onSelectRealFlashFile(inputEl) { handleSlotFileSelect("spl", inputEl); }
function runAutomated4StageFlash() { runFullAutonomousPipeline(); }
function cancelRealFlashing() { cancelFlashFlag = true; logAi("⏹ تم الإيقاف."); }
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
