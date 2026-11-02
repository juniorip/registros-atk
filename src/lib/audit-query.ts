import type { Prisma } from "@prisma/client";

export function auditQuery(params: URLSearchParams) {
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.get("page")) || 1)));
  const limit = Math.max(20, Math.min(100, Math.floor(Number(params.get("limit")) || 40)));
  const group = params.get("group") || "all";
  const and: Prisma.ChangeLogWhereInput[] = [
    // Canonical Admin General account (id 1), distinct from Jhonatan/admin roles.
    { OR: [{ actorId: null }, { actorId: { not: 1 } }] },
    group === "system" ? { actorId: null } : { actorId: { not: null } },
  ];
  const actions: Record<string, string[]> = {
    approved: ["APROBAR", "VALIDAR", "APROBAR_SOLICITUD"],
    rejected: ["RECHAZAR", "RECHAZAR_SOLICITUD"],
    created: ["CREAR", "SOLICITAR_CAMBIO", "IMPORTAR"],
    edited: ["EDITAR", "ACTUALIZAR", "RESTABLECER", "PERFIL_SALARIAL", "FALTA", "QUITAR_FALTA", "PENDIENTE", "CAMBIAR_PAGO", "CAMBIAR_CONTRASENA", "RESTAURAR", "INACTIVAR", "CESE", "REACTIVAR", "CERRAR_MES", "REABRIR_MES", "PAGO MASIVO", "PAGO MASIVO COMISIONES"],
    deleted: ["ELIMINAR", "ELIMINAR_SOLICITUDES"],
  };
  if (group === "attendance") and.push({ module: "Asistencia" });
  if (actions[group]) and.push({ action: { in: actions[group] } });
  const module = (params.get("module") || "").trim();
  if (module) and.push({ module });
  const q = (params.get("q") || "").trim().slice(0, 150);
  if (q) and.push({ OR: [{ summary: { contains: q, mode: "insensitive" } }, { targetId: { contains: q } }, { actor: { is: { OR: [{ name: { contains: q, mode: "insensitive" } }, { username: { contains: q, mode: "insensitive" } }] } } }] });
  for (const [key, bound] of [["from", "gte"], ["to", "lte"]] as const) {
    const day = params.get(key);
    if (!day) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Fecha inválida.");
    const date = new Date(`${day}T${key === "from" ? "00:00:00.000" : "23:59:59.999"}-05:00`);
    const check = new Date(`${day}T12:00:00Z`);
    if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0,10) !== day) throw new Error("Fecha inválida.");
    and.push({ createdAt: { [bound]: date } });
  }
  if (params.get("from") && params.get("to") && params.get("from")! > params.get("to")!) throw new Error("El rango de fechas es inválido.");
  return { page, limit, where: { AND: and } as Prisma.ChangeLogWhereInput };
}

