import { prisma } from "@/lib/prisma";
import { readAttendanceData, clearAttendanceMonth } from "@/lib/attendance";
import type { Prisma } from "@prisma/client";

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthFromDate(value?: Date | string | null) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return currentMonthKey(date);
}

export function recordAccountingMonth(record: {
  registrationDate?: Date | string | null;
  operationDate?: Date | string | null;
  rejectedAt?: Date | string | null;
  validatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}) {
  // A late approval must not move a record into the approval month. Attribute
  // it to the month of the underlying business event instead.
  if (record.operationDate) return monthFromDate(record.operationDate);
  if (record.registrationDate) return monthFromDate(record.registrationDate);
  if (record.createdAt) return monthFromDate(record.createdAt);
  return monthFromDate(record.rejectedAt ?? record.validatedAt);
}

export async function isMonthClosed(month: string) {
  if (!month) return false;
  const closure = await prisma.monthlyClosure.findUnique({
    where: { month },
    select: { status: true },
  });
  return closure?.status === "CLOSED";
}

export async function isMonthClosedForRole(month: string, role?: string | null) {
  if (role === "ADMIN") return false;
  return isMonthClosed(month);
}

export async function listMonthlyClosures() {
  return prisma.monthlyClosure.findMany({
    orderBy: { month: "desc" },
    include: {
      closedBy: { select: { id: true, name: true, username: true } },
      reopenedBy: { select: { id: true, name: true, username: true } },
    },
  });
}

export async function closeMonthlySnapshot(input: {
  month: string;
  summary: unknown;
  details: unknown;
  pending: unknown;
  closedById: number;
}) {
  if (await isMonthClosed(input.month)) {
    throw new Error("Este mes ya está cerrado.");
  }

  return prisma.monthlyClosure.upsert({
    where: { month: input.month },
    update: {
      status: "CLOSED",
      summary: input.summary as object,
      details: input.details as object,
      pending: input.pending as object,
      closedById: input.closedById,
      closedAt: new Date(),
      reopenedById: null,
      reopenedAt: null,
      reopenReason: null,
    },
    create: {
      month: input.month,
      status: "CLOSED",
      summary: input.summary as object,
      details: input.details as object,
      pending: input.pending as object,
      closedById: input.closedById,
    },
  });
}

export async function reopenMonthlyClosure(input: {
  month: string;
  reopenedById: number;
  reason: string;
}) {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Debes indicar el motivo para reabrir el mes.");
  }

  return prisma.monthlyClosure.update({
    where: { month: input.month },
    data: {
      status: "REOPENED",
      reopenedById: input.reopenedById,
      reopenedAt: new Date(),
      reopenReason: reason,
    },
  });
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) {
    throw new Error("Mes inválido.");
  }
  const start = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, monthNumber, 1, 0, 0, 0, 0);
  return { start, end };
}

function textMonthKey(value?: Date | string | null) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return currentMonthKey(date);
}

