import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/current-user";
import { isAdmin } from "@/lib/domain";
import { closeMonthlySnapshot, listMonthlyClosures, reopenMonthlyClosure } from "@/lib/monthly-closure";

export const dynamic = "force-dynamic";

export async function GET() {
  const currentUser = await requireCurrentUser();
  if (!isAdmin(currentUser)) {
    return NextResponse.json({ error: "Solo el admin puede ver cierres mensuales." }, { status: 403 });
  }

  const closures = await listMonthlyClosures();
  return NextResponse.json(
    { closures },
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    },
  );
}

export async function POST(request: Request) {
  const currentUser = await requireCurrentUser();
  if (!isAdmin(currentUser)) {
    return NextResponse.json({ error: "Solo el admin puede gestionar cierres mensuales." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: string;
        month?: string;
        summary?: unknown;
        details?: unknown;
        pending?: unknown;
        reason?: string;
      }
    | null;

  try {
    if (body?.action === "close") {
      if (!body.month) return NextResponse.json({ error: "Mes invalido." }, { status: 400 });
      const pending = body.pending && typeof body.pending === "object" ? (body.pending as Record<string, unknown>) : {};
      if (Number(pending.unpaidSalaries || 0) > 0) {
        return NextResponse.json({ error: "Primero debes pagar todos los sueldos." }, { status: 400 });
      }
      if (Number(pending.unpaidCommissions || 0) > 0) {
        return NextResponse.json({ error: "Primero debes pagar todas las comisiones." }, { status: 400 });
      }
      await closeMonthlySnapshot({
        month: body.month,
        summary: body.summary || {},
        details: body.details || [],
        pending: body.pending || {},
        closedById: currentUser.id,
      });
    } else if (body?.action === "reopen") {
      if (!body.month) return NextResponse.json({ error: "Mes invalido." }, { status: 400 });
      await reopenMonthlyClosure({
        month: body.month,
        reopenedById: currentUser.id,
        reason: body.reason || "",
      });
    } else if (body?.action === "prepare-next" || body?.action === "archive-clean") {
      return NextResponse.json(
        { error: "Esta accion esta desactivada. Los meses cerrados quedan guardados sin borrar datos." },
        { status: 400 },
      );
    } else {
      return NextResponse.json({ error: "Accion invalida." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar el cierre." },
      { status: 400 },
    );
  }

  await logChange({actorId:currentUser.id,module:'Cierres mensuales',action:body?.action==='close'?'CERRAR_MES':'REABRIR_MES',summary:(body?.action==='close'?'Cerró':'Reabrió')+' el mes '+body?.month,targetType:'MonthlyClosure',targetId:body?.month,after:{month:body?.month,action:body?.action,reason:body?.reason}});
  const closures = await listMonthlyClosures();
  return NextResponse.json(
    { closures },
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    },
  );
}
