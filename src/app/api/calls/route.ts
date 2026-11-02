import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { normalizeSede } from "@/lib/domain";
import { currentMonthKey, isMonthClosedForRole } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

const callSchema = z.object({
  clientDni: z.string().min(6),
  clientName: z.string().min(2),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = callSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos." }, { status: 400 });
  }

  if (await isMonthClosedForRole(currentMonthKey(), auth.user.role)) {
    return NextResponse.json({ error: "Este mes esta cerrado. Reabrelo para agregar llamadas." }, { status: 403 });
  }

  const report = await prisma.callReport.create({
    data: {
      userId: auth.user.id,
      historicalSede: normalizeSede(auth.user.sede),
      clientDni: parsed.data.clientDni.trim(),
      clientName: parsed.data.clientName.trim(),
    },
  });

  await logChange({actorId:auth.user.id,module:"Llamadas",action:'CREAR',summary:'Creó Llamadas #'+report.id,targetType:'CallReport',targetId:report.id,after:report});
  return NextResponse.json({ ok: true, report });
}
