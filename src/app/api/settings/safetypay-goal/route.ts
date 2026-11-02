import { logChange } from "@/lib/change-log";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { isAdmin } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  safetypayMonthlyGoal: z.coerce.number().min(1).optional(),
  safetypaySedeGoals: z
    .object({
      Lince: z.coerce.number().min(1),
      Sur: z.coerce.number().min(1),
      Norte: z.coerce.number().min(1),
      Miraflores: z.coerce.number().min(1),
    })
    .optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) {
    return NextResponse.json({ error: "Solo el admin puede cambiar la meta Safetypay." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Meta invalida." }, { status: 400 });
  }

  const defaultGoal = parsed.data.safetypayMonthlyGoal
    ?? parsed.data.safetypaySedeGoals?.Lince
    ?? 750000;

  const month = parsed.data.month ?? new Date().toISOString().slice(0, 7);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const existing = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const existingHistory = existing?.safetypayGoalHistory && typeof existing.safetypayGoalHistory === "object" && !Array.isArray(existing.safetypayGoalHistory)
    ? existing.safetypayGoalHistory as Record<string, unknown>
    : {};
  const goals = parsed.data.safetypaySedeGoals ?? {
    Lince: defaultGoal,
    Sur: defaultGoal,
    Norte: defaultGoal,
    Miraflores: defaultGoal,
  };
  const history = { ...existingHistory, [month]: goals };

  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: {
      ...(month === currentMonth ? {
        safetypayMonthlyGoal: defaultGoal,
        ...(parsed.data.safetypaySedeGoals ? { safetypaySedeGoals: parsed.data.safetypaySedeGoals } : {}),
      } : {}),
      safetypayGoalHistory: history as Prisma.InputJsonObject,
    },
    create: {
      id: 1,
      safetypayMonthlyGoal: month === currentMonth ? defaultGoal : 750000,
      safetypaySedeGoals: month === currentMonth ? parsed.data.safetypaySedeGoals ?? Prisma.JsonNull : Prisma.JsonNull,
      safetypayGoalHistory: history as Prisma.InputJsonObject,
    },
  });

  await logChange({actorId:auth.user.id,module:'Configuración',action:'EDITAR',summary:'Actualizó configuración: safetypay-goal',targetType:'Settings',targetId:'safetypay-goal',after:parsed.data});
  return NextResponse.json({ ok: true });
}
