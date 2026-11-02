import { logChange } from "@/lib/change-log";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { isPaymentsSupervisor, isPaymentsTeamMember, normalizeSede, resolveHistoricalSede } from "@/lib/domain";
import { isMonthClosedForRole, monthFromDate } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

const decisionSchema = z.object({
  action: z.enum(["validate", "reject"]),
  reason: z.string().optional().nullable(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Accion invalida." }, { status: 400 });
  }

  const { id } = await context.params;
  const report = await prisma.callReport.findUnique({
    where: { id: Number(id) },
    include: {
      user: {
        select: { id: true, name: true, username: true, role: true, sede: true, forcePasswordReset: true, color: true },
      },
      validatedBy: {
        select: { id: true, name: true, username: true, role: true, sede: true, forcePasswordReset: true, color: true },
      },
    },
  });

  const canDecide =
    !!report &&
    report.status === "PENDING" &&
    (auth.user.role === UserRole.ADMIN ||
      (auth.user.role === UserRole.MANAGER &&
        (isPaymentsSupervisor(auth.user)
          ? isPaymentsTeamMember(report.user)
          : !isPaymentsTeamMember(report.user) &&
            normalizeSede(auth.user.sede) === resolveHistoricalSede(report.historicalSede, report.user.sede))));

  if (!canDecide) {
    return NextResponse.json({ error: "No puedes decidir esta llamada." }, { status: 403 });
  }

  if (await isMonthClosedForRole(monthFromDate(report.createdAt), auth.user.role)) {
    return NextResponse.json({ error: "Este mes esta cerrado. Reabrelo para validar o rechazar." }, { status: 403 });
  }

  if (parsed.data.action === "validate") {
    await prisma.callReport.update({
      where: { id: report.id },
      data: {
        status: "APPROVED",
        validatedAt: new Date(),
        validatedById: auth.user.id,
        rejectedAt: null,
        rejectionReason: null,
      },
    });
    await logChange({actorId:auth.user.id,module:"Llamadas",action:String(parsed.data.action)==='reject'?'RECHAZAR':'APROBAR',summary:(String(parsed.data.action)==='reject'?'Rechazó':'Aprobó')+' Llamadas #'+report.id,targetType:'CallReport',targetId:report.id,sede:report.historicalSede,before:report,after:{decision:parsed.data.action,reason:parsed.data.reason||null}});
    return NextResponse.json({ ok: true });
  }

  if (!parsed.data.reason?.trim()) {
    return NextResponse.json({ error: "Debes indicar el motivo del rechazo." }, { status: 400 });
  }

  await prisma.callReport.update({
    where: { id: report.id },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectionReason: parsed.data.reason.trim(),
      validatedAt: null,
      validatedById: null,
    },
  });

  await logChange({actorId:auth.user.id,module:"Llamadas",action:String(parsed.data.action)==='reject'?'RECHAZAR':'APROBAR',summary:(String(parsed.data.action)==='reject'?'Rechazó':'Aprobó')+' Llamadas #'+report.id,targetType:'CallReport',targetId:report.id,sede:report.historicalSede,before:report,after:{decision:parsed.data.action,reason:parsed.data.reason||null}});
    return NextResponse.json({ ok: true });
}

