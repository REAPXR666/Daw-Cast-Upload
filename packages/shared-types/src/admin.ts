import { z } from "zod";

export const AdminUserSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string(),
  role: z.enum(["user", "admin", "master_admin"]),
  createdAt: z.string().datetime(),
  isBanned: z.boolean(),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummarySchema>;

export const SetUserRoleRequestSchema = z.object({
  role: z.enum(["user", "admin"]),
});
export type SetUserRoleRequest = z.infer<typeof SetUserRoleRequestSchema>;

export const CreateAccountBanRequestSchema = z.object({
  targetUserId: z.string().uuid(),
  reason: z.string().min(1).max(1000),
});
export type CreateAccountBanRequest = z.infer<typeof CreateAccountBanRequestSchema>;

export const AccountBanSummarySchema = z.object({
  id: z.string().uuid(),
  target: z.object({ id: z.string().uuid(), username: z.string() }),
  issuedBy: z.object({ id: z.string().uuid(), username: z.string() }),
  reason: z.string(),
  createdAt: z.string().datetime(),
});
export type AccountBanSummary = z.infer<typeof AccountBanSummarySchema>;
