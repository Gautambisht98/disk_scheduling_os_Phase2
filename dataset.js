/*
 * dataset.js – create, parse and describe disk request datasets.
 *
 * A dataset is { meta, requests } where every request is
 *   { id, t (arrival time, ms), cyl (cylinder), sec (sector) }
 *
 * CSV format (same as the bundled disk_requests.csv):
 *   # initial_head=2500,cylinders=5000,sectors_per_track=64,seed=42
 *   request_id,arrival_time,cylinder,sector
 *   1,0.51,2003,13
 *   ...
 */
(function (root) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Same recipe as generate_dataset.py: 60 % hot-spot clusters + 40 % uniform, Poisson arrivals. */
  function generateDataset(opts) {
    const o = Object.assign({
      count: 20000, cylinders: 5000, sectors: 64, initialHead: 2500,
      meanInterarrival: 0.5, hotspotShare: 0.6, seed: 42
    }, opts);
    const rng = mulberry32(o.seed);
    const spots = [[0.10, 0.024], [0.40, 0.04], [0.76, 0.03]].map(([c, s]) =>
      [Math.round(c * o.cylinders), Math.max(1, Math.round(s * o.cylinders))]);
    const requests = [];
    let t = 0;
    for (let i = 0; i < o.count; i++) {
      t += -Math.log(1 - rng()) * o.meanInterarrival;
      let cyl;
      if (rng() < o.hotspotShare) {
        const [c, s] = spots[Math.floor(rng() * spots.length)];
        cyl = Math.min(o.cylinders - 1, Math.max(0, Math.round(c + gaussian(rng) * s)));
      } else cyl = Math.floor(rng() * o.cylinders);
      requests.push({ id: i + 1, t: Math.round(t * 1000) / 1000, cyl, sec: Math.floor(rng() * o.sectors) });
    }
    return {
      meta: { initialHead: o.initialHead, cylinders: o.cylinders, sectors: o.sectors, seed: o.seed, source: 'generated in browser' },
      requests
    };
  }

  /** Parse the CSV described above (header line and '#' meta line are optional). */
  function parseCSV(text, sourceName) {
    const meta = { source: sourceName || 'uploaded file' };
    const requests = [];
    let cols = null;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line[0] === '#') {
        line.slice(1).split(/[,\s]+/).forEach(kv => {
          const [k, v] = kv.split('=');
          if (k && v !== undefined && v !== '' && !isNaN(+v)) meta[k.trim()] = +v;
        });
        continue;
      }
      const parts = line.split(/[,;\t ]+/);
      if (cols === null && /[a-zA-Z]/.test(parts[0])) { cols = parts.map(s => s.toLowerCase()); continue; }
      let id, t, cyl, sec;
      if (cols) {
        const get = names => { for (const nm of names) { const k = cols.indexOf(nm); if (k >= 0) return +parts[k]; } return NaN; };
        id = get(['request_id', 'id']); t = get(['arrival_time', 'arrival', 'time', 't']);
        cyl = get(['cylinder', 'cyl', 'track']); sec = get(['sector', 'sec']);
      } else if (parts.length >= 4) { [id, t, cyl, sec] = parts.map(Number); }
      else if (parts.length === 2) { [t, cyl] = parts.map(Number); }
      else { cyl = +parts[0]; }
      if (isNaN(cyl)) continue;
      requests.push({ id: isNaN(id) ? requests.length + 1 : id, t: isNaN(t) ? 0 : t, cyl: Math.round(cyl), sec: isNaN(sec) ? 0 : Math.round(sec) });
    }
    if (!requests.length) throw new Error('No valid requests found. Expected columns: request_id, arrival_time, cylinder, sector');
    return finish(requests, meta);
  }

  /** Parse a quick list such as "98, 183, 37, 122" (all arrive at t = 0). */
  function parseQueueList(text, initialHead) {
    const nums = String(text).split(/[^0-9]+/).filter(Boolean).map(Number);
    if (!nums.length) throw new Error('Enter at least one cylinder number');
    const requests = nums.map((c, i) => ({ id: i + 1, t: 0, cyl: c, sec: 0 }));
    const meta = { source: 'custom queue', initialHead: initialHead };
    return finish(requests, meta);
  }

  function finish(requests, meta) {
    requests.sort((a, b) => a.t - b.t || a.id - b.id);
    let maxC = 0, maxS = 0;
    for (const r of requests) { if (r.cyl > maxC) maxC = r.cyl; if (r.sec > maxS) maxS = r.sec; }
    if (!meta.cylinders) meta.cylinders = maxC + 1;
    if (!meta.sectors && !meta.sectors_per_track) meta.sectors = maxS + 1;
    if (meta.sectors_per_track) meta.sectors = meta.sectors_per_track;
    if (meta.initial_head !== undefined) meta.initialHead = meta.initial_head;
    if (meta.initialHead === undefined) meta.initialHead = Math.floor(meta.cylinders / 2);
    return { meta, requests };
  }

  /** The classic 8-request textbook example (Silberschatz et al.). */
  function textbookCase() {
    const q = [98, 183, 37, 122, 14, 124, 65, 67];
    return {
      meta: { initialHead: 53, cylinders: 200, sectors: 1, source: 'textbook example' },
      requests: q.map((c, i) => ({ id: i + 1, t: 0, cyl: c, sec: 0 }))
    };
  }

  function describe(ds) {
    const r = ds.requests, n = r.length;
    let minC = Infinity, maxC = -Infinity, sum = 0;
    for (const x of r) { if (x.cyl < minC) minC = x.cyl; if (x.cyl > maxC) maxC = x.cyl; sum += x.cyl; }
    return {
      count: n, minCyl: minC, maxCyl: maxC, meanCyl: sum / n,
      firstArrival: r[0].t, lastArrival: r[n - 1].t,
      meanGap: n > 1 ? (r[n - 1].t - r[0].t) / (n - 1) : 0
    };
  }

  const api = { generateDataset, parseCSV, parseQueueList, textbookCase, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiskData = api;
})(typeof window !== 'undefined' ? window : globalThis);
