import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { isAdmin } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { auditQuery } from "@/lib/audit-query";
import { sanitizeAuditValue } from "@/lib/change-log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) {
    return NextResponse.json({ error: "Solo el administrador puede ver el historial de cambios." }, { status: 403 });
  }

  try {
  const { page, limit, where } = auditQuery(new URL(request.url).searchParams);
  const [logs, total] = await Promise.all([prisma.changeLog.findMany({
    where,
    include: { actor: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
  }), prisma.changeLog.count({ where })]);
  return NextResponse.json({ logs: logs.map(log => ({ ...log, before: sanitizeAuditValue(log.before), after: sanitizeAuditValue(log.after) })), total, page, limit }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : "No se pudo cargar el historial."},{status:400});
  }
}
