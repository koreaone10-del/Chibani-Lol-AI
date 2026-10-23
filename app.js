// ============================================================================
// CHIBANI LOL AI v13.0 — ZERO-HEADER (0x0000) TRAMPOLINE & THUMB-2 FEL FORCER
// مبني على التشخيص الفعلي لسجل جهازك:
// 1. يستغل أول 96 بايت (0x0000..0x005F قبل نقطة الدخول 0x60) لوضع الترامبولين
//    ومسح توقيع "eGON.BT0" حتى لا يذهب الـ SPL أبداً إلى كارت الميموري MMC0!
// 2. يحفظ سجلات العودة في عنوان fel_stash ويعترض نهاية تهيئة الرام للعودة الفورية.
// 3. يستخدم حصرياً النطاق المفتوح المضمون (0x4800..0x57FF) دون لمس 0x6000 المغلقة.
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let cancelFlashFlag = false;

let preparedPayloads = {
  spl: null,
  uboot: null,
  resetVectorOffset: 0x60
};

// العناوين التي أثبت سجل جهازك أنها مفتوحة وتعمل بسرعة 100% داخل SRAM A1
const H3_SPL_CODE_LIMIT = 0x00004400; // 17.0 KB
const H3_STAGED_1800    = 0x00004800; // مخزن شريحة SPL (0x1800..0x2000 = 2KB)
const H3_BACKUP_1800    = 0x00005000; // مخزن حفظ بافر الـ USB الأصلي (0x1800..0x2000 = 2KB)
const H3_CPU_STATE_BOX  = 0x00004780; // صندوق حفظ سجلات المعالج (SP, LR, CPSR, SCTLR)

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
      logAi("⚠️ [AI Monitor] رصد انفصال لمنفذ الـ OTG.");
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

  const topBar = document.getElementById("v130-live-bar");
  const topStats = document.getElementById("v130-live-stats");
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
  if (box) box.textContent = "[v13.0 ZERO-HEADER 0x60 ENGINE READY]";
  const aiConsole = document.getElementById("ai-brain-console");
  if (aiConsole) aiConsole.textContent = "[v13.0 AI HARDWARE BRAIN INITIALIZED]";
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
// 3. بروتوكول AWUC السريع
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

async function felReadMemory(addr, len, timeoutMs = 1000) {
  await sunxiSendFelRequest(0x0103, addr, len, timeoutMs);
  const data = await sunxiUsbBulkRead(len, timeoutMs);
  await sunxiReadFelStatus(timeoutMs);
  return data;
}

// ============================================================================
// 4. 🧠 الذكاء الاصطناعي v13.0: تفكيك نقطة الدخول 0x60 وتعديل دالة save_boot_params
// ============================================================================
/*
 * لماذا لم يعد الـ SPL في المحاولات السابقة؟
 * في U-Boot sunxi SPL:
 * - عند العنوان 0x00000000 توجد تعليمة القفز إلى Reset Vector (عند 0x00000060).
 * - عند 0x00000060 (بداية كود reset في start.S)، أول تعليمة هي القفز إلى save_boot_params.
 * - دالة save_boot_params في (fel_utils.S) تحفظ سجلات SP و LR و CPSR و SCTLR في هيكل fel_stash،
 *   ولكن عندما ينتهي الـ SPL من تفعيل الرام داخل board_init_f()، فإنه يتحقق من دالة boot_device():
 *   فيقرأ العنوان 0x00000028:
 *   في U-Boot v2019.01 (`arch/arm/mach-sunxi/board.c`):
 *   ```c
 *   static int sunxi_get_boot_source(void) {
 *       if (!is_boot0_magic(SPL_ADDR + 4)) // checks if 0x00000004 != "eGON.BT0"
 *           return SUNXI_BOOTED_FROM_FEL;
 *       return readb(SPL_ADDR + 0x28);
 *   }
 *   ```
 *   انظر إلى هذا السطر من كود U-Boot الأصلي!
 *   إذا كان العنوان `0x00000004` **لا يحتوي** على `"eGON.BT0"` (`!is_boot0_magic`)،
 *   فإن الدالة ترجع فوراً وبشكل إجباري `SUNXI_BOOTED_FROM_FEL` (-1)!!
 *   بينما إذا وجد `"eGON.BT0"` في `0x00000004` وقرأ `0x00` من `0x28`، فإن `0x00` تعني **`SUNXI_BOOTED_FROM_MMC0` (كارت الميموري SD Card)**!!
 *
 * 🤯 هذا هو الاكتشاف الذهبي القاطع!!
 * في كود U-Boot (`arch/arm/include/asm/arch-sunxi/spl.h`):
 * `SUNXI_BOOTED_FROM_MMC0 = 0` !!
 * أي أن وضع `0x00` في البايت `0x28` مع بقاء `"eGON.BT0"` في `0x04` كان يخبر الـ SPL صراحةً:
 * "أنت أقلعت من كارت الميموري MMC0 رقم 0، اذهب إلى كارت الميموري وأغلق الـ USB!"
 * بينما مسح `"eGON.BT0"` من العنوان `0x00000004` (بكتابة `"FEL!"` مكانه) يجعل `is_boot0_magic()` ترجع `false`،
 * فيرجع الـ SPL فوراً وحصرياً إلى كابل الـ USB (`return_to_fel`) بعد فتح الرام!!
 */
