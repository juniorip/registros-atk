import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { canDeleteReferral, type VisibleStateReferral } from "@/lib/domain";
import { isMonthClosedForRole, monthFromDate } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

const userSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  sede: true,
  forcePasswordReset: true,
  color: true,
} as const;

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const referral = await prisma.referral.findUnique({
    where: { id: Number(id) },
    include: {
      user: { select: userSelect },
      validatedBy: { select: userSelect },
    },
  });

  if (!referral) {
    return NextResponse.json({ error: "Referido no encontrado." }, { status: 404 });
  }

  if (!canDeleteReferral(auth.user, referral as VisibleStateReferral)) {
    return NextResponse.json({ error: "No puedes eliminar este referido." }, { status: 403 });
  }
  if (await isMonthClosedForRole(monthFromDate(referral.createdAt), auth.user.role)) {
    return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para eliminar referidos." }, { status: 403 });
  }

  await prisma.referral.delete({ where: { id: referral.id } });
  await logChange({actorId:auth.user.id,module:'Referidos',action:'ELIMINAR',summary:'Eliminó referido #'+referral.id,targetType:'Referral',targetId:referral.id,sede:referral.historicalSede,before:referral});
  return NextResponse.json({ ok: true });
}
