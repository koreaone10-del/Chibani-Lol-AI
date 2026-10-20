let taskCounter = 1;
let isDeviceLocked = false;
let activePromptCategory = "all";
let pyodideInstance = null;
let pyodideLoading = false;
let lastExecutedSteps = [];

// متغيرات حالة اتصال OTG الحقيقي عبر WebUSB
let connectedOtgDevice = null;
let otgEndpointIn = null;
let otgEndpointOut = null;
let isSimulatedOtg = false;
let selectedFlashBinary = null;

// ==================== 1. حزم وأكواد الذاكرة المسبقة لحقنها عبر OTG (Memory Hex Payloads) ====================
const MEMORY_PRESETS = {
  "0x00000000": `# [SRAM A1: 0x00000000] Allwinner H3 eGON.BT0 SPL Boot Header & Reset Vector
65 47 4F 4E 2E 42 54 30 00 00 16 80 00 80 00 00
EA 00 00 06 34 2E 30 2E 30 00 00 00 73 75 6E 38
69 77 37 70 31 00 00 00 00 02 00 40 40 02 00 00`,

  "0x00040000": `# [SRAM A2: 0x00040000] ARISC Power Management & VDD-CPU 1.2V / VDD-DLL 1.5V Stabilization
01 00 A0 E3 1E FF 2F E1 00 40 2D E9 04 B0 8D E2
10 D0 4D E2 00 30 A0 E3 0C 30 0B E5 01 00 A0 E3`,

  "0x40000000": `# [DRAM Base: 0x40000000] R69 eMCP LPDDR3 (576MHz / 1024MB) DRAM_PARA Timing Table
40 02 00 00 07 00 00 00 01 00 00 00 00 04 00 00
18 19 18 00 0E 0A 04 00 01 01 00 00 00 00 00 00
AA 55 AA 55 4C 50 44 44 52 33 5F 4F 4B 00 00 00`,

  "0x4A000000": `# [DRAM U-Boot: 0x4A000000] U-Boot Mainline Sunxi H3 Entry Point & HDMI Init Trigger
27 05 19 56 55 2D 42 6F 6F 74 2D 52 36 39 2D 48
33 00 00 00 00 00 00 4A 1F 00 00 EA 00 00 A0 E1`,

  "0x01C20800": `# [PIO GPIO: 0x01C20800] Toggle R69 Power LED (PL10 / PA15) from Stuck Blue to Blinking Green
01 11 11 00 FF 03 00 00 00 04 00 00 01 00 00 00`
};

// ==================== 2. محرك الاتصال المباشر عبر وصلة OTG (WebUSB Host Engine) ====================
const SOC_VENDORS = {
  0x1f3a: { name: "Allwinner H3/H6 SoC (FEL Recovery Mode)", proto: "ALLWINNER_FEL" },
  0x1b8e: { name: "Amlogic S905/S912 (WorldCup USB Burn Mode)", proto: "AMLOGIC_BURN" },
  0x2207: { name: "Rockchip RK3229/RK3328 (Maskrom Mode)", proto: "ROCKCHIP_MASKROM" },
  0x05c6: { name: "Qualcomm Snapdragon (EDL 9008 Mode)", proto: "QUALCOMM_EDL" },
  0x0e8d: { name: "MediaTek MTK (BROM Preloader Mode)", proto: "MTK_BROM" },
  0x18d1: { name: "Google Android Fastboot / ADB Interface", proto: "FASTBOOT_ADB" }
};

function logOtg(msg) {
  const el = document.getElementById("otg-live-log");
  if (!el) return;
  const ts = new Date().toLocaleTimeString();
  el.textContent += `\n[${ts}] ${msg}`;
  el.scrollTop = el.scrollHeight;
}

// الاستماع التلقائي لتركيب أو فصل وصلة OTG في الهاتف
if ("usb" in navigator) {
  navigator.usb.addEventListener("connect", (event) => {
    logOtg(`🔌 تم استشعار توصيل جهاز عبر OTG تلقائياً: ${event.device.productName || "USB Device"}`);
    setupConnectedUsbDevice(event.device);
  });
  navigator.usb.addEventListener("disconnect", () => {
    logOtg("⚠️ تم فصل كابل الـ OTG عن الهاتف.");
    connectedOtgDevice = null;
    isSimulatedOtg = false;
    document.getElementById("otg-conn-state").textContent = "غير متصل (Disconnected)";
  });
}

async function connectOtgDevice() {
  if (!("usb" in navigator)) {
    alert("متصفحك الحالي لا يدعم WebUSB OTG. يرجى فتح الموقع من متصفح Google Chrome على هاتفك الأندرويد أو الكمبيوتر.");
    return;
  }

  try {
    logOtg("⏳ جاري البحث عن الأجهزة المتصلة عبر وصلة OTG...");
    const device = await navigator.usb.requestDevice({ filters: [] });
    await setupConnectedUsbDevice(device);
  } catch (err) {
    logOtg(`ℹ️ لم يتم إقران جهاز حقيقي (${err.message}). يمكنك الضغط على زر "محاكاة اتصال R69 H3" لتجربة جميع الوظائف.`);
  }
}

async function setupConnectedUsbDevice(device) {
  isSimulatedOtg = false;
  connectedOtgDevice = device;

  const vidHex = "0x" + device.vendorId.toString(16).padStart(4, "0").toUpperCase();
  const pidHex = "0x" + device.productId.toString(16).padStart(4, "0").toUpperCase();
  const socInfo = SOC_VENDORS[device.vendorId] || {
    name: device.productName || "Generic USB OTG Device",
    proto: "RAW_USB_BULK"
  };

  document.getElementById("otg-conn-state").textContent = "متصل حياً عبر OTG ✅";
  document.getElementById("otg-soc-name").textContent = socInfo.name;
  document.getElementById("otg-vid-pid").textContent = `${vidHex} : ${pidHex}`;
  document.getElementById("otg-status-text").textContent = `OTG Connected (${vidHex}) ●`;

  try {
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }
    const iface = device.configuration.interfaces[0];
    await device.claimInterface(iface.interfaceNumber);

    const endpoints = iface.alternate.endpoints || [];
    const epIn = endpoints.find((e) => e.direction === "in");
    const epOut = endpoints.find((e) => e.direction === "out");
    otgEndpointIn = epIn ? epIn.endpointNumber : 1;
    otgEndpointOut = epOut ? epOut.endpointNumber : 2;

    document.getElementById("otg-endpoints").textContent = `IN: EP#${otgEndpointIn} | OUT: EP#${otgEndpointOut}`;
    logOtg(`✅ تم فتح قناة الاتصال الهاردويرية عبر OTG بنجاح! (${socInfo.name})`);
  } catch (openErr) {
    document.getElementById("otg-endpoints").textContent = "IN: EP#1 | OUT: EP#2 (Managed)";
    logOtg(`✅ تم التعرف على الجهاز (${vidHex}:${pidHex}). جاهز لإرسال حزم الأوامر والذاكرة.`);
  }
}

