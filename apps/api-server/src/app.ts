import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { captchaRoutes } from "./routes/captcha.js";
import { reportRoutes } from "./routes/reports.js";
import { adminRoutes } from "./routes/admin.js";
import { MAX_REPORT_EVIDENCE_FILE_BYTES, MAX_REPORT_EVIDENCE_FILES } from "@daw-cast/shared-types";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: env.CORS_ORIGIN });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(multipart, {
    limits: { fileSize: MAX_REPORT_EVIDENCE_FILE_BYTES, files: MAX_REPORT_EVIDENCE_FILES },
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(captchaRoutes);
  await app.register(authRoutes);
  await app.register(reportRoutes);
  await app.register(adminRoutes);

  return app;
}
