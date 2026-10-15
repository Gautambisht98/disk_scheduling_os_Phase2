const assert = require('assert');
const Algo = require('../js/algorithms.js');
const Data = require('../js/dataset.js');
assert.strictEqual(Algo.ORDER.length, 15, 'all 15 required algorithms are registered');
const cylinders = 200, head = 53;
const workloads = {
  sequential: Array.from({length:80}, (_,i)=>({id:i+1,t:0,cyl:i % cylinders,sec:0})),
  random: Data.generateDataset({count:80,cylinders,initialHead:head,sectors:1,hotspotShare:0,seed:2026}).requests.map((r,i)=>({id:i+1,t:0,cyl:r.cyl,sec:0})),
  custom: [98,183,37,122,14,124,65,67].map((cyl,i)=>({id:i+1,t:0,cyl,sec:0}))
};
for (const [shape, requests] of Object.entries(workloads)) {
  for (const key of Algo.ORDER) {
    const result = Algo.runSimulation(requests.map(r=>({...r})), {
      cylinders, initialHead:head, initialDir:1, seekMs:1, rotation:false,
      arrivalMode:'batch', countReturn:true, trace:true, nStep:10, acoWindow:6,
      acoAnts:3, acoIters:2, window:12, cLookK:5
    }, key);
    const served = result.trace.filter(p=>p.kind==='serve');
    assert.strictEqual(served.length, requests.length, `${shape}/${key}: all requests served`);
    assert.strictEqual(new Set(served.map(p=>p.id)).size, requests.length, `${shape}/${key}: each request served once`);
    assert(Number.isFinite(result.totalMove) && result.totalMove >= 0, `${shape}/${key}: valid movement`);
    assert(Number.isFinite(result.avgResp) && result.avgResp >= 0, `${shape}/${key}: valid access time`);
    assert.strictEqual(result.cum.length, requests.length, `${shape}/${key}: cumulative movement points`);
    for (let i=1;i<result.cum.length;i++) assert(result.cum[i]>=result.cum[i-1], `${shape}/${key}: cumulative movement is monotonic`);
    assert(Math.abs(result.cum[result.cum.length-1]-result.totalMove)<1e-9, `${shape}/${key}: final chart equals total movement`);
    console.log(`PASS ${shape.padEnd(10)} ${key.padEnd(12)} movement=${result.totalMove} avgAccess=${result.avgResp.toFixed(2)} ms`);
  }
}
console.log('All 45 workload/algorithm checks passed.');
