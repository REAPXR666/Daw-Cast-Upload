import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __dawCastPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__dawCastPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__dawCastPrisma = prisma;
}

export * from "@prisma/client";
