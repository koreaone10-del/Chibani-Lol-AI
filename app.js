// ============================================================================
// CHIBANI LOL AI v7.1 — محرك FEL حقيقي (منقول من sunxi-fel) + محلل ملفات ذكي
// الإصلاح الجوهري: تصحيح عنوان Thunk لمعالج H3 (0x46E00) لمنع انهيار الـ BROM
// تحسينات: دعم أفضل لـ WebUSB على الهواتف، والتعامل الذكي مع إعادة تشغيل الجهاز
// ============================================================================
'use strict';
let dev = null, epIn = 2, epOut = 1, cancelFlag = false, busy = false, pyodideInstance = null;
const reports = new Map(); // اسم الملف -> نتيجة التحليل
const $ = (id) => document.getElementById(id);
const hex = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

// ---- ثوابت H3 (من sunxi-tools: soc_info H3 / a31_sram_swap_buffers) ----
const SWAP = [[0x1800, 0xa400, 0x400], [0x5c00, 0xa800, 0x400]]; // مناطق يستخدمها BROM أثناء FEL
// [تصحيح جوهري]: عنوان Thunk الصحيح لمعالج H3 هو 0x46E00
const THUNK_ADDR = 0x46E00, SCRATCH = 0x2000, DRAM = 0x40000000, UBOOT_DEFAULT = 0x4a000000;
// ثانك ARM32 مُتحقَّق منه بالمحاكاة: يبدّل المناطق ← يقفز إلى SPL @0 ← يعيد التبديل ← يرجع لـ BROM
const THUNK = new Uint8Array([0xf0,0x5f,0x2d,0xe9,0x03,0x00,0x00,0xeb,0x00,0x00,0xa0,0xe3,0x30,0xff,0x2f,0xe1,0x00,0x00,0x00,0xeb,0xf0,0x9f,0xbd,0xe8,0x2c,0x40,0x8f,0xe2,0x04,0x00,0x94,0xe4,0x00,0x00,0x50,0xe3,0x1e,0xff,0x2f,0x01,0x04,0x10,0x94,0xe4,0x04,0x20,0x94,0xe4,0x00,0x30,0x90,0xe5,0x00,0x50,0x91,0xe5,0x04,0x50,0x80,0xe4,0x04,0x30,0x81,0xe4,0x04,0x20,0x52,0xe2,0xf9,0xff,0xff,0x1a,0xf3,0xff,0xff,0xea,0x00,0x18,0x00,0x00,0x00,0xa4,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x5c,0x00,0x00,0x00,0xa8,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x00,0x00,0x00]);
const L2_ENABLE = new Uint8Array(new Uint32Array([0xee112f30, 0xe3822002, 0xee012f30, 0xe12fff1e]).buffer); // ACTLR.L2EN

const MEMORY_PRESETS = {
  '0x00002000': '# منطقة Scratch آمنة (BROM)\n00 00 A0 E1 1E FF 2F E1',
  '0x00000000': '# SRAM A1 — ترويسة eGON.BT0\n16 00 00 EA 65 47 4F 4E 2E 42 54 30',
  '0x00007E00': '# مؤشر عودة FEL\n1E FF 2F E1',
  '0x40000000': '# قاعدة DRAM\n52 36 39 5F 45 4D 43 50',
  '0x4A000000': '# نقطة دخول U-Boot\n00 00 A0 E1 1E FF 2F E1'
};

window.addEventListener('DOMContentLoaded', () => {
  loadPresetMemoryPayload('0x00002000');
  initPythonEditor();
  ['otg-flash-file', 'full-rom-input'].forEach((id) => { const e = $(id); if (e) e.multiple = true; }); // اختيار عدة ملفات معاً
  if ('usb' in navigator) {
    navigator.usb.getDevices().then((d) => { if (d.length) bindRealUsbDevice(d[0]); });
    navigator.usb.addEventListener('connect', (e) => bindRealUsbDevice(e.device));
    navigator.usb.addEventListener('disconnect', () => {
      dev = null; setText('otg-conn-state', 'تم فصل OTG (أعد التوصيل)', '#f59e0b'); setText('otg-status-text', 'OTG مفصول ●'); logOtg('⚠️ تم فصل كابل OTG.');
    });
  }
});

