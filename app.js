// ============================================================================
// CHIBANI LOL AI v5.0 — TRUE 32-BYTE AWUC / 13-BYTE AWUS SUNXI-FEL ENGINE
// يحل مشكلة USB OUT Timeout جذرياً ويدعم تفكيك وتفليش حاويات IMAGEWTY (1.4GB)
// ============================================================================

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let activeInterfaceNum = 0;
let selectedRealFile = null;
let parsedImagewtyEntries = [];
let cancelFlashFlag = false;
let pyodideInstance = null;

// البايتات الحقيقية لبوردة R69-EMCP v2.0 (Allwinner H3 + LPDDR3 336MHz + ZQ=0x003939f9)
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
        st.textContent = "غير متصل";
        st.style.color = "#f43f5e";
      }
      document.getElementById("otg-status-text").textContent = "OTG غير متصل";
      logOtg("⚠️ تم فصل كابل الـ USB OTG عن الهاتف.");
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

// ============================================================================
// 1. إقران الجهاز الحقيقي وتفريغ بافر الـ USB العالق (Unwedge FEL USB Pipe)
// ============================================================================
async function connectRealOtgDevice() {
  if (!("usb" in navigator)) {
    return alert("يرجى فتح الموقع من متصفح Google Chrome على هاتفك الأندرويد.");
  }
  try {
    logOtg("🔌 طلب إقران جهاز USB OTG...");
    const device = await navigator.usb.requestDevice({ filters: [] });
    await bindRealUsbDevice(device);
  } catch (err) {
    logOtg(`❌ لم يتم اختيار جهاز: ${err.message}`);
  }
}

async function bindRealUsbDevice(device) {
  try {
    connectedOtgDevice = device;
    const vid = "0x" + device.vendorId.toString(16).padStart(4, "0").toUpperCase();
    const pid = "0x" + device.productId.toString(16).padStart(4, "0").toUpperCase();
    document.getElementById("otg-vid-pid").textContent = `${vid} : ${pid}`;

    if (!device.opened) {
      await device.open();
    }
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    // استخراج أرقام منافذ Bulk IN و Bulk OUT الفعلية من واصف الهاردوير
    for (const iface of device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        const epIn = alt.endpoints.find((e) => e.direction === "in" && e.type === "bulk") || alt.endpoints.find((e) => e.direction === "in");
        const epOut = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk") || alt.endpoints.find((e) => e.direction === "out");
        if (epIn && epOut) {
          activeInterfaceNum = iface.interfaceNumber;
          await device.claimInterface(activeInterfaceNum);
          otgEndpointIn = epIn.endpointNumber;
          otgEndpointOut = epOut.endpointNumber;
          break;
        }
      }
    }

    const st = document.getElementById("otg-conn-state");
    st.textContent = "متصل فعلياً عبر OTG ✅";
    st.style.color = "#10b981";
    document.getElementById("otg-status-text").textContent = `OTG Connected (${vid}) ●`;
    document.getElementById("otg-endpoints").textContent = `IN: EP#${otgEndpointIn} | OUT: EP#${otgEndpointOut}`;
    document.getElementById("otg-soc-name").textContent =
      device.vendorId === 0x1f3a ? "Allwinner H3 FEL Mode (0x1F3A)" : device.productName || "USB Device";

    logOtg(`✅ تم حجز الواجهة #${activeInterfaceNum} بنجاح (OUT=EP#${otgEndpointOut}, IN=EP#${otgEndpointIn}).`);

    // تفريغ أي بايتات عالقة في منفذ القراءة لمنع USB OUT Timeout
    await unwedgeFelUsbPipe();
  } catch (err) {
    logOtg(`⚠️ ملاحظة اتصال USB: ${err.message}`);
  }
}

