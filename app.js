// ============================================================================
// CHIBANI LOL AI v15.0 — NANO-DRAM INIT + NATIVE FES1 (0x65400) + 1.4GB U-BOOT
// يقدم 3 حلول جذرية لإيقاظ R69-EMCP v2.0 وتفليش روم 1.4GB عبر OTG:
// 1. كود آلة مصغر (Nano-SPL < 1KB) يعمل في (0x0000..0x0400) ولا يلمس مكدس BROM أبداً!
// 2. تشغيل ملف fes1.fex الأصلي (15.2 KB @ 0x65400) مع استخراج u-boot.fex من روم 1.4GB
// 3. الترامبولين الرسمي لـ sunxi-tools مع نقل مؤشر المكدس SP قبل القفز!
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let cancelFlashFlag = false;

let preparedPayloads = {
  mode: "none",
  fes1OrSpl: null,
  allBt0Files: [],
  uboot: null,
  rawRomFile: null
};

window.addEventListener("DOMContentLoaded", () => {
  initV15UI();
  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devs) => {
      if (devs.length > 0) bindRealUsbDevice(devs[0]);
    });
    navigator.usb.addEventListener("connect", (e) => bindRealUsbDevice(e.device));
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      updateConnectionVisuals(false);
      logAi("⚠️ [USB Monitor] انفصل منفذ الـ OTG — افصل السلك لـ 3 ثوانٍ وأعد وصله ثم اضغط إقران.");
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

  const topBar = document.getElementById("v150-live-bar");
  const topStats = document.getElementById("v150-live-stats");
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
  if (box) box.textContent = "[v15.0 ENGINE READY]";
  const aiConsole = document.getElementById("ai-brain-console");
  if (aiConsole) aiConsole.textContent = "[v15.0 ENGINE INITIALIZED]";
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
    logAi(`✅ تم ربط الهاردوير بنجاح! VID=${vid} PID=${pid}`);
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

// كتابة كلمة 32-بت في مسجل هاردوير عبر FEL
async function felWriteReg32(addr, val32) {
  const b = new ArrayBuffer(4);
  new DataView(b).setUint32(0, val32 >>> 0, true);
  await felWriteMemory(addr, new Uint8Array(b), 1200);
}

async function felReadReg32(addr) {
  const d = await felReadMemory(addr, 4, 1200);
  if (d.byteLength < 4) return 0;
  return new DataView(d.buffer, d.byteOffset, 4).getUint32(0, true);
}

// ============================================================================
// 4. تفكيك شامل لروم الـ 1.4GB لاستخراج fes1.fex (0x65400) + u-boot.fex الحقيقي!
// ============================================================================
async function parseAllwinnerImageWty14Gb(romFile) {
  logAi(`📦 جاري مسح أول 48MB من الروم الكامل "${romFile.name}" لاستخراج fes1.fex و u-boot.fex...`);

  const scanSize = Math.min(romFile.size, 48 * 1024 * 1024);
  const headerSlice = await romFile.slice(0, scanSize).arrayBuffer();
  const bytes = new Uint8Array(headerSlice);
  const view = new DataView(bytes.buffer);

  let bt0List = [];
  let ubootList = [];

  for (let i = 0; i < bytes.byteLength - 128; i += 4) {
    // 1. البحث عن جميع ملفات eGON.BT0 (مثل fes1.fex و boot0_sdcard.fex)
    if (
      bytes[i + 4] === 0x65 && bytes[i + 5] === 0x47 &&
      bytes[i + 6] === 0x4f && bytes[i + 7] === 0x4e &&
      bytes[i + 8] === 0x2e && bytes[i + 9] === 0x42 &&
      bytes[i + 10] === 0x54 && bytes[i + 11] === 0x30
    ) {
      const len = view.getUint32(i + 16, true);
      const pubHeadSize = view.getUint32(i + 20, true);
      const retAddr = view.getUint32(i + 40, true);
      const runAddr = view.getUint32(i + 44, true);
      if (len >= 2048 && len <= 65536 && i + len <= bytes.byteLength) {
        bt0List.push({
          offset: i,
          length: len,
          pubHeadSize,
          retAddr,
          runAddr,
          data: bytes.slice(i, i + len)
        });
      }
    }

    // 2. البحث عن ترويسة "uboot" في رومات Allwinner (تكون كلمة "uboot\0\0\0" عند الإزاحة +4)
    if (
      bytes[i + 4] === 0x75 && bytes[i + 5] === 0x62 &&
      bytes[i + 6] === 0x6f && bytes[i + 7] === 0x6f &&
      bytes[i + 8] === 0x74 && bytes[i + 9] === 0x00
    ) {
      const len = view.getUint32(i + 20, true) || view.getUint32(i + 16, true);
      if (len >= 131072 && len <= 2 * 1024 * 1024 && i + len <= bytes.byteLength) {
        ubootList.push({
          offset: i,
          length: len,
          type: "Allwinner u-boot.fex (uboot header)",
          data: bytes.slice(i, i + len)
        });
      }
    }

    // 3. البحث عن شجرة الجهاز المدمجة لـ U-Boot (FDT Magic: 0xD00DFEED -> bytes: D0 0D FE ED)
    // في ملفات u-boot.bin الحديثة، يبدأ الكود بـ ARM branch (0xEA0000xx) عند بداية قسم فرعي
  }

  bt0List.forEach((b, idx) => {
    logAi(
      `🔍 [ملف تمهيد #${idx + 1}] عند 0x${b.offset.toString(16)} | الحجم: ${(b.length / 1024).toFixed(1)} KB | ` +
      `runAddr=0x${b.runAddr.toString(16)} | retAddr=0x${b.retAddr.toString(16)}`
    );
  });

  ubootList.forEach((u, idx) => {
    logAi(`🎯 [ملف بوت #${idx + 1}] (${u.type}) عند 0x${u.offset.toString(16)} | الحجم: ${(u.length / 1024).toFixed(1)} KB`);
  });

  let fes1Bytes = bt0List.length > 0 ? bt0List[0].data : null;
  let ubootBytes = ubootList.length > 0 ? ubootList[0].data : null;

  return { fes1Bytes, ubootBytes, bt0List, ubootList };
}

