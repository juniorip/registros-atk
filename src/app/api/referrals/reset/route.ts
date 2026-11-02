import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { isAdmin } from "@/lib/domain";
import { currentReferralMonth, referralResetPreview, resetReferralMonth } from "@/lib/referral-reset";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Solo administración puede restablecer referidos." }, { status: 403 });
  const { rows: _rows, ...preview } = await referralResetPreview(currentReferralMonth());
  return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Solo administración puede restablecer referidos." }, { status: 403 });
  const parsed = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), revision: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal("RESET_CURRENT_MONTH") }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.month !== currentReferralMonth()) return NextResponse.json({ error: "Solo se pueden restablecer los referidos del mes actual." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, month: parsed.data.month, ...await resetReferralMonth(parsed.data.month, parsed.data.revision, auth.user.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron restablecer los referidos." }, { status: 409 });
  }
}
