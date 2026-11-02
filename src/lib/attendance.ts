import { promises as fs } from "node:fs";
import path from "node:path";

import { AttendanceRequestStatus, EmploymentType, PartTimeMode, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import septemberPayrollCarry from "@/data/payroll-carry-20260930.json";
import { salaryHistoryFor } from "@/lib/salary-history";
import { logChange } from "@/lib/change-log";

import { prisma } from "@/lib/prisma";
import { readWorkCalendar } from "@/lib/work-calendar";
import { resolveWorkCalendar, type WorkCalendarRule } from "@/lib/work-calendar-rules";

export type AttendanceDay = {
  absence?: boolean;
  date: string;
  punches: string[];
  entryTime: string | null;
  exitTime: string | null;
  entryStatus: string;
  exitStatus: string;
  lateMinutes: number;
  lateLabel: string;
  earlyLeaveMinutes: number;
  earlyLeaveLabel: string;
  overtimeMinutes: number;
  overtimeLabel: string;
  status: string;
  manualEntry?: boolean;
  manualExit?: boolean;
  justifiedEntry?: boolean;
  justifiedExit?: boolean;
  justifiedDay?: boolean;
  calendarException?: WorkCalendarRule | null;
};

export type AttendancePerson = {
  personId: string;
  personName: string;
  department: string;
  payrollRole?: string;
  monthlySalary?: number;
  penaltyPerMinute?: number;
  bonusAmount?: number;
  bonusDisabled?: boolean;
  bonusDisabledReason?: string | null;
  extraBonuses?: Record<string, unknown>;
  salaryPaidMonth?: string | null;
  salaryPaidAt?: string | null;
  employmentType?: "FULL_TIME" | "PART_TIME";
  partTimeMode?: "MORNING" | "AFTERNOON" | null;
  totalDays: number;
  completeDays: number;
  lateEntries: number;
  missingEntries: number;
  missingExits: number;
  earlyLeaves: number;
  totalLateMinutes: number;
  totalEarlyLeaveMinutes: number;
  days: AttendanceDay[];
  previousMonthLastDay?: AttendanceDay | null;
  payrollCarryDays?: AttendanceDay[];
};

export type AttendancePayload = {
  sourceFile: string;
  sheetName: string;
  importedAt: string;
  schedule: {
    entry: string;
    exit: string;
    singlePunchCutoff: string;
    entryToleranceMinutes?: number;
  };
  summary: {
    totalPeople: number;
    totalDays: number;
    totalPunches: number;
    completeDays: number;
    lateEntries: number;
    earlyLeaves: number;
    missingEntries: number;
    missingExits: number;
  };
  workCalendar?: WorkCalendarRule[];
  availableDates: string[];
  people: AttendancePerson[];
  profiles?: AttendanceProfile[];
  changeRequests?: AttendanceChangeRequestPayload[];
  changeRequestHistory?: AttendanceChangeRequestPayload[];
};

export type AttendanceProfile = {
  personId: string;
  personName: string;
  department: string;
  payrollRole: string;
  monthlySalary: number;
  penaltyPerMinute?: number;
  bonusAmount?: number;
  bonusDisabled?: boolean;
  bonusDisabledReason?: string | null;
  extraBonuses?: Record<string, unknown>;
  salaryPaidMonth?: string | null;
  salaryPaidAt?: string | null;
  employmentType?: "FULL_TIME" | "PART_TIME";
  partTimeMode?: "MORNING" | "AFTERNOON" | null;
};

type AttendanceOverride = {
  entryTime?: string | null;
  exitTime?: string | null;
  justifiedEntry?: boolean;
  justifiedExit?: boolean;
  justifiedDay?: boolean;
};

export type AttendanceChangeRequestPayload = {
  id: number;
  personId: string;
  personName: string;
  department: string;
  date: string;
  currentEntry: string | null;
  currentExit: string | null;
  requestedEntry: string | null;
  requestedExit: string | null;
  justifiedEntry: boolean;
  justifiedExit: boolean;
  justifiedDay: boolean;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedBy: {
    id: number;
    name: string;
    sede: string;
  };
  decidedBy?: {
    id: number;
    name: string;
    sede: string;
  } | null;
  decidedAt?: string;
  decisionReason?: string | null;
  createdAt: string;
};

type AttendanceOverrides = Record<string, AttendanceOverride>;
type AttendanceProfiles = Record<
  string,
  {
    personId?: string;
    personName?: string;
    payrollRole?: string;
    monthlySalary?: number;
    penaltyPerMinute?: number;
    bonusAmount?: number;
    bonusDisabled?: boolean;
    bonusDisabledReason?: string | null;
    extraBonuses?: Record<string, unknown>;
    salaryPaidMonth?: string | null;
    salaryPaidAt?: string | null;
    employmentType?: "FULL_TIME" | "PART_TIME";
    partTimeMode?: "MORNING" | "AFTERNOON" | null;
  }
>;

function normalizeAttendanceName(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

type RawAttendancePayload = Omit<AttendancePayload, "profiles"> & {
  profiles?: AttendanceProfile[];
};

const EMPTY_ATTENDANCE: AttendancePayload = {
  sourceFile: "",
  sheetName: "",
  importedAt: "",
  schedule: {
    entry: "09:00",
    exit: "18:00",
    singlePunchCutoff: "13:00",
    entryToleranceMinutes: 5,
  },
  summary: {
    totalPeople: 0,
    totalDays: 0,
    totalPunches: 0,
    completeDays: 0,
    lateEntries: 0,
    earlyLeaves: 0,
    missingEntries: 0,
    missingExits: 0,
  },
  availableDates: [],
  people: [],
  changeRequests: [],
  changeRequestHistory: [],
};

const ENTRY_TOLERANCE_MINUTES = 5;
const DUPLICATE_PUNCH_THRESHOLD_SECONDS = 120;
const DEFAULT_ROLE_SALARY: Record<string, number> = {
  "Jefe de Pagos": 3000,
  "Subjefe de Pagos": 2500,
  "Encargado de Pagos": 2000,
  "Jefe de Sede": 1500,
  "Personal Registro": 1250,
  Facturacion: 1500,
  Marketing: 0,
  "Sin definir": 0,
};

const DEFAULT_ROLE_PENALTY: Record<string, number> = {
  "Jefe de Pagos": 1,
  "Subjefe de Pagos": 1,
  "Encargado de Pagos": 1,
  "Jefe de Sede": 0.7,
  "Personal Registro": 0.5,
  Facturacion: 0.7,
  Marketing: 0,
  "Sin definir": 0,
};

const DEFAULT_ROLE_BONUS: Record<string, number> = {
  "Jefe de Pagos": 150,
  "Subjefe de Pagos": 150,
  "Encargado de Pagos": 150,
  "Jefe de Sede": 70,
  "Personal Registro": 50,
  Facturacion: 50,
  Marketing: 50,
  "Sin definir": 0,
};

function defaultBonusForProfile(profile: { payrollRole?: string; employmentType?: string | null }) {
  const baseBonus = DEFAULT_ROLE_BONUS[profile.payrollRole || "Sin definir"] ?? 0;
  if (normalizeEmploymentType(profile.employmentType) === "PART_TIME") {
    return Number((baseBonus / 2).toFixed(2));
  }
  return baseBonus;
}

function attendanceFilePath() {
  return path.join(process.cwd(), "src", "data", "attendance.json");
}

function overridesFilePath() {
  return path.join(process.cwd(), "src", "data", "attendance-overrides.json");
}

function profilesFilePath() {
  return path.join(process.cwd(), "src", "data", "attendance-profiles.json");
}

function toEmploymentType(value: string | null | undefined): EmploymentType {
  return value === "PART_TIME" ? EmploymentType.PART_TIME : EmploymentType.FULL_TIME;
}

function toPartTimeMode(value: string | null | undefined): PartTimeMode | null {
  if (value === "AFTERNOON") return PartTimeMode.AFTERNOON;
  if (value === "MORNING") return PartTimeMode.MORNING;
  return null;
}

function fromEmploymentType(value: EmploymentType | null | undefined): "FULL_TIME" | "PART_TIME" {
  return value === EmploymentType.PART_TIME ? "PART_TIME" : "FULL_TIME";
}

function fromPartTimeMode(value: PartTimeMode | null | undefined): "MORNING" | "AFTERNOON" | null {
  if (value === PartTimeMode.AFTERNOON) return "AFTERNOON";
  if (value === PartTimeMode.MORNING) return "MORNING";
  return null;
}

function normalizeTime(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeTimeToMinute(value: string | null | undefined) {
  const normalized = normalizeTime(value);
  return normalized ? normalized.slice(0, 5) : null;
}

function collapseDuplicatePunchTimes(values: string[]) {
  const normalized = values
    .map((value) => normalizeTime(value))
    .filter((value): value is string => !!value)
    .sort();

  if (!normalized.length) return [];

  const collapsed = [normalized[0]];
  for (const value of normalized.slice(1)) {
    const previous = collapsed[collapsed.length - 1];
    const deltaMinutes = Math.abs((minutesFromTime(value) ?? 0) - (minutesFromTime(previous) ?? 0));
    if (deltaMinutes < 2) {
      continue;
    }
    collapsed.push(value);
  }

  return collapsed;
}

function minutesFromTime(value: string | null | undefined) {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutes(total: number) {
  if (!total) return "0 min";
  const hours = Math.floor(Math.abs(total) / 60);
  const minutes = Math.abs(total) % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes} min`;
}

function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayInLima() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isMonthClosingWorkday(value: string | null | undefined) {
  const date = parseIsoDate(value);
  if (!date) return false;
  const closingDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  if (closingDate.getDay() === 0) {
    closingDate.setDate(closingDate.getDate() - 1);
  }
  return formatIsoDate(date) === formatIsoDate(closingDate);
}

function normalizeEmploymentType(value: string | null | undefined): "FULL_TIME" | "PART_TIME" {
  return value === "PART_TIME" ? "PART_TIME" : "FULL_TIME";
}

function normalizePartTimeMode(value: string | null | undefined): "MORNING" | "AFTERNOON" | null {
  if (value === "MORNING" || value === "AFTERNOON") return value;
  return null;
}

function guessPayrollRole(department: string) {
  const dept = (department || "").trim().toUpperCase();
  if (dept.includes("AREA PAGOS")) return "Encargado de Pagos";
  if (dept.includes("MARKETING")) return "Marketing";
  if (dept.includes("FACTUR")) return "Facturacion";
  if (dept.includes("ATENCION AL CLIENTE")) return "Personal Registro";
  return "Sin definir";
}

function excelDateToDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S);
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function parsePunchRecordTimes(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [value];
  }
  const text = String(value || "").trim();
  if (!text || text.toLowerCase() === "none") return [] as Date[];
  return text
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(segment);
      if (!match) return null;
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3] || 0);
      if (hours > 23 || minutes > 59 || seconds > 59) return null;
      return new Date(2000, 0, 1, hours, minutes, seconds);
    })
    .filter((item): item is Date => !!item);
}

function collapseDuplicatePunchesFromDates(values: Date[]) {
  if (!values.length) return [] as Date[];
  const sorted = [...values].sort((a, b) => a.getTime() - b.getTime());
  const collapsed = [sorted[0]];
  for (const value of sorted.slice(1)) {
    const previous = collapsed[collapsed.length - 1];
    if (Math.abs(value.getTime() - previous.getTime()) <= DUPLICATE_PUNCH_THRESHOLD_SECONDS * 1000) {
      continue;
    }
    collapsed.push(value);
  }
  return collapsed;
}

function summarizeImportedDay(
  personId: string,
  personName: string,
  department: string,
  date: string,
  punches: Date[],
): AttendanceDay {
  const collapsed = collapseDuplicatePunchesFromDates(punches);
  let entryTime: string | null = null;
  let exitTime: string | null = null;

  if (collapsed.length === 1) {
    const only = collapsed[0];
    const normalized = normalizeTime(
      `${String(only.getHours()).padStart(2, "0")}:${String(only.getMinutes()).padStart(2, "0")}:${String(only.getSeconds()).padStart(2, "0")}`,
    );
    const onlyMinutes = only.getHours() * 60 + only.getMinutes();
    entryTime = onlyMinutes <= 13 * 60 ? normalized : null;
    exitTime = onlyMinutes <= 13 * 60 ? null : normalized;
  } else if (collapsed.length > 1) {
    const first = collapsed[0];
    const last = collapsed[collapsed.length - 1];
    entryTime = normalizeTime(`${String(first.getHours()).padStart(2, "0")}:${String(first.getMinutes()).padStart(2, "0")}:${String(first.getSeconds()).padStart(2, "0")}`);
    exitTime = normalizeTime(`${String(last.getHours()).padStart(2, "0")}:${String(last.getMinutes()).padStart(2, "0")}:${String(last.getSeconds()).padStart(2, "0")}`);
  }

  const entryMinutes = minutesFromTime(entryTime);
  const exitMinutes = minutesFromTime(exitTime);
  const lateMinutes =
    entryMinutes === null
      ? 0
      : entryMinutes > 9 * 60 + ENTRY_TOLERANCE_MINUTES
        ? Math.max(0, entryMinutes - 9 * 60)
        : 0;
  const earlyLeaveMinutes = exitMinutes === null ? 0 : Math.max(0, 18 * 60 - exitMinutes);
  const overtimeMinutes = exitMinutes === null ? 0 : Math.max(0, exitMinutes - 18 * 60);

  const entryStatus = entryTime ? (lateMinutes > 0 ? "Tarde" : "A tiempo") : "Sin entrada";
  const exitStatus = exitTime
    ? earlyLeaveMinutes > 0
      ? "Salida anticipada"
      : overtimeMinutes > 0
        ? "Salida extendida"
        : "A tiempo"
    : "Sin salida";
  const status = entryTime && exitTime ? "Completo" : entryTime ? "Falta salida" : exitTime ? "Falta entrada" : "Sin marcajes";

  return {
    date,
    punches: collapsed
      .map((value) =>
        `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}:${String(value.getSeconds()).padStart(2, "0")}`,
      ),
    entryTime,
    exitTime,
    entryStatus,
    exitStatus,
    lateMinutes,
    lateLabel: formatMinutes(lateMinutes),
    earlyLeaveMinutes,
    earlyLeaveLabel: formatMinutes(earlyLeaveMinutes),
    overtimeMinutes,
    overtimeLabel: formatMinutes(overtimeMinutes),
    status,
  };
}

function buildAttendancePayloadFromWorkbook(fileName: string, bytes: Buffer): RawAttendancePayload {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, { header: 1, raw: true });

  if (rows.length < 3) {
    throw new Error("El Excel no tiene suficientes filas para importar la asistencia.");
  }

  const headers = (rows[1] || []).map((value) => String(value || "").trim());
  const headerIndex = new Map(headers.map((value, index) => [value, index]));
  const grouped = new Map<string, { personId: string; personName: string; department: string; date: string; punches: Date[] }>();

  const hasPunchTime = headerIndex.has("Punch Time");
  const hasPunchRecords = headerIndex.has("Punch Records") && headerIndex.has("Date");

  if (!hasPunchTime && !hasPunchRecords) {
    throw new Error("El Excel no tiene un formato compatible. Debe incluir 'Punch Time' o 'Punch Records'.");
  }

  for (const row of rows.slice(2)) {
    const personId = String(row[headerIndex.get("Person ID") ?? -1] || "").trim();
    const personName = String(row[headerIndex.get("Person Name") ?? -1] || "").trim();
    const department = String(row[headerIndex.get("Department") ?? -1] || "").trim();
    if (!personId || !personName) continue;

    let punchDates: Date[] = [];
    let dayDate: Date | null = null;

    if (hasPunchTime) {
      const punch = excelDateToDate(row[headerIndex.get("Punch Time") ?? -1]);
      if (!punch) continue;
      punchDates = [punch];
      dayDate = new Date(punch.getFullYear(), punch.getMonth(), punch.getDate());
    } else {
      const dateValue = excelDateToDate(row[headerIndex.get("Date") ?? -1]);
      const punches = parsePunchRecordTimes(row[headerIndex.get("Punch Records") ?? -1]);
      if (!dateValue || !punches.length) continue;
      dayDate = new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate());
      punchDates = punches.map((punch) => new Date(dayDate!.getFullYear(), dayDate!.getMonth(), dayDate!.getDate(), punch.getHours(), punch.getMinutes(), punch.getSeconds()));
    }

    const date = formatIsoDate(dayDate);
    const key = `${personId}__${date}`;
    const existing = grouped.get(key) || { personId, personName, department, date, punches: [] };
    existing.punches.push(...punchDates);
    grouped.set(key, existing);
  }

  const dayItems = Array.from(grouped.values())
    .map((item) => ({
      personId: item.personId,
      personName: item.personName,
      department: item.department,
      day: summarizeImportedDay(item.personId, item.personName, item.department, item.date, item.punches),
    }))
    .sort((a, b) => `${b.day.date}-${a.personName}`.localeCompare(`${a.day.date}-${b.personName}`));

  if (!dayItems.length) {
    throw new Error("El Excel no trajo marcaciones válidas para importar.");
  }

  const peopleMap = new Map<string, AttendancePerson>();
  let completeDays = 0;
  let lateEntries = 0;
  let earlyLeaves = 0;
  let missingEntries = 0;
  let missingExits = 0;
  let totalPunches = 0;

  for (const item of dayItems) {
    const person =
      peopleMap.get(item.personId) ||
      {
        personId: item.personId,
        personName: item.personName,
        department: item.department,
        totalDays: 0,
        completeDays: 0,
        lateEntries: 0,
        missingEntries: 0,
        missingExits: 0,
        earlyLeaves: 0,
        totalLateMinutes: 0,
        totalEarlyLeaveMinutes: 0,
        days: [],
      };

    person.totalDays += 1;
    person.days.push(item.day);
    if (item.day.entryTime && item.day.exitTime) {
      person.completeDays += 1;
      completeDays += 1;
    }
    if (item.day.lateMinutes > 0) {
      person.lateEntries += 1;
      lateEntries += 1;
    }
    if (!item.day.entryTime) {
      person.missingEntries += 1;
      missingEntries += 1;
    }
    if (!item.day.exitTime) {
      person.missingExits += 1;
      missingExits += 1;
    }
    if (item.day.earlyLeaveMinutes > 0) {
      person.earlyLeaves += 1;
      earlyLeaves += 1;
    }
    person.totalLateMinutes += item.day.lateMinutes;
    person.totalEarlyLeaveMinutes += item.day.earlyLeaveMinutes;
    totalPunches += item.day.punches.length;
    peopleMap.set(item.personId, person);
  }

  const people = Array.from(peopleMap.values()).sort(
    (a, b) => b.totalDays - a.totalDays || b.lateEntries - a.lateEntries || a.personName.localeCompare(b.personName),
  );
  const availableDates = Array.from(new Set(dayItems.map((item) => item.day.date))).sort().reverse();

  return {
    sourceFile: fileName,
    sheetName,
    importedAt: new Date().toISOString(),
    schedule: {
      entry: "09:00",
      exit: "18:00",
      singlePunchCutoff: "13:00",
      entryToleranceMinutes: ENTRY_TOLERANCE_MINUTES,
    },
    summary: {
      totalPeople: people.length,
      totalDays: dayItems.length,
      totalPunches,
      completeDays,
      lateEntries,
      earlyLeaves,
      missingEntries,
      missingExits,
    },
    availableDates,
    people,
    profiles: people.map((person) => {
      const payrollRole = guessPayrollRole(person.department);
      return {
        personId: person.personId,
        personName: person.personName,
        department: person.department,
        payrollRole,
        monthlySalary: DEFAULT_ROLE_SALARY[payrollRole] ?? 0,
        penaltyPerMinute: DEFAULT_ROLE_PENALTY[payrollRole] ?? 0,
        bonusAmount: defaultBonusForProfile({ payrollRole }),
      };
    }),
  };
}

function summarizePeople(people: AttendancePerson[]): AttendancePayload["summary"] {
  return people.reduce<AttendancePayload["summary"]>(
    (summary, person) => {
      summary.totalPeople += 1;
      for (const day of person.days || []) {
        summary.totalDays += 1;
        summary.totalPunches += day.punches.length;
        if (day.entryTime && day.exitTime) summary.completeDays += 1;
        if (day.lateMinutes > 0) summary.lateEntries += 1;
        if (day.earlyLeaveMinutes > 0) summary.earlyLeaves += 1;
        if (!day.entryTime) summary.missingEntries += 1;
        if (!day.exitTime) summary.missingExits += 1;
      }
      return summary;
    },
    {
      totalPeople: 0,
      totalDays: 0,
      totalPunches: 0,
      completeDays: 0,
      lateEntries: 0,
      earlyLeaves: 0,
      missingEntries: 0,
      missingExits: 0,
    },
  );
}

function rebuildPersonTotals(person: AttendancePerson): AttendancePerson {
  let completeDays = 0;
  let lateEntries = 0;
  let missingEntries = 0;
  let missingExits = 0;
  let earlyLeaves = 0;
  let totalLateMinutes = 0;
  let totalEarlyLeaveMinutes = 0;

  const days = [...(person.days || [])].sort((a, b) => b.date.localeCompare(a.date));
  for (const day of days) {
    if (day.entryTime && day.exitTime) completeDays += 1;
    if (day.lateMinutes > 0) lateEntries += 1;
    if (!day.entryTime) missingEntries += 1;
    if (!day.exitTime) missingExits += 1;
    if (day.earlyLeaveMinutes > 0) earlyLeaves += 1;
    totalLateMinutes += day.lateMinutes;
    totalEarlyLeaveMinutes += day.earlyLeaveMinutes;
  }

  return {
    ...person,
    days,
    totalDays: days.length,
    completeDays,
    lateEntries,
    missingEntries,
    missingExits,
    earlyLeaves,
    totalLateMinutes,
    totalEarlyLeaveMinutes,
  };
}

function mergeAttendancePayloads(existing: RawAttendancePayload, incoming: RawAttendancePayload): RawAttendancePayload {
  const incomingDates = new Set(incoming.availableDates || []);
  if (!incomingDates.size) return incoming;

  const peopleById = new Map<string, AttendancePerson>();
  for (const person of existing.people || []) {
    const keptDays = (person.days || []).filter((day) => !incomingDates.has(day.date));
    if (keptDays.length) {
      peopleById.set(person.personId, rebuildPersonTotals({ ...person, days: keptDays }));
    }
  }

  for (const person of incoming.people || []) {
    const previous = peopleById.get(person.personId);
    const nextDays = [...(previous?.days || []), ...(person.days || [])];
    peopleById.set(
      person.personId,
      rebuildPersonTotals({
        ...(previous || person),
        ...person,
        days: nextDays,
      }),
    );
  }

  const people = Array.from(peopleById.values()).sort(
    (a, b) => b.totalDays - a.totalDays || b.lateEntries - a.lateEntries || a.personName.localeCompare(b.personName),
  );
  const existingDates = (existing.availableDates || []).filter((date) => !incomingDates.has(date));
  const availableDates = Array.from(new Set([...existingDates, ...(incoming.availableDates || [])])).sort().reverse();
  const profilesById = new Map<string, AttendanceProfile>();
  for (const profile of existing.profiles || []) profilesById.set(profile.personId, profile);
  for (const profile of incoming.profiles || []) {
    profilesById.set(profile.personId, { ...(profilesById.get(profile.personId) || {}), ...profile });
  }

  return {
    ...EMPTY_ATTENDANCE,
    ...existing,
    sourceFile: incoming.sourceFile || existing.sourceFile || "",
    sheetName: incoming.sheetName || existing.sheetName || "",
    importedAt: incoming.importedAt || new Date().toISOString(),
    schedule: { ...EMPTY_ATTENDANCE.schedule, ...(existing.schedule || {}), ...(incoming.schedule || {}) },
    summary: summarizePeople(people),
    availableDates,
    people,
    profiles: Array.from(profilesById.values()),
  };
}

function shouldAutoCompleteHybridDay(profile?: AttendanceProfiles[string] | AttendanceProfile | null) {
  const role = (profile?.payrollRole || "").trim().toLowerCase();
  return role === "marketing" || role === "facturacion";
}

function isLauraJulyShiftException(profile?: AttendanceProfiles[string] | AttendanceProfile | null, date?: string | null) {
  const personId = String(profile?.personId || "").trim();
  const personName = normalizeAttendanceName(profile?.personName || "");
  const isLaura = personId === "73774814" || personName.includes("laura");
  const day = String(date || "").slice(0, 10);
  return isLaura && day >= "2026-07-10" && day <= "2026-07-31";
}

function isNicolleOctoberShiftException(profile?: AttendanceProfiles[string] | AttendanceProfile | null, date?: string | null) {
  const personId = String(profile?.personId || "").trim();
  const personName = normalizeAttendanceName(profile?.personName || "");
  const isNicolle = personId === "60895202" ||
    personName === "nicolle constancio manco" ||
    personName === "nicole constancio manco";
  const day = String(date || "9999-12-31").slice(0, 10);
  return isNicolle && day >= "2026-10-05";
}

function isVanessaMorningShift(profile?: AttendanceProfiles[string] | AttendanceProfile | null) {
  const personId = String(profile?.personId || "").trim();
  const personName = normalizeAttendanceName(profile?.personName || "");
  return personId === "60975845" || personName.includes("vanessa fernandez");
}

function getEffectiveSchedule(
  schedule: AttendancePayload["schedule"],
  profile?: AttendanceProfiles[string] | AttendanceProfile | null,
  date?: string | null,
  calendar?: WorkCalendarRule | null,
) {
  if (calendar?.kind === "SPECIAL_SHIFT") {
    const entry = Number(calendar.entry.slice(0, 2)) * 60 + Number(calendar.entry.slice(3, 5));
    const exit = Number(calendar.exit.slice(0, 2)) * 60 + Number(calendar.exit.slice(3, 5));
    const middle = Math.floor((entry + exit) / 2);
    return { entry: calendar.entry + ":00", exit: calendar.exit + ":00", cutoff: String(Math.floor(middle / 60)).padStart(2, "0") + ":" + String(middle % 60).padStart(2, "0") + ":00", employmentType: normalizeEmploymentType(profile?.employmentType), partTimeMode: normalizePartTimeMode(profile?.partTimeMode) };
  }
  const personId = String(profile?.personId || "").trim();
  const personName = normalizeAttendanceName(profile?.personName || "");
  if (isNicolleOctoberShiftException(profile, date)) {
    return {
      entry: "09:30:00",
      exit: "18:30:00",
      cutoff: "13:30:00",
      employmentType: "FULL_TIME" as const,
      partTimeMode: null,
    };
  }
  if (isLauraJulyShiftException(profile, date)) {
    return {
      entry: "10:00:00",
      exit: "19:00:00",
      cutoff: "14:00:00",
      employmentType: "FULL_TIME" as const,
      partTimeMode: null,
    };
  }
  if (isVanessaMorningShift(profile)) {
    return {
      entry: "08:00:00",
      exit: "12:00:00",
      cutoff: "10:00:00",
      employmentType: "PART_TIME" as const,
      partTimeMode: "MORNING" as const,
    };
  }

  const employmentType = normalizeEmploymentType(profile?.employmentType);
  const partTimeMode =
    employmentType === "PART_TIME" ? normalizePartTimeMode(profile?.partTimeMode) || "MORNING" : null;

  if (employmentType === "PART_TIME") {
    if (partTimeMode === "AFTERNOON") {
      return {
        entry: "14:00:00",
        exit: "18:00:00",
        cutoff: "16:00:00",
        employmentType,
        partTimeMode,
      };
    }
    return {
      entry: "09:00:00",
      exit: "13:00:00",
      cutoff: "11:00:00",
      employmentType,
      partTimeMode: "MORNING" as const,
    };
  }

  return {
    entry: normalizeTime(schedule.entry) || "09:00:00",
    exit: normalizeTime(schedule.exit) || "18:00:00",
    cutoff: normalizeTime(schedule.singlePunchCutoff) || "13:00:00",
    employmentType,
    partTimeMode,
  };
}

function resolvePunchTimes(
  day: AttendanceDay,
  schedule: AttendancePayload["schedule"],
  profile?: AttendanceProfiles[string] | AttendanceProfile | null,
  calendar?: WorkCalendarRule | null,
) {
  const punches = collapseDuplicatePunchTimes(day.punches || []);

  if (!punches.length) {
    return {
      entryTime: normalizeTime(day.entryTime),
      exitTime: normalizeTime(day.exitTime),
    };
  }

  if (punches.length > 1) {
    return {
      entryTime: punches[0],
      exitTime: punches[punches.length - 1],
    };
  }

  const only = punches[0];
  const onlyMinutes = minutesFromTime(only) ?? 0;
  const cutoffMinutes = minutesFromTime(getEffectiveSchedule(schedule, profile, day.date, calendar).cutoff) ?? 13 * 60;

  return onlyMinutes <= cutoffMinutes
    ? { entryTime: only, exitTime: null }
    : { entryTime: null, exitTime: only };
}

function buildWorkingDates(availableDates: string[]) {
  const parsed = availableDates.map((value) => parseIsoDate(value)).filter((value): value is Date => !!value);
  if (!parsed.length) return availableDates;

  parsed.sort((a, b) => a.getTime() - b.getTime());
  const start = parsed[0];
  const end = parsed[parsed.length - 1];
  const dates: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    if (cursor.getDay() !== 0) {
      dates.push(formatIsoDate(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates.reverse();
}

function recomputeDay(
  day: AttendanceDay,
  schedule: AttendancePayload["schedule"],
  profile?: AttendanceProfiles[string] | AttendanceProfile | null,
  override?: AttendanceOverride,
  calendar?: WorkCalendarRule | null,
  preserveMonthClosingPunches = false,
): AttendanceDay {
  const absences = (profile?.extraBonuses as Record<string, unknown> | undefined)?.__attendanceAbsences as Record<string, boolean> | undefined;
  if (absences?.[day.date]) return { ...day, absence: true, entryTime: null, exitTime: null, entryStatus: "Sin entrada", exitStatus: "Sin salida", status: "Sin marcaje", lateMinutes: 0, lateLabel: "0 min", earlyLeaveMinutes: 0, earlyLeaveLabel: "0 min", overtimeMinutes: 0, overtimeLabel: "0 min", justifiedEntry: false, justifiedExit: false, justifiedDay: false, calendarException: null };
  const isToday = day.date === todayInLima();
  const resolved = resolvePunchTimes(day, schedule, profile, calendar);
  let entryTime = normalizeTime(override?.entryTime ?? resolved.entryTime);
  let exitTime = normalizeTime(override?.exitTime ?? resolved.exitTime);
  const resolvedEntryTime = normalizeTimeToMinute(resolved.entryTime);
  const resolvedExitTime = normalizeTimeToMinute(resolved.exitTime);
  const manualEntry = !!override?.entryTime && normalizeTimeToMinute(override.entryTime) !== resolvedEntryTime;
  const manualExit = !!override?.exitTime && normalizeTimeToMinute(override.exitTime) !== resolvedExitTime;
  const justifiedDay = !!override?.justifiedDay;
  const justifiedEntry = justifiedDay ? false : !!override?.justifiedEntry;
  const justifiedExit = justifiedDay ? false : !!override?.justifiedExit;
  const effectiveSchedule = getEffectiveSchedule(schedule, profile, day.date, calendar);
  const baseEntry = minutesFromTime(effectiveSchedule.entry) ?? 9 * 60;
  const baseExit = minutesFromTime(effectiveSchedule.exit) ?? 18 * 60;
  const tolerance = Number(schedule.entryToleranceMinutes ?? 5);

  if (calendar && calendar.kind !== "SPECIAL_SHIFT") {
    // A company rest day never fabricates punches, even for hybrid profiles.
    return { ...day, entryTime, exitTime, manualEntry, manualExit, justifiedEntry, justifiedExit, justifiedDay,
      calendarException: calendar, entryStatus: calendar.reason, exitStatus: calendar.reason,
      status: calendar.kind === "PAID_REST" ? "Descanso pagado" : "Descanso sin pago",
      lateMinutes: 0, lateLabel: "0 min", earlyLeaveMinutes: 0, earlyLeaveLabel: "0 min", overtimeMinutes: 0, overtimeLabel: "0 min" };
  }
  if (justifiedDay) {
    entryTime = "00:00:00";
    exitTime = "00:00:00";
  } else if (!calendar && !entryTime && !exitTime && shouldAutoCompleteHybridDay(profile)) {
    entryTime = normalizeTime(schedule.entry) || "09:00:00";
    exitTime = normalizeTime(schedule.exit) || "18:00:00";
  } else if (entryTime && !exitTime && !isToday) {
    exitTime = effectiveSchedule.exit;
  }

  const legacyMonthClosing = day.date < "2026-10-31";
  const monthClosingExit =
    isMonthClosingWorkday(day.date) && (minutesFromTime(effectiveSchedule.exit) ?? 0) >= 18 * 60
      ? legacyMonthClosing ? "18:00:00" : effectiveSchedule.exit
      : null;
  if (!preserveMonthClosingPunches && !justifiedDay && !calendar && entryTime && monthClosingExit && !manualExit && (legacyMonthClosing || !resolved.exitTime)) {
    exitTime = monthClosingExit;
  }

  const entryMinutes = minutesFromTime(entryTime);
  const exitMinutes = minutesFromTime(exitTime);

  const lateMinutes =
    entryMinutes === null || justifiedEntry || justifiedDay
      ? 0
      : entryMinutes > baseEntry + tolerance
        ? Math.max(0, entryMinutes - baseEntry)
        : 0;
  const overtimeMinutes = exitMinutes === null || justifiedDay ? 0 : Math.max(0, exitMinutes - baseExit);
  const earlyLeaveMinutes =
    exitMinutes === null || justifiedExit || justifiedDay ? 0 : Math.max(0, baseExit - exitMinutes);

  const entryStatus = justifiedDay
    ? "Justificado"
    : entryTime
    ? justifiedEntry
      ? "Ingreso justificado"
      : lateMinutes > 0
        ? "Tarde"
        : "A tiempo"
    : justifiedEntry
      ? "Falta justificada"
      : "Sin entrada";
  let exitStatus = justifiedDay ? "Justificado" : isToday ? "Pendiente" : "Sin salida";
  if (exitTime && !justifiedDay) {
    if (overtimeMinutes > 0) exitStatus = "Salida extendida";
    else if (justifiedExit) exitStatus = "Salida justificada";
    else if (earlyLeaveMinutes > 0) exitStatus = "Salida anticipada";
    else exitStatus = "A tiempo";
  } else if (justifiedExit) {
    exitStatus = "Falta justificada";
  }

  let status = "Sin marcajes";
  if (justifiedDay) status = "Dia justificado";
  else if (entryTime && exitTime) status = "Completo";
  else if (entryTime) status = isToday ? "Pendiente" : "Falta salida";
  else if (exitTime) status = "Falta entrada";

  return {
    ...day,
    calendarException: calendar || null,
    entryTime,
    exitTime,
    entryStatus,
    exitStatus,
    lateMinutes,
    lateLabel: formatMinutes(lateMinutes),
    earlyLeaveMinutes,
    earlyLeaveLabel: formatMinutes(earlyLeaveMinutes),
    overtimeMinutes,
    overtimeLabel: formatMinutes(overtimeMinutes),
    status,
    manualEntry,
    manualExit,
    justifiedEntry,
    justifiedExit,
    justifiedDay,
  };
}

function rebuildPayload(
  payload: AttendancePayload,
  overrides: AttendanceOverrides,
  profiles: AttendanceProfiles,
  month: string | null = null,
  workCalendar: WorkCalendarRule[] = [],
): AttendancePayload {
  const baseDates = buildWorkingDates(payload.availableDates || []);
  const earliest = baseDates.length ? [...baseDates].sort()[0] : todayInLima();
  const calendarDates = workCalendar.map(rule => rule.date).filter(date => date >= earliest && date <= todayInLima() && new Date(date + "T12:00:00Z").getUTCDay() !== 0);
  const workingDates = [...new Set([...baseDates, ...calendarDates])].filter(date => !month || date.startsWith(month)).sort().reverse();
  const summary = {
    totalPeople: payload.people.length,
    totalDays: 0,
    totalPunches: 0,
    completeDays: 0,
    lateEntries: 0,
    earlyLeaves: 0,
    missingEntries: 0,
    missingExits: 0,
  };

  const people = payload.people.map((person) => {
    const profile = profiles[person.personId] || payload.profiles?.find((item) => item.personId === person.personId) || null;
    const daysByDate = new Map(person.days.map((day) => [day.date, day]));
    let completeDays = 0;
    let lateEntries = 0;
    let missingEntries = 0;
    let missingExits = 0;
    let earlyLeaves = 0;
    let totalLateMinutes = 0;
    let totalEarlyLeaveMinutes = 0;

    const days = workingDates.map((date) => {
      const day =
        daysByDate.get(date) ||
        ({
          date,
          punches: [],
          entryTime: null,
          exitTime: null,
          entryStatus: "Sin entrada",
          exitStatus: "Sin salida",
          lateMinutes: 0,
          lateLabel: "0 min",
          earlyLeaveMinutes: 0,
          earlyLeaveLabel: "0 min",
          overtimeMinutes: 0,
          overtimeLabel: "0 min",
          status: "Sin marcajes",
          justifiedEntry: false,
          justifiedExit: false,
          justifiedDay: false,
        } satisfies AttendanceDay);
      const key = `${person.personId}__${day.date}`;
      const calendarPerson = { ...person, ...profile, personId: person.personId, extraBonuses: profile?.extraBonuses || person.extraBonuses };
      const calendar = resolveWorkCalendar(workCalendar, calendarPerson, date);
      const rebuilt = recomputeDay(day, payload.schedule, profile, overrides[key], calendar);

      summary.totalDays += 1;
      summary.totalPunches += day.punches.length;
      if (rebuilt.entryTime && rebuilt.exitTime) {
        summary.completeDays += 1;
        completeDays += 1;
      }
      if (rebuilt.lateMinutes > 0) {
        summary.lateEntries += 1;
        lateEntries += 1;
      }
      if (!rebuilt.entryTime && !(calendar && calendar.kind !== "SPECIAL_SHIFT")) {
        summary.missingEntries += 1;
        missingEntries += 1;
      }
      if (!rebuilt.exitTime && !(calendar && calendar.kind !== "SPECIAL_SHIFT")) {
        summary.missingExits += 1;
        missingExits += 1;
      }
      if (rebuilt.earlyLeaveMinutes > 0) {
        summary.earlyLeaves += 1;
        earlyLeaves += 1;
      }
      totalLateMinutes += rebuilt.lateMinutes;
      totalEarlyLeaveMinutes += rebuilt.earlyLeaveMinutes;
      return rebuilt;
    });

    return {
      ...person,
      payrollRole: profile?.payrollRole || person.payrollRole || "Sin definir",
      monthlySalary: Number(profile?.monthlySalary ?? person.monthlySalary ?? 0),
      penaltyPerMinute: profile?.penaltyPerMinute ?? person.penaltyPerMinute,
      bonusAmount: Number(profile?.bonusAmount ?? person.bonusAmount ?? defaultBonusForProfile(profile || person)),
      bonusDisabled: !!(profile?.bonusDisabled ?? person.bonusDisabled),
      bonusDisabledReason: profile?.bonusDisabledReason ?? person.bonusDisabledReason ?? null,
      extraBonuses: { ...(profile?.extraBonuses ?? person.extraBonuses ?? {}), __salaryHistory: salaryHistoryFor(person.personId, profile?.extraBonuses ?? person.extraBonuses) },
      salaryPaidMonth: profile?.salaryPaidMonth ?? person.salaryPaidMonth ?? null,
      salaryPaidAt: profile?.salaryPaidAt ?? person.salaryPaidAt ?? null,
      employmentType: normalizeEmploymentType(profile?.employmentType ?? person.employmentType),
      partTimeMode: normalizePartTimeMode(profile?.partTimeMode ?? person.partTimeMode),
      totalDays: days.length,
      completeDays,
      lateEntries,
      missingEntries,
      missingExits,
      earlyLeaves,
      totalLateMinutes,
      totalEarlyLeaveMinutes,
      days,
    };
  });

  return {
    ...payload,
    summary,
    people,
    profiles: people.map((person) => ({
      personId: person.personId,
      personName: person.personName,
      department: person.department,
      payrollRole: person.payrollRole || "Sin definir",
      monthlySalary: Number(person.monthlySalary || 0),
      penaltyPerMinute: person.penaltyPerMinute,
      bonusAmount: person.bonusAmount ?? defaultBonusForProfile(person),
      bonusDisabled: !!person.bonusDisabled,
      bonusDisabledReason: person.bonusDisabledReason ?? null,
      extraBonuses: person.extraBonuses ?? {},
      salaryPaidMonth: person.salaryPaidMonth ?? null,
      salaryPaidAt: person.salaryPaidAt ?? null,
      employmentType: normalizeEmploymentType(person.employmentType),
      partTimeMode: normalizePartTimeMode(person.partTimeMode),
    })),
    workCalendar,
    availableDates: workingDates,
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function bootstrapAttendanceStore() {
  const existing = await prisma.attendanceStore.findUnique({ where: { id: 1 } });
  if (existing) return existing;

  const payload = await readJsonFile<RawAttendancePayload>(attendanceFilePath(), EMPTY_ATTENDANCE);
  const normalizedPayload: RawAttendancePayload = {
    ...EMPTY_ATTENDANCE,
    ...payload,
    schedule: { ...EMPTY_ATTENDANCE.schedule, ...(payload.schedule || {}) },
    summary: { ...EMPTY_ATTENDANCE.summary, ...(payload.summary || {}) },
    availableDates: payload.availableDates || [],
    people: payload.people || [],
    profiles: payload.profiles || [],
  };

  const store = await prisma.attendanceStore.create({
    data: {
      id: 1,
      sourceFile: normalizedPayload.sourceFile || "",
      sheetName: normalizedPayload.sheetName || "",
      importedAt: normalizedPayload.importedAt ? new Date(normalizedPayload.importedAt) : null,
      payload: normalizedPayload as unknown as object,
    },
  });

  const overrides = await readJsonFile<AttendanceOverrides>(overridesFilePath(), {});
  const overrideRows = Object.entries(overrides).map(([key, value]) => {
    const [personId, date] = key.split("__");
    return {
      personId,
      date,
      entryTime: value.entryTime ?? null,
      exitTime: value.exitTime ?? null,
      justifiedEntry: !!value.justifiedEntry,
      justifiedExit: !!value.justifiedExit,
      justifiedDay: !!value.justifiedDay,
    };
  });
  if (overrideRows.length) {
    await prisma.attendanceOverride.createMany({ data: overrideRows, skipDuplicates: true });
  }

  const fileProfiles = await readJsonFile<AttendanceProfiles>(profilesFilePath(), {});
  const profileMap = new Map<string, AttendanceProfile>();
  for (const profile of normalizedPayload.profiles || []) {
    profileMap.set(profile.personId, profile);
  }
  for (const [personId, profile] of Object.entries(fileProfiles)) {
    const existingProfile = profileMap.get(personId);
    profileMap.set(personId, {
      personId,
      personName: existingProfile?.personName || personId,
      department: existingProfile?.department || "",
      payrollRole: profile.payrollRole || existingProfile?.payrollRole || "Sin definir",
      monthlySalary: Number(profile.monthlySalary ?? existingProfile?.monthlySalary ?? 0),
      penaltyPerMinute: profile.penaltyPerMinute ?? existingProfile?.penaltyPerMinute,
      bonusAmount: Number(profile.bonusAmount ?? existingProfile?.bonusAmount ?? defaultBonusForProfile(profile)),
      bonusDisabled: !!(profile.bonusDisabled ?? existingProfile?.bonusDisabled),
      bonusDisabledReason: profile.bonusDisabledReason ?? existingProfile?.bonusDisabledReason ?? null,
      extraBonuses: profile.extraBonuses ?? existingProfile?.extraBonuses ?? {},
      salaryPaidMonth: profile.salaryPaidMonth ?? existingProfile?.salaryPaidMonth ?? null,
      salaryPaidAt: profile.salaryPaidAt ?? existingProfile?.salaryPaidAt ?? null,
      employmentType: normalizeEmploymentType(profile.employmentType ?? existingProfile?.employmentType),
      partTimeMode: normalizePartTimeMode(profile.partTimeMode ?? existingProfile?.partTimeMode),
    });
  }
  const profileRows = Array.from(profileMap.values()).map((profile) => ({
    personId: profile.personId,
    personName: profile.personName,
    department: profile.department,
    payrollRole: profile.payrollRole,
    monthlySalary: Number(profile.monthlySalary || 0),
    penaltyPerMinute: profile.penaltyPerMinute,
    bonusAmount: profile.bonusAmount ?? defaultBonusForProfile(profile),
    bonusDisabled: !!profile.bonusDisabled,
    bonusDisabledReason: profile.bonusDisabledReason ?? null,
    extraBonuses: (profile.extraBonuses ?? {}) as Prisma.InputJsonValue,
    salaryPaidMonth: profile.salaryPaidMonth ?? null,
    salaryPaidAt: profile.salaryPaidAt ? new Date(profile.salaryPaidAt) : null,
    employmentType: toEmploymentType(profile.employmentType),
    partTimeMode: toPartTimeMode(profile.partTimeMode),
  }));
  if (profileRows.length) {
    await prisma.attendanceProfile.createMany({ data: profileRows, skipDuplicates: true });
  }

  return store;
}

async function readAttendanceStorePayload(): Promise<RawAttendancePayload> {
  const store = await bootstrapAttendanceStore();
  const payload = (store.payload || {}) as RawAttendancePayload;
  return {
    ...EMPTY_ATTENDANCE,
    ...payload,
    sourceFile: store.sourceFile || payload.sourceFile || "",
    sheetName: store.sheetName || payload.sheetName || "",
    importedAt: store.importedAt?.toISOString() || payload.importedAt || "",
    schedule: { ...EMPTY_ATTENDANCE.schedule, ...(payload.schedule || {}) },
    summary: { ...EMPTY_ATTENDANCE.summary, ...(payload.summary || {}) },
    availableDates: payload.availableDates || [],
    people: payload.people || [],
    profiles: payload.profiles || [],
  };
}

export async function importZlinkPunches(rows: Array<{ personId: string; date: string; time: string }>) {
  await bootstrapAttendanceStore();
  const profiles = await prisma.attendanceProfile.findMany();
  const profilesById = new Map(profiles.map(profile => [profile.personId, profile]));
  // Optimistic concurrency prevents overlapping syncs or Excel imports from losing days.
  for (let attempt = 0; attempt < 3; attempt++) {
    const store = await prisma.attendanceStore.findUniqueOrThrow({ where: { id: 1 } });
    const current = { ...EMPTY_ATTENDANCE, ...(store.payload as unknown as RawAttendancePayload) };
    const people = new Map(current.people.map(person => [person.personId, { ...person, days: [...person.days] }]));
    let addedPunches = 0;
    const touchedPeople = new Set<string>();
    const groups = new Map<string, { personId: string; date: string; times: Set<string> }>();
    for (const row of rows) {
      const profile = profilesById.get(row.personId);
      if (!profile || (profile.extraBonuses as Record<string, unknown> | null)?.__inactive) continue;
      const key = `${row.personId}|${row.date}`;
      const group = groups.get(key) || { personId: row.personId, date: row.date, times: new Set<string>() };
      group.times.add(row.time);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const profile = profilesById.get(group.personId)!;
      const person = people.get(group.personId) || {
        personId: group.personId, personName: profile.personName, department: profile.department,
        totalDays: 0, completeDays: 0, lateEntries: 0, missingEntries: 0, missingExits: 0,
        earlyLeaves: 0, totalLateMinutes: 0, totalEarlyLeaveMinutes: 0, days: [],
      };
      const existingDay = person.days.find(day => day.date === group.date);
      const times = new Set((existingDay?.punches || []).map(time => normalizeTime(time)).filter((time): time is string => !!time));
      const before = times.size;
      group.times.forEach(time => times.add(time));
      if (before === times.size) continue;
      const dates = Array.from(times).map(time => new Date(`${group.date}T${time}`));
      const day = summarizeImportedDay(person.personId, person.personName, person.department, group.date, dates);
      if (JSON.stringify(day.punches) === JSON.stringify(existingDay?.punches || [])) continue;
      person.days = [...person.days.filter(item => item.date !== group.date), day];
      people.set(person.personId, rebuildPersonTotals(person));
      addedPunches += times.size - before;
      touchedPeople.add(person.personId);
    }
    if (!addedPunches) return { addedPunches: 0, updatedPeople: 0 };
    const allPeople = Array.from(people.values());
    const now = new Date();
    const payload = {
      ...current, sourceFile: "Zlink API", sheetName: "Marcajes Zlink", importedAt: now.toISOString(),
      people: allPeople, summary: summarizePeople(allPeople),
      availableDates: Array.from(new Set(allPeople.flatMap(person => person.days.map(day => day.date)))).sort().reverse(),
    };
    const saved = await prisma.attendanceStore.updateMany({
      where: { id: 1, updatedAt: store.updatedAt },
      data: { payload: payload as unknown as Prisma.InputJsonValue, importedAt: now, sourceFile: "Zlink API", sheetName: "Marcajes Zlink" },
    });
    if (saved.count) return { addedPunches, updatedPeople: touchedPeople.size };
  }
  throw new Error("La asistencia cambio durante la sincronizacion. Vuelve a intentarlo.");
}

export async function importAttendanceWorkbook(fileName: string, bytes: Buffer) {
  const generated = buildAttendancePayloadFromWorkbook(fileName || "attendance-upload.xlsx", bytes);
  await bootstrapAttendanceStore();
  const current = await readAttendanceStorePayload();
  const merged = mergeAttendancePayloads(current, generated);
  await prisma.attendanceStore.upsert({
    where: { id: 1 },
    update: {
      sourceFile: merged.sourceFile || "",
      sheetName: merged.sheetName || "",
      importedAt: merged.importedAt ? new Date(merged.importedAt) : new Date(),
      payload: merged as unknown as object,
    },
    create: {
      id: 1,
      sourceFile: merged.sourceFile || "",
      sheetName: merged.sheetName || "",
      importedAt: merged.importedAt ? new Date(merged.importedAt) : new Date(),
      payload: merged as unknown as object,
    },
  });

  const existingProfiles = await prisma.attendanceProfile.findMany({
    select: { personId: true },
  });
  const existingProfileIds = new Set(existingProfiles.map((item) => item.personId));
  const newProfiles = (generated.profiles || [])
    .filter((profile) => !existingProfileIds.has(profile.personId))
    .map((profile) => ({
      personId: profile.personId,
      personName: profile.personName,
      department: profile.department,
      payrollRole: profile.payrollRole || "Sin definir",
      monthlySalary: Number(profile.monthlySalary || 0),
      penaltyPerMinute: profile.penaltyPerMinute,
      bonusAmount: profile.bonusAmount ?? defaultBonusForProfile(profile),
      extraBonuses: (profile.extraBonuses ?? {}) as Prisma.InputJsonValue,
      employmentType: toEmploymentType(profile.employmentType),
      partTimeMode: toPartTimeMode(profile.partTimeMode),
    }));
  if (newProfiles.length) {
    await prisma.attendanceProfile.createMany({
      data: newProfiles,
      skipDuplicates: true,
    });
  }
}

export async function readAttendanceOverrides(month: string | null = null): Promise<AttendanceOverrides> {
  await bootstrapAttendanceStore();
  const rows = await prisma.attendanceOverride.findMany({ where: month ? { date: { startsWith: month } } : undefined });
  return rows.reduce<AttendanceOverrides>((acc, row) => {
    acc[`${row.personId}__${row.date}`] = {
      entryTime: row.entryTime ?? undefined,
      exitTime: row.exitTime ?? undefined,
      justifiedEntry: row.justifiedEntry,
      justifiedExit: row.justifiedExit,
      justifiedDay: row.justifiedDay,
    };
    return acc;
  }, {});
}

export async function readAttendanceProfiles(): Promise<AttendanceProfiles> {
  await bootstrapAttendanceStore();
  const rows = await prisma.attendanceProfile.findMany();
  return rows.reduce<AttendanceProfiles>((acc, row) => {
    acc[row.personId] = {
      payrollRole: row.payrollRole,
      monthlySalary: Number(row.monthlySalary || 0),
      penaltyPerMinute: row.penaltyPerMinute === null ? undefined : Number(row.penaltyPerMinute),
      bonusAmount: row.bonusAmount === null ? undefined : Number(row.bonusAmount),
      bonusDisabled: row.bonusDisabled,
      bonusDisabledReason: row.bonusDisabledReason,
      extraBonuses: (row.extraBonuses && typeof row.extraBonuses === "object" ? row.extraBonuses : {}) as Record<string, unknown>,
      salaryPaidMonth: row.salaryPaidMonth,
      salaryPaidAt: row.salaryPaidAt?.toISOString() ?? null,
      employmentType: fromEmploymentType(row.employmentType),
      partTimeMode: fromPartTimeMode(row.partTimeMode),
    };
    return acc;
  }, {});
}

export async function writeAttendanceOverride(input: {
  absence?: boolean;
  personId: string;
  date: string;
  entryTime?: string | null;
  exitTime?: string | null;
  justifiedEntry?: boolean;
  justifiedExit?: boolean;
  justifiedDay?: boolean;
}) {
  const entryTime =
    input.entryTime === undefined ? undefined : input.entryTime === null || input.entryTime === "" ? null : normalizeTime(input.entryTime);
  const exitTime =
    input.exitTime === undefined ? undefined : input.exitTime === null || input.exitTime === "" ? null : normalizeTime(input.exitTime);

  if (input.entryTime !== undefined && input.entryTime !== null && input.entryTime !== "" && !entryTime) {
    throw new Error("La hora de entrada manual debe tener formato HH:MM.");
  }
  if (input.exitTime !== undefined && input.exitTime !== null && input.exitTime !== "" && !exitTime) {
    throw new Error("La hora de salida manual debe tener formato HH:MM.");
  }

  await bootstrapAttendanceStore();
  if (typeof input.absence === "boolean") {
    const profile = await prisma.attendanceProfile.findUnique({ where: { personId: input.personId } });
    const original = profile ? null : (await readAttendanceStorePayload()).people.find(person => person.personId === input.personId);
    const extra = (profile?.extraBonuses || original?.extraBonuses || {}) as Record<string, unknown>;
    const absences = { ...((extra.__attendanceAbsences || {}) as Record<string, boolean>) };
    if (input.absence) absences[input.date] = true; else delete absences[input.date];
    const extraBonuses = { ...extra, __attendanceAbsences: absences } as Prisma.InputJsonValue;
    await prisma.attendanceProfile.upsert({ where: { personId: input.personId }, update: { extraBonuses }, create: { personId: input.personId, personName: original?.personName || input.personId, department: original?.department || "", payrollRole: original?.payrollRole || "Sin definir", monthlySalary: original?.monthlySalary || 0, penaltyPerMinute: original?.penaltyPerMinute, bonusAmount: original?.bonusAmount || 0, employmentType: toEmploymentType(normalizeEmploymentType(original?.employmentType)), partTimeMode: toPartTimeMode(normalizePartTimeMode(original?.partTimeMode)), extraBonuses } });
    if (input.absence) return; // Preserve all original punches and previous manual corrections.
  }
  await prisma.attendanceOverride.upsert({
    where: {
      personId_date: {
        personId: input.personId,
        date: input.date,
      },
    },
    update: {
      ...(input.entryTime !== undefined ? { entryTime } : {}),
      ...(input.exitTime !== undefined ? { exitTime } : {}),
      ...(input.justifiedEntry !== undefined || input.justifiedDay ? { justifiedEntry: input.justifiedDay ? false : !!input.justifiedEntry } : {}),
      ...(input.justifiedExit !== undefined || input.justifiedDay ? { justifiedExit: input.justifiedDay ? false : !!input.justifiedExit } : {}),
      ...(input.justifiedDay !== undefined ? { justifiedDay: !!input.justifiedDay } : {}),
    },
    create: {
      personId: input.personId,
      date: input.date,
      entryTime: entryTime ?? null,
      exitTime: exitTime ?? null,
      justifiedEntry: input.justifiedDay ? false : !!input.justifiedEntry,
      justifiedExit: input.justifiedDay ? false : !!input.justifiedExit,
      justifiedDay: !!input.justifiedDay,
    },
  });
}

export async function createAttendanceChangeRequest(input: {
  absence?: boolean;
  personId: string;
  personName: string;
  department: string;
  date: string;
  currentEntry?: string | null;
  currentExit?: string | null;
  requestedEntry?: string | null;
  requestedExit?: string | null;
  justifiedEntry?: boolean;
  justifiedExit?: boolean;
  justifiedDay?: boolean;
  reason: string;
  requestedById: number;
}) {
  const requestedEntry =
    input.requestedEntry === undefined || input.requestedEntry === null || input.requestedEntry === ""
      ? null
      : normalizeTime(input.requestedEntry);
  const requestedExit =
    input.requestedExit === undefined || input.requestedExit === null || input.requestedExit === ""
      ? null
      : normalizeTime(input.requestedExit);
  const currentEntry = input.currentEntry ? normalizeTime(input.currentEntry) : null;
  const currentExit = input.currentExit ? normalizeTime(input.currentExit) : null;
  const reason = input.reason.trim();

  if (!reason) {
    throw new Error("Debes indicar el motivo del cambio.");
  }
  if (input.requestedEntry && !requestedEntry) {
    throw new Error("La entrada solicitada debe tener formato HH:MM.");
  }
  if (input.requestedExit && !requestedExit) {
    throw new Error("La salida solicitada debe tener formato HH:MM.");
  }

  await prisma.attendanceChangeRequest.create({
    data: {
      personId: input.personId,
      personName: input.personName,
      department: input.department,
      date: input.date,
      currentEntry,
      currentExit,
      requestedEntry,
      requestedExit,
      justifiedEntry: input.justifiedDay ? false : !!input.justifiedEntry,
      justifiedExit: input.justifiedDay ? false : !!input.justifiedExit,
      justifiedDay: !!input.justifiedDay,
      reason: input.absence === true ? `[FALTA] ${reason}` : input.absence === false ? `[ASISTENCIA] ${reason}` : reason,
      requestedById: input.requestedById,
    },
  });
}

export async function readPendingAttendanceChangeRequests(): Promise<AttendanceChangeRequestPayload[]> {
  return readAttendanceChangeRequestsByStatus([AttendanceRequestStatus.PENDING]);
}

export async function readAttendanceChangeRequestHistory(): Promise<AttendanceChangeRequestPayload[]> {
  return readAttendanceChangeRequestsByStatus([
    AttendanceRequestStatus.APPROVED,
    AttendanceRequestStatus.REJECTED,
  ]);
}

async function readAttendanceChangeRequestsByStatus(
  statuses: AttendanceRequestStatus[],
): Promise<AttendanceChangeRequestPayload[]> {
  await bootstrapAttendanceStore();
  const rows = await prisma.attendanceChangeRequest.findMany({
    where: { status: { in: statuses } },
    include: {
      requestedBy: {
        select: {
          id: true,
          name: true,
          sede: true,
        },
      },
      decidedBy: {
        select: {
          id: true,
          name: true,
          sede: true,
        },
      },
    },
    orderBy: [
      { decidedAt: "desc" },
      { createdAt: "desc" },
    ],
  });

  return rows.map((row) => ({
    id: row.id,
    personId: row.personId,
    personName: row.personName,
    department: row.department,
    date: row.date,
    currentEntry: row.currentEntry,
    currentExit: row.currentExit,
    requestedEntry: row.requestedEntry,
    requestedExit: row.requestedExit,
    justifiedEntry: row.justifiedEntry,
    justifiedExit: row.justifiedExit,
    justifiedDay: row.justifiedDay,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() || "",
    decisionReason: row.decisionReason,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function decideAttendanceChangeRequest(input: {
  requestId: number;
  action: "approve" | "reject";
  decidedById: number;
  decisionReason?: string | null;
}) {
  const request = await prisma.attendanceChangeRequest.findUnique({ where: { id: input.requestId } });
  if (!request) {
    throw new Error("Solicitud no encontrada.");
  }
  if (request.status !== AttendanceRequestStatus.PENDING) {
    throw new Error("Esta solicitud ya fue revisada.");
  }

  if (input.action === "approve") {
    await writeAttendanceOverride({
      ...(request.reason.startsWith("[FALTA] ") ? { absence: true } : request.reason.startsWith("[ASISTENCIA] ") ? { absence: false } : {}),
      personId: request.personId,
      date: request.date,
      entryTime: request.justifiedDay ? "00:00" : request.requestedEntry ?? undefined,
      exitTime: request.justifiedDay ? "00:00" : request.requestedExit ?? undefined,
      justifiedEntry: request.justifiedDay ? false : request.justifiedEntry,
      justifiedExit: request.justifiedDay ? false : request.justifiedExit,
      justifiedDay: request.justifiedDay,
    });
  }

  await prisma.attendanceChangeRequest.update({
    where: { id: request.id },
    data: {
      status: input.action === "approve" ? AttendanceRequestStatus.APPROVED : AttendanceRequestStatus.REJECTED,
      decidedById: input.decidedById,
      decidedAt: new Date(),
      decisionReason: input.decisionReason?.trim() || null,
    },
  });
  await logChange({actorId:input.decidedById,module:"Asistencia",action:input.action==="approve"?"APROBAR_SOLICITUD":"RECHAZAR_SOLICITUD",summary:`${input.action==="approve"?"Aprobó":"Rechazó"} cambio de ${request.personName}, ${request.date}.`,targetType:"AttendanceChangeRequest",targetId:request.id,before:{entry:request.currentEntry,exit:request.currentExit},after:{entry:request.requestedEntry,exit:request.requestedExit,justifiedDay:request.justifiedDay,reason:request.reason,decision:input.action,decisionReason:input.decisionReason}});
}

export async function deletePendingAttendanceChangeRequests(requestIds: number[]) {
  const ids = [...new Set(requestIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) {
    throw new Error("Selecciona al menos una solicitud.");
  }
  return prisma.attendanceChangeRequest.deleteMany({
    where: {
      id: { in: ids },
      status: AttendanceRequestStatus.PENDING,
    },
  });
}

export async function approvePendingAttendanceChangeRequests(requestIds: number[], decidedById: number) {
  const ids = [...new Set(requestIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) {
    throw new Error("Selecciona al menos una solicitud.");
  }
  for (const requestId of ids) {
    await decideAttendanceChangeRequest({ requestId, action: "approve", decidedById });
  }
  return ids.length;
}

export async function writeAttendanceProfile(input: {
  personId: string;
  payrollRole: string;
  monthlySalary: number;
  salaryEffectiveMonth?: string;
  actorId?: number;
  penaltyPerMinute?: number;
  bonusAmount?: number;
  bonusDisabled?: boolean;
  bonusDisabledReason?: string | null;
  extraBonuses?: Record<string, unknown>;
  employmentType?: string;
  partTimeMode?: string | null;
}) {
  const salary = Number(input.monthlySalary);
  if (Number.isNaN(salary) || salary < 0) {
    throw new Error("El sueldo mensual debe ser un número válido.");
  }
  const role = (input.payrollRole || "").trim();
  if (!role) {
    throw new Error("Debes seleccionar un cargo.");
  }
  const penaltyPerMinute = Number(input.penaltyPerMinute ?? DEFAULT_ROLE_PENALTY[role] ?? 0);
  if (Number.isNaN(penaltyPerMinute) || penaltyPerMinute < 0) {
    throw new Error("La penalidad por minuto debe ser un número válido.");
  }
  const employmentType = normalizeEmploymentType(input.employmentType);
  const partTimeMode = employmentType === "PART_TIME" ? normalizePartTimeMode(input.partTimeMode) || "MORNING" : null;
  const bonusAmount = Number(input.bonusAmount ?? defaultBonusForProfile({ payrollRole: role, employmentType }));
  if (Number.isNaN(bonusAmount) || bonusAmount < 0) {
    throw new Error("El bono mensual debe ser un número válido.");
  }

  await bootstrapAttendanceStore();
  const payload = await readAttendanceStorePayload();
  const person =
    payload.people.find((item) => item.personId === input.personId) ||
    payload.profiles?.find((item) => item.personId === input.personId);

  const existing = await prisma.attendanceProfile.findUnique({ where: { personId: input.personId } });
  const currentMonth = todayInLima().slice(0, 7);
  const effectiveMonth = input.salaryEffectiveMonth || currentMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveMonth) || effectiveMonth > currentMonth) throw new Error("Indica un mes de vigencia válido, hasta el mes actual.");
  const history = salaryHistoryFor(input.personId, existing?.extraBonuses);
  const previous = existing || person;
  if (!history.length && previous) history.push({ effectiveMonth: "0001-01", monthlySalary: Number(previous.monthlySalary || 0), payrollRole: previous.payrollRole, employmentType: previous.employmentType, partTimeMode: previous.partTimeMode, source: "prior-value-undated" });
  const changed = !previous || salary !== Number(previous.monthlySalary) || role !== previous.payrollRole || employmentType !== previous.employmentType || partTimeMode !== (previous.partTimeMode || null);
  if (changed || input.salaryEffectiveMonth) {
    const index = history.findIndex(entry => entry.effectiveMonth === effectiveMonth);
    const entry = { effectiveMonth, monthlySalary: salary, payrollRole: role, employmentType, partTimeMode, source: "profile-edit", recordedAt: new Date().toISOString(), actorId: input.actorId };
    if (index < 0) history.push(entry); else history[index] = entry;
  }
  history.sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  const latest = history[history.length - 1];
  const currentSalary = latest?.monthlySalary ?? salary;
  const currentRole = latest?.payrollRole || existing?.payrollRole || role;
  const currentEmploymentType = normalizeEmploymentType(latest?.employmentType || existing?.employmentType || employmentType);
  const currentPartTimeMode = currentEmploymentType === "PART_TIME" ? normalizePartTimeMode(latest?.partTimeMode || existing?.partTimeMode || partTimeMode) : null;
  const protectedExtra = (existing?.extraBonuses || person?.extraBonuses || {}) as Record<string, unknown>;
  const mergedExtra = { ...protectedExtra, ...(input.extraBonuses || {}), __salaryHistory: history, __attendanceAbsences: protectedExtra.__attendanceAbsences || {} };

  await prisma.attendanceProfile.upsert({
    where: { personId: input.personId },
    update: {
      personName: person?.personName || input.personId,
      department: person?.department || "",
      payrollRole: currentRole,
      monthlySalary: currentSalary,
      penaltyPerMinute,
      bonusAmount,
      bonusDisabled: !!input.bonusDisabled,
      bonusDisabledReason: input.bonusDisabled ? input.bonusDisabledReason?.trim() || "Indisciplina" : null,
      extraBonuses: mergedExtra as unknown as Prisma.InputJsonValue,
      employmentType: toEmploymentType(currentEmploymentType),
      partTimeMode: toPartTimeMode(currentPartTimeMode),
    },
    create: {
      personId: input.personId,
      personName: person?.personName || input.personId,
      department: person?.department || "",
      payrollRole: currentRole,
      monthlySalary: currentSalary,
      penaltyPerMinute,
      bonusAmount,
      bonusDisabled: !!input.bonusDisabled,
      bonusDisabledReason: input.bonusDisabled ? input.bonusDisabledReason?.trim() || "Indisciplina" : null,
      extraBonuses: mergedExtra as unknown as Prisma.InputJsonValue,
      employmentType: toEmploymentType(currentEmploymentType),
      partTimeMode: toPartTimeMode(currentPartTimeMode),
    },
  });
}

export async function updateAttendanceBonus(input: {
  personId: string;
  bonusDisabled: boolean;
  bonusDisabledReason?: string | null;
}) {
  await bootstrapAttendanceStore();
  const profile = await prisma.attendanceProfile.findUnique({ where: { personId: input.personId } });
  if (!profile) {
    throw new Error("No se encontró el perfil de asistencia.");
  }
  await prisma.attendanceProfile.update({
    where: { personId: input.personId },
    data: {
      bonusDisabled: input.bonusDisabled,
      bonusDisabledReason: input.bonusDisabled ? input.bonusDisabledReason?.trim() || "Indisciplina" : null,
    },
  });
}

export async function markAttendanceSalaryPaid(input: {
  personId: string;
  month: string;
  paid: boolean;
}) {
  await bootstrapAttendanceStore();
  const profile = await prisma.attendanceProfile.findUnique({ where: { personId: input.personId } });
  if (!profile) {
    throw new Error("No se encontró el perfil de asistencia.");
  }
  const extraBonuses = (profile.extraBonuses && typeof profile.extraBonuses === "object" && !Array.isArray(profile.extraBonuses)
    ? profile.extraBonuses
    : {}) as Record<string, unknown>;
  await prisma.attendanceProfile.update({
    where: { personId: input.personId },
    data: {
      salaryPaidMonth: input.paid ? input.month : null,
      salaryPaidAt: input.paid ? new Date() : null,
      ...(!input.paid
        ? {
            extraBonuses: {
              ...extraBonuses,
              __commissionPaidMonth: null,
              __commissionPaidAt: null,
            } as Prisma.InputJsonObject,
          }
        : {}),
    },
  });
}

export async function markAttendanceSalariesPaid(input: { personIds: string[]; month: string }) {
  const personIds = [...new Set((input.personIds || []).map((personId) => String(personId || "").trim()).filter(Boolean))];
  if (!personIds.length) throw new Error("No hay sueldos pendientes para pagar.");
  await Promise.all(personIds.map((personId) => markAttendanceSalaryPaid({ personId, month: input.month, paid: true })));
  return { count: personIds.length };
}

export async function markAttendanceAllCommissionsPaid(input: { personIds: string[]; month: string }) {
  await bootstrapAttendanceStore();
  const personIds = [...new Set(input.personIds.map(id => id.trim()).filter(Boolean))];
  if (!personIds.length || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new Error("Datos de pago inválidos.");
  return prisma.$transaction(async tx => {
    const profiles = await tx.attendanceProfile.findMany({ where: { personId: { in: personIds } } });
    if (profiles.length !== personIds.length) throw new Error("No se encontraron todos los colaboradores.");
    if (profiles.some(profile => profile.salaryPaidMonth !== input.month)) throw new Error("Primero debes marcar los sueldos como pagados.");
    let count = 0;
    const paidAt = new Date().toISOString();
    for (const profile of profiles) {
      const extra = (profile.extraBonuses && typeof profile.extraBonuses === "object" && !Array.isArray(profile.extraBonuses) ? profile.extraBonuses : {}) as Record<string, unknown>;
      if (extra.__commissionPaidMonth === input.month) continue;
      await tx.attendanceProfile.update({ where: { personId: profile.personId }, data: { extraBonuses: { ...extra, __commissionPaidMonth: input.month, __commissionPaidAt: paidAt } as Prisma.InputJsonObject } });
      count++;
    }
    return { count };
  }, { timeout: 30000, maxWait: 10000 });
}

export async function markAttendanceCommissionsPaid(input: {
  personId: string;
  month: string;
  paid: boolean;
}) {
  await bootstrapAttendanceStore();
  const profile = await prisma.attendanceProfile.findUnique({ where: { personId: input.personId } });
  if (!profile) {
    throw new Error("No se encontró el perfil de asistencia.");
  }
  if (input.paid && profile.salaryPaidMonth !== input.month) {
    throw new Error("Primero debes marcar el sueldo como pagado.");
  }
  const extraBonuses = (profile.extraBonuses && typeof profile.extraBonuses === "object" && !Array.isArray(profile.extraBonuses)
    ? profile.extraBonuses
    : {}) as Record<string, unknown>;
  await prisma.attendanceProfile.update({
    where: { personId: input.personId },
    data: {
      extraBonuses: {
        ...extraBonuses,
        __commissionPaidMonth: input.paid ? input.month : null,
        __commissionPaidAt: input.paid ? new Date().toISOString() : null,
      } as Prisma.InputJsonObject,
    },
  });
}

export async function clearAttendanceMonth() {
  await bootstrapAttendanceStore();
  await prisma.attendanceStore.upsert({
    where: { id: 1 },
    update: {
      sourceFile: "",
      sheetName: "",
      importedAt: null,
      payload: EMPTY_ATTENDANCE as unknown as object,
    },
    create: {
      id: 1,
      sourceFile: "",
      sheetName: "",
      importedAt: null,
      payload: EMPTY_ATTENDANCE as unknown as object,
    },
  });
  await prisma.attendanceOverride.deleteMany();
}

export async function deleteAttendanceCollaborator(personId: string) {
  const cleanPersonId = String(personId || "").trim();
  if (!cleanPersonId) {
    throw new Error("Colaborador invalido.");
  }

  await bootstrapAttendanceStore();
  const payload = await readAttendanceStorePayload();
  const person =
    (payload.people || []).find((item) => item.personId === cleanPersonId) ||
    (payload.profiles || []).find((item) => item.personId === cleanPersonId);
  const existingProfile = await prisma.attendanceProfile.findUnique({ where: { personId: cleanPersonId } });
  if (!person && !existingProfile) {
    throw new Error("No se encontro el colaborador.");
  }

  const existingExtraBonuses = (existingProfile?.extraBonuses && typeof existingProfile.extraBonuses === "object" && !Array.isArray(existingProfile.extraBonuses)
    ? existingProfile.extraBonuses
    : person?.extraBonuses && typeof person.extraBonuses === "object" && !Array.isArray(person.extraBonuses)
      ? person.extraBonuses
      : {}) as Record<string, unknown>;
  const role = existingProfile?.payrollRole || person?.payrollRole || "Sin definir";
  const employmentType = normalizeEmploymentType(existingProfile?.employmentType || person?.employmentType);
  const partTimeMode = normalizePartTimeMode(existingProfile?.partTimeMode || person?.partTimeMode);
  const inactiveExtraBonuses = {
    ...existingExtraBonuses,
    __inactive: true,
    __inactiveAt: new Date().toISOString(),
    __reactivatedAt: null,
  };

  await prisma.attendanceProfile.upsert({
    where: { personId: cleanPersonId },
    update: {
      extraBonuses: inactiveExtraBonuses as Prisma.InputJsonObject,
    },
    create: {
      personId: cleanPersonId,
      personName: existingProfile?.personName || person?.personName || cleanPersonId,
      department: existingProfile?.department || person?.department || "",
      payrollRole: role,
      monthlySalary: Number(existingProfile?.monthlySalary ?? person?.monthlySalary ?? 0),
      penaltyPerMinute: existingProfile?.penaltyPerMinute ?? person?.penaltyPerMinute ?? DEFAULT_ROLE_PENALTY[role] ?? 0,
      bonusAmount: existingProfile?.bonusAmount ?? person?.bonusAmount ?? defaultBonusForProfile({ payrollRole: role, employmentType }),
      bonusDisabled: !!(existingProfile?.bonusDisabled ?? person?.bonusDisabled),
      bonusDisabledReason: existingProfile?.bonusDisabledReason ?? person?.bonusDisabledReason ?? null,
      extraBonuses: inactiveExtraBonuses as Prisma.InputJsonObject,
      employmentType: toEmploymentType(employmentType),
      partTimeMode: toPartTimeMode(partTimeMode),
    },
  });
}

export async function reactivateAttendanceCollaborator(personId: string) {
  const cleanPersonId = String(personId || "").trim();
  if (!cleanPersonId) throw new Error("Colaborador inválido.");
  const profile = await prisma.attendanceProfile.findUnique({ where: { personId: cleanPersonId } });
  if (!profile) throw new Error("No se encontró el colaborador inactivo.");
  const extras = profile.extraBonuses && typeof profile.extraBonuses === "object" && !Array.isArray(profile.extraBonuses)
    ? { ...(profile.extraBonuses as Record<string, unknown>) }
    : {};
  if (!extras.__inactive) throw new Error("Este colaborador ya está activo.");
  delete extras.__inactive;
  delete extras.__inactiveAt;
  // Keep the previous cese as payroll history. The UI uses this date to avoid
  // paying entries made while the collaborator was inactive.
  extras.__reactivatedAt = new Date().toISOString();
  await prisma.attendanceProfile.update({
    where: { personId: cleanPersonId },
    data: { extraBonuses: extras as Prisma.InputJsonObject },
  });
  return profile;
}

export async function terminateAttendanceCollaborator(input: { personId: string; lastWorkingDate: string; reason?: string | null }) {
  const personId = String(input.personId || "").trim();
  const lastWorkingDate = String(input.lastWorkingDate || "").slice(0, 10);
  if (!personId || !/^\d{4}-\d{2}-\d{2}$/.test(lastWorkingDate)) {
    throw new Error("Indica una fecha válida para el último día de trabajo.");
  }
  const profile = await prisma.attendanceProfile.findUnique({ where: { personId } });
  if (!profile) throw new Error("No se encontró el colaborador.");
  const extras = profile.extraBonuses && typeof profile.extraBonuses === "object" && !Array.isArray(profile.extraBonuses)
    ? { ...(profile.extraBonuses as Record<string, unknown>) }
    : {};
  await prisma.attendanceProfile.update({
    where: { personId },
    data: {
      extraBonuses: {
        ...extras,
        __inactive: true,
        __inactiveAt: new Date().toISOString(),
        __terminationDate: lastWorkingDate,
        __terminationReason: String(input.reason || "").trim() || null,
        __terminationRegisteredAt: new Date().toISOString(),
        __reactivatedAt: null,
      } as Prisma.InputJsonObject,
    },
  });
}

export async function readAttendanceData(includeInactive = false, month: string | null = null): Promise<AttendancePayload> {
  const [parsed, overrides, profiles, workCalendar] = await Promise.all([
    readAttendanceStorePayload(), readAttendanceOverrides(month), readAttendanceProfiles(), readWorkCalendar(),
  ]);
  const payload: AttendancePayload = {
    ...EMPTY_ATTENDANCE,
    ...parsed,
    schedule: { ...EMPTY_ATTENDANCE.schedule, ...parsed.schedule },
    summary: { ...EMPTY_ATTENDANCE.summary, ...parsed.summary },
    availableDates: parsed.availableDates || [],
    people: (parsed.people || []).map(person => ({ ...person, days: month ? person.days.filter(day => day.date.startsWith(month)) : person.days })),
    profiles: parsed.profiles || [],
  };

  const isInactive = (profile?: Pick<AttendanceProfile, "extraBonuses"> | null) => Boolean(profile?.extraBonuses?.__inactive);
  const activeProfiles = Object.fromEntries(
    Object.entries(profiles).filter(([, profile]) => !isInactive(profile)),
  ) as AttendanceProfiles;
  const activePayload: AttendancePayload = {
    ...payload,
    people: (payload.people || []).filter((person) => !isInactive(profiles[person.personId])),
    profiles: (payload.profiles || []).filter((profile) => !isInactive(profiles[profile.personId])),
  };
  const result = includeInactive
    ? rebuildPayload(payload, overrides, profiles, month, workCalendar)
    : rebuildPayload(activePayload, overrides, activeProfiles, month, workCalendar);
  // Read the real final-day punches separately; never insert a synthetic exit.
  const payrollMonth = month || todayInLima().slice(0, 7);
  // One-off unpaid September 30 supplement, supplied by the administrator.
  // Keep it outside attendance days and the closed September payroll.
  if (!month || month >= septemberPayrollCarry.receivingMonth) {
    const date = septemberPayrollCarry.date;
    const carryOverrides = !month || month === date.slice(0, 7) ? overrides : await readAttendanceOverrides(date.slice(0, 7));
    result.people = result.people.map(person => {
      const source = septemberPayrollCarry.people.find(item => item.personId === person.personId);
      if (!source || source.punches.length < 2) return person;
      const original = parsed.people.find(item => item.personId === person.personId)?.days.find(day => day.date === date);
      const empty = { date, punches: [], entryTime: null, exitTime: null, entryStatus: "Sin entrada", exitStatus: "Sin salida", lateMinutes: 0, lateLabel: "0 min", earlyLeaveMinutes: 0, earlyLeaveLabel: "0 min", overtimeMinutes: 0, overtimeLabel: "0 min", status: "Sin marcajes" } satisfies AttendanceDay;
      const punches = [...source.punches].sort();
      const imported = { ...(original || empty), punches, entryTime: punches[0], exitTime: punches[punches.length - 1] };
      const day = recomputeDay(imported, payload.schedule, profiles[person.personId], carryOverrides[`${person.personId}__${date}`], resolveWorkCalendar(workCalendar, person, date), true);
      if (day.calendarException) day.calendarException = { ...day.calendarException, personIds: day.calendarException.personIds.filter(id => id === person.personId) };
      return { ...person, payrollCarryDays: [day] };
    });
  }
  if (payrollMonth >= "2026-11") {
    const lastDate = new Date(`${payrollMonth}-01T12:00:00Z`);
    lastDate.setUTCDate(0);
    const date = lastDate.toISOString().slice(0, 10);
    const previousOverrides = await readAttendanceOverrides(date.slice(0, 7));
    const storedPeople = new Map((parsed.people || []).map(person => [person.personId, person]));
    result.people = result.people.map(person => {
      const original = storedPeople.get(person.personId)?.days.find(day => day.date === date);
      const override = previousOverrides[`${person.personId}__${date}`];
      if (!original && !override) return { ...person, previousMonthLastDay: null };
      const empty = { date, punches: [], entryTime: null, exitTime: null, entryStatus: "Sin entrada", exitStatus: "Sin salida", lateMinutes: 0, lateLabel: "0 min", earlyLeaveMinutes: 0, earlyLeaveLabel: "0 min", overtimeMinutes: 0, overtimeLabel: "0 min", status: "Sin marcajes" } satisfies AttendanceDay;
      const calendar = resolveWorkCalendar(workCalendar, person, date);
      const day = recomputeDay(original || empty, payload.schedule, profiles[person.personId], override, calendar);
      if (day.calendarException) day.calendarException = { ...day.calendarException, personIds: day.calendarException.personIds.filter(id => id === person.personId) };
      return { ...person, previousMonthLastDay: day };
    });
  }
  return result;
}

