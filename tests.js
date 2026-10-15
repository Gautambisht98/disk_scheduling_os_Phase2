/*
 * tests.js – standard test cases + invariants (used by the "Tests" tab and by
 * tests/run_tests.js in Node).
 *
 * Expected values for the textbook queue 98,183,37,122,14,124,65,67 with the head
 * at cylinder 53 (disk 0-199) follow Silberschatz, Galvin & Gagne.
 */
(function (root) {
  'use strict';

  function standardTests(Algo, Data) {
    const ds = Data.textbookCase();
    const base = { cylinders: 200, initialHead: 53, seekMs: 1, rotation: false, fixedMs: 0, arrivalMode: 'batch', countReturn: true, initialDir: 1 };
    const cases = [
      ['FCFS',        {},                              640, 'Textbook: 53→98→183→37→122→14→124→65→67'],
      ['SSTF',        {},                              236, 'Textbook: 53→65→67→37→14→98→122→124→183'],
      ['SCAN',        { initialDir: -1 },              236, 'Textbook: toward 0 first, reaches cylinder 0'],
      ['SCAN',        { initialDir: 1 },               331, 'Toward 199 first: 146 + 185'],
      ['C-SCAN',      {},                              382, 'Up to 199, jump to 0 (counted), up to 37'],
      ['C-SCAN',      { countReturn: false },          183, 'Same, jump not counted: 146 + 37'],
      ['LOOK',        { initialDir: -1 },              208, 'Textbook: 53→37→14→65→…→183'],
      ['LOOK',        { initialDir: 1 },               299, '53→183 then back to 14'],
      ['C-LOOK',      {},                              322, 'Textbook: 130 + 169 + 23'],
      ['FSCAN',       { initialDir: 1 },               331, 'All requests present at t=0 ⇒ SCAN-style frozen batch'],
      ['FLOOK',       { initialDir: 1 },               299, 'All requests present at t=0 ⇒ LOOK-style frozen batch'],
      ['N-Step-SCAN', { nStep: 4, initialDir: 1 },     409, 'Batch 1 = 98,183,37,122 (276); batch 2 = 14,124,65,67 (133)'],
      ['N-Step-SCAN', { nStep: 8, initialDir: 1 },     299, 'N ≥ queue length ⇒ one batch ⇒ LOOK'],
      ['LIFIS',       {},                              609, 'Newest pending request first (stack order)'],
      ['FILIS',       {},                              609, 'Oldest request deferred until newer requests are served'],
      ['HDSA',        { hybrid: 1 },                   236, 'Hybrid factor 1 ⇒ SSTF'],
      ['HDSA',        { hybrid: 0, initialDir: 1 },    299, 'Hybrid factor 0 ⇒ LOOK'],
      ['OTHDSA',      { hybrid: 1, agingMs: 1e9 },     236, 'Huge aging threshold ⇒ plain HDSA (= SSTF)'],
      ['BAD',         { window: 50 },                  236, 'Rotation off ⇒ min access time = SSTF'],
    ];
    const rows = cases.map(([key, over, expected, note]) => {
      const res = Algo.runSimulation(ds.requests, Object.assign({}, base, over), key);
      const opts = Object.keys(over).length ? ' (' + Object.entries(over).map(([k, v]) => k + '=' + v).join(', ') + ')' : '';
      return { name: Algo.ALGORITHMS[key].name + opts, expected, actual: res.totalMove, pass: res.totalMove === expected, note };
    });

    // ACO: stochastic, so check validity + sane bounds instead of an exact number.
    const aco = Algo.runSimulation(ds.requests, Object.assign({}, base, { trace: true }), 'ACO');
    const ids = new Set(aco.trace.filter(p => p.kind === 'serve').map(p => p.id));
    rows.push({ name: 'ACO (valid schedule)', expected: '8 served, 236 ≤ move ≤ 640', actual: ids.size + ' served, move ' + aco.totalMove,
      pass: ids.size === 8 && aco.totalMove >= 236 && aco.totalMove <= 640, note: 'Every request served exactly once' });
    return rows;
  }

  /** Invariants on a random timed workload: every algorithm must obey them. */
  function invariantTests(Algo, Data) {
    const ds = Data.generateDataset({ count: 1500, cylinders: 1000, sectors: 32, initialHead: 500, meanInterarrival: 2, seed: 7 });
    const cfg = { cylinders: 1000, initialHead: 500, sectors: 32, seekMs: 0.02, rotation: true, arrivalMode: 'timed', trace: true, nStep: 20 };
    const rows = [];
    for (const key of Algo.ORDER) {
      const r = Algo.runSimulation(ds.requests, cfg, key);
      const served = new Set(r.trace.filter(p => p.kind === 'serve').map(p => p.id));
      let mono = true; for (let i = 1; i < r.n; i++) if (r.cum[i] < r.cum[i - 1]) { mono = false; break; }
      let minWait = Infinity; for (let i = 0; i < r.n; i++) if (r.waits[i] < minWait) minWait = r.waits[i];
      const ok = served.size === r.n && mono && minWait >= 0 && Math.abs(r.cum[r.n - 1] - r.totalMove) < 1e-9 && isFinite(r.avgWait);
      rows.push({ name: r.name + ' – invariants', expected: '1500 served once, wait ≥ 0, cum. movement non-decreasing',
        actual: served.size + ' served, min wait ' + minWait.toFixed(3) + ' ms', pass: ok, note: 'Random timed workload (1500 requests)' });
    }
    return rows;
  }

  function runAll(Algo, Data) { return standardTests(Algo, Data).concat(invariantTests(Algo, Data)); }

  const api = { standardTests, invariantTests, runAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiskTests = api;
})(typeof window !== 'undefined' ? window : globalThis);
