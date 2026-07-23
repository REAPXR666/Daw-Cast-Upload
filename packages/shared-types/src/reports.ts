import { z } from "zod";

export const ReportReasonSchema = z.enum([
  "harassment",
  "unauthorized_recording",
  "unwanted_sexual_content",
  "malware",
  "other",
]);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

export const ReportStatusSchema = z.enum(["open", "reviewed", "actioned", "dismissed"]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const MAX_REPORT_EVIDENCE_FILES = 3;
export const MAX_REPORT_EVIDENCE_FILE_BYTES = 25 * 1024 * 1024;
export const REPORT_EVIDENCE_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/webm",
];

export const CreateReportFieldsSchema = z.object({
  targetUserId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
  reason: ReportReasonSchema,
  description: z.string().min(1).max(4000),
});
export type CreateReportFields = z.infer<typeof CreateReportFieldsSchema>;

export const ReportSummarySchema = z.object({
  id: z.string().uuid(),
  reporter: z.object({ id: z.string().uuid(), username: z.string() }),
  target: z.object({ id: z.string().uuid(), username: z.string() }),
  sessionId: z.string().uuid().nullable(),
  reason: ReportReasonSchema,
  description: z.string(),
  evidencePaths: z.array(z.string()),
  status: ReportStatusSchema,
  reviewedBy: z.object({ id: z.string().uuid(), username: z.string() }).nullable(),
  reviewedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export const UpdateReportStatusRequestSchema = z.object({
  status: ReportStatusSchema,
});
export type UpdateReportStatusRequest = z.infer<typeof UpdateReportStatusRequestSchema>;
