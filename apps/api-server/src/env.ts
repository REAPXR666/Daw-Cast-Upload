import "dotenv/config";
import { z } from "zod";

// Placeholder values that appear in .env.example — safe for local dev, never
// safe in production. Catching these here fails startup loudly instead of
// letting a copy-pasted example secret silently sign real user tokens.
const INSECURE_DEFAULTS = new Set(["dev-only-access-secret-change-me"]);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(16),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
    CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
    REPORT_UPLOADS_DIR: z.string().min(1).default("./uploads/reports"),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_PRICE_ID: z.string().min(1).optional(),
    STRIPE_SUCCESS_URL: z.string().min(1).default("https://dawcast.local/billing/success"),
    STRIPE_CANCEL_URL: z.string().min(1).default("https://dawcast.local/billing/cancel"),
  })
  .refine(
    (e) => e.NODE_ENV !== "production" || !INSECURE_DEFAULTS.has(e.JWT_ACCESS_SECRET),
    { message: "JWT_ACCESS_SECRET is still the placeholder value — set a real secret before running in production", path: ["JWT_ACCESS_SECRET"] },
  );

export const env = EnvSchema.parse(process.env);
