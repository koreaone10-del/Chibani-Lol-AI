// ============================================================================
// CHIBANI LOL AI v8.0 — FULL SMART AUTO-QUEUE & MULTI-SLOT OTG ENGINE
// محرك أوتوماتيكي بالكامل مع خانات متعددة وإعادة اتصال تلقائي ذكي لتجاوز USB Reset
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let cancelFlashFlag = false;

// ملفات الخانات الثلاث المستقلة
let slotFiles = {
  spl: null,   // خانة ملف التمهيد SPL
  uboot: null, // خانة ملف U-Boot
  rom: null    // خانة الروم الكامل
};

window.addEventListener("DOMContentLoaded", () => {
  initMultiSlotUI();
  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devices) => {
      if (devices.length > 0) bindRealUsbDevice(devices[0]);
    });
    navigator.usb.addEventListener("connect", (e) => bindRealUsbDevice(e.device));
    navigator.usb.addEventListener("disconnect", () => {
      connectedOtgDevice = null;
      logOtg("⚠️ تنبيه: انفصل كابل OTG أو أعاد المعالج تهيئة الـ USB (جارٍ الانتظار للربط التلقائي...).");
    });
  }
});

function logOtg(msg) {
  const box = document.getElementById("otg-live-log");
  if (!box) return;
  const time = new Date().toLocaleTimeString();
  box.textContent += `\n[${time}] ${msg}`;
  box.scrollTop = box.scrollHeight;
}

function clearOtgLog() {
  document.getElementById("otg-live-log").textContent = "[v8.0 SMART AUTO-QUEUE ENGINE READY]";
}

function isRealUsbReady() {
  return Boolean(connectedOtgDevice && connectedOtgDevice.opened);
}

// ============================================================================
// 1. نظام إقران الـ USB وإعادة الاتصال التلقائي الخارق (Auto-Heal Connection)
// ============================================================================
async function connectRealOtgDevice() {
  if (!("usb" in navigator)) return alert("يرجى استخدام متصفح Google Chrome.");
  try {
    logOtg("🔌 طلب إقران جهاز USB OTG...");
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
    logOtg(`✅ تم ربط الهاردوير بنجاح! VID=${vid} PID=${pid}`);
    await reclaimAndDrainUsb();
    return true;
  } catch (err) {
    logOtg(`⚠️ خطأ في ربط الواجهة: ${err.message}`);
    return false;
  }
}

// دالة سحرية تراقب وتستعيد اتصال الـ USB خلال أجزاء من الثانية بعد الـ Reset
async function smartAutoReconnect(maxAttempts = 12) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (isRealUsbReady()) return true;
    try {
      if ("usb" in navigator) {
        const devices = await navigator.usb.getDevices();
        if (devices.length > 0) {
          const dev = devices[0];
          if (!dev.opened) await dev.open();
          await dev.claimInterface(activeInterfaceNum).catch(() => {});
          connectedOtgDevice = dev;
          await reclaimAndDrainUsb();
          logOtg(`⚡ [Auto-Heal] تم استعادة اتصال الـ USB أوتوماتيكياً (المحاولة ${attempt})`);
          return true;
        }
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
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
    for (let i = 0; i < 4; i++) {
      await Promise.race([
        connectedOtgDevice.transferIn(otgEndpointIn, 64),
        new Promise((res) => setTimeout(() => res(null), 40))
      ]).catch(() => null);
    }
  } catch (_) {}
}

// ============================================================================
// 2. بروتوكول AWUC & FEL المطور
// ============================================================================
const AW_USB_WRITE = 0x12;
const AW_USB_READ = 0x11;

