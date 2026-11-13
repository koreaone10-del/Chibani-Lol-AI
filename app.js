(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let selectedFile = null;
  let latestReport = null;
  let usbDevice = null;
  const signatures = [
    ["IMAGEWTY", [0x49,0x4d,0x41,0x47,0x45,0x57,0x54,0x59]],
    ["imgRePacker", [0x69,0x6d,0x67,0x52,0x65,0x50,0x61,0x63,0x6b,0x65,0x72]],
    ["eGON.BT0", [0x65,0x47,0x4f,0x4e,0x2e,0x42,0x54,0x30]],
    ["ANDROID!", [0x41,0x4e,0x44,0x52,0x4f,0x49,0x44,0x21]],
    ["BOOTPKG", [0x42,0x4f,0x4f,0x54,0x50,0x4b,0x47]],
    ["UBOOT_", [0x55,0x42,0x4f,0x4f,0x54,0x5f]],
    ["u-boot", [0x75,0x2d,0x62,0x6f,0x6f,0x74]],
    ["BOOT0", [0x42,0x4f,0x4f,0x54,0x30]]
  ];
  function log(message, level="info") {
    const row=document.createElement("div"); row.className="log-line";
    const time=document.createElement("time"); time.textContent=new Date().toLocaleTimeString("en-GB");
    const msg=document.createElement("span"); msg.textContent=(level==="error"?"ERROR / ":level==="ok"?"OK / ":"INFO / ")+message;
    row.append(time,msg); $("console").append(row); $("console").scrollTop=$("console").scrollHeight;
  }
  function hex(n){return "0x"+n.toString(16).toUpperCase().padStart(8,"0")}
  function updateProgress(done,total,status){const p=total?Math.min(100,done/total*100):0;$("scan-progress").style.width=p+"%";$("scan-percent").textContent=p.toFixed(1)+"%";$("scan-status").textContent=status;}
  $("firmware-file").addEventListener("change",e=>{
    selectedFile=e.target.files&&e.target.files[0]; latestReport=null; $("scan-btn").disabled=!selectedFile; $("report-btn").disabled=true;
    if(selectedFile){$("fw-state").textContent="جاهز للفحص";$("fw-size").textContent=(selectedFile.size/1024/1024).toFixed(2)+" MiB";log("تم اختيار "+selectedFile.name+" ("+selectedFile.size+" bytes).");}
  });
  $("scan-btn").addEventListener("click",scanFirmware);
  $("report-btn").addEventListener("click",downloadReport);
  $("clear-log").addEventListener("click",()=>{$("console").replaceChildren();log("تم مسح السجل.");});
  $("pair-btn").addEventListener("click",pairUsb);
  $("forget-btn").addEventListener("click",()=>{usbDevice=null;renderUsb();log("تم مسح بيانات الجهاز من الواجهة.");});
  async function scanFirmware(){
    if(!selectedFile)return;
    $("scan-btn").disabled=true;$("report-btn").disabled=true;$("fw-state").textContent="جارٍ التحليل";
    const result={fileName:selectedFile.name,sizeBytes:selectedFile.size,lastModified:new Date(selectedFile.lastModified).toISOString(),scannedAt:new Date().toISOString(),method:"4 MiB sequential local scan",signatures:{},notes:[]};
    signatures.forEach(([name])=>result.signatures[name]=[]);
    const chunkSize=4*1024*1024, overlap=64; let offset=0,carry=new Uint8Array(0);
    try{
      while(offset<selectedFile.size){
        const end=Math.min(offset+chunkSize,selectedFile.size);
        const bytes=new Uint8Array(await selectedFile.slice(offset,end).arrayBuffer());
        const combined=new Uint8Array(carry.length+bytes.length);combined.set(carry);combined.set(bytes,carry.length);
        const base=offset-carry.length;
        for(const [name,needle] of signatures){
          const hits=result.signatures[name];let from=0;
          while(from<=combined.length-needle.length){
            let at=-1;
            outer:for(let i=from;i<=combined.length-needle.length;i++){for(let j=0;j<needle.length;j++)if(combined[i+j]!==needle[j])continue outer;at=i;break;}
            if(at<0)break;
            const absolute=base+at;if(absolute>=0 && hits.length<100)hits.push(absolute);
            from=at+needle.length;
          }
        }
        carry=combined.slice(Math.max(0,combined.length-overlap));
        offset=end;updateProgress(offset,selectedFile.size,"قراءة "+(offset/1024/1024).toFixed(1)+" / "+(selectedFile.size/1024/1024).toFixed(1)+" MiB");
        await new Promise(r=>setTimeout(r,0));
      }
      const header=new Uint8Array(await selectedFile.slice(0,64).arrayBuffer());
      result.headerHex=Array.from(header).map(x=>x.toString(16).padStart(2,"0")).join(" ");
      result.signatureCounts=Object.fromEntries(Object.entries(result.signatures).map(([k,v])=>[k,v.length]));
      result.notes.push("التواقيع هي مواقع بايتات مرصودة وليست دليلاً على حدود الأقسام أو صلاحية ملفات الإقلاع.");
      result.notes.push("لم يتم فك حاوية IMAGEWTY أو التحقق من التوافق مع لوحة R69.");
      result.notes.push("لم يتم تعديل ملف Firmware أو إرساله إلى خادم.");
      latestReport=result;renderFindings(result);$("fw-state").textContent="اكتمل الفحص";$("report-btn").disabled=false;log("اكتمل مسح الملف. عدد أنواع التواقيع المرصودة: "+Object.values(result.signatureCounts).filter(Boolean).length,"ok");
    }catch(err){$("fw-state").textContent="فشل الفحص";log("تعذر تحليل الملف: "+err.message,"error");}
    finally{$("scan-btn").disabled=false;}
  }
  function renderFindings(r){
    const box=$("scan-summary");box.replaceChildren();const grid=document.createElement("div");grid.className="finding-grid";
    for(const [name,offsets] of Object.entries(r.signatures)){const item=document.createElement("div");item.className="finding";const label=document.createElement("b");label.textContent=name;const value=document.createElement("code");value.textContent=offsets.length?(offsets.slice(0,3).map(hex).join(", ")+(offsets.length>3?" …":"")):"NOT FOUND";item.append(label,value);grid.append(item);}
    box.append(grid);const foot=document.createElement("p");foot.className="muted";foot.textContent="Header (first 64 bytes): "+r.headerHex;box.append(foot);
  }
  function downloadReport(){
    if(!latestReport)return;const blob=new Blob([JSON.stringify(latestReport,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="ARTEMIS-R69-firmware-report.json";a.click();URL.revokeObjectURL(a.href);log("تم تنزيل تقرير JSON.","ok");
  }
  async function pairUsb(){
    if(!("usb" in navigator)){log("WebUSB غير مدعوم في هذا المتصفح. جرّب Chrome على Android مع صفحة HTTPS.","error");return;}
    try{
      usbDevice=await navigator.usb.requestDevice({filters:[{vendorId:0x1f3a,productId:0xefe8}]});
      renderUsb();log("تم اختيار جهاز USB. تمت قراءة بيانات التعريف فقط؛ لم يتم فتح interface أو إرسال بيانات.","ok");
    }catch(err){if(err.name!=="NotFoundError")log("تعذر إقران USB: "+err.message,"error");}
  }
  function renderUsb(){
    if(!usbDevice){$("usb-state").textContent="غير متصل";$("usb-id").textContent="بانتظار الإقران";$("usb-device-name").textContent="لا يوجد جهاز مختار";$("usb-device-detail").textContent="VID: —  PID: —";return;}
    const vid=usbDevice.vendorId.toString(16).padStart(4,"0").toUpperCase(),pid=usbDevice.productId.toString(16).padStart(4,"0").toUpperCase();
    $("usb-state").textContent="تم اختياره";$("usb-id").textContent="تعريف USB متاح";$("usb-device-name").textContent=usbDevice.productName||"USB Device";$("usb-device-detail").textContent="VID: 0x"+vid+"  PID: 0x"+pid;
  }
  if(!window.isSecureContext)log("تنبيه: WebUSB يتطلب سياق HTTPS أو localhost.");
  if(!("usb" in navigator))log("WebUSB غير متاح في هذا المتصفح؛ تحليل Firmware المحلي يبقى متاحاً.");
})();