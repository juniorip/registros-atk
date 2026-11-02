import { SafetypayBank, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { withDbRetry } from "@/lib/db-retry";
import { isAdmin } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function validMonth(value: string | null) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 7);
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return date.toISOString().slice(0, 7);
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Solo el administrador puede ver el comparativo general SafetyPay." }, { status: 403 });

  const month = validMonth(new URL(request.url).searchParams.get("month"));
  const priorMonth = previousMonth(month);
  const [currentRange, priorRange] = [monthRange(month), monthRange(priorMonth)];
  const baseWhere = { bank: { in: [SafetypayBank.CMR, SafetypayBank.IO] }, user: { role: { not: UserRole.ADMIN } } };

  const [current, previous] = await withDbRetry(() => Promise.all([
    prisma.safetypayCodeEntry.aggregate({ where: { ...baseWhere, createdAt: { gte: currentRange.start, lt: currentRange.end } }, _sum: { amount: true } }),
    prisma.safetypayCodeEntry.aggregate({ where: { ...baseWhere, createdAt: { gte: priorRange.start, lt: priorRange.end } }, _sum: { amount: true } }),
  ]));
  const currentTotal = Number(current._sum.amount || 0);
  const previousTotal = Number(previous._sum.amount || 0);
  const difference = currentTotal - previousTotal;
  const percent = previousTotal ? (difference / previousTotal) * 100 : null;

  return NextResponse.json({ month, priorMonth, currentTotal, previousTotal, difference, percent }, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  });
}
