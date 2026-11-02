import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { WorkCalendarRule } from "./work-calendar-rules";

// The calendar is a versioned event stream: the same atomic row stores the
// effective configuration and its audit trail, without modifying raw punches.
export async function readWorkCalendar(db: Pick<Prisma.TransactionClient, "changeLog"> = prisma) {
  const events = await db.changeLog.findMany({
    where: { targetType: "WorkCalendar" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { targetId: true, action: true, after: true },
  });
  const current = new Map<string, WorkCalendarRule>();
  for (const event of events) {
    if (!event.targetId) continue;
    if (event.action === "ELIMINAR") current.delete(event.targetId);
    else if (event.after) current.set(event.targetId, event.after as unknown as WorkCalendarRule);
  }
  return [...current.values()].sort((a, b) => b.date.localeCompare(a.date) || a.reason.localeCompare(b.reason));
}
