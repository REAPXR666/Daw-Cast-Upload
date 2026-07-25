import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { prisma } from "@daw-cast/db";
import { env } from "./env.js";
import { initWorkerPool, closeAllWorkers } from "./mediasoup/worker-pool.js";
import { attachWebSocketServer } from "./ws/server.js";
import { redis } from "./redis.js";

async function main() {
  await initWorkerPool();

  // Both unset -> plain HTTP/WS (local dev). Both set -> Fastify terminates
  // TLS itself; the ws upgrade path works the same over the resulting
  // https.Server, so no change needed in attachWebSocketServer.
  // Cast to the plain FastifyInstance type: the two branches resolve to
  // different Fastify overloads (https.Server vs http.Server), and a union
  // of those breaks method call resolution (.register/.get/etc). None of
  // the methods used below actually depend on which raw server type it is.
  const app = (
    env.TLS_CERT_PATH && env.TLS_KEY_PATH
      ? Fastify({
          logger: true,
          https: { cert: readFileSync(env.TLS_CERT_PATH), key: readFileSync(env.TLS_KEY_PATH) },
        })
      : Fastify({ logger: true })
  ) as FastifyInstance;
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
