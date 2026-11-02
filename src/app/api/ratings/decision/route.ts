import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { decideRating } from "@/lib/ratings";

const schema = z.object({
  rowKey: z.string().min(10),
  action: z.enum(["approve", "reject", "pending"]),
  reason: z.string().optional(),
});

export async function POST(request: Request) {
  const started = performance.now();
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  const authMs = performance.now() - started;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El contenido enviado no es JSON válido." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos." }, { status: 400 });
  }

  try {
    const decidingAt = performance.now();
    const payload = await decideRating(auth.user, parsed.data);
    const decisionMs = performance.now() - decidingAt;
    console.info("rating_decision_timing", JSON.stringify({ action: parsed.data.action, authMs: Math.round(authMs), decisionMs: Math.round(decisionMs), totalMs: Math.round(performance.now() - started) }));
    return NextResponse.json({ ok: true, ...payload }, {
      headers: { "Cache-Control": "no-store", "Server-Timing": `auth;dur=${authMs.toFixed(1)}, decision;dur=${decisionMs.toFixed(1)}` },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo decidir la calificacion." },
      { status: 400 },
    );
  }
}
