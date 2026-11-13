(() => {
"use strict";
const $ = id => document.getElementById(id);
const state = { file:null, report:null, device:null, claimed:false, iface:null, endpoints:null, usbDescription:null };
const signatures = [
 ["IMAGEWTY","IMAGEWTY".split("").map(c=>c.charCodeAt(0))],
 ["imgRePacker","imgRePacker".split("").map(c=>c.charCodeAt(0))],
 ["eGON.BT0","eGON.BT0".split("").map(c=>c.charCodeAt(0))],
 ["ANDROID!","ANDROID!".split("").map(c=>c.charCodeAt(0))],
 ["BOOTPKG","BOOTPKG".split("").map(c=>c.charCodeAt(0))],
 ["UBOOT_","UBOOT_".split("").map(c=>c.charCodeAt(0))],
 ["TOC1","TOC1".split("").map(c=>c.charCodeAt(0))],
 ["AVB0","AVB0".split("").map(c=>c.charCodeAt(0))]
];
function log(message, level="info"){
 const row=document.createElement("div");row.className="log-line";
 const time=document.createElement("time");time.textContent=new Date().toLocaleTimeString("en-GB");
 const msg=document.createElement("span");msg.textContent=(level==="error"?"ERROR / ":level==="ok"?"OK / ":"INFO / ")+message;
 row.append(time,msg);$("console").append(row);$("console").scrollTop=$("console").scrollHeight;
}
function setProgress(done,total,status){const p=total?Math.min(100,done/total*100):0;$("scan-progress").style.width=p+"%";$("scan-percent").textContent=p.toFixed(1)+"%";$("scan-status").textContent=status;}
function hex(n){return "0x"+n.toString(16).toUpperCase().padStart(8,"0");}
function fmtSize(n){return (n/1024/1024).toFixed(2)+" MiB";}
function ascii(bytes, at, chars){if(at+chars.length>bytes.length)return false;for(let i=0;i<chars.length;i++)if(bytes[at+i]!==chars.charCodeAt(i))return false;return true;}

$("firmware-file").addEventListener("change",e=>{
 state.file=e.target.files?.[0]||null;state.report=null;$("scan-btn").disabled=!state.file;$("report-btn").disabled=true;$("diagnose-btn").disabled=true;
 if(state.file){$("fw-state").textContent="جاهز للفحص";$("fw-size").textContent=fmtSize(state.file.size);$("scan-summary").textContent="الملف جاهز. ابدأ التحليل.";log(`تم اختيار ${state.file.name} (${state.file.size} bytes).`);}
});
$("scan-btn").addEventListener("click",scanFirmware);
$("report-btn").addEventListener("click",downloadReport);
$("pair-btn").addEventListener("click",pairUsb);
$("forget-btn").addEventListener("click",disconnectUsb);
$("clear-log").addEventListener("click",()=>{$("console").replaceChildren();log("تم مسح السجل.");});
$("diagnose-btn").addEventListener("click",buildDiagnosis);
$("copy-btn").addEventListener("click",copyDiagnosis);
function updateUsb(){
 const d=state.device;
 if(!d){$("usb-state").textContent="غير متصل";$("usb-id").textContent="VID:PID غير معروف";$("usb-device-name").textContent="لا يوجد جهاز مختار";$("usb-device-detail").textContent="VID: — / PID: —";$("ai-usb").textContent="غير متصل";$("usb-descriptors").textContent="بانتظار اتصال USB...";return;}
 const vid=d.vendorId.toString(16).padStart(4,"0").toUpperCase(),pid=d.productId.toString(16).padStart(4,"0").toUpperCase();
 $("usb-state").textContent=d.opened?"مفتوح للفحص":"تم اختياره";$("usb-id").textContent=`${vid}:${pid}`;$("usb-device-name").textContent=d.productName||"USB Device";$("usb-device-detail").textContent=`VID: 0x${vid} / PID: 0x${pid}`;
 $("ai-usb").textContent=`${vid}:${pid} — descriptors`;
}
async function pairUsb(){
 if(!navigator.usb){log("WebUSB غير مدعوم. افتح الموقع عبر Chrome Android وHTTPS.","error");return;}
 try{
  const device=await navigator.usb.requestDevice({filters:[{vendorId:0x1f3a,productId:0xefe8}]});
  await inspectUsb(device);
 }catch(e){if(e.name!=="NotFoundError")log("فشل إقران USB: "+e.message,"error");}
}
async function inspectUsb(device){
 try{
  if(state.device&&state.device!==device)await disconnectUsb();
  state.device=device;
  if(!device.opened)await device.open();
  let selectedConfig=device.configuration;
  if(!selectedConfig){
   const cfg=device.configurations?.[0];
   if(!cfg)throw new Error("الجهاز لا يعرض USB configuration.");
   await device.selectConfiguration(cfg.configurationValue);selectedConfig=device.configuration;
  }
  const desc=[];
  desc.push(`DEVICE ${device.vendorId.toString(16).padStart(4,"0")}:${device.productId.toString(16).padStart(4,"0")}`);
  desc.push(`Manufacturer: ${device.manufacturerName||"unknown"} | Product: ${device.productName||"unknown"}`);
  desc.push(`Configurations: ${device.configurations.length}`);
  let chosen=null;
  for(const cfg of device.configurations){
   desc.push(`\nCONFIG ${cfg.configurationValue}`);
   for(const iface of cfg.interfaces){
    desc.push(` Interface ${iface.interfaceNumber} (claimed=${iface.claimed})`);
    for(const alt of iface.alternates){
     desc.push(`  Alternate ${alt.alternateSetting} class=${alt.interfaceClass} subclass=${alt.interfaceSubclass} protocol=${alt.interfaceProtocol}`);
     for(const ep of alt.endpoints){
      desc.push(`   EP${ep.endpointNumber} ${ep.direction} ${ep.type} packet=${ep.packetSize}`);
     }
     const bulk=alt.endpoints.filter(x=>x.type==="bulk");
     const out=bulk.find(x=>x.direction==="out"),input=bulk.find(x=>x.direction==="in");
     if(!chosen&&out&&input)chosen={iface:iface.interfaceNumber,alt:alt.alternateSetting,in:input.endpointNumber,out:out.endpointNumber};
    }
   }
  }
  if(chosen){
   await device.claimInterface(chosen.iface);state.claimed=true;state.iface=chosen.iface;state.endpoints=chosen;
   if(chosen.alt)await device.selectAlternateInterface(chosen.iface,chosen.alt);
   desc.push(`\nSELECTED BULK PAIR: IF${chosen.iface} ALT${chosen.alt} OUT=${chosen.out} IN=${chosen.in}`);
  }else desc.push("\nNo Bulk IN/OUT pair found.");
  desc.push("\nSAFETY: no FEL command, USB transfer, RAM read/write or flash was performed.");
  state.usbDescription=desc.join("\n");$("usb-descriptors").textContent=state.usbDescription;updateUsb();
  log("تم فتح USB وفحص أوصاف الواجهات ونقاط النهاية فقط. لم تُرسل أي بيانات.", "ok");
 }catch(e){log("تعذر فتح/فحص USB: "+e.message,"error");await disconnectUsb();}
}
async function disconnectUsb(){
 const d=state.device;
 try{if(d?.opened&&state.claimed&&state.iface!==null)await d.releaseInterface(state.iface).catch(()=>{});if(d?.opened)await d.close().catch(()=>{});}finally{
  state.device=null;state.claimed=false;state.iface=null;state.endpoints=null;state.usbDescription=null;updateUsb();log("تم إغلاق اتصال USB.");
 }
}
if(navigator.usb){
 navigator.usb.addEventListener("disconnect",e=>{if(state.device===e.device){state.device=null;state.claimed=false;state.iface=null;state.endpoints=null;updateUsb();log("انقطع جهاز USB.","error");}});
 navigator.usb.getDevices().then(devices=>{const known=devices.find(d=>d.vendorId===0x1f3a&&d.productId===0xefe8);if(known)log("يوجد جهاز سبق منحه الإذن. اضغط إقران لإعادة فتحه.");}).catch(()=>{});
}
async function scanFirmware(){
 const file=state.file;if(!file)return;
 $("scan-btn").disabled=true;$("report-btn").disabled=true;$("fw-state").textContent="جارٍ التحليل";
 const result={application:"ARTEMIS R69",version:"4.0",fileName:file.name,sizeBytes:file.size,lastModified:new Date(file.lastModified).toISOString(),scannedAt:new Date().toISOString(),method:"Sequential local scan, 4 MiB chunks",signatureOffsets:{},notes:[]};
 signatures.forEach(([n])=>result.signatureOffsets[n]=[]);
 const chunkSize=4*1024*1024,overlap=64;let offset=0,carry=new Uint8Array(0);
 try{
  while(offset<file.size){
   const end=Math.min(offset+chunkSize,file.size),part=new Uint8Array(await file.slice(offset,end).arrayBuffer());
   const combined=new Uint8Array(carry.length+part.length);combined.set(carry);combined.set(part,carry.length);const base=offset-carry.length;
   for(const [name,needle] of signatures){
    const hits=result.signatureOffsets[name];
    for(let i=0;i<=combined.length-needle.length;i++){
     let match=true;for(let j=0;j<needle.length;j++)if(combined[i+j]!==needle[j]){match=false;break;}
     if(match&&base+i>=0&&hits.length<200)hits.push(base+i);
    }
   }
   carry=combined.slice(Math.max(0,combined.length-overlap));offset=end;
   setProgress(offset,file.size,`قراءة ${fmtSize(offset)} / ${fmtSize(file.size)}`);await new Promise(r=>setTimeout(r,0));
  }
  const header=new Uint8Array(await file.slice(0,96).arrayBuffer());
  result.headerHex=Array.from(header).map(x=>x.toString(16).padStart(2,"0")).join(" ");
  result.signatureCounts=Object.fromEntries(Object.entries(result.signatureOffsets).map(([k,v])=>[k,v.length]));
  result.imagewtyCandidate=result.signatureOffsets.IMAGEWTY.includes(0);
  result.notes.push("هذه نتائج تواقيع بايتية وليست فكاً كاملاً لحاوية IMAGEWTY.");
  result.notes.push("لم يتم إثبات حدود ملفات الروم أو سلامة checksums أو توافق اللوحة.");
  result.notes.push("لم يتم إرسال الملف إلى خادم أو تعديله.");
  state.report=result;renderFindings(result);$("fw-state").textContent="اكتمل الفحص";$("report-btn").disabled=false;$("diagnose-btn").disabled=false;
  $("ai-container").textContent=result.imagewtyCandidate?"IMAGEWTY signature":"غير مؤكد";
  const bootFound=["eGON.BT0","BOOTPKG","TOC1","ANDROID!"].filter(n=>result.signatureCounts[n]>0);
  $("ai-boot").textContent=bootFound.length?bootFound.join(" / "):"لم تُرصد تواقيع";
  log(`اكتمل مسح ${file.name}. عدد التواقيع ذات النتائج: ${Object.values(result.signatureCounts).filter(Boolean).length}.`,"ok");
 }catch(e){$("fw-state").textContent="فشل الفحص";log("خطأ تحليل الملف: "+e.message,"error");}
 finally{$("scan-btn").disabled=false;}
}
function renderFindings(r){
 const box=$("scan-summary");box.replaceChildren();const grid=document.createElement("div");grid.className="finding-grid";
 for(const [name,offsets] of Object.entries(r.signatureOffsets)){
  const item=document.createElement("div");item.className="finding";const label=document.createElement("b");label.textContent=name;const value=document.createElement("code");value.textContent=offsets.length?offsets.slice(0,3).map(hex).join(", ")+(offsets.length>3?" …":""):"NOT FOUND";item.append(label,value);grid.append(item);
 }
 box.append(grid);const note=document.createElement("p");note.className="muted";note.textContent=`حجم الملف: ${r.sizeBytes} bytes | Header (96 bytes): ${r.headerHex.slice(0,180)}…`;box.append(note);
}
function buildDiagnosis(){
 if(!state.report){log("حلل ملف الروم أولاً.","error");return;}
 const r=state.report,usb=state.device;
 const counts=r.signatureCounts||{};
 const found=Object.keys(counts).filter(k=>counts[k]>0);
 const lines=[
  "ARTEMIS R69 — RECOVERY DIAGNOSTIC REPORT",
  `Firmware: ${r.fileName}`,
  `Size: ${r.sizeBytes} bytes`,
  `IMAGEWTY signature at offset zero: ${r.imagewtyCandidate?"YES":"NOT CONFIRMED"}`,
  `Detected signatures: ${found.length?found.join(", "):"none"}`,
  `USB: ${usb?`VID ${usb.vendorId.toString(16)} / PID ${usb.productId.toString(16)}, opened=${usb.opened}`:"not connected"}`,
  `USB interface claimed: ${state.claimed?"yes":"no"}`,
  "",
  "KNOWN DEVICE CONTEXT (provided earlier):",
  "- R69-EMCP v2.0; Allwinner H3 reported.",
  "- ROM container reported as IMAGEWTY, about 1.36 GiB, 37 entries.",
  "- sys_config.fex reports machine=dolphin-p1; this does not prove PCB identity.",
  "- Boot0/boot package and DRAM profile require independent board matching.",
  "",
  "VERDICT: NOT CLEARED FOR FLASH.",
  "Reasons: PCB revision, DRAM part/configuration, eMMC geometry and exact partition mapping are not independently verified.",
  "No FEL command was sent. No device memory was read or written.",
  "",
  "This is a transparent rule-based report, not an output from a remote generative AI model."
 ];
 $("ai-report").textContent=lines.join("\n");
 $("ai-verdict").textContent="NOT CLEARED";$("ai-verdict").className="amber";
 log("تم إنشاء تقرير تشخيص مبني على نتائج الفحص والحقائق المتاحة. الحالة: غير مصرح بالفلاش.","ok");
}
function copyDiagnosis(){
 const t=$("ai-report").textContent;
 if(!t||t.startsWith("اختر")){log("أنشئ تقرير التشخيص أولاً.","error");return;}
 navigator.clipboard?.writeText(t).then(()=>log("تم نسخ التقرير.","ok")).catch(()=>log("تعذر النسخ التلقائي؛ حدد النص وانسخه."));
}
function downloadReport(){
 if(!state.report)return;
 const payload={...state.report,usbDescription:state.usbDescription,diagnostic:$("ai-report").textContent};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob);
 const a=document.createElement("a");a.href=url;a.download="ARTEMIS-R69-report.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);log("تم تنزيل تقرير JSON.","ok");
}
if(!window.isSecureContext)log("تنبيه: WebUSB يتطلب HTTPS أو localhost.");
if(!navigator.usb)log("WebUSB غير متاح في هذا المتصفح؛ تحليل الروم المحلي يبقى متاحاً.");
log("ARTEMIS R69 v4.0 جاهز. مركز الفلاش مقفول حتى التحقق الهندسي من التوافق.");
})();