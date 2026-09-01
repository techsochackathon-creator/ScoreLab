import { PrismaClient } from "@prisma/client";

/**
 * Serverless-friendly Prisma client.
 *
 * The connection is pooled at the database layer via Neon's PgBouncer endpoint
 * (POSTGRES_PRISMA_URL). Migrations use the direct endpoint
 * (POSTGRES_URL_NON_POOLING) — see prisma/schema.prisma `directUrl`.
 *
 * A module-level singleton avoids exhausting connections when Vercel reuses a
 * warm lambda across invocations (and avoids "too many clients" in dev HMR).
 *
 * ---------------------------------------------------------------------------
 * Alternative: @prisma/adapter-neon (Neon serverless driver)
 * ---------------------------------------------------------------------------
 * If you prefer the driver adapter (e.g. for edge runtime), add
 * `@prisma/adapter-neon` + `@neondatabase/serverless`, enable
 * `previewFeatures = ["driverAdapters"]` in the generator, and swap the client:
 *
 *   import { PrismaNeon } from "@prisma/adapter-neon";
 *   const adapter = new PrismaNeon({ connectionString: process.env.POSTGRES_PRISMA_URL });
 *   export const prisma = new PrismaClient({ adapter });
 *
 * The pooled-connection approach below is used by default because it is
 * transaction-safe and has no driver/runtime caveats on the Node runtime.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