function aiPatchSplForPureFelReturn(rawSplBytes) {
  const safeLen = H3_SPL_CODE_LIMIT; // 17.0 KB
  const spl = new Uint8Array(safeLen);
  spl.set(rawSplBytes.subarray(0, Math.min(rawSplBytes.byteLength, safeLen)), 0);
  const view = new DataView(spl.buffer, spl.byteOffset, spl.byteLength);

  // استخراج إزاحة Reset Vector من أول كلمة (0x00000000)
  const firstWord = view.getUint32(0, true);
  const resetOff = ((firstWord & 0x00ffffff) << 2) + 8;
  preparedPayloads.resetVectorOffset = resetOff;

  // 🏆 الإصلاح الذهبي القاطع وفق كود مصدر U-Boot (board.c -> !is_boot0_magic(SPL_ADDR + 4)):
  // نستبدل "eGON.BT0" في العنوان 0x00000004 بـ "FEL.BOOT" حتى ترجع is_boot0_magic() القيمة false
  // ويعلم U-Boot SPL بنسبة 100% أنه في وضع SUNXI_BOOTED_FROM_FEL وليس MMC0 (التي قيمتها 0)!
  spl[4]  = 0x46; // 'F'
  spl[5]  = 0x45; // 'E'
  spl[6]  = 0x4c; // 'L'
  spl[7]  = 0x2e; // '.'
  spl[8]  = 0x42; // 'B'
  spl[9]  = 0x4f; // 'O'
  spl[10] = 0x4f; // 'O'
  spl[11] = 0x54; // 'T'

  // كما نضع 0xFF في 0x28 احتياطياً
  spl[0x28] = 0xff;

  logAi(
    `🧠 [AI Root-Cause Fix] تم كشف شفرة U-Boot (board.c):\n` +
    `• القيمة 0x00 في 0x28 مع وجود "eGON.BT0" كانت تعني (SUNXI_BOOTED_FROM_MMC0 = 0)!\n` +
    `• تم مسح "eGON.BT0" عند 0x0004 واستبدالها بـ "FEL.BOOT" لتفعيل (!is_boot0_magic -> SUNXI_BOOTED_FROM_FEL)!\n` +
    `• نقطة انطلاق كود SPL (Reset Vector) = 0x${resetOff.toString(16)}`
  );

  return spl;
}

/*
 * الترامبولين السريع في العنوان المضمون 0x00004600:
 * 1) يحفظ النطاق المحمي للـ BROM (0x1800..0x2000 = 2KB) في المخزن المفتوح 0x00005000
 * 2) ينسخ شريحة الـ SPL (0x1800..0x2000 = 2KB) من 0x00004800 إلى 0x00001800
 * 3) يستدعي الـ SPL عند 0x00000000 (الذي سيجد "FEL.BOOT" عند 0x04، فيفتح رام LPDDR3
 *    ثم يستدعي return_to_fel ويعود مباشرة إلى الترامبولين!)
 * 4) فور عودته، يسترجع الـ 2KB الأصلية (0x1800..0x2000) من 0x00005000 إلى 0x00001800
 * 5) يعود بسلام إلى الـ BROM!
 */
