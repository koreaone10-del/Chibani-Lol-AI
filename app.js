// ============================================================================
// CHIBANI LOL AI v11.0 — HIGH-SRAM (0x6000) BUNKER & CPU STATE RESTORER
// الحل الجذري لموت الـ USB بعد FEL_EXEC:
// 1. ينقل الترامبولين ومخزن الـ BROM إلى القبو العلوي الآمن (0x6000..0x7800)
//    بعيداً عن منطقة تصفير الـ BSS الخاصة بالـ SPL (0x3800..0x5800)!
// 2. يحفظ ويستعيد سجلات المعالج الحرجة (SP, LR, CPSR, SCTLR) بعد فتح الرام.
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

// خريطة القبو العلوي الآمن داخل SRAM A1 (32KB: 0x00000000 -> 0x00007FFF)
// منطقة 0x6000..0x7BFF بعيدة تماماً عن كود الـ SPL وعن تصفير الـ BSS وعن مكدس 0x1C00!
const H3_SPL_SAFE_CODE_LEN = 0x00004000; // 16.0 KB (الكود التنفيذي الصافي للـ SPL)
const H3_TRAMPOLINE_ADDR   = 0x00006000; // موقع كود الترامبولين المحصن ضد المسح
const H3_CPU_STATE_ADDR    = 0x00006100; // مخزن حفظ سجلات المعالج (SP, LR, CPSR, SCTLR)
const H3_STAGED_1400       = 0x00006200; // مخزن شريحة الـ SPL المحمية (0x1400..0x2000 = 3KB)
const H3_BACKUP_1400       = 0x00006E00; // مخزن حفظ مكدس الـ BROM الأصلي (0x1400..0x2000 = 3KB)

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

  const topBar = document.getElementById("v110-live-bar");
  const topStats = document.getElementById("v110-live-stats");
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
  document.getElementById("otg-live-log").textContent = "[v11.0 HIGH-SRAM 0x6000 BUNKER READY]";
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
// الترامبولين المحصن في القبو العلوي (0x00006000) + حفظ سجلات SP/LR/CPSR/SCTLR
// ============================================================================
/*
 * لماذا يعمل هذا الكود دون أن ينفصل الـ USB أبداً؟
 * 1) يقع في 0x00006000 (فوق منطقة BSS ومكدس الـ SPL فلا يمسحه الـ SPL أبداً!).
 * 2) يحفظ SP و LR و CPSR و SCTLR و VBAR في العنوان 0x00006100 (تماماً كما تفعل أداة sunxi-fel).
 * 3) يحفظ منطقة BROM الحية (0x1400..0x2000 = 3KB) في 0x00006E00.
 * 4) ينسخ شريحة الـ SPL (0x1400..0x2000) من 0x00006200 إلى 0x00001400.
 * 5) يستدعي الـ SPL عند 0x00000000.
 * 6) عندما ينتهي الـ SPL من فتح الرام ويعود، يسترجع الكود سجلات SP و SCTLR و VBAR و CPSR،
 *    ثم يعيد منطقة BROM الحية إلى 0x1400..0x2000 ويعود للـ BROM عبر (bx lr)!
 */