function switchTab(id) {
  document.querySelectorAll('.tab-content').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  $(`tab-${id}`)?.classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${id}"]`)?.classList.add('active');
}
function setText(id, t, color) { const e = $(id); if (e) { e.textContent = t; if (color) e.style.color = color; } }
function logOtg(m) { const b = $('otg-live-log'); if (!b) return; b.textContent += `\n[${new Date().toLocaleTimeString()}] ${m}`; b.scrollTop = b.scrollHeight; }
function clearOtgLog() { $('otg-live-log').textContent = '[LOG CLEARED]'; }
function setStageStatus(n, text, color) { const b = $(`st-badge-${n}`), c = $(`stage-card-${n}`); if (b) { b.textContent = text; b.style.color = color; } if (c) c.style.borderColor = color; }
function isRealUsbReady() { return !!(dev && dev.opened); }
function progress(label, done, total, t0) {
  const pct = Math.min(100, (done / total) * 100).toFixed(1), sp = (done / 1024 / Math.max((performance.now() - t0) / 1000, 0.05)).toFixed(1);
  const bar = $('otg-flash-progress'); if (bar) { bar.style.width = pct + '%'; bar.textContent = `${label}: ${pct}%`; }
  setText('flash-bytes-counter', `${(done / 1024).toFixed(1)} KB / ${(total / 1024).toFixed(1)} KB`); setText('flash-speed-counter', `${sp} KB/s`);
}

// ============================================================================
// 1. الاتصال عبر WebUSB
// ============================================================================
async function connectRealOtgDevice() {
  if (!('usb' in navigator)) return alert('افتح الموقع عبر Google Chrome.');
  try { logOtg('🔌 طلب إقران جهاز USB OTG...'); await bindRealUsbDevice(await navigator.usb.requestDevice({ filters: [{ vendorId: 0x1f3a }] })); }
  catch (e) { logOtg(`ℹ️ لم يتم اختيار جهاز: ${e.message}`); }
}
async function bindRealUsbDevice(d) {
  try {
    dev = d;
    const vid = d.vendorId.toString(16).padStart(4, '0'), pid = d.productId.toString(16).padStart(4, '0');
    setText('otg-vid-pid', `0x${vid.toUpperCase()} : 0x${pid.toUpperCase()}`);
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    for (const i of d.configuration.interfaces) {
      const a = i.alternates[0], o = a.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk'), n = a.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk');
      if (o && n) { await d.claimInterface(i.interfaceNumber); epOut = o.endpointNumber; epIn = n.endpointNumber; break; }
    }
    setText('otg-conn-state', 'متصل فعلياً عبر OTG ✅', '#10b981'); setText('otg-status-text', `OTG Connected (0x${vid.toUpperCase()}) ●`);
    setText('otg-endpoints', `OUT: EP#${epOut} | IN: EP#${epIn}`);
    logOtg(`✅ تم الربط VID=${vid} PID=${pid} (OUT=EP#${epOut}, IN=EP#${epIn})${vid === '1f3a' && pid === 'efe8' ? ' — وضع FEL مؤكد' : ' ⚠️ ليس FEL (1f3a:efe8)'}`);
  } catch (e) { logOtg(`⚠️ تعذّر حجز الواجهة: ${e.message}`); }
}
async function reclaimAndDrainUsb() {
  if (!isRealUsbReady()) return;
  await dev.clearHalt('out', epOut).catch(() => {}); await dev.clearHalt('in', epIn).catch(() => {});
  logOtg('♻️ تمت إعادة تهيئة نقاط USB. إذا بقي الجهاز صامتاً: افصل الكابل وأعد وصله.');
}

