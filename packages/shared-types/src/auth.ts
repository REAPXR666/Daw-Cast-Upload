import { z } from "zod";

export const UsernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(24, "Username must be at most 24 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores");

export const PasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(256, "Password is too long")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");

export const CaptchaChallengeResponseSchema = z.object({
  challengeId: z.string().uuid(),
  imagePngBase64: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type CaptchaChallengeResponse = z.infer<typeof CaptchaChallengeResponseSchema>;

export const SignupRequestSchema = z.object({
  email: z.string().email().max(254),
  username: UsernameSchema,
  password: PasswordSchema,
  tosAccepted: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms of Service" }),
  }),
  captcha: z.object({
    challengeId: z.string().uuid(),
    answer: z.string().min(1).max(16),
  }),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const LoginRequestSchema = z.object({
  usernameOrEmail: z.string().min(1).max(254),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: UsernameSchema,
  role: z.enum(["user", "admin", "master_admin"]),
  createdAt: z.string().datetime(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string(),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

export const AuthResponseSchema = z.object({
  user: AuthUserSchema,
  tokens: AuthTokensSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export interface AccessTokenClaims {
  sub: string;
  username: string;
  role: "user" | "admin" | "master_admin";
  iat: number;
  exp: number;
}