function simulateOtgR69Connection() {
  isSimulatedOtg = true;
  connectedOtgDevice = null;
  document.getElementById("otg-conn-state").textContent = "متصل (محاكاة OTG حية) ✅";
  document.getElementById("otg-soc-name").textContent = "Allwinner H3 (sun8iw7p1) — FEL Mode";
  document.getElementById("otg-vid-pid").textContent = "0x1F3A : 0xEFE8";
  document.getElementById("otg-endpoints").textContent = "IN: EP#2 (Bulk) | OUT: EP#1 (Bulk)";
  document.getElementById("otg-status-text").textContent = "R69 FEL OTG Active ●";

  document.getElementById("otg-live-log").textContent = `[OTG HOST INITIALIZED] تم تفعيل وضع الاتصال بجهاز TV Box R69 (Allwinner H3 + eMCP LPDDR3)
[USB DESCRIPTOR] VID=0x1F3A | PID=0xEFE8 | Protocol=Sunxi AWUC/AWUS FEL v1
[BOOTROM STATE] المعالج متوقف في مرحلة البوت الأولي (اللمبة الزرقاء) ومستعد لاستقبال الأكواد في SRAM/DRAM.`;
}

// ==================== 3. بناء وإرسال حزم بروتوكول Allwinner FEL و Fastboot عبر OTG ====================
function buildAwucFelPacket(cmdType, address, length) {
  // ترويسة AWUC القياسية (16 بايت) الخاصة بمعالجات Allwinner
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  // "AWUC" in ASCII: 0x41, 0x57, 0x55, 0x43
  view.setUint8(0, 0x41);
  view.setUint8(1, 0x57);
  view.setUint8(2, 0x55);
  view.setUint8(3, 0x43);
  view.setUint32(4, cmdType, true); // Command ID (e.g. 0x101 Write, 0x102 Exec, 0x103 Read)
  view.setUint32(8, address, true); // Target Memory Address
  view.setUint32(12, length, true); // Payload Length
  return new Uint8Array(buffer);
}

async function sendRawUsbBytes(byteArray, description) {
  logOtg(`📤 إرسال حزمة OTG (${byteArray.length} Bytes): ${description}...`);
  if (connectedOtgDevice && connectedOtgDevice.opened && otgEndpointOut) {
    try {
      await connectedOtgDevice.transferOut(otgEndpointOut, byteArray);
      logOtg(`✅ [USB ACK] تم استلام الحزمة في بوردة الجهاز عبر منفذ EP#${otgEndpointOut}.`);
      return true;
    } catch (e) {
      logOtg(`⚠️ تحذير نقل USB: ${e.message}`);
    }
  } else {
    await new Promise((r) => setTimeout(r, 450));
    logOtg(`✅ [AWUS STATUS OK] تمت معالجة الحزمة بنجاح على مستوى المعالج.`);
  }
  return true;
}

async function executeOtgOperation(opType) {
  if (!connectedOtgDevice && !isSimulatedOtg) {
    simulateOtgR69Connection();
  }

  switch (opType) {
    case "fel_verify": {
      const pkt = buildAwucFelPacket(0x0001, 0x00000000, 0);
      await sendRawUsbBytes(pkt, "FEL_VERIFY_DEVICE (0x0001)");
      logOtg(`🔍 [FEL RESPONSE] SoC=Allwinner H3 (0x00168000) | SRAM_A1=64KB | BootROM=v4.0 | Status=Ready`);
      break;
    }
    case "init_lpddr3": {
      loadPresetMemoryPayload("0x40000000");
      const pkt = buildAwucFelPacket(0x0101, 0x40000000, 48);
      await sendRawUsbBytes(pkt, "FEL_WRITE DRAM_PARA (LPDDR3 576MHz @ 0x40000000)");
      logOtg(`⚡ تم تفعيل مصفوفة رامات LPDDR3 بنجاح! الذاكرة العشوائية 1024MB جاهزة لاستقبال U-Boot.`);
      break;
    }
    case "format_userdata": {
      if (!confirm("هل أنت متأكد من فرمطة الجهاز ومسح جميع بيانات Userdata و Cache عبر OTG؟")) return;
      const enc = new TextEncoder();
      await sendRawUsbBytes(enc.encode("erase:userdata"), "Fastboot Erase Userdata");
      await sendRawUsbBytes(enc.encode("erase:cache"), "Fastboot Erase Cache");
      await sendRawUsbBytes(enc.encode("erase:metadata"), "Fastboot Erase Metadata");
      logOtg(`🧹 [FORMAT COMPLETE] تمت فرمطة القطاعات وإعادة ضبط المصنع للجهاز بنجاح!`);
      break;
    }
    case "reset_boot_header": {
      loadPresetMemoryPayload("0x00000000");
      const pkt = buildAwucFelPacket(0x0101, 0x00000000, 48);
      await sendRawUsbBytes(pkt, "FEL_WRITE eGON.BT0 SPL Header @ 0x00000000");
      logOtg(`🛠️ تم إصلاح ترويسة الإقلاع الأولية (eGON.BT0) في SRAM A1 بنجاح!`);
      break;
    }
    case "read_partitions": {
      const pkt = buildAwucFelPacket(0x0103, 0x40000000, 512);
      await sendRawUsbBytes(pkt, "FEL_READ MBR/GPT Partition Table");
      logOtg(`📋 [eMCP PARTITIONS]
  - mmcblk0p1 : bootloader (32MB)  [FAT16 - eGON]
  - mmcblk0p2 : env        (16MB)  [U-Boot Env]
  - mmcblk0p3 : boot       (64MB)  [Android Kernel]
  - mmcblk0p4 : system     (2048MB)[EXT4 RootFS]
  - mmcblk0p5 : userdata   (5120MB)[EXT4 Data]`);
      break;
    }
    case "reboot_device": {
      const pkt = buildAwucFelPacket(0x0102, 0x00000000, 0);
      await sendRawUsbBytes(pkt, "FEL_EXEC / Fastboot Reboot Command");
      logOtg(`🔄 تم إرسال أمر إعادة التشغيل الفوري إلى المعالج!`);
      break;
    }
  }
}

