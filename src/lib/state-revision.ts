import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { StateModuleKey } from "@/lib/state-response";

// One metadata query, no client records, evidence or salary snapshots loaded.
// Global table stamps intentionally invalidate cross-month duplicate information.
const stamps = {
  users: Prisma.sql`SELECT 'users' AS module, COUNT(*)::text AS count, MAX("updatedAt")::text AS modified FROM "User"`,
  profiles: Prisma.sql`SELECT 'profiles' AS module, COUNT(*)::text AS count, MAX("updatedAt")::text AS modified FROM "AttendanceProfile"`,
  settings: Prisma.sql`SELECT 'settings' AS module, COUNT(*)::text AS count, MAX("updatedAt")::text AS modified FROM "AppSettings"`,
  monthlyClosures: Prisma.sql`SELECT 'monthlyClosures' AS module, COUNT(*)::text AS count, MAX("updatedAt")::text AS modified FROM "MonthlyClosure"`,
  records: Prisma.sql`SELECT 'records' AS module, COUNT(*)::text AS count, MAX("updatedAt")::text AS modified FROM "Record"`,
  referrals: Prisma.sql`SELECT 'referrals' AS module, COUNT(*)::text AS count, MAX("updatedAt")::text AS modified FROM "Referral"`,
  wrongCards: Prisma.sql`SELECT 'wrongCards' AS module, COUNT(*)::text AS count, MAX("updatedAt")::text AS modified FROM "WrongCardReport"`,
  callReports: Prisma.sql`SELECT 'callReports' AS module, COUNT(*)::text AS count, MAX("updatedAt")::text AS modified FROM "CallReport"`,
  safetypayCodes: Prisma.sql`SELECT 'safetypayCodes' AS module, COUNT(*)::text AS count, MAX("updatedAt")::text AS modified FROM "SafetypayCodeEntry"`,
  penaltyReports: Prisma.sql`SELECT 'penaltyReports' AS module, COUNT(*)::text AS count, MAX("updatedAt")::text AS modified FROM "PenaltyReport"`,
};

export async function stateRevision(scope: unknown, modules: StateModuleKey[] | null) {
  const selected = new Set<string>(["users", "profiles", "settings", ...(modules || Object.keys(stamps))]);
  const queries = Object.entries(stamps).filter(([key]) => selected.has(key)).map(([, query]) => query);
  const rows = await prisma.$queryRaw<Array<{ module: string; count: string; modified: string | null }>>(
    Prisma.sql`${Prisma.join(queries, " UNION ALL ")}`,
  );
  rows.sort((a, b) => a.module.localeCompare(b.module));
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  return createHash("sha256").update(JSON.stringify(["state-v1", scope, day, rows])).digest("hex");
}
