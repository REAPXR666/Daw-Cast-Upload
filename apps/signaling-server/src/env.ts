import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  MEDIASOUP_ANNOUNCED_IP: z.string().min(1).default("127.0.0.1"),
  MEDIASOUP_MIN_PORT: z.coerce.number().int().positive().default(40000),
  MEDIASOUP_MAX_PORT: z.coerce.number().int().positive().default(40100),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  FREE_TIER_MAX_PARTICIPANTS: z.coerce.number().int().positive().default(2),
});

export const env = EnvSchema.parse(process.env);
