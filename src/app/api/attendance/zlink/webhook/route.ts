import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { isAdmin } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { importZlinkPunches } from "@/lib/attendance";
import { decryptZlinkData, parseZlinkWebhook, verifyZlinkSignature } from "@/lib/zlink-webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function config() {
  const appKey = process.env.ZLINK_APP_KEY || "";
  const iv = process.env.ZLINK_WEBHOOK_ENCRYPTION_KEY || "";
  const token = process.env.ZLINK_WEBHOOK_SIGNATURE_TOKEN || "";
  return { appKey, iv, token, ready: Buffer.byteLength(appKey) === 16 && iv.length === 16 && token.length >= 16 };
}

const success = (data: unknown = "success") => NextResponse.json({ code: "ZCOP0000", message: "Operation successful", data });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const settings = config();
  if (params.has("echo")) {
    if (!settings.ready || !verifyZlinkSignature(params, settings.token)) return NextResponse.json({ error: "Firma invalida." }, { status: 401 });
    try { return success(decryptZlinkData(params.get("echo"), settings.appKey, settings.iv)); }
    catch { return NextResponse.json({ error: "Verificacion cifrada invalida." }, { status: 400 }); }
  }
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const last = await prisma.changeLog.findFirst({ where: { module: "zlink-webhook" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, summary: true, after: true } });
  return NextResponse.json({ configured: settings.ready, lastEvent: last }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const settings = config();
  if (!settings.ready) return NextResponse.json({ error: "Receptor pendiente de configuracion." }, { status: 503 });
  if (!verifyZlinkSignature(new URL(request.url).searchParams, settings.token)) return NextResponse.json({ error: "Firma invalida." }, { status: 401 });
  try {
    if (Number(request.headers.get("content-length") || 0) > 1_000_000) return NextResponse.json({ error: "Evento demasiado grande." }, { status: 413 });
    const text = await request.text();
    if (Buffer.byteLength(text) > 1_000_000) return NextResponse.json({ error: "Evento demasiado grande." }, { status: 413 });
    const body = JSON.parse(text);
    if (!["open:att_transaction:push", "open:acc_transaction:push"].includes(body.eventCode) || typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.requestId)) return NextResponse.json({ error: "Tipo de evento invalido." }, { status: 400 });
    const decrypted = decryptZlinkData(body.encryptData, settings.appKey, settings.iv);
    const punches = parseZlinkWebhook(JSON.parse(decrypted), body.eventCode);
    const previous = await prisma.changeLog.findFirst({ where: { module: "zlink-webhook", targetId: body.requestId }, select: { id: true } });
    if (previous) return success();
    const profiles = await prisma.attendanceProfile.findMany({ select: { personId: true, extraBonuses: true } });
    const byCode = new Map<string, typeof profiles>();
    for (const profile of profiles) {
      const flags = profile.extraBonuses as Record<string, unknown> | null;
      for (const code of new Set([profile.personId, String(flags?.__documentDni || "")].filter(Boolean))) byCode.set(code, [...(byCode.get(code) || []), profile]);
    }
    const months = [...new Set(punches.map(punch => punch.date.slice(0, 7)))];
    const closures = await prisma.monthlyClosure.findMany({ where: { month: { in: months }, status: "CLOSED" }, select: { month: true } });
    const closed = new Set(closures.map(row => row.month));
    let unmatched = 0, inactive = 0, closedMonth = 0;
    const mapped = [];
    for (const punch of punches) {
      if (closed.has(punch.date.slice(0, 7))) { closedMonth++; continue; }
      const candidates = byCode.get(punch.code) || [];
      if (candidates.length !== 1) { unmatched++; continue; }
      const profile = candidates[0];
      if ((profile.extraBonuses as Record<string, unknown> | null)?.__inactive) { inactive++; continue; }
      mapped.push({ personId: profile.personId, date: punch.date, time: punch.time });
    }
    const imported = mapped.length ? await importZlinkPunches(mapped) : { addedPunches: 0, updatedPeople: 0 };
    await prisma.changeLog.create({ data: {
      module: "zlink-webhook", action: "receive", targetType: "attendance-event", targetId: body.requestId,
      summary: `Zlink en vivo: ${imported.addedPunches} marcajes nuevos, ${imported.updatedPeople} colaboradores.`,
      after: { received: punches.length, ...imported, unmatched, inactive, closedMonth },
    } });
    return success();
  } catch {
    // Do not acknowledge failed writes; Zlink can retry. Never log encrypted bodies or keys.
    return NextResponse.json({ error: "No se pudo procesar el evento de asistencia." }, { status: 500 });
  }
}
