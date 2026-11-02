import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { isAdmin } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  if (!isAdmin(auth.user)) {
    return NextResponse.json({ error: "Solo el admin puede eliminar penalidades." }, { status: 403 });
  }

  const { id } = await context.params;
  const reportId = Number(id);
  if (!Number.isFinite(reportId)) {
    return NextResponse.json({ error: "Penalidad inválida." }, { status: 400 });
  }

  await prisma.penaltyReport.delete({
    where: { id: reportId },
  });

  await logChange({actorId:auth.user.id,module:'Penalidades',action:'ELIMINAR',summary:'Eliminó penalidad #'+reportId,targetType:'PenaltyReport',targetId:reportId});
  return NextResponse.json({ ok: true });
}