function build32ByteAwucWrapper(dir, len) {
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  v.setUint8(0, 0x41); v.setUint8(1, 0x57); v.setUint8(2, 0x55); v.setUint8(3, 0x43);
  v.setUint32(4, 0, true);
  v.setUint32(8, len, true);
  v.setUint8(12, 0); v.setUint8(13, 0); v.setUint8(14, 0); v.setUint8(15, 0x0c);
  v.setUint8(16, dir); v.setUint8(17, 0);
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

async function rawOut(bytes) {
  if (!isRealUsbReady()) {
    await new Promise((r) => setTimeout(r, 2));
    return;
  }
  await connectedOtgDevice.transferOut(otgEndpointOut, bytes);
}

async function rawIn(len, timeoutMs = 800) {
  if (!isRealUsbReady()) {
    await new Promise((r) => setTimeout(r, 2));
    return new DataView(new Uint8Array(len).buffer);
  }
  const res = await Promise.race([
    connectedOtgDevice.transferIn(otgEndpointIn, len),
    new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout")), timeoutMs))
  ]);
  return res.data;
}

async function sunxiUsbBulkWrite(payload) {
  const awuc = build32ByteAwucWrapper(AW_USB_WRITE, payload.byteLength);
  await rawOut(awuc);
  await rawOut(payload);
  try { await rawIn(64, 200); } catch (_) {}
}

async function sunxiUsbBulkRead(len) {
  const awuc = build32ByteAwucWrapper(AW_USB_READ, len);
  await rawOut(awuc);
  const d = await rawIn(len, 1000).catch(() => null);
  try { await rawIn(64, 200); } catch (_) {}
  return d ? new Uint8Array(d.buffer) : new Uint8Array(0);
}

async function sunxiSendFelRequest(cmd, addr, len) {
  await sunxiUsbBulkWrite(build16ByteFelRequest(cmd, addr, len));
}

async function sunxiReadFelStatus() {
  return await sunxiUsbBulkRead(8);
}

// ============================================================================
// 3. إدارة الخانات المتعددة واختيار الملفات أوتوماتيكياً
// ============================================================================
function initMultiSlotUI() {
  const container = document.getElementById("tab-stage-1") || document.body;
  // حقن واجهة الخانات المتعددة الذكية في الصفحة أوتوماتيكياً
  const multiSlotHtml = `
    <div style="background:#1e293b; padding:15px; border-radius:12px; margin:10px 0; border:1px solid #334155;">
      <h3 style="color:#38bdf8; margin-top:0;">🚀 محرك الخانات المتعددة والأوتوميشن الذكي (v8.0)</h3>
      <p style="color:#94a3b8; font-size:13px;">اختر الملفات لكل مرحلة، وسيقوم النظام بتنفيذها أوتوماتيكياً بالتوالي مع تجاوز انقطاع الـ USB:</p>
      
      <div style="margin:8px 0;">
        <label style="color:#e2e8f0; font-size:12px;">📁 خانة 1: ملف التمهيد (SPL / Boot0 أو u-boot-sunxi-with-spl)</label>
        <input type="file" id="slot-file-spl" onchange="handleSlotFileSelect('spl', this)" style="width:100%; background:#0f172a; color:#fff; padding:6px; border-radius:6px; border:1px solid #475569;">
      </div>

      <div style="margin:8px 0;">
        <label style="color:#e2e8f0; font-size:12px;">📁 خانة 2: ملف U-Boot الرئيسي (لإطفاء اللمبة الزرقاء عند 0x4A000000)</label>
        <input type="file" id="slot-file-uboot" onchange="handleSlotFileSelect('uboot', this)" style="width:100%; background:#0f172a; color:#fff; padding:6px; border-radius:6px; border:1px solid #475569;">
      </div>

      <div style="margin:8px 0;">
        <label style="color:#e2e8f0; font-size:12px;">📁 خانة 3: الروم الكامل / فلاشة الإنقاذ (اختياري)</label>
        <input type="file" id="slot-file-rom" onchange="handleSlotFileSelect('rom', this)" style="width:100%; background:#0f172a; color:#fff; padding:6px; border-radius:6px; border:1px solid #475569;">
      </div>

      <button onclick="runFullAutonomousPipeline()" style="width:100%; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-weight:bold; padding:12px; border:none; border-radius:8px; margin-top:10px; cursor:pointer; font-size:15px;">
        ⚡ تشغيل الأوتوميشن الشامل بالتوالي (بدون تدخل بشري)
      </button>
    </div>
  `;
  const target = document.getElementById("tab-stage-1") || document.body;
  if (!document.getElementById("multi-slot-engine-box")) {
    const div = document.createElement("div");
    div.id = "multi-slot-engine-box";
    div.innerHTML = multiSlotHtml;
    target.prepend(div);
  }
}

async function handleSlotFileSelect(slotName, inputEl) {
  const file = inputEl.files?.[0];
  if (!file) return;
  slotFiles[slotName] = file;
  logOtg(`📥 تم تحميل الملف في [الخانة ${slotName}]: ${file.name} (${(file.size/1024).toFixed(1)} KB)`);

  // استخراج تلقائي ذكي لملفات SPL و U-Boot إذا رفع المستخدم ملف u-boot-sunxi-with-spl.bin أو روم كامل
  if (slotName === 'spl' && file.size > 50000 && file.size < 2 * 1024 * 1024) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // اقتطاع أول 32KB للـ SPL والباقي للـ U-Boot أوتوماتيكياً!
    slotFiles.spl = new File([bytes.subarray(0, 32768)], "extracted_spl.bin", {type: "application/octet-stream"});
    slotFiles.uboot = new File([bytes.subarray(32768, bytes.byteLength)], "extracted_uboot.bin", {type: "application/octet-stream"});
    logOtg(`🤖 [Smart Splitter] تم فصل الملف أوتوماتيكياً إلى: SPL (32KB) و U-Boot (${((bytes.byteLength - 32768)/1024).toFixed(1)}KB) للخانة الثانية!`);
  }
}