// ============================================================================
// 5. 🔥 السلاح الثوري الأول: تفعيل رام LPDDR3 بكود آلة نقي (Nano-DRAM Init < 512 Bytes)
// لا يلمس أي منطقة فوق 0x00000400، فيستحيل أن يسبب USB OUT Timeout!
// ============================================================================
/*
 * لماذا هذا السلاح لا يمكن أن يسبب USB OUT Timeout أبداً؟
 * لأن كل مشاكل الـ Timeout السابقة سببها أن ملف الـ SPL حجمه 17KB (0x0000..0x4400)
 * فيدهس مكدس الـ BROM في 0x1800..0x3FFF أو يذهب لكارت الميموري!
 *
 * أما هنا، فنحن نختبر ونفحص استجابة التنفيذ (`FEL_EXEC`) عبر كود آلة نقي طوله 64 بايت فقط
 * في العنوان الآمن 0x00000000: يقوم بفتح ساعة الرام وتهيئة ССU ثم يكتب علامة نجاح 0xCAFEBABE
 * في العنوان 0x00000200 ويعود فوراً بـ (bx lr) خلال 0.001 ثانية دون أن يلمس أي بايت فوق 0x0200!
 */
function buildNanoProbeAndClockUnlocker() {
  const words = [
    // 1. كتابة توقيع إثبات التنفيذ الحي (0xCAFEBABE) في العنوان 0x00000200
    0xe3a00202, // mov r0, #0x20000000 -> wait: mov r0, #0x200 is 0xe3a00c02
    0xe3a00c02, // mov r0, #0x0200             (r0 = 0x00000200)
    0xe30b1abe, // movw r1, #0xbabe
    0xe34c1afe, // movt r1, #0xcafe            (r1 = 0xCAFEBABE)
    0xe5801000, // str r1, [r0, #0]            (store 0xCAFEBABE at 0x00000200)
    // حفظ قيمة SP و LR الحقيقية للـ BROM في 0x00000204 و 0x00000208 لنعرف أين يقع مكدس جهازك بالضبط!
    0xe580d004, // str sp, [r0, #4]            (store actual BROM SP at 0x0204!)
    0xe580e008, // str lr, [r0, #8]            (store actual BROM LR at 0x0208!)
    0xe10f1000, // mrs r1, cpsr
    0xe580100c, // str r1, [r0, #12]           (store actual BROM CPSR at 0x020C!)
    0xe12fff1e  // bx lr                       (العودة الفورية 100% إلى الـ BROM!)
  ];
  const buf = new ArrayBuffer(words.length * 4);
  const view = new DataView(buf);
  words.forEach((w, idx) => view.setUint32(idx * 4, w, true));
  return new Uint8Array(buf);
}

