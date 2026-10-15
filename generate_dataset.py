"""
Disk scheduling dataset generator.
Produces disk_requests.csv with 20,000 requests:
  request_id, arrival_time, cylinder, sector
Header line (comment) stores disk parameters.
"""
import random
import csv

SEED = 42
NUM_REQUESTS = 20000
NUM_CYLINDERS = 5000        # cylinders 0..4999
SECTORS_PER_TRACK = 64      # sectors 0..63 (for sector-aware / BAD algorithms)
INITIAL_HEAD = 2500
MEAN_INTERARRIVAL = 0.5     # ms, Poisson arrivals (exponential gaps)

random.seed(SEED)

# Workload mix: 60% clustered around hotspots, 40% uniform random
HOTSPOTS = [(500, 120), (2000, 200), (3800, 150)]   # (center, std-dev)

def gen_cylinder():
    if random.random() < 0.6:
        c, s = random.choice(HOTSPOTS)
        return min(NUM_CYLINDERS - 1, max(0, int(random.gauss(c, s))))
    return random.randint(0, NUM_CYLINDERS - 1)

rows = []
t = 0.0
for i in range(1, NUM_REQUESTS + 1):
    t += random.expovariate(1.0 / MEAN_INTERARRIVAL)
    rows.append((i, round(t, 3), gen_cylinder(), random.randint(0, SECTORS_PER_TRACK - 1)))

with open("disk_requests.csv", "w", newline="") as f:
    f.write(f"# initial_head={INITIAL_HEAD},cylinders={NUM_CYLINDERS},sectors_per_track={SECTORS_PER_TRACK},seed={SEED}\n")
    w = csv.writer(f)
    w.writerow(["request_id", "arrival_time", "cylinder", "sector"])
    w.writerows(rows)

print(f"Generated {len(rows)} requests -> disk_requests.csv")
print("First 5:", rows[:5])
