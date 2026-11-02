import { hash } from "bcryptjs";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { logChange } from "@/lib/change-log";
import { canManageUserRole, canManageUsers, normalizeSede } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

const userSchema = z.object({
  name: z.string().min(2),
  username: z.string().min(3),
  password: z.string().min(6),
  dni: z.string().trim().min(1).max(16).optional(),
  role: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]),
  sede: z.string().min(2),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  if (!canManageUsers(auth.user)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = userSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos para el usuario." }, { status: 400 });
  }

  const role = parsed.data.role as UserRole;
  if (!canManageUserRole(auth.user, role)) {
    return NextResponse.json({ error: "No puedes crear ese rol." }, { status: 403 });
  }

  // Una jefa solo puede incorporar personal de atención a su propia sede.
  // La sede enviada por el navegador nunca debe ampliar ese permiso.
  const sede = auth.user.role === UserRole.MANAGER
    ? normalizeSede(auth.user.sede)
    : normalizeSede(parsed.data.sede);

  const existing = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (existing) {
    return NextResponse.json({ error: "Ese usuario ya existe." }, { status: 400 });
  }
  if (parsed.data.dni) {
    const existingDni = await prisma.user.findUnique({ where: { dni: parsed.data.dni } });
    if (existingDni) return NextResponse.json({ error: "Ese DNI ya está vinculado a otro usuario." }, { status: 400 });
  }

  const passwordHash = await hash(parsed.data.password, 10);

  const user = await prisma.user.create({
    data: {
      name: parsed.data.name.trim(),
      username: parsed.data.username.trim(),
      passwordHash,
      dni: parsed.data.dni || null,
      role,
      sede,
      forcePasswordReset: true,
      color: "#22c97a",
    },
  });
  await logChange({ actorId: auth.user.id, module: "Usuarios", action: "CREAR", summary: `Creó el usuario ${user.name} (@${user.username}).`, targetType: "User", targetId: user.id, sede: user.sede, after: { id:user.id, name:user.name, username:user.username, role:user.role, sede:user.sede } });

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      sede: user.sede,
      forcePasswordReset: user.forcePasswordReset,
      color: user.color,
      dni: user.dni,
    },
  });
}
