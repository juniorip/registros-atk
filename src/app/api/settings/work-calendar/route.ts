import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { isAdmin } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { readWorkCalendar } from "@/lib/work-calendar";
import { calendarRulesConflict, type WorkCalendarRule } from "@/lib/work-calendar-rules";

export const dynamic = "force-dynamic";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ruleSchema = z.object({
  id: z.string().uuid().optional(), date, reason: z.string().trim().min(3).max(200),
  scope: z.enum(["ALL", "SEDE", "PEOPLE"]), sede: z.enum(["", "Lince", "Sur", "Norte", "Miraflores"]).default(""),
  personIds: z.array(z.string().trim().min(1).max(50)).max(300).default([]),
  kind: z.enum(["PAID_REST", "UNPAID_REST", "SPECIAL_SHIFT"]),
  entry: z.union([time, z.literal("")]).default(""), exit: z.union([time, z.literal("")]).default(""),
  breakMinutes: z.number().int().min(0).max(240).default(0), additionalPercent: z.number().min(0).max(300).default(0),
}).superRefine((rule, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Date(rule.date + "T12:00:00Z").getUTCDay() === 0) issue("Elige un día laboral de lunes a sábado.");
  if (rule.scope === "SEDE" && !rule.sede) issue("Selecciona una sede.");
  if (rule.scope === "PEOPLE" && !rule.personIds.length) issue("Selecciona al menos un colaborador.");
  if (rule.kind === "SPECIAL_SHIFT") {
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    if (!rule.entry || !rule.exit || minutes(rule.exit) - minutes(rule.entry) <= rule.breakMinutes) issue("La salida debe ser posterior a la entrada y al refrigerio.");
  }
});
const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return response({ error: "Solo administración puede gestionar el calendario laboral." }, 403);
  return response({ rules: await readWorkCalendar() });
}

async function mutate(request: Request, remove: boolean) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return response({ error: "Solo administración puede gestionar el calendario laboral." }, 403);
  const body = await request.json().catch(() => null);
  const parsed = remove ? z.object({ id: z.string().uuid() }).safeParse(body) : ruleSchema.safeParse(body);
  if (!parsed.success) return response({ error: parsed.error.issues[0]?.message || "Configuración inválida." }, 400);
  const id = parsed.data.id || randomUUID();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await prisma.$transaction(async tx => {
          const rules = await readWorkCalendar(tx);
          const previous = rules.find(rule => rule.id === id);
          if ((remove || parsed.data.id) && !previous) throw new Error("La excepción ya no existe. Actualiza el calendario.");
          const next = remove ? null : { ...parsed.data, id } as WorkCalendarRule;
          const months = [...new Set([previous?.date, next?.date].filter(Boolean).map(value => value!.slice(0, 7)))];
          const closed = await tx.monthlyClosure.findFirst({ where: { month: { in: months }, status: "CLOSED" }, select: { month: true } });
          if (closed) throw new Error(`El mes ${closed.month} está cerrado. Reábrelo antes de modificar su calendario.`);
          if (next?.scope === "PEOPLE") {
            const people = await tx.attendanceProfile.findMany({ where: { personId: { in: next.personIds } }, select: { personId: true } });
            if (people.length !== new Set(next.personIds).size) throw new Error("Hay colaboradores que no existen en asistencia.");
          }
          if (next && rules.some(rule => calendarRulesConflict(rule, next))) throw new Error("Ya hay una excepción para esa fecha y alcance. Edita la existente.");
          if (next) {
            next.personIds = next.scope === "PEOPLE" ? [...new Set(next.personIds)] : [];
            next.sede = next.scope === "SEDE" ? next.sede : "";
            if (next.kind !== "SPECIAL_SHIFT") { next.entry = ""; next.exit = ""; next.breakMinutes = 0; }
            else next.additionalPercent = 0;
          }
          await tx.changeLog.create({ data: {
            actorId: auth.user.id, module: "Calendario laboral", targetType: "WorkCalendar", targetId: id,
            action: remove ? "ELIMINAR" : previous ? "ACTUALIZAR" : "CREAR",
            summary: `${remove ? "Retiró" : previous ? "Actualizó" : "Registró"} excepción ${next?.date || previous?.date}: ${next?.reason || previous?.reason}.`,
            sede: next?.sede || previous?.sede || null,
            ...(previous ? { before: previous as unknown as Prisma.InputJsonValue } : {}),
            ...(next ? { after: next as unknown as Prisma.InputJsonValue } : {}),
          } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return response({ ok: true, rules: await readWorkCalendar() });
      } catch (error) {
        if (attempt < 2 && error && typeof error === "object" && "code" in error && error.code === "P2034") continue;
        throw error;
      }
    }
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "No se pudo guardar el calendario." }, 400);
  }
}
export async function POST(request: Request) { return mutate(request, false); }
export async function DELETE(request: Request) { return mutate(request, true); }
