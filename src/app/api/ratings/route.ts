import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { withDbRetry } from "@/lib/db-retry";
import { buildRatingsResponse, updateRatingEntry } from "@/lib/ratings";

export const maxDuration = 30;

const editSchema = z.object({
  rowKey: z.string().min(10),
  advisor: z.string().min(2),
  dni: z.string().min(0),
  comment: z.string().optional(),
});

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month")?.trim() || null;
    const from = searchParams.get("from")?.trim() || null;
    const to = searchParams.get("to")?.trim() || null;
    const payload = await withDbRetry(() => buildRatingsResponse(auth.user, { month, from, to }));
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo cargar calificaciones." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El contenido enviado no es JSON válido." }, { status: 400 });
  }
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos invalidos." }, { status: 400 });
  }

  try {
    const result = await withDbRetry(() => updateRatingEntry(auth.user, parsed.data));
    return NextResponse.json({ ok: true, approval: result.approval });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo editar la calificacion." },
      { status: 400 },
    );
  }
}
