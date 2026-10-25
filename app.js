// Schallpegel-Messer · alles läuft im Browser, nichts wird hochgeladen
(function(){
  "use strict";
  var VERSION="1.0.2";
  var $=function(s){ return document.querySelector(s); };
  var CSS=getComputedStyle(document.documentElement);
  var C=function(n){ return CSS.getPropertyValue(n).trim(); };

  /* ---------- Einstellungen: Gerät (localStorage), darüber die Adresszeile ---------- */
  var cfg={off:0,y:95,r:99,pk:135,dev:"",ch:0,tw:"f",ev:"",ort:"",wer:"",res:10,vu:50,vo:110,svc:"10:00, 12:00, 16:00",dur:90,
           lang:/^de\b/i.test(navigator.language||"")?"de":"en"};
  var ZAHLEN=["off","y","r","pk","ch","res","dur","vu","vo"],TEXTE_=["dev","tw","ev","ort","wer","svc","lang"];
  function uebernehmen(k,v){
    if(ZAHLEN.indexOf(k)>=0){ var n=parseFloat(v); if(isFinite(n)) cfg[k]=n; }
    else if(TEXTE_.indexOf(k)>=0) cfg[k]=String(v);
  }
  try{ var gesp=JSON.parse(localStorage.getItem("spl-cfg")||"{}"); Object.keys(gesp).forEach(function(k){ uebernehmen(k,gesp[k]); }); }catch(e){}
  (function(){
    var h=location.hash.replace(/^#/,""); if(!h) return;
    h.split("&").forEach(function(p){ var kv=p.split("="); uebernehmen(kv[0],decodeURIComponent(kv[1]||"")); });
  })();
  if(cfg.lang!=="de"&&cfg.lang!=="en") cfg.lang="en";

  /* ---------- Sprache ---------- */
  function t(k){
    var s=(TEXTE[cfg.lang]||TEXTE.de)[k]; if(s===undefined) s=TEXTE.de[k]; if(s===undefined) return k;
    var a=arguments; return typeof s==="string"?s.replace(/\{(\d)\}/g,function(_,i){ return a[+i+1]; }):s;
  }
  function uebersetzen(){
    document.documentElement.lang=cfg.lang;
    document.querySelectorAll("[data-t]").forEach(function(e){ e.textContent=t(e.dataset.t); });
    document.querySelectorAll("[data-t-html]").forEach(function(e){ e.innerHTML=t(e.dataset.tHtml); });
    document.querySelectorAll("[data-t-ph]").forEach(function(e){ e.placeholder=t(e.dataset.tPh); });
    document.querySelectorAll("[data-t-title]").forEach(function(e){ e.title=t(e.dataset.tTitle); e.setAttribute("aria-label",t(e.dataset.tTitle)); });
    document.querySelectorAll("[data-t-label]").forEach(function(e){ e.setAttribute("aria-label",t(e.dataset.tLabel)); });
    $("#chan").options[0].textContent=t("channel",1); $("#chan").options[1].textContent=t("channel",2);
    $("#startstop").textContent=live?t("stop"):t("start");
    $("#go").textContent=measureStart?t("restart"):t("start");
    $("#version").textContent="v"+VERSION;
    document.title=t("appTitle")+" · FLOTECH";
  }
  var LOC=function(){ return cfg.lang==="de"?"de-DE":"en-GB"; };

  if(!window.isSecureContext || !navigator.mediaDevices){
    document.body.innerHTML='<div style="max-width:56ch;margin:12vh auto;padding:0 24px">'+t("secure")+'</div>';
    return;
  }

  function writeHash(){
    var s=["off="+cfg.off.toFixed(1),"y="+cfg.y,"r="+cfg.r,"pk="+cfg.pk,"ch="+cfg.ch,"tw="+cfg.tw,"res="+cfg.res,"vu="+cfg.vu,"vo="+cfg.vo,"dur="+cfg.dur,"lang="+cfg.lang];
    ["svc","ev","ort","wer","dev"].forEach(function(k){ if(cfg[k]) s.push(k+"="+encodeURIComponent(cfg[k])); });
    history.replaceState(null,"","#"+s.join("&"));
    try{ localStorage.setItem("spl-cfg",JSON.stringify(cfg)); }catch(e){}
  }

  /* ---------- A- und C-Bewertung nach IEC 61672, bilinear, bei 1 kHz auf 0 dB normiert ---------- */
  function weightSections(fs,typ){
    var f1=20.598997,f2=107.65265,f3=737.86223,f4=12194.217;
    var w=function(f){ return 2*Math.PI*f; };
    var analog=typ==="A"?[
      {n:[1,0,0],d:[1,2*w(f1),w(f1)*w(f1)]},
      {n:[1,0,0],d:[1,2*w(f4),w(f4)*w(f4)]},
      {n:[0,0,1],d:[1,w(f2)+w(f3),w(f2)*w(f3)]}
    ]:[
      {n:[1,0,0],d:[1,2*w(f1),w(f1)*w(f1)]},
      {n:[0,0,1],d:[1,2*w(f4),w(f4)*w(f4)]}
    ];
    var K=2*fs,K2=K*K;
    var secs=analog.map(function(s){
      var n2=s.n[0],n1=s.n[1],n0=s.n[2],d2=s.d[0],d1=s.d[1],d0=s.d[2];
      var b0=n2*K2+n1*K+n0,b1=2*(n0-n2*K2),b2=n2*K2-n1*K+n0;
      var a0=d2*K2+d1*K+d0,a1=2*(d0-d2*K2),a2=d2*K2-d1*K+d0;
      return {b:[b0/a0,b1/a0,b2/a0],a:[1,a1/a0,a2/a0]};
    });
    var wn=2*Math.PI*1000/fs,m=1;
    secs.forEach(function(s){
      var cr=Math.cos(wn),sr=-Math.sin(wn),cr2=Math.cos(2*wn),sr2=-Math.sin(2*wn);
      var nr=s.b[0]+s.b[1]*cr+s.b[2]*cr2, ni=s.b[1]*sr+s.b[2]*sr2;
      var dr=s.a[0]+s.a[1]*cr+s.a[2]*cr2, di=s.a[1]*sr+s.a[2]*sr2;
      m*=Math.sqrt((nr*nr+ni*ni)/(dr*dr+di*di));
    });
    secs[0].b=secs[0].b.map(function(v){ return v/m; });
    return secs;
  }

  // Eingang 0: A-bewertet (Energie), 1: C-bewertet (Spitze), 2: roh (Übersteuerung). Alle 50 ms ein Paket.
  var workletSrc=[
    "class Pegel extends AudioWorkletProcessor{",
    "  constructor(){super();this.s=0;this.n=0;this.pc=0;this.pr=0;}",
    "  process(inp){",
    "    var a=inp[0][0],c=inp[1][0],r=inp[2][0],i,v;",
    "    if(a){var q=0;for(i=0;i<a.length;i++){q+=a[i]*a[i];}this.s+=q;this.n+=a.length;}",
    "    if(c){for(i=0;i<c.length;i++){v=c[i]<0?-c[i]:c[i];if(v>this.pc)this.pc=v;}}",
    "    if(r){for(i=0;i<r.length;i++){v=r[i]<0?-r[i]:r[i];if(v>this.pr)this.pr=v;}}",
    "    if(this.n>=sampleRate*0.05){this.port.postMessage({s:this.s,n:this.n,pc:this.pc,pr:this.pr});this.s=0;this.n=0;this.pc=0;this.pr=0;}",
    "    return true;",
    "  }",
    "}",
    "registerProcessor('pegel',Pegel);"
  ].join("\n");

  /* ---------- Zustand ---------- */
  var ctx=null,stream=null,live=false,measureStart=null,measureStartWall=null,wake=null;
  var KEEP=20*3600;   // Verlauf: 20 Stunden, auch im Browser-Speicher (Lücken = NaN)
  var tau=cfg.tw==="s"?1.0:0.125,msqF=0,msqS=0,settle=0;
  var rawMin=Infinity,rawMax=-Infinity,rawNow=null,pkMax=0;
  // Je Sekunde: A-Energie (secMS), höchster LAF als Energie (secFM), höchste C-Spitze linear (secPK), übersteuert 0/1 (secCL)
  var ring=[],secMS=[],secFM=[],secPK=[],secCL=[],secS=0,secN=0,secF=0,secP=0,secC=0,secCount=0,clipUntil=0;
  var cv=$("#cv"),elLaf=$("#laf");

  function fmt(v){ return (v===null||!isFinite(v))?"--.-":(v+cfg.off).toFixed(1); }
  function db(e){ return 10*Math.log10(Math.max(e,1e-20)); }
  function chip(txt,c){ var e=$("#chip"); e.textContent=txt; e.className="kapsel"+(c?" "+c:""); }
  function khz(){ var v=ctx.sampleRate/1000; return (Math.abs(v-Math.round(v))<.05?String(Math.round(v)):v.toFixed(1))+" kHz"; }

  /* ---------- Audio ---------- */
  function listDevices(){
    return navigator.mediaDevices.enumerateDevices().then(function(ds){
      var ins=ds.filter(function(d){ return d.kind==="audioinput"; });
      var sel=$("#dev"); sel.innerHTML="";
      ins.forEach(function(d,i){
        var o=document.createElement("option");
        o.value=d.deviceId; o.textContent=d.label||(t("input")+" "+(i+1));
        sel.appendChild(o);
      });
      if(cfg.dev && ins.some(function(d){ return d.deviceId===cfg.dev; })) sel.value=cfg.dev;
      cfg.dev=sel.value||"";
      $("#chan").value=String(cfg.ch);
      $("#devNote").textContent=t("inputsFound",ins.length);
    });
  }

  function openStream(){
    stopAudio();
    var want=(cfg.dev?{deviceId:{exact:cfg.dev}}:{});
    want.echoCancellation=false; want.noiseSuppression=false; want.autoGainControl=false;
    want.channelCount=2;
    return navigator.mediaDevices.getUserMedia({audio:want,video:false})
      .catch(function(){ delete want.channelCount;
        return navigator.mediaDevices.getUserMedia({audio:want,video:false}); })
      .then(function(s){ stream=s; return listDevices(); })
      .then(buildChain);
  }

  function kette(src,secs){
    var first=null,prev=null;
    secs.forEach(function(s){
      var f=ctx.createIIRFilter(Float64Array.from(s.b),Float64Array.from(s.a));
      if(prev) prev.connect(f); else first=f;
      prev=f;
    });
    return {first:first,last:prev};
  }

  function buildChain(){
    ctx=new (window.AudioContext||window.webkitAudioContext)();
    var url=URL.createObjectURL(new Blob([workletSrc],{type:"application/javascript"}));
    return ctx.audioWorklet.addModule(url).then(function(){
      var src=ctx.createMediaStreamSource(stream);
      var split=ctx.createChannelSplitter(2);
      src.connect(split);
      var idx=cfg.ch|0;
      var a=kette(split,weightSections(ctx.sampleRate,"A")),c=kette(split,weightSections(ctx.sampleRate,"C"));
      var roh=ctx.createGain();
      split.connect(a.first,idx); split.connect(c.first,idx); split.connect(roh,idx);
      var wn=new AudioWorkletNode(ctx,"pegel",{numberOfInputs:3,numberOfOutputs:0,channelCount:1,channelCountMode:"explicit"});
      a.last.connect(wn,0,0); c.last.connect(wn,0,1); roh.connect(wn,0,2);
      wn.port.onmessage=onBlock;
      live=true; settle=performance.now()+700;
      $("#startstop").textContent=t("stop");
      wachHalten();
      return ctx.resume();
    });
  }

  function stopAudio(){
    live=false;
    if(ctx){ ctx.close(); ctx=null; }
    if(stream){ stream.getTracks().forEach(function(tr){ tr.stop(); }); stream=null; }
    if(wake){ wake.release().catch(function(){}); wake=null; }
  }

  // Bildschirm während der Messung anlassen (nach dem Zurückwechseln neu anfordern)
  function wachHalten(){
    if(!live||wake||!navigator.wakeLock||document.hidden) return;
    navigator.wakeLock.request("screen").then(function(w){ wake=w; w.addEventListener("release",function(){ wake=null; }); }).catch(function(){});
  }
  document.addEventListener("visibilitychange",function(){ if(!document.hidden) wachHalten(); });

  function onBlock(ev){
    if(!live) return;
    var d=ev.data,s=d.s,n=d.n,now=performance.now(),dt=n/ctx.sampleRate;
    msqF += (s/n-msqF)*(1-Math.exp(-dt/0.125));
    msqS += (s/n-msqS)*(1-Math.exp(-dt/1.0));
    rawNow=db(tau===1.0?msqS:msqF);
    var ruhig=now>settle;
    if(ruhig && rawNow>-180){
      if(rawNow<rawMin) rawMin=rawNow;
      if(rawNow>rawMax) rawMax=rawNow;
      if(d.pc>pkMax) pkMax=d.pc;
    }
    if(d.pr>0.985&&!DEMO){ clipUntil=now+1500; secC=1; }
    if(DEMO) return;   // Demo-Verlauf nicht mit echten Werten mischen
    ring.push({s:s,n:n,t:now});
    while(ring.length && now-ring[0].t>60000) ring.shift();
    secS+=s; secN+=n;
    if(ruhig){ if(msqF>secF) secF=msqF; if(d.pc>secP) secP=d.pc; }
    if(secN>=ctx.sampleRate){
      secMS.push(secS/secN); secFM.push(secF||secS/secN); secPK.push(secP); secCL.push(secC);
      secCount++;
      if(secMS.length>KEEP){ secMS.shift(); secFM.shift(); secPK.shift(); secCL.shift(); }
      secS=0; secN=0; secF=0; secP=0; secC=0; draw();
    }
  }

  function leqRing(sec){
    if(DEMO){ var m=leqMin(sec/60); return m?m.db:null; }
    var now=performance.now(),s=0,n=0;
    for(var i=ring.length-1;i>=0;i--){
      if(now-ring[i].t>sec*1000) break;
      s+=ring[i].s; n+=ring[i].n;
    }
    return n?db(s/n):null;
  }
  function leqMin(minutes){
    var k=minutes*60,take=Math.min(k,secMS.length);
    if(!take) return null;
    var s=0,n=0;
    for(var i=secMS.length-take;i<secMS.length;i++) if(secMS[i]===secMS[i]){ s+=secMS[i]; n++; }
    if(!n) return null;
    return {db:db(s/n),full:secMS.length>=k};
  }
  function stufe(v){ return v===null?"":(v>=cfg.r?"w-bad":(v>=cfg.y?"w-warn":"")); }
  function setMean(box,id,v,ampel){
    $("#"+id).textContent=v?fmt(v.db):"--.-";
    var b=$("#"+box); b.classList.toggle("partial",!v||!v.full);
    if(ampel){ b.classList.remove("w-warn","w-bad"); var s=v&&cfg.off?stufe(v.db+cfg.off):""; if(s) b.classList.add(s); }
  }
  function hms(ms){
    var x=Math.floor(ms/1000),h=Math.floor(x/3600),m=Math.floor(x%3600/60),s=x%60;
    return h+":"+("0"+m).slice(-2)+":"+("0"+s).slice(-2);
  }
  function pkDb(p){ return p>0?20*Math.log10(p):null; }

  /* ---------- Anzeige ---------- */
  setInterval(function(){
    if(!$("#scrim").hidden && live){
      $("#rawLive").textContent=rawNow===null?"--.-":rawNow.toFixed(1);
      $("#calLive").textContent=fmt(rawNow);
    }
    if(!live) return;
    if(ctx && ctx.state==="suspended"){
      chip(t("chipClick"),"warn");
      elLaf.className="stale";
      return;
    }

    elLaf.textContent=fmt(rawNow);
    elLaf.className=rawNow===null?"stale":stufe(rawNow+cfg.off);
    $("#lmin").textContent=fmt(rawMin===Infinity?null:rawMin);
    $("#lmax").textContent=fmt(rawMax===-Infinity?null:rawMax);
    var pk=pkDb(pkMax); $("#lpk").textContent=fmt(pk);
    $("#lpk").classList.toggle("w-bad",!!(pk!==null&&cfg.off&&pk+cfg.off>=cfg.pk));

    var one=leqRing(60);
    $("#leq1").textContent=fmt(one);
    $("#m1").classList.toggle("partial", ring.length?(performance.now()-ring[0].t)<59000:true);
    setMean("m5","leq5",leqMin(5));
    setMean("m10","leq10",leqMin(10));
    setMean("m30","leq30",leqMin(30),true);

    if(measureStart) $("#elapsed").textContent=hms(performance.now()-measureStart);
    checkServices();

    if(performance.now()<clipUntil) chip(t("chipClip"),"schlecht");
    else if(!cfg.off) chip(t("chipUncal"),"warn");
    else chip(t("chipCal",khz()),"gut");
  },100);

  /* ---------- Diagramm ---------- */
  function wallOfSec(a){ return measureStartWall + (a+0.5)*1000; }
  function absOfWall(x){ return Math.floor((x-measureStartWall)/1000); }
  function hhmm(x){
    var d=new Date(x);
    return ("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2);
  }

  // hell=true: Farben für das Protokoll auf Papier
  function render(g,ox,oy,w,h,k,win,hell){
    var F=hell?{panel:"#ffffff",rand:"#d9dce3",leise:"#5f6371",linie:"#14161b",band:"rgba(20,22,27,.13)",flaeche:"rgba(20,22,27,.06)",warn:"#d98a00",bad:"#e01e1e"}
             :{panel:C("--flaeche"),rand:C("--rand"),leise:C("--leise"),linie:C("--linie"),band:C("--band"),flaeche:C("--flaeche-leise"),warn:C("--warn"),bad:C("--schlecht")};
    var padL=44*k,padR=13*k,padT=13*k,padB=24*k;
    var iw=w-padL-padR,ih=h-padT-padB;
    g.save(); g.translate(ox,oy);
    g.fillStyle=F.panel; g.fillRect(0,0,w,h);

    var L=secMS.length,base=secCount-L;
    var a1=win?win.a1:secCount-1;
    var a0=win?win.a0:a1-3599;
    var span=Math.max(1,a1-a0);
    var xa=function(a){ return padL+iw*(a-a0)/span; };

    var iStart=Math.max(a0,base),iEnd=Math.min(a1,secCount-1);
    var vals=[];
    for(var q=iStart;q<=iEnd;q++) if(secMS[q-base]===secMS[q-base]) vals.push(db(secMS[q-base])+cfg.off);

    var lo,hi;
    if(cfg.off){
      // Kalibriert: feste Skala aus den Einstellungen (Standard 50–110 dB), Werte außerhalb laufen am Rand entlang
      lo=cfg.vu; hi=cfg.vo;
      if(!(hi-lo>=10)){ lo=50; hi=110; }
    } else {
      if(vals.length){ lo=Math.min.apply(null,vals); hi=Math.max.apply(null,vals); }
      else { lo=-60; hi=0; }
      lo=Math.floor((lo-4)/10)*10; hi=Math.ceil((hi+4)/10)*10;
      if(hi-lo<20) hi=lo+20;
    }
    var y=function(v){ v=Math.min(hi,Math.max(lo,v)); return padT+ih-(v-lo)/(hi-lo)*ih; };

    g.font=(11*k)+"px 'Atkinson Hyperlegible Next',system-ui,sans-serif";
    g.lineWidth=1*k;
    var step=(hi-lo)>80?20:10;
    for(var v=lo;v<=hi;v+=step){
      var yy=Math.round(y(v))+.5;
      g.strokeStyle=F.rand;
      g.beginPath(); g.moveTo(padL,yy); g.lineTo(w-padR,yy); g.stroke();
      g.fillStyle=F.leise; g.textAlign="right";
      g.fillText(String(v),padL-7*k,yy+4*k);
    }

    // Zeitachse: laufende Messung relativ, Export mit Uhrzeit (15 Minuten, ab 4 Stunden 30, ab 10 Stunden 60)
    var ticks=[];
    if((win||g.canvas!==cv) && measureStartWall){
      var tstep=span<=4*3600?900:(span<=10*3600?1800:3600);
      var t0=Math.ceil(wallOfSec(a0)/(tstep*1000))*tstep*1000;
      for(var x=t0;x<=wallOfSec(a1);x+=tstep*1000) ticks.push({a:absOfWall(x),text:hhmm(x)});
    } else {
      [60,45,30,15,0].forEach(function(m){
        ticks.push({a:a1-m*60,text:m===0?(cfg.lang==="de"?"jetzt":"now"):("-"+m+" min")});
      });
    }
    g.textAlign="center";
    ticks.forEach(function(tk){
      var xx=Math.round(xa(tk.a))+.5;
      if(xx>padL+2 && xx<w-padR-2){
        g.strokeStyle=F.rand;
        g.beginPath(); g.moveTo(xx,padT); g.lineTo(xx,padT+ih); g.stroke();
      }
      g.fillStyle=F.leise;
      g.fillText(tk.text,Math.min(Math.max(xx,padL+20*k),w-padR-20*k),h-7*k);
    });

    if(cfg.off){
      g.setLineDash([5*k,4*k]); g.globalAlpha=.85;
      [[cfg.y,F.warn],[cfg.r,F.bad]].forEach(function(p){
        if(p[0]<lo||p[0]>hi) return;
        var yl=Math.round(y(p[0]))+.5;
        g.strokeStyle=p[1];
        g.beginPath(); g.moveTo(padL,yl); g.lineTo(w-padR,yl); g.stroke();
      });
      g.globalAlpha=1; g.setLineDash([]);
    }

    if(iEnd>=iStart){
      var bs=cfg.res>0?cfg.res:Math.max(1,Math.round(span/Math.max(1,iw/2)));
      if(win||g.canvas!==cv) bs=Math.max(bs,Math.round(span/Math.max(1,iw/2)));
      var bins=[],i=iStart;
      while(i<=iEnd){
        var stop=Math.min((Math.floor(i/bs)+1)*bs-1,iEnd);
        var sum=0,mx=-Infinity,mn=Infinity,n=0;
        for(var p2=i;p2<=stop;p2++){
          var d=secMS[p2-base]; if(d!==d) continue; sum+=d; n++;
          if(d>mx) mx=d;
          if(d<mn) mn=d;
        }
        if(!n){ if(bins.length&&bins[bins.length-1]) bins.push(null); i=stop+1; continue; }
        bins.push({a:(i+stop)/2,leq:db(sum/n)+cfg.off,hi:db(mx)+cfg.off,lo:db(mn)+cfg.off});
        i=stop+1;
      }

      g.save();
      g.beginPath(); g.rect(padL,padT,iw,ih); g.clip();
      var segs=[[]]; bins.forEach(function(p){ if(p) segs[segs.length-1].push(p); else segs.push([]); });
      segs.forEach(function(bins){
        if(bs>1 && bins.length>1){
          g.beginPath();
          bins.forEach(function(p,ix){ ix?g.lineTo(xa(p.a),y(p.hi)):g.moveTo(xa(p.a),y(p.hi)); });
          for(var z=bins.length-1;z>=0;z--) g.lineTo(xa(bins[z].a),y(bins[z].lo));
          g.closePath(); g.fillStyle=F.band; g.fill();
        } else if(bins.length>1){
          g.beginPath(); g.moveTo(xa(bins[0].a),padT+ih);
          bins.forEach(function(p){ g.lineTo(xa(p.a),y(p.leq)); });
          g.lineTo(xa(bins[bins.length-1].a),padT+ih); g.closePath();
          g.fillStyle=F.flaeche; g.fill();
        }
        if(bins.length>1){
          g.beginPath();
          bins.forEach(function(p,ix){ ix?g.lineTo(xa(p.a),y(p.leq)):g.moveTo(xa(p.a),y(p.leq)); });
          g.strokeStyle=F.linie; g.lineWidth=1.7*k;
          g.lineJoin="round"; g.lineCap="round"; g.stroke();
        }
      });
      g.restore();
    }
    g.restore();
  }

  function draw(){
    var dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;
    if(!w||!h) return;
    cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
    var g=cv.getContext("2d"); g.scale(dpr,dpr); g.clearRect(0,0,w,h);
    render(g,0,0,w,h,1);
  }
  if(window.ResizeObserver) new ResizeObserver(function(){ draw(); }).observe(cv);
  window.addEventListener("resize",draw);

  /* ---------- Auswertung eines Zeitraums ---------- */
  function windowStats(a0,a1){
    var L=secMS.length,base=secCount-L;
    var i0=Math.max(a0,base),i1=Math.min(a1,secCount-1);
    if(i1<i0) return null;
    var sum=0,fm=0,pk=0,n=0,clip=0;
    // gleitender LAeq über 30 min (nur gemessene Sekunden zählen)
    var W=1800,ws=0,wn=0,best=-Infinity,q0=i0;
    for(var q=i0;q<=i1;q++){
      var d=secMS[q-base];
      if(d===d){ sum+=d; n++; ws+=d; wn++;
        if(secFM[q-base]>fm) fm=secFM[q-base];
        if(secPK[q-base]>pk) pk=secPK[q-base];
        if(secCL[q-base]) clip++; }
      while(q-q0>=W){ var o=secMS[q0-base]; if(o===o){ ws-=o; wn--; } q0++; }
      if(q-i0>=W-1 && wn) best=Math.max(best,ws/wn);
    }
    if(!n) return null;
    var kurz=best===-Infinity;
    if(kurz) best=sum/n;
    return {
      leq:db(sum/n)+cfg.off, leq30:db(best)+cfg.off, kurz:kurz,
      fmax:db(fm)+cfg.off, pk:pk>0?20*Math.log10(pk)+cfg.off:null,
      minutes:Math.round(n/60), clip:clip, i0:i0, i1:i1
    };
  }

  /* ---------- Zeiträume für den Export ---------- */
  function zeitraeume(){
    var liste=[];
    if(!measureStartWall||!secCount) return liste;
    var a1=secCount-1;
    liste.push({a0:Math.max(0,a1-3599),a1:a1,label:t("winLast60"),slug:"60min"});
    var base=secCount-secMS.length,first=base;
    while(first<a1&&isNaN(secMS[first-base])) first++;
    liste.push({a0:first,a1:a1,label:t("winAll",hhmm(wallOfSec(first)),hhmm(wallOfSec(a1))),slug:"gesamt"});
    serviceWindows().forEach(function(s){ liste.push(s); });
    return liste;
  }
  function serviceWindows(minSec){
    var out=[]; if(!measureStartWall||!secCount) return out;
    var durMs=Math.max(10,cfg.dur)*60000,start=wallOfSec(secCount-secMS.length),ende=wallOfSec(secCount-1);
    // jeden Tag des Verlaufs prüfen (bis zu 20 Stunden, also höchstens zwei Kalendertage)
    var tage=[new Date(start),new Date(ende)];
    tage.forEach(function(tag,ti){
      if(ti&&tag.toDateString()===tage[0].toDateString()) return;
      serviceTimes().forEach(function(s){
        var d=new Date(tag); d.setHours(s.h,s.m,0,0);
        var st=d.getTime(),en=st+durMs;
        var a0=Math.max(secCount-secMS.length,absOfWall(Math.max(st,start))),a1=Math.min(secCount-1,absOfWall(Math.min(en,ende)));
        if(a1-a0<(minSec||600)) return;
        out.push({a0:a0,a1:a1,key:s.key,st:st,en:en,label:t("winService",s.key,hhmm(en)),slug:(cfg.lang==="de"?"gottesdienst-":"service-")+s.key.replace(":",""),titel:t("service",s.key,hhmm(en))});
      });
    });
    return out;
  }

  /* ---------- Dateien ausliefern ---------- */
  function dateiname(win,endung){
    var slug=((cfg.ev?cfg.ev+"-":"")+(win?win.slug:"schallpegel")).toLowerCase()
      .replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")
      .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,56) || "schallpegel";
    var d=new Date(win?wallOfSec(win.a0):Date.now()),z=function(n){ return ("0"+n).slice(-2); };
    return slug+"_"+d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"-"+z(d.getHours())+z(d.getMinutes())+"."+endung;
  }
  // Synchron im Klick bleiben, damit Safari das Teilen/Herunterladen als Nutzeraktion zählt.
  function ausliefern(blob,name){
    var file=null; try{ file=new File([blob],name,{type:blob.type}); }catch(e){}
    var mobil=/iPhone|iPad|iPod|Android/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
    if(mobil&&file&&navigator.canShare&&navigator.canShare({files:[file]})){
      navigator.share({files:[file],title:name}).catch(function(){});
      return;
    }
    // Ohne Link im Dokument öffnet Safari die Datei im selben Tab, dann wäre der Verlauf weg.
    var a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download=name; a.rel="noopener"; a.style.display="none";
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },60000);
  }
  function dataUrlBlob(u){
    var bin=atob(u.split(",")[1]),buf=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
    return new Blob([buf],{type:"image/png"});
  }
  function zahl(v){ return v===null||!isFinite(v)?"--.-":v.toFixed(1); }

  function bildCanvas(win,hell){
    var W=1800,H=900,k=2,head=112;
    var c=document.createElement("canvas"); c.width=W; c.height=H;
    var g=c.getContext("2d");
    g.fillStyle=hell?"#ffffff":C("--grund"); g.fillRect(0,0,W,H);
    g.textAlign="left";
    var st=windowStats(win.a0,win.a1),bits=[];
    var title=(cfg.ev?cfg.ev+" · ":"")+(win.titel||t("imgTitle")+", "+win.label);
    bits.push(new Date(wallOfSec(win.a0)).toLocaleDateString(LOC()));
    if(cfg.ort) bits.push(cfg.ort);
    if(st){
      bits.push(t("minRecorded",st.minutes));
      bits.push(t("laeq",zahl(st.leq)));
      bits.push(t("laeq30max",zahl(st.leq30)));
      bits.push(t("loudest",zahl(st.fmax)));
      bits.push(t("lcpeak",zahl(st.pk)));
    }
    if(!cfg.off) bits.push(t("uncal"));
    g.fillStyle=hell?"#14161b":C("--text");
    g.font="800 34px 'Atkinson Hyperlegible Next',system-ui,sans-serif";
    g.fillText(title,40,56);
    g.font="20px 'Atkinson Hyperlegible Next',system-ui,sans-serif";
    g.fillStyle=hell?"#5f6371":C("--leise");
    g.fillText(bits.join("   ·   "),40,90);
    if(!hell){ g.fillStyle=C("--akzent"); g.fillRect(24,26,6,38); }
    render(g,40,head,W-80,H-head-36,k,win,hell);
    return c;
  }

  function exportPng(win){ ausliefern(dataUrlBlob(bildCanvas(win).toDataURL("image/png")),dateiname(win,"png")); }

  function minutenWerte(win,schritt){
    var base=secCount-secMS.length,rows=[];
    var start=Math.floor(wallOfSec(win.a0)/60000)*60000;
    for(var m=start;m<=wallOfSec(win.a1);m+=schritt*60000){
      var a0=Math.max(win.a0,absOfWall(m)),a1=Math.min(win.a1,absOfWall(m+schritt*60000)-1);
      if(a1<a0) continue;
      var s=0,n=0,fm=0,pk=0,cl=0;
      for(var q=a0;q<=a1;q++){ var d=secMS[q-base]; if(d!==d) continue; s+=d; n++; if(secFM[q-base]>fm) fm=secFM[q-base]; if(secPK[q-base]>pk) pk=secPK[q-base]; cl+=secCL[q-base]; }
      // gleitender LAeq 30 min bis zum Ende dieses Abschnitts
      var ws=0,wn=0;
      for(q=Math.max(base,a1-1799);q<=a1;q++){ d=secMS[q-base]; if(d===d){ ws+=d; wn++; } }
      rows.push({zeit:m,n:n,leq:n?db(s/n)+cfg.off:null,fmax:n?db(fm)+cfg.off:null,pk:pk>0?20*Math.log10(pk)+cfg.off:null,
                 leq30:wn?db(ws/wn)+cfg.off:null,voll30:wn>=1800,clip:cl});
    }
    return rows;
  }

  function exportCsv(win){
    var de=cfg.lang==="de",sep=de?";":",";
    var z=function(v){ if(v===null||!isFinite(v)) return ""; var s=v.toFixed(1); return de?s.replace(".",","):s; };
    var zeilen=[t("csvHead").join(sep)];
    minutenWerte(win,1).forEach(function(r){
      var d=new Date(r.zeit);
      zeilen.push([d.toLocaleDateString(LOC()),hhmm(r.zeit),z(r.leq),z(r.fmax),z(r.pk),r.voll30?z(r.leq30):"",r.n?r.clip:""].join(sep));
    });
    ausliefern(new Blob(["﻿"+zeilen.join("\r\n")+"\r\n"],{type:"text/csv"}),dateiname(win,"csv"));
  }

  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function exportPdf(win){
    var st=windowStats(win.a0,win.a1); if(!st){ chip(t("chipNoData"),"schlecht"); return; }
    var dauer=(win.a1-win.a0+1)/60,schritt=dauer<=180?5:15;
    var von=new Date(wallOfSec(win.a0)),bis=new Date(wallOfSec(win.a1));
    var bewert=function(v,grenze,warn){ if(v===null||!cfg.off) return ""; return v>=grenze?'<span class="ueberschritten">'+t("prOver")+'</span>':(warn!==undefined&&v>=warn?t("prWarn"):t("prOk")); };
    var o=$("#dev").selectedOptions[0];
    var reihe=function(a,b){ return b?"<tr><th>"+esc(a)+"</th><td>"+b+"</td></tr>":""; };
    var h='<h1>'+esc(t("prTitle"))+'</h1><p class="unter">'+esc(t("prSub",new Date().toLocaleString(LOC())))+'</p>'+
      '<h2>'+esc(t("prFacts"))+'</h2><table>'+
      reihe(t("prEvent"),esc(cfg.ev))+reihe(t("prPlace"),esc(cfg.ort))+reihe(t("prBy"),esc(cfg.wer))+
      reihe(t("prPeriod"),esc(von.toLocaleDateString(LOC())+", "+hhmm(von)+"–"+hhmm(bis)+(win.key?" ("+win.titel+")":"")))+
      reihe(t("prData"),esc(t("minRecorded",st.minutes)))+
      reihe(t("prDevice"),o?esc(o.textContent+" · "+t("channel",cfg.ch+1)):"")+
      reihe(t("prRate"),ctx?esc(khz()):"")+
      reihe(t("prCal"),esc(cfg.off?t("prCalYes",cfg.off.toFixed(1)):t("prCalNo")))+
      reihe(t("prLimits"),esc(t("prLimitsVal",cfg.y,cfg.r,cfg.pk)))+
      reihe(t("prClip"),esc(st.clip?t("prClipVal",st.clip):t("prClipNone")))+
      '</table><h2>'+esc(t("prResults"))+'</h2><table class="zahlen"><tr><th></th><th>'+esc(t("prValue"))+'</th><th>'+esc(t("prLimit"))+'</th><th>'+esc(t("prVerdict"))+'</th></tr>'+
      '<tr><td>'+esc(t("prLaeq30"))+(st.kurz?'<br><small>'+esc(t("prShort",st.minutes))+'</small>':'')+'</td><td>'+zahl(st.leq30)+' dB(A)</td><td>'+cfg.r+' dB(A)</td><td>'+bewert(st.leq30,cfg.r,cfg.y)+'</td></tr>'+
      '<tr><td>'+esc(t("prLcpeak"))+'</td><td>'+zahl(st.pk)+' dB(C)</td><td>'+cfg.pk+' dB(C)</td><td>'+bewert(st.pk,cfg.pk)+'</td></tr>'+
      '<tr><td>'+esc(t("prLaeq"))+'</td><td>'+zahl(st.leq)+' dB(A)</td><td></td><td></td></tr>'+
      '<tr><td>'+esc(t("prLafmax"))+'</td><td>'+zahl(st.fmax)+' dB(A)</td><td></td><td></td></tr></table>'+
      '<h2>'+esc(t("prChart"))+'</h2><img src="'+bildCanvas(win,true).toDataURL("image/png")+'" alt="">'+
      '<h2>'+esc(t("prTable",schritt))+'</h2><table class="zahlen"><tr><th>'+esc(t("prTime"))+'</th><th>LAeq dB(A)</th><th>LAFmax dB(A)</th><th>LCpeak dB(C)</th><th>LAeq 30 min</th></tr>';
    minutenWerte(win,schritt).forEach(function(r){
      if(!r.n) return;
      var rot=cfg.off&&r.voll30&&r.leq30>=cfg.r;
      h+='<tr><td>'+hhmm(r.zeit)+'</td><td>'+zahl(r.leq)+'</td><td>'+zahl(r.fmax)+'</td><td'+(cfg.off&&r.pk>=cfg.pk?' class="ueberschritten"':'')+'>'+zahl(r.pk)+
         '</td><td'+(rot?' class="ueberschritten"':'')+'>'+(r.voll30?zahl(r.leq30):"–")+'</td></tr>';
    });
    h+='</table><div class="unterschrift"><div>'+esc(t("prSign"))+'</div><div>'+esc(t("prBy"))+'</div></div><p class="hinweis">'+esc(t("prHint"))+'</p>';
    $("#protokoll").innerHTML=h;
    var titel=document.title; document.title=dateiname(win,"pdf").replace(/\.pdf$/,"");
    var weg=function(){ document.title=titel; window.removeEventListener("afterprint",weg); };
    window.addEventListener("afterprint",weg);
    // Bild erst laden lassen, dann drucken
    var img=$("#protokoll img"); if(img.complete) window.print(); else img.onload=function(){ window.print(); };
  }

  /* ---------- Export-Fenster ---------- */
  var exListe=[];
  function exportOeffnen(vorwahl){
    exListe=zeitraeume();
    if(!exListe.length){ chip(t("chipNoData"),"schlecht"); return; }
    var sel=$("#win"); sel.innerHTML="";
    exListe.forEach(function(w,i){ var o=document.createElement("option"); o.value=i; o.textContent=w.label; sel.appendChild(o); });
    var i=vorwahl?exListe.findIndex(function(w){ return w.key===vorwahl; }):0;
    sel.value=String(i<0?0:i);
    exInfo();
    $("#exScrim").hidden=false;
  }
  function exWahl(){ return exListe[+$("#win").value]; }
  function exInfo(){
    var w=exWahl(),st=w&&windowStats(w.a0,w.a1);
    $("#winInfo").textContent=st?t("winInfo",st.minutes,zahl(st.leq),zahl(st.leq30),zahl(st.pk)):t("chipNoData");
    ["#exPng","#exPdf","#exCsv"].forEach(function(b){ $(b).disabled=!st; });
  }
  $("#win").onchange=exInfo;
  $("#export").onclick=function(){ exportOeffnen(); };
  $("#exClose").onclick=function(){ $("#exScrim").hidden=true; };
  $("#exPng").onclick=function(){ exportPng(exWahl()); };
  $("#exCsv").onclick=function(){ exportCsv(exWahl()); };
  $("#exPdf").onclick=function(){ exportPdf(exWahl()); };

  /* ---------- Knöpfe für die Gottesdienstzeiten ---------- */
  var svcShown={};
  function serviceTimes(){
    return String(cfg.svc||"").split(/[,;]/).map(function(s){
      var m=s.trim().match(/^(\d{1,2})[:.h](\d{2})$/);
      if(!m) return null;
      var hh=+m[1],mm=+m[2];
      if(hh>23||mm>59) return null;
      return {h:hh,m:mm,key:("0"+hh).slice(-2)+":"+("0"+mm).slice(-2)};
    }).filter(Boolean);
  }
  function checkServices(){
    serviceWindows(3600).forEach(function(s){
      if(svcShown[s.key]) return;
      svcShown[s.key]=true;
      var b=document.createElement("button");
      b.textContent=s.key; b.title=s.titel;
      b.onclick=function(){ exportOeffnen(s.key); };
      $("#events").appendChild(b);
    });
  }

  /* ---------- Einstellungsfenster ---------- */
  function syncMeta(){
    var o=$("#dev").selectedOptions[0];
    $("#chartLbl").textContent=t("chartLbl",cfg.res>0?(cfg.res>=60?t("chartMin"):t("chartSec",cfg.res)):t("chartAuto"));
    var nr=function(v){ return cfg.lang==="de"?String(v).replace(".",","):String(v); };
    $("#meta").innerHTML=
      (cfg.ev?'<span><b>'+esc(cfg.ev)+'</b></span>':'')+
      '<span>'+t("correction")+' <b>'+nr(cfg.off.toFixed(1))+'</b> dB</span>'+
      '<span><span class="swatch" style="background:var(--warn)"></span>'+t("from")+' <b>'+cfg.y+'</b></span>'+
      '<span><span class="swatch" style="background:var(--schlecht)"></span>'+t("from")+' <b>'+cfg.r+'</b> dB(A)</span>'+
      (o&&o.value?'<span class="dev">'+esc(o.textContent)+' · '+t("channel",cfg.ch+1)+'</span>':'');
    writeHash(); draw();
  }
  function openSheet(){
    $("#scrim").hidden=false;
    $("#ev").value=cfg.ev; $("#ort").value=cfg.ort; $("#wer").value=cfg.wer;
    $("#res").value=String(cfg.res);
    $("#vu").value=cfg.vu; $("#vo").value=cfg.vo;
    $("#svc").value=cfg.svc; $("#dur").value=cfg.dur;
    $("#off").value=cfg.off.toFixed(1);
    $("#thY").value=cfg.y; $("#thR").value=cfg.r; $("#thP").value=cfg.pk;
    $("#lang").value=cfg.lang;
    $("#close").hidden=!measureStart;
    $("#go").textContent=measureStart?t("restart"):t("start");
  }
  function closeSheet(){ $("#scrim").hidden=true; setTimeout(draw,60); }

  $("#grant").onclick=function(){
    $("#devNote").textContent=t("connecting");
    openStream().then(function(){ $("#devNote").textContent=t("inputActive"); syncMeta(); })
      .catch(function(e){ $("#devNote").textContent=t("noAccess",e.name); });
  };
  $("#dev").onchange=function(){ cfg.dev=this.value; openStream().then(syncMeta).catch(function(){}); };
  $("#chan").onchange=function(){ cfg.ch=parseInt(this.value,10)||0; openStream().then(syncMeta).catch(function(){}); };
  $("#svc").oninput=function(){ cfg.svc=this.value.slice(0,80); syncMeta(); };
  $("#dur").oninput=function(){ var v=parseFloat(this.value); if(isFinite(v)&&v>=10){ cfg.dur=v; syncMeta(); } };
  $("#res").onchange=function(){ cfg.res=parseFloat(this.value)||0; syncMeta(); };
  // Skala des Verlaufs: nur übernehmen, wenn mindestens 10 dB Abstand bleiben
  function skalaSetzen(){ var u=parseFloat($("#vu").value),o=parseFloat($("#vo").value); if(isFinite(u)&&isFinite(o)&&o-u>=10){ cfg.vu=u; cfg.vo=o; syncMeta(); } }
  $("#vu").oninput=skalaSetzen; $("#vo").oninput=skalaSetzen;
  $("#skalaStd").onclick=function(){ $("#vu").value=50; $("#vo").value=110; skalaSetzen(); };
  $("#ev").oninput=function(){ cfg.ev=this.value.slice(0,70); syncMeta(); };
  $("#ort").oninput=function(){ cfg.ort=this.value.slice(0,70); syncMeta(); };
  $("#wer").oninput=function(){ cfg.wer=this.value.slice(0,70); syncMeta(); };
  $("#off").oninput=function(){ var v=parseFloat(this.value); cfg.off=isFinite(v)?v:0; syncMeta(); };
  $("#thY").oninput=function(){ var v=parseFloat(this.value); if(isFinite(v)){ cfg.y=v; syncMeta(); } };
  $("#thR").oninput=function(){ var v=parseFloat(this.value); if(isFinite(v)){ cfg.r=v; syncMeta(); } };
  $("#thP").oninput=function(){ var v=parseFloat(this.value); if(isFinite(v)){ cfg.pk=v; syncMeta(); } };
  $("#lang").onchange=function(){ cfg.lang=this.value; uebersetzen(); syncMeta(); };

  function calibrate(target){
    var raw=leqRing(3);
    if(raw===null||!live){ $("#devNote").textContent=t("grantFirst"); return; }
    cfg.off=target-raw;
    $("#off").value=cfg.off.toFixed(1);
    rawMin=Infinity; rawMax=-Infinity; pkMax=0;
    syncMeta();
  }
  $("#cal94").onclick=function(){ calibrate(94); };
  $("#cal110").onclick=function(){ calibrate(110); };

  /* ---------- Verlauf im Browser sichern (IndexedDB, nur auf diesem Gerät) ---------- */
  var DB=null,geladen=false;   // erst sichern, wenn der alte Stand geladen ist, sonst überschreibt ein leerer Verlauf ihn
  function idb(){
    if(DB) return DB;
    DB=new Promise(function(ok,no){
      var r=indexedDB.open("schallpegel",1);
      r.onupgradeneeded=function(){ r.result.createObjectStore("verlauf"); };
      r.onsuccess=function(){ ok(r.result); }; r.onerror=function(){ no(r.error); };
    }).catch(function(){ return null; });
    return DB;
  }
  function sichern(){
    if(!geladen||!measureStartWall||!secMS.length) return;
    var daten={start:measureStartWall,base:secCount-secMS.length,ms:new Float64Array(secMS),fm:new Float64Array(secFM),
               pk:new Float32Array(secPK),cl:new Uint8Array(secCL),bis:Date.now()};
    idb().then(function(d){ if(d) d.transaction("verlauf","readwrite").objectStore("verlauf").put(daten,"v"); });
  }
  function vergessen(){ idb().then(function(d){ if(d) d.transaction("verlauf","readwrite").objectStore("verlauf").delete("v"); }); }
  function laden(){
    return idb().then(function(d){
      if(!d) return null;
      return new Promise(function(ok){
        var r=d.transaction("verlauf").objectStore("verlauf").get("v");
        r.onsuccess=function(){ ok(r.result||null); }; r.onerror=function(){ ok(null); };
      });
    }).catch(function(){ return null; });
  }
  function schieben(){ secMS.shift(); secFM.shift(); secPK.shift(); secCL.shift(); }
  // Fehlende Sekunden bis jetzt als Lücke auffüllen, damit Uhrzeit und Index zusammenpassen.
  function luecke(){
    var bis=absOfWall(Date.now());
    while(secCount<bis){ secMS.push(NaN); secFM.push(NaN); secPK.push(0); secCL.push(0); secCount++; }
    while(secMS.length>KEEP) schieben();
  }
  function wiederherstellen(v){
    if(!v||Date.now()-v.bis>KEEP*1000) return false;
    measureStartWall=v.start; secMS=Array.prototype.slice.call(v.ms);
    // ältere Stände (vor v1.0) haben nur die A-Energie
    secFM=v.fm?Array.prototype.slice.call(v.fm):secMS.slice();
    secPK=v.pk?Array.prototype.slice.call(v.pk):secMS.map(function(){ return 0; });
    secCL=v.cl?Array.prototype.slice.call(v.cl):secMS.map(function(){ return 0; });
    secCount=v.base+secMS.length;
    luecke();
    var alt=Date.now()-KEEP*1000;   // ganz am Anfang abschneiden, was älter als 20 Stunden ist
    while(secMS.length&&wallOfSec(secCount-secMS.length)<alt) schieben();
    return true;
  }
  setInterval(sichern,10000);
  document.addEventListener("visibilitychange",function(){ if(document.hidden) sichern(); });
  window.addEventListener("pagehide",sichern);

  function leeren(){ ring=[]; secMS=[]; secFM=[]; secPK=[]; secCL=[]; secS=0; secN=0; secF=0; secP=0; secC=0; secCount=0; }
  function beginMeasurement(){
    leeren(); msqF=0; msqS=0;
    rawMin=Infinity; rawMax=-Infinity; pkMax=0;
    measureStart=performance.now(); measureStartWall=Date.now();
    settle=performance.now()+700;
    svcShown={}; $("#events").innerHTML="";
    $("#elapsed").textContent="0:00:00";
    if(DEMO){ demoVerlauf(); return; }
    laden().then(function(v){ geladen=true; if(wiederherstellen(v)){ chip(t("chipRestored"),"gut"); draw(); checkServices(); } });
    $("#app").hidden=false;
    syncMeta(); closeSheet();
  }

  // ?demo: zwei Stunden ausgedachter Gottesdienst zum Ausprobieren und für Bildschirmfotos (wird nicht gespeichert)
  var DEMO=/[?&]demo\b/.test(location.search);
  function demoVerlauf(){
    var dauer=2*3600,zufall=function(){ return Math.random()-.5; };
    measureStartWall=Date.now()-dauer*1000;
    var ablauf=[[0,62],[600,94],[1500,78],[1800,96.5],[2400,74],[4800,93],[5600,72],[6300,97.5],[6900,68]];
    var pegel=62;
    for(var i=0;i<dauer;i++){
      for(var j=ablauf.length-1;j>=0;j--) if(i>=ablauf[j][0]){ var ziel=ablauf[j][1]; break; }
      pegel+=(ziel-pegel)*.02;
      var L=pegel+zufall()*4+Math.sin(i/9)*1.5-cfg.off,e=Math.pow(10,L/10);
      secMS.push(e); secFM.push(e*Math.pow(10,(2+Math.random()*3)/10)); secPK.push(Math.pow(10,(L+14+Math.random()*6)/20)); secCL.push(0);
    }
    secCount=dauer;
    $("#app").hidden=false; syncMeta(); closeSheet(); draw();
  }

  $("#go").onclick=function(){
    (live?Promise.resolve():openStream()).then(beginMeasurement)
      .catch(function(e){ $("#devNote").textContent=t("noAccess",e.name||e.message); });
  };
  $("#close").onclick=closeSheet;
  $("#gear").onclick=openSheet;
  document.addEventListener("keydown",function(e){
    if(e.key!=="Escape") return;
    if(!$("#exScrim").hidden) $("#exScrim").hidden=true;
    else if(!$("#scrim").hidden && measureStart) closeSheet();
  });

  $("#startstop").onclick=function(){
    if(live){ stopAudio(); measureStart=null; elLaf.className="stale";
      this.textContent=t("start"); chip(t("chipStopped")); }
    else { openStream().then(function(){ measureStart=performance.now(); if(measureStartWall) luecke(); else measureStartWall=Date.now(); }).catch(function(){}); }
  };
  $("#reset").onclick=function(){ rawMin=Infinity; rawMax=-Infinity; pkMax=0; };
  $("#clear").onclick=function(){
    if(!confirm(t("clearAsk"))) return;
    leeren(); measureStartWall=Date.now(); svcShown={}; $("#events").innerHTML=""; vergessen(); draw();
  };
  $("#fast").onclick=function(){ tau=0.125; cfg.tw="f"; this.setAttribute("aria-pressed","true"); $("#slow").setAttribute("aria-pressed","false"); writeHash(); };
  $("#slow").onclick=function(){ tau=1.0; cfg.tw="s"; this.setAttribute("aria-pressed","true"); $("#fast").setAttribute("aria-pressed","false"); writeHash(); };

  if(cfg.tw==="s"){ $("#slow").setAttribute("aria-pressed","true"); $("#fast").setAttribute("aria-pressed","false"); }
  uebersetzen();
  openSheet(); $("#scrim").hidden=true;   // Felder füllen
  syncMeta();

  /* Ein blockierter Audio-Kontext wird bei der ersten Interaktion nachgestartet */
  ["pointerdown","keydown","touchstart"].forEach(function(e){
    document.addEventListener(e,function(){
      if(ctx && ctx.state==="suspended") ctx.resume();
    },true);
  });

  /* Offline-Fähigkeit und Updates: der Service Worker holt neue Versionen im Hintergrund */
  if("serviceWorker" in navigator && location.protocol==="https:") navigator.serviceWorker.register("sw.js").catch(function(){});

  /* Wurde die Freigabe schon erteilt? */
  function labelProbe(){
    return navigator.mediaDevices.enumerateDevices().then(function(ds){
      return ds.some(function(d){ return d.kind==="audioinput" && d.label; });
    }).catch(function(){ return false; });
  }
  function permissionGranted(){
    if(navigator.permissions && navigator.permissions.query){
      return navigator.permissions.query({name:"microphone"})
        .then(function(p){ return p.state==="granted" ? true : labelProbe(); })
        .catch(labelProbe);
    }
    return labelProbe();
  }

  /* Freigabe vorhanden und kalibriert: ohne Umweg loslegen */
  permissionGranted().then(function(ok){
    if(!ok || !cfg.off){
      return labelProbe().then(function(l){ if(l) return listDevices(); }).then(openSheet);
    }
    return openStream().then(beginMeasurement).catch(function(){ openSheet(); });
  }).catch(function(){ openSheet(); });
})();
