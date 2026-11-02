import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { readInactiveUserIds } from "@/lib/inactive-users";
import { withDbRetry } from "@/lib/db-retry";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const secret = process.env.REGISTROS_ATK_SHARED_SECRET;
  if (!secret || request.headers.get("X-Turnos-ATK-Key") !== secret) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  let code = "";
  try {
    code = String((await request.json()).code || "");
  } catch {
    return NextResponse.json({ error: "Código inválido." }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(code)) {
    return NextResponse.json({ error: "Código inválido o vencido." }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(code).digest("hex");
  try {
    const now = new Date();
    const result = await withDbRetry(() => prisma.$transaction(async (tx) => {
      const consumed = await tx.turnosPortalGrant.updateMany({
        where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      const grant = await tx.turnosPortalGrant.findUnique({ where: { tokenHash }, include: { user: true } });
      return grant?.user || null;
    }));
    if (!result) return NextResponse.json({ error: "El acceso venció o ya fue utilizado. Inicia sesión otra vez." }, { status: 401 });
    const inactiveIds = await readInactiveUserIds();
    if (inactiveIds.has(result.id)) return NextResponse.json({ error: "La cuenta está inactiva." }, { status: 403 });

    return NextResponse.json({
      user: {
        name: result.name,
        username: result.username,
        dni: result.dni,
        role: result.role,
        sede: result.sede,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("No se pudo validar el acceso unificado de Turnos", error);
    return NextResponse.json({ error: "No se pudo validar el acceso. Intenta nuevamente." }, { status: 503 });
  }
}
