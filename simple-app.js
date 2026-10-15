(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PALETTE = ['#8bb9ff','#ff966e','#b8ef72','#f3c969','#d9a0ff','#78d6b3','#f28b82','#8bd3e6','#e5b567','#c3a6ff','#f2a6ca','#a7d46f','#ed9a50','#79a9ff','#c8d0d9'];
  const COLORS = Object.fromEntries(DiskAlgo.ORDER.map((key,i)=>[key,PALETTE[i%PALETTE.length]]));
  let dataset = null, results = [], currentMode = '';

  function notify(message, error=false) {
    const toast=$('toast'); toast.textContent=message; toast.classList.add('show');
    toast.style.background=error?'#ffd9d9':'#d9f8b7'; toast.style.color=error?'#601616':'#17220f';
    clearTimeout(notify.timer); notify.timer=setTimeout(()=>toast.classList.remove('show'),3200);
  }
  function fmt(n) { return Number(n).toLocaleString(undefined,{maximumFractionDigits:2}); }
  function buildAlgorithmControls() {
    $('singleAlgo').innerHTML = DiskAlgo.ORDER.map(key => {
      const a = DiskAlgo.ALGORITHMS[key];
      return '<option value="'+key+'">'+a.name+'</option>';
    }).join('');
    $('algoOptions').innerHTML = DiskAlgo.ORDER.map(key => {
      const a = DiskAlgo.ALGORITHMS[key];
      return '<label title="'+a.desc.replace(/"/g,'&quot;')+'"><input type="checkbox" value="'+key+'" checked><span>'+a.name+'</span></label>';
    }).join('');
  }
  function getConfig() {
    const cylinders=Math.floor(Number($('cylinders').value));
    const initialHead=Math.floor(Number($('head').value));
    if (!Number.isInteger(cylinders)||cylinders<2) throw new Error('Disk cylinders must be at least 2.');
    if (!Number.isInteger(initialHead)||initialHead<0||initialHead>=cylinders) throw new Error('Initial head must be between 0 and '+(cylinders-1)+'.');
    $('head').max=cylinders-1;
    return {cylinders,initialHead,initialDir:Number($('direction').value),seekMs:1,rotation:false,rpm:7200,sectors:1,fixedMs:0,arrivalMode:'batch',arrivalScale:1,countReturn:true,trace:true};
  }
  function generateQueue() {
    const cfg=getConfig(), count=Math.floor(Number($('requestCount').value)), seed=Math.floor(Number($('seed').value));
    if (!Number.isInteger(count)||count<1||count>20000) throw new Error('Request count must be between 1 and 20,000.');
    if (!Number.isFinite(seed)) throw new Error('Enter a valid random seed.');
    const pattern=$('workloadType').value;
    let requests=[];
    if(pattern==='custom') {
      const raw=$('customQueueInput').value.trim();
      const nums=raw.split(/[\s,;]+/).filter(Boolean).map(Number);
      if(!nums.length) throw new Error('Enter at least one cylinder number.');
      if(nums.length>20000) throw new Error('A custom request queue can contain at most 20,000 requests.');
      if(nums.some(n=>!Number.isInteger(n)||n<0||n>=cfg.cylinders)) throw new Error('Enter cylinder numbers from 0 to '+(cfg.cylinders-1)+'.');
      requests=nums.map((cyl,i)=>({id:i+1,t:0,cyl,sec:0}));
      $('requestCount').value=requests.length;
    } else if(pattern==='sequential') {
      // A sequential workload visits cylinders in increasing order, wrapping at the disk edge.
      const start=Math.min(cfg.cylinders-1,Math.max(0,cfg.initialHead));
      requests=Array.from({length:count},(_,i)=>({id:i+1,t:0,cyl:(start+i)%cfg.cylinders,sec:0}));
    } else {
      const ds=DiskData.generateDataset({count,cylinders:cfg.cylinders,sectors:1,initialHead:cfg.initialHead,meanInterarrival:1,hotspotShare:0,seed});
      requests=ds.requests.map((r,i)=>({id:i+1,t:0,cyl:r.cyl,sec:0}));
    }
    dataset={meta:{source:pattern,initialHead:cfg.initialHead,cylinders:cfg.cylinders,seed},requests};
    $('queueStatus').textContent=requests.length.toLocaleString()+' requests ready';
    const labels={random:'Random workload',sequential:'Sequential workload',custom:'Custom workload'};
    $('queueMessage').textContent=labels[pattern]+' · '+requests.length.toLocaleString()+' requests · '+(pattern==='random'?'seed '+seed:pattern==='sequential'?'increasing cylinder order':'user-provided queue');
    $('queuePreview').textContent=requests.slice(0,150).map(r=>r.cyl).join(', ')+(requests.length>150?' … (first 150 shown)':'');
    results=[]; $('results').hidden=true;
    return true;
  }
  function ensureQueue() { if(!dataset) generateQueue(); }
  function selectedCompare(){return [...document.querySelectorAll('#algoOptions input:checked')].map(x=>x.value);}
  function run(keys,mode){
    try {
      if(!keys.length){notify('Choose at least one algorithm.',true);return;}
      const cfg=getConfig(); ensureQueue();
      // All algorithms receive the same request objects and the same starting configuration.
      results=keys.map(key=>DiskAlgo.runSimulation(dataset.requests.map(r=>({...r})),{...cfg,trace:true},key));
      for(const r of results){
        const served=(r.trace||[]).filter(p=>p.kind==='serve');
        if(served.length!==dataset.requests.length) throw new Error(r.name+' did not serve every request.');
        if(!Number.isFinite(r.totalMove)||!Number.isFinite(r.avgResp)) throw new Error(r.name+' returned an invalid result.');
      }
      currentMode=mode; $('results').hidden=false;
      $('resultsHeading').textContent=mode==='single'?results[0].name+' results':'Algorithm comparison';
      $('resultsSub').textContent=results.length+' algorithm'+(results.length===1?'':'s')+' · '+dataset.requests.length.toLocaleString()+' identical requests · initial head '+cfg.initialHead+' · '+dataset.meta.source+' workload.';
      renderMetrics();renderTable();renderChart();renderOrderSelect();renderOrder();
      $('results').scrollIntoView({behavior:'smooth',block:'start'});
      notify(mode==='single'?'Algorithm completed successfully.':'Comparison completed successfully.');
    } catch(e){console.error(e);notify(e.message||'Simulation failed.',true);}
  }
  function renderMetrics(){
    const bestMove=results.reduce((a,b)=>a.totalMove<=b.totalMove?a:b);
    const bestAccess=results.reduce((a,b)=>a.avgResp<=b.avgResp?a:b);
    const cards=[
      {label:'Lowest head movement',value:fmt(bestMove.totalMove)+' cylinders',sub:bestMove.name},
      {label:'Lowest average access time',value:fmt(bestAccess.avgResp)+' ms',sub:bestAccess.name},
      {label:'Queue size',value:dataset.requests.length.toLocaleString()+' requests',sub:dataset.meta.source+' workload'}
    ];
    $('metrics').innerHTML=cards.map(c=>'<div class="metric"><span class="label">'+c.label+'</span><strong>'+c.value+'</strong><small>'+c.sub+'</small></div>').join('');
  }
  function renderTable(){
    const minMove=Math.min(...results.map(r=>r.totalMove)),minAccess=Math.min(...results.map(r=>r.avgResp)),minWait=Math.min(...results.map(r=>r.avgWait));
    $('resultsRows').innerHTML=results.slice().sort((a,b)=>a.totalMove-b.totalMove).map(r=>'<tr><td><span class="algo-name"><i class="algo-dot" style="background:'+COLORS[r.key]+'"></i>'+r.name+'</span></td><td class="'+(r.totalMove===minMove?'best':'')+'">'+fmt(r.totalMove)+'</td><td class="'+(Math.abs(r.avgResp-minAccess)<1e-9?'best':'')+'">'+fmt(r.avgResp)+'</td><td class="'+(Math.abs(r.avgWait-minWait)<1e-9?'best':'')+'">'+fmt(r.avgWait)+'</td><td>'+r.n.toLocaleString()+'</td></tr>').join('');
  }
  function renderChart(){
    const canvas=$('movementChart'),ctx=canvas.getContext('2d'),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
    const w=Math.max(320,rect.width),h=Math.max(220,rect.height);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
    const m={l:62,r:18,t:18,b:38},pw=w-m.l-m.r,ph=h-m.t-m.b;ctx.clearRect(0,0,w,h);ctx.font='11px system-ui';ctx.lineWidth=1;
    const maxY=Math.max(1,...results.map(r=>r.totalMove));
    for(let i=0;i<=4;i++){const val=maxY*i/4,y=m.t+ph-(val/maxY)*ph;ctx.strokeStyle='#303730';ctx.beginPath();ctx.moveTo(m.l,y);ctx.lineTo(w-m.r,y);ctx.stroke();ctx.fillStyle='#a3ada1';ctx.textAlign='right';ctx.fillText(fmt(val),m.l-8,y+4);}
    ctx.fillStyle='#a3ada1';ctx.textAlign='center';ctx.fillText('Requests served',m.l+pw/2,h-8);
    ctx.save();ctx.translate(14,m.t+ph/2);ctx.rotate(-Math.PI/2);ctx.fillText('Cumulative head movement (cylinders)',0,0);ctx.restore();
    results.forEach(r=>{const arr=r.cum;ctx.strokeStyle=COLORS[r.key]||'#fff';ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<arr.length;i++){const x=m.l+(arr.length>1?i/(arr.length-1):0)*pw,y=m.t+ph-(arr[i]/maxY)*ph;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();});
    $('legend').innerHTML=results.map(r=>'<span class="legend-item"><i class="legend-line" style="background:'+COLORS[r.key]+'"></i>'+r.name+'</span>').join('');
  }
  function renderOrderSelect(){const old=$('orderAlgo').value;$('orderAlgo').innerHTML=results.map(r=>'<option value="'+r.key+'">'+r.name+'</option>').join('');if(results.some(r=>r.key===old))$('orderAlgo').value=old;}
  function renderOrder(){const r=results.find(x=>x.key===$('orderAlgo').value)||results[0];if(!r)return;const served=(r.trace||[]).filter(p=>p.kind==='serve');$('requestOrder').innerHTML='<span class="request-chip">Start: '+getConfig().initialHead+'</span>'+served.slice(0,150).map((p,i)=>'<span class="request-chip" title="Request '+p.id+'">'+(i+1)+': '+p.cyl+'</span>').join('')+(served.length>150?'<span class="request-chip">… '+(served.length-150)+' more</span>':'');}
  function download(){if(!results.length)return;const rows=[['Algorithm','Total head movement (cylinders)','Average access time (ms)','Average wait (ms)','Requests served'],...results.map(r=>[r.name,r.totalMove,r.avgResp,r.avgWait,r.n])];const csv=rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');const a=document.createElement('a');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.href=url;a.download='disk-scheduling-results.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('workloadType').addEventListener('change',()=>{$('customQueueWrap').hidden=$('workloadType').value!=='custom';});
  $('generateBtn').addEventListener('click',()=>{try{generateQueue();notify('Request queue created. Run an algorithm or comparison.');}catch(e){notify(e.message,true);}});
  $('runSingleBtn').addEventListener('click',()=>run([$ ('singleAlgo').value],'single'));
  $('runCompareBtn').addEventListener('click',()=>run(selectedCompare(),'compare'));
  $('selectAllBtn').addEventListener('click',()=>document.querySelectorAll('#algoOptions input').forEach(x=>x.checked=true));
  $('selectNoneBtn').addEventListener('click',()=>document.querySelectorAll('#algoOptions input').forEach(x=>x.checked=false));
  $('showQueueBtn').addEventListener('click',()=>{const p=$('queuePreview'),open=p.hidden;p.hidden=!open;$('showQueueBtn').textContent=open?'Hide request queue ↑':'Show request queue ↓';$('showQueueBtn').setAttribute('aria-expanded',String(open));});
  $('orderAlgo').addEventListener('change',renderOrder);$('downloadBtn').addEventListener('click',download);
  $('resetBtn').addEventListener('click',()=>{$('results').hidden=true;results=[];window.scrollTo({top:0,behavior:'smooth'});});
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(results.length)renderChart();},120);});
  buildAlgorithmControls();
  try{generateQueue();}catch(e){notify(e.message,true);}
})();