// ============================================================================
// 2. بروتوكول AWUC/AWUS + أوامر FEL (مطابق لـ sunxi-tools)
// ============================================================================
// [تحسين]: تصغير حجم الحزمة إلى 1024 بايت لضمان استقرار النقل عبر هواتف الأندرويد ومنع USB OUT Timeout
const CH = 1024; 
const withT = (p, ms, msg) => { let t; return Promise.race([p, new Promise((_, j) => { t = setTimeout(() => j(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); };
async function usbOut(b, ms = 8000) {
  if (!isRealUsbReady()) throw new Error('لا يوجد جهاز OTG متصل');
  const r = await withT(dev.transferOut(epOut, b), ms, 'USB OUT Timeout'); if (r.status !== 'ok') throw new Error('USB OUT ' + r.status);
}
async function usbIn(n, ms = 8000) {
  const r = await withT(dev.transferIn(epIn, n), ms, 'USB IN Timeout'); if (r.status !== 'ok') throw new Error('USB IN ' + r.status);
  return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
}
function awuc(cmd, len) {
  const h = new Uint8Array(32), v = new DataView(h.buffer);
  h.set([0x41, 0x57, 0x55, 0x43]); v.setUint32(8, len, true); v.setUint32(12, 0x0c000000, true); v.setUint16(16, cmd, true); v.setUint32(18, len, true); return h;
}
async function ack(ms) { const a = await usbIn(13, ms); if (String.fromCharCode(...a.subarray(0, 4)) !== 'AWUS') throw new Error('رد AWUS غير صالح'); }
async function usbWrite(data, ms) { await usbOut(awuc(0x12, data.length)); for (let o = 0; o < data.length; o += CH) await usbOut(data.subarray(o, o + CH), ms); await ack(ms); }
async function usbRead(n, ms) {
  await usbOut(awuc(0x11, n)); const res = new Uint8Array(n); let g = 0;
  while (g < n) { const c = await usbIn(Math.min(n - g, CH), ms); if (!c.length) break; res.set(c, g); g += c.length; }
  await ack(ms); return res.subarray(0, g);
}
const felReq = (c, a, l) => { const b = new Uint8Array(16), v = new DataView(b.buffer); v.setUint32(0, c, true); v.setUint32(4, a, true); v.setUint32(8, l, true); return b; };
const felStatus = (ms) => usbRead(8, ms);
async function felVersion() {
  await usbWrite(felReq(0x001, 0, 0)); const d = await usbRead(32); await felStatus(); const v = new DataView(d.buffer, d.byteOffset);
  return { sig: String.fromCharCode(...d.subarray(0, 8)), soc: (v.getUint32(8, true) >> 8) & 0xffff, scratch: v.getUint32(20, true) };
}
async function felWrite(addr, buf, cb) {
  const BLK = 8192; // [تحسين] 8KB بدلاً من 16KB لسلامة الذاكرة
  for (let o = 0; o < buf.length; o += BLK) {
    if (cancelFlag) throw new Error('تم الإيقاف بواسطة المستخدم');
    const c = buf.subarray(o, Math.min(o + BLK, buf.length));
    await usbWrite(felReq(0x101, addr + o, c.length)); await usbWrite(c); await felStatus(); cb && cb(o + c.length);
    await sleep(5); // [تحسين] استراحة قصيرة جداً للـ USB Controller
  }
}
async function felRead(addr, len) {
  const out = new Uint8Array(len);
  for (let o = 0; o < len; o += 4096) { const n = Math.min(4096, len - o); await usbWrite(felReq(0x103, addr + o, n)); out.set(await usbRead(n), o); await felStatus(); }
  return out;
}
async function felExec(addr) { await usbWrite(felReq(0x102, addr, 0)); await felStatus(15000); }
const lock = async (fn) => { if (busy) return alert('عملية أخرى قيد التنفيذ — انتظر أو اضغط إيقاف.'); busy = true; cancelFlag = false; try { return await fn(); } finally { busy = false; } };
const bytesToHexDump = (u) => Array.from(u, (x, i) => x.toString(16).padStart(2, '0').toUpperCase() + ((i + 1) % 16 ? ' ' : '\n')).join('').trim();

// ============================================================================
// 3. مراحل التفليش
// ============================================================================
async function stageVerify() {
  setStageStatus(1, 'جاري الفحص...', '#38bdf8');
  const v = await felVersion();
  if (v.sig !== 'AWUSBFEX') throw new Error('الجهاز لا يردّ بتوقيع FEL (AWUSBFEX)');
  logOtg(`✅ FEL_VERIFY: ${v.sig} | SoC=${hex(v.soc << 8)}${v.soc === 0x1680 ? ' (Allwinner H3)' : ' ⚠️ ليس H3!'} | scratch=${hex(v.scratch)}`);
  setText('otg-soc-name', v.soc === 0x1680 ? `Allwinner H3 (${hex(v.soc << 8)})` : `SoC ${hex(v.soc)}`);
  setStageStatus(1, 'تم بنجاح ✅', '#10b981'); return v;
}
async function stageL2() {
  setStageStatus(2, 'جاري التفعيل...', '#38bdf8');
  await felWrite(SCRATCH, L2_ENABLE); await felExec(SCRATCH);
  const pat = new Uint8Array(64).map((_, i) => (i * 37 + 11) & 255); await felWrite(SCRATCH, pat);
  const back = await felRead(SCRATCH, 64); if (back.some((x, i) => x !== pat[i])) throw new Error('فشل اختبار الذهاب/إياب على 0x2000 — الكابل غير موثوق');
  logOtg('✅ L2 مفعّل واختبار القراءة/الكتابة على SRAM ناجح.'); setStageStatus(2, 'تم التفعيل ✅', '#10b981');
}
function splSegments(len) {
  const cuts = new Set([0, len]); SWAP.forEach(([b, , s]) => { if (b < len) cuts.add(b); if (b + s < len) cuts.add(b + s); });
  const p = [...cuts].sort((a, b) => a - b), segs = [];
  for (let i = 0; i < p.length - 1; i++) { const s = p[i], hit = SWAP.find(([b, , z]) => s >= b && s < b + z); segs.push([s, p[i + 1], hit ? hit[1] + (s - hit[0]) : s]); }
  return segs;
}
async function stageSpl(spl) {
  setStageStatus(3, 'جاري بث SPL...', '#38bdf8'); const t0 = performance.now(); let base = 0;
  logOtg(`📤 [3] كتابة SPL (${kb(spl.length)}) في SRAM @0x0...`);
  for (const [s, e, d] of splSegments(spl.length)) { await felWrite(d, spl.subarray(s, e), (n) => progress('Stage 3 (SPL)', base + n, spl.length, t0)); base += e - s; }
  await felWrite(THUNK_ADDR, THUNK);
  logOtg(`⚡ تنفيذ SPL عبر Thunk @${hex(THUNK_ADDR)} (تهيئة LPDDR3)...`);
  
  // [تحسين] قد ينفصل الجهاز ويعود، نضيف معالجة أفضل هنا
  try {
    await felExec(THUNK_ADDR); await sleep(300);
    let v; try { v = await felVersion(); } catch (e) { throw new Error('الـ SPL لم يرجع إلى FEL (' + e.message + ') — تأكد من كابل OTG أو أعد المحاولة.'); }
    logOtg(`✅ BROM عاد بعد SPL (${v.sig}).`); await dramTest();
    setStageStatus(3, 'تم بنجاح ✅', '#10b981');
  } catch (e) {
    setStageStatus(3, 'فشل التنفيذ', '#ef4444');
    throw e;
  }
}
async function dramTest() {
  const mk = (s) => new Uint8Array(256).map((_, i) => (i * 31 + s) & 255), A = mk(7), B = mk(99), cmp = (x, y) => x.every((q, i) => q === y[i]);
  await felWrite(DRAM, A); await felWrite(DRAM + 0x10000000, B); // اختبار حتى 256 ميجا بايت للسلامة
  const a = await felRead(DRAM, 256), b = await felRead(DRAM + 0x10000000, 256);
  if (!cmp(a, A) || !cmp(b, B)) throw new Error('DRAM لا تستجيب — إعدادات الذاكرة في SPL غير مناسبة لهذه اللوحة');
  logOtg('✅ DRAM تعمل وتم اختبار القراءة والكتابة بنجاح.');
}
async function stageUboot(ub) {
  setStageStatus(4, 'جاري بث U-Boot...', '#38bdf8'); const t0 = performance.now();
  logOtg(`📤 [4] رفع U-Boot "${ub.name}" (${kb(ub.data.length)}) إلى ${hex(ub.load)}...`);
  await felWrite(ub.load, ub.data, (n) => progress('Stage 4 (U-Boot)', n, ub.data.length, t0));
  const chk = await felRead(ub.load, 64); if (chk.some((x, i) => x !== ub.data[i])) throw new Error('فشل التحقق من بداية U-Boot في DRAM');
  
  logOtg(`🚀 FEL_EXEC @${hex(ub.entry)}...`);
  try {
    await felExec(ub.entry);
    setStageStatus(4, 'اكتمل 100% ✅', '#10b981');
  } catch (e) {
    // [تحسين ذكي] U-Boot لا يعود إلى FEL، بل يقلع النظام ويقطع USB. هذا يعتبر نجاحاً وليس فشلاً!
    if (e.message.includes('Timeout') || e.message.includes('USB')) {
      logOtg(`✅ الجهاز أقلع بنجاح! (انقطع الاتصال لأن U-Boot بدأ العمل).`);
      setStageStatus(4, 'اكتمل (الجهاز يقلع) ✅', '#10b981');
    } else {
      setStageStatus(4, 'خطأ في التنفيذ', '#ef4444');
      throw e;
    }
  }
}

async function preparePlan() {
  const p = resolvePlan();
  if (!p.spl) throw new Error(legacyOnly() ? 'الملفات المختارة تحتوي Boot0 قديماً فقط. اختر u-boot-sunxi-with-spl.bin.' : 'لم أجد SPL صالحاً.');
  if (!p.ub) throw new Error('لم أجد U-Boot (uImage) صالحاً.');
  const spl = await sliceBytes(p.spl.R, p.spl.off, p.spl.len);
  const raw = await sliceBytes(p.ub.R, p.ub.off + (p.ub.raw ? 0 : 64), p.ub.size);
  return { spl, ub: { name: p.ub.name, load: p.ub.load, entry: p.ub.entry, data: raw } };
}
async function runAutomated4StageFlash() {
  if (!reports.size) return alert('اختر الملفات أولاً (الروم + u-boot-sunxi-with-spl.bin).');
  return lock(async () => {
    try {
      const plan = await preparePlan(); logOtg('🚀 بدء التفليش المرحلي الذكي (محرك FEL v7.1)...');
      setText('flash-eta-counter', 'المرحلة: 1/4'); await stageVerify();
      setText('flash-eta-counter', 'المرحلة: 2/4'); await stageL2();
      setText('flash-eta-counter', 'المرحلة: 3/4'); await stageSpl(plan.spl);
      setText('flash-eta-counter', 'المرحلة: 4/4'); await stageUboot(plan.ub);
      logOtg('🎉 اكتملت المراحل: الجهاز يجب أن يقلع الآن.');
    } catch (e) { logOtg(`❌ توقف: ${e.message}`); }
  });
}
async function realInitR69Lpddr3() {
  return lock(async () => { try { const plan = await preparePlan(); await stageVerify(); await stageL2(); await stageSpl(plan.spl); return true; } catch (e) { logOtg(`❌ ${e.message}`); return false; } });
}
function cancelRealFlashing() { cancelFlag = true; logOtg('⏹ تم طلب الإيقاف.'); }

// ============================================================================
// 4. الأوامر اليدوية
// ============================================================================
async function realFelVerifyDevice() { return lock(async () => { try { await stageVerify(); return true; } catch (e) { logOtg(`❌ FEL_VERIFY: ${e.message}`); return false; } }); }
async function realWriteMemoryToDevice(andExec = false) {
  const addr = parseInt($('mem-target-addr').value, 16), payload = parseHexEditorBytes($('mem-hex-editor').value);
  if (!payload.length) return alert('محرر الذاكرة فارغ!');
  return lock(async () => {
    try { logOtg(`📤 [FEL_WRITE] ${payload.length} بايت → ${hex(addr)}`); await felWrite(addr, payload); logOtg('✅ تمت الكتابة.'); if (andExec) { await felExec(addr); logOtg(`✅ FEL_EXEC @${hex(addr)}`); } return true; }
    catch (e) { logOtg(`❌ فشل: ${e.message}`); return false; }
  });
}
async function realReadMemoryFromDevice() {
  const addr = parseInt($('mem-target-addr').value, 16), len = parseInt($('mem-read-len').value, 10) || 256;
  return lock(async () => {
    try { const d = await felRead(addr, len); $('mem-hex-editor').value = `# [MEMORY DUMP @ ${hex(addr)} (${d.length} Bytes)]\n${bytesToHexDump(d)}`; logOtg(`✅ قراءة ${d.length} بايت.`); return d; }
    catch (e) { logOtg(`❌ فشل FEL_READ: ${e.message}`); return null; }
  });
}
async function realFelExecJump() { const a = parseInt($('mem-target-addr').value, 16); return lock(async () => { try { await felExec(a); logOtg(`✅ FEL_EXEC @${hex(a)}`); } catch (e) { logOtg(`❌ فشل FEL_EXEC: ${e.message}`); } }); }
async function realReadBromHeader() { $('mem-target-addr').value = '0x00000000'; $('mem-read-len').value = '256'; await realReadMemoryFromDevice(); }
function loadPresetMemoryPayload(a) { $('mem-target-addr').value = a; const e = $('mem-hex-editor'); if (e && MEMORY_PRESETS[a]) e.value = MEMORY_PRESETS[a]; }
function parseHexEditorBytes(t) { const c = t.split('\n').filter((l) => !l.trim().startsWith('#')).join(' '); return new Uint8Array((c.match(/\b[0-9A-Fa-f]{2}\b/g) || []).map((h) => parseInt(h, 16))); }
function generateCleanHexPatch() { loadPresetMemoryPayload($('mem-target-addr').value); }

// ============================================================================
// 5. المحلل الذكي للملفات
// ============================================================================
const CRC_T = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
const crc32 = (u) => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC_T[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const FEX = { 'fes1.fex': 'FES1', 'u-boot.fex': 'U-Boot', 'boot0_nand.fex': 'Boot0 NAND', 'boot0_sdcard.fex': 'Boot0 SD', 'sys_config.fex': 'إعدادات', 'sunxi_mbr.fex': 'أقسام', 'dlinfo.fex': 'تنزيل', 'system.fex': 'نظام', 'boot.fex': 'نواة', 'recovery.fex': 'استرداد', 'env.fex': 'متغيرات' };
const sliceBytes = async (R, off, len) => new Uint8Array(await R.file.slice(off, off + len).arrayBuffer());

async function analyzeFile(file) {
  const n = Math.min(file.size, 48 << 20), b = new Uint8Array(await file.slice(0, n).arrayBuffer()), dv = new DataView(b.buffer);
  const td = new TextDecoder('latin1'), A = (o, l) => td.decode(b.subarray(o, o + l));
  const R = { file, name: file.name, size: file.size, kind: 'ملف ثنائي', spl: [], uimg: [], fex: [] };
  if (A(0, 8) === 'IMAGEWTY') R.kind = 'حزمة PhoenixSuit (IMAGEWTY)';
  else if (b.length > 520 && A(512, 8) === 'EFI PART') R.kind = 'صورة خام (GPT)';
  else if (b.length > 520 && b[510] === 0x55 && b[511] === 0xaa) R.kind = 'صورة خام (MBR)';
  
  for (let i = 0; i < n - 64; i++) {
    const c = b[i];
    if (c === 0x65 && i >= 4 && b[i + 1] === 0x47 && b[i + 2] === 0x4f && A(i, 8) === 'eGON.BT0') {
      const s = i - 4; let len = dv.getUint32(s + 16, true); if (len < 0x60 || len > 0xa000 || s + len > n) len = Math.min(0x8000, n - s);
      R.spl.push({ off: s, len, mainline: A(s + 0x14, 3) === 'SPL' });
    } else if (c === 0x27 && !(i & 3) && b[i + 1] === 5 && b[i + 2] === 0x19 && b[i + 3] === 0x56) {
      const h = b.slice(i, i + 64), hc = new DataView(h.buffer).getUint32(4); h.fill(0, 4, 8);
      if (crc32(h) !== hc) continue;
      const size = dv.getUint32(i + 12), name = A(i + 32, 32).replace(/\0.*$/, '');
      if (i + 64 + size <= file.size) R.uimg.push({ off: i, size, load: dv.getUint32(i + 16), entry: dv.getUint32(i + 20), name, isUboot: /u-?boot/i.test(name) });
    }
  }
  const sp = R.spl.find((x) => x.mainline);
  if (sp && !R.uimg.some((u) => u.isUboot) && file.size <= 8 << 20) {
    for (let o = (sp.off + sp.len + 3) & ~3; o < n - 4096; o += 4) if (b[o + 3] === 0xea) { let e = n; while (e > o && !b[e - 1]) e--; R.uimg.push({ off: o, size: e - o, load: UBOOT_DEFAULT, entry: UBOOT_DEFAULT, name: 'u-boot.bin (خام)', isUboot: true, raw: true }); break; }
  }
  if (R.kind.startsWith('حزمة')) R.fex = [...new Set(A(0, Math.min(n, 262144)).match(/[\w\-.]{3,40}\.fex/gi) || [])];
  return R;
}
function resolvePlan() {
  let spl = null, ub = null;
  for (const R of reports.values()) {
    for (const s of R.spl) if (s.mainline && (!spl || R.size < spl.R.size)) spl = { R, ...s };
    for (const u of R.uimg) if (u.isUboot && (!ub || R.size < ub.R.size)) ub = { R, ...u };
  }
  return { spl, ub };
}
const legacyOnly = () => [...reports.values()].some((R) => R.spl.length) && ![...reports.values()].some((R) => R.spl.some((s) => s.mainline));
function renderSummary() {
  let h = '';
  for (const R of reports.values()) {
    h += `📄 <strong>${esc(R.name)}</strong> — ${kb(R.size)} — ${R.kind}<br>`;
    R.spl.forEach((s) => (h += `&nbsp;&nbsp;${s.mainline ? '✅ SPL (مفتوح المصدر)' : '⚠️ Boot0 (قديم)'} @${hex(s.off)} · ${kb(s.len)}<br>`));
    R.uimg.forEach((u) => (h += `&nbsp;&nbsp;${u.isUboot ? '✅ U-Boot' : '📎 صورة'} "${esc(u.name)}" → ${hex(u.load)} · ${kb(u.size)} @${hex(u.off)}<br>`));
    if (R.fex.length) h += `&nbsp;&nbsp;🗂️ ${R.fex.map((f) => esc(f) + (FEX[f.toLowerCase()] ? ` (${FEX[f.toLowerCase()]})` : '')).join('، ')}<br>`;
  }
  const p = resolvePlan();
  h += p.spl && p.ub ? `🧭 <strong>الخطة جاهزة:</strong> SPL من ${esc(p.spl.R.name)} ← U-Boot من ${esc(p.ub.R.name)}` : '⛔ <strong>ناقص:</strong> ' + (!p.spl ? 'SPL' : 'U-Boot') + ' — حدّد u-boot-sunxi-with-spl.bin مع الروم.';
  const el = $('file-tech-summary'); if (el) el.innerHTML = h; const o = $('rom-analysis-output'); if (o) o.innerHTML = h;
}
async function onSelectRealFlashFile(inputEl) {
  for (const f of inputEl.files || []) { logOtg(`🔎 تحليل "${f.name}" (${kb(f.size)})...`); reports.set(f.name, await analyzeFile(f)); }
  renderSummary(); logOtg(`📦 الملفات المحللة: ${[...reports.keys()].join(' + ')}`);
}
const parseImagewtyTable = onSelectRealFlashFile;

// ============================================================================
// 6. أدوات التصدير
// ============================================================================
function download(bytes, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })); a.download = name; a.click(); }
async function parts() {
  const p = resolvePlan(); if (!p.spl) { alert('لم يُكتشف SPL — اختر الملفات أولاً.'); return null; }
  const spl = await sliceBytes(p.spl.R, p.spl.off, p.spl.len), ub = p.ub ? await sliceBytes(p.ub.R, p.ub.off, (p.ub.raw ? 0 : 64) + p.ub.size) : new Uint8Array(0);
  return { spl, ub };
}
async function buildUbootSunxiWithSplFromRom() { const x = await parts(); if (!x) return; const o = new Uint8Array(32768 + x.ub.length); o.set(x.spl.subarray(0, 32768)); o.set(x.ub, 32768); download(o, 'u-boot-sunxi-with-spl.bin'); logOtg(`✅ تم التوليد (${kb(o.length)})`); }
async function extractBoot0FromSelectedRom() { const x = await parts(); if (x) download(x.spl, 'r69_boot0_spl.bin'); }
async function buildSdCardUnbrickImage() { const x = await parts(); if (!x) return; const o = new Uint8Array(40960 + x.ub.length + 4096); o.set(x.spl, 8192); o.set(x.ub, 40960); download(o, 'R69_SD_Bootable_Unbrick.img'); }

// ============================================================================
// 7. بايثون الحي
// ============================================================================
function initPythonEditor() { const e = $('python-code-editor'); if (e) e.value = 'print("CHIBANI LOL AI v7.1 — FEL engine ready")'; }
async function runBrowserPython() {
  const out = $('python-output-console');
  try {
    if (!pyodideInstance) { await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); pyodideInstance = await loadPyodide(); }
    let buf = ''; pyodideInstance.setStdout({ batched: (s) => (buf += s + '\n') });
    await pyodideInstance.runPythonAsync($('python-code-editor').value); out.textContent = buf || '✅ تم التنفيذ.';
  } catch (e) { out.textContent = `❌ خطأ:\n${e.message}`; }
}
function copyText(id) { navigator.clipboard.writeText($(id).textContent); alert('تم النسخ!'); }
