import * as mediasoup from "mediasoup";
import type { types as MediasoupTypes } from "mediasoup";
import { workerSettings, mediaCodecs } from "./config.js";

const workers: MediasoupTypes.Worker[] = [];
let nextWorkerIndex = 0;

// Phase 1 runs a small fixed pool (one worker per CPU core is mediasoup's
// usual guidance); each session gets a Router from whichever worker is next
// in rotation, spreading sessions across cores.
export async function initWorkerPool(count = 2): Promise<void> {
  for (let i = 0; i < count; i++) {
    const worker = await mediasoup.createWorker(workerSettings);
    worker.on("died", () => {
      console.error(`mediasoup worker ${worker.pid} died — exiting process`);
      process.exit(1);
    });
    workers.push(worker);
  }
}

export function getNextWorker(): MediasoupTypes.Worker {
  const worker = workers[nextWorkerIndex];
  if (!worker) throw new Error("mediasoup worker pool not initialized");
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}

export async function createRouter(): Promise<MediasoupTypes.Router> {
  const worker = getNextWorker();
  return worker.createRouter({ mediaCodecs });
}
