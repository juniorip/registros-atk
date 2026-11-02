import { logChange } from "@/lib/change-log";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { canManageUser } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  password: z.string().min(6),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const user = await prisma.user.findUnique({ where: { id: Number(id) } });
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
  }

  const visibleUser = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    sede: user.sede,
    forcePasswordReset: user.forcePasswordReset,
    color: user.color,
  };

  if (!canManageUser(auth.user, visibleUser)) {
    return NextResponse.json({ error: "No puedes cambiar esa contraseña." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Contraseña inválida." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hash(parsed.data.password, 10),
      forcePasswordReset: true,
    },
  });

  await logChange({actorId:auth.user.id,module:'Usuarios',action:'CAMBIAR_CONTRASENA',summary:'Cambió contraseña de usuario #'+user.id,targetType:'User',targetId:user.id});
  return NextResponse.json({ ok: true });
}
