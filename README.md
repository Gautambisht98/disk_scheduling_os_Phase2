# Disk Scheduling Lab

A browser-based Operating Systems project that accepts a request queue and current disk-head position, then calculates **total head movement** and **average access time** for 15 disk-scheduling policies. It supports individual runs and side-by-side comparisons on the exact same queue.

## Run it

1. Extract the project folder.
2. Open `index.html` in a modern browser (Chrome or Edge).
3. Choose 1–20,000 requests, the cylinder count, initial head, direction and workload pattern.
4. Click **Create request queue**.
5. Use **Run one algorithm** or select any two or more algorithms under **Compare algorithms**.

No server, package install or internet connection is required.

## Workload patterns

- **Random**: seeded random cylinder positions. The same seed reproduces the same queue.
- **Sequential**: increasing cylinder positions, wrapping at the last cylinder.
- **Custom**: enter your own cylinder numbers separated by commas or spaces (maximum 20,000 requests).

The request-count control accepts any value from **1 to 20,000**. The same limit is validated in JavaScript, including custom queues.

## Implemented algorithms (15)

1. FCFS
2. SSTF
3. SCAN
4. C-SCAN
5. LOOK
6. C-LOOK
7. FLOOK
8. FSCAN
9. N-Step-SCAN
10. HD-SCAN / HDSA*
11. OTHDSA*
12. BAD — Sector-Management-Based Optimized Disk Scheduling
13. ACO-based scheduling
14. LIFIS
15. FILIS

Some advanced names (especially HDSA, OTHDSA, BAD, LIFIS and FILIS) do not have one universally standard definition. This project documents its operational rules in `js/algorithms.js` and exposes those rules consistently for reproducible comparison. LIFIS serves the newest pending request first. FILIS defers the oldest pending request until newer pending requests have been served. FLOOK uses a frozen active queue with LOOK-style reversal; FSCAN uses a frozen active queue with SCAN-style edge travel.

## Metrics and model

- **Total head movement**: sum of cylinder distances travelled, including SCAN edge travel and counted circular return travel.
- **Average access time**: mean time from request arrival until service completion (reported in milliseconds).
- **Average wait time**: mean time from arrival until the scheduler dispatches the request.
- The default model uses a seek cost of 1 ms per cylinder and disables rotational latency to keep the model easy to understand. All algorithms in one run use the same settings and queue.
- The cumulative head-movement chart plots movement after each completed request.

## Tests

From this folder run:

```bash
node tests/simple-tests.js
node tests/run_tests.js
```

`tests/simple-tests.js` checks all 15 algorithms against sequential, random and custom workloads, including that every request is served exactly once, metrics are finite, and cumulative movement ends at the reported total.