export async function buildMonthlyArchive(month: string) {
  const closure = await prisma.monthlyClosure.findUnique({
    where: { month },
    include: {
      closedBy: { select: { id: true, name: true, username: true } },
      reopenedBy: { select: { id: true, name: true, username: true } },
    },
  });
  if (!closure || closure.status !== "CLOSED") {
    throw new Error("Primero debes cerrar el mes antes de archivarlo.");
  }

  const { start, end } = monthRange(month);
  const [
    users,
    records,
    referrals,
    wrongCards,
    callReports,
    safetypayCodes,
    commercialCardEntries,
    penaltyReports,
    ratingApprovals,
    attendance,
    attendanceOverrides,
    attendanceProfiles,
    attendanceRequests,
  ] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        sede: true,
        color: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.record.findMany({
      where: {
        registrationDate: { gte: start, lt: end },
      },
      include: {
        user: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
        validatedBy: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
      },
      orderBy: [{ registrationDate: "asc" }, { id: "asc" }],
    }),
    prisma.referral.findMany({
      where: {
        createdAt: { gte: start, lt: end },
      },
      include: {
        user: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
        validatedBy: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.wrongCardReport.findMany({
      where: {
        createdAt: { gte: start, lt: end },
      },
      include: {
        user: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
        validatedBy: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.callReport.findMany({
      where: {
        createdAt: { gte: start, lt: end },
      },
      include: {
        user: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
        validatedBy: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.safetypayCodeEntry.findMany({
      where: {
        createdAt: { gte: start, lt: end },
      },
      include: {
        user: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.commercialCardEntry.findMany({
      where: {
        operationDate: { gte: start, lt: end },
      },
      include: {
        user: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
      },
      orderBy: [{ operationDate: "asc" }, { id: "asc" }],
    }),
    prisma.penaltyReport.findMany({
      where: {
        createdAt: { gte: start, lt: end },
      },
      include: {
        sentBy: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
        receiver: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
        decidedBy: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.ratingApproval.findMany({
      where: {
        createdAt: { gte: start, lt: end },
      },
      include: {
        decidedBy: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    readAttendanceData(),
    prisma.attendanceOverride.findMany({
      orderBy: [{ date: "asc" }, { personId: "asc" }],
    }),
    prisma.attendanceProfile.findMany({
      orderBy: { personName: "asc" },
    }),
    prisma.attendanceChangeRequest.findMany({
      where: {
        date: { startsWith: month },
      },
      include: {
        requestedBy: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
        decidedBy: { select: { id: true, name: true, username: true, role: true, sede: true, color: true } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
  ]);

  const attendanceMonthRows = (attendance.people || [])
    .map((person) => ({
      ...person,
      days: (person.days || []).filter((day) => String(day.date || "").startsWith(month)),
    }))
    .filter((person) => person.days.length > 0);

  const attendanceMonth = {
    sourceFile: attendance.sourceFile,
    sheetName: attendance.sheetName,
    importedAt: attendance.importedAt,
    schedule: attendance.schedule,
    availableDates: (attendance.availableDates || []).filter((date) => String(date || "").startsWith(month)),
    people: attendanceMonthRows,
    overrides: attendanceOverrides.filter((item) => String(item.date || "").startsWith(month)),
    profiles: attendanceProfiles,
    changeRequests: attendanceRequests,
  };

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    month,
    closure,
    users,
    modules: {
      records,
      referrals,
      wrongCards,
      callReports,
      safetypayCodes,
      commercialCardEntries,
      penaltyReports,
      ratingApprovals,
      attendance: attendanceMonth,
    },
  };
}

export async function archiveAndCleanClosedMonth(month: string) {
  const archive = await buildMonthlyArchive(month);
  const closure = await prisma.monthlyClosure.findUnique({
    where: { month },
    select: { status: true, pending: true },
  });
  if (closure?.status !== "CLOSED") {
    throw new Error("Solo puedes limpiar un mes ya cerrado.");
  }

  const pending = typeof closure.pending === "object" && closure.pending && !Array.isArray(closure.pending)
    ? closure.pending as Record<string, unknown>
    : {};
  await prisma.monthlyClosure.update({
    where: { month },
    data: {
      pending: {
        ...pending,
        archivedData: archive,
      } as Prisma.InputJsonObject,
    },
  });

  const { start, end } = monthRange(month);

  await prisma.$transaction([
    prisma.record.deleteMany({
      where: { registrationDate: { gte: start, lt: end } },
    }),
    prisma.referral.deleteMany({
      where: { createdAt: { gte: start, lt: end } },
    }),
    prisma.wrongCardReport.deleteMany({
      where: { createdAt: { gte: start, lt: end } },
    }),
    prisma.callReport.deleteMany({
      where: { createdAt: { gte: start, lt: end } },
    }),
    prisma.safetypayCodeEntry.deleteMany({
      where: { createdAt: { gte: start, lt: end } },
    }),
    prisma.commercialCardEntry.deleteMany({
      where: { operationDate: { gte: start, lt: end } },
    }),
    prisma.penaltyReport.deleteMany({
      where: { createdAt: { gte: start, lt: end } },
    }),
    prisma.ratingApproval.deleteMany({
      where: { createdAt: { gte: start, lt: end } },
    }),
    prisma.attendanceChangeRequest.deleteMany({
      where: { date: { startsWith: month } },
    }),
    prisma.attendanceOverride.deleteMany({
      where: { date: { startsWith: month } },
    }),
  ]);

  const attendance = await readAttendanceData();
  const hasAttendanceForMonth = (attendance.availableDates || []).some((date) => String(date || "").startsWith(month))
    || (attendance.people || []).some((person) => (person.days || []).some((day) => String(day.date || "").startsWith(month)));

  if (hasAttendanceForMonth) {
    await clearAttendanceMonth();
  }

  return archive;
}
