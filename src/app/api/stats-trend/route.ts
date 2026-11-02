import { NextResponse } from "next/server";
import { readInactiveUserIds } from "@/lib/inactive-users";

import { requireApiUser } from "@/lib/api-auth";
import { withDbRetry } from "@/lib/db-retry";
import {
  canPreviewAllSedesAsManager,
  isAdmin,
  isManager,
  isPaymentsSupervisor,
  normalizeSede,
  resolveHistoricalSede,
} from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { buildRatingsResponse } from "@/lib/ratings";

export const dynamic = "force-dynamic";

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function dateKey(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : "";
}

function recordMonth(record: { registrationDate: Date; operationDate: Date | null }) {
  if (record.operationDate) return monthKey(record.operationDate);
  // Approval timing and the seven-day follow-up window do not change the
  // month in which the registration was created.
  return monthKey(record.registrationDate);
}

function monthKeys(lastMonth: string, count: number) {
  const [year, month] = lastMonth.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  return Array.from({ length: count }, () => {
    const key = monthKey(cursor);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    return key;
  }).reverse();
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  return { start, end };
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  try {
    const { searchParams } = new URL(request.url);
    const requestedCount = Number(searchParams.get("months"));
    const count = requestedCount === 6 ? 6 : 3;
    const requestedMonth = String(searchParams.get("month") || "");
    const latestMonth = /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : monthKey(new Date());
    const months = monthKeys(latestMonth, count);
    const firstBounds = monthBounds(months[0]);
    const lastBounds = monthBounds(latestMonth);
    const canChooseSede = isAdmin(auth.user) || canPreviewAllSedesAsManager(auth.user);
    const requestedSede = normalizeSede(searchParams.get("sede") || "");
    const selectedSede = canChooseSede && searchParams.get("sede") ? requestedSede : "";
    const ownSede = normalizeSede(auth.user.sede);
    const sedeList = ownSede === "Lince" ? ["Lince", "Centro"] : [ownSede];
    const paymentTeamUserWhere = {
      OR: [
        { username: { equals: "FRANCO 1", mode: "insensitive" as const } },
        { username: { equals: "junior", mode: "insensitive" as const } },
        { username: { equals: "laura", mode: "insensitive" as const } },
        { name: { contains: "andrea", mode: "insensitive" as const } },
      ],
    };
    const scopedUserWhere: any = isAdmin(auth.user) || canPreviewAllSedesAsManager(auth.user)
      ? undefined
      : isManager(auth.user)
        ? isPaymentsSupervisor(auth.user)
          ? { user: paymentTeamUserWhere }
          : { AND: [{ OR: [{ historicalSede: { in: sedeList } }, { AND: [{ historicalSede: null }, { user: { sede: { in: sedeList } } }] }] }, { NOT: { user: paymentTeamUserWhere } }] }
        : { userId: auth.user.id };
    const dateScope = {
      OR: [
        { operationDate: { gte: firstBounds.start, lt: lastBounds.end } },
        {
          operationDate: null,
          registrationDate: { gte: firstBounds.start, lt: lastBounds.end },
        },
      ],
    };
    const inactiveIds = await readInactiveUserIds();
    const where: any = { AND: [dateScope, ...(scopedUserWhere ? [scopedUserWhere] : []), { userId: { notIn: [...inactiveIds] } }] };

    const [records, ratings] = await withDbRetry(() => Promise.all([
      prisma.record.findMany({
        where,
        select: {
          type: true, mode: true, registrationDate: true, operationDate: true, rejectedAt: true, validatedAt: true,
          historicalSede: true,
          user: { select: { sede: true } },
        },
      }),
      buildRatingsResponse(auth.user, { from: `${months[0]}-01`, to: `${latestMonth}-31` }),
    ]));

    const rows = months.map((month) => ({ month, records: 0, virtual: 0, presencial: 0, validated: 0, ratings: 0 }));
    const byMonth = new Map(rows.map((row) => [row.month, row]));
    records.forEach((record) => {
      const month = recordMonth(record);
      const row = byMonth.get(month);
      const sede = normalizeSede(resolveHistoricalSede(record.historicalSede, record.user.sede));
      if (!row || (selectedSede && sede !== selectedSede)) return;
      row.records += 1;
      if (record.mode === "VIRTUAL") row.virtual += 1;
      else if (record.mode === "PRESENCIAL") row.presencial += 1;
      if (record.validatedAt) row.validated += 1;
    });
    (ratings.rows || []).forEach((rating: { date?: string; rawDate?: string; approvedAt?: string; sede?: string }) => {
      const month = String(rating.date || rating.rawDate || rating.approvedAt || "").slice(0, 7);
      const row = byMonth.get(month);
      if (row && (!selectedSede || normalizeSede(rating.sede) === selectedSede)) row.ratings += 1;
    });

    return NextResponse.json({ months: rows }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar el comparativo." }, { status: 500 });
  }
}
