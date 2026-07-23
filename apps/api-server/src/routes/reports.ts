import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EXT_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
import type { FastifyInstance } from "fastify";
import { prisma } from "@daw-cast/db";
import {
  ReportReasonSchema,
  UpdateReportStatusRequestSchema,
  MAX_REPORT_EVIDENCE_FILES,
  MAX_REPORT_EVIDENCE_FILE_BYTES,
  REPORT_EVIDENCE_ALLOWED_MIME_TYPES,
  type ReportSummary,
} from "@daw-cast/shared-types";
import { requireAuth, requireRole } from "../lib/authMiddleware.js";
import { env } from "../env.js";

function toSummary(report: {
  id: string;
  reporter: { id: string; username: string };
  target: { id: string; username: string };
  sessionId: string | null;
  reason: string;
  description: string;
  evidencePaths: string[];
  status: string;
  reviewedBy: { id: string; username: string } | null;
  reviewedAt: Date | null;
  createdAt: Date;
}): ReportSummary {
  return {
    id: report.id,
    reporter: report.reporter,
    target: report.target,
    sessionId: report.sessionId,
    reason: report.reason as ReportSummary["reason"],
    description: report.description,
    evidencePaths: report.evidencePaths,
    status: report.status as ReportSummary["status"],
    reviewedBy: report.reviewedBy,
    reviewedAt: report.reviewedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
  };
}

export async function reportRoutes(app: FastifyInstance) {
  app.post(
    "/reports",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const parts = request.parts();
      const fields: Record<string, string> = {};
      const savedPaths: string[] = [];
      const reportId = randomUUID();
      let fileCount = 0;

      for await (const part of parts) {
        if (part.type === "file") {
          fileCount++;
          if (fileCount > MAX_REPORT_EVIDENCE_FILES) {
            part.file.resume();
            continue;
          }
          if (!REPORT_EVIDENCE_ALLOWED_MIME_TYPES.includes(part.mimetype)) {
            part.file.resume();
            return reply.status(400).send({ error: "unsupported_evidence_type" });
          }
          const dir = path.join(env.REPORT_UPLOADS_DIR, reportId);
          await mkdir(dir, { recursive: true });
          const ext = path.extname(part.filename).slice(0, 10);
          const safeName = `${randomUUID()}${ext}`;
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          for await (const chunk of part.file) {
            totalBytes += chunk.length;
            if (totalBytes > MAX_REPORT_EVIDENCE_FILE_BYTES) {
              return reply.status(400).send({ error: "evidence_file_too_large" });
            }
            chunks.push(chunk);
          }
          await writeFile(path.join(dir, safeName), Buffer.concat(chunks));
          savedPaths.push(`${reportId}/${safeName}`);
        } else {
          fields[part.fieldname] = part.value as string;
        }
      }

      const targetUserId = fields.targetUserId;
      const reasonParsed = ReportReasonSchema.safeParse(fields.reason);
      const description = fields.description?.trim();
      const sessionId = fields.sessionId || null;

      if (!targetUserId || !reasonParsed.success || !description || description.length > 4000) {
        return reply.status(400).send({ error: "invalid_request" });
      }
      if (targetUserId === request.authUser!.sub) {
        return reply.status(400).send({ error: "cannot_report_self" });
      }

      const target = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        return reply.status(404).send({ error: "target_not_found" });
      }

      const report = await prisma.report.create({
        data: {
          // Explicitly reuse the id generated above — evidence files were
          // already written to REPORT_UPLOADS_DIR/<reportId>/ before the row
          // existed, so the row's id must match that directory name or the
          // stored evidencePaths (which embed reportId) point nowhere.
          id: reportId,
          reporterId: request.authUser!.sub,
          targetUserId,
          sessionId,
          reason: reasonParsed.data,
          description,
          evidencePaths: savedPaths,
        },
        include: {
          reporter: { select: { id: true, username: true } },
          target: { select: { id: true, username: true } },
          reviewedBy: { select: { id: true, username: true } },
        },
      });

      return reply.status(201).send(toSummary(report));
    },
  );

  app.get(
    "/reports",
    { preHandler: requireRole("admin", "master_admin") },
    async (_request, reply) => {
      const reports = await prisma.report.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          reporter: { select: { id: true, username: true } },
          target: { select: { id: true, username: true } },
          reviewedBy: { select: { id: true, username: true } },
        },
      });
      return reply.send({ reports: reports.map(toSummary) });
    },
  );

  app.get(
    "/reports/:id/evidence/:filename",
    { preHandler: requireRole("admin", "master_admin") },
    async (request, reply) => {
      const { id, filename } = request.params as { id: string; filename: string };
      // Reject any path-separator/traversal characters outright — the id and
      // filename are only ever used as literal path segments below.
      if (!/^[a-zA-Z0-9-]+$/.test(id) || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
        return reply.status(400).send({ error: "invalid_path" });
      }
      const report = await prisma.report.findUnique({ where: { id } });
      const relPath = `${id}/${filename}`;
      if (!report || !report.evidencePaths.includes(relPath)) {
        return reply.status(404).send({ error: "not_found" });
      }
      const filePath = path.join(env.REPORT_UPLOADS_DIR, relPath);
      const contentType = EXT_MIME_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
      const data = await readFile(filePath);
      return reply.header("Content-Type", contentType).send(data);
    },
  );

  app.patch(
    "/reports/:id/status",
    { preHandler: requireRole("admin", "master_admin") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateReportStatusRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_request" });
      }
      const existing = await prisma.report.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "not_found" });
      }
      const updated = await prisma.report.update({
        where: { id },
        data: {
          status: parsed.data.status,
          reviewedByUserId: request.authUser!.sub,
          reviewedAt: new Date(),
        },
        include: {
          reporter: { select: { id: true, username: true } },
          target: { select: { id: true, username: true } },
          reviewedBy: { select: { id: true, username: true } },
        },
      });
      return reply.send(toSummary(updated));
    },
  );
}