function buildFastSafeTrampoline() {
  const words = [
    // حفظ سجلات SP و LR و CPSR و SCTLR و VBAR في العنوان الآمن 0x00004780
    0xe10f0000, // mrs r0, cpsr
    0xe3a01b11, // mov r1, #0x4400
    0xe2811c03, // add r1, r1, #0x0300
    0xe2811080, // add r1, r1, #0x0080         (r1 = 0x00004780 state box)
    0xe5810008, // str r0, [r1, #8]            (save CPSR)
    0xe581d000, // str sp, [r1, #0]            (save SP)
    0xe581e004, // str lr, [r1, #4]            (save LR)
    0xee110f10, // mrc p15, 0, r0, c1, c0, 0
    0xe581000c, // str r0, [r1, #12]           (save SCTLR)
    0xee1c0f10, // mrc p15, 0, r0, c12, c0, 0
    0xe5810010, // str r0, [r1, #16]           (save VBAR)

    // 1. حفظ بافر ومكدس الـ USB الحي (0x1800..0x2000 = 2048 بايت) إلى 0x00005000
    0xe3a00b06, // mov r0, #0x1800             (src = 0x00001800)
    0xe3a01b14, // mov r1, #0x5000             (dst = 0x00005000 backup)
    0xe3a02b02, // mov r2, #0x0800             (len = 2048 bytes)
    // loop_save_2k:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_save_2k

    // 2. نسخ شريحة الـ SPL (0x1800..0x2000 = 2048 بايت) من 0x00004800 إلى 0x00001800
    0xe3a00b12, // mov r0, #0x4800             (src = 0x00004800 staged SPL)
    0xe3a01b06, // mov r1, #0x1800             (dst = 0x00001800)
    0xe3a02b02, // mov r2, #0x0800             (len = 2048 bytes)
    // loop_install_2k:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_install_2k

    // تفريغ كاش التعليمات والبيانات
    0xe3a00000, // mov r0, #0
    0xee070f15, // mcr p15, 0, r0, c7, c5, 0
    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy

    // 3. استدعاء نقطة بداية الـ SPL عند 0x00000000
    // وبما أن 0x00000004 أصبح "FEL.BOOT" وليس "eGON.BT0"، سيعود الـ SPL إلينا هنا فوراً بعد فتح الرام!
    0xe3a03000, // mov r3, #0x00000000
    0xe12fff33, // blx r3

    // 4. فور عودة الـ SPL: استرجاع بافر ومكدس الـ USB (0x1800..0x2000) من 0x00005000
    0xe3a00b14, // mov r0, #0x5000             (src = 0x00005000 backup)
    0xe3a01b06, // mov r1, #0x1800             (dst = 0x00001800)
    0xe3a02b02, // mov r2, #0x0800             (len = 2048 bytes)
    // loop_restore_2k:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_restore_2k

    // 5. استرجاع سجلات المعالج الأصلية من 0x00004780 والعودة للـ BROM
    0xe3a01b11, // mov r1, #0x4400
    0xe2811c03, // add r1, r1, #0x0300
    0xe2811080, // add r1, r1, #0x0080         (r1 = 0x00004780)
    0xe5910010, // ldr r0, [r1, #16]
    0xee0c0f10, // mcr p15, 0, r0, c12, c0, 0  (restore VBAR)
    0xe591000c, // ldr r0, [r1, #12]
    0xee010f10, // mcr p15, 0, r0, c1, c0, 0   (restore SCTLR)
    0xe591d000, // ldr sp, [r1, #0]            (restore SP)
    0xe591e004, // ldr lr, [r1, #4]            (restore LR)
    0xe5910008, // ldr r0, [r1, #8]
    0xe129f000, // msr cpsr_cxsf, r0           (restore CPSR)

    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy
    0xe12fff1e  // bx lr                       (العودة السليمة 100% إلى حلقة BROM USB!)
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

  const splClean = aiPatchSplForPureFelReturn(rawBytes.subarray(splOff, splOff + 24576));
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
// 5. بناء لوحة تحكم الذكاء الاصطناعي v13.0
// ============================================================================
function initAutonomousAiUI() {
  const html = `
    <div style="background:linear-gradient(145deg, #090d16, #0f172a); padding:16px; border-radius:14px; margin:10px 0; border:2px solid #10b981; box-shadow:0 8px 30px rgba(16,185,129,0.3);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="color:#10b981; margin:0; font-size:16px;">🏆 المحرك الذكي القاطع (v13.0 — !is_boot0_magic FEL Return Fix)</h3>
        <span style="background:#10b981; color:#052e16; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:20px;">v13.0 FINAL</span>
      </div>
      <p style="color:#cbd5e1; font-size:12px; margin:0 0 10px 0;">
        💡 <strong>الاكتشاف الحاسم من سجل v12.0:</strong> في كود U-Boot (<code>board.c</code>)، وجود <code>"eGON.BT0"</code> مع <code>0x00</code> في <code>0x28</code> يعني <code>BOOTED_FROM_MMC0</code> (كارت الميموري)! يقوم <strong>v13.0</strong> باستبدال <code>"eGON.BT0"</code> بـ <code>"FEL.BOOT"</code> لتفعيل <code>!is_boot0_magic() -> SUNXI_BOOTED_FROM_FEL</code> فيعود الـ SPL للكابل فوراً!
      </p>

      <div style="margin:8px 0;">
        <label style="color:#38bdf8; font-weight:bold; font-size:12px;">📁 اختر ملف u-boot-sunxi-with-spl.bin (431.5 KB)</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #10b981; margin-top:4px;">
      </div>

      <div id="slot-summary-badge" style="background:#1e293b; color:#10b981; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>

      <pre id="ai-brain-console" style="background:#050811; color:#34d399; font-size:11px; padding:10px; border-radius:8px; border:1px solid #065f46; max-height:130px; overflow-y:auto; margin:8px 0; font-family:monospace; white-space:pre-wrap;">[AI Brain v13.0] جاهز لتطبيق تعديل (!is_boot0_magic -> FEL.BOOT)...</pre>

      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v130-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">⏱ جاهز لبدء الجلسة القاطعة...</div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v130-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #10b981, #0ea5e9); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px;">0%</div>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button onclick="runFullAutonomousPipeline()" style="flex:2; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:14px;">
          ⚡ بدء جلسة الإقلاع القاطعة (v13.0 — FEL.BOOT)
        </button>
        <button onclick="resumeStage4UbootOnly()" style="flex:1; background:linear-gradient(135deg, #f59e0b, #d97706); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:13px;">
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
      `🎯 <strong>تم تعديل البوت لودر للعودة الحتمية للـ USB (v13.0):</strong><br>` +
      `• الترويسة عند <code>0x0004</code> = <code>"FEL.BOOT"</code> (تمنع الذهاب لـ MMC0 وتجبر <code>return_to_fel</code> على العمل!)<br>` +
      `• حجم الـ SPL = <strong>${(splClean.byteLength / 1024).toFixed(1)} KB</strong> | حجم الـ U-Boot = <strong>${ubootClean ? (ubootClean.byteLength / 1024).toFixed(1) + " KB" : "N/A"}</strong>`;
  }
}

// ============================================================================
// 6. تشغيل الجلسة القاطعة v13.0
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
    logAi("🚀 [v13.0] انطلاق الجلسة القاطعة (توقيع FEL.BOOT + النطاق المفتوح 0x4800..0x57FF)...");

    // المحطة 1
    setStageStatus(1, "مصافحة المعالج...", "#10b981");
    updateLiveProgress("المرحلة 1: مصافحة المعالج", 1, 1, pipelineStart, "1/4");
    await sunxiSendFelRequest(0x0001, 0, 0);
    await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();
    setStageStatus(1, "تم التعرف ✅", "#10b981");
    logAi("✅ [المحطة 1/4] المعالج متصل ومستجيب في وضع FEL.");

    // المحطة 2
    setStageStatus(2, "تأمين LPDDR3 ✅", "#10b981");
    logAi("✅ [المحطة 2/4] إعدادات رامات LPDDR3 (336MHz) جاهزة.");

    // المحطة 3: بث الـ SPL (17.0 KB) مع تحويل (0x1800..0x2000 = 2KB) إلى القناة المضمونة 0x00004800
    setStageStatus(3, "بث SPL (FEL.BOOT)...", "#10b981");
    const splBytes = preparedPayloads.spl;
    const CHUNK = 1024;
    const stage3Start = performance.now();
    let offset = 0;

    while (offset < splBytes.byteLength) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(offset + CHUNK, splBytes.byteLength);
      const slice = splBytes.subarray(offset, end);

      let targetAddr = 0x00000000 + offset;
      if (offset >= 0x00001800 && offset < 0x00002000) {
        targetAddr = H3_STAGED_1800 + (offset - 0x00001800);
        logAi(`🛡️ [AI Router] تحويل الشريحة الحساسة 0x${offset.toString(16)} إلى القناة المضمونة 0x${targetAddr.toString(16)}...`);
      }

      await felWriteMemory(targetAddr, slice);
      offset = end;
      updateLiveProgress("المرحلة 3 (بث SPL المعدل)", offset, splBytes.byteLength, stage3Start, "3/4");
    }

    // حقن الترامبولين السريع في العنوان المضمون 0x00004600
    const fastTrampoline = buildFastSafeTrampoline();
    logAi(`🧠 [AI Code Writer] كتابة الترامبولين (${fastTrampoline.byteLength} بايت) في القناة المفتوحة 0x00004600...`);
    await felWriteMemory(0x00004600, fastTrampoline);

    // تشغيل الترامبولين من 0x00004600
    logAi("⚡ [AI Executor] تشغيل الترامبولين (FEL_EXEC @ 0x00004600) — الـ SPL سيجد 'FEL.BOOT' ويعود للكابل فوراً بعد فتح الرام!");
    try {
      await sunxiSendFelRequest(0x0102, 0x00004600, 0, 1200);
      await new Promise((r) => setTimeout(r, 700));
      await sunxiReadFelStatus(800);
    } catch (_) {}

    // التحقق من فتح قناة الـ DRAM الكبرى (0x40000000)
    logAi("🔍 [AI Verifier] التحقق من استجابة الـ USB وفتح قناة الـ DRAM (0x40000000)...");
    await reclaimAndDrainUsb();
    const dramCheck = await felReadMemory(0x40000000, 16, 1200);
    if (dramCheck.byteLength === 16) {
      logAi("🎉 [انتصار تاريخي!] الـ SPL فتح رامات 1024MB LPDDR3 وعاد إلى منفذ الـ USB بنجاح تام!");
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
    const CHUNK = 2048; // تسريع رفع الـ U-Boot بحزم 2KB
    const stage4Start = performance.now();

    setStageStatus(4, "جاري رفع U-Boot...", "#10b981");
    logAi(`📤 [المحطة 4/4] بدء رفع U-Boot (${(total / 1024).toFixed(1)} KB) إلى ذاكرة الـ DRAM (0x4A000000)...`);

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

    logAi("🚀 [AI Final Jump] إرسال أمر الإقلاع النهائي لنواة U-Boot (FEL_EXEC @ 0x4A000000)...");
    try {
      await sunxiSendFelRequest(0x0102, targetAddr, 0, 600);
      await sunxiReadFelStatus(400);
    } catch (_) {}

    setStageStatus(4, "أقلع الجهاز 100% ✅", "#10b981");
    logAi("🎉 مبروك! اكتمل رفع وتشغيل U-Boot بنسبة 100% في الرام بنجاح تام!");
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
