import { logChange } from "@/lib/change-log";
import { RecordMode, RecordType, UploadPlatform } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import {
  canDeleteRecord,
  canViewRecord,
  isApprovalLocked,
  normalizeSede,
  resolveHistoricalSede,
  type VisibleStateRecord,
} from "@/lib/domain";
import { isMonthClosedForRole, monthFromDate, recordAccountingMonth } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  type: z.enum(["REGISTRO", "OPERACION"]),
  operationDate: z.string().optional().nullable(),
  mode: z.enum(["VIRTUAL", "PRESENCIAL"]),
  uploadPlatform: z.enum(["WEB", "DRIVE"]),
  notes: z.string().optional().nullable(),
});

async function getRecord(id: number) {
  return prisma.record.findUnique({
    where: { id },
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
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const record = await getRecord(Number(id));
  if (!record || !canViewRecord(auth.user, record as VisibleStateRecord)) {
    return NextResponse.json({ error: "Registro no encontrado." }, { status: 404 });
  }
  if (false) {
    return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para editar registros." }, { status: 403 });
  }

  const locked = isApprovalLocked(record);
  const isSameSedeManager =
    auth.user.role === "MANAGER" &&
    resolveHistoricalSede(record.historicalSede, record.user.sede) === normalizeSede(auth.user.sede);
  const canEditGeneral =
    (auth.user.role === "ADMIN" || isSameSedeManager || record.userId === auth.user.id) && !locked;
  const canEditModeOnly =
    locked &&
    (auth.user.role === "ADMIN" ||
      isSameSedeManager ||
      record.userId === auth.user.id);

  if (!canEditGeneral && !canEditModeOnly) {
    return NextResponse.json({ error: "No puedes editar este registro." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const requestedOperationDate = parsed.data.operationDate ? new Date(parsed.data.operationDate) : null;
  const operationDate = locked ? record.operationDate : requestedOperationDate;
  const type = operationDate ? RecordType.OPERACION : (parsed.data.type as RecordType);
  if (await isMonthClosedForRole(recordAccountingMonth({
    registrationDate: record.registrationDate,
    operationDate,
    rejectedAt: record.rejectedAt,
    validatedAt: record.validatedAt,
  }), auth.user.role)) {
    return NextResponse.json({ error: "Este mes estÃ¡ cerrado. ReÃ¡brelo para editar registros." }, { status: 403 });
  }
  const uploadPlatform = canEditModeOnly
    ? record.uploadPlatform
    : (parsed.data.uploadPlatform as UploadPlatform);
  const notes = canEditModeOnly
    ? record.notes
    : (parsed.data.notes?.trim() || null);

  const updated = await prisma.record.update({
    where: { id: record.id },
    data: {
      type,
      operationDate: type === RecordType.OPERACION ? operationDate : null,
      mode: parsed.data.mode as RecordMode,
      uploadPlatform,
      notes,
      validatedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      validatedById: null,
    },
  });

  await logChange({actorId:auth.user.id,module:'Registros',action:'EDITAR',summary:'Editó registro #'+record.id,targetType:'Record',targetId:record.id,sede:record.historicalSede,before:record,after:updated});
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const record = await getRecord(Number(id));
  if (!record) {
    return NextResponse.json({ error: "Registro no encontrado." }, { status: 404 });
  }

  if (!canDeleteRecord(auth.user, record as VisibleStateRecord)) {
    return NextResponse.json({ error: "No puedes eliminar este registro." }, { status: 403 });
  }
  if (await isMonthClosedForRole(monthFromDate(record.registrationDate), auth.user.role)) {
    return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para eliminar registros." }, { status: 403 });
  }

  await prisma.record.delete({ where: { id: record.id } });
  await logChange({actorId:auth.user.id,module:'Registros',action:'ELIMINAR',summary:'Eliminó registro #'+record.id,targetType:'Record',targetId:record.id,sede:record.historicalSede,before:record});
  return NextResponse.json({ ok: true });
}
