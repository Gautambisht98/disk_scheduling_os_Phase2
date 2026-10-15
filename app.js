/* app.js – GUI controller for the Disk Scheduling Simulator */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const A = window.DiskAlgo, D = window.DiskData, C = window.Charts, T = window.DiskTests;

  let dataset = null;           // { meta, requests }
  let datasetMaxCyl = 0;
  let results = {};             // key -> simulation result
  let hidden = new Set();       // series hidden in the line chart
  let sort = { col: 'totalMove', asc: true };
  let lastPreset = 'timed';
  let vis = null;               // visualizer state

  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = id => parseFloat($(id).value);
  const nf = (v, d) => Number(v).toLocaleString(undefined, { maximumFractionDigits: d === undefined ? 0 : d, minimumFractionDigits: 0 });

  /* ------------------------------------------------------------------ UI bits */
  let toastTimer = null;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast' + (isError ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 3500);
  }

  function showTab(name) {
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
    document.querySelectorAll('.tab-btn').forEach(b => {
      const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on);
    });
    if (name === 'results') drawCharts();
    if (name === 'visual') drawVis();
    if (name === 'setup') drawHist();
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  function swatchStyle(st) {
    return st.dash.length
      ? 'background:repeating-linear-gradient(90deg,' + st.color + ' 0 6px,transparent 6px 10px)'
      : 'background:' + st.color;
  }

  /* ---------------------------------------------------------- algorithm list */
  const CORE_ALGOS = ['FCFS', 'SSTF', 'SCAN', 'C-SCAN', 'LOOK'];
  function buildAlgoList() {
    const checked = new Set([...document.querySelectorAll('#algoList input:checked')].map(i => i.value));
    const first = !document.querySelector('#algoList input');
    $('algoList').innerHTML = A.ORDER.map((k, i) => {
      const a = A.ALGORITHMS[k], st = C.seriesStyle(i);
      return '<label class="algo-item"><input type="checkbox" value="' + esc(k) + '"' + (first || checked.has(k) ? ' checked' : '') + '>' +
        '<span class="sw" style="' + swatchStyle(st) + '"></span>' +
        '<span><span class="name">' + esc(a.name) + '</span> <span class="muted">· ' + a.group + '</span>' +
        '<span class="desc">' + esc(a.desc) + '</span></span></label>';
    }).join('');
  }
  function buildSelects() {
    $('visAlgo').innerHTML = CORE_ALGOS.map(k => '<option value="' + esc(k) + '">' + esc(A.ALGORITHMS[k].name) + '</option>').join('');
    $('algoHelp').innerHTML = '<dl>' + CORE_ALGOS.map(k =>
      '<dt>' + esc(A.ALGORITHMS[k].name) + '</dt><dd>' + esc(A.ALGORITHMS[k].desc) + '</dd>').join('') + '</dl>';
  }
  function selectedKeys() { return [...document.querySelectorAll('#algoList input:checked')].map(i => i.value); }
  function setChecks(fn) { document.querySelectorAll('#algoList input').forEach(i => { i.checked = fn(i.value); }); }
  $('algoAll').onclick = () => setChecks(() => true);
  $('algoNone').onclick = () => setChecks(() => false);
  $('algoClassic').onclick = () => setChecks(k => CORE_ALGOS.includes(k));

  /* ----------------------------------------------------------------- dataset */
  const PRESETS = {
    simple: { seek: 1, rot: false, mode: 'batch', scale: 1 },
    timed: { seek: 0.01, rot: true, mode: 'timed', scale: 10 }
  };
  function applyPreset(p) {
    const v = PRESETS[p];
    $('cfgSeek').value = v.seek; $('cfgRot').checked = v.rot; $('cfgArrMode').value = v.mode; $('cfgArrScale').value = v.scale;
    lastPreset = p;
  }

  function setDataset(ds, label) {
    let maxC = 0; for (const r of ds.requests) if (r.cyl > maxC) maxC = r.cyl;
    datasetMaxCyl = maxC;
    dataset = ds;
    const m = ds.meta;
    const simple = m.source === 'textbook example' || m.source === 'custom queue';
    const wanted = simple ? 'simple' : 'timed';
    if (wanted !== lastPreset) applyPreset(wanted);
    $('cfgCyl').value = Math.max(m.cylinders || 0, maxC + 1);
    $('cfgHead').value = Math.min(m.initialHead, $('cfgCyl').value - 1);
    $('cfgSectors').value = m.sectors || 1;
    if (simple) $('cfgDir').value = m.source === 'textbook example' ? '-1' : $('cfgDir').value;
    describeDataset();
    results = {}; $('resultsBody').hidden = true; $('resultsEmpty').hidden = false;
    toast((label || 'Dataset') + ' loaded: ' + nf(ds.requests.length) + ' requests');
  }

  function describeDataset() {
    const s = D.describe(dataset), m = dataset.meta;
    $('datasetInfo').className = 'dataset-info';
    $('datasetInfo').innerHTML =
      '<b>' + esc(m.source || 'dataset') + '</b> — <b>' + nf(s.count) + '</b> requests · cylinders <b>' + s.minCyl + '–' + s.maxCyl +
      '</b> (mean ' + nf(s.meanCyl) + ') · arrivals <b>' + nf(s.firstArrival, 1) + '–' + nf(s.lastArrival, 1) + ' ms</b>' +
      ' (mean gap ' + nf(s.meanGap, 3) + ' ms)' + (m.seed !== undefined ? ' · seed ' + m.seed : '');
    drawHist();
  }
  function drawHist() {
    if (!dataset || !$('tab-setup').classList.contains('active')) return;
    C.histogram($('histCanvas'), dataset.requests.map(r => r.cyl), Math.max(datasetMaxCyl, num('cfgCyl') - 1), 60, 110);
  }

  function failLoad(e) {
    $('datasetInfo').className = 'dataset-info error';
    $('datasetInfo').textContent = e.message;
    toast(e.message, true);
  }

  $('btnBundled').onclick = () => {
    if (!window.BUNDLED_DATASET_CSV) { toast('Bundled dataset file data/sample_dataset.js was not found. Use Upload CSV or Generate.', true); return; }
    try { setDataset(D.parseCSV(window.BUNDLED_DATASET_CSV, 'bundled disk_requests.csv'), 'Bundled dataset'); } catch (e) { failLoad(e); }
  };
  $('fileInput').onchange = ev => {
    const f = ev.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { setDataset(D.parseCSV(rd.result, f.name), f.name); } catch (e) { failLoad(e); } };
    rd.onerror = () => failLoad(new Error('Could not read the file'));
    rd.readAsText(f); ev.target.value = '';
  };
  $('btnStd').onclick = () => setDataset(D.textbookCase(), 'Textbook case');
  $('btnGen').onclick = () => {
    const count = Math.round(num('genCount')), cyl = Math.round(num('genCyl'));
    if (!(count >= 1 && count <= 200000)) return toast('Requests must be between 1 and 200,000', true);
    if (!(cyl >= 2)) return toast('Cylinders must be at least 2', true);
    const ds = D.generateDataset({
      count, cylinders: cyl, sectors: Math.max(1, Math.round(num('genSec'))),
      initialHead: Math.min(cyl - 1, Math.max(0, Math.round(num('genHead')))), meanInterarrival: num('genGap') || 0.5,
      hotspotShare: Math.min(1, Math.max(0, num('genHot') / 100)), seed: Math.round(num('genSeed')) || 0
    });
    setDataset(ds, 'Generated dataset');
  };
  $('btnCustom').onclick = () => {
    try {
      const head = Math.max(0, Math.round(num('cfgHead')) || 53);
      const ds = D.parseQueueList($('customQueue').value, head);
      let maxC = 0; ds.requests.forEach(r => { if (r.cyl > maxC) maxC = r.cyl; });
      ds.meta.cylinders = Math.max(200, maxC + 1, head + 1); ds.meta.sectors = 1;
      setDataset(ds, 'Custom queue');
    } catch (e) { failLoad(e); }
  };

  /* ------------------------------------------------------------ configuration */
  function readCfg() {
    const cfg = {
      cylinders: Math.round(num('cfgCyl')), initialHead: Math.round(num('cfgHead')), initialDir: +$('cfgDir').value,
      seekMs: num('cfgSeek'), rotation: $('cfgRot').checked, rpm: num('cfgRpm'), sectors: Math.round(num('cfgSectors')),
      arrivalMode: $('cfgArrMode').value, arrivalScale: num('cfgArrScale'), countReturn: $('cfgReturn').checked,
      nStep: Math.round(num('cfgNStep')), hybrid: num('cfgHybrid'), agingMs: num('cfgAging'), window: Math.round(num('cfgWindow')),
      cLookK: Math.round(num('cfgK')), acoWindow: Math.round(num('cfgAcoW')), acoAnts: Math.round(num('cfgAnts')), acoIters: Math.round(num('cfgIters'))
    };
    const bad = msg => { throw new Error(msg); };
    if (!dataset) bad('Load or generate a dataset first.');
    if (!(cfg.cylinders >= 2)) bad('Cylinders must be at least 2.');
    if (!(cfg.initialHead >= 0 && cfg.initialHead < cfg.cylinders)) bad('Initial head must be between 0 and ' + (cfg.cylinders - 1) + '.');
    if (datasetMaxCyl >= cfg.cylinders) bad('The dataset contains cylinder ' + datasetMaxCyl + ' but the disk is set to ' + cfg.cylinders + ' cylinders. Increase "Cylinders".');
    if (!(cfg.seekMs >= 0)) bad('Seek time must be 0 or more.');
    if (!(cfg.rpm > 0)) bad('RPM must be positive.');
    if (!(cfg.sectors >= 1)) bad('Sectors per track must be at least 1.');
    if (!(cfg.arrivalScale > 0)) bad('Arrival-time scale must be positive.');
    if (!(cfg.nStep >= 1)) bad('N must be at least 1.');
    if (!(cfg.hybrid >= 0 && cfg.hybrid <= 1)) bad('Hybrid factor must be between 0 and 1.');
    if (!(cfg.agingMs > 0)) bad('Aging threshold must be positive.');
    if (!(cfg.window >= 1 && cfg.cLookK >= 1)) bad('BAD window and K must be at least 1.');
    if (!(cfg.acoWindow >= 2 && cfg.acoWindow <= 14)) bad('ACO window must be between 2 and 14.');
    if (!(cfg.acoAnts >= 1 && cfg.acoIters >= 1)) bad('ACO ants and iterations must be at least 1.');
    return cfg;
  }

  /* ------------------------------------------------------------------- run */
  const tick = () => new Promise(r => setTimeout(r, 20));
  async function run() {
    let cfg;
    try { cfg = readCfg(); } catch (e) { return toast(e.message, true); }
    const keys = selectedKeys();
    if (!keys.length) return toast('Select at least one algorithm.', true);
    $('runBtn').disabled = true;
    const out = {};
    try {
      for (let i = 0; i < keys.length; i++) {
        $('progressBar').style.width = (i / keys.length * 100) + '%';
        $('progressText').textContent = 'Running ' + A.ALGORITHMS[keys[i]].name + ' (' + (i + 1) + '/' + keys.length + ')…';
        await tick();
        out[keys[i]] = A.runSimulation(dataset.requests, cfg, keys[i]);
      }
    } catch (e) {
      console.error(e); toast('Simulation failed: ' + e.message, true);
      $('runBtn').disabled = false; $('progressText').textContent = ''; return;
    }
    results = out; hidden = new Set();
    $('progressBar').style.width = '100%';
    $('progressText').textContent = 'Done – ' + keys.length + ' algorithms on ' + nf(dataset.requests.length) + ' requests.';
    $('runBtn').disabled = false;
    $('resultsEmpty').hidden = true; $('resultsBody').hidden = false;
    renderResults(); showTab('results');
  }
  $('runBtn').onclick = run;

  /* --------------------------------------------------------------- results */
  const COLS = [
    { k: 'name', label: 'Algorithm' },
    { k: 'totalMove', label: 'Total head movement', f: v => nf(v), best: 'min' },
    { k: 'avgMove', label: 'Avg movement / request', f: v => nf(v, 2), best: 'min' },
    { k: 'avgWait', label: 'Avg wait (ms)', f: v => nf(v, 2), best: 'min' },
    { k: 'p95Wait', label: 'P95 wait (ms)', f: v => nf(v, 1), best: 'min' },
    { k: 'maxWait', label: 'Max wait (ms)', f: v => nf(v, 1), best: 'min' },
    { k: 'stdWait', label: 'Std-dev wait (ms)', f: v => nf(v, 1), best: 'min' },
    { k: 'avgResp', label: 'Avg response (ms)', f: v => nf(v, 2), best: 'min' },
    { k: 'throughput', label: 'Throughput (req/s)', f: v => nf(v, 1), best: 'max' },
    { k: 'makespan', label: 'Total time (ms)', f: v => nf(v, 0), best: 'min' },
    { k: 'computeMs', label: 'Compute (ms)', f: v => nf(v, 0) }
  ];

  function orderedResults() { return CORE_ALGOS.filter(k => results[k]).map(k => results[k]); }
  const style = key => C.seriesStyle(A.ORDER.indexOf(key));

  function renderResults() {
    renderKpis(); renderLegend(); renderTable(); drawCharts();
  }

  function renderKpis() {
    const list = orderedResults();
    const best = (f, dir) => list.reduce((b, r) => (dir === 'min' ? f(r) < f(b) : f(r) > f(b)) ? r : b, list[0]);
    const m = best(r => r.totalMove, 'min'), w = best(r => r.avgWait, 'min'), x = best(r => r.maxWait, 'min'), t = best(r => r.throughput, 'max');
    const card = (label, r, val, sub) =>
      '<div class="kpi"><div class="k-label">' + label + '</div><div class="k-value">' + esc(r.name) + '</div><div class="k-sub">' + val + (sub ? ' · ' + sub : '') + '</div></div>';
    $('kpis').innerHTML =
      card('Lowest head movement', m, nf(m.totalMove) + ' cylinders', nf(m.avgMove, 1) + ' per request') +
      card('Lowest average wait', w, nf(w.avgWait, 2) + ' ms', 'P95 ' + nf(w.p95Wait, 1) + ' ms') +
      card('Least starvation (lowest max wait)', x, nf(x.maxWait, 1) + ' ms', 'std-dev ' + nf(x.stdWait, 1) + ' ms') +
      card('Highest throughput', t, nf(t.throughput, 1) + ' req/s', nf(list[0].n) + ' requests');
  }

  function renderLegend() {
    $('lineLegend').innerHTML = orderedResults().map(r => {
      const st = style(r.key);
      return '<button type="button" data-key="' + esc(r.key) + '" aria-pressed="' + (!hidden.has(r.key)) + '">' +
        '<span class="sw" style="' + swatchStyle(st) + '"></span>' + esc(r.name) + '</button>';
    }).join('');
    $('lineLegend').querySelectorAll('button').forEach(b => b.onclick = () => {
      const k = b.dataset.key;
      if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
      b.setAttribute('aria-pressed', !hidden.has(k)); drawLine();
    });
  }

  function drawLine() {
    const series = orderedResults().filter(r => !hidden.has(r.key)).map(r => {
      const st = style(r.key); return { key: r.key, name: r.name, data: r.cum, color: st.color, dash: st.dash };
    });
    C.line($('lineChart'), series, { height: 400, xLabel: 'Requests served', yLabel: 'Cumulative head movement (cylinders)', logY: $('logLine').checked });
  }
  function drawBars() {
    const list = orderedResults();
    const items = f => list.map(r => { const st = style(r.key); return { key: r.key, label: r.name, value: f(r), color: st.color, dash: st.dash }; });
    C.bar($('barMove'), items(r => r.totalMove), { logX: $('logMove').checked, format: v => nf(v) });
    C.bar($('barWait'), items(r => r.avgWait), { logX: $('logWait').checked, format: v => nf(v, 2) + ' ms' });
  }
  function drawCharts() {
    if (!$('tab-results').classList.contains('active') || !Object.keys(results).length) return;
    drawLine(); drawBars();
  }
  ['logLine', 'logMove', 'logWait'].forEach(id => $(id).onchange = drawCharts);

  function renderTable() {
    const list = orderedResults().slice();
    const col = COLS.find(c => c.k === sort.col) || COLS[1];
    list.sort((a, b) => {
      const x = a[col.k], y = b[col.k];
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return sort.asc ? c : -c;
    });
    const bestVal = {};
    for (const c of COLS) if (c.best) {
      const vals = list.map(r => r[c.k]);
      bestVal[c.k] = c.best === 'min' ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
    }
    $('resultTable').innerHTML = '<thead><tr>' + COLS.map(c =>
      '<th data-k="' + c.k + '" class="' + (sort.col === c.k ? 'sorted' + (sort.asc ? '' : ' desc') : '') + '">' + c.label + '</th>').join('') +
      '</tr></thead><tbody>' + list.map(r => {
        const st = style(r.key);
        return '<tr><td><span class="sw" style="' + swatchStyle(st) + '"></span>' + esc(r.name) + '</td>' + COLS.slice(1).map(c =>
          '<td class="' + (c.best && r[c.k] === bestVal[c.k] ? 'best' : '') + '">' + c.f(r[c.k]) + '</td>').join('') + '</tr>';
      }).join('') + '</tbody>';
    $('resultTable').querySelectorAll('th').forEach(th => th.onclick = () => {
      const k = th.dataset.k;
      if (sort.col === k) sort.asc = !sort.asc; else { sort.col = k; sort.asc = k === 'throughput' ? false : true; }
      renderTable();
    });
  }

  $('exportCsv').onclick = () => {
    const list = orderedResults();
    const head = ['algorithm', 'total_head_movement', 'avg_movement_per_request', 'avg_wait_ms', 'p95_wait_ms', 'max_wait_ms',
      'std_wait_ms', 'avg_response_ms', 'throughput_req_per_s', 'total_time_ms'];
    const rows = list.map(r => [r.name, r.totalMove, r.avgMove, r.avgWait, r.p95Wait, r.maxWait, r.stdWait, r.avgResp, r.throughput, r.makespan]
      .map(v => typeof v === 'number' ? +v.toFixed(4) : '"' + v + '"').join(','));
    download(new Blob([head.join(',') + '\n' + rows.join('\n') + '\n'], { type: 'text/csv' }), 'disk_scheduling_results.csv');
  };
  $('savePng').onclick = () => $('lineChart').toBlob(b => download(b, 'cumulative_head_movement.png'));
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ------------------------------------------------------------- visualizer */
  function visBuild() {
    let cfg;
    try { cfg = readCfg(); } catch (e) { return toast(e.message, true); }
    const n = Math.max(2, Math.min(500, Math.round(num('visCount')) || 30));
    $('visCount').value = n;
    const key = $('visAlgo').value;
    cfg.trace = true;
    let res;
    try { res = A.runSimulation(dataset.requests.slice(0, n), cfg, key); } catch (e) { return toast('Visualizer failed: ' + e.message, true); }
    // cumulative movement per trace point (an uncounted jump adds nothing)
    const tr = res.trace, mv = [0];
    for (let i = 1; i < tr.length; i++) {
      const d = Math.abs(tr[i].cyl - tr[i - 1].cyl);
      mv.push(mv[i - 1] + (tr[i].kind === 'jump' ? 0 : d));
    }
    visStop();
    vis = { trace: tr, mv, idx: 0, cfg, key, res, n };
    const order = tr.filter(p => p.kind === 'serve').map(p => p.cyl);
    $('visOrder').textContent = 'Service order: ' + order.slice(0, 120).join(' → ') + (order.length > 120 ? ' …' : '');
    drawVis();
  }
  let visTimer = null;
  function visStop() { clearInterval(visTimer); visTimer = null; $('visPlay').textContent = '▶ Play'; }
  function visForward() {
    if (!vis) return false;
    if (vis.idx < vis.trace.length - 1) { vis.idx++; drawVis(); return true; }
    visStop(); return false;
  }
  $('visBuild').onclick = visBuild;
  $('visStep').onclick = () => { if (!vis) visBuild(); else { visStop(); visForward(); } };
  $('visReset').onclick = () => { if (!vis) return; visStop(); vis.idx = 0; drawVis(); };
  $('visPlay').onclick = () => {
    if (!vis) visBuild();
    if (!vis) return;
    if (visTimer) { visStop(); return; }
    if (vis.idx >= vis.trace.length - 1) vis.idx = 0;
    $('visPlay').textContent = '⏸ Pause';
    const speed = +$('visSpeed').value;
    visTimer = setInterval(() => { if (!visForward()) visStop(); }, 1100 - speed * 100);
  };
  $('visSpeed').oninput = () => { if (visTimer) { visStop(); $('visPlay').click(); } };
  $('visAlgo').onchange = () => { vis = null; visStop(); drawVis(); };

  function drawVis() {
    const canvas = $('visCanvas');
    if (!$('tab-visual').classList.contains('active')) return;
    const th = C.theme(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(320, canvas.parentElement.clientWidth);
    const pts = vis ? vis.trace.length : 0;
    const rowH = pts > 60 ? 16 : 24, h = Math.max(220, 56 + pts * rowH);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = th.surface; ctx.fillRect(0, 0, w, h);
    ctx.font = '12px system-ui, sans-serif';
    if (!vis) {
      ctx.fillStyle = th.text2; ctx.textAlign = 'center'; ctx.fillText('Choose an algorithm and press Build (or Play).', w / 2, h / 2);
      $('visInfo').innerHTML = ''; return;
    }
    const maxC = vis.cfg.cylinders - 1, ml = 30, mr = 30, mt = 34, pw = w - ml - mr;
    const X = c => ml + c / maxC * pw, Y = i => mt + 10 + i * rowH;
    // axis + grid
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 1;
    for (let k = 0; k <= 10; k++) {
      const c = Math.round(maxC * k / 10), x = Math.round(X(c)) + 0.5;
      ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, h - 10); ctx.stroke();
      ctx.fillStyle = th.text2; ctx.fillText(c, X(c), mt - 10);
    }
    const labels = pts <= 60;
    const st = C.seriesStyle(A.ORDER.indexOf(vis.key));
    // path
    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (let i = 1; i <= vis.idx; i++) {
      const a = vis.trace[i - 1], b = vis.trace[i];
      ctx.strokeStyle = st.color; ctx.setLineDash(b.kind === 'jump' ? [6, 5] : []);
      ctx.beginPath(); ctx.moveTo(X(a.cyl), Y(i - 1)); ctx.lineTo(X(b.cyl), Y(i)); ctx.stroke();
    }
    ctx.setLineDash([]);
    // points
    for (let i = 0; i <= vis.idx; i++) {
      const p = vis.trace[i], x = X(p.cyl), y = Y(i);
      ctx.lineWidth = 2; ctx.strokeStyle = th.surface;
      if (p.kind === 'start') { ctx.fillStyle = th.text; ctx.fillRect(x - 5, y - 5, 10, 10); }
      else if (p.kind === 'serve') { ctx.fillStyle = st.color; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.2832); ctx.fill(); ctx.stroke(); }
      else { ctx.strokeStyle = st.color; ctx.fillStyle = th.surface; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.2832); ctx.fill(); ctx.stroke(); }
      if (labels) {
        ctx.fillStyle = th.text; ctx.textAlign = x > w - 60 ? 'right' : 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(p.cyl, x + (x > w - 60 ? -10 : 10), y);
      }
    }
    const cur = vis.trace[vis.idx], served = vis.trace.slice(0, vis.idx + 1).filter(p => p.kind === 'serve').length;
    // ring on current head position
    ctx.strokeStyle = th.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(cur.cyl), Y(vis.idx), 9, 0, 6.2832); ctx.stroke();
    $('visInfo').innerHTML =
      '<span>Step <b>' + vis.idx + '</b> / ' + (vis.trace.length - 1) + '</span>' +
      '<span>Head at cylinder <b>' + cur.cyl + '</b></span>' +
      '<span>Requests served <b>' + served + '</b> / ' + vis.n + '</span>' +
      '<span>Movement so far <b>' + nf(vis.mv[vis.idx]) + '</b></span>' +
      '<span>Final total <b>' + nf(vis.res.totalMove) + '</b> cylinders</span>' +
      '<span class="muted">■ start · ● served · ○ edge travel / return jump (dashed = uncounted jump)</span>';
  }

  /* ------------------------------------------------------------------ tests */
  $('runTests').onclick = () => {
    $('runTests').disabled = true; $('testSummary').textContent = 'Running…';
    setTimeout(() => {
      try {
        const rows = T.runAll(A, D);
        const ok = rows.filter(r => r.pass).length;
        $('testSummary').innerHTML = '<span class="' + (ok === rows.length ? 'pass' : 'fail') + '">' + ok + ' / ' + rows.length + ' tests passed</span>';
        $('testTable').innerHTML = '<thead><tr><th>Result</th><th>Test</th><th>Expected</th><th>Actual</th><th>Note</th></tr></thead><tbody>' +
          rows.map(r => '<tr><td class="' + (r.pass ? 'pass' : 'fail') + '">' + (r.pass ? '✔ PASS' : '✘ FAIL') + '</td><td>' + esc(r.name) + '</td><td>' +
            esc(r.expected) + '</td><td>' + esc(r.actual) + '</td><td>' + esc(r.note) + '</td></tr>').join('') + '</tbody>';
      } catch (e) { $('testSummary').innerHTML = '<span class="fail">Test run crashed: ' + esc(e.message) + '</span>'; }
      $('runTests').disabled = false;
    }, 30);
  };

  /* ------------------------------------------------------------- housekeeping */
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { drawCharts(); drawHist(); drawVis(); }, 150); });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      buildAlgoList();
      if (Object.keys(results).length) renderResults();
      drawHist(); drawVis();
    });
  }
  ['cfgCyl'].forEach(id => $(id).addEventListener('change', drawHist));

  buildAlgoList(); buildSelects(); applyPreset('timed');
  try {
    const initial = D.generateDataset({ count: 1000, cylinders: 5000, sectors: 64, initialHead: 2500, meanInterarrival: 0.5, hotspotShare: 0.6, seed: 42 });
    setDataset(initial, 'Random sample (seed 42)');
  } catch (e) { failLoad(e); }
  window.__diskApp = { run, setDataset, readCfg, get results() { return results; } };   // handy for debugging in the console
})();