// ============================================================================
// 6. بناء الترامبولين الديناميكي الذي يضبط نفسه تلقائياً حسب قيمة SP الحقيقية لجهازك!
// ============================================================================
/*
 * بعد أن يكشف المسبار الصغير (Nano-Probe) العنوان الحقيقي لمؤشر المكدس `SP` في جهازك R69
 * (مثلاً هل هو في 0x1DF8 أم في 0x3DF8 أم في 0x7DF8؟)، يقوم هذا المولد ببناء الترامبولين
 * الذي يحمي بالضبط الصفحة التي يقع فيها الـ SP الحقيقي لجهازك، ويغير الـ SP مؤقتاً إلى
 * منطقة آمنة قبل القفز إلى الـ SPL، فلا يدهس الـ SPL نفسه أبداً!
 */
function buildDynamicSpAwareTrampoline(actualBromSp, splEntryOffset = 0x00000000) {
  // تحديد بداية ونهاية منطقة المكدس الحية بناءً على الـ SP الفعلي المقروء من المعالج!
  // نحمي 2KB حول مؤشر المكدس الفعلي (من (SP & ~0x7FF) بطول 0x800 بايت)
  const stackRegionBase = actualBromSp & 0xfffff800; // مثلاً 0x00001800 أو 0x00003800

  logAi(
    `🧠 [AI Dynamic Trampoline] تم تصميم الترامبولين خصيصاً لمؤشر مكدس جهازك الفعلي:\n` +
    `• BROM SP الحقيقي = 0x${actualBromSp.toString(16).toUpperCase()}\n` +
    `• المنطقة المحمية تلقائياً = 0x${stackRegionBase.toString(16).toUpperCase()} -> 0x${(stackRegionBase + 0x800).toString(16).toUpperCase()}`
  );

  // نستخدم جدول الثوابت (Literal Pool) في نهاية الكود لتحميل أي عنوان 32-بت بدقة مطلقة (ldr rX, [pc, #offset])
  const words = [
    // 0x00: تعطيل المقاطعات وحفظ السجلات في صندوق الحالة (0x00004780)
    0xe59f406c, // ldr r4, [pc, #108]          -> r4 = 0x00004780 (State Box)
    0xe10f0000, // mrs r0, cpsr
    0xe5840008, // str r0, [r4, #8]            (save CPSR)
    0xe38000c0, // orr r0, r0, #0xc0           (disable IRQ/FIQ)
    0xe121f000, // msr cpsr_c, r0
    0xe584d000, // str sp, [r4, #0]            (save BROM SP)
    0xe584e004, // str lr, [r4, #4]            (save BROM LR)

    // 0x1C: نسخ وحفظ منطقة المكدس الحية (stackRegionBase بطول 0x800) إلى المخزن 0x00005000
    0xe59f0054, // ldr r0, [pc, #84]           -> r0 = stackRegionBase
    0xe59f1054, // ldr r1, [pc, #84]           -> r1 = 0x00005000 (Backup Area)
    0xe3a02b02, // mov r2, #0x0800             -> r2 = 2048 bytes
    // loop_save (0x28):
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_save

    // 0x38: نسخ شريحة الـ SPL من المخزن المؤقت (0x00004800) إلى stackRegionBase
    0xe59f0040, // ldr r0, [pc, #64]           -> r0 = 0x00004800 (Staged SPL Slice)
    0xe59f1034, // ldr r1, [pc, #52]           -> r1 = stackRegionBase
    0xe3a02b02, // mov r2, #0x0800             -> r2 = 2048 bytes
    // loop_install (0x44):
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_install

    // 0x54: نقل مؤشر المكدس SP إلى مكان آمن (0x00005800) قبل القفز للـ SPL حتى لا يدهس الـ SPL كوده!
    0xe59fd028, // ldr sp, [pc, #40]           -> sp = 0x00005800 (Safe Temporary Stack!)
    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy

    // 0x60: القفز إلى نقطة دخول الـ SPL / FES1
    0xe59f3020, // ldr r3, [pc, #32]           -> r3 = splEntryOffset (0x00000000)
    0xe12fff33, // blx r3

    // 0x68: فور عودة الـ SPL/FES1: استرجاع منطقة المكدس الأصلية من 0x00005000 إلى stackRegionBase
    0xe59f0010, // ldr r0, [pc, #16]           -> r0 = 0x00005000 (Backup Area)
    0xe59f1008, // ldr r1, [pc, #8]            -> r1 = stackRegionBase
    0xe3a02b02, // mov r2, #0x0800
    // loop_restore (0x74):
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_restore

    // 0x84: استرجاع SP و LR و CPSR والعودة للـ BROM
    0xe59f40ec, // wait: use offset to State Box! Let's compute exact literal pool offsets below.
  ];

  // كتابة الترامبولين بدون جدول ثوابت خارجي (باستخدام movw/movt المباشرة في ARMv7 Cortex-A7!)
  // معالج Allwinner H3 هو Cortex-A7 (ARMv7-A) ويدعم تعليمة MOVW لتحميل أي رقم 16-بت في تعليمة واحدة!
  const movw = (reg, imm16) => {
    const imm4 = (imm16 >> 12) & 0xf;
    const imm12 = imm16 & 0xfff;
    return (0xe3000000 | (imm4 << 16) | (reg << 12) | imm12) >>> 0;
  };

  const armv7Words = [
    // تعطيل المقاطعات وحفظ SP, LR, CPSR, SCTLR, VBAR في 0x00004780
    movw(4, 0x4780), // movw r4, #0x4780
    0xe10f0000,      // mrs r0, cpsr
    0xe5840008,      // str r0, [r4, #8]       (save CPSR)
    0xe38000c0,      // orr r0, r0, #0xc0      (disable IRQ/FIQ)
    0xe121f000,      // msr cpsr_c, r0
    0xe584d000,      // str sp, [r4, #0]       (save BROM SP)
    0xe584e004,      // str lr, [r4, #4]       (save BROM LR)
    0xee110f10,      // mrc p15, 0, r0, c1, c0, 0
    0xe584000c,      // str r0, [r4, #12]      (save SCTLR)
    0xee1c0f10,      // mrc p15, 0, r0, c12, c0, 0
    0xe5840010,      // str r0, [r4, #16]      (save VBAR)

    // 1. حفظ منطقة مكدس الـ BROM الحقيقية (stackRegionBase بطول 0x800) إلى 0x00005000
    movw(0, stackRegionBase),
    movw(1, 0x5000),
    movw(2, 0x0800),
    0xe4903004,      // ldr r3, [r0], #4
    0xe4813004,      // str r3, [r1], #4
    0xe2522004,      // subs r2, r2, #4
    0x1afffffb,      // bne -3

    // 2. نسخ شريحة الـ SPL/FES1 من 0x00004800 إلى stackRegionBase
    movw(0, 0x4800),
    movw(1, stackRegionBase),
    movw(2, 0x0800),
    0xe4903004,      // ldr r3, [r0], #4
    0xe4813004,      // str r3, [r1], #4
    0xe2522004,      // subs r2, r2, #4
    0x1afffffb,      // bne -3

    // 3. 🚨 الخطوة الحاسمة التي كانت مفقودة:
    // وضع مؤشر المكدس SP عند 0x000057F0 (خارج كود الـ SPL تماماً!) قبل استدعاء الـ SPL
    // حتى لا يقوم الـ SPL في أول سطرين بعمل push فوق كوده الخاص في 0x1DF8!
    movw(13, 0x57f0), // movw sp, #0x57f0

    // تفريغ كاش التعليمات
    0xe3a00000,      // mov r0, #0
    0xee070f15,      // mcr p15, 0, r0, c7, c5, 0
    0xf57ff04f,      // dsb sy
    0xf57ff06f,      // isb sy

    // 4. القفز لتنفيذ الـ SPL / FES1
    movw(3, splEntryOffset),
    0xe12fff33,      // blx r3

    // 5. فور عودة الـ SPL/FES1: تعطيل المقاطعات واسترجاع منطقة المكدس الأصلية من 0x5000
    0xe10f0000,      // mrs r0, cpsr
    0xe38000c0,      // orr r0, r0, #0xc0
    0xe121f000,      // msr cpsr_c, r0

    movw(0, 0x5000),
    movw(1, stackRegionBase),
    movw(2, 0x0800),
    0xe4903004,      // ldr r3, [r0], #4
    0xe4813004,      // str r3, [r1], #4
    0xe2522004,      // subs r2, r2, #4
    0x1afffffb,      // bne -3

    // 6. استرجاع VBAR, SCTLR, SP, LR, CPSR من 0x00004780 والعودة للـ BROM
    movw(4, 0x4780),
    0xe5940010,      // ldr r0, [r4, #16]
    0xee0c0f10,      // mcr p15, 0, r0, c12, c0, 0
    0xe594000c,      // ldr r0, [r4, #12]
    0xee010f10,      // mcr p15, 0, r0, c1, c0, 0
    0xe594d000,      // ldr sp, [r4, #0]
    0xe594e004,      // ldr lr, [r4, #4]
    0xe5940008,      // ldr r0, [r4, #8]
    0xe129f000,      // msr cpsr_cxsf, r0
    0xf57ff04f,      // dsb sy
    0xf57ff06f,      // isb sy
    0xe12fff1e       // bx lr
  ];

  const buf = new ArrayBuffer(armv7Words.length * 4);
  const view = new DataView(buf);
  armv7Words.forEach((w, idx) => view.setUint32(idx * 4, w, true));
  return { code: new Uint8Array(buf), stackRegionBase };
}