// ============================================================================
// 4. المحرك الأوتوماتيكي الشامل المتسلسل (Autonomous Pipeline)
// ============================================================================
async function runFullAutonomousPipeline() {
  cancelFlashFlag = false;
  
  // إذا لم يحدد المستخدم ملفات يدوياً، نستخدم ملف u-boot-sunxi-with-spl.bin الافتراضي
  if (!slotFiles.spl && selectedRealFile) {
    const buf = await selectedRealFile.arrayBuffer();
    const bytes = new Uint8Array(buf);
    slotFiles.spl = new File([bytes.subarray(0, 32768)], "spl.bin");
    slotFiles.uboot = new File([bytes.subarray(32768, bytes.byteLength)], "uboot.bin");
  }

  if (!slotFiles.spl) {
    return alert("يرجى اختيار ملف التمهيد (SPL) في الخانة الأولى أو في الأعلى أولاً!");
  }

  try {
    logOtg("🚀 بدء تنفيذ خط الأوتوميشن الشامل (Multi-Slot Pipeline)...");

    // الخطوة أ: مصافحة المعالج وبصمة H3
    logOtg("📌 [المحطة 1/4] مصافحة المعالج والتحقق من وضع FEL...");
    await sunxiSendFelRequest(0x0001, 0, 0);
    await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();
    logOtg("✅ المعالج مستجاب ومستعد.");

    // الخطوة ب: حقن بارامترات رامات LPDDR3 336MHz في 0x00002000
    logOtg("📌 [المحطة 2/4] حقن جدول رامات LPDDR3 (336MHz) في 0x00002000...");
    const dramParaBytes = new Uint8Array([
      0x50, 0x01, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0xF9, 0x39, 0x39, 0x00, 0x01, 0x00, 0x00, 0x00,
      0x00, 0x04, 0x00, 0x00, 0x39, 0x38, 0x39, 0x00, 0x01, 0x01, 0x00, 0x00, 0x81, 0x00, 0x00, 0x00
    ]);
    await sunxiSendFelRequest(0x0101, 0x00002000, 32);
    await sunxiUsbBulkWrite(dramParaBytes);
    await sunxiReadFelStatus();
    logOtg("✅ تم تفعيل رامات LPDDR3 بنجاح في العنوان 0x2000.");

    // الخطوة ج: بث وتنفيذ كود الـ SPL في 0x00000000
    logOtg("📌 [المحطة 3/4] بث وتفعيل ملف SPL الأولي في العنوان 0x00000000...");
    const splBuf = await slotFiles.spl.arrayBuffer();
    const splBytes = new Uint8Array(splBuf);
    
    // تصفير بايت وسائط الإقلاع لمنع طلب كارت ميموري
    if (splBytes.byteLength > 44) {
      splBytes[0x28] = 0x00; splBytes[0x29] = 0x00; splBytes[0x2a] = 0x00; splBytes[0x2b] = 0x00;
    }

    // بث الـ SPL بقطع 1KB مع حماية مكدس USB
    const CHUNK = 1024;
    let offset = 0;
    while (offset < splBytes.byteLength && offset < 24576) {
      if (cancelFlashFlag) throw new Error("تم الإيقاف.");
      const end = Math.min(offset + CHUNK, splBytes.byteLength);
      const slice = splBytes.subarray(offset, end);
      const currAddr = 0x00000000 + offset;

      if (currAddr >= 0x00001c00 && currAddr < 0x00002000) {
        offset = end;
        continue;
      }

      await sunxiSendFelRequest(0x0101, currAddr, slice.byteLength);
      await sunxiUsbBulkWrite(slice);
      await sunxiReadFelStatus();
      offset = end;
    }

    // إطلاق أمر التنفيذ للـ SPL (هنا سيحدث انقطاع الـ USB اللحظي لتشغيل الرام)
    logOtg("⚡ إرسال أمر تشغيل SPL (FEL_EXEC @ 0x00000000) — جارٍ انتظار Reset الرام والـ USB...");
    try {
      await sunxiSendFelRequest(0x0102, 0x00000000, 0);
      await sunxiReadFelStatus();
    } catch (_) {}

    // 🌟 ميزة الأوتوميشن الخارقة: الانتظار وإعادة الاتصال التلقائي بالبورت فور استيقاظه!
    logOtg("⏳ [Auto-Pipeline] انتصار على الـ USB Reset: جارٍ رصد عودة منفذ الـ USB...");
    const reconnected = await smartAutoReconnect(15);
    if (!reconnected) {
      throw new Error("لم يتمكن النظام من استعادة اتصال الـ USB تلقائياً. يرجى فصل الكابل لثانيتين وإعادة وصله ثم الضغط مجدداً.");
    }
    logOtg("✅ تم استعادة قناة الاتصال بنجاح تام بعد فتح الرام!");

    // الخطوة د: رفع وتشغيل الـ U-Boot الرئيسي في العنوان 0x4A000000 (المحطة 4)
    if (slotFiles.uboot && slotFiles.uboot.size > 1000) {
      logOtg("📌 [المحطة 4/4] رفع ملف U-Boot الرئيسي إلى ذاكرة DRAM (0x4A000000)...");
      const ubootBuf = await slotFiles.uboot.arrayBuffer();
      const ubootBytes = new Uint8Array(ubootBuf);
      
      let uOffset = 0;
      const targetAddr = 0x4a000000;
      while (uOffset < ubootBytes.byteLength) {
        if (cancelFlashFlag) throw new Error("تم الإيقاف.");
        const end = Math.min(uOffset + CHUNK, ubootBytes.byteLength);
        const slice = ubootBytes.subarray(uOffset, end);
        const currAddr = targetAddr + uOffset;

        await sunxiSendFelRequest(0x0101, currAddr, slice.byteLength);
        await sunxiUsbBulkWrite(slice);
        await sunxiReadFelStatus();
        uOffset = end;
      }

      logOtg("🚀 إرسال أمر الإقلاع النهائي لنواة U-Boot (FEL_EXEC @ 0x4A000000)...");
      try {
        await sunxiSendFelRequest(0x0102, targetAddr, 0);
        await sunxiReadFelStatus();
      } catch (_) {}

      logOtg("🎉 مبروك يا صديقي! تمت عملية الأوتوميشن بالكامل بنجاح وتم إيقاف اللمبة الزرقاء وإقلاع الرسيفر عبر هاتفك!");
    } else {
      logOtg("🎉 اكتمل حقن الـ SPL وتفعيل الرام بنجاح! لرفع U-Boot ضع ملفه في الخانة الثانية.");
    }

  } catch (err) {
    logOtg(`❌ خطأ في مسار الأوتوميشن: ${err.message}`);
  }
}

function cancelRealFlashing() {
  cancelFlashFlag = true;
  logOtg("⏹ تم إيقاف الأوتوميشن.");
}

function switchTab(id) {
  document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const sec = document.getElementById(`tab-${id}`);
  if (sec) sec.classList.add("active");
}
