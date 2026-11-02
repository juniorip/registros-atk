import { readInactiveUserIds } from "@/lib/inactive-users";
import { UserRole } from "@prisma/client";

import {
  calcUserCommission,
  calcReferralBankCommission,
  calcReferralCommission,
  canManageSafetypayPayments,
  canCreatePaymentAudit,
  canPreviewAllSedesAsManager,
  canViewPenaltyReport,
  canViewWrongCardReport,
  CUSTOMER_SERVICE_PENALTIES,
  formatPlatform,
  formatRecordMode,
  formatRecordType,
  formatReferralBank,
  formatRole,
  getCommissionRate,
  getCommissionableRecordsForUser,
  getPayoutSettings,
  getVisibleUsers,
  isAdmin,
  isManager,
  isPaymentsSupervisor,
  isPendingApproval,
  normalizeSede,
  resolveHistoricalSede,
  type VisibleStateRecord,
  type VisibleStateReferral,
  type VisibleStateUser,
  type VisibleStateWrongCardReport,
  validationLabel,
} from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { readPayoutSettings } from "@/lib/payout-settings";
import { recordAccountingMonth } from "@/lib/monthly-closure";

export const STATE_MODULE_KEYS = [
  "settings",
  "monthlyClosures",
  "users",
  "penaltyReportUsers",
  "records",
  "referrals",
  "wrongCards",
  "callReports",
  "safetypayCodes",
  "penaltyReports",
] as const;

export type StateModuleKey = (typeof STATE_MODULE_KEYS)[number];

export function initialStateModules(admin: boolean): StateModuleKey[] {
  return ["settings", "monthlyClosures", "users", "records", ...(admin ? ["referrals", "wrongCards", "callReports", "penaltyReports"] as StateModuleKey[] : [])];
}

function sedeVariants(sede: string) {
  const normalized = normalizeSede(sede);
  return normalized === "Lince" ? ["Lince", "Centro"] : [normalized];
}

function historicalSedeWhere(sedeList: string[]) {
  return {
    OR: [
      { historicalSede: { in: sedeList } },
      {
        AND: [
          { historicalSede: null },
          { user: { sede: { in: sedeList } } },
        ],
      },
    ],
  };
}

function normalizeMonthKey(value?: string | null) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : null;
}

