import "dotenv/config";
import { z } from "zod";

const INSECURE_DEFAULTS = new Set(["dev-only-access-secret-change-me"]);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4001),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(16),
    MEDIASOUP_ANNOUNCED_IP: z.string().min(1).default("127.0.0.1"),
    MEDIASOUP_MIN_PORT: z.coerce.number().int().positive().default(40000),
    MEDIASOUP_MAX_PORT: z.coerce.number().int().positive().default(40100),
    CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
    // Fallback only — used when a host has no Subscription row at all.
    // Real capacity comes from shared-types' SESSION_CAPACITY by tier.
    FREE_TIER_MAX_PARTICIPANTS: z.coerce.number().int().positive().default(2),
  })
  .refine(
    (e) => e.NODE_ENV !== "production" || !INSECURE_DEFAULTS.has(e.JWT_ACCESS_SECRET),
    { message: "JWT_ACCESS_SECRET is still the placeholder value — set a real secret before running in production", path: ["JWT_ACCESS_SECRET"] },
  );

export const env = EnvSchema.parse(process.env);
