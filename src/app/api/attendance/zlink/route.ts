import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { isAdmin } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { importZlinkPunches } from "@/lib/attendance";
import { isMonthClosed } from "@/lib/monthly-closure";
import { readZlinkPunches, readZlinkEvents, zlinkLimaPunch } from "@/lib/zlink";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function prepare(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return { error: auth.error };
  if (!isAdmin(auth.user)) return { error: NextResponse.json({ error: "Solo el admin puede sincronizar Zlink." }, { status: 403 }) };
  const month = new URL(request.url).searchParams.get("month") || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mes invalido.");
  const [raw, profiles] = await Promise.all([readZlinkPunches(month), prisma.attendanceProfile.findMany()]);
  const matches = new Map<string, typeof profiles>();
  for (const profile of profiles) {
    const flags = profile.extraBonuses as Record<string, unknown> | null;
    for (const code of new Set([profile.personId, String(flags?.__documentDni || "")].filter(Boolean))) {
      matches.set(code, [...(matches.get(code) || []), profile]);
    }
  }
  const unmatched = new Map<string, string>();
  let skippedInactive = 0;
  let skippedOtherSources = 0;
  const rows: Array<{ personId: string; date: string; time: string }> = [];
  for (const punch of raw) {
    if (![1, 5].includes(Number(punch.source))) { skippedOtherSources++; continue; }
    // Zlink's RESIGNED status describes the current employee, not a deleted punch.
    if (punch.status === "DELETE") continue;
    const code = String(punch.employeeCode || "").trim();
    const candidates = matches.get(code) || [];
    if (candidates.length !== 1) { unmatched.set(code, String(punch.firstName || "")); continue; }
    const profile = candidates[0];
    if ((profile.extraBonuses as Record<string, unknown> | null)?.__inactive) { skippedInactive++; continue; }
    const local = zlinkLimaPunch(punch);
    if (local.date.slice(0, 7) === month) rows.push({ personId: profile.personId, ...local });
  }
  return { month, rows, result: { connected: true, month, received: raw.length, matchedPunches: rows.length, matchedPeople: new Set(rows.map(row => row.personId)).size, skippedInactive, skippedOtherSources, unmatched: Array.from(unmatched, ([code, name]) => ({ code, name })) } };
}

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("source") === "events") {
      const auth = await requireApiUser();
      if (auth.error) return auth.error;
      if (!isAdmin(auth.user)) return NextResponse.json({ error: "Solo el admin puede consultar eventos." }, { status: 403 });
      const month = new URL(request.url).searchParams.get("month") || "";
      const events = await readZlinkEvents(month);
      const counts = new Map<string, number>();
      for (const event of events) {
        const operator = event.eventValues.find(value => value.name === "operator")?.value || "";
        counts.set(operator, (counts.get(operator) || 0) + 1);
      }
      return NextResponse.json({ connected: true, month, count: events.length, operators: Array.from(counts, ([code, count]) => ({ code, count })), sample: events.slice(0, 10).map(event => ({ time: event.eventTime, device: event.deviceName, values: event.eventValues.filter(value => ["operator", "attState"].includes(value.name)) })) }, { headers: { "Cache-Control": "no-store" } });
    }
    const prepared = await prepare(request);
    if (prepared.error) return prepared.error;
    return NextResponse.json(prepared.result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar Zlink." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const prepared = await prepare(request);
    if (prepared.error) return prepared.error;
    if (await isMonthClosed(prepared.month!)) return NextResponse.json({ error: "El mes esta cerrado. Reabrelo antes de sincronizar." }, { status: 409 });
    const imported = await importZlinkPunches(prepared.rows!);
    return NextResponse.json({ ...prepared.result, ...imported }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo sincronizar Zlink." }, { status: 502 });
  }
}
