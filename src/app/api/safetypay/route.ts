import { SafetypayBank, SafetypayCode, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { logChange } from "@/lib/change-log";
import { isAdmin, isManager, normalizeSede, resolveHistoricalSede } from "@/lib/domain";
import { currentMonthKey, isMonthClosedForRole, monthFromDate } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

const safetypaySchema = z.object({
  clientDni: z.string().min(6),
  cardLast4: z.string().regex(/^\d{4}$/),
  customerCode: z.string().regex(/^\d{6}$/),
  bank: z.enum(["CMR", "IBK", "IO"]),
  code: z.enum(["ATK1"]),
  amount: z.number().positive(),
  operationNumber: z.string().min(3),
});

const paymentSchema = z.object({
  id: z.number().int().positive(),
  paymentStatus: z.enum(["PENDING", "PAID"]),
});

const editCodeSchema = z.object({
  id: z.number().int().positive(),
  clientDni: z.string().min(6),
  cardLast4: z.string().regex(/^\d{4}$/),
  customerCode: z.string().regex(/^\d{6}$/),
  bank: z.enum(["CMR", "IBK", "IO"]),
  code: z.enum(["ATK1"]),
  amount: z.number().positive(),
  operationNumber: z.string().min(3),
});

async function findEditableSafetypayEntry(id: number, user: NonNullable<Awaited<ReturnType<typeof requireApiUser>>["user"]>) {
  const entry = await prisma.safetypayCodeEntry.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          sede: true,
          forcePasswordReset: true,
          color: true,
        },
      },
    },
  });

  if (!entry) return { entry: null, error: NextResponse.json({ error: "Codigo no encontrado." }, { status: 404 }) };
  if (isAdmin(user)) return { entry, error: null };
  const entrySede = normalizeSede(resolveHistoricalSede(entry.historicalSede, entry.user.sede));
  const canEditOwnSede = isManager(user) && entry.user.role !== UserRole.ADMIN && entrySede === normalizeSede(user.sede);
  if (canEditOwnSede) return { entry, error: null };
  return { entry: null, error: NextResponse.json({ error: "Solo puedes editar codigos de tu propia sede." }, { status: 403 }) };
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = safetypaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos." }, { status: 400 });
  }

  if (await isMonthClosedForRole(currentMonthKey(), auth.user.role)) {
    return NextResponse.json({ error: "Este mes esta cerrado. Reabrelo para agregar codigos." }, { status: 403 });
  }

  const data = parsed.data;
  const entry = await prisma.safetypayCodeEntry.create({
    data: {
      userId: auth.user.id,
      historicalSede: normalizeSede(auth.user.sede),
      clientDni: data.clientDni.trim(),
      cardLast4: data.cardLast4.trim(),
      customerCode: data.customerCode.trim(),
      bank: data.bank as SafetypayBank,
      code: data.code as SafetypayCode,
      amount: data.amount,
      operationNumber: data.operationNumber.trim(),
    },
  });
  await logChange({ actorId: auth.user.id, module: "Safetypay", action: "CREAR", summary: `Creó código ${entry.customerCode} por S/ ${entry.amount.toFixed(2)}.`, targetType: "SafetypayCode", targetId: entry.id, sede: entry.historicalSede, after: entry });

  return NextResponse.json({ ok: true, entry });
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  if (!isAdmin(auth.user)) {
    return NextResponse.json({ error: "Solo el admin puede eliminar codigos Safetypay." }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Codigo invalido." }, { status: 400 });
  }

  const editable = await findEditableSafetypayEntry(id, auth.user);
  if (editable.error) return editable.error;

  const result = await prisma.safetypayCodeEntry.deleteMany({ where: { id } });
  if (result.count) await logChange({ actorId: auth.user.id, module: "Safetypay", action: "ELIMINAR", summary: `Eliminó código ${editable.entry?.customerCode || id}.`, targetType: "SafetypayCode", targetId: id, sede: editable.entry?.historicalSede, before: editable.entry });
  return NextResponse.json({ ok: true, deleted: result.count });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const body = await request.json();
  const paymentParsed = paymentSchema.safeParse(body);
  const codeParsed = editCodeSchema.safeParse(body);
  if (!paymentParsed.success && !codeParsed.success) {
    return NextResponse.json({ error: "Datos invalidos." }, { status: 400 });
  }

  const editableId = paymentParsed.success
    ? paymentParsed.data.id
    : codeParsed.success
      ? codeParsed.data.id
      : 0;
  const editable = await findEditableSafetypayEntry(editableId, auth.user);
  if (editable.error) return editable.error;

  if (paymentParsed.success && !isAdmin(auth.user)) {
    return NextResponse.json({ error: "Solo el administrador puede cambiar el estado de pago." }, { status: 403 });
  }

  if (await isMonthClosedForRole(monthFromDate(editable.entry?.createdAt) || currentMonthKey(), auth.user.role)) {
    return NextResponse.json({ error: "Este mes esta cerrado. Reabrelo para editar codigos." }, { status: 403 });
  }

  if (codeParsed.success) {
    const data = codeParsed.data;
    const entry = await prisma.safetypayCodeEntry.update({
      where: { id: data.id },
      data: {
        clientDni: data.clientDni.trim(),
        cardLast4: data.cardLast4.trim(),
        customerCode: data.customerCode.trim(),
        bank: data.bank as SafetypayBank,
        code: data.code as SafetypayCode,
        amount: data.amount,
        operationNumber: data.operationNumber.trim(),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            role: true,
            sede: true,
            forcePasswordReset: true,
            color: true,
          },
        },
      },
    });
    await logChange({ actorId: auth.user.id, module: "Safetypay", action: "EDITAR", summary: `Editó código ${entry.customerCode}.`, targetType: "SafetypayCode", targetId: entry.id, sede: entry.historicalSede, before: editable.entry, after: entry });

    return NextResponse.json({ ok: true, entry });
  }

  if (!paymentParsed.success) {
    return NextResponse.json({ error: "Datos invalidos." }, { status: 400 });
  }

  const entry = await prisma.safetypayCodeEntry.update({
    where: { id: paymentParsed.data.id },
    data: {
      paymentStatus: paymentParsed.data.paymentStatus,
      paidAt: paymentParsed.data.paymentStatus === "PAID" ? new Date() : null,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          sede: true,
          forcePasswordReset: true,
          color: true,
        },
      },
    },
  });
  await logChange({ actorId: auth.user.id, module: "Safetypay", action: "CAMBIAR_PAGO", summary: `Marcó código ${entry.customerCode} como ${entry.paymentStatus === "PAID" ? "pagado" : "pendiente"}.`, targetType: "SafetypayCode", targetId: entry.id, sede: entry.historicalSede, before: editable.entry, after: entry });

  return NextResponse.json({ ok: true, entry });
}