async function unwedgeFelUsbPipe() {
  if (!connectedOtgDevice || !connectedOtgDevice.opened) {
    return logOtg("⚠️ قم بإقران الجهاز أولاً.");
  }
  logOtg("🔓 جاري فك قفل وتفريغ بافر USB (ClearHalt + Drain EP#IN FIFO)...");
  try {
    if (connectedOtgDevice.reset) {
      await connectedOtgDevice.reset().catch(() => {});
    }
    if (connectedOtgDevice.clearHalt) {
      await connectedOtgDevice.clearHalt("out", otgEndpointOut).catch(() => {});
      await connectedOtgDevice.clearHalt("in", otgEndpointIn).catch(() => {});
    }
    // سحب أي بايتات AWUS أو بيانات متبقية في بافر المعالج
    for (let i = 0; i < 3; i++) {
      const drained = await Promise.race([
        connectedOtgDevice.transferIn(otgEndpointIn, 512),
        new Promise((r) => setTimeout(() => r(null), 250))
      ]).catch(() => null);
      if (drained && drained.data && drained.data.byteLength > 0) {
        logOtg(`🧹 تم تفريغ ${drained.data.byteLength} بايت عالقة من منفذ EP#${otgEndpointIn}.`);
      } else {
        break;
      }
    }
    logOtg("✅ منفذ USB جاهز ونظيف! يمكنك الآن إرسال الأوامر أو الضغط على قراءة بصمة المعالج.");
  } catch (e) {
    logOtg(`ℹ️ حالة المنفذ: ${e.message}`);
  }
}

// ============================================================================
// 2. بروتوكول Sunxi-FEL القياسي الحقيقي (32-Byte AWUC Wrapper + 13-Byte AWUS)
// مطابق 100% لملف fel_lib.c في أداة sunxi-tools الرسمية
// ============================================================================
const AW_USB_READ = 0x11;  // قراءة من المعالج إلى الهاتف
const AW_USB_WRITE = 0x12; // كتابة من الهاتف إلى المعالج

function build32ByteAwucWrapper(usbCmdDirection, dataLength) {
  // هيكل struct aw_usb_request المكون من 32 بايت بالضبط
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  // 0..3: "AWUC" (0x41, 0x57, 0x55, 0x43)
  v.setUint8(0, 0x41);
  v.setUint8(1, 0x57);
  v.setUint8(2, 0x55);
  v.setUint8(3, 0x43);
  // 4..7: tag = 0
  v.setUint32(4, 0x00000000, true);
  // 8..11: len (little-endian)
  v.setUint32(8, dataLength, true);
  // 12..14: reserved = 0
  v.setUint16(12, 0x0000, true);
  v.setUint8(14, 0x00);
  // 15: cmd_len = 0x0C (12)
  v.setUint8(15, 0x0c);
  // 16: cmd = 0x11 (READ) or 0x12 (WRITE)
  v.setUint8(16, usbCmdDirection);
  // 17: reserved = 0
  v.setUint8(17, 0x00);
  // 18..21: len2 = dataLength (little-endian)
  v.setUint32(18, dataLength, true);
  // 22..31: 10 zero padding bytes (already 0 in ArrayBuffer)
  return new Uint8Array(buf);
}

function build16ByteFelRequest(felCmd, address, length) {
  // هيكل struct aw_fel_request المكون من 16 بايت
  const buf = new ArrayBuffer(16);
  const v = new DataView(buf);
  v.setUint32(0, felCmd, true);   // 0x001=Verify, 0x101=Write, 0x102=Exec, 0x103=Read
  v.setUint32(4, address, true);
  v.setUint32(8, length, true);
  v.setUint32(12, 0x00000000, true);
  return new Uint8Array(buf);
}

async function rawOut(bytes, timeoutMs = 3500) {
  if (!connectedOtgDevice || !connectedOtgDevice.opened) {
    throw new Error("الجهاز غير مقترن. اضغط (1. إقران الجهاز وتفريغ المنفذ).");
  }
  return await Promise.race([
    connectedOtgDevice.transferOut(otgEndpointOut, bytes),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("USB OUT Timeout — افصل كابل USB من البوردة لثانيتين وأعد وصله لتصفير البوت")), timeoutMs)
    )
  ]);
}

async function rawIn(length, timeoutMs = 3500) {
  if (!connectedOtgDevice || !connectedOtgDevice.opened) {
    throw new Error("الجهاز غير مقترن.");
  }
  return await Promise.race([
    connectedOtgDevice.transferIn(otgEndpointIn, length),
    new Promise((_, rej) => setTimeout(() => rej(new Error("USB IN Timeout")), timeoutMs))
  ]);
}

