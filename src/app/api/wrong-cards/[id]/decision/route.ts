import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { canValidateWrongCardReport } from "@/lib/domain";
import { isMonthClosedForRole, monthFromDate } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

const decisionSchema = z.object({
  action: z.enum(["validate", "reject"]),
  reason: z.string().optional().nullable(),
});

const userSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  sede: true,
  forcePasswordReset: true,
  color: true,
} as const;

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
  const report = await prisma.wrongCardReport.findUnique({
    where: { id: Number(id) },
    include: { user: { select: userSelect }, validatedBy: { select: userSelect } },
  });

  if (!report || !canValidateWrongCardReport(auth.user, report)) {
    return NextResponse.json({ error: "No puedes decidir esta tarjeta." }, { status: 403 });
  }

  if (await isMonthClosedForRole(monthFromDate(report.detectedDate), auth.user.role)) {
    return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para validar o rechazar." }, { status: 403 });
  }

  if (parsed.data.action === "validate") {
    await prisma.wrongCardReport.update({
      where: { id: report.id },
      data: {
        status: "APPROVED",
        validatedAt: new Date(),
        validatedById: auth.user.id,
        rejectedAt: null,
        rejectionReason: null,
      },
    });
    await logChange({actorId:auth.user.id,module:"Tarjetas erróneas",action:String(parsed.data.action)==='reject'?'RECHAZAR':'APROBAR',summary:(String(parsed.data.action)==='reject'?'Rechazó':'Aprobó')+' Tarjetas erróneas #'+report.id,targetType:'WrongCardReport',targetId:report.id,sede:report.historicalSede,before:report,after:{decision:parsed.data.action,reason:parsed.data.reason||null}});
    return NextResponse.json({ ok: true });
  }

  if (!parsed.data.reason?.trim()) {
    return NextResponse.json({ error: "Debes indicar el motivo del rechazo." }, { status: 400 });
  }

  await prisma.wrongCardReport.update({
    where: { id: report.id },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectionReason: parsed.data.reason.trim(),
      validatedAt: null,
      validatedById: null,
    },
  });

  await logChange({actorId:auth.user.id,module:"Tarjetas erróneas",action:String(parsed.data.action)==='reject'?'RECHAZAR':'APROBAR',summary:(String(parsed.data.action)==='reject'?'Rechazó':'Aprobó')+' Tarjetas erróneas #'+report.id,targetType:'WrongCardReport',targetId:report.id,sede:report.historicalSede,before:report,after:{decision:parsed.data.action,reason:parsed.data.reason||null}});
    return NextResponse.json({ ok: true });
}

