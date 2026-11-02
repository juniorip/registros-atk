import { getPayoutSettings, type PayoutSettings } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

export async function readPayoutSettings(): Promise<PayoutSettings> {
  const rows = await prisma.$queryRaw<Array<{ payoutSettings: unknown }>>`
    SELECT "payoutSettings" FROM "AppSettings" WHERE id = 1
  `;
  return getPayoutSettings({ payoutSettings: rows[0]?.payoutSettings } as never);
}

export async function writePayoutSettings(payoutSettings: PayoutSettings) {
  const payload = JSON.stringify(payoutSettings);
  await prisma.$executeRaw`
    INSERT INTO "AppSettings" (id, "commissionPerRecord", "safetypayMonthlyGoal", "payoutSettings", "updatedAt")
    VALUES (1, 0.40, 750000, ${payload}::json, NOW())
    ON CONFLICT (id) DO UPDATE SET "payoutSettings" = ${payload}::json, "updatedAt" = NOW()
  `;
  return readPayoutSettings();
}
