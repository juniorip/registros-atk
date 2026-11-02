import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/domain";
import { logChange } from "@/lib/change-log";

const dni = z.string().trim().min(1).max(16);
const groupSchema = z.object({ name: z.string().trim().min(2).max(80), chiefDni: dni.nullable(), memberDnis: z.array(dni).max(100) });

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  const groups = await prisma.workGroup.findMany({ include: { members: { orderBy: { dni: "asc" } } }, orderBy: { name: "asc" } });
  return NextResponse.json({ groups });
}

export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Solo administración puede editar grupos." }, { status: 403 });
  const parsed = z.object({ groups: z.array(groupSchema).min(1).max(30) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Datos de grupos inválidos." }, { status: 400 });
  const seen = new Set<string>();
  for (const group of parsed.data.groups) for (const memberDni of group.memberDnis) {
    if (seen.has(memberDni)) return NextResponse.json({ error: `El DNI ${memberDni} aparece en más de un grupo.` }, { status: 400 });
    seen.add(memberDni);
  }
  await prisma.$transaction(async (tx) => {
    await tx.workGroupMember.deleteMany();
    await tx.workGroup.deleteMany();
    for (const group of parsed.data.groups) {
      await tx.workGroup.create({ data: { name: group.name, chiefDni: group.chiefDni || null, members: { create: Array.from(new Set(group.memberDnis)).map((memberDni) => ({ dni: memberDni })) } } });
    }
  });
  await logChange({ actorId: auth.user.id, module: "Grupos", action: "ACTUALIZAR", summary: `Actualizó ${parsed.data.groups.length} grupo(s) por DNI.`, targetType: "WorkGroup" });
  return NextResponse.json({ ok: true });
}