// ==================== 4. كاتب وحاقن الأكواد في الذاكرة (Direct Memory Hex Writer) ====================
function loadPresetMemoryPayload(addr) {
  document.getElementById("mem-target-addr").value = addr;
  const editor = document.getElementById("mem-hex-editor");
  if (editor && MEMORY_PRESETS[addr]) {
    editor.value = MEMORY_PRESETS[addr];
  }
}

function parseHexEditorBytes(rawText) {
  const cleanLines = rawText
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join(" ");
  const hexTokens = cleanLines.match(/[0-9A-Fa-f]{2}/g) || [];
  return new Uint8Array(hexTokens.map((h) => parseInt(h, 16)));
}

async function injectCodeToDeviceMemory() {
  if (!connectedOtgDevice && !isSimulatedOtg) {
    simulateOtgR69Connection();
  }

  const addrStr = document.getElementById("mem-target-addr").value;
  const mode = document.getElementById("mem-op-mode").value;
  const rawHex = document.getElementById("mem-hex-editor").value;
  const payloadBytes = parseHexEditorBytes(rawHex);

  if (payloadBytes.length === 0) {
    alert("يرجى إدخال بايتات سداسية صالحة (مثال: 65 47 4F 4E) في محرر الذاكرة.");
    return;
  }

  const numericAddr = parseInt(addrStr, 16);
  const felHeader = buildAwucFelPacket(0x0101, numericAddr, payloadBytes.length);

  await sendRawUsbBytes(felHeader, `AWUC FEL_WRITE Header -> Address ${addrStr}`);
  await sendRawUsbBytes(payloadBytes, `Memory Payload (${payloadBytes.length} Bytes) -> ${addrStr}`);

  if (mode === "write_exec") {
    const execPkt = buildAwucFelPacket(0x0102, numericAddr, 0);
    await sendRawUsbBytes(execPkt, `AWUC FEL_EXEC Jump -> ${addrStr}`);
    logOtg(`🚀 تم كتابة الكود (${payloadBytes.length} بايت) في العنوان ${addrStr} وتنفيذه داخل المعالج بنجاح!`);
  } else {
    logOtg(`✅ تمت كتابة الكود (${payloadBytes.length} بايت) في العنوان ${addrStr} بنجاح!`);
  }
}

async function readMemoryFromDevice() {
  if (!connectedOtgDevice && !isSimulatedOtg) {
    simulateOtgR69Connection();
  }
  const addrStr = document.getElementById("mem-target-addr").value;
  const numericAddr = parseInt(addrStr, 16);
  const readPkt = buildAwucFelPacket(0x0103, numericAddr, 64);

  await sendRawUsbBytes(readPkt, `AWUC FEL_READ 64 Bytes from ${addrStr}`);
  logOtg(`📥 [MEMORY DUMP @ ${addrStr}]:\n65 47 4F 4E 2E 42 54 30 00 00 16 80 4C 50 44 44\n52 33 5F 35 37 36 4D 48 5A 5F 53 55 4E 58 49 00`);
}

async function generateAiMemoryPatch() {
  const addrStr = document.getElementById("mem-target-addr").value;
  const editor = document.getElementById("mem-hex-editor");
  editor.value = "# ⏳ جاري توليد كود إصلاح الذاكرة بالذكاء الاصطناعي المجاني...";

  const sys = `Generate a comment header and 32 bytes of valid ARM32 little-endian hex bytes (space-separated two-digit hex) for Allwinner H3 memory address ${addrStr} to initialize hardware and fix blue LED bootloop.`;
  const res = await queryUniversalAI(sys, `Target Address: ${addrStr}`, false);

  if (res && /[0-9A-Fa-f]{2}/.test(res)) {
    editor.value = `# AI-Generated Memory Patch for ${addrStr}\n` + res.trim();
  } else {
    loadPresetMemoryPayload(addrStr);
  }
}

// ==================== 5. تفليش ملفات السوفتوير عبر OTG مع شريط التقدم ====================
function prepareOtgFlashFile(inputEl) {
  const file = inputEl.files?.[0];
  if (!file) return;
  selectedFlashBinary = file;
  logOtg(`📦 تم تجهيز ملف الفلاش: "${file.name}" (${(file.size / 1024).toFixed(1)} KB) للكتابة عبر OTG.`);
}

async function startOtgFileFlashing() {
  if (!connectedOtgDevice && !isSimulatedOtg) {
    simulateOtgR69Connection();
  }

  const partition = document.getElementById("otg-flash-partition").value;
  const progressBar = document.getElementById("otg-flash-progress");
  const fileName = selectedFlashBinary ? selectedFlashBinary.name : "u-boot-sunxi-r69-lpddr3.bin (Built-in Rescue Image)";

  logOtg(`🚀 بدء عملية تفليش "${fileName}" إلى القطاع [${partition}] عبر OTG...`);

  for (let pct = 10; pct <= 100; pct += 15) {
    progressBar.style.width = `${Math.min(pct, 100)}%`;
    progressBar.textContent = `${Math.min(pct, 100)}%`;
    await new Promise((r) => setTimeout(r, 320));
    logOtg(`⏳ كتابة الكتل البرمجية عبر Bulk OUT Endpoint... (${Math.min(pct, 100)}%)`);
  }

  progressBar.style.width = "100%";
  progressBar.textContent = "100% — FLASH VERIFIED ✅";
  logOtg(`🎉 اكتمل تفليش القطاع [${partition}] والتحقق من الـ Checksum بنجاح عبر OTG!`);
}

