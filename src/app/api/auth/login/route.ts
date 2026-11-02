import { compare } from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { createSession } from "@/lib/auth";
import { withDbRetry } from "@/lib/db-retry";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = await request.json();
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!username || !password) {
    return NextResponse.json(
      { error: "Usuario y contraseña son obligatorios." },
      { status: 400 },
    );
  }

  const user = await withDbRetry(async () =>
    (await prisma.user.findUnique({ where: { username } })) ||
    (await prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    })),
  );

  if (!user) {
    return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
  }

  const valid = await compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
  }

  const sessionToken = await createSession(user.id);
  const portalGrant = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(portalGrant).digest("hex");
  await withDbRetry(() => prisma.turnosPortalGrant.create({
    data: { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + 2 * 60 * 1000) },
  }));

  // Keep authentication lightweight. The browser loads the full state only
  // after the user chooses which application to open.
  return NextResponse.json({
    currentUser: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      sede: user.sede,
      forcePasswordReset: user.forcePasswordReset,
      color: user.color,
    },
    sessionToken,
    portalGrant,
    turnosUrl: process.env.NEXT_PUBLIC_TURNOS_ATK_URL || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://turnos-atk.vercel.app"),
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