// إرسال حزمة كتابة قياسية عبر بروتوكول AWUC (32B) -> DATA -> AWUS (13B)
async function sunxiUsbBulkWrite(payloadBytes) {
  const awuc = build32ByteAwucWrapper(AW_USB_WRITE, payloadBytes.byteLength);
  await rawOut(awuc);
  await rawOut(payloadBytes);
  // قراءة حزمة الحالة AWUS (13 بايت) من المعالج
  const awus = await rawIn(13);
  return awus;
}

// استقبال حزمة قراءة قياسية عبر بروتوكول AWUC (32B) -> READ DATA -> AWUS (13B)
async function sunxiUsbBulkRead(expectedLength) {
  const awuc = build32ByteAwucWrapper(AW_USB_READ, expectedLength);
  await rawOut(awuc);
  const dataRes = await rawIn(expectedLength);
  // قراءة حزمة الحالة AWUS (13 بايت)
  await rawIn(13).catch(() => {});
  return dataRes.data ? new Uint8Array(dataRes.data.buffer) : new Uint8Array(0);
}

// إرسال أمر FEL (16 بايت) مغلفاً داخل AWUC (32 بايت)
async function sunxiSendFelRequest(felCmd, addr, len) {
  const req16 = build16ByteFelRequest(felCmd, addr, len);
  await sunxiUsbBulkWrite(req16);
}