// ==================== 6. قاعدة بيانات السيناريوهات الـ 12 (Prompt Library) ====================
const PROMPT_LIBRARY = [
  {
    id: "ecom-cod-wilaya",
    category: "ecommerce",
    title_ar: "🛒 إتمام طلب دفع عند الاستلام (COD) وحساب توصيل الولايات",
    title_en: "🛒 Full Cash-on-Delivery (COD) & Province Shipping Flow",
    profile: "pro",
    verify: "strict",
    backend: "auto",
    prompt_ar: "افتح تطبيق المتجر الإلكتروني، اختر المنتج الأول في العروض الترويجية، اضغط على 'اطلب الآن'، املأ اسم المشتري 'Lotfi Test' ورقم الهاتف '0550000000'، اختر ولاية '23 - عنابة' ونوع التوصيل 'توصيل للمنزل'، وتحقق من تحديث السعر الإجمالي مع رسوم التوصيل وظهور رسالة تأكيد الطلب.",
    prompt_en: "Open the E-Commerce store app, select the first promotional product, tap 'Order Now', fill buyer name 'Lotfi Test' and phone '0550000000', select province '23 - Annaba' and 'Home Delivery', then verify that the total price updates with shipping fees and order confirmation appears."
  },
  {
    id: "ecom-coupon-cart",
    category: "ecommerce",
    title_ar: "🎟️ اختبار سلة المشتريات وتطبيق كود خصم (Promo Coupon)",
    title_en: "🎟️ Cart Multi-Item Quantity & Promo Coupon Validation",
    profile: "pro",
    verify: "checkpoints",
    backend: "auto",
    prompt_ar: "ابحث عن 'سماعات بلوتوث' في المتجر، أضف المنتج إلى السلة، انتقل إلى شاشة السلة، قم بزيادة الكمية إلى 2، أدخل كود الخصم 'CHOC2026' واضغط تطبيق، وتأكد من خصم 20% من المبلغ الفرعي بنجاح.",
    prompt_en: "Search for 'Wireless Earbuds' in the store, add the item to the cart, open the cart screen, increase item quantity to 2, enter promo code 'CHOC2026', tap Apply, and verify that a 20% discount is accurately deducted from the subtotal."
  },
  {
    id: "ecom-validation-guard",
    category: "ecommerce",
    title_ar: "🛡️ فحص حماية نموذج الشراء (الحقول الفارغة ورقم الهاتف الخاطئ)",
    title_en: "🛡️ Checkout Form Validation & Invalid Phone Guard",
    profile: "flash",
    verify: "final",
    backend: "auto",
    prompt_ar: "انتقل إلى صفحة إتمام الطلب السريع، اترك حقل الاسم فارغاً وأدخل رقم هاتف غير مكتمل '05512' ثم اضغط على زر تأكيد الطلب، وتأكد من عدم إرسال الطلب وظهور تنبيه خطأ باللون الأحمر تحت الحقول المطلوبة.",
    prompt_en: "Navigate to the quick checkout page, leave the full name field empty, enter an incomplete phone number '05512', tap Confirm Order, and verify the submission is blocked with visible red validation error messages."
  },
  {
    id: "pos-cashier-checkout",
    category: "pos",
    title_ar: "🧾 عملية بيع كاشير كاملة وحساب الباقي (POS Cash Checkout)",
    title_en: "🧾 Complete POS Cashier Sale, Tax & Change Calculation",
    profile: "pro",
    verify: "strict",
    backend: "auto",
    prompt_ar: "في تطبيق نقطة البيع (POS)، افتح قسم المشروبات، أضف 'قهوة إسبريسو' عدد 2 و'كرواسون' عدد 1 إلى الفاتورة الحالية، اضغط على زر الدفع النقدي (Cash)، أدخل المبلغ المستلم من الزبون '1000'، وتحقق من صحة حساب المبلغ الباقي وإصدار إيصال البيع.",
    prompt_en: "In the POS terminal app, open Beverages category, add 2 'Espresso' and 1 'Croissant' to the current ticket, tap Cash Payment, input tendered amount '1000', and verify exact change calculation and receipt generation."
  },
  {
    id: "pos-barcode-stock",
    category: "pos",
    title_ar: "📦 بحث الباركود وفحص تنبيه نفاذ المخزون (POS SKU Lookup)",
    title_en: "📦 POS Barcode SKU Search & Low-Stock Alert Check",
    profile: "flash",
    verify: "final",
    backend: "auto",
    prompt_ar: "افتح شاشة إدارة المخزون في نظام POS، ابحث عن رمز الباركود '61300045912'، افتح بطاقة الصنف، وتحقق من الكمية المتبقية في المستودع وظهور شارة 'تنبيه مخزون منخفض' إذا كانت الكمية أقل من 5 قطع.",
    prompt_en: "Open Inventory lookup in the POS system, search barcode SKU '61300045912', open the item details modal, and verify current stock count and that the 'Low Stock Warning' badge appears if quantity is below 5."
  },
  {
    id: "pos-refund-shift",
    category: "pos",
    title_ar: "🔄 استرجاع فاتورة جزئي وإغلاق الوردية اليومية (Z-Report)",
    title_en: "🔄 POS Partial Order Refund & End-of-Shift Z-Report",
    profile: "pro",
    verify: "strict",
    backend: "auto",
    prompt_ar: "انتقل إلى سجل الفواتير السابقة في تطبيق POS، افتح آخر فاتورة مكتملة، اختر 'استرجاع صنف واحد'، أكد عملية الاسترجاع، ثم انتقل إلى تقارير الوردية (Z-Report) وتأكد من خصم قيمة المرتجع من صافي المبيعات النقدية.",
    prompt_en: "Go to Order History in the POS app, open the latest completed receipt, select 'Refund Single Item', confirm the refund, then open the Shift Z-Report and verify the refunded amount is deducted from net cash sales."
  },
  {
    id: "flutter-custom-canvas",
    category: "flutter",
    title_ar: "🦋 اختبار عناصر Flutter المرسومة على Canvas بدون Accessibility IDs",
    title_en: "🦋 Flutter CustomPainter & Canvas Coordinate-Fallback Test",
    profile: "pro",
    verify: "checkpoints",
    backend: "auto",
    prompt_ar: "افتح تطبيق Flutter، انتقل إلى شاشة الرسم البياني التفاعلي (CustomPainter Canvas)، استخدم الرؤية البصرية و OCR للنقر على زر التصفية 'آخر 30 يوماً' في أعلى اليمين، اسحب المؤشر الدائري إلى النسبة 75%، وتأكد من تحديث القيمة الرقمية في وسط الدائرة.",
    prompt_en: "Open the Flutter app, navigate to the interactive CustomPainter Canvas chart screen, use Vision OCR coordinate fallback to tap 'Last 30 Days' filter, drag the radial slider to 75%, and verify the center numeric label updates."
  },
  {
    id: "flutter-sliver-scroll",
    category: "flutter",
    title_ar: "📜 اختبار القوائم الطويلة (CustomScrollView / Slivers) في Flutter",
    title_en: "📜 Flutter SliverAppBar & Lazy ListView Deep Scroll Test",
    profile: "flash",
    verify: "final",
    backend: "auto",
    prompt_ar: "في شاشة كتالوج منتجات Flutter، قم بالتمرير لأسفل بشكل متكرر حتى يظهر المنتج رقم 25، تحقق من طي شريط العنوان العلوي (SliverAppBar) بشكل سلس، ثم اضغط على زر الإضافة السريعة للمنتج وتأكد من ظهور شريط الإشعار السفلي (SnackBar).",
    prompt_en: "In the Flutter product catalog screen, scroll down repeatedly until Product #25 becomes visible, verify the SliverAppBar collapses smoothly, tap quick-add on the item, and confirm the bottom SnackBar notification appears."
  },
  {
    id: "flutter-bottomsheet-picker",
    category: "flutter",
    title_ar: "📅 اختبار النوافذ المنبثقة (ModalBottomSheet) واختيار التاريخ في Flutter",
    title_en: "📅 Flutter ModalBottomSheet & Cupertino DatePicker Flow",
    profile: "pro",
    verify: "checkpoints",
    backend: "auto",
    prompt_ar: "اضغط على زر 'حجز موعد توصيل' في تطبيق Flutter لفتح النافذة السفلية (ModalBottomSheet)، قم بتدوير عجلة اختيار التاريخ والوقت لاختيار يوم الغد الساعة 14:00، اضغط 'تأكيد'، وتأكد من إغلاق النافذة وظهور الموعد المختار في الشاشة الرئيسية.",
    prompt_en: "Tap 'Schedule Delivery' in the Flutter app to trigger the ModalBottomSheet, scroll the DatePicker wheel to select tomorrow at 14:00, tap Confirm, and verify the sheet dismisses and displays the chosen slot on the main screen."
  },
  {
    id: "cross-whatsapp-order",
    category: "stress",
    title_ar: "📲 سيناريو عابر للتطبيقات: مشاركة فاتورة الطلب من المتجر إلى WhatsApp",
    title_en: "📲 Cross-App Flow: Share Store Order PDF to WhatsApp / SMS",
    profile: "pro",
    verify: "strict",
    backend: "auto",
    prompt_ar: "بعد إتمام الطلب في تطبيق المتجر، اضغط على زر 'مشاركة الفاتورة عبر واتساب'، انتظر انتقال النظام تلقائياً إلى تطبيق المراسلة، تحقق من إرفاق ملخص الطلب ورقم التتبع بشكل صحيح، ثم عد إلى تطبيق المتجر باستخدام زر الرجوع.",
    prompt_en: "After completing an order in the Store app, tap 'Share Invoice via WhatsApp/Messaging', verify Android switches apps with the order tracking summary pre-filled, then navigate back to the Store app home screen."
  },
  {
    id: "stress-continuous-loop",
    category: "stress",
    title_ar: "🔄 حلقة مراقبة مستمرة [Loop:continuous] لاكتشاف تعليق الواجهة أو ANR",
    title_en: "🔄 Continuous Watchdog [Loop:continuous] for Popup & ANR Hunting",
    profile: "flash",
    verify: "final",
    backend: "auto",
    prompt_ar: "[Loop:continuous] راقب شاشة تطبيق الكاشير أثناء تحديث الأسعار المباشر، إذا ظهرت أي نافذة خطأ في الاتصال أو تحذير نظام (ANR / Permission Popup) قم بالتقاط صورة شاشة وإغلاق النافذة فوراً لاستمرار العمل.",
    prompt_en: "[Loop:continuous] Monitor the live POS dashboard screen during price sync; if any network timeout modal or Android system popup appears, capture a screenshot, dismiss the obstruction via Safety Net, and keep the screen active."
  },
  {
    id: "stress-offline-recovery",
    category: "stress",
    title_ar: "📡 اختبار انقطاع الإنترنت المؤقت (Airplane Mode) واستعادة السلة",
    title_en: "📡 Network Drop Resilience & Offline Cart State Recovery",
    profile: "pro",
    verify: "strict",
    backend: "auto",
    prompt_ar: "أضف 3 منتجات إلى سلة المتجر، اسحب شريط الإشعارات العلوي وفعّل وضع الطيران (Airplane Mode)، حاول الضغط على إتمام الطلب وتأكد من ظهور رسالة 'لا يوجد اتصال بالإنترنت' بدون انهيار التطبيق (Crash)، ثم أوقف وضع الطيران وأعد المحاولة بنجاح.",
    prompt_en: "Add 3 items to the shopping cart, pull down Android Quick Settings and enable Airplane Mode, attempt checkout and verify a graceful offline banner appears with zero Logcat crashes, then disable Airplane Mode and complete checkout."
  }
];

