import type { FastifyInstance } from "fastify";
import { prisma } from "@daw-cast/db";
import {
  SignupRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  type AuthResponse,
} from "@daw-cast/shared-types";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { signAccessToken } from "../lib/jwt.js";
import { generateRefreshToken, hashRefreshToken } from "../lib/refreshToken.js";
import { verifyCaptchaChallenge } from "../lib/captcha.js";
import { env } from "../env.js";

async function issueTokens(
  user: { id: string; username: string; role: string },
  rotatedFrom?: string,
) {
  const accessToken = signAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role as "user" | "admin" | "master_admin",
  });

  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000),
      rotatedFrom,
    },
  });

  return {
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + env.ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refreshToken,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/signup",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const parsed = SignupRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const { email, username, password, captcha } = parsed.data;

      const captchaOk = await verifyCaptchaChallenge(captcha.challengeId, captcha.answer);
      if (!captchaOk) {
        return reply.status(400).send({ error: "invalid_captcha" });
      }

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });
      if (existing) {
        return reply.status(409).send({ error: "email_or_username_taken" });
      }

      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: {
          email,
          username,
          passwordHash,
          tosAcceptedAt: new Date(),
        },
      });

      const tokens = await issueTokens(user);
      const response: AuthResponse = {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
        },
        tokens,
      };
      return reply.status(201).send(response);
    },
  );

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const parsed = LoginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const { usernameOrEmail, password } = parsed.data;

      const user = await prisma.user.findFirst({
        where: { OR: [{ email: usernameOrEmail }, { username: usernameOrEmail }] },
      });
      if (!user) {
        return reply.status(401).send({ error: "invalid_credentials" });
      }

      const passwordOk = await verifyPassword(user.passwordHash, password);
      if (!passwordOk) {
        return reply.status(401).send({ error: "invalid_credentials" });
      }

      const accountBan = await prisma.accountBan.findUnique({ where: { targetUserId: user.id } });
      if (accountBan) {
        return reply.status(403).send({ error: "account_banned" });
      }

      const tokens = await issueTokens(user);
      const response: AuthResponse = {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
        },
        tokens,
      };
      return reply.send(response);
    },
  );

  app.post("/auth/refresh", async (request, reply) => {
    const parsed = RefreshRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request" });
    }

    const tokenHash = hashRefreshToken(parsed.data.refreshToken);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      // Reuse of an already-rotated/revoked token is a signal of theft —
      // proactively revoke the whole chain rooted at this token.
      if (stored?.revokedAt) {
        await prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return reply.status(401).send({ error: "invalid_refresh_token" });
    }

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await issueTokens(stored.user, stored.id);

    const response: AuthResponse = {
      user: {
        id: stored.user.id,
        email: stored.user.email,
        username: stored.user.username,
        role: stored.user.role,
        createdAt: stored.user.createdAt.toISOString(),
      },
      tokens,
    };
    return reply.send(response);
  });

  app.post("/auth/logout", async (request, reply) => {
    const parsed = RefreshRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(204).send();
    }
    const tokenHash = hashRefreshToken(parsed.data.refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return reply.status(204).send();
  });
}
