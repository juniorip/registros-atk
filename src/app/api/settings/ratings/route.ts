import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { isAdmin, isManager } from "@/lib/domain";
import { updateRatingSettings } from "@/lib/ratings";

const schema = z.object({
  requiredFields: z.array(z.enum(["dni", "comment", "advisor"])),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user) && !isManager(auth.user)) {
    return NextResponse.json({ error: "Solo admin o jefe de sede puede cambiar la configuracion de calificaciones." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Configuracion invalida." }, { status: 400 });
  }

  const settings = await updateRatingSettings(parsed.data.requiredFields);
  await logChange({actorId:auth.user.id,module:'Configuración',action:'EDITAR',summary:'Actualizó configuración: ratings',targetType:'Settings',targetId:'ratings',after:parsed.data});
  return NextResponse.json({ ok: true, settings });
}
