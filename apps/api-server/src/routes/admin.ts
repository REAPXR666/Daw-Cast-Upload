import type { FastifyInstance } from "fastify";
import { prisma } from "@daw-cast/db";
import {
  SetUserRoleRequestSchema,
  CreateAccountBanRequestSchema,
  type AdminUserSummary,
  type AccountBanSummary,
} from "@daw-cast/shared-types";
import { requireRole } from "../lib/authMiddleware.js";

export async function adminRoutes(app: FastifyInstance) {
  app.get(
    "/admin/users",
    { preHandler: requireRole("admin", "master_admin") },
    async (_request, reply) => {
      const [users, bans] = await Promise.all([
        prisma.user.findMany({ orderBy: { createdAt: "desc" } }),
        prisma.accountBan.findMany({ select: { targetUserId: true } }),
      ]);
      const bannedIds = new Set(bans.map((b: { targetUserId: string }) => b.targetUserId));
      const summaries: AdminUserSummary[] = users.map((u: (typeof users)[number]) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
        isBanned: bannedIds.has(u.id),
      }));
      return reply.send({ users: summaries });
    },
  );

  // Only a master_admin may promote to/demote from admin — an admin cannot
  // create more admins, and nobody can touch a master_admin's role via this
  // route (master_admin is granted out-of-band, e.g. directly in the DB).
  app.patch(
    "/admin/users/:id/role",
    { preHandler: requireRole("master_admin") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = SetUserRoleRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_request" });
      }
      const target = await prisma.user.findUnique({ where: { id } });
      if (!target) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (target.role === "master_admin") {
        return reply.status(403).send({ error: "cannot_modify_master_admin" });
      }
      const updated = await prisma.user.update({ where: { id }, data: { role: parsed.data.role } });
      return reply.send({
        id: updated.id,
        email: updated.email,
        username: updated.username,
        role: updated.role,
        createdAt: updated.createdAt.toISOString(),
      });
    },
  );

  app.get(
    "/admin/bans",
    { preHandler: requireRole("admin", "master_admin") },
    async (_request, reply) => {
      const bans = await prisma.accountBan.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          target: { select: { id: true, username: true } },
          issuedBy: { select: { id: true, username: true } },
        },
      });
      const summaries: AccountBanSummary[] = bans.map((b: (typeof bans)[number]) => ({
        id: b.id,
        target: b.target,
        issuedBy: b.issuedBy,
        reason: b.reason,
        createdAt: b.createdAt.toISOString(),
      }));
      return reply.send({ bans: summaries });
    },
  );

  app.post(
    "/admin/bans",
    { preHandler: requireRole("admin", "master_admin") },
    async (request, reply) => {
      const parsed = CreateAccountBanRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_request" });
      }
      const target = await prisma.user.findUnique({ where: { id: parsed.data.targetUserId } });
      if (!target) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (target.role === "master_admin" || target.role === "admin") {
        return reply.status(403).send({ error: "cannot_ban_staff" });
      }
      const ban = await prisma.accountBan.upsert({
        where: { targetUserId: parsed.data.targetUserId },
        create: {
          targetUserId: parsed.data.targetUserId,
          issuedByUserId: request.authUser!.sub,
          reason: parsed.data.reason,
        },
        update: { reason: parsed.data.reason, issuedByUserId: request.authUser!.sub },
        include: {
          target: { select: { id: true, username: true } },
          issuedBy: { select: { id: true, username: true } },
        },
      });
      // A permanent ban revokes all active sessions immediately.
      await prisma.refreshToken.updateMany({
        where: { userId: parsed.data.targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const summary: AccountBanSummary = {
        id: ban.id,
        target: ban.target,
        issuedBy: ban.issuedBy,
        reason: ban.reason,
        createdAt: ban.createdAt.toISOString(),
      };
      return reply.status(201).send(summary);
    },
  );

  app.delete(
    "/admin/bans/:id",
    { preHandler: requireRole("master_admin") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.accountBan.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "not_found" });
      }
      await prisma.accountBan.delete({ where: { id } });
      return reply.status(204).send();
    },
  );
}
