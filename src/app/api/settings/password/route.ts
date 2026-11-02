import { logChange } from "@/lib/change-log";
import { compare, hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  currentPassword: z.string().optional().default(""),
  newPassword: z.string().min(6),
  repeatPassword: z.string().min(6),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  if (parsed.data.newPassword !== parsed.data.repeatPassword) {
    return NextResponse.json(
      { error: "Las nuevas contraseñas no coinciden." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
  }

  if (!user.forcePasswordReset) {
    const valid = await compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "La contraseña actual no coincide." },
        { status: 400 },
      );
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hash(parsed.data.newPassword, 10),
      forcePasswordReset: false,
    },
  });

  await logChange({actorId:auth.user.id,module:'Usuarios',action:'CAMBIAR_CONTRASENA',summary:'Cambió contraseña de usuario #'+user.id,targetType:'User',targetId:user.id});
  return NextResponse.json({ ok: true });
}
