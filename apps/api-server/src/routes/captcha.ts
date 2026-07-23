import type { FastifyInstance } from "fastify";
import { createCaptchaChallenge } from "../lib/captcha.js";

export async function captchaRoutes(app: FastifyInstance) {
  app.get("/captcha/challenge", async () => {
    return createCaptchaChallenge();
  });
}