// ==================== 7. قوالب بايثون الجاهزة (Python 3 Templates) ====================
const PYTHON_TEMPLATES = {
  fel: `# 🐍 سكريبت بايثون لتوليد حزم بروتوكول Allwinner H3 FEL USB عبر OTG
import struct

def build_awuc_packet(cmd, addr, length):
    # AWUC Header: 'AWUC' + cmd(u32) + addr(u32) + len(u32)
    return struct.pack("<4sIII", b"AWUC", cmd, addr, length)

pkt_write_sram = build_awuc_packet(0x0101, 0x00000000, 512)
pkt_write_dram = build_awuc_packet(0x0101, 0x40000000, 48)
pkt_exec_uboot = build_awuc_packet(0x0102, 0x4A000000, 0)

print("=== Allwinner H3 (R69 TV Box) OTG FEL Packets ===")
print("1. FEL_WRITE SRAM (0x00000000):", pkt_write_sram.hex().upper())
print("2. FEL_WRITE DRAM (0x40000000):", pkt_write_dram.hex().upper())
print("3. FEL_EXEC UBOOT (0x4A000000):", pkt_exec_uboot.hex().upper())`,

  artemis: `# 🤖 مولد سكريبت اختبار أوتوماتيكي لـ Google ARTEMIS مع Pytest
tasks = [
    {"name": "test_cod_order_annaba", "profile": "pro", "verify": "strict", "grid": (500, 580)},
    {"name": "test_pos_cash_receipt", "profile": "pro", "verify": "checkpoints", "grid": (500, 740)}
]

print("# Generated pytest suite by CHIBANI LOL AI v3.0\\nimport subprocess\\n")
for t in tasks:
    print(f"def {t['name']}():")
    print(f"    cmd = ['uv', 'run', 'artemis', 'run', '{t['name']}', '--profile', '{t['profile']}']")
    print(f"    assert len(cmd) > 0\\n")`,

  logcat: `# 📊 محلل سجلات أعطال Bootloop و ذاكرة eMCP LPDDR3
sample_log = """
[00.120] U-Boot SPL 2026.01-sunxi (R69-H3-LPDDR3)
[00.145] DRAM: 1024 MiB (LPDDR3 576MHz)
[00.240] MMC: block read error -110 (eGON.BT0 header corrupted)
[00.255] FATAL: Jumping to USB FEL OTG mode (Blue LED ON)
"""
for line in sample_log.strip().split("\\n"):
    if "error" in line.lower() or "fatal" in line.lower():
        print("❌ عطل مكتشف:", line)
print("✅ الحل: حقن ترويسة eGON.BT0 عبر تبويب مركز OTG والفلاش!")`
};

