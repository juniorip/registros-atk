import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Metadata only: unchanged polls never load the attendance JSON or calculate days.
// Counts also detect deletions; the Lima date invalidates date-dependent statuses.
export async function attendanceRevision(scope: string) {
  const parts = await Promise.all([
    prisma.attendanceStore.findUnique({ where: { id: 1 }, select: { updatedAt: true } }),
    prisma.attendanceOverride.aggregate({ _max: { updatedAt: true }, _count: true }),
    prisma.attendanceProfile.aggregate({ _max: { updatedAt: true }, _count: true }),
    prisma.changeLog.aggregate({ where: { targetType: "WorkCalendar" }, _max: { id: true }, _count: true }),
    prisma.attendanceChangeRequest.aggregate({ _max: { updatedAt: true }, _count: true }),
  ]);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  return createHash("sha256").update(JSON.stringify([scope, day, parts])).digest("hex");
}