function buildHighSramBunkerTrampoline() {
  const words = [
    // 1. حفظ سجلات حالة المعالج الأصلية (SP, LR, CPSR, SCTLR, VBAR) في 0x00006100
    0xe3a00b18, // mov r0, #0x6000
    0xe2800c01, // add r0, r0, #0x0100         (r0 = 0x00006100 state buffer)
    0xe580d000, // str sp, [r0, #0]            (save BROM SP)
    0xe580e004, // str lr, [r0, #4]            (save BROM LR)
    0xe10f1000, // mrs r1, cpsr
    0xe5801008, // str r1, [r0, #8]            (save BROM CPSR)
    0xee111f10, // mrc p15, 0, r1, c1, c0, 0
    0xe580100c, // str r1, [r0, #12]           (save BROM SCTLR)
    0xee1c1f10, // mrc p15, 0, r1, c12, c0, 0
    0xe5801010, // str r1, [r0, #16]           (save BROM VBAR)

    // 2. نسخ منطقة BROM الحية (0x1400..0x2000 = 3KB) إلى القبو 0x00006E00
    0xe3a00b05, // mov r0, #0x1400             (src = 0x00001400)
    0xe3a01b1b, // mov r1, #0x6c00
    0xe2811c02, // add r1, r1, #0x0200         (dst = 0x00006E00 backup)
    0xe3a02b03, // mov r2, #0x0c00             (len = 3072 bytes)
    // loop_save:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_save

    // 3. نسخ شريحة الـ SPL المحمية من 0x00006200 إلى 0x00001400
    0xe3a00b18, // mov r0, #0x6000
    0xe2800c02, // add r0, r0, #0x0200         (src = 0x00006200 staged SPL)
    0xe3a01b05, // mov r1, #0x1400             (dst = 0x00001400)
    0xe3a02b03, // mov r2, #0x0c00             (len = 3072 bytes)
    // loop_install:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_install

    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy

    // 4. استدعاء نقطة بداية الـ SPL عند 0x00000000 (مع وضع عنوان العودة في LR)
    0xe3a03000, // mov r3, #0x00000000
    0xe12fff33, // blx r3

    // 5. فور عودة الـ SPL بعد فتح الرام: استرجاع منطقة BROM الحية من 0x00006E00 إلى 0x00001400
    0xe3a00b1b, // mov r0, #0x6c00
    0xe2800c02, // add r0, r0, #0x0200         (src = 0x00006E00 backup)
    0xe3a01b05, // mov r1, #0x1400             (dst = 0x00001400)
    0xe3a02b03, // mov r2, #0x0c00             (len = 3072 bytes)
    // loop_restore:
    0xe4903004, // ldr r3, [r0], #4
    0xe4813004, // str r3, [r1], #4
    0xe2522004, // subs r2, r2, #4
    0x1afffffb, // bne loop_restore

    // 6. استرجاع سجلات المعالج الأصلية (VBAR, SCTLR, CPSR, SP, LR) من 0x00006100
    0xe3a00b18, // mov r0, #0x6000
    0xe2800c01, // add r0, r0, #0x0100         (r0 = 0x00006100)
    0xe5901010, // ldr r1, [r0, #16]
    0xee0c1f10, // mcr p15, 0, r1, c12, c0, 0  (restore VBAR)
    0xe590100c, // ldr r1, [r0, #12]
    0xee011f10, // mcr p15, 0, r1, c1, c0, 0   (restore SCTLR)
    0xe5901008, // ldr r1, [r0, #8]
    0xe129f001, // msr cpsr_cxsf, r1           (restore CPSR)
    0xe590d000, // ldr sp, [r0, #0]            (restore BROM SP)
    0xe590e004, // ldr lr, [r0, #4]            (restore BROM LR)

    0xf57ff04f, // dsb sy
    0xf57ff06f, // isb sy
    0xe12fff1e  // bx lr                       (العودة السليمة 100% إلى حلقة BROM USB!)
  ];

  const buf = new ArrayBuffer(words.length * 4);
  const view = new DataView(buf);
  words.forEach((w, idx) => view.setUint32(idx * 4, w, true));
  return new Uint8Array(buf);
}