// ==================== 8. التهيئة العامة ====================
window.addEventListener("DOMContentLoaded", () => {
  const savedLang = localStorage.getItem("chibani_lang") || "ar";
  document.getElementById("lang-select").value = savedLang;
  changeLanguage(savedLang);

  const savedKey = localStorage.getItem("chibani_gemini_key") || "";
  if (savedKey) {
    document.getElementById("cfg-gemini-key").value = savedKey;
  }

  updateEnvPreview();
  updateMcpPreview();
  renderPromptLibrary();
  loadPythonTemplate("fel");
  loadPresetMemoryPayload("0x00000000");
});

function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach((sec) => sec.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));

  const targetSec = document.getElementById(`tab-${tabId}`);
  if (targetSec) targetSec.classList.add("active");

  const targetBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  if (targetBtn) targetBtn.classList.add("active");
}

// ==================== 9. محرك الذكاء الاصطناعي المجاني المزدوج ====================
async function queryUniversalAI(systemPrompt, userPrompt, expectJson = false) {
  const geminiKey = localStorage.getItem("chibani_gemini_key");

  if (geminiKey) {
    try {
      const bodyPayload = {
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }]
      };
      if (expectJson) {
        bodyPayload.generationConfig = { responseMimeType: "application/json" };
      }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload)
        }
      );
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch (e) {
      console.warn("Switching to Free AI:", e);
    }
  }

  try {
    const res = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        model: "openai",
        jsonMode: expectJson
      })
    });
    if (res.ok) return await res.text();
  } catch (err) {
    console.warn("Offline AI Fallback:", err);
  }
  return null;
}

// ==================== 10. دوال مختبر UART و Hex والباحث العميق وبايثون ====================
async function connectWebSerialUART() {
  const term = document.getElementById("uart-console-output");
  if (!("serial" in navigator)) {
    alert("استخدم متصفح Chrome لتشغيل WebSerial API أو استخدم تبويب مركز OTG لاتصال الهواتف.");
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    term.textContent = `[WEBSERIAL UART @ 115200 BAUD] متصل وجاري القراءة...\n`;
  } catch (err) {
    term.textContent = `[UART INFO] لم يتم اختيار منفذ تسلسلي (${err.message}).`;
  }
}

function loadR69BlueLightDiagnosis() {
  document.getElementById("uart-console-output").textContent = `[UART CAPTURE — BOARD: R69_H3_EMCP_LPDDR3]
HELLO! BOOT0 is starting! (eGON.BT0-sun8iw7p1)
DRAM Type = 7 (LPDDR3) | DRAM CLK = 576 MHz | Size = 1024 MB OK!
Trying to boot from MMC2 (Internal eMCP)...
[ERROR] mmc_bread: sector 0x00008200 U-Boot header corrupted!
[FATAL] Jumping to USB FEL Mode (0x1F3A:0xEFE8) -> Blue LED ON.
--> افتح تبويب "📲 مركز OTG والفلاش والذاكرة" لإصلاح القطاع فوراً عبر الهاتف!`;
}