function monthBounds(month: string | null) {
  if (!month) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

function dateFieldMonthWhere(month: string | null, field: string) {
  const bounds = monthBounds(month);
  return bounds ? { [field]: { gte: bounds.start, lt: bounds.end } } : null;
}

function monthAnyDateWhere(month: string | null, fields: string[]) {
  const filters = fields
    .map((field) => dateFieldMonthWhere(month, field))
    .filter(Boolean);
  if (!filters.length) return null;
  return { OR: filters };
}

function recordMonthWhere(month: string | null) {
  const bounds = monthBounds(month);
  if (!bounds) return null;
  return {
    OR: [
      { operationDate: { gte: bounds.start, lt: bounds.end } },
      {
        operationDate: null,
        registrationDate: { gte: bounds.start, lt: bounds.end },
      },
    ],
  };
}

function withMonthScope(baseWhere: any, monthWhere: any) {
  if (!monthWhere) return baseWhere;
  if (!baseWhere) return monthWhere;
  return { AND: [baseWhere, monthWhere] };
}

export async function buildStateResponse(
  currentUser: VisibleStateUser,
  options?: { modules?: Iterable<StateModuleKey> | null; month?: string | null },
) {
  const requestedModules = options?.modules ? new Set(options.modules) : null;
  const includeModule = (key: StateModuleKey) => !requestedModules || requestedModules.has(key);
  const sedeList = sedeVariants(currentUser.sede);
  const scopedMonth = normalizeMonthKey(options?.month);

  const canPreviewAllSedes = canPreviewAllSedesAsManager(currentUser);
  const paymentTeamUserWhere = {
    OR: [
      { username: { equals: "FRANCO 1", mode: "insensitive" as const } },
      { username: { equals: "junior", mode: "insensitive" as const } },
      { username: { equals: "laura", mode: "insensitive" as const } },
      { name: { contains: "andrea", mode: "insensitive" as const } },
    ],
  };
  const paymentsSupervisor = isPaymentsSupervisor(currentUser);

  const userWhere = isAdmin(currentUser) || canPreviewAllSedes
    ? undefined
    : isManager(currentUser)
      ? paymentsSupervisor
        ? { OR: [{ id: currentUser.id }, paymentTeamUserWhere] }
        : {
          role: { not: UserRole.ADMIN },
          sede: { in: sedeList },
          NOT: paymentTeamUserWhere,
        }
      : { id: currentUser.id };

  const recordWhere = withMonthScope(isAdmin(currentUser) || canPreviewAllSedes
    ? undefined
    : isManager(currentUser)
      ? paymentsSupervisor
        ? { user: paymentTeamUserWhere }
        : { AND: [historicalSedeWhere(sedeList), { NOT: { user: paymentTeamUserWhere } }] }
      : { userId: currentUser.id }, recordMonthWhere(scopedMonth));

  const referralWhere = withMonthScope(isAdmin(currentUser) || canPreviewAllSedes
    ? undefined
    : isManager(currentUser)
      ? paymentsSupervisor
        ? { user: paymentTeamUserWhere }
        : { AND: [historicalSedeWhere(sedeList), { NOT: { user: paymentTeamUserWhere } }] }
      : { userId: currentUser.id }, monthAnyDateWhere(scopedMonth, ["validatedAt", "createdAt"]));

  const wrongCardWhere = withMonthScope(isAdmin(currentUser) || canPreviewAllSedes
    ? undefined
    : isManager(currentUser)
      ? paymentsSupervisor
        ? { user: paymentTeamUserWhere }
        : { AND: [historicalSedeWhere(sedeList), { NOT: { user: paymentTeamUserWhere } }] }
      : { userId: currentUser.id }, monthAnyDateWhere(scopedMonth, ["detectedDate", "validatedAt", "createdAt"]));

  const callReportWhere = withMonthScope(isAdmin(currentUser) || canPreviewAllSedes
    ? undefined
    : isManager(currentUser)
      ? paymentsSupervisor
        ? { user: paymentTeamUserWhere }
        : { AND: [historicalSedeWhere(sedeList), { NOT: { user: paymentTeamUserWhere } }] }
      : { userId: currentUser.id }, monthAnyDateWhere(scopedMonth, ["validatedAt", "createdAt"]));

  const safetypayWhere = withMonthScope(isAdmin(currentUser) || canManageSafetypayPayments(currentUser) || canPreviewAllSedes
    ? undefined
    : paymentsSupervisor
      ? { user: paymentTeamUserWhere }
      : { AND: [historicalSedeWhere(sedeList), { NOT: { user: paymentTeamUserWhere } }] }, monthAnyDateWhere(scopedMonth, ["createdAt", "paidAt"]));

  const penaltyReportWhere = withMonthScope(isAdmin(currentUser) || canPreviewAllSedes
    ? undefined
    : isManager(currentUser)
      ? {
          OR: [
            { sentById: currentUser.id },
            { targetSede: { in: sedeList } },
            { workerSede: { in: sedeList } },
          ],
        }
      : {
          OR: [{ workerUserId: currentUser.id }, { sentById: currentUser.id }],
        }, monthAnyDateWhere(scopedMonth, ["decidedAt", "createdAt"]));

  const userSelect = {
    id: true,
    name: true,
    username: true,
    role: true,
    sede: true,
    forcePasswordReset: true,
    color: true,
  } as const;

  const [
    users,
    penaltyReportUsers,
    records,
    referrals,
    wrongCards,
    callReports,
    safetypayCodes,
    penaltyReports,
    settings,
    monthlyClosures,
    inactiveAttendanceProfiles,
    payoutSettingsResult,
  ] = await Promise.all([
    includeModule("users")
      ? prisma.user.findMany({
          where: userWhere,
          select: userSelect,
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    includeModule("penaltyReportUsers") && (isManager(currentUser) || isAdmin(currentUser) || canCreatePaymentAudit(currentUser))
      ? prisma.user.findMany({
          where: { role: { not: UserRole.ADMIN } },
          select: userSelect,
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    includeModule("records")
      ? prisma.record.findMany({
          where: recordWhere,
          include: {
            user: { select: userSelect },
            validatedBy: { select: userSelect },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    includeModule("referrals")
      ? prisma.referral.findMany({
          where: referralWhere,
          include: {
            user: { select: userSelect },
            validatedBy: { select: userSelect },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    includeModule("wrongCards")
      ? prisma.wrongCardReport.findMany({
          where: wrongCardWhere,
          include: {
            user: { select: userSelect },
            validatedBy: { select: userSelect },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    includeModule("callReports")
      ? prisma.callReport.findMany({
          where: callReportWhere,
          include: {
            user: { select: userSelect },
            validatedBy: { select: userSelect },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    includeModule("safetypayCodes")
      ? prisma.safetypayCodeEntry.findMany({
          where: safetypayWhere,
          include: {
            user: { select: userSelect },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    includeModule("penaltyReports")
      ? prisma.penaltyReport.findMany({
          where: penaltyReportWhere,
          include: {
            sentBy: { select: userSelect },
            receiver: { select: userSelect },
            decidedBy: { select: userSelect },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    includeModule("settings")
      ? prisma.appSettings.findUnique({ where: { id: 1 } })
      : Promise.resolve(null),
    includeModule("monthlyClosures")
      ? isAdmin(currentUser)
        ? prisma.monthlyClosure.findMany({
            orderBy: { month: "desc" },
            include: {
              closedBy: { select: { id: true, name: true, username: true } },
              reopenedBy: { select: { id: true, name: true, username: true } },
            },
          })
        : prisma.monthlyClosure.findMany({
            orderBy: { month: "desc" },
            select: {
              month: true,
              status: true,
              closedAt: true,
              reopenedAt: true,
            },
          })
      : Promise.resolve([]),
    readInactiveUserIds(),
    includeModule("settings") || includeModule("wrongCards") || includeModule("callReports")
      ? readPayoutSettings().catch(() => null)
      : Promise.resolve(null),
  ]);

  const inactiveUserIds = inactiveAttendanceProfiles;

  const payoutSettings = payoutSettingsResult || getPayoutSettings(settings);
  const isInactiveUser = (userId: number | null | undefined) => inactiveUserIds.has(Number(userId || 0));
  const visibleUsers = getVisibleUsers(currentUser, users.filter((user) => !isInactiveUser(user.id)));
  const visibleRecords = (records as VisibleStateRecord[]).filter((record) => !isInactiveUser(record.userId));
  const visibleReferrals = (referrals as VisibleStateReferral[]).filter((referral) => !isInactiveUser(referral.userId));
  const visibleWrongCards = (wrongCards as VisibleStateWrongCardReport[]).filter((report) => !isInactiveUser(report.userId));
  const visibleCallReports = callReports.filter((report) => !isInactiveUser(report.userId));
  const visibleSafetypayCodes = safetypayCodes.filter((entry) => !isInactiveUser(entry.userId));
  const visiblePenaltyReports = penaltyReports.filter((report) =>
    !isInactiveUser(report.sentById) && !isInactiveUser(report.workerUserId),
  );
  const visibleDnis = Array.from(new Set(visibleRecords.map((record) => record.dni).filter(Boolean)));
  const duplicateKeys = new Set<string>();
  const duplicateDetailsByRecordId = new Map<number, Array<{ sede: string; userName: string }>>();
  const duplicateSourceKey = (record: { id: number; notes: string | null }) => {
    const ticketId = record.notes?.match(/\[turnos-ticket:(\d+)\]/)?.[1];
    return ticketId ? `turnos:${ticketId}` : `record:${record.id}`;
  };

  if (includeModule("records") && visibleDnis.length) {
    const duplicateRecords = await prisma.record.findMany({
      where: {
        dni: { in: visibleDnis },
        rejectedAt: null,
      },
      select: {
        id: true,
        dni: true,
        registrationDate: true,
        operationDate: true,
        rejectedAt: true,
        validatedAt: true,
        createdAt: true,
        notes: true,
        historicalSede: true,
        user: {
          select: {
            name: true,
            sede: true,
          },
        },
      },
    });

    const duplicateGroups = new Map<string, typeof duplicateRecords>();
    for (const duplicate of duplicateRecords) {
      const key = `${duplicate.dni}:${recordAccountingMonth(duplicate)}`;
      duplicateGroups.set(key, [...(duplicateGroups.get(key) || []), duplicate]);
    }
    for (const [key, rows] of duplicateGroups) {
      const distinctSources = new Set(rows.map(duplicateSourceKey));
      if (distinctSources.size > 1) duplicateKeys.add(key);
    }

    if (duplicateKeys.size) {
      for (const record of visibleRecords) {
        const key = `${record.dni}:${recordAccountingMonth(record)}`;
        if (!duplicateKeys.has(key)) continue;
        const currentSede = resolveHistoricalSede(record.historicalSede, record.user.sede);
        const details = (duplicateGroups.get(key) || [])
          .filter((duplicate) => duplicateSourceKey(duplicate) !== duplicateSourceKey(record))
          .map((duplicate) => ({
            sede: resolveHistoricalSede(duplicate.historicalSede, duplicate.user.sede),
            userName: duplicate.user.name,
          }))
          .filter((duplicate) => duplicate.sede !== currentSede);

        if (details.length) {
          duplicateDetailsByRecordId.set(record.id, details);
        }
      }
    }
  }

  return {
    currentUser: {
      ...currentUser,
      sede: normalizeSede(currentUser.sede),
      roleLabel: formatRole(currentUser.role),
      commission: calcUserCommission(currentUser, visibleRecords, settings),
    },
    ...(includeModule("settings")
      ? {
          settings: {
            commissionPerRecord: getCommissionRate(settings),
            ratingRequiredFields: settings?.ratingRequiredFields ?? ["dni"],
            safetypayMonthlyGoal: Number(settings?.safetypayMonthlyGoal ?? 750000),
            safetypaySedeGoals: settings?.safetypaySedeGoals || null,
            safetypayGoalHistory: settings?.safetypayGoalHistory || null,
            payoutSettings,
            customerServicePenalties: payoutSettings.customerServicePenalties || CUSTOMER_SERVICE_PENALTIES,
            wrongCardBonus: payoutSettings.wrongCardBonus,
          },
        }
      : {}),
    ...(includeModule("monthlyClosures") ? { monthlyClosures } : {}),
    ...(includeModule("users")
      ? {
          users: visibleUsers.map((user) => ({
            ...user,
            sede: normalizeSede(user.sede),
            roleLabel: formatRole(user.role),
            commission: calcUserCommission(user, visibleRecords, settings),
            commissionCount: getCommissionableRecordsForUser(user, visibleRecords).length,
          })),
        }
      : {}),
    ...(includeModule("penaltyReportUsers")
      ? {
          penaltyReportUsers: penaltyReportUsers.filter((user) => !inactiveUserIds.has(user.id)).map((user) => ({
            ...user,
            sede: normalizeSede(user.sede),
            roleLabel: formatRole(user.role),
          })),
        }
      : {}),
    ...(includeModule("records")
      ? {
          records: visibleRecords.map((record) => ({
            ...record,
            historicalSede: resolveHistoricalSede(record.historicalSede, record.user.sede),
            user: {
              ...record.user,
              sede: resolveHistoricalSede(record.historicalSede, record.user.sede),
              roleLabel: formatRole(record.user.role),
            },
            validatedBy: record.validatedBy
              ? {
                  ...record.validatedBy,
                  sede: normalizeSede(record.validatedBy.sede),
                  roleLabel: formatRole(record.validatedBy.role),
                }
              : null,
            roleLabel: formatRecordType(record.type),
            modeLabel: formatRecordMode(record.mode),
            platformLabel: formatPlatform(record.uploadPlatform),
            pendingApproval: isPendingApproval(record),
            validationLabel: validationLabel(record),
            isDuplicate: duplicateKeys.has(`${record.dni}:${recordAccountingMonth(record)}`),
            duplicateDetails: duplicateDetailsByRecordId.get(record.id) || [],
          })),
        }
      : {}),
    ...(includeModule("referrals")
      ? {
          referrals: visibleReferrals.map((referral) => ({
            ...referral,
            historicalSede: resolveHistoricalSede(referral.historicalSede, referral.user.sede),
            user: {
              ...referral.user,
              sede: resolveHistoricalSede(referral.historicalSede, referral.user.sede),
              roleLabel: formatRole(referral.user.role),
            },
            validatedBy: referral.validatedBy
              ? {
                  ...referral.validatedBy,
                  sede: normalizeSede(referral.validatedBy.sede),
                  roleLabel: formatRole(referral.validatedBy.role),
                }
              : null,
            bankLabel: formatReferralBank(referral.bank),
            bankCommission: calcReferralBankCommission(referral.bank, referral.amount),
            referralCommission: calcReferralCommission(referral.bank, referral.amount),
            pendingApproval: !referral.validatedAt && !referral.rejectedAt,
          })),
        }
      : {}),
    ...(includeModule("wrongCards")
      ? {
          wrongCards: visibleWrongCards
            .filter((report) => canViewWrongCardReport(currentUser, report))
            .map((report) => ({
              ...report,
              historicalSede: resolveHistoricalSede(report.historicalSede, report.user.sede),
              user: {
                ...report.user,
                sede: resolveHistoricalSede(report.historicalSede, report.user.sede),
                roleLabel: formatRole(report.user.role),
              },
              validatedBy: report.validatedBy
                ? {
                    ...report.validatedBy,
                    sede: normalizeSede(report.validatedBy.sede),
                    roleLabel: formatRole(report.validatedBy.role),
                  }
                : null,
              bonusAmount: payoutSettings.wrongCardBonus,
              pendingApproval: report.status === "PENDING",
            })),
        }
      : {}),
    ...(includeModule("callReports")
      ? {
          callReports: visibleCallReports.map((report) => ({
            ...report,
            historicalSede: resolveHistoricalSede(report.historicalSede, report.user.sede),
            user: {
              ...report.user,
              sede: resolveHistoricalSede(report.historicalSede, report.user.sede),
              roleLabel: formatRole(report.user.role),
            },
            validatedBy: report.validatedBy
              ? {
                  ...report.validatedBy,
                  sede: normalizeSede(report.validatedBy.sede),
                  roleLabel: formatRole(report.validatedBy.role),
                }
              : null,
            bonusAmount: payoutSettings.callCommission,
            pendingApproval: report.status === "PENDING",
          })),
        }
      : {}),
    ...(includeModule("safetypayCodes")
      ? {
          safetypayCodes: visibleSafetypayCodes.map((entry) => ({
            ...entry,
            historicalSede: resolveHistoricalSede(entry.historicalSede, entry.user.sede),
            user: {
              ...entry.user,
              sede: resolveHistoricalSede(entry.historicalSede, entry.user.sede),
              roleLabel: formatRole(entry.user.role),
            },
          })),
        }
      : {}),
    ...(includeModule("penaltyReports")
      ? {
          penaltyReports: visiblePenaltyReports
            .filter((report) => canViewPenaltyReport(currentUser, report))
            .map((report) => ({
              ...report,
              workerSede: normalizeSede(report.workerSede),
              targetSede: normalizeSede(report.targetSede),
              sentBy: {
                ...report.sentBy,
                sede: normalizeSede(report.sentBy.sede),
                roleLabel: formatRole(report.sentBy.role),
              },
              receiver: report.receiver
                ? {
                    ...report.receiver,
                    sede: normalizeSede(report.receiver.sede),
                    roleLabel: formatRole(report.receiver.role),
                  }
                : null,
              decidedBy: report.decidedBy
                ? {
                    ...report.decidedBy,
                    sede: normalizeSede(report.decidedBy.sede),
                    roleLabel: formatRole(report.decidedBy.role),
                  }
                : null,
              pendingApproval: report.status === "PENDING",
            })),
        }
      : {}),
  };
}
