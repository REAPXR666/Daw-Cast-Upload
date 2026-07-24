import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { prisma } from "@daw-cast/db";
import { env } from "./env.js";
import { initWorkerPool, closeAllWorkers } from "./mediasoup/worker-pool.js";
import { attachWebSocketServer } from "./ws/server.js";
import { redis } from "./redis.js";

async function main() {
  await initWorkerPool();

  const app = Fastify({ logger: true });
  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN });
  app.get("/health", async () => ({ status: "ok" }));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  attachWebSocketServer(app.server);
  app.log.info(`signaling-server listening on :${env.PORT} (ws path: /ws)`);

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, shutting down gracefully`);
    try {
      closeAllWorkers();
      await app.close();
      await prisma.$disconnect();
      redis.disconnect();
      app.log.info("shutdown complete");
      process.exit(0);
    } catch (err) {
      app.log.error(err, "error during shutdown");
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
