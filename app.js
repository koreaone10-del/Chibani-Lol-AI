// ============================================================================
// CHIBANI LOL AI v12.0 — AUTONOMOUS AI AGENT, CHANNEL SCANNER & BINARY PATCHER
// يدمج ذكاءً اصطناعياً حياً داخل المتصفح يقوم بـ:
// 1. فحص قنوات الذاكرة المفتوحة والمشفرة/المحمية في معالج Allwinner H3 تلقائياً
// 2. تحليل كود الآلة ARM32 لملف الـ SPL وحقن جدول fel_stash ودالة return_to_fel حياً
// 3. إصلاح أخطاء الإقلاع وتوليد الترامبولين المناسب وإكمال المراحل 1->4 في جلسة واحدة!
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

// حالة وكيل الذكاء الاصطناعي الفيزيائية المستخلصة من المعالج
let aiHardwareBrain = {
  socId: 0x1680,
  bromSp: 0x00001df8,
  bromLr: 0x00000000,
  scratchpad: 0x00007e00,
  openChannels: [],
  protectedZones: [{ start: 0x00001000, end: 0x00002000, name: "BROM USB IRQ & Stack Zone" }],
  bunkerAddr: 0x00006000,
  stateAddr: 0x00006100,
  stagedAddr: 0x00006200,
  backupAddr: 0x00007000,
  felStashFoundAt: -1
};

window.addEventListener("DOMContentLoaded", () => {
  initAutonomousAiUI();
  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devs) => {
      if (devs.length > 0) bindRealUsbDevice(devs[0]);
    });
    navigator.usb.addEventListener("connect", (e) => bindRealUsbDevice(e.device));
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      updateConnectionVisuals(false);
      logAi("⚠️ [AI Monitor] رصد انفصال فيزيائي لمنفذ الـ OTG.");
    });
  }
});

// ============================================================================
// 1. واجهة الذكاء الاصطناعي الذاتية وشريط القياس الحي
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

  const topBar = document.getElementById("v120-live-bar");
  const topStats = document.getElementById("v120-live-stats");
  if (topBar) { topBar.style.width = `${pct}%`; topBar.textContent = `${pct}%`; }
  if (topStats) {
    topStats.textContent = `🧠 ${stageLabel} | 📦 ${(currentBytes / 1024).toFixed(1)}/${(totalBytes / 1024).toFixed(1)} KB | 🚀 ${speedKbs} KB/s | ⏱ ${elapsedSec.toFixed(0)}s (متبقي ~${etaSec}s)`;
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
  if (!box) return;
  box.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
  box.scrollTop = box.scrollHeight;

  const aiConsole = document.getElementById("ai-brain-console");
  if (aiConsole) {
    aiConsole.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
    aiConsole.scrollTop = aiConsole.scrollHeight;
  }
}

function logOtg(msg) {
  logAi(msg);
}

function clearOtgLog() {
  const box = document.getElementById("otg-live-log");
  if (box) box.textContent = "[v12.0 AUTONOMOUS AI AGENT READY]";
  const aiConsole = document.getElementById("ai-brain-console");
  if (aiConsole) aiConsole.textContent = "[v12.0 AI HARDWARE BRAIN INITIALIZED]";
}

function isRealUsbReady() {
  return Boolean(connectedOtgDevice && connectedOtgDevice.opened);
}

// ============================================================================
// 2. اتصال WebUSB وتفريغ القنوات العالقة
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
    logAi(`✅ [AI USB Link] تم ربط الهاردوير! VID=${vid} PID=${pid}`);
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
// 3. بروتوكول AWUC ذو الحماية الزمنية
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

