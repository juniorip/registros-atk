import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { isAdmin } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { buildRatingsResponse } from "@/lib/ratings";
import { deletedRatingLogs, ratingDeletionKey, permanentlyRemovedRatingKeys } from "@/lib/rating-deletions";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Solo administración puede ver las calificaciones eliminadas." }, { status: 403 });
  return NextResponse.json({ logs: await deletedRatingLogs() }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Solo administración puede eliminar calificaciones." }, { status: 403 });
  const input = z.object({ rowKey: z.string().min(10).max(5000), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Calificación inválida." }, { status: 400 });
  const payload = await buildRatingsResponse(auth.user, { month: input.data.month });
  const row = payload.rows.find(item => item.rowKey === input.data.rowKey);
  if (!row) return NextResponse.json({ error: "No se encontró la calificación." }, { status: 404 });
  await prisma.changeLog.create({ data: {
    actorId: auth.user.id, module: "Calificaciones", action: "ELIMINAR", targetType: "RatingDeletion", targetId: ratingDeletionKey(row.rowKey), sede: row.sede,
    summary: `Retiró la calificación de ${row.matchedUserName || row.advisor}, ${row.date || row.rawDate}, ${row.rating} estrellas.`,
    before: JSON.parse(JSON.stringify(row)),
  } });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Solo administración puede restaurar calificaciones." }, { status: 403 });
  const input = z.object({ deletionKey: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Calificación inválida." }, { status: 400 });
  const deleted = (await deletedRatingLogs()).find(log => log.targetId === input.data.deletionKey);
  if (!deleted) return NextResponse.json({ error: "La calificación ya está restaurada o no existe." }, { status: 404 });
  await prisma.changeLog.create({ data: {
    actorId: auth.user.id, module: "Calificaciones", action: "RESTAURAR", targetType: "RatingDeletion", targetId: input.data.deletionKey, sede: deleted.sede,
    summary: `Restauró una calificación retirada. ${deleted.summary}`,
  } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Solo administración puede borrar definitivamente." }, { status: 403 });
  const input = z.object({ deletionKey: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await request.json().catch(() => null));
  if (!input.success || !permanentlyRemovedRatingKeys.has(input.data.deletionKey)) return NextResponse.json({ error: "El registro no está autorizado para borrado definitivo." }, { status: 400 });
  const result = await prisma.$transaction(async tx => {
    const snapshots = await tx.ratingSnapshot.findMany({ select: { id: true, responseKey: true } });
    const approvals = await tx.ratingApproval.findMany({ select: { id: true, rowKey: true } });
    const logs = await tx.changeLog.findMany({ where: { module: "Calificaciones" } });
    const matchingSnapshots = snapshots.filter(row => ratingDeletionKey(row.responseKey) === input.data.deletionKey);
    const matchingApprovals = approvals.filter(row => ratingDeletionKey(row.rowKey) === input.data.deletionKey);
    const matchingLogs = logs.filter(log => {
      if (log.targetId === input.data.deletionKey) return true;
      for (const data of [log.before, log.after]) {
        if (data && typeof data === "object" && !Array.isArray(data) && typeof data.rowKey === "string" && ratingDeletionKey(data.rowKey) === input.data.deletionKey) return true;
      }
      return matchingApprovals.some(row => log.targetType === "RatingApproval" && log.targetId === String(row.id));
    });
    await tx.ratingSnapshot.deleteMany({ where: { id: { in: matchingSnapshots.map(row => row.id) } } });
    await tx.ratingApproval.deleteMany({ where: { id: { in: matchingApprovals.map(row => row.id) } } });
    await tx.changeLog.deleteMany({ where: { id: { in: matchingLogs.map(row => row.id) } } });
    return { snapshots: matchingSnapshots.length, approvals: matchingApprovals.length, history: matchingLogs.length };
  });
  return NextResponse.json({ ok: true, removed: result }, { headers: { "Cache-Control": "no-store" } });
}
