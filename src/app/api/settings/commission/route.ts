import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { isAdmin } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  commissionPerRecord: z.coerce.number().min(0),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) {
    return NextResponse.json({ error: "Solo el admin puede cambiar la comisión." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Monto inválido." }, { status: 400 });
  }

  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: { commissionPerRecord: parsed.data.commissionPerRecord },
    create: { id: 1, commissionPerRecord: parsed.data.commissionPerRecord },
  });

  await logChange({actorId:auth.user.id,module:'Configuración',action:'EDITAR',summary:'Actualizó configuración: commission',targetType:'Settings',targetId:'commission',after:parsed.data});
  return NextResponse.json({ ok: true });
}