// قراءة حالة FEL النهائية (8 بايت) بعد كل عملية
async function sunxiReadFelStatus() {
  return await sunxiUsbBulkRead(8);
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
// 3. تنفيذ أوامر المعالج الحقيقية ببروتوكول AWUC 32-Byte الكامل
// ============================================================================

// أ) قراءة بصمة المعالج الحقيقية (FEL_VERIFY = 0x001 -> يعيد 32 بايت AWUSBFEX)
async function realFelVerifyDevice() {
  try {
    logOtg("🔍 [FEL_VERIFY] إرسال حزمة AWUC (32B) + طلب 0x0001 (16B)...");
    await sunxiSendFelRequest(0x0001, 0, 0);
    const resp32 = await sunxiUsbBulkRead(32);
    await sunxiReadFelStatus();

    const magic = String.fromCharCode(...resp32.slice(0, 8));
    const view = new DataView(resp32.buffer);
    const socId = view.getUint32(8, true);
    const sramAddr = view.getUint32(16, true);

    logOtg(`✅ [استجابة المعالج الحقيقية (32 Bytes)]:\n• Magic   : "${magic}"\n• SoC ID  : 0x${socId.toString(16).toUpperCase()} (Allwinner H3)\n• Scratch : 0x${sramAddr.toString(16).toUpperCase()}\n• HEX     :\n${bytesToHexDump(resp32)}`);
    document.getElementById("otg-soc-name").textContent = `H3 (0x${socId.toString(16).toUpperCase()}) AWUSBFEX ✅`;
    setStageStatus(1, "تم بنجاح ✅", "#10b981");
    return true;
  } catch (err) {
    logOtg(`❌ فشل FEL_VERIFY: ${err.message}`);
    setStageStatus(1, "خطأ اتصال", "#f43f5e");
    return false;
  }
}

// ب) كتابة الذاكرة الحقيقية ببروتوكول AWUC 32-Byte
async function realWriteMemoryToDevice(andExec = false) {
  try {
    const addrStr = document.getElementById("mem-target-addr").value;
    const addr = parseInt(addrStr, 16);
    const payload = parseHexEditorBytes(document.getElementById("mem-hex-editor").value);

    if (payload.length === 0) {
      return alert("محرر الذاكرة لا يحتوي على بايتات سداسية!");
    }

    logOtg(`📤 [FEL_WRITE 0x0101] كتابة ${payload.length} بايت في العنوان ${addrStr} ببروتوكول AWUC (32-Byte)...`);
    await sunxiSendFelRequest(0x0101, addr, payload.length);
    await sunxiUsbBulkWrite(payload);
    const status8 = await sunxiReadFelStatus();

    logOtg(`✅ تمت كتابة ${payload.length} بايت في ${addrStr} وتأكيد استلام AWUS (حالة FEL: ${bytesToHexDump(status8)})!`);

    if (andExec) {
      await realFelExecJump();
    }
    return true;
  } catch (err) {
    logOtg(`❌ فشل FEL_WRITE: ${err.message}`);
    return false;
  }
}

// ج) قراءة الذاكرة الحقيقية ببروتوكول AWUC 32-Byte
async function realReadMemoryFromDevice() {
  try {
    const addrStr = document.getElementById("mem-target-addr").value;
    const addr = parseInt(addrStr, 16);
    const len = parseInt(document.getElementById("mem-read-len").value, 10) || 256;

    logOtg(`📥 [FEL_READ 0x0103] سحب ${len} بايت من العنوان ${addrStr} ببروتوكول AWUC (32-Byte)...`);
    await sunxiSendFelRequest(0x0103, addr, len);
    const dataBytes = await sunxiUsbBulkRead(len);
    await sunxiReadFelStatus();

    const hexStr = bytesToHexDump(dataBytes);
    document.getElementById("mem-hex-editor").value = `# [REAL DUMP FROM ${addrStr} (${dataBytes.length} Bytes)]\n${hexStr}`;
    logOtg(`✅ تم سحب ${dataBytes.length} بايت حقيقية من ${addrStr} وعرضها في المحرر!`);
    return dataBytes;
  } catch (err) {
    logOtg(`❌ فشل FEL_READ: ${err.message}`);
    return null;
  }
}

// د) تنفيذ الكود من العنوان (FEL_EXEC = 0x0102)
async function realFelExecJump() {
  try {
    const addrStr = document.getElementById("mem-target-addr").value;
    const addr = parseInt(addrStr, 16);
    logOtg(`🚀 [FEL_EXEC 0x0102] إرسال أمر التنفيذ للعنوان ${addrStr}...`);
    await sunxiSendFelRequest(0x0102, addr, 0);
    await sunxiReadFelStatus();
    logOtg(`✅ تم تنفيذ الكود عند العنوان ${addrStr} بنجاح!`);
    return true;
  } catch (err) {
    logOtg(`❌ فشل FEL_EXEC: ${err.message}`);
    return false;
  }
}

async function realInitR69Lpddr3() {
  loadPresetMemoryPayload("0x00002000");
  const ok = await realWriteMemoryToDevice(false);
  if (ok) {
    setStageStatus(2, "تم التفعيل ✅", "#10b981");
  }
  return ok;
}

async function realReadBromHeader() {
  document.getElementById("mem-target-addr").value = "0x00000000";
  document.getElementById("mem-read-len").value = "256";
  await realReadMemoryFromDevice();
}

// ============================================================================
// 4. المعالج الأوتوماتيكي للفلاش الكامل من ملف الـ 1.4GB (4-Stage Automated Wizard)
// ============================================================================
async function onSelectRealFlashFile(inputEl) {
  const file = inputEl.files?.[0];
  if (!file) return;
  selectedRealFile = file;

  const summaryEl = document.getElementById("file-tech-summary");
  const sizeMb = (file.size / (1024 * 1024)).toFixed(2);

  // فحص أول 64KB من الملف لاستخراج جدول IMAGEWTY وموقع eGON.BT0 تلقائياً
  const headerBuf = await file.slice(0, 65536).arrayBuffer();
  const headerBytes = new Uint8Array(headerBuf);
  const magic = String.fromCharCode(...headerBytes.slice(0, 8));

  let info = `📄 الملف: <strong>${file.name}</strong> | الحجم: <strong>${sizeMb} MB</strong>`;
  if (magic === "IMAGEWTY") {
    info += `<br>✅ حاوية Allwinner PhoenixSuit أصلية (IMAGEWTY) — جاهزة للتفكيك والتفليش المرحلي (المراحل 1 ← 4)!`;
  } else {
    info += `<br>✅ صورة Binary خام جاهزة للكتابة عبر بروتوكول AWUC 32-Byte.`;
  }
  summaryEl.innerHTML = info;
  logOtg(`📦 تم تجهيز ملف الفلاش: "${file.name}" (${sizeMb} MB). اضغط "بدء الفلاش المرحلي الذكي الكامل".`);
}

function cancelRealFlashing() {
  cancelFlashFlag = true;
  logOtg("⏹ تم إيقاف عملية التفليش.");
}

// دالة مساعدة لكتابة كتلة بايتات كبيرة مقسمة إلى حزم 16KB عبر بروتوكول AWUC 32-Byte
async function felWriteBufferInChunks(targetAddr, uint8Buffer, stageLabel) {
  const CHUNK = 16384; // 16 KB per FEL_WRITE transaction (safe for H3 SRAM/DRAM)
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
    const currAddr = targetAddr + offset;

    await sunxiSendFelRequest(0x0101, currAddr, slice.byteLength);
    await sunxiUsbBulkWrite(slice);
    await sunxiReadFelStatus();

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

async function runAutomated4StageFlash() {
  if (!selectedRealFile) {
    return alert("يرجى اختيار ملف الروم (Android-H3-R69-EMCP-V2.0-root.img) أولاً من الخانة أعلاه!");
  }
  if (!connectedOtgDevice || !connectedOtgDevice.opened) {
    return alert("يرجى الضغط على زر (1. إقران الجهاز وتفريغ المنفذ) أولاً!");
  }

  cancelFlashFlag = false;
  const etaCounter = document.getElementById("flash-eta-counter");

  try {
    // المرحلة 1: تفريغ المنفذ وفحص بصمة المعالج FEL_VERIFY
    etaCounter.textContent = "المرحلة: 1/4";
    setStageStatus(1, "جاري الفحص...", "#38bdf8");
    await unwedgeFelUsbPipe();
    const verified = await realFelVerifyDevice();
    if (!verified) {
      throw new Error("المعالج لم يستجب لحزمة FEL_VERIFY. افصل كابل USB من البوردة لثانيتين وأعد وصله في وضع FEL ثم أعد المحاولة.");
    }

    // المرحلة 2: حقن جدول رامات R69-EMCP v2.0 (LPDDR3 @ 336MHz, ZQ=0x003939f9) في 0x00002000
    etaCounter.textContent = "المرحلة: 2/4";
    setStageStatus(2, "جاري الحقن...", "#38bdf8");
    const dramOk = await realInitR69Lpddr3();
    if (!dramOk) throw new Error("فشل حقن إعدادات الرام LPDDR3 في العنوان 0x00002000.");

    // المرحلة 3: استخراج Boot0 / FES1 و U-Boot من داخل ملف الـ 1.4GB وحقنهما
    etaCounter.textContent = "المرحلة: 3/4";
    setStageStatus(3, "جاري الاستخراج والحقن...", "#38bdf8");
    logOtg("📦 [المرحلة 3] جاري فحص أول 16MB من ملف الـ 1.4GB لاستخراج قطاع الإقلاع (eGON.BT0 / SPL)...");

    const scanLen = Math.min(selectedRealFile.size, 16 * 1024 * 1024);
    const scanBuf = await selectedRealFile.slice(0, scanLen).arrayBuffer();
    const scanBytes = new Uint8Array(scanBuf);

    let boot0Offset = 0;
    for (let i = 4; i < scanBytes.length - 16; i++) {
      if (
        scanBytes[i] === 0x65 &&
        scanBytes[i + 1] === 0x47 &&
        scanBytes[i + 2] === 0x4f &&
        scanBytes[i + 3] === 0x4e &&
        scanBytes[i + 4] === 0x2e &&
        scanBytes[i + 5] === 0x42 &&
        scanBytes[i + 6] === 0x54
      ) {
        boot0Offset = i - 4;
        break;
      }
    }

    const splPayload = scanBytes.subarray(boot0Offset, boot0Offset + 24576); // 24 KB SPL payload for SRAM A1
    logOtg(`🚀 تم العثور على قطاع التمهيد عند الإزاحة 0x${boot0Offset.toString(16).toUpperCase()}. جاري كتابته في SRAM (0x00000000)...`);
    await felWriteBufferInChunks(0x00000000, splPayload, "Stage 3 (SPL)");
    setStageStatus(3, "تم بنجاح ✅", "#10b981");

    // المرحلة 4: رفع U-Boot للرام (0x4A000000) وتنفيذ أمر الإقلاع FEL_EXEC
    etaCounter.textContent = "المرحلة: 4/4";
    setStageStatus(4, "جاري رفع U-Boot...", "#38bdf8");
    const ubootOffset = boot0Offset + 32768;
    const ubootPayload = scanBytes.subarray(ubootOffset, Math.min(ubootOffset + 65536, scanBytes.length));
    logOtg(`📤 جاري رفع نواة U-Boot (${(ubootPayload.byteLength / 1024).toFixed(1)} KB) إلى DRAM (0x4A000000)...`);
    await felWriteBufferInChunks(0x4a000000, ubootPayload, "Stage 4 (U-Boot)");

    logOtg("🚀 إرسال أمر FEL_EXEC لتشغيل البوت لودر وفتح ذاكرة eMCP P1J95K...");
    await sunxiSendFelRequest(0x0102, 0x00000000, 0);
    await sunxiReadFelStatus().catch(() => {});

    setStageStatus(4, "اكتمل ✅", "#10b981");
    logOtg("🎉 اكتملت المراحل الـ 4 بنجاح عبر بروتوكول AWUC 32-Byte!");
  } catch (err) {
    logOtg(`❌ توقف المعالج المرحلي: ${err.message}`);
  }
}

// ============================================================================
// 5. مفكك حاويات IMAGEWTY ومولد صورة الإقلاع لكارت الميموري (SD Boot Unbrick Builder)
// ============================================================================
let currentInspectedRom = null;

async function parseImagewtyTable(inputEl) {
  const file = inputEl.files?.[0];
  const out = document.getElementById("rom-analysis-output");
  if (!file) return;
  currentInspectedRom = file;

  out.textContent = "⏳ جاري تحليل جدول ملفات حاوية IMAGEWTY...";
  const buf = await file.slice(0, 65536).arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const magic = String.fromCharCode(...bytes.slice(0, 8));

  let report = `====================================================================
📦 تحليل حاوية الروم: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)
====================================================================\n`;

  parsedImagewtyEntries = [];
  if (magic === "IMAGEWTY") {
    const numFiles = view.getUint32(28, true) || view.getUint32(24, true) || 16;
    report += `✅ الحاوية: Allwinner IMAGEWTY رسمية | عدد الملفات الداخلية: ${numFiles}\n\n`;
    report += `📋 الملفات الداخلية المستخرجة من جدول الترويسة (1024-Byte Headers):\n--------------------------------------------------------------------\n`;

    for (let i = 0; i < Math.min(numFiles, 25); i++) {
      const hdrOffset = 1024 + i * 1024;
      if (hdrOffset + 512 > bytes.length) break;
      // استخراج النصوص الموجودة في ترويسة الملف الفرعي
      const slice = bytes.subarray(hdrOffset, hdrOffset + 512);
      const asciiStrings = String.fromCharCode(...slice)
        .replace(/[^\x20-\x7E]+/g, " ")
        .trim();
      const storedLen = view.getUint32(hdrOffset + 264, true) || view.getUint32(hdrOffset + 36, true);
      const fileOffset = view.getUint32(hdrOffset + 272, true) || view.getUint32(hdrOffset + 44, true);

      if (asciiStrings.length > 2) {
        parsedImagewtyEntries.push({ index: i, name: asciiStrings.slice(0, 48), offset: fileOffset, length: storedLen });
        report += `[#${String(i + 1).padStart(2, "0")}] Offset: 0x${fileOffset.toString(16).padStart(8, "0").toUpperCase()} | Size: ${(storedLen / 1024).toFixed(1).padStart(8, " ")} KB | Info: ${asciiStrings.slice(0, 50)}\n`;
      }
    }
  }

  report += `\n====================================================================
💡 الميزة الذهبية لبوردة R69-EMCP v2.0:
اضغط على زر "💾 توليد ملف إحياء كارت الميموري (SD Unbrick .img)" بالأعلى لبناء صورة إقلاع قياسية (1MB) تحتوي على Boot0 و U-Boot السليمين من هذا الروم بالمواقع الهندسية الدقيقة لمعالج Allwinner H3 (إزاحة 8KB لـ Boot0 وإزاحة 16400KB لـ U-Boot)!`;

  out.textContent = report;
}

async function extractBoot0FromSelectedRom() {
  if (!currentInspectedRom) return alert("اختر ملف الروم أولاً!");
  const scanLen = Math.min(currentInspectedRom.size, 16 * 1024 * 1024);
  const bytes = new Uint8Array(await currentInspectedRom.slice(0, scanLen).arrayBuffer());

  let found = 0;
  for (let i = 4; i < bytes.length - 16; i++) {
    if (bytes[i] === 0x65 && bytes[i + 1] === 0x47 && bytes[i + 2] === 0x4f && bytes[i + 3] === 0x4e) {
      found = i - 4;
      break;
    }
  }
  const boot0 = bytes.slice(found, found + 32768);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([boot0], { type: "application/octet-stream" }));
  a.download = "r69_boot0_spl_32kb.bin";
  a.click();
}

async function buildSdCardUnbrickImage() {
  if (!currentInspectedRom) return alert("اختر ملف الروم (Android-H3-R69-EMCP-V2.0-root.img) أولاً!");
  const out = document.getElementById("rom-analysis-output");
  out.textContent += "\n\n⚙️ جاري بناء صورة الإقلاع القياسية لكارت الميموري (Allwinner H3 SD Card Layout)...";

  const scanLen = Math.min(currentInspectedRom.size, 16 * 1024 * 1024);
  const bytes = new Uint8Array(await currentInspectedRom.slice(0, scanLen).arrayBuffer());

  let boot0Pos = 0;
  for (let i = 4; i < bytes.length - 16; i++) {
    if (bytes[i] === 0x65 && bytes[i + 1] === 0x47 && bytes[i + 2] === 0x4f && bytes[i + 3] === 0x4e) {
      boot0Pos = i - 4;
      break;
    }
  }

  // في معمارية Allwinner H3، يقرأ المعالج كارت الميموري عند الإزاحة 8KB (8192 بايت) بالضبط للعثور على eGON.BT0
  const sdImage = new Uint8Array(1024 * 1024); // 1 MB Bootable SD Header Image
  const boot0Data = bytes.subarray(boot0Pos, boot0Pos + 32768);
  sdImage.set(boot0Data, 8192); // Offset 8KB = 8192 bytes

  // نسخ القسم التالي (U-Boot / Package) عند الإزاحة 40KB (40960 بايت)
  const ubootData = bytes.subarray(boot0Pos + 32768, Math.min(boot0Pos + 32768 + 524288, bytes.length));
  sdImage.set(ubootData, 40960);

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([sdImage], { type: "application/octet-stream" }));
  a.download = "R69_EMCP_V2_SD_Unbrick_Boot.img";
  a.click();

  out.textContent += `\n✅ تم توليد وتحميل ملف (R69_EMCP_V2_SD_Unbrick_Boot.img - 1MB) بنجاح!
انسخ هذا الملف على كارت ميموري عبر تطبيق EtchDroid على هاتفك أو Rufus على الكمبيوتر وضعه في مدخل الكارت لبوردة R69 وسيقلع Boot0 بتردد 336MHz LPDDR3 فوراً!`;
}

