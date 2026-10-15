// Run with:  node tests/run_tests.js
const Algo = require('../js/algorithms.js');
const Data = require('../js/dataset.js');
const Tests = require('../js/tests.js');
const fs = require('fs');
const path = require('path');

let fail = 0;
for (const r of Tests.runAll(Algo, Data)) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name.padEnd(42) + ' expected=' + r.expected + '  actual=' + r.actual);
  if (!r.pass) fail++;
}

// Full-size run on the bundled 20,000 request CSV (all 15 algorithms)
const csv = path.join(__dirname, '..', 'data', 'disk_requests.csv');
if (fs.existsSync(csv)) {
  const ds = Data.parseCSV(fs.readFileSync(csv, 'utf8'), 'disk_requests.csv');
  console.log('\n20k dataset:', ds.requests.length, 'requests, meta', JSON.stringify(ds.meta));
  const cfg = { cylinders: ds.meta.cylinders, initialHead: ds.meta.initialHead, sectors: ds.meta.sectors };
  for (const key of Algo.ORDER) {
    const r = Algo.runSimulation(ds.requests, cfg, key);
    console.log(key.padEnd(12), 'move=' + String(Math.round(r.totalMove)).padStart(10),
      ' avgWait=' + r.avgWait.toFixed(1).padStart(10) + ' ms', ' maxWait=' + r.maxWait.toFixed(0).padStart(9),
      ' ' + r.computeMs.toFixed(0) + ' ms');
  }
}
console.log(fail ? '\n' + fail + ' test(s) FAILED' : '\nAll tests passed');
process.exit(fail ? 1 : 0);
