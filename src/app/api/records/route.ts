import { RecordMode, RecordType, UploadPlatform, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { logChange } from "@/lib/change-log";
import { normalizeSede } from "@/lib/domain";
import { isMonthClosedForRole, monthFromDate } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";
import { withDbRetry } from "@/lib/db-retry";

const recordSchema = z.object({
  clientName: z.string().min(2),
  dni: z.string().min(6),
  registrationDate: z.string(),
  operationDate: z.string().optional().nullable(),
  type: z.enum(["REGISTRO", "OPERACION"]),
  mode: z.enum(["VIRTUAL", "PRESENCIAL"]),
  uploadPlatform: z.enum(["WEB", "DRIVE"]),
  notes: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El contenido enviado no es JSON válido." }, { status: 400 });
  }
  const parsed = recordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const data = parsed.data;
  if (Number.isNaN(new Date(data.registrationDate).getTime()) || (data.operationDate && Number.isNaN(new Date(data.operationDate).getTime()))) {
    return NextResponse.json({ error: "La fecha del registro no es válida." }, { status: 400 });
  }
  if (await isMonthClosedForRole(monthFromDate(data.registrationDate), auth.user.role)) {
    return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para agregar registros." }, { status: 403 });
  }
  const operationDate = data.operationDate ? new Date(data.operationDate) : null;
  const type = operationDate ? RecordType.OPERACION : (data.type as RecordType);

  let record;
  try {
    record = await withDbRetry(() => prisma.record.create({
      data: {
        userId: auth.user.id,
        historicalSede: normalizeSede(auth.user.sede),
        clientName: data.clientName.trim(),
        dni: data.dni.trim(),
        registrationDate: new Date(data.registrationDate),
        operationDate: type === RecordType.OPERACION ? operationDate : null,
        type,
        mode: data.mode as RecordMode,
        uploadPlatform: data.uploadPlatform as UploadPlatform,
        notes: data.notes?.trim() || null,
      },
    }));
  } catch (error) {
    console.error("No se pudo guardar el registro", error);
    return NextResponse.json({ error: "No se pudo guardar el registro. Intenta nuevamente." }, { status: 503 });
  }
  await logChange({ actorId: auth.user.id, module: "Registros", action: "CREAR", summary: `Creó registro para ${record.clientName} (${record.dni}).`, targetType: "Record", targetId: record.id, sede: record.historicalSede, after: record });

  return NextResponse.json({ ok: true, record });
}