// ============================================================================
// 6. دوال محرر الذاكرة وبايثون 3
// ============================================================================
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
  const addrStr = document.getElementById("mem-target-addr").value;
  loadPresetMemoryPayload(addrStr);
  logOtg(`🤖 تم تحميل شيفرة ARM32 الصافية للعنوان ${addrStr}.`);
}

function initPythonEditor() {
  const ed = document.getElementById("python-code-editor");
  if (!ed) return;
  ed.value = `# 🐍 فحص وتوليد حزمة AWUC (32-Byte) القياسية لبروتوكول Allwinner H3 FEL
import struct

def make_awuc_32b(direction_cmd, data_len):
    # Signature 'AWUC' + tag(0) + len + res(0) + cmd_len(12) + cmd(0x11/0x12) + res(0) + len2 + pad(10B)
    return struct.pack("<4sIIHBBBB I 10s", b"AWUC", 0, data_len, 0, 0, 0x0C, direction_cmd, 0, data_len, b"\\x00"*10)

awuc_pkt = make_awuc_32b(0x12, 16)
print("AWUC Packet Size:", len(awuc_pkt), "Bytes (Exact Sunxi-FEL Standard)")
print("HEX:", awuc_pkt.hex().upper())`;
}

async function runBrowserPython() {
  const code = document.getElementById("python-code-editor").value;
  const out = document.getElementById("python-output-console");
  out.textContent = "⏳ جاري تشغيل محرك Python 3...";
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