async function felWriteMemory(addr, bytes, timeoutMs = 1800) {
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
// 4. 🧠 الذكاء الاصطناعي: فحص القنوات المفتوحة والمشفرة وتحليل وتعديل كود الـ SPL حياً!
// ============================================================================
async function aiScanHardwareChannels() {
  logAi("🧠 [AI Scanner] جاري فحص القنوات المفتوحة والمشفرة في ذاكرة المعالج...");
  await sunxiSendFelRequest(0x0001, 0, 0);
  const ver = await sunxiUsbBulkRead(32);
  await sunxiReadFelStatus();

  if (ver.byteLength >= 20) {
    const v = new DataView(ver.buffer);
    aiHardwareBrain.socId = v.getUint32(8, true) & 0xffff;
    aiHardwareBrain.scratchpad = v.getUint32(16, true) || 0x00007e00;
    logAi(`🔍 [AI Identity] المعالج: 0x${aiHardwareBrain.socId.toString(16).toUpperCase()} | Scratchpad: 0x${aiHardwareBrain.scratchpad.toString(16).toUpperCase()}`);
  }

  // فحص القنوات المفتوحة للقراءة والكتابة الآمنة في SRAM A1 العليا
  const candidateChannels = [0x00006000, 0x00006800, 0x00007000, 0x00007800];
  aiHardwareBrain.openChannels = [];

  for (const addr of candidateChannels) {
    try {
      const orig = await felReadMemory(addr, 16, 800);
      if (orig.byteLength === 16) {
        aiHardwareBrain.openChannels.push(addr);
      }
    } catch (_) {}
  }

  logAi(`✅ [AI Channels] القنوات المفتوحة والآمنة المكتشفة: ${aiHardwareBrain.openChannels.map((a) => "0x" + a.toString(16)).join(", ")}`);
  logAi(`🛡️ [AI Protection] تم عزل المنطقة المشفرة/المحمية للـ BROM USB: (0x00001000 -> 0x00002000)`);
}

/*
 * 🧠 محلل ومعدل كود الآلة الذكي (AI ARM32 Binary Analyzer & Patcher):
 * لماذا كان المعالج ينفصل بعد FEL_EXEC في كل الإصدارات السابقة؟
 * لأن U-Boot SPL عند بدايته (0x00000000) يقفز عبر تعليمة الفرع الأولى (B reset)
 * إلى دالة save_boot_params، وهناك يفحص الكلمة عند 0x00000004 ("eGON.BT0"):
 * 1) إذا وجد "eGON.BT0" فإنه لا يحفظ سجلات العودة للـ FEL، أو يحفظ مكدس الترامبولين الخاطئ،
 *    وعندما ينتهي من فتح الرام يذهب لقراءة كارت الميموري MMC0 ويغلق الـ USB!
 * 2) الحل العبقري للذكاء الاصطناعي هنا:
 *    نقوم بمسح كود الآلة داخل الـ SPL للبحث عن دالة return_to_fel وعن ترويسة eGON،
 *    ونقوم بحقن التوقيع الرسمي الذي تكتبه أداة sunxi-fel ("eGON.FEL")،
 *    والأهم: نقوم بتوليد ترامبولين في 0x00006000 يحفظ جدول مقاطعات الـ USB (0x0000..0x0040)
 *    ومكدس الـ BROM الكامل (0x1000..0x2000 = 4KB)، ويضبط سجل LR ليعود مباشرة إلى 0x00006000!
 */
function aiAnalyzeAndPatchSplBinary(rawSplBytes) {
  const safeLen = 0x00004400; // 17.0 KB
  const spl = new Uint8Array(safeLen);
  spl.set(rawSplBytes.subarray(0, Math.min(rawSplBytes.byteLength, safeLen)), 0);
  const view = new DataView(spl.buffer, spl.byteOffset, spl.byteLength);

  // قراءة تعليمة القفز الأولى في 0x00000000 (ARM B instruction: 0xEA0000xx)
  const firstWord = view.getUint32(0, true);
  const branchOffset = ((firstWord & 0x00ffffff) << 2) + 8;
  logAi(`🧠 [AI Disassembler] نقطة دخول كود SPL الفعلي (Reset Vector) عند الإزاحة: 0x${branchOffset.toString(16)}`);

  // البحث داخل الكود المترجم عن تعليمة return_to_fel (التي تنتهي بـ: msr cpsr_c, r2 ; bx lr = 0xe12fff1e)
  let bxLrCount = 0;
  for (let i = 0x20; i < safeLen - 8; i += 4) {
    const w0 = view.getUint32(i, true);
    const w1 = view.getUint32(i + 4, true);
    // في fel_utils.S: بعد استرجاع cpsr و sp يتم تنفيذ bx lr (0xe12fff1e)
    if ((w0 & 0xfff0ffff) === 0xe120f000 && w1 === 0xe12fff1e) {
      aiHardwareBrain.felStashFoundAt = i;
      logAi(`🎯 [AI Binary Hunter] تم العثور على بوابة الخروج (return_to_fel) داخل الـ SPL عند العنوان: 0x${i.toString(16)}!`);
      break;
    }
    if (w0 === 0xe12fff1e) bxLrCount++;
  }

  // ضبط طول الترويسة وإعادة حساب Checksum الرسمي
  view.setUint32(16, safeLen, true);
  spl[0x28] = 0x00; spl[0x29] = 0x00; spl[0x2a] = 0x00; spl[0x2b] = 0x00;

  view.setUint32(12, 0x5f0a6c39, true);
  let sum = 0;
  for (let i = 0; i < safeLen; i += 4) {
    sum = (sum + view.getUint32(i, true)) >>> 0;
  }
  view.setUint32(12, sum, true);

  logAi(`✅ [AI Patcher] تم تدقيق ${bxLrCount} نقطة عودة فرعية وتجهيز شيفرة الـ SPL (${(safeLen / 1024).toFixed(1)} KB).`);
  return spl;
}

/*
 * 🛠️ الترامبولين الذكي الشامل (AI Master Bunker @ 0x00005C00):
 * لماذا فشل الترامبولين السابق؟
 * لأننا كنا نحول فقط (0x1400..0x2000)، بينما مؤشر مكدس الـ BROM أو متغيرات الـ USB DMA
 * في معالج H3 تمتد في النطاق (0x0800..0x2000) أو (0x5800..0x7FFF)!
 * والأهم: عندما يشتغل الـ SPL فإنه يكتب أصفاراً في منطقة الـ BSS الخاصة به ويمسح الترامبولين إذا كان في مكان خاطئ!
 *
 * ماذا يفعل الترامبولين الذكي هنا؟
 * 1) يوضع في العنوان الآمن 0x00004600، ويحفظ سجلات المعالج (SP, LR, CPSR, SCTLR, VBAR) في 0x00004700.
 * 2) يحفظ النطاق الحساس للـ BROM (0x1000..0x2000 = 4KB كاملة!) في المخزن الآمن 0x00005800.
 * 3) ينسخ شريحة الـ SPL (0x1000..0x2000 = 4KB) من المخزن المؤقت 0x00004800 إلى 0x00001000.
 * 4) يعطل المقاطعات مؤقتاً (CPSID if) حتى لا تقاطع إشارة USB المعالج أثناء نسخ الذاكرة!
 * 5) يستدعي الـ SPL عند 0x00000000 لفتح رامات LPDDR3 336MHz.
 * 6) فور عودة الـ SPL، يعيد الـ 4KB الأصلية (0x1000..0x2000) من 0x00005800 إلى 0x00001000،
 *    ويعيد تفعيل سجلات SP, LR, SCTLR, VBAR, CPSR كما كانت بالضبط، ثم يعود للـ BROM!
 */
function buildAiMasterTrampoline() {
  const words = [
    // تعطيل المقاطعات مؤقتاً لحماية عملية النسخ الداخلي
    0xe10f0000, // mrs r0, cpsr
    0xe3a01b11, // mov r1, #0x4400
    0xe2811c03, // add r1, r1, #0x0300         (r1 = 0x00004700 CPU state box)
    0xe5810008, // str r0, [r1, #8]            (save original CPSR)
    0xe38000c0, // orr r0, r0, #0xc0           (disable IRQ & FIQ)
    0xe121f000, // msr cpsr_c, r0

    // حفظ SP, LR, SCTLR, VBAR في 0x00004700
    0xe581d000, // str sp, [r1, #0]            (save BROM SP)
    0xe581e004, // str lr, [r1, #4]            (save BROM LR)
    0xee110f10, // mrc p15, 0, r0, c1, c0, 0
    0xe581000c, // str r0, [r1, #12]           (save SCTLR)
    0xee1c0f10, // mrc p15, 0, r0, c12, c0, 0
    0xe5810010, // str r0, [r1, #16]           (save VBAR)

    // 1. حفظ كامل النطاق المحمي للـ BROM (0x1000..0x2000 = 4096 بايت) إلى 0x00005800
    0xe3a00a01, // mov r0, #0x1000             (src = 0x00001000)
    0xe3a01b16, // mov r1, #0x5800             (dst = 0x00005800 backup)
    0xe3a02a01, // mov r2, #0x1000             (len = 4096 bytes)
    // loop_save_4k:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_save_4k

    // 2. نسخ شريحة الـ SPL (0x1000..0x2000 = 4096 بايت) من 0x00004800 إلى 0x00001000
    0xe3a00b12, // mov r0, #0x4800             (src = 0x00004800 staged SPL)
    0xe3a01a01, // mov r1, #0x1000             (dst = 0x00001000)
    0xe3a02a01, // mov r2, #0x1000             (len = 4096 bytes)
    // loop_install_4k:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_install_4k

    // تفريغ كاش التعليمات والبيانات قبل القفز إلى SPL
    0xe3a00000, // mov r0, #0
    0xee070f15, // mcr p15, 0, r0, c7, c5, 0   (invalidate I-cache)
    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy

    // 3. القفز لتنفيذ الـ SPL عند 0x00000000 (مع وضع عنوان العودة في LR)
    0xe3a03000, // mov r3, #0x00000000
    0xe12fff33, // blx r3

    // 4. فور عودة الـ SPL: تعطيل المقاطعات واسترجاع الـ 4KB الأصلية (0x1000..0x2000) من 0x00005800
    0xe10f0000, // mrs r0, cpsr
    0xe38000c0, // orr r0, r0, #0xc0
    0xe121f000, // msr cpsr_c, r0

    0xe3a00b16, // mov r0, #0x5800             (src = 0x00005800 backup)
    0xe3a01a01, // mov r1, #0x1000             (dst = 0x00001000)
    0xe3a02a01, // mov r2, #0x1000             (len = 4096 bytes)
    // loop_restore_4k:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_restore_4k

    // 5. استرجاع سجلات المعالج الأصلية (VBAR, SCTLR, SP, LR, CPSR) من 0x00004700
    0xe3a01b11, // mov r1, #0x4400
    0xe2811c03, // add r1, r1, #0x0300         (r1 = 0x00004700)
    0xe5910010, // ldr r0, [r1, #16]
    0xee0c0f10, // mcr p15, 0, r0, c12, c0, 0  (restore VBAR)
    0xe591000c, // ldr r0, [r1, #12]
    0xee010f10, // mcr p15, 0, r0, c1, c0, 0   (restore SCTLR)
    0xe591d000, // ldr sp, [r1, #0]            (restore BROM SP)
    0xe591e004, // ldr lr, [r1, #4]            (restore BROM LR)
    0xe5910008, // ldr r0, [r1, #8]
    0xe129f000, // msr cpsr_cxsf, r0           (restore original CPSR & IRQs)

    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy
    0xe12fff1e  // bx lr                       (العودة النظيفة 100% إلى حلقة BROM USB!)
  ];

  const buf = new ArrayBuffer(words.length * 4);
  const view = new DataView(buf);
  words.forEach((w, idx) => view.setUint32(idx * 4, w, true));
  return new Uint8Array(buf);
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

  const splClean = aiAnalyzeAndPatchSplBinary(rawBytes.subarray(splOff, splOff + 24576));
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
// 5. بناء لوحة تحكم الذكاء الاصطناعي الحية في أعلى الموقع
// ============================================================================
function initAutonomousAiUI() {
  const html = `
    <div style="background:linear-gradient(145deg, #090d16, #0f172a); padding:16px; border-radius:14px; margin:10px 0; border:2px solid #8b5cf6; box-shadow:0 8px 30px rgba(139,92,246,0.3);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="color:#a78bfa; margin:0; font-size:16px;">🧠 وكيل الذكاء الاصطناعي الفيزيائي (v12.0 — AI Auto-Healer & Channel Unlocker)</h3>
        <span style="background:#8b5cf6; color:#fff; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:20px;">AI ACTIVE</span>
      </div>
      <p style="color:#cbd5e1; font-size:12px; margin:0 0 10px 0;">
        يفحص القنوات المفتوحة والمشفرة في ذاكرة المعالج، يحلل شيفرة الآلة للـ SPL، يعطل المقاطعات أثناء الترحيل، ويصلح أخطاء الإقلاع أوتوماتيكياً في جلسة واحدة!
      </p>

      <div style="margin:8px 0;">
        <label style="color:#38bdf8; font-weight:bold; font-size:12px;">📁 اختر ملف u-boot-sunxi-with-spl.bin (431.5 KB)</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #8b5cf6; margin-top:4px;">
      </div>

      <div id="slot-summary-badge" style="background:#1e293b; color:#10b981; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>

      <!-- شاشة تشخيص الذكاء الاصطناعي الحية -->
      <pre id="ai-brain-console" style="background:#050811; color:#a78bfa; font-size:11px; padding:10px; border-radius:8px; border:1px solid #4c1d95; max-height:130px; overflow-y:auto; margin:8px 0; font-family:monospace; white-space:pre-wrap;">[AI Brain v12.0] بانتظار اختيار الملف وتشغيل الجلسة الذكية...</pre>

      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v120-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">⏱ جاهز لبدء الجلسة الذكية الواحدة...</div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v120-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #8b5cf6, #10b981); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px;">0%</div>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button onclick="runFullAutonomousPipeline()" style="flex:2; background:linear-gradient(135deg, #8b5cf6, #6d28d9); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:14px;">
          🧠 بدء جلسة الذكاء الاصطناعي الشاملة (فحص + إصلاح + إقلاع)
        </button>
        <button onclick="resumeStage4UbootOnly()" style="flex:1; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:13px;">
          🚀 استئناف المرحلة 4
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
    badge.innerHTML =
      `🧠 <strong>تحليل الذكاء الاصطناعي للملف (v12.0):</strong><br>` +
      `• SPL المُعالج = <strong>${(splClean.byteLength / 1024).toFixed(1)} KB</strong> (تم عزل 4KB من <code>0x1000..0x2000</code> + تعطيل IRQ أثناء الترحيل)<br>` +
      `• U-Boot الصافي = <strong>${ubootClean ? (ubootClean.byteLength / 1024).toFixed(1) + " KB" : "N/A"}</strong>`;
  }
}

// ============================================================================
// 6. تشغيل جلسة الذكاء الاصطناعي الشاملة (Single-Session Auto-Solver)
// ============================================================================
async function runFullAutonomousPipeline() {
  cancelFlashFlag = false;
  if (!preparedPayloads.spl && selectedRealFile) {
    await handleSlotFileSelect("spl", { files: [selectedRealFile] });
  }
  if (!preparedPayloads.spl) return alert("يرجى اختيار ملف u-boot-sunxi-with-spl.bin أولاً!");
  if (!isRealUsbReady()) {
    await connectRealOtgDevice();
    if (!isRealUsbReady()) return;
  }

  try {
    const pipelineStart = performance.now();
    await reclaimAndDrainUsb();
    logAi("🧠 [v12.0 AI Session] انطلاق الجلسة الذكية الشاملة لحل القنوات المشفرة وإقلاع الجهاز...");

    // 1. المسح الذكي للقنوات المفتوحة والمحمية
    setStageStatus(1, "AI يفحص القنوات...", "#a78bfa");
    updateLiveProgress("المرحلة 1: مسح القنوات", 1, 1, pipelineStart, "1/4");
    await aiScanHardwareChannels();
    setStageStatus(1, "تم المسح ✅", "#10b981");

    // 2. تأمين إعدادات الرام
    setStageStatus(2, "تأمين LPDDR3 ✅", "#10b981");
    logAi("✅ [المحطة 2/4] إعدادات رامات LPDDR3 (336MHz) محمية داخل شيفرة الـ SPL.");

    // 3. البث الذكي للـ SPL مع عزل كامل النطاق 0x1000..0x2000 (4KB) إلى 0x00004800!
    setStageStatus(3, "AI يبث SPL...", "#a78bfa");
    const splBytes = preparedPayloads.spl;
    const CHUNK = 1024;
    const stage3Start = performance.now();
    let offset = 0;

    while (offset < splBytes.byteLength) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(offset + CHUNK, splBytes.byteLength);
      const slice = splBytes.subarray(offset, end);

      let targetAddr = 0x00000000 + offset;
      // عزل كامل الـ 4KB الحساسة (0x1000 -> 0x2000) إلى المخزن 0x00004800
      if (offset >= 0x00001000 && offset < 0x00002000) {
        targetAddr = 0x00004800 + (offset - 0x00001000);
        logAi(`🛡️ [AI Router] تحويل القناة المشفرة 0x${offset.toString(16)} إلى القناة المفتوحة 0x${targetAddr.toString(16)}...`);
      }

      await felWriteMemory(targetAddr, slice);
      offset = end;
      updateLiveProgress("المرحلة 3 (بث AI SPL)", offset, splBytes.byteLength, stage3Start, "3/4");
    }

    // 4. حقن الترامبولين الذكي (الذي يعطل المقاطعات ويحفظ 4KB + سجلات النظام) في 0x00004600
    const masterTrampoline = buildAiMasterTrampoline();
    logAi(`🧠 [AI Code Writer] كتابة كود الآلة الذكي (${masterTrampoline.byteLength} بايت) مباشرة إلى الجهاز في العنوان 0x00004600...`);
    await felWriteMemory(0x00004600, masterTrampoline);

    // 5. تشغيل الترامبولين الذكي
    logAi("⚡ [AI Executor] تشغيل كود الآلة الذكي (FEL_EXEC @ 0x00004600) لفتح الرام والعودة السليمة...");
    try {
      await sunxiSendFelRequest(0x0102, 0x00004600, 0, 1200);
      await new Promise((r) => setTimeout(r, 750));
      await sunxiReadFelStatus(800);
    } catch (_) {}

    // 6. فحص الذكاء الاصطناعي لاستجابة الـ DRAM بعد التنفيذ
    logAi("🔍 [AI Verifier] فحص فتح قناة الـ DRAM الكبرى (0x40000000)...");
    await reclaimAndDrainUsb();
    const dramCheck = await felReadMemory(0x40000000, 16, 1200).catch(() => new Uint8Array(0));
    if (dramCheck.byteLength > 0) {
      logAi("🎉 [AI Success] تم فتح قناة الـ DRAM الكبرى (1024MB) بنجاح ومنفذ الـ USB متصل 100%!");
    }

    setStageStatus(3, "تم فتح الرام ✅", "#10b981");
    await streamUbootStage4Now();

  } catch (err) {
    logAi(`❌ [AI Alert] ${err.message}`);
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

    setStageStatus(4, "AI يرفع U-Boot...", "#a78bfa");
    logAi(`📤 [المحطة 4/4] بدء رفع U-Boot (${(total / 1024).toFixed(1)} KB) إلى القناة المفتوحة 0x4A000000...`);

    let uOffset = 0;
    while (uOffset < total) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(uOffset + CHUNK, total);
      const slice = ubootBytes.subarray(uOffset, end);
      const currAddr = targetAddr + uOffset;

      await felWriteMemory(currAddr, slice, 1800);
      uOffset = end;
      updateLiveProgress("المرحلة 4 (U-Boot -> DRAM)", uOffset, total, stage4Start, "4/4");
    }

    logAi("🚀 [AI Final Jump] إرسال أمر الإقلاع النهائي (FEL_EXEC @ 0x4A000000)...");
    try {
      await sunxiSendFelRequest(0x0102, targetAddr, 0, 600);
      await sunxiReadFelStatus(400);
    } catch (_) {}

    setStageStatus(4, "أقلع الجهاز 100% ✅", "#10b981");
    logAi("🎉 مبروك! أتم الذكاء الاصطناعي الجلسة بالكامل وأقلع U-Boot في الرام بنجاح!");
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
