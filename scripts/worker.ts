// Local background worker: runs a tick every WORKER_INTERVAL_SECONDS (default 60).
// In production, call POST /api/jobs/run from a scheduler instead.
import { runWorkerTick } from "../src/lib/jobs/runner";

const interval = Number(process.env.WORKER_INTERVAL_SECONDS ?? 60) * 1000;
const once = process.argv.includes("--once");

async function tick() {
  try {
    const result = await runWorkerTick();
    console.log(new Date().toISOString(), JSON.stringify(result));
  } catch (error) {
    console.error(new Date().toISOString(), "worker tick failed:", (error as Error).message);
  }
}

void tick().then(() => {
  if (!once) setInterval(tick, interval);
  else process.exit(0);
});