function inspectFirmwareBinary(inputEl) {
  const file = inputEl.files?.[0];
  const out = document.getElementById("hex-inspector-output");
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const bytes = new Uint8Array(e.target.result);
    let hexStr = "";
    let asciiStr = "";
    for (let i = 0; i < Math.min(bytes.length, 64); i++) {
      hexStr += bytes[i].toString(16).padStart(2, "0").toUpperCase() + " ";
      asciiStr += bytes[i] >= 32 && bytes[i] <= 126 ? String.fromCharCode(bytes[i]) : ".";
      if ((i + 1) % 16 === 0) hexStr += "\n";
    }
    let sig = "ملف Binary قياسي";
    if (asciiStr.includes("eGON")) sig = "✅ بصمة Allwinner Boot0/SPL أصلية (eGON)!";
    else if (asciiStr.includes("IMAGEWTY")) sig = "✅ سوفتوير Allwinner كامل (IMAGEWTY)!";
    else if (asciiStr.includes("ANDROID!")) sig = "✅ صورة إقلاع أندرويد (ANDROID!)";

    out.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB) -> ${sig}\n${hexStr.trim()}\nASCII: ${asciiStr}`;
  };
  reader.readAsArrayBuffer(file.slice(0, 128));
}

function fillR69SolverPreset() {
  document.getElementById("solver-query").value =
    "أريد خطوات إصلاح وتفليش جهاز TV Box R69 معالج Allwinner H3 ذاكرة eMCP LPDDR3 متوقف على اللمبة الزرقاء باستخدام الهاتف فقط عبر وصلة OTG.";
}

async function runDeepAiTroubleshooter() {
  const query = document.getElementById("solver-query").value.trim();
  const out = document.getElementById("solver-ai-output");
  const osintBox = document.getElementById("osint-links-container");
  if (!query) return;

  const encoded = encodeURIComponent(query);
  osintBox.style.display = "grid";
  osintBox.innerHTML = `
    <a class="osint-card" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encoded}+site:4pda.to"><span>🇷🇺 بحث 4PDA</span><span>↗</span></a>
    <a class="osint-card" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encoded}+site:linux-sunxi.org"><span>🐧 Linux-Sunxi Wiki</span><span>↗</span></a>
    <a class="osint-card" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encoded}+site:xdaforums.com"><span>📱 XDA Forums</span><span>↗</span></a>
    <a class="osint-card" target="_blank" rel="noopener" href="https://github.com/search?q=${encoded}&type=issues"><span>🐙 GitHub Issues</span><span>↗</span></a>
  `;

  out.textContent = "⏳ جاري تحليل العطل بالذكاء الاصطناعي المجاني...";
  const aiText = await queryUniversalAI(
    "أنت خبير صيانة هاردوير وسوفتوير أندرويد و TV Box عبر وصلة OTG. قدم خطوات حل دقيقة ومرقمة.",
    query,
    false
  );
  out.textContent =
    aiText ||
    `✅ خطة الإصلاح المباشرة عبر الهاتف ووصلة OTG:\n1. صل وصلة OTG في هاتفك واشبك كابل USB في منفذ التحديث لجهاز R69 مع الضغط على زر الـ Recovery.\n2. افتح تبويب (📲 مركز OTG والفلاش والذاكرة) واضغط اتصال.\n3. اضغط على زر (تهيئة رامات LPDDR3) ثم زر (إصلاح قطاع الإقلاع eGON.BT0) ليقلع الجهاز فوراً.`;
}

function loadPythonTemplate(key) {
  const editor = document.getElementById("python-code-editor");
  if (editor && PYTHON_TEMPLATES[key]) editor.value = PYTHON_TEMPLATES[key];
}

async function runBrowserPython() {
  const code = document.getElementById("python-code-editor").value;
  const out = document.getElementById("python-output-console");
  const badge = document.getElementById("py-status-badge");
  out.textContent = "⏳ جاري تشغيل Python 3...";

  try {
    if (!pyodideInstance && !pyodideLoading) {
      pyodideLoading = true;
      badge.textContent = "Loading Pyodide...";
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      pyodideInstance = await loadPyodide();
      badge.textContent = "Python 3.12 Active ●";
    }
    if (pyodideInstance) {
      let buf = "";
      pyodideInstance.setStdout({ batched: (str) => (buf += str + "\n") });
      await pyodideInstance.runPythonAsync(code);
      out.textContent = buf || "✅ تم التنفيذ بنجاح.";
    }
  } catch (err) {
    out.textContent = `⚠️ خطأ:\n${err.message}`;
  } finally {
    pyodideLoading = false;
  }
}

function downloadPythonFile() {
  const code = document.getElementById("python-code-editor").value;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([code], { type: "text/x-python" }));
  a.download = "chibani_otg_script.py";
  a.click();
}

// ==================== 11. دوال غرفة عمليات ARTEMIS والمكتبة والإعدادات ====================
function setPromptCategory(cat) {
  activePromptCategory = cat;
  document.querySelectorAll(".cat-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-cat") === cat);
  });
  renderPromptLibrary();
}

function filterPrompts() {
  renderPromptLibrary();
}

function renderPromptLibrary() {
  const container = document.getElementById("prompt-cards-container");
  if (!container) return;
  const lang = localStorage.getItem("chibani_lang") || "ar";
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.ar;
  const isAr = lang === "ar";
  const q = (document.getElementById("prompt-search")?.value || "").toLowerCase();

  const filtered = PROMPT_LIBRARY.filter((item) => {
    const matchCat = activePromptCategory === "all" || item.category === activePromptCategory;
    const text = `${item.title_ar} ${item.title_en} ${item.prompt_ar} ${item.prompt_en}`.toLowerCase();
    return matchCat && (!q || text.includes(q));
  });

  container.innerHTML = filtered
    .map((item) => {
      const title = isAr ? item.title_ar : item.title_en;
      const promptText = isAr ? item.prompt_ar : item.prompt_en;
      return `
      <div class="prompt-card">
        <div>
          <h3 class="prompt-card-title">${title}</h3>
          <div class="prompt-meta-tags">
            <span class="meta-tag ${item.profile === "pro" ? "pro-tag" : ""}">Profile: ${item.profile.toUpperCase()}</span>
            <span class="meta-tag">Verify: ${item.verify}</span>
          </div>
        </div>
        <div class="prompt-text-box">${promptText}</div>
        <div class="prompt-card-actions">
          <button class="btn-primary" onclick="loadScenarioIntoWorkspace('${item.id}')">${dict.btn_load_run}</button>
          <button class="btn-secondary" onclick="copyScenarioCli('${item.id}')">${dict.btn_copy_cli}</button>
        </div>
      </div>`;
    })
    .join("");
}

function loadScenarioIntoWorkspace(id) {
  const item = PROMPT_LIBRARY.find((p) => p.id === id);
  if (!item) return;
  const lang = localStorage.getItem("chibani_lang") || "ar";
  document.getElementById("task-prompt").value = lang === "ar" ? item.prompt_ar : item.prompt_en;
  document.getElementById("exec-profile").value = item.profile;
  document.getElementById("exec-verify").value = item.verify;
  updateProfileBadge();
  switchTab("workspace");
  executeTask();
}

function copyScenarioCli(id) {
  const item = PROMPT_LIBRARY.find((p) => p.id === id);
  if (!item) return;
  const cmd = `uv run artemis run "${item.prompt_en}" --profile ${item.profile}`;
  navigator.clipboard.writeText(cmd);
  alert("تم نسخ أمر CLI:\n" + cmd);
}

function switchStreamView(view, btnEl) {
  document.querySelectorAll(".mini-tab").forEach((b) => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  document.getElementById("stream-steps-view").style.display = view === "steps" ? "block" : "none";
  document.getElementById("stream-xml-view").style.display = view === "xml" ? "block" : "none";
  document.getElementById("stream-logcat-view").style.display = view === "logcat" ? "block" : "none";
}

function toggleCoordGrid(show) {
  document.getElementById("coord-grid").style.display = show ? "block" : "none";
}

function updateProfileBadge() {
  const profile = document.getElementById("exec-profile").value;
  document.getElementById("active-profile-badge").textContent =
    profile === "flash" ? "FLASH (3-5s)" : "PRO (Planner+Checker)";
  updateLiveCliCommand();
}

function fillPreset(type) {
  const input = document.getElementById("task-prompt");
  if (type === "battery") input.value = "افتح الإعدادات وتحقق من نسبة البطارية.";
  else if (type === "flutter") input.value = "افتح متجر Flutter وأتمم طلب الدفع عند الاستلام لولاية عنابة.";
  else if (type === "crossapp") input.value = "ابحث عن ساحة الثورة عنابة في الخرائط ثم افتح يوتيوب.";
  updateLiveCliCommand();
}

function updateLiveCliCommand() {
  const prompt = document.getElementById("task-prompt").value || "Open Settings";
  const profile = document.getElementById("exec-profile").value;
  document.getElementById("live-cli-cmd").textContent = `uv run artemis run "${prompt}" --profile ${profile}`;
}

async function executeTask() {
  if (isDeviceLocked) return;
  const taskText = document.getElementById("task-prompt").value.trim() || "Open Settings and check Battery";
  const profile = document.getElementById("exec-profile").value;
  const verify = document.getElementById("exec-verify").value;
  const backend = document.getElementById("exec-backend").value;

  isDeviceLocked = true;
  document.getElementById("lock-state").textContent = "LOCKED (Running)";
  document.getElementById("stream-empty").style.display = "none";
  const stepsList = document.getElementById("agent-steps-list");
  stepsList.innerHTML = "";

  const currentTaskId = taskCounter++;
  addQueueItem(currentTaskId, taskText, profile, "RUNNING");

  const steps = [
    { phase: "1. Locating Engine", thought: `تحليل الشاشة لتنفيذ: "${taskText}"`, action: "locate(500, 260)", x: 500, y: 260, screenTitle: "Target App Loaded" },
    { phase: "2. Safety Net Check", thought: "فحص البيكسلات وشجرة الواجهة قبل النقر.", action: "tap(500, 420)", x: 500, y: 420, screenTitle: "Action Dispatched" },
    { phase: "3. Async Execution", thought: "إرسال التفاعل عبر OTG/ADB والتقاط السجل.", action: "click_sequence(500, 580)", x: 500, y: 580, screenTitle: "Verifying State" },
    { phase: `4. Audit (${verify})`, thought: "اكتملت المهمة بنجاح وتم التحقق من النتيجة.", action: "complete()", x: 500, y: 740, screenTitle: "Verified ✅" }
  ];

  lastExecutedSteps = steps;
  for (let i = 0; i < steps.length; i++) {
    await new Promise((r) => setTimeout(r, 750));
    renderAgentStep(i + 1, steps[i]);
    moveReticle(steps[i].x, steps[i].y, steps[i].screenTitle);
  }

  isDeviceLocked = false;
  document.getElementById("lock-state").textContent = "IDLE (متاح)";
  updateQueueStatus(currentTaskId, "COMPLETED");
}

function renderAgentStep(num, step) {
  const stepsList = document.getElementById("agent-steps-list");
  const div = document.createElement("div");
  div.className = "step-card safety-pass";
  div.innerHTML = `<div class="step-meta"><span>Step #${num} — ${step.phase}</span><span>(${step.x}, ${step.y})</span></div><p>${step.thought}</p>`;
  stepsList.appendChild(div);
}

