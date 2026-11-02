import { logChange } from "@/lib/change-log";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import {
  canCreatePenaltyReport,
  CUSTOMER_SERVICE_PENALTIES,
  getPenaltyByCode,
  isManager,
  normalizeSede,
  SEDES,
} from "@/lib/domain";
import { readPayoutSettings } from "@/lib/payout-settings";
import { prisma } from "@/lib/prisma";

const penaltyReportSchema = z.object({
  clientDni: z.string().min(6),
  clientName: z.string().min(2),
  workerUserId: z.number().int().positive().optional().nullable(),
  workerName: z.string().min(2),
  targetSede: z.enum(SEDES),
  penaltyCode: z.string().min(2),
  reason: z.string().min(8),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  if (!canCreatePenaltyReport(auth.user)) {
    return NextResponse.json({ error: "Solo jefe de sede o admin puede enviar reportes." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = penaltyReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const data = parsed.data;
  const targetSede = normalizeSede(data.targetSede);
  if (!SEDES.includes(targetSede as (typeof SEDES)[number])) {
    return NextResponse.json({ error: "Sede destino inválida." }, { status: 400 });
  }

  const payoutSettings = await readPayoutSettings().catch(() => null);
  const penaltyRules = payoutSettings?.customerServicePenalties?.length
    ? payoutSettings.customerServicePenalties
    : CUSTOMER_SERVICE_PENALTIES;
  const penalty = penaltyRules.find((item) => item.code === data.penaltyCode) || getPenaltyByCode(data.penaltyCode);
  if (!penalty) {
    return NextResponse.json({ error: "Penalidad inválida." }, { status: 400 });
  }

  const worker = data.workerUserId
    ? await prisma.user.findUnique({
        where: { id: data.workerUserId },
        select: { id: true, name: true, role: true, sede: true },
      })
    : null;

  if (worker && worker.role === UserRole.ADMIN) {
    return NextResponse.json({ error: "No puedes reportar penalidad a un admin." }, { status: 400 });
  }

  const workerSede = normalizeSede(worker?.sede || targetSede);
  if (worker && workerSede !== targetSede) {
    return NextResponse.json(
      { error: "El trabajador seleccionado no pertenece a la sede destino." },
      { status: 400 },
    );
  }

  const sameSede = isManager(auth.user) && normalizeSede(auth.user.sede) === targetSede;

  const receiver = await prisma.user.findFirst({
    where: {
      role: UserRole.MANAGER,
      sede: targetSede,
    },
    select: { id: true },
  });

  const report = await prisma.penaltyReport.create({
    data: {
      clientDni: data.clientDni.trim(),
      clientName: data.clientName.trim(),
      workerUserId: worker?.id || null,
      workerName: (worker?.name || data.workerName).trim(),
      workerSede,
      targetSede,
      penaltyCode: penalty.code,
      penaltyLabel: penalty.label,
      penaltyAmount: penalty.amount,
      reason: data.reason.trim(),
      status: sameSede ? "APPROVED" : "PENDING",
      sentById: auth.user.id,
      receiverId: receiver?.id || null,
      decidedById: sameSede ? auth.user.id : null,
      decidedAt: sameSede ? new Date() : null,
      decisionReason: sameSede ? "Penalidad interna de la misma sede." : null,
    },
  });

  await logChange({actorId:auth.user.id,module:"Penalidades",action:'CREAR',summary:'Creó Penalidades #'+report.id,targetType:'PenaltyReport',targetId:report.id,after:report});
  if(report.status==="APPROVED") await logChange({actorId:auth.user.id,module:"Penalidades",action:"APROBAR",summary:`Aprobación interna de penalidad #${report.id}.`,targetType:"PenaltyReport",targetId:report.id,after:{status:report.status,reason:report.decisionReason}});
  return NextResponse.json({ ok: true, report });
}