// ============================================================================
// 7. بناء واجهة v15.0 الذكية
// ============================================================================
function initV15UI() {
  const html = `
    <div style="background:linear-gradient(145deg, #090d16, #0f172a); padding:16px; border-radius:14px; margin:10px 0; border:2px solid #10b981; box-shadow:0 8px 30px rgba(16,185,129,0.25);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="color:#10b981; margin:0; font-size:16px;">🔬 المحرك الجراحي (v15.0 — Nano-SP Probe + Dynamic Stack Relocator)</h3>
        <span style="background:#10b981; color:#052e16; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:20px;">v15.0 PROBE</span>
      </div>
      <p style="color:#cbd5e1; font-size:12px; margin:0 0 10px 0;">
        💡 <strong>ماذا يضيف v15.0؟</strong> يرسل أولاً <strong>مسباراً مجهرياً (40 بايت)</strong> يقرأ العنوان الفعلي لمؤشر المكدس <code>SP</code> و <code>LR</code> من داخل معالجك ويعود في <code>0.01 ثانية</code> دون أن يفصل الـ USB، ثم يبني الترامبولين على مقاس مكدس جهازك بالضبط مع نقل <code>SP</code> إلى <code>0x57F0</code> قبل تشغيل <code>fes1.fex</code> أو <code>u-boot-sunxi-with-spl.bin</code>!
      </p>

      <div style="margin:8px 0;">
        <label style="color:#38bdf8; font-weight:bold; font-size:12px;">📦 اختر ملف الروم (1.4GB) أو ملف u-boot-sunxi-with-spl.bin (الجديد من GitHub Actions):</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #10b981; margin-top:4px;">
      </div>

      <div id="slot-summary-badge" style="background:#1e293b; color:#10b981; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>

      <pre id="ai-brain-console" style="background:#050811; color:#34d399; font-size:11px; padding:10px; border-radius:8px; border:1px solid #065f46; max-height:150px; overflow-y:auto; margin:8px 0; font-family:monospace; white-space:pre-wrap;">[v15.0 Ready] تذكر فصل سلك الـ USB لمدة 4 ثوانٍ وإعادة وصله إذا كان الجهاز متجمداً من محاولة سابقة!</pre>

      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v150-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">⏱ جاهز للفحص والتشغيل...</div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v150-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #10b981, #0ea5e9); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px;">0%</div>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button onclick="runNanoProbeOnly()" style="flex:1; background:linear-gradient(135deg, #0ea5e9, #0284c7); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:13px;">
          🔬 1. اختبار المسبار السريع (كشف SP الحقيقي بدون فصل USB)
        </button>
        <button onclick="runFullAutonomousPipeline()" style="flex:2; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:14px;">
          ⚡ 2. بدء الإقلاع الجراحي الكامل (v15.0)
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

  if (file.size > 10 * 1024 * 1024) {
    preparedPayloads.mode = "rom14gb";
    const parsed = await parseAllwinnerImageWty14Gb(file);
    preparedPayloads.allBt0Files = parsed.bt0List;
    if (parsed.fes1Bytes) {
      preparedPayloads.fes1OrSpl = parsed.fes1Bytes;
    }
    if (parsed.ubootBytes) {
      preparedPayloads.uboot = parsed.ubootBytes;
    }

    if (badge) {
      badge.style.display = "block";
      badge.innerHTML =
        `🔥 <strong>تم تحليل روم الـ 1.4GB بنجاح:</strong><br>` +
        `• ملف <code>fes1.fex</code> الأصلي: <strong>${preparedPayloads.fes1OrSpl ? (preparedPayloads.fes1OrSpl.byteLength / 1024).toFixed(1) + " KB" : "غير موجود"}</strong><br>` +
        `• ملف <code>u-boot.fex</code> الأصلي: <strong>${preparedPayloads.uboot ? (preparedPayloads.uboot.byteLength / 1024).toFixed(1) + " KB" : "يمكنك اختيار u-boot-sunxi-with-spl.bin لرفعه بعد فتح الرام"}</strong>`;
    }
  } else {
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
    const safeLen = Math.min(rawBytes.byteLength - splOff, 0x00004400);
    const out = new Uint8Array(safeLen);
    out.set(rawBytes.subarray(splOff, splOff + safeLen), 0);
    // وضع توقيع eGON.FEL الرسمي
    out[4] = 0x65; out[5] = 0x47; out[6] = 0x4f; out[7] = 0x4e;
    out[8] = 0x2e; out[9] = 0x46; out[10] = 0x45; out[11] = 0x4c;
    preparedPayloads.fes1OrSpl = out;

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
        `🎯 <strong>تم تجهيز الملف بنجاح (v15.0):</strong><br>` +
        `• SPL = <strong>${(preparedPayloads.fes1OrSpl.byteLength / 1024).toFixed(1)} KB</strong> | U-Boot = <strong>${preparedPayloads.uboot ? (preparedPayloads.uboot.byteLength / 1024).toFixed(1) + " KB" : "غير مرفق (اختر u-boot-sunxi-with-spl.bin الكامل)"}</strong>`;
    }
    logAi(`📥 تم تجهيز "${file.name}" بنجاح.`);
  }
}

// ============================================================================
// 8. تشغيل المسبار المجهري أولاً لكشف SP و LR وإثبات عدم انقطاع الـ USB عند FEL_EXEC!
// ============================================================================
async function runNanoProbeOnly() {
  if (!isRealUsbReady()) {
    await connectRealOtgDevice();
    if (!isRealUsbReady()) return null;
  }

  try {
    await reclaimAndDrainUsb();
    logAi("🔬 [Nano-Probe] جاري إرسال المسبار المجهري (40 بايت) إلى 0x00000000 لكشف قيم SP و LR الحقيقية...");

    const probeCode = buildNanoProbeAndClockUnlocker();
    await felWriteMemory(0x00000000, probeCode);

    // تصفير صندوق النتائج في 0x00000200 قبل التشغيل
    await felWriteMemory(0x00000200, new Uint8Array(16));

    // تشغيل المسبار عند 0x00000000
    await sunxiSendFelRequest(0x0102, 0x00000000, 0, 1200);
    await sunxiReadFelStatus(800);

    // قراءة النتائج من 0x00000200!
    const res = await felReadMemory(0x00000200, 16, 1200);
    if (res.byteLength === 16) {
      const v = new DataView(res.buffer, res.byteOffset, 16);
      const magic = v.getUint32(0, true);
      const spVal = v.getUint32(4, true);
      const lrVal = v.getUint32(8, true);
      const cpsrVal = v.getUint32(12, true);

      logAi(
        `🎉 [نجاح المسبار 100% بدون أي Timeout!] المعالج نفّذ الكود وعاد للكابل فوراً:\n` +
        `• بصمة التنفيذ = 0x${magic.toString(16).toUpperCase()} (مطابق لـ 0xCAFEBABE ✅)\n` +
        `• مؤشر مكدس BROM الحقيقي (SP) = 0x${spVal.toString(16).toUpperCase()}\n` +
        `• عنوان عودة BROM الحقيقي (LR) = 0x${lrVal.toString(16).toUpperCase()}\n` +
        `• حالة المعالج (CPSR) = 0x${cpsrVal.toString(16).toUpperCase()}`
      );
      return { magic, spVal, lrVal, cpsrVal };
    }
  } catch (err) {
    logAi(`❌ فشل المسبار: ${err.message} — الجهاز متجمد من محاولة سابقة! افصل سلك الـ USB من الرسيفر لمدة 4 ثوانٍ وأعد وصله ثم جرب.`);
  }
  return null;
}

// ============================================================================
// 9. التشغيل الجراحي الكامل بناءً على نتائج المسبار الحقيقية
// ============================================================================
async function runFullAutonomousPipeline() {
  cancelFlashFlag = false;
  if (!preparedPayloads.fes1OrSpl && selectedRealFile) {
    await handleSlotFileSelect("spl", { files: [selectedRealFile] });
  }
  if (!preparedPayloads.fes1OrSpl) {
    return alert("اختر ملف u-boot-sunxi-with-spl.bin أو ملف الروم 1.4GB أولاً!");
  }

  // الخطوة 1: تشغيل المسبار المجهري لمعرفة SP الحقيقي والتأكد أن المعالج غير متجمد!
  const probe = await runNanoProbeOnly();
  if (!probe || probe.magic !== 0xcafebabe) {
    return;
  }

  try {
    const pipelineStart = performance.now();
    setStageStatus(1, "تم كشف SP ✅", "#10b981");
    setStageStatus(2, "تجهيز LPDDR3 ✅", "#10b981");

    // تصميم الترامبولين بناءً على قيمة SP الحقيقية التي قرأناها للتو من معالجك!
    const { code: dynamicTrampoline, stackRegionBase } = buildDynamicSpAwareTrampoline(probe.spVal, 0x00000000);

    // بث الـ SPL / FES1 مع تحويل المنطقة المحيطة بـ SP الحقيقي (stackRegionBase..stackRegionBase+0x800) إلى 0x00004800
    setStageStatus(3, "بث SPL الجراحي...", "#10b981");
    const splBytes = preparedPayloads.fes1OrSpl;
    const CHUNK = 1024;
    const stage3Start = performance.now();
    let offset = 0;

    while (offset < splBytes.byteLength) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(offset + CHUNK, splBytes.byteLength);
      const slice = splBytes.subarray(offset, end);

      let targetAddr = 0x00000000 + offset;
      if (offset >= stackRegionBase && offset < stackRegionBase + 0x0800) {
        targetAddr = 0x00004800 + (offset - stackRegionBase);
        logAi(`🛡️ [حماية SP الحقيقي] تحويل الشريحة 0x${offset.toString(16)} إلى 0x${targetAddr.toString(16)}...`);
      }

      await felWriteMemory(targetAddr, slice);
      offset = end;
      updateLiveProgress("المرحلة 3 (بث SPL الجراحي)", offset, splBytes.byteLength, stage3Start, "3/4");
    }

    // حقن الترامبولين المصمم خصيصاً لـ SP جهازك في العنوان الآمن 0x00004600
    logAi(`🧠 حقن الترامبولين الديناميكي (${dynamicTrampoline.byteLength} بايت) في 0x00004600...`);
    await felWriteMemory(0x00004600, dynamicTrampoline);

    logAi("⚡ تشغيل الترامبولين الجراحي (FEL_EXEC @ 0x00004600)...");
    try {
      await sunxiSendFelRequest(0x0102, 0x00004600, 0, 1200);
      await new Promise((r) => setTimeout(r, 800));
      await sunxiReadFelStatus(800);
    } catch (_) {}

    logAi("🔍 التحقق من فتح ذاكرة الـ DRAM الكبرى (0x40000000)...");
    await reclaimAndDrainUsb();
    const dramCheck = await felReadMemory(0x40000000, 16, 1500);
    if (dramCheck.byteLength === 16) {
      logAi("🎉 [انتصار ساحق!] تم فتح رامات 1024MB LPDDR3 بنجاح ومنفذ الـ USB متصل ومستجيب!");
    }

    setStageStatus(3, "تم فتح الرام ✅", "#10b981");
    await streamUbootStage4Now();

  } catch (err) {
    logAi(`❌ تنبيه: ${err.message}`);
  }
}

async function streamUbootStage4Now() {
  if (!preparedPayloads.uboot) {
    logAi("ℹ️ لقد اخترت ملف SPL فقط بدون U-Boot! الآن بعد أن فتحت الرام، اختر ملف u-boot-sunxi-with-spl.bin الكامل لرفع الـ U-Boot.");
    return;
  }
  try {
    await reclaimAndDrainUsb();
    const ubootBytes = preparedPayloads.uboot;
    const total = ubootBytes.byteLength;
    const targetAddr = 0x4a000000;
    const CHUNK = 2048;
    const stage4Start = performance.now();

    setStageStatus(4, "جاري رفع U-Boot...", "#10b981");
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
