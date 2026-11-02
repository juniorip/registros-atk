import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { canDecidePenaltyReport } from "@/lib/domain";
import { isMonthClosedForRole, monthFromDate } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

const decisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
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
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  }

  const { id } = await context.params;
  const report = await prisma.penaltyReport.findUnique({
    where: { id: Number(id) },
  });

  if (!report || !canDecidePenaltyReport(auth.user, report)) {
    return NextResponse.json({ error: "No puedes decidir este reporte." }, { status: 403 });
  }

  if (await isMonthClosedForRole(monthFromDate(report.createdAt), auth.user.role)) {
    return NextResponse.json(
      { error: "Este mes esta cerrado. Solo el admin puede decidir reportes de un mes cerrado." },
      { status: 403 },
    );
  }

  if (parsed.data.action === "approve") {
    await prisma.penaltyReport.update({
      where: { id: report.id },
      data: {
        status: "APPROVED",
        decidedById: auth.user.id,
        decidedAt: new Date(),
        decisionReason: null,
      },
    });
    await logChange({actorId:auth.user.id,module:"Penalidades",action:String(parsed.data.action)==='reject'?'RECHAZAR':'APROBAR',summary:(String(parsed.data.action)==='reject'?'Rechazó':'Aprobó')+' Penalidades #'+report.id,targetType:'PenaltyReport',targetId:report.id,sede:report.targetSede,before:report,after:{decision:parsed.data.action,reason:parsed.data.reason||null}});
    return NextResponse.json({ ok: true });
  }

  if (!parsed.data.reason?.trim()) {
    return NextResponse.json({ error: "Debes indicar por qué rechazas la penalidad." }, { status: 400 });
  }

  await prisma.penaltyReport.update({
    where: { id: report.id },
    data: {
      status: "REJECTED",
      decidedById: auth.user.id,
      decidedAt: new Date(),
      decisionReason: parsed.data.reason.trim(),
    },
  });

  await logChange({actorId:auth.user.id,module:"Penalidades",action:String(parsed.data.action)==='reject'?'RECHAZAR':'APROBAR',summary:(String(parsed.data.action)==='reject'?'Rechazó':'Aprobó')+' Penalidades #'+report.id,targetType:'PenaltyReport',targetId:report.id,sede:report.targetSede,before:report,after:{decision:parsed.data.action,reason:parsed.data.reason||null}});
    return NextResponse.json({ ok: true });
}