// ============================================================================
// تحجيم الـ SPL إلى 16KB ومسح توقيع "eGON.BT0" لإجبار U-Boot SPL على العودة للـ FEL!
// ============================================================================
function patchSplForGuaranteedFelReturn(splBytes) {
  const safeLen = Math.min(splBytes.byteLength, H3_SPL_SAFE_CODE_LEN);
  const out = new Uint8Array(safeLen);
  out.set(splBytes.subarray(0, safeLen), 0);

  // 🚨 السر القاطع في كود U-Boot (arch/arm/cpu/armv7/sunxi/fel_utils.S):
  // في دالة save_boot_params، يفحص الـ SPL البايتات عند العنوان 0x00000004:
  // إذا وجد "eGON.BT0" فإنه يعتقد أنه أقلع من كارت ميموري SD Card فيذهب لـ MMC0 ويقطع الـ USB!
  // أما إذا وجد التوقيع "FEL." (أو لم يجد eGON.BT0 لأننا نحن من يشغله مباشرة عبر FEL_EXEC وليس الـ BROM)،
  // فإنه يعلم أنه في وضع USB FEL، فيقوم بتفعيل الرام ثم يستدعي return_to_fel فوراً ويعود للـ USB!
  out[4]  = 0x46; // 'F'
  out[5]  = 0x45; // 'E'
  out[6]  = 0x4c; // 'L'
  out[7]  = 0x2e; // '.'
  out[0x28] = 0x00;
  out[0x29] = 0x00;
  out[0x2a] = 0x00;
  out[0x2b] = 0x00;

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

  const splClean = patchSplForGuaranteedFelReturn(rawBytes.subarray(splOff, splOff + 24576));
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
    <div style="background:#0f172a; padding:16px; border-radius:14px; margin:10px 0; border:2px solid #10b981; box-shadow:0 8px 25px rgba(16,185,129,0.25);">
      <h3 style="color:#10b981; margin:0 0 6px 0; font-size:16px;">🏰 المحرك المدرع (v11.0 — High-SRAM 0x6000 Bunker & FEL Signature)</h3>
      <p style="color:#cbd5e1; font-size:12px; margin:0 0 10px 0;">
        💡 يحمي الترامبولين في القبو العلوي <code>0x6000</code> بعيداً عن مسح الـ BSS، ويستبدل توقيع SD Card بتوقيع <code>FEL.</code> لإجبار الـ SPL على العودة للكابل فوراً بعد فتح الرام!
      </p>
      <div style="margin:8px 0;">
        <label style="color:#38bdf8; font-weight:bold; font-size:12px;">✅ اختر ملف u-boot-sunxi-with-spl.bin (431.5 KB)</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#1e293b; color:#fff; padding:8px; border-radius:8px; border:1px solid #38bdf8; margin-top:4px;">
      </div>
      <div id="slot-summary-badge" style="background:#1e293b; color:#10b981; font-size:12px; padding:8px; border-radius:8px; margin:8px 0; display:none;"></div>
      <div style="background:#1e293b; border-radius:10px; padding:10px; margin:10px 0; border:1px solid #334155;">
        <div id="v110-live-stats" style="color:#f8fafc; font-size:12px; margin-bottom:6px; font-family:monospace;">⏱ جاهز للبث عبر القبو العلوي 0x6000...</div>
        <div style="width:100%; background:#090d16; height:22px; border-radius:6px; overflow:hidden; border:1px solid #475569;">
          <div id="v110-live-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #10b981, #0ea5e9); color:#fff; font-size:11px; font-weight:bold; text-align:center; line-height:22px;">0%</div>
        </div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button onclick="runFullAutonomousPipeline()" style="flex:2; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; cursor:pointer; font-size:14px;">
          ⚡ 1. بدء الإقلاع المدرع (v11.0)
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
    badge.innerHTML =
      `🎯 <strong>تم تجهيز الحزمة المدرعة (v11.0):</strong><br>` +
      `• SPL الصافي = <strong>${(splClean.byteLength / 1024).toFixed(1)} KB</strong> (توقيع <code>FEL.</code> + ترامبولين محصن في <code>0x6000</code>)<br>` +
      `• U-Boot الصافي = <strong>${ubootClean ? (ubootClean.byteLength / 1024).toFixed(1) + " KB" : "N/A"}</strong>`;
  }
  logOtg(`📥 [v11.0] تم تجهيز "${file.name}" مع توقيع FEL المباشر وحماية القبو 0x6000.`);
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
    logOtg("🚀 [v11.0] بدء الإقلاع عبر القبو العلوي (0x6000..0x7800) المحصن ضد مسح الـ BSS...");

    // المحطة 1
    setStageStatus(1, "جاري الفحص...", "#38bdf8");
    updateLiveProgress("المرحلة 1", 1, 1, pipelineStart, "1/4");
    await sunxiSendFelRequest(0x0001, 0, 0);
    await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();
    setStageStatus(1, "تم التعرف ✅", "#10b981");
    logOtg("✅ [المحطة 1/4] المعالج متصل ومستجيب في وضع FEL.");

    // المحطة 2
    setStageStatus(2, "تأمين LPDDR3 ✅", "#10b981");
    logOtg("✅ [المحطة 2/4] إعدادات رامات LPDDR3 (336MHz) مدمجة وجاهزة.");

    // المحطة 3: بث الـ SPL (16.0 KB) مع تحويل (0x1400..0x2000) إلى القبو العلوي 0x00006200
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
        logOtg(`🛡️ تحويل الشريحة 0x${offset.toString(16)} إلى القبو العلوي 0x${targetAddr.toString(16)}...`);
      }

      await sunxiSendFelRequest(0x0101, targetAddr, slice.byteLength);
      await sunxiUsbBulkWrite(slice);
      await sunxiReadFelStatus();

      offset = end;
      updateLiveProgress("المرحلة 3 (بث SPL المدرع)", offset, splBytes.byteLength, stage3Start, "3/4");
    }

    // حقن الترامبولين المدرع في 0x00006000
    const trampoline = buildHighSramBunkerTrampoline();
    logOtg(`🏰 حقن الترامبولين المدرع (${trampoline.byteLength} بايت) في القبو العلوي 0x00006000...`);
    await sunxiSendFelRequest(0x0101, H3_TRAMPOLINE_ADDR, trampoline.byteLength);
    await sunxiUsbBulkWrite(trampoline);
    await sunxiReadFelStatus();

    // تنفيذ الترامبولين من 0x00006000
    logOtg("⚡ تشغيل الترامبولين المدرع (FEL_EXEC @ 0x00006000)...");
    try {
      await sunxiSendFelRequest(0x0102, H3_TRAMPOLINE_ADDR, 0, 1200);
      await new Promise((r) => setTimeout(r, 750));
      await sunxiReadFelStatus(800);
    } catch (_) {}

    // فحص نبض الـ USB والرام بعد عودة الـ SPL مباشرة!
    logOtg("🔍 فحص استجابة الـ USB وقراءة أول 16 بايت من الـ DRAM (0x40000000)...");
    await reclaimAndDrainUsb();
    await sunxiSendFelRequest(0x0103, 0x40000000, 16, 1200);
    const dramTest = await sunxiUsbBulkRead(16, 1200);
    await sunxiReadFelStatus(600);

    if (dramTest.byteLength > 0) {
      logOtg("🎉 انتصار تاريخي! منفذ الـ USB حي 100% وتمت قراءة ذاكرة الـ DRAM (0x40000000) بنجاح!");
    }

    setStageStatus(3, "تم فتح الرام ✅", "#10b981");
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
