import { readInactiveUserIds } from "@/lib/inactive-users";
import { RecordMode, RecordType, UploadPlatform } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizeSede } from "@/lib/domain";
import { withDbRetry } from "@/lib/db-retry";
import { prisma } from "@/lib/prisma";

const payloadSchema = z.object({
  ticketId: z.number().int().positive(),
  ticketCode: z.string().min(1),
  workerUsername: z.string().min(3),
  workerDni: z.string().trim().min(6).max(16).nullable().optional(),
  clientName: z.string().min(2),
  dni: z.string().min(6),
  kind: z.enum(["REGISTRO", "EFECTIVIZACION", "PAGO_DEUDA"]),
  uploadPlatform: z.enum(["WEB", "DRIVE"]),
  notes: z.string().nullable().optional(),
  operations: z.array(z.object({
    serviceName: z.enum(["Efectivización", "Pago de deuda"]),
    bankName: z.string().trim().min(1).nullable(),
    amount: z.number().positive(),
    rate: z.number().min(0).max(100),
    profit: z.number().min(0),
  })).default([]),
});

export async function GET(request: Request) {
  const secret = process.env.REGISTROS_ATK_SHARED_SECRET;
  if (!secret || request.headers.get("X-Turnos-ATK-Key") !== secret) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    const users = await withDbRetry(() => prisma.user.findMany({
      select: { id: true, name: true, username: true, dni: true, role: true, sede: true },
      orderBy: { name: "asc" },
    }));
    const inactiveIds = await readInactiveUserIds();
    return NextResponse.json({ users: users.filter(user => !inactiveIds.has(user.id)), inactiveUsers: users.filter(user => inactiveIds.has(user.id)).map(user => ({ username: user.username, dni: user.dni })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("No se pudo cargar la lista de asesores de Turnos ATK", error);
    return NextResponse.json({ error: "No se pudo cargar la lista de asesores." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const secret = process.env.REGISTROS_ATK_SHARED_SECRET;
  if (!secret || request.headers.get("X-Turnos-ATK-Key") !== secret) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El contenido enviado no es JSON válido." }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const data = parsed.data;
  const marker = `[turnos-ticket:${data.ticketId}]`;
  try {
    const inactiveIds = await readInactiveUserIds();
    const result = await withDbRetry(() => prisma.$transaction(async (tx) => {
      // Serialize retries of the same Turnos ticket so simultaneous requests
      // cannot both pass the existence check and create a duplicate record.
      // Prisma cannot decode PostgreSQL's `void` return type. Casting the
      // advisory-lock result keeps the lock while returning a supported type.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${String(data.ticketId)}))::text`;
      const existing = await tx.record.findFirst({ where: { notes: { contains: marker } } });
      if (existing) return { record: existing, duplicate: true };

      let worker = data.workerDni
        ? await tx.user.findUnique({ where: { dni: data.workerDni } })
        : await tx.user.findUnique({ where: { username: data.workerUsername } });
      if (!worker && data.workerDni) worker = await tx.user.findUnique({ where: { username: data.workerUsername } });
      if (!worker) throw new Error(`No existe el asesor ${data.workerUsername} en Registros ATK.`);
      if (inactiveIds.has(worker.id)) throw new Error("El asesor está inactivo en Registros ATK.");

      const now = new Date();
      const operationRecords = [];
      let registrationRecord: Awaited<ReturnType<typeof tx.record.create>> | null = null;

      if (data.operations.length > 0) {
        // A ticket with operations is represented by its operation row(s).
        // Do not also create a REGISTRO row for the same client and ticket.
        for (const [index, operation] of data.operations.entries()) {
          const operationNotes = [
            marker,
            `${data.ticketCode} · Operación ${index + 1} de ${data.operations.length}`,
            operation.serviceName,
            operation.bankName ? `Banco: ${operation.bankName}` : null,
            `Monto: S/ ${operation.amount.toFixed(2)}`,
            `Comisión: ${operation.rate}% (S/ ${operation.profit.toFixed(2)})`,
          ].filter(Boolean).join(" · ");
          operationRecords.push(await tx.record.create({
            data: {
              userId: worker.id,
              historicalSede: normalizeSede(worker.sede),
              clientName: data.clientName.trim(),
              dni: data.dni.trim(),
              type: RecordType.OPERACION,
              mode: RecordMode.PRESENCIAL,
              registrationDate: now,
              operationDate: now,
              uploadPlatform: data.uploadPlatform as UploadPlatform,
              notes: operationNotes,
            },
          }));
        }
      } else {
        registrationRecord = await tx.record.create({
          data: {
            userId: worker.id,
            historicalSede: normalizeSede(worker.sede),
            clientName: data.clientName.trim(),
            dni: data.dni.trim(),
            type: RecordType.REGISTRO,
            mode: RecordMode.PRESENCIAL,
            registrationDate: now,
            operationDate: null,
            uploadPlatform: data.uploadPlatform as UploadPlatform,
            notes: `${marker} · ${data.ticketCode}${data.notes ? ` · ${data.notes}` : ""}`,
          },
        });
      }
      return { record: registrationRecord || operationRecords[0] || null, operationRecords, duplicate: false };
    }));
    return NextResponse.json({ ok: true, ...result }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el registro de Turnos ATK.";
    console.error("No se pudo sincronizar un ticket de Turnos ATK", error);
    return NextResponse.json({ error: message }, { status: message.startsWith("No existe el asesor ") ? 422 : 503 });
  }
}
