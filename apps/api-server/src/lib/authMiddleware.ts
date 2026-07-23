import type { FastifyReply, FastifyRequest } from "fastify";
import type { AccessTokenClaims } from "@daw-cast/shared-types";
import { verifyAccessToken } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AccessTokenClaims;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  try {
    request.authUser = verifyAccessToken(token);
  } catch {
    return reply.status(401).send({ error: "unauthorized" });
  }
}

export function requireRole(...roles: Array<"admin" | "master_admin">) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (!request.authUser || !roles.includes(request.authUser.role as "admin" | "master_admin")) {
      return reply.status(403).send({ error: "forbidden" });
    }
  };
}
