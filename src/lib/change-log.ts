import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type ChangeLogInput = {
  actorId?: number | null;
  module: string;
  action: string;
  summary: string;
  targetType?: string;
  targetId?: string | number | null;
  sede?: string | null;
  before?: unknown;
  after?: unknown;
};

export function sanitizeAuditValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key])=>!/password|secret|token|cookie|authorization|evidenceImage/i.test(key)).map(([key,item])=>[key,sanitizeAuditValue(item)]));
  return value;
}
function jsonValue(value: unknown) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(sanitizeAuditValue(value))) as Prisma.InputJsonValue;
}

// Audit logging must never make a valid operational action fail. If the log
// store is temporarily unavailable, the business action has already succeeded.
export async function logChange(input: ChangeLogInput) {
  try {
    await prisma.changeLog.create({
      data: {
        actorId: input.actorId ?? null,
        module: input.module,
        action: input.action,
        summary: input.summary,
        targetType: input.targetType || null,
        targetId: input.targetId == null ? null : String(input.targetId),
        sede: input.sede || null,
        ...(input.before === undefined ? {} : { before: jsonValue(input.before) }),
        ...(input.after === undefined ? {} : { after: jsonValue(input.after) }),
      },
    });
  } catch (error) {
    console.error("No se pudo registrar el historial de cambios", error);
  }
}
