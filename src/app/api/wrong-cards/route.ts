import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { normalizeSede } from "@/lib/domain";
import { currentMonthKey, isMonthClosedForRole } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

const wrongCardSchema = z.object({
  clientDni: z.string().min(6),
  clientName: z.string().min(2),
  detectedDate: z.string().min(10),
  notes: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = wrongCardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  if (await isMonthClosedForRole(currentMonthKey(), auth.user.role)) {
    return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para agregar tarjetas." }, { status: 403 });
  }

  const detectedDate = new Date(`${parsed.data.detectedDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(detectedDate.getTime())) {
    return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  }

  const report = await prisma.wrongCardReport.create({
    data: {
      userId: auth.user.id,
      historicalSede: normalizeSede(auth.user.sede),
      clientDni: parsed.data.clientDni.trim(),
      clientName: parsed.data.clientName.trim(),
      detectedDate,
      notes: parsed.data.notes?.trim() || null,
    },
  });

  await logChange({actorId:auth.user.id,module:"Tarjetas erróneas",action:'CREAR',summary:'Creó Tarjetas erróneas #'+report.id,targetType:'WrongCardReport',targetId:report.id,after:report});
  return NextResponse.json({ ok: true, report });
}
