import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { canValidateOrReject, type VisibleStateRecord } from "@/lib/domain";
import { isMonthClosedForRole, recordAccountingMonth } from "@/lib/monthly-closure";
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
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  }

  const { id } = await context.params;
  const record = await prisma.record.findUnique({
    where: { id: Number(id) },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          sede: true,
          forcePasswordReset: true,
          color: true,
        },
      },
      validatedBy: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          sede: true,
          forcePasswordReset: true,
          color: true,
        },
      },
    },
  });

  if (!record || !canValidateOrReject(auth.user, record as VisibleStateRecord)) {
    return NextResponse.json({ error: "No puedes decidir este registro." }, { status: 403 });
  }
  const decidedAt = new Date();
  if (await isMonthClosedForRole(recordAccountingMonth({
    registrationDate: record.registrationDate,
    operationDate: record.operationDate,
    rejectedAt: parsed.data.action === "reject" ? decidedAt : record.rejectedAt,
    validatedAt: parsed.data.action === "validate" ? decidedAt : record.validatedAt,
  }), auth.user.role)) {
    return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para validar o rechazar registros." }, { status: 403 });
  }

  if (parsed.data.action === "validate") {
    const targetMonth = recordAccountingMonth({
      registrationDate: record.registrationDate,
      operationDate: record.operationDate,
      rejectedAt: record.rejectedAt,
      validatedAt: decidedAt,
    });
    const duplicateCandidates = await prisma.record.findMany({
      where: {
        id: { not: record.id },
        dni: record.dni,
        rejectedAt: null,
      },
      select: {
        id: true,
        registrationDate: true,
        operationDate: true,
        rejectedAt: true,
        validatedAt: true,
      },
    });
    const hasActiveDuplicate = duplicateCandidates.some((duplicate) =>
      recordAccountingMonth({
        registrationDate: duplicate.registrationDate,
        operationDate: duplicate.operationDate,
        rejectedAt: duplicate.rejectedAt,
        validatedAt: duplicate.validatedAt,
      }) === targetMonth
    );
    if (hasActiveDuplicate) {
      return NextResponse.json(
        { error: "Este DNI tiene duplicados activos. Resuelve el duplicado antes de validar." },
        { status: 409 },
      );
    }

    await prisma.record.update({
      where: { id: record.id },
      data: {
        validatedAt: decidedAt,
        validatedById: auth.user.id,
        rejectedAt: null,
        rejectionReason: null,
      },
    });
    await logChange({actorId:auth.user.id,module:"Registros",action:String(parsed.data.action)==='reject'?'RECHAZAR':'APROBAR',summary:(String(parsed.data.action)==='reject'?'Rechazó':'Aprobó')+' Registros #'+record.id,targetType:'Record',targetId:record.id,sede:record.historicalSede,before:record,after:{decision:parsed.data.action,reason:parsed.data.reason||null}});
    return NextResponse.json({ ok: true });
  }

  if (!parsed.data.reason?.trim()) {
    return NextResponse.json({ error: "Debes indicar el motivo del rechazo." }, { status: 400 });
  }

  await prisma.record.update({
    where: { id: record.id },
    data: {
      rejectedAt: decidedAt,
      rejectionReason: parsed.data.reason.trim(),
      validatedAt: null,
      validatedById: null,
    },
  });

  await logChange({actorId:auth.user.id,module:"Registros",action:String(parsed.data.action)==='reject'?'RECHAZAR':'APROBAR',summary:(String(parsed.data.action)==='reject'?'Rechazó':'Aprobó')+' Registros #'+record.id,targetType:'Record',targetId:record.id,sede:record.historicalSede,before:record,after:{decision:parsed.data.action,reason:parsed.data.reason||null}});
    return NextResponse.json({ ok: true });
}

