export type SalaryHistoryEntry = {
  effectiveMonth: string;
  monthlySalary: number;
  payrollRole?: string;
  employmentType?: string;
  partTimeMode?: string | null;
  source?: string;
  recordedAt?: string;
  actorId?: number;
};

// Only the periods explicitly confirmed by the administrator are recovered.
const confirmed: Record<string, SalaryHistoryEntry[]> = {
  "75348462": [
    { effectiveMonth: "2026-09", monthlySalary: 2000, source: "user-confirmed" },
    { effectiveMonth: "2026-10", monthlySalary: 2500, source: "user-confirmed" },
  ],
};

export function salaryHistoryFor(personId: string, extra: unknown): SalaryHistoryEntry[] {
  const stored = extra && typeof extra === "object" ? (extra as Record<string, unknown>).__salaryHistory : null;
  const entries = [...(confirmed[personId] || []), ...(Array.isArray(stored) ? stored : [])];
  const byMonth = new Map<string, SalaryHistoryEntry>();
  for (const entry of entries) {
    if (!entry || !/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.effectiveMonth) || !Number.isFinite(entry.monthlySalary) || entry.monthlySalary < 0) continue;
    byMonth.set(entry.effectiveMonth, { ...entry });
  }
  return [...byMonth.values()].sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
}
