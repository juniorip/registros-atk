import { logChange } from "@/lib/change-log";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import {
  canCreatePaymentAudit,
  normalizeSede,
  PAYMENT_AUDIT_REPORTER_BONUS,
} from "@/lib/domain";
import { readAttendanceData } from "@/lib/attendance";
import { prisma } from "@/lib/prisma";

const MAX_EVIDENCE_LENGTH = 2_800_000;
const PAYMENT_AUDIT_TYPES = {
  DATA_ERROR: { code: "PAYMENT_AUDIT_DATA_ERROR", label: "Error de datos", advisorPenalty: 2, managerPenalty: 0 },
  CHAT_ABANDONMENT: { code: "PAYMENT_AUDIT_CHAT_ABANDONMENT", label: "Abandono de chat", advisorPenalty: 2, managerPenalty: 2 },
} as const;
const paymentAuditSchema = z.object({
  workerUserId: z.number().int().positive(),
  type: z.enum(["DATA_ERROR", "CHAT_ABANDONMENT"]),
  reason: z.string().trim().min(8).max(3000),
  evidenceImage: z
    .string()
    .max(MAX_EVIDENCE_LENGTH)
    .regex(/^data:image\/(png|jpeg|webp);base64,/, "La evidencia debe ser una imagen PNG, JPG o WEBP."),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  if (!canCreatePaymentAudit(auth.user)) {
    return NextResponse.json({ error: "Solo el personal autorizado de Pagos puede enviar esta auditoría." }, { status: 403 });
  }

  const parsed = paymentAuditSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Revisa el asesor, el motivo y la captura del error." }, { status: 400 });
  }

  const worker = await prisma.user.findUnique({
    where: { id: parsed.data.workerUserId },
    select: { id: true, name: true, role: true, sede: true },
  });
  if (!worker || worker.role !== UserRole.EMPLOYEE) {
    return NextResponse.json({ error: "Selecciona un asesor activo válido." }, { status: 400 });
  }
  const attendance = await readAttendanceData();
  const attendancePerson = attendance.people.find((person) =>
    !!person.extraBonuses && Number(person.extraBonuses.__linkedUserId || 0) === worker.id,
  );
  if (attendancePerson?.extraBonuses?.__inactive) {
    return NextResponse.json({ error: "No puedes reportar una penalidad para un colaborador inactivo." }, { status: 400 });
  }

  const targetSede = normalizeSede(worker.sede);
  const auditType = PAYMENT_AUDIT_TYPES[parsed.data.type];
  const receiver = await prisma.user.findFirst({
    where: { role: UserRole.MANAGER, sede: targetSede },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!receiver) {
    return NextResponse.json({ error: "El asesor no tiene una jefa de sede asignada para aprobar la penalidad." }, { status: 400 });
  }

  const report = await prisma.penaltyReport.create({
    data: {
      clientDni: "AUDITORIA-PAGOS",
      clientName: worker.name,
      workerUserId: worker.id,
      workerName: worker.name,
      workerSede: targetSede,
      targetSede,
      penaltyCode: auditType.code,
      penaltyLabel: auditType.label,
      penaltyAmount: auditType.advisorPenalty,
      category: "PAYMENT_AUDIT",
      evidenceImage: parsed.data.evidenceImage,
      managerPenaltyAmount: auditType.managerPenalty,
      reporterBonusAmount: PAYMENT_AUDIT_REPORTER_BONUS,
      reason: parsed.data.reason,
      status: "PENDING",
      sentById: auth.user.id,
      receiverId: receiver.id,
    },
  });

  await logChange({actorId:auth.user.id,module:"Auditoría de pagos",action:'CREAR',summary:'Creó Auditoría de pagos #'+report.id,targetType:'PenaltyReport',targetId:report.id,after:report});
  return NextResponse.json({ ok: true, report });
}
