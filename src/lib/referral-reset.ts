import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function currentReferralMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
}

export function referralMonthWhere(month: string) {
  // Match the accounting dates already used by the referrals list and API.
  const [year, monthNumber] = month.split("-").map(Number);
  return { createdAt: { gte: new Date(Date.UTC(year, monthNumber - 1, 1)), lt: new Date(Date.UTC(year, monthNumber, 1)) } };
}

export async function referralResetPreview(month: string, db: Pick<Prisma.TransactionClient, "referral"> = prisma) {
  const rows = await db.referral.findMany({ where: referralMonthWhere(month), orderBy: { id: "asc" }, select: {
    id: true, validatedAt: true, validatedById: true, rejectedAt: true, rejectionReason: true, updatedAt: true,
  } });
  return { rows, month, total: rows.length, approved: rows.filter(row => row.validatedAt).length,
    rejected: rows.filter(row => row.rejectedAt).length,
    pending: rows.filter(row => !row.validatedAt && !row.rejectedAt).length,
    revision: createHash("sha256").update(JSON.stringify([month, rows])).digest("hex") };
}

export async function resetReferralMonth(month: string, revision: string, actorId: number) {
  return prisma.$transaction(async tx => {
    const preview = await referralResetPreview(month, tx);
    if (preview.revision !== revision) throw new Error("Los referidos cambiaron. Revisa la cantidad e inténtalo de nuevo.");
    if (await tx.monthlyClosure.findUnique({ where: { month }, select: { status: true } }).then(row => row?.status === "CLOSED")) {
      throw new Error("El mes está cerrado. Reábrelo antes de restablecer los referidos.");
    }
    const decided = preview.rows.filter(row => row.validatedAt || row.rejectedAt);
    if (!decided.length) return { changed: 0, total: preview.total, pending: preview.total };
    const result = await tx.referral.updateMany({ where: { id: { in: decided.map(row => row.id) }, ...referralMonthWhere(month) },
      data: { validatedAt: null, validatedById: null, rejectedAt: null, rejectionReason: null } });
    // Preserve the prior decision metadata for audit/recovery. Client details,
    // owners, amounts and commissions are never overwritten by this operation.
    await tx.changeLog.create({ data: { actorId, module: "Referidos", action: "RESTABLECER", targetType: "ReferralMonthReset", targetId: month,
      summary: `Restableció ${result.count} referido(s) de ${month} a pendientes de aprobación.`,
      before: JSON.parse(JSON.stringify(decided)), after: { month, changed: result.count, pending: preview.total },
    } });
    return { changed: result.count, total: preview.total, pending: preview.total };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
