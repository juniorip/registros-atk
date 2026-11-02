import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export function ratingDeletionKey(rowKey: string) {
  // The source row number may move when the sheet is sorted or responses shift.
  return createHash("sha256").update(rowKey.replace(/^\d+\|/, "")).digest("hex");
}

export async function deletedRatingLogs() {
  const logs = await prisma.changeLog.findMany({
    where: { module: "Calificaciones", targetType: "RatingDeletion", action: { in: ["ELIMINAR", "RESTAURAR"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { actor: { select: { id: true, name: true } } },
  });
  const latest = new Map<string, typeof logs[number]>();
  for (const log of logs) if (log.targetId && !latest.has(log.targetId)) latest.set(log.targetId, log);
  return Array.from(latest.values()).filter(log => log.action === "ELIMINAR");
}

// Anonymous suppression prevents reimport from the external read-only source.
export const permanentlyRemovedRatingKeys = new Set(["6b84cdf142cb4c5f147ad772b9c08d3014994664b6487e77e2a0ca1b9f22d776"]);
