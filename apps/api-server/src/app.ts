import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { captchaRoutes } from "./routes/captcha.js";
import { reportRoutes } from "./routes/reports.js";
import { adminRoutes } from "./routes/admin.js";
import { billingRoutes } from "./routes/billing.js";
import { MAX_REPORT_EVIDENCE_FILE_BYTES, MAX_REPORT_EVIDENCE_FILES } from "@daw-cast/shared-types";

export async function buildApp() {
  // Both unset -> plain HTTP (local dev). Both set -> Fastify terminates TLS
  // itself directly from the cert/key files, no reverse proxy needed.
  // Cast to plain FastifyInstance: the two branches resolve to different
  // Fastify overloads (https.Server vs http.Server), and a union of those
  // breaks method call resolution (.register/.get/etc) below.
  const app = (
    env.TLS_CERT_PATH && env.TLS_KEY_PATH
      ? Fastify({
          logger: true,
          https: { cert: readFileSync(env.TLS_CERT_PATH), key: readFileSync(env.TLS_KEY_PATH) },
        })
      : Fastify({ logger: true })
  ) as FastifyInstance;

  // No client here is a browser page loading remote scripts/styles, so CSP
  // is left at helmet's safe default rather than hand-tuned — this app has
  // no HTML responses to protect, just JSON/WS APIs.
  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  // Stripe's webhook signature is verified against the exact raw request
  // bytes, which Fastify's default JSON parser doesn't preserve — this
  // override captures them onto request.rawBody while still parsing
  // request.body normally, so every other JSON route is unaffected.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const buf = body as Buffer;
    request.rawBody = buf;
    if (buf.length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(buf.toString("utf8")));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  await app.register(multipart, {
    limits: { fileSize: MAX_REPORT_EVIDENCE_FILE_BYTES, files: MAX_REPORT_EVIDENCE_FILES },
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(captchaRoutes);
  await app.register(authRoutes);
  await app.register(reportRoutes);
  await app.register(adminRoutes);
  await app.register(billingRoutes);

  return app;
}
