import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { DEFAULT_PAYOUT_SETTINGS, isAdmin } from "@/lib/domain";
import { writePayoutSettings } from "@/lib/payout-settings";

const roleDefaultSchema = z.object({
  baseSalary: z.coerce.number().min(0),
  penaltyPerMinute: z.coerce.number().min(0),
  bonus: z.coerce.number().min(0),
  balanceBonus: z.coerce.number().min(0),
});

const customerServicePenaltySchema = z.object({
  code: z.string().min(2),
  label: z.string().min(2),
  amount: z.coerce.number().min(0),
  description: z.string().optional().default(""),
});

const payoutSchema = z.object({
  callCommission: z.coerce.number().min(0),
  ratingCommission: z.coerce.number().min(0),
  wrongCardBonus: z.coerce.number().min(0),
  managerRatingApprovalCommission: z.coerce.number().min(0),
  managerRecordValidationCommission: z.coerce.number().min(0),
  managerPenaltyApprovalCommission: z.coerce.number().min(0),
  safetypaySharedThreshold: z.coerce.number().min(0).max(1),
  safetypaySharedBonusPool: z.coerce.number().min(0),
  safetypayManagerBonus: z.coerce.number().min(0),
  commercialCardCommissionRate: z.coerce.number().min(0).max(1),
  commercialCardMinimumCommission: z.coerce.number().min(0),
  commercialCardMinimumThreshold: z.coerce.number().min(0),
  roleDefaults: z.record(z.string(), roleDefaultSchema).optional(),
  customerServicePenalties: z.array(customerServicePenaltySchema).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) {
    return NextResponse.json({ error: "Solo el admin puede cambiar parametros de pago." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = payoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Parametros de pago invalidos." }, { status: 400 });
  }

  const payoutSettings = await writePayoutSettings({
    ...parsed.data,
    roleDefaults: parsed.data.roleDefaults ?? DEFAULT_PAYOUT_SETTINGS.roleDefaults,
  });

  await logChange({actorId:auth.user.id,module:'Configuración',action:'EDITAR',summary:'Actualizó configuración: payout',targetType:'Settings',targetId:'payout',after:parsed.data});
  return NextResponse.json({ ok: true, payoutSettings });
}
