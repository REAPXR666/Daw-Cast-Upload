import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { initWorkerPool } from "./mediasoup/worker-pool.js";
import { attachWebSocketServer } from "./ws/server.js";

async function main() {
  await initWorkerPool();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: env.CORS_ORIGIN });
  app.get("/health", async () => ({ status: "ok" }));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  attachWebSocketServer(app.server);
  app.log.info(`signaling-server listening on :${env.PORT} (ws path: /ws)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
