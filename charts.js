/*
 * charts.js – tiny dependency-free canvas charts (line + horizontal bar).
 *
 * Colour: 8 validated categorical hues (light + dark steps). The simulator has 14
 * algorithms, so slots 9-14 REUSE hues 1-6 with a dashed stroke (composite
 * encoding = hue + dash), never a generated 9th hue. A legend (with toggles) is
 * always shown and the hover tooltip lists every value, so identity is never
 * colour-only.
 */
(function (root) {
  'use strict';

  const LIGHT = {
    surface: '#fcfcfb', text: '#0b0b0b', text2: '#52514e', grid: 'rgba(11,11,11,0.08)', axis: 'rgba(11,11,11,0.35)',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
  };
  const DARK = {
    surface: '#1a1a19', text: '#f0efec', text2: '#c3c2b7', grid: 'rgba(240,239,236,0.10)', axis: 'rgba(240,239,236,0.40)',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
  };

  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function theme() { return isDark() ? DARK : LIGHT; }

  /** Style for the i-th algorithm in fixed order (colour never follows rank). */
  function seriesStyle(i) {
    const th = theme();
    return { color: th.series[i % 8], dash: i >= 8 ? [7, 4] : [] };
  }

  function fmt(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(0) + 'k';
    if (a >= 1000) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  function setup(canvas, height) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(280, canvas.parentElement.clientWidth);
    canvas.style.width = w + 'px'; canvas.style.height = height + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: height };
  }

  /* ------------------------------------------------------------ line chart */
  /**
   * series: [{ key, name, data: ArrayLike<number>, color, dash }]
   * opts:   { height, xLabel, yLabel, logY, yFormat }
   */
  function line(canvas, series, opts) {
    opts = Object.assign({ height: 380, xLabel: '', yLabel: '', logY: false, yFormat: fmt }, opts);
    const th = theme();
    const { ctx, w, h } = setup(canvas, opts.height);
    const m = { l: 62, r: 16, t: 12, b: 46 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const n = series.reduce((a, s) => Math.max(a, s.data.length), 0);
    let ymax = 0;
    for (const s of series) { const d = s.data; for (let i = 0; i < d.length; i += Math.max(1, d.length >> 10)) if (d[i] > ymax) ymax = d[i]; if (d.length && d[d.length - 1] > ymax) ymax = d[d.length - 1]; }
    const logMin = 1;
    let yTop, yScale;
    if (opts.logY) {
      yTop = Math.pow(10, Math.ceil(Math.log10(Math.max(10, ymax))));
      const lo = Math.log10(logMin), hi = Math.log10(yTop);
      yScale = v => m.t + ph - (Math.log10(Math.max(logMin, v)) - lo) / (hi - lo) * ph;
    } else {
      yTop = niceMax(ymax || 1);
      yScale = v => m.t + ph - v / yTop * ph;
    }
    const xScale = i => m.l + (n > 1 ? i / (n - 1) : 0) * pw;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = th.surface; ctx.fillRect(0, 0, w, h);
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';

    // y grid + ticks
    ctx.lineWidth = 1;
    const yTicks = [];
    if (opts.logY) { for (let p = 0; p <= Math.log10(yTop); p++) yTicks.push(Math.pow(10, p)); }
    else for (let k = 0; k <= 5; k++) yTicks.push(yTop * k / 5);
    ctx.textAlign = 'right';
    for (const v of yTicks) {
      const y = Math.round(yScale(v)) + 0.5;
      ctx.strokeStyle = th.grid; ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(w - m.r, y); ctx.stroke();
      ctx.fillStyle = th.text2; ctx.fillText(opts.yFormat(v), m.l - 8, y);
    }
    // x ticks
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let k = 0; k <= 5; k++) {
      const i = Math.round((n - 1) * k / 5), x = xScale(i);
      ctx.strokeStyle = th.axis; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, m.t + ph); ctx.lineTo(Math.round(x) + 0.5, m.t + ph + 4); ctx.stroke();
      ctx.fillStyle = th.text2; ctx.fillText(fmt(i + 1), x, m.t + ph + 8);
    }
    ctx.strokeStyle = th.axis; ctx.beginPath(); ctx.moveTo(m.l, m.t + ph + 0.5); ctx.lineTo(w - m.r, m.t + ph + 0.5); ctx.stroke();
    ctx.fillStyle = th.text2; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(opts.xLabel, m.l + pw / 2, h - 6);
    ctx.save(); ctx.translate(14, m.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
    ctx.fillText(opts.yLabel + (opts.logY ? ' (log scale)' : ''), 0, 0); ctx.restore();

    // series (2 px lines, sampled per pixel column)
    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (const s of series) {
      const d = s.data; if (!d.length) continue;
      ctx.strokeStyle = s.color; ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      const cols = Math.min(pw, d.length);
      for (let c = 0; c <= cols; c++) {
        const i = Math.round(c / cols * (d.length - 1));
        const x = xScale(i / Math.max(1, d.length - 1) * (n - 1)), y = yScale(d[i]);
        if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // hover layer -----------------------------------------------------------
    const wrap = canvas.parentElement;
    let tip = wrap.querySelector('.chart-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; wrap.appendChild(tip); }
    tip.style.display = 'none';
    const base = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dpr = window.devicePixelRatio || 1;

    canvas.onmousemove = ev => {
      const r = canvas.getBoundingClientRect();
      const px = ev.clientX - r.left;
      if (px < m.l || px > w - m.r || n < 2) { canvas.onmouseleave(); return; }
      const i = Math.max(0, Math.min(n - 1, Math.round((px - m.l) / pw * (n - 1))));
      ctx.putImageData(base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x = xScale(i);
      ctx.strokeStyle = th.axis; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, m.t); ctx.lineTo(Math.round(x) + 0.5, m.t + ph); ctx.stroke();
      const rows = [];
      for (const s of series) {
        if (!s.data.length) continue;
        const j = Math.min(s.data.length - 1, Math.round(i / (n - 1) * (s.data.length - 1)));
        const v = s.data[j];
        rows.push({ s, v });
        ctx.fillStyle = s.color; ctx.strokeStyle = th.surface; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, yScale(v), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      rows.sort((a, b) => a.v - b.v);
      tip.innerHTML = '<div class="tip-h">Request #' + (i + 1).toLocaleString() + '</div>' + rows.map(o =>
        '<div class="tip-r"><span class="sw" style="' + swatch(o.s) + '"></span><span class="tn">' + esc(o.s.name) +
        '</span><b>' + Math.round(o.v).toLocaleString() + '</b></div>').join('');
      tip.style.display = 'block';
      const tw = tip.offsetWidth, th2 = tip.offsetHeight;
      let tx = x + 14; if (tx + tw > w) tx = x - tw - 14;
      let ty = ev.clientY - r.top - th2 / 2; ty = Math.max(0, Math.min(h - th2, ty));
      tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
    };
    canvas.onmouseleave = () => { tip.style.display = 'none'; ctx.putImageData(base, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  }

  function swatch(s) {
    return s.dash && s.dash.length
      ? 'background:repeating-linear-gradient(90deg,' + s.color + ' 0 5px,transparent 5px 8px);height:3px'
      : 'background:' + s.color + ';height:3px';
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ------------------------------------------------------------- bar chart */
  /**
   * items: [{ key, label, value, color, dash }]  (drawn best = smallest first)
   * opts:  { logX, format, unit }
   */
  function bar(canvas, items, opts) {
    opts = Object.assign({ logX: false, format: v => Math.round(v).toLocaleString() }, opts);
    const th = theme();
    const rowH = 28, gap = 2, top = 6, bottom = 6;
    const sorted = items.slice().sort((a, b) => a.value - b.value);
    const height = top + bottom + sorted.length * rowH;
    const { ctx, w, h } = setup(canvas, height);
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = th.surface; ctx.fillRect(0, 0, w, h);
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    let labelW = 0; for (const it of sorted) labelW = Math.max(labelW, ctx.measureText(it.label).width);
    labelW = Math.min(labelW + 12, w * 0.4);
    const valW = 96, x0 = labelW + 4, x1 = w - valW;
    const vmax = Math.max.apply(null, sorted.map(i => i.value)) || 1;
    const len = v => opts.logX
      ? Math.max(2, Math.log10(Math.max(1, v) + 1) / Math.log10(vmax + 1) * (x1 - x0))
      : Math.max(2, v / vmax * (x1 - x0));
    sorted.forEach((it, k) => {
      const y = top + k * rowH, bh = rowH - gap * 2 - 4, by = y + gap + 2, L = len(it.value);
      ctx.fillStyle = th.text; ctx.textAlign = 'right'; ctx.fillText(it.label, labelW, y + rowH / 2);
      ctx.fillStyle = it.color;
      const r = Math.min(4, bh / 2, L);
      ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x0 + L - r, by); ctx.arcTo(x0 + L, by, x0 + L, by + r, r);
      ctx.lineTo(x0 + L, by + bh - r); ctx.arcTo(x0 + L, by + bh, x0 + L - r, by + bh, r); ctx.lineTo(x0, by + bh); ctx.closePath(); ctx.fill();
      if (it.dash && it.dash.length) {              // diagonal hatch = "dashed" family
        ctx.save(); ctx.clip(); ctx.strokeStyle = th.surface; ctx.lineWidth = 2;
        for (let hx = x0 - bh; hx < x0 + L; hx += 8) { ctx.beginPath(); ctx.moveTo(hx, by + bh); ctx.lineTo(hx + bh, by); ctx.stroke(); }
        ctx.restore();
      }
      ctx.fillStyle = th.text2; ctx.textAlign = 'left'; ctx.fillText(opts.format(it.value), x0 + L + 8, y + rowH / 2);
    });
    ctx.strokeStyle = th.axis; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0 + 0.5, top); ctx.lineTo(x0 + 0.5, h - bottom); ctx.stroke();
  }

  /* -------------------------------------------------- dataset histogram */
  function histogram(canvas, values, max, bins, height) {
    const th = theme();
    const { ctx, w, h } = setup(canvas, height || 110);
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = th.surface; ctx.fillRect(0, 0, w, h);
    const counts = new Array(bins).fill(0);
    for (const v of values) counts[Math.min(bins - 1, Math.floor(v / (max + 1) * bins))]++;
    const cm = Math.max.apply(null, counts) || 1, bw = (w - 8) / bins;
    ctx.fillStyle = theme().series[0];
    counts.forEach((c, i) => { const bh = c / cm * (h - 22); ctx.fillRect(4 + i * bw + 1, h - 16 - bh, Math.max(1, bw - 2), bh); });
    ctx.fillStyle = th.text2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('0', 4, h - 4);
    ctx.textAlign = 'right'; ctx.fillText('cylinder ' + max, w - 4, h - 4);
  }

  root.Charts = { line, bar, histogram, seriesStyle, theme, isDark, fmt };
})(window);