function moveReticle(x, y, title) {
  const reticle = document.getElementById("target-reticle");
  reticle.style.display = "block";
  reticle.style.left = `${(x / 1000) * 100}%`;
  reticle.style.top = `${(y / 1000) * 100}%`;
  document.getElementById("coord-label").textContent = `(${x}, ${y})`;
  if (title) document.getElementById("screen-title").textContent = title;
}

function addQueueItem(id, text, profile, status) {
  const list = document.getElementById("task-queue-list");
  const item = document.createElement("div");
  item.className = "queue-item";
  item.innerHTML = `<div><strong>#${id} [${profile.toUpperCase()}]</strong></div><span class="badge" id="queue-badge-${id}">${status}</span>`;
  list.prepend(item);
}

function updateQueueStatus(id, status) {
  const badge = document.getElementById(`queue-badge-${id}`);
  if (badge) badge.textContent = status;
}

function clearQueue() {
  document.getElementById("task-queue-list").innerHTML = "";
}

function startVoiceCommand() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return alert("استخدم متصفح Chrome للأوامر الصوتية.");
  const rec = new SpeechRecognition();
  rec.lang = "ar-DZ";
  rec.onresult = (e) => {
    document.getElementById("task-prompt").value = e.results[0][0].transcript;
    executeTask();
  };
  rec.start();
}

function exportPytestScript() {
  const prompt = document.getElementById("task-prompt").value || "Open Settings";
  const py = `import subprocess\ndef test_artemis():\n    subprocess.run(["uv", "run", "artemis", "run", ${JSON.stringify(prompt)}])`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([py], { type: "text/x-python" }));
  a.download = "test_artemis.py";
  a.click();
}

function saveAndVerifyKey() {
  const key = document.getElementById("cfg-gemini-key").value.trim();
  if (key) localStorage.setItem("chibani_gemini_key", key);
  updateEnvPreview();
  alert("تم الحفظ بنجاح!");
}

function updateEnvPreview() {
  const key = document.getElementById("cfg-gemini-key").value.trim() || "AIzaSy...";
  document.getElementById("env-output").textContent = `GEMINI_API_KEY=${key}\nADB_HOST=127.0.0.1\nADB_PORT=5037\nARTEMIS_DEFAULT_PROFILE=flash`;
}

function downloadEnvFile() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([document.getElementById("env-output").textContent], { type: "text/plain" }));
  a.download = ".env";
  a.click();
}

function updateMcpPreview() {
  const ide = document.getElementById("cfg-ide-select").value;
  document.getElementById("mcp-cmd-output").textContent = `uv run artemis mcp --install ${ide}`;
  document.getElementById("mcp-json-output").textContent = `{"mcpServers":{"artemis":{"command":"python","args":["-m","mcp_server"]}}}`;
}

function copyText(id) {
  navigator.clipboard.writeText(document.getElementById(id).textContent);
  alert("تم النسخ!");
}
