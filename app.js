// ============================================================================
// CHIBANI LOL AI v20.0 — PURE FES1 INJECTOR & DRAM TESTER
// ============================================================================

const MICRO_CHUNK_SIZE = 1024; 
const USB_TIMEOUT_MS = 5000;  
const DRAM_TEST_ADDR = 0x40000000; 

let connectedOtgDevice = null;
let otgEndpointIn = 2;
let otgEndpointOut = 1;
let selectedRealFile = null;

window.addEventListener("DOMContentLoaded", () => {
  if ("usb" in navigator) {
    navigator.usb.getDevices().then((devs) => { if (devs.length > 0) bindRealUsbDevice(devs[0]); });
    navigator.usb.addEventListener("connect", (e) => bindRealUsbDevice(e.device));
  }
});

function logAi(msg) {
  const box = document.getElementById("console");
  if (box) { box.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`; box.scrollTop = box.scrollHeight; }
}

function isRealUsbReady() { return Boolean(connectedOtgDevice && connectedOtgDevice.opened); }

async function bindRealUsbDevice(device) {
  try {
    connectedOtgDevice = device;
    if (!device.opened) await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    for (const iface of device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        const epOut = alt.endpoints.find((e) => e.direction === "out");
        const epIn = alt.endpoints.find((e) => e.direction === "in");
        if (epOut && epIn) {
          await device.claimInterface(iface.interfaceNumber);
          otgEndpointOut = epOut.endpointNumber;
          otgEndpointIn = epIn.endpointNumber;
          break;
        }
      }
    }
    logAi("✅ تم الاتصال بالجهاز.");
    return true;
  } catch (err) { logAi(`❌ فشل الاتصال: ${err.message}`); return false; }
}

// --- دوال FEL الأساسية ---
const AW_USB_WRITE = 0x12;
const AW_USB_READ = 0x11;

function build32ByteAwucWrapper(dir, len) {
  const buf = new ArrayBuffer(32); const v = new DataView(buf);
  v.setUint8(0, 0x41); v.setUint8(1, 0x57); v.setUint8(2, 0x55); v.setUint8(3, 0x43);
  v.setUint32(8, len, true); v.setUint8(15, 0x0c); v.setUint8(16, dir); v.setUint32(18, len, true);
  return new Uint8Array(buf);
}

function build16ByteFelRequest(cmd, addr, len) {
  const buf = new ArrayBuffer(16); const v = new DataView(buf);
  v.setUint32(0, cmd, true); v.setUint32(4, addr, true); v.setUint32(8, len, true);
  return new Uint8Array(buf);
}

async function rawOut(bytes) {
  return await Promise.race([connectedOtgDevice.transferOut(otgEndpointOut, bytes), new Promise((_, rej) => setTimeout(() => rej(new Error("USB OUT Timeout")), USB_TIMEOUT_MS))]);
}
async function rawIn(len) {
  const res = await Promise.race([connectedOtgDevice.transferIn(otgEndpointIn, len), new Promise((_, rej) => setTimeout(() => rej(new Error("USB IN Timeout")), USB_TIMEOUT_MS))]);
  return res.data;
}
async function sunxiUsbBulkWrite(payload) {
  await rawOut(build32ByteAwucWrapper(AW_USB_WRITE, payload.byteLength));
  await rawOut(payload);
  try { await rawIn(13); } catch (_) {}
}
async function sunxiUsbBulkRead(len) {
  await rawOut(build32ByteAwucWrapper(AW_USB_READ, len));
  const d = await rawIn(len).catch(() => null);
  try { await rawIn(13); } catch (_) {}
  return d ? new Uint8Array(d.buffer) : new Uint8Array(0);
}
async function sunxiSendFelRequest(cmd, addr, len) { await sunxiUsbBulkWrite(build16ByteFelRequest(cmd, addr, len)); }
async function sunxiReadFelStatus() { return await sunxiUsbBulkRead(8).catch(() => new Uint8Array(8)); }

async function felWriteMemory(addr, bytes) {
  for (let offset = 0; offset < bytes.byteLength; offset += MICRO_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(offset + MICRO_CHUNK_SIZE, bytes.byteLength));
    await sunxiSendFelRequest(0x0101, addr + offset, chunk.byteLength);
    await sunxiUsbBulkWrite(chunk);
    await sunxiReadFelStatus();
  }
}

async function felReadMemory(addr, len) {
  await sunxiSendFelRequest(0x0103, addr, len);
  return await sunxiUsbBulkRead(len);
}

// --- اختبار الذاكرة ---
async function verifyDram() {
  const pattern = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
  try {
    await felWriteMemory(DRAM_TEST_ADDR, pattern);
    const readBack = await felReadMemory(DRAM_TEST_ADDR, pattern.length);
    for (let i = 0; i < pattern.length; i++) { if (readBack[i] !== pattern[i]) return false; }
    return true;
  } catch (e) { return false; }
}

// --- الوظيفة الرئيسية ---
async function runPureFes1Test() {
  const fileInput = document.getElementById("fileInput");
  if (!fileInput.files[0]) return alert("اختر ملف my_fes1.fex أو my_boot0.bin أولاً!");
  
  const file = fileInput.files[0];
  const fes1Bytes = new Uint8Array(await file.arrayBuffer());
  
  if (!isRealUsbReady()) {
    const dev = await navigator.usb.requestDevice({ filters: [] });
    await bindRealUsbDevice(dev);
  }

  logAi(`🚀 بدء الاختبار باستخدام الملف: ${file.name} (${(fes1Bytes.byteLength/1024).toFixed(1)} KB)`);

  // العناوين المحتملة لـ H3
  const addresses = [0x00002000, 0x00020000, 0x00010000, 0x00000000];

  for (const addr of addresses) {
    logAi(`🔍 محاولة الحقن في العنوان: ${addr.toString(16).toUpperCase().padStart(8, '0')}...`);
    try {
      await sunxiSendFelRequest(0x0001, 0, 0); // إعادة تعيين FEL
      await sunxiUsbBulkRead(32);
      
      await felWriteMemory(addr, fes1Bytes);
      
      // تنفيذ الكود
      try { await sunxiSendFelRequest(0x0102, addr, 0); } catch (_) {}
      await new Promise(r => setTimeout(r, 1000)); 
      
      logAi(`🔬 جاري اختبار الذاكرة...`);
      if (await verifyDram()) {
        logAi(`🎉🎉 نجح الاختبار! الذاكرة تعمل في العنوان ${addr.toString(16).toUpperCase()}`);
        return; // نجحنا!
      } else {
        logAi(`❌ الذاكرة لم تستجب في هذا العنوان.`);
      }
    } catch (err) {
      logAi(`⚠️ فشل الاتصال: ${err.message}`);
    }
  }
  logAi(`🚨 فشلت جميع المحاولات. الملف غير متوافق أو أن العتاد تالف.`);
}

function initUI() {
  document.body.innerHTML = `
    <div style="padding:20px; font-family:sans-serif; background:#0f172a; color:#fff; min-height:100vh;">
      <h2 style="color:#8b5cf6;">🧪 مختبر الذاكرة الصافي (FES1 Tester)</h2>
      <p style="color:#94a3b8; font-size:14px;">اختر الملف المستخرج من Termux (my_fes1.fex أو my_boot0.bin)</p>
      <input type="file" id="fileInput" style="margin:10px 0; background:#1e293b; padding:10px; border-radius:8px; width:100%;">
      <button onclick="runPureFes1Test()" style="background:#8b5cf6; color:#fff; padding:15px; border:none; border-radius:8px; font-weight:bold; width:100%; font-size:16px; cursor:pointer;">
        🔥 حقن واختبار الذاكرة
      </button>
      <pre id="console" style="background:#000; color:#10b981; padding:10px; margin-top:20px; height:400px; overflow-y:auto; font-size:12px; white-space:pre-wrap;">جاهز...</pre>
    </div>
  `;
}
initUI();
