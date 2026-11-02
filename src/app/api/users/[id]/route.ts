import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { logChange } from "@/lib/change-log";
import { readAttendanceData } from "@/lib/attendance";
import { canManageUser, canManageUserRole, normalizeSede } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  name: z.string().min(2),
  dni: z.string().trim().min(1).max(16).nullable().optional(),
  username: z.string().min(3).optional(),
  role: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]).optional(),
  sede: z.string().min(2).optional(),
  transferEffectiveDate: z.string().optional(),
  previousSede: z.string().optional(),
});

function dateBoundary(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000-05:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizedIdentity(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export async function PATCH(
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
    return NextResponse.json({ error: "No puedes editar este usuario." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const role = parsed.data.role ? (parsed.data.role as UserRole) : user.role;
  if (!canManageUserRole(auth.user, role)) {
    return NextResponse.json({ error: "No puedes asignar ese rol." }, { status: 403 });
  }

  const previousSede = normalizeSede(user.sede);
  const nextSede = normalizeSede(parsed.data.sede || user.sede);
  const previousSedeForHistory = normalizeSede(parsed.data.previousSede || previousSede);
  const effectiveDate = dateBoundary(parsed.data.transferEffectiveDate);
  const nextUsername = parsed.data.username?.trim() || user.username;
  if (nextUsername !== user.username) {
    const existing = await prisma.user.findUnique({ where: { username: nextUsername } });
    if (existing && existing.id !== user.id) {
      return NextResponse.json({ error: "Ese usuario ya existe." }, { status: 400 });
    }
  }
  if (parsed.data.dni && parsed.data.dni !== user.dni) {
    const existingDni = await prisma.user.findUnique({ where: { dni: parsed.data.dni } });
    if (existingDni && existingDni.id !== user.id) {
      return NextResponse.json({ error: "Ese DNI ya está vinculado a otro usuario." }, { status: 400 });
    }
  }

  await prisma.$transaction(async (tx) => {
    if (previousSedeForHistory !== nextSede) {
      if (effectiveDate) {
        await Promise.all([
          tx.record.updateMany({
            where: {
              userId: user.id,
              historicalSede: null,
              OR: [
                { operationDate: { lt: effectiveDate } },
                { operationDate: null, registrationDate: { lt: effectiveDate } },
              ],
            },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.record.updateMany({
            where: {
              userId: user.id,
              AND: [
                {
                  OR: [
                    { operationDate: { gte: effectiveDate } },
                    { operationDate: null, registrationDate: { gte: effectiveDate } },
                  ],
                },
                { OR: [{ historicalSede: null }, { historicalSede: previousSedeForHistory }] },
              ],
            },
            data: { historicalSede: nextSede },
          }),
          tx.referral.updateMany({
            where: { userId: user.id, historicalSede: null, createdAt: { lt: effectiveDate } },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.referral.updateMany({
            where: {
              userId: user.id,
              createdAt: { gte: effectiveDate },
              OR: [{ historicalSede: null }, { historicalSede: previousSedeForHistory }],
            },
            data: { historicalSede: nextSede },
          }),
          tx.wrongCardReport.updateMany({
            where: { userId: user.id, historicalSede: null, detectedDate: { lt: effectiveDate } },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.wrongCardReport.updateMany({
            where: {
              userId: user.id,
              detectedDate: { gte: effectiveDate },
              OR: [{ historicalSede: null }, { historicalSede: previousSedeForHistory }],
            },
            data: { historicalSede: nextSede },
          }),
          tx.callReport.updateMany({
            where: { userId: user.id, historicalSede: null, createdAt: { lt: effectiveDate } },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.callReport.updateMany({
            where: {
              userId: user.id,
              createdAt: { gte: effectiveDate },
              OR: [{ historicalSede: null }, { historicalSede: previousSedeForHistory }],
            },
            data: { historicalSede: nextSede },
          }),
          tx.safetypayCodeEntry.updateMany({
            where: { userId: user.id, historicalSede: null, createdAt: { lt: effectiveDate } },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.safetypayCodeEntry.updateMany({
            where: {
              userId: user.id,
              createdAt: { gte: effectiveDate },
              OR: [{ historicalSede: null }, { historicalSede: previousSedeForHistory }],
            },
            data: { historicalSede: nextSede },
          }),
          tx.commercialCardEntry.updateMany({
            where: { userId: user.id, historicalSede: null, operationDate: { lt: effectiveDate } },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.commercialCardEntry.updateMany({
            where: {
              userId: user.id,
              operationDate: { gte: effectiveDate },
              OR: [{ historicalSede: null }, { historicalSede: previousSedeForHistory }],
            },
            data: { historicalSede: nextSede },
          }),
          tx.ratingApproval.updateMany({
            where: { matchedUserId: user.id, createdAt: { lt: effectiveDate } },
            data: { sede: previousSedeForHistory },
          }),
          tx.ratingApproval.updateMany({
            where: { matchedUserId: user.id, createdAt: { gte: effectiveDate } },
            data: { sede: nextSede },
          }),
        ]);
      } else {
        await Promise.all([
          tx.record.updateMany({
            where: { userId: user.id, historicalSede: null },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.referral.updateMany({
            where: { userId: user.id, historicalSede: null },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.wrongCardReport.updateMany({
            where: { userId: user.id, historicalSede: null },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.callReport.updateMany({
            where: { userId: user.id, historicalSede: null },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.safetypayCodeEntry.updateMany({
            where: { userId: user.id, historicalSede: null },
            data: { historicalSede: previousSedeForHistory },
          }),
          tx.commercialCardEntry.updateMany({
            where: { userId: user.id, historicalSede: null },
            data: { historicalSede: previousSedeForHistory },
          }),
        ]);
      }
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        name: parsed.data.name.trim(),
        dni: parsed.data.dni === undefined ? user.dni : parsed.data.dni,
        username: nextUsername,
        role,
        sede: nextSede,
      },
    });
  });

  await logChange({ actorId: auth.user.id, module: "Usuarios", action: "EDITAR", summary: previousSede !== nextSede ? `Trasladó a ${user.name} de ${previousSede} a ${nextSede}${parsed.data.transferEffectiveDate ? ` desde ${parsed.data.transferEffectiveDate}` : ""}.` : `Editó el usuario ${user.name}.`, targetType: "User", targetId: user.id, sede: nextSede, before: { name:user.name, username:user.username, role:user.role, sede:previousSede }, after: { name:parsed.data.name.trim(), username:nextUsername, role, sede:nextSede } });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
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
    return NextResponse.json({ error: "No puedes eliminar este usuario." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const personId = String(body?.personId ?? "").trim();
  if (!personId) {
    return NextResponse.json({ error: "Solo se pueden eliminar usuarios vinculados a colaboradores inactivos." }, { status: 400 });
  }

  const attendance = await readAttendanceData();
  const person = attendance.people.find((item) => item.personId === personId);
  const extraBonuses = person?.extraBonuses && typeof person.extraBonuses === "object"
    ? person.extraBonuses as Record<string, unknown>
    : {};
  if (!person || !extraBonuses.__inactive) {
    return NextResponse.json({ error: "El usuario solo puede eliminarse cuando su colaborador está inactivo." }, { status: 400 });
  }

  const manualLinkId = Number(extraBonuses.__linkedUserId || 0);
  const personName = normalizedIdentity(person.personName);
  const personCode = normalizedIdentity(person.personId);
  const isLinked =
    manualLinkId === user.id ||
    normalizedIdentity(user.name) === personName ||
    normalizedIdentity(user.username) === personName ||
    normalizedIdentity(user.username) === personCode;
  if (!isLinked) {
    return NextResponse.json({ error: "Este usuario no está vinculado al colaborador inactivo indicado." }, { status: 400 });
  }

  // No se borra una cuenta que ya dejó historial: eliminarla haría perder o
  // desasociaría información de operación. Solo se permite limpiar cuentas sin uso.
  const [records, referrals, wrongCards, calls, safetypayCodes, commercialCards, ratingApprovals, attendanceRequests, penaltyReports] = await Promise.all([
    prisma.record.count({ where: { OR: [{ userId: user.id }, { validatedById: user.id }] } }),
    prisma.referral.count({ where: { OR: [{ userId: user.id }, { validatedById: user.id }] } }),
    prisma.wrongCardReport.count({ where: { OR: [{ userId: user.id }, { validatedById: user.id }] } }),
    prisma.callReport.count({ where: { OR: [{ userId: user.id }, { validatedById: user.id }] } }),
    prisma.safetypayCodeEntry.count({ where: { userId: user.id } }),
    prisma.commercialCardEntry.count({ where: { userId: user.id } }),
    prisma.ratingApproval.count({ where: { OR: [{ matchedUserId: user.id }, { decidedById: user.id }] } }),
    prisma.attendanceChangeRequest.count({ where: { OR: [{ requestedById: user.id }, { decidedById: user.id }] } }),
    prisma.penaltyReport.count({ where: { OR: [{ workerUserId: user.id }, { sentById: user.id }, { receiverId: user.id }, { decidedById: user.id }] } }),
  ]);
  if (records + referrals + wrongCards + calls + safetypayCodes + commercialCards + ratingApprovals + attendanceRequests + penaltyReports > 0) {
    return NextResponse.json({ error: "No se puede eliminar esta cuenta porque tiene historial. El colaborador ya está inactivo y su historial se conserva." }, { status: 400 });
  }

  await prisma.user.delete({ where: { id: user.id } });
  await logChange({ actorId: auth.user.id, module: "Usuarios", action: "ELIMINAR", summary: `Eliminó el usuario inactivo ${user.name}.`, targetType: "User", targetId: user.id, sede: user.sede, before: { name:user.name, username:user.username, role:user.role, sede:user.sede } });
  return NextResponse.json({ ok: true });
}
