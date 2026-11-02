import { logChange } from "@/lib/change-log";
import { ReferralBank } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { calcReferralBankCommission, calcReferralCommission, normalizeSede } from "@/lib/domain";
import { currentMonthKey, isMonthClosedForRole } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

const referralSchema = z.object({
  clientName: z.string().min(2),
  dni: z.string().min(6),
  amount: z.number().positive(),
  bank: z.enum(["BBVA", "BCP", "SCOTIABANK", "INTERBANK"]),
  notes: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = referralSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const data = parsed.data;
  if (await isMonthClosedForRole(currentMonthKey(), auth.user.role)) {
    return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para agregar referidos." }, { status: 403 });
  }
  const bank = data.bank as ReferralBank;
  const bankCommission = calcReferralBankCommission(bank, data.amount);
  const referralCommission = calcReferralCommission(bank, data.amount);

  const referral = await prisma.referral.create({
    data: {
      userId: auth.user.id,
      historicalSede: normalizeSede(auth.user.sede),
      clientName: data.clientName.trim(),
      dni: data.dni.trim(),
      amount: data.amount,
      bank,
      bankCommission,
      referralCommission,
      notes: data.notes?.trim() || null,
    },
  });

  await logChange({actorId:auth.user.id,module:"Referidos",action:'CREAR',summary:'Creó Referidos #'+referral.id,targetType:'Referral',targetId:referral.id,after:referral});
  return NextResponse.json({ ok: true, referral });
}
