/*
 * algorithms.js  –  Disk-scheduling simulation engine + 14 scheduling algorithms
 * -----------------------------------------------------------------------------
 * Works in the browser (window.DiskAlgo) and in Node (module.exports) so the same
 * code that powers the GUI is covered by tests/run_tests.js.
 *
 * SIMULATION MODEL (identical for every algorithm => fair comparison)
 *   - The head starts at cfg.initialHead at time 0.
 *   - Requests become visible to the scheduler only at their arrival time
 *     (cfg.arrivalMode = 'timed'), or all at t = 0 (cfg.arrivalMode = 'batch').
 *   - Seek time      = |cylinder distance| * cfg.seekMs
 *   - Rotation       = (optional) the platter spins at cfg.rpm; after the seek the
 *                      head waits until the wanted sector passes under it, then
 *                      reads one sector (period / sectors).
 *   - Wait time      = (time the request is dispatched) - (its arrival time)
 *   - Response time  = (time the request completes)     - (its arrival time)
 *   - Head movement  = total cylinders travelled (including SCAN / C-SCAN edge
 *                      travel and, optionally, the C-SCAN / C-LOOK return jump).
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ utils */
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

  /** Array kept sorted by (cylinder, arrival index). */
  class SortedList {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    lowerBound(c) {           // first index with cyl >= c
      const a = this.a; let lo = 0, hi = a.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].cyl < c) lo = m + 1; else hi = m; }
      return lo;
    }
    upperBound(c) {           // first index with cyl > c
      const a = this.a; let lo = 0, hi = a.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].cyl <= c) lo = m + 1; else hi = m; }
      return lo;
    }
    insert(r) {
      const a = this.a; let lo = 0, hi = a.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1, x = a[m];
        if (x.cyl < r.cyl || (x.cyl === r.cyl && x.id < r.id)) lo = m + 1; else hi = m;
      }
      a.splice(lo, 0, r);
    }
    removeAt(i) { return this.a.splice(i, 1)[0]; }
    indexOf(r) {
      const a = this.a; let i = this.lowerBound(r.cyl);
      while (i < a.length && a[i].cyl === r.cyl) { if (a[i] === r) return i; i++; }
      return -1;
    }
  }

  /** Indices of the nearest request on each side of the head (-1 if none). */
  function sides(list, head) {
    const a = list.a, n = a.length;
    const lb = list.lowerBound(head);
    const up = lb < n ? lb : -1;                       // first request with cyl >= head
    const ub = list.upperBound(head) - 1;              // last request with cyl <= head
    const down = ub >= 0 ? list.lowerBound(a[ub].cyl) : -1;
    return { up, down };
  }

  /** Contiguous index range [s, e) holding the m requests nearest to the head. */
  function nearestRange(list, head, m) {
    const a = list.a, n = a.length;
    let hi = list.lowerBound(head), lo = hi - 1, cnt = 0;
    while (cnt < m && (lo >= 0 || hi < n)) {
      if (lo < 0) hi++;
      else if (hi >= n) lo--;
      else if (head - a[lo].cyl <= a[hi].cyl - head) lo--;
      else hi++;
      cnt++;
    }
    return [lo + 1, hi];
  }

  /* ------------------------------------------------------- shared pickers */
  /** LOOK: continue in state.dir to the nearest request, reverse when none ahead. */
  function pickLook(list, head, state) {
    const a = list.a;
    for (let t = 0; t < 2; t++) {
      if (state.dir > 0) {
        const i = list.lowerBound(head);
        if (i < a.length) return list.removeAt(i);
      } else {
        const j = list.upperBound(head) - 1;
        if (j >= 0) return list.removeAt(list.lowerBound(a[j].cyl));
      }
      state.dir = -state.dir;
    }
    throw new Error('pickLook called on an empty list');
  }

  /** SCAN: like LOOK but the head first travels to the physical disk edge. */
  function pickScan(list, sim, state) {
    const a = list.a, max = sim.cfg.maxCyl;
    for (let guard = 0; guard < 4; guard++) {
      if (state.dir > 0) {
        const i = list.lowerBound(sim.head);
        if (i < a.length) return list.removeAt(i);
        if (sim.head < max) sim.travel(max);
      } else {
        const j = list.upperBound(sim.head) - 1;
        if (j >= 0) return list.removeAt(list.lowerBound(a[j].cyl));
        if (sim.head > 0) sim.travel(0);
      }
      state.dir = -state.dir;
      sim.admit();
    }
    throw new Error('pickScan called on an empty list');
  }

  /** Hybrid SSTF/LOOK pick. factor 0 => LOOK, factor 1 => SSTF. */
  function pickHybrid(list, head, state, factor) {
    const a = list.a, s = sides(list, head);
    const ahead = state.dir > 0 ? s.up : s.down;
    const behind = state.dir > 0 ? s.down : s.up;
    let pick;
    if (ahead === -1) { state.dir = -state.dir; pick = behind; }
    else if (behind === -1) pick = ahead;
    else {
      const dA = Math.abs(a[ahead].cyl - head), dB = Math.abs(a[behind].cyl - head);
      if (dB < factor * dA) { state.dir = -state.dir; pick = behind; } else pick = ahead;
    }
    return list.removeAt(pick);
  }

  /* ------------------------------------------------------------ schedulers */
  class ListSched {
    constructor() { this.list = new SortedList(); }
    add(r) { this.list.insert(r); }
    get size() { return this.list.size; }
  }

  class FCFS {
    constructor() { this.q = []; this.h = 0; }
    add(r) { this.q.push(r); }
    get size() { return this.q.length - this.h; }
    next() {
      const r = this.q[this.h]; this.q[this.h++] = undefined;
      if (this.h > 2048 && this.h * 2 > this.q.length) { this.q = this.q.slice(this.h); this.h = 0; }
      return r;
    }
  }

  class LIFO {
    constructor() { this.s = []; }
    add(r) { this.s.push(r); }
    get size() { return this.s.length; }
    next() { return this.s.pop(); }
  }

  class SSTF extends ListSched {
    next(sim) {
      const a = this.list.a, s = sides(this.list, sim.head);
      let i;
      if (s.up === -1) i = s.down;
      else if (s.down === -1) i = s.up;
      else {
        const dU = a[s.up].cyl - sim.head, dD = sim.head - a[s.down].cyl;
        i = dU < dD ? s.up : dD < dU ? s.down : (a[s.up].id < a[s.down].id ? s.up : s.down);
      }
      return this.list.removeAt(i);
    }
  }

  class SCAN extends ListSched {
    constructor(cfg) { super(); this.st = { dir: cfg.initialDir }; }
    next(sim) { return pickScan(this.list, sim, this.st); }
  }

  class LOOK extends ListSched {
    constructor(cfg) { super(); this.st = { dir: cfg.initialDir }; }
    next(sim) { return pickLook(this.list, sim.head, this.st); }
  }

  class CSCAN extends ListSched {
    constructor(cfg) { super(); this.dir = cfg.initialDir >= 0 ? 1 : -1; }
    next(sim) {
      const list = this.list, a = list.a, max = sim.cfg.maxCyl;
      if (this.dir > 0) {
        const i = list.lowerBound(sim.head);
        if (i < a.length) return list.removeAt(i);
        if (sim.head < max) sim.travel(max);
        if (sim.cfg.countReturn) sim.travel(0); else sim.teleport(0);
        sim.admit();
        return list.removeAt(list.lowerBound(sim.head));
      }
      const i = list.upperBound(sim.head) - 1;
      if (i >= 0) return list.removeAt(list.lowerBound(a[i].cyl));
      if (sim.head > 0) sim.travel(0);
      if (sim.cfg.countReturn) sim.travel(max); else sim.teleport(max);
      sim.admit();
      return list.removeAt(list.upperBound(sim.head) - 1);
    }
  }

  class CLOOK extends ListSched {
    constructor(cfg) { super(); this.dir = cfg.initialDir >= 0 ? 1 : -1; }
    next(sim) {
      const list = this.list, a = list.a;
      if (this.dir > 0) {
        let i = list.lowerBound(sim.head);
        if (i < a.length) return list.removeAt(i);
        const target = a[0].cyl;
        if (sim.cfg.countReturn) sim.travel(target); else sim.teleport(target);
        sim.admit();
        return list.removeAt(list.lowerBound(sim.head));
      }
      let i = list.upperBound(sim.head) - 1;
      if (i >= 0) return list.removeAt(list.lowerBound(a[i].cyl));
      const target = a[a.length - 1].cyl;
      if (sim.cfg.countReturn) sim.travel(target); else sim.teleport(target);
      sim.admit();
      return list.removeAt(list.upperBound(sim.head) - 1);
    }
  }

  /** FSCAN: two frozen queues; each active batch sweeps to a physical disk edge. */
  class FSCAN {
    constructor(cfg) {
      this.active = new SortedList(); this.incoming = new SortedList();
      this.st = { dir: cfg.initialDir };
    }
    add(r) { this.incoming.insert(r); }
    get size() { return this.active.size + this.incoming.size; }
    next(sim) {
      if (this.active.size === 0) { const t = this.active; this.active = this.incoming; this.incoming = t; }
      return pickScan(this.active, sim, this.st);
    }
  }

  /** FLOOK: two queues like FSCAN, but reverses at the last request (LOOK-style). */
  class FLOOK {
    constructor(cfg) {
      this.active = new SortedList(); this.incoming = new SortedList();
      this.st = { dir: cfg.initialDir };
    }
    add(r) { this.incoming.insert(r); }
    get size() { return this.active.size + this.incoming.size; }
    next(sim) {
      if (this.active.size === 0) { const t = this.active; this.active = this.incoming; this.incoming = t; }
      return pickLook(this.active, sim.head, this.st);
    }
  }

  /** LIFIS: Last-In-First-In-Service; serve the most recently queued request first. */
  class LIFIS extends LIFO {}

  /** FILIS: First-In-Last-In-Service policy; oldest request is deferred behind newer requests.
   * The operational rule is a stack discipline with the oldest pending request protected
   * until it is the only request left, making the policy explicit and reproducible.
   */
  class FILIS {
    constructor() { this.q = []; this.h = 0; }
    add(r) { this.q.push(r); }
    get size() { return this.q.length - this.h; }
    next() {
      if (this.size === 1) return this.q[this.h++];
      const r = this.q.pop();
      return r;
    }
  }

  /** N-step-SCAN: requests are cut into FIFO batches of N, each swept like LOOK. */
  class NStepScan {
    constructor(cfg) {
      this.waiting = []; this.wh = 0; this.batch = new SortedList();
      this.n = Math.max(1, cfg.nStep | 0); this.st = { dir: cfg.initialDir };
    }
    add(r) { this.waiting.push(r); }
    get size() { return this.batch.size + this.waiting.length - this.wh; }
    next(sim) {
      if (this.batch.size === 0) {
        const end = Math.min(this.waiting.length, this.wh + this.n);
        for (let i = this.wh; i < end; i++) { this.batch.insert(this.waiting[i]); this.waiting[i] = undefined; }
        this.wh = end;
        if (this.wh > 4096 && this.wh * 2 > this.waiting.length) { this.waiting = this.waiting.slice(this.wh); this.wh = 0; }
      }
      return pickLook(this.batch, sim.head, this.st);
    }
  }

  /** HDSA – Hybrid Disk Scheduling Algorithm (SSTF + LOOK blend, see README). */
  class HDSA extends ListSched {
    constructor(cfg) { super(); this.cfg = cfg; this.st = { dir: cfg.initialDir }; }
    next(sim) { return pickHybrid(this.list, sim.head, this.st, this.cfg.hybrid); }
  }

  /** OTHDSA – Optimised Threshold HDSA: HDSA + anti-starvation aging threshold. */
  class OTHDSA extends ListSched {
    constructor(cfg) { super(); this.cfg = cfg; this.st = { dir: cfg.initialDir }; this.fifo = []; this.fp = 0; }
    add(r) { this.list.insert(r); this.fifo.push(r); }
    next(sim) {
      const f = this.fifo;
      while (this.fp < f.length && f[this.fp].done) this.fp++;
      const oldest = f[this.fp];
      let r;
      if (oldest && sim.time - oldest.t > this.cfg.agingMs) {
        r = this.list.removeAt(this.list.indexOf(oldest));
        this.st.dir = r.cyl >= sim.head ? 1 : -1;
      } else {
        r = pickHybrid(this.list, sim.head, this.st, this.cfg.hybrid);
      }
      r.done = true;
      if (this.fp > 4096 && this.fp * 2 > f.length) { this.fifo = f.slice(this.fp); this.fp = 0; }
      return r;
    }
  }

  /** BAD – sector-aware: shortest (seek + rotational latency) among the nearest cylinders. */
  class BAD extends ListSched {
    constructor(cfg) { super(); this.cfg = cfg; }
    next(sim) {
      const a = this.list.a;
      const [s, e] = nearestRange(this.list, sim.head, this.cfg.window);
      let best = s, bc = Infinity;
      for (let i = s; i < e; i++) {
        const c = sim.cost(a[i], sim.head, sim.time);
        if (c < bc) { bc = c; best = i; }
      }
      return this.list.removeAt(best);
    }
  }

  /** Proposed: C-LOOK sweep that picks the cheapest (seek + rotation) of the next K requests. */
  class CLookSector extends ListSched {
    constructor(cfg) { super(); this.cfg = cfg; }
    next(sim) {
      const list = this.list, a = list.a;
      let i = list.lowerBound(sim.head);
      if (i >= a.length) {
        const target = a[0].cyl;
        if (sim.cfg.countReturn) sim.travel(target); else sim.teleport(target);
        sim.admit();
        i = list.lowerBound(sim.head);
      }
      const e = Math.min(a.length, i + Math.max(1, this.cfg.cLookK | 0));
      let best = i, bc = Infinity;
      for (let k = i; k < e; k++) {
        const c = sim.cost(a[k], sim.head, sim.time);
        if (c < bc) { bc = c; best = k; }
      }
      return list.removeAt(best);
    }
  }

  /** Ant Colony Optimisation over a receding window of the nearest requests. */
  class ACO extends ListSched {
    constructor(cfg) { super(); this.cfg = cfg; this.rng = mulberry32(cfg.seed); }
    next(sim) {
      const list = this.list, a = list.a, cfg = this.cfg;
      const [s, e] = nearestRange(list, sim.head, cfg.acoWindow);
      const m = e - s;
      if (m === 1) return list.removeAt(s);
      const cands = a.slice(s, e);
      const tau = new Float64Array((m + 1) * m).fill(1);
      const visited = new Uint8Array(m), costs = new Float64Array(m), wts = new Float64Array(m);
      let bestFirst = 0, bestTotal = Infinity;
      for (let it = 0; it < cfg.acoIters; it++) {
        const antPaths = [], antTotals = [];
        let iterBest = Infinity;
        for (let ant = 0; ant < cfg.acoAnts; ant++) {
          visited.fill(0);
          let h = sim.head, t = sim.time, total = 0, prev = 0;
          const path = new Int16Array(m);
          for (let step = 0; step < m; step++) {
            let sum = 0;
            for (let j = 0; j < m; j++) {
              if (visited[j]) { wts[j] = 0; continue; }
              const c = sim.cost(cands[j], h, t);
              costs[j] = c;
              const eta = 1 / (c + 1e-6);
              wts[j] = tau[prev * m + j] * eta * eta;
              sum += wts[j];
            }
            let pick = -1, r = this.rng() * sum, acc = 0;
            for (let j = 0; j < m; j++) {
              if (visited[j]) continue;
              pick = j; acc += wts[j];
              if (r <= acc) break;
            }
            visited[pick] = 1; path[step] = pick;
            total += costs[pick]; t += costs[pick]; h = cands[pick].cyl; prev = pick + 1;
          }
          antPaths.push(path); antTotals.push(total);
          if (total < iterBest) iterBest = total;
          if (total < bestTotal) { bestTotal = total; bestFirst = path[0]; }
        }
        for (let k = 0; k < tau.length; k++) tau[k] = Math.max(0.01, tau[k] * 0.5);     // evaporation
        for (let ant = 0; ant < antPaths.length; ant++) {                                  // deposit
          const dep = iterBest / (antTotals[ant] + 1e-9);
          const p = antPaths[ant]; let prev = 0;
          for (let step = 0; step < m; step++) { tau[prev * m + p[step]] += dep; prev = p[step] + 1; }
        }
      }
      return list.removeAt(s + bestFirst);
    }
  }

  /* -------------------------------------------------------------- registry */
  const ALGORITHMS = {
    'FCFS':      { name: 'FCFS', group: 'Classic', create: () => new FCFS(), desc: 'First-Come First-Served: serve requests in queue order.' },
    'SSTF':      { name: 'SSTF', group: 'Classic', create: () => new SSTF(), desc: 'Shortest Seek Time First: choose the closest pending cylinder.' },
    'SCAN':      { name: 'SCAN', group: 'Classic', create: c => new SCAN(c), desc: 'Elevator sweep to the physical disk edge, then reverse.' },
    'C-SCAN':    { name: 'C-SCAN', group: 'Classic', create: c => new CSCAN(c), desc: 'Circular SCAN: sweep in one direction and wrap to the opposite edge.' },
    'LOOK':      { name: 'LOOK', group: 'Classic', create: c => new LOOK(c), desc: 'Sweep in one direction, reversing at the last pending request.' },
    'C-LOOK':    { name: 'C-LOOK', group: 'Classic', create: c => new CLOOK(c), desc: 'Circular LOOK: wrap from the last request to the farthest pending request.' },
    'FLOOK':     { name: 'FLOOK', group: 'Queue-based', create: c => new FLOOK(c), desc: 'Two queues; process a frozen batch using LOOK, while new arrivals wait in the other queue.' },
    'FSCAN':     { name: 'FSCAN', group: 'Queue-based', create: c => new FSCAN(c), desc: 'Two queues; process a frozen batch using SCAN to the disk edge.' },
    'N-Step-SCAN': { name: 'N-Step-SCAN', group: 'Queue-based', create: c => new NStepScan(c), desc: 'Divide arrivals into FIFO batches of N and scan each batch.' },
    'HDSA':      { name: 'HD-SCAN / HDSA*', group: 'Adaptive', create: c => new HDSA(c), desc: 'Hybrid directional/nearest-request policy; factor 0 behaves like LOOK, factor 1 like SSTF.' },
    'OTHDSA':    { name: 'OTHDSA*', group: 'Adaptive', create: c => new OTHDSA(c), desc: 'HDSA with an aging threshold to force service of old requests.' },
    'BAD':       { name: 'BAD — Sector-Management-Based', group: 'Sector-aware', create: c => new BAD(c), desc: 'Choose the least seek-plus-rotation cost among nearby requests.' },
    'ACO':       { name: 'ACO-based scheduling', group: 'Metaheuristic', create: c => new ACO(c), desc: 'Ant Colony Optimization selects a promising next request from a nearby window.' },
    'LIFIS':     { name: 'LIFIS', group: 'Queue policy', create: () => new LIFIS(), desc: 'Last-In-First-In-Service: serve the newest pending request first (stack policy).' },
    'FILIS':     { name: 'FILIS', group: 'Queue policy', create: () => new FILIS(), desc: 'First-In-Last-In-Service: defer the oldest pending request until newer requests are served.' }
  };
  const ORDER = Object.keys(ALGORITHMS);

  const DEFAULTS = {
    cylinders: 5000, initialHead: 2500, initialDir: 1,
    seekMs: 0.01, rotation: true, rpm: 7200, sectors: 64, fixedMs: 0,
    arrivalMode: 'timed', arrivalScale: 10, countReturn: true,
    nStep: 64, hybrid: 0.5, agingMs: 1000, window: 32, cLookK: 8,
    acoWindow: 8, acoAnts: 6, acoIters: 3, seed: 12345, trace: false
  };

  /* --------------------------------------------------------------- engine */
  function prepare(requests, cfg) {
    const scale = cfg.arrivalMode === 'batch' ? 0 : (cfg.arrivalScale > 0 ? cfg.arrivalScale : 1);
    const max = cfg.cylinders - 1;
    return requests.map((r, i) => ({
      id: i, rid: r.id, t: r.t * scale,
      cyl: Math.min(max, Math.max(0, r.cyl | 0)), sec: (r.sec || 0) | 0, done: false
    }));
  }

  function runSimulation(requests, cfgIn, key) {
    const algo = ALGORITHMS[key];
    if (!algo) throw new Error('Unknown algorithm: ' + key);
    const cfg = Object.assign({}, DEFAULTS, cfgIn);
    cfg.maxCyl = cfg.cylinders - 1;
    const P = 60000 / cfg.rpm, S = Math.max(1, cfg.sectors | 0);
    const reqs = prepare(requests, cfg), n = reqs.length;
    if (n === 0) throw new Error('The request queue is empty');
    const sched = algo.create(cfg);
    const trace = cfg.trace ? [{ cyl: cfg.initialHead, kind: 'start' }] : null;
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();

    const sim = {
      cfg, head: cfg.initialHead, time: 0, moved: 0, nextArr: 0,
      admit() {
        while (this.nextArr < n && reqs[this.nextArr].t <= this.time) sched.add(reqs[this.nextArr++]);
      },
      travel(c) {
        const d = Math.abs(c - this.head);
        if (d === 0) return;
        this.moved += d; this.time += d * cfg.seekMs; this.head = c;
        if (trace) trace.push({ cyl: c, kind: 'travel' });
      },
      teleport(c) { this.head = c; if (trace) trace.push({ cyl: c, kind: 'jump' }); },
      /** Total service time of r if the head leaves `fromHead` at time `at`. */
      cost(r, fromHead, at) {
        const seek = Math.abs(r.cyl - fromHead) * cfg.seekMs;
        if (!cfg.rotation) return seek + cfg.fixedMs;
        const ang = ((at + seek) / P * S) % S;
        let w = r.sec - ang; w -= Math.floor(w / S) * S;
        return seek + (w / S) * P + P / S;
      }
    };

    const cum = new Float64Array(n), waits = new Float64Array(n), resp = new Float64Array(n);
    let served = 0;
    while (served < n) {
      sim.admit();
      if (sched.size === 0) { sim.time = reqs[sim.nextArr].t; continue; }   // disk idle until next arrival
      const r = sched.next(sim);
      if (!r) throw new Error(algo.name + ': scheduler returned no request');
      const dispatch = sim.time;
      const svc = sim.cost(r, sim.head, sim.time);
      sim.moved += Math.abs(r.cyl - sim.head);
      sim.head = r.cyl; sim.time += svc;
      if (trace) trace.push({ cyl: r.cyl, kind: 'serve', id: r.rid });
      waits[served] = dispatch - r.t; resp[served] = sim.time - r.t; cum[served] = sim.moved;
      served++;
    }

    let sw = 0, sr = 0, mx = 0;
    for (let i = 0; i < n; i++) { sw += waits[i]; sr += resp[i]; if (waits[i] > mx) mx = waits[i]; }
    const avgWait = sw / n;
    let v = 0; for (let i = 0; i < n; i++) v += (waits[i] - avgWait) * (waits[i] - avgWait);
    const sorted = Float64Array.from(waits).sort();
    return {
      key, name: algo.name, n,
      totalMove: sim.moved, avgMove: sim.moved / n,
      avgWait, maxWait: mx, stdWait: Math.sqrt(v / n), p95Wait: sorted[Math.min(n - 1, Math.floor(n * 0.95))],
      avgResp: sr / n, makespan: sim.time, throughput: n / (sim.time / 1000),
      cum, waits, trace,
      computeMs: (typeof performance !== 'undefined' ? performance : Date).now() - t0
    };
  }

  const api = { ALGORITHMS, ORDER, DEFAULTS, runSimulation, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiskAlgo = api;
})(typeof window !== 'undefined' ? window : globalThis);
