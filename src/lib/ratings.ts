import { readInactiveUserIds } from "@/lib/inactive-users";
import { deletedRatingLogs, ratingDeletionKey, permanentlyRemovedRatingKeys } from "@/lib/rating-deletions";
import { RatingApprovalStatus, UserRole, type User, type AppSettings, type RatingSnapshot } from "@prisma/client";
import { getPayoutSettings, isPaymentsSupervisor, isPaymentsTeamMember, normalizeSede } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { isMonthClosedForRole, monthFromDate } from "@/lib/monthly-closure";
import { logChange } from "@/lib/change-log";
import { readPayoutSettings } from "@/lib/payout-settings";

const RATING_SHEET_ID = "1YGhv_m1a2XyWjQ2ITIIkz1ypsntotJl0u6nMRzTfqLQ";
const RATING_SHEET_GID = "1706918683";
const RATING_SHEET_FETCH_TIMEOUT_MS = 15000;

type RatingSheetRow = Record<string, unknown>;

/**
 * Google Forms exports the timestamp as DD/MM/YYYY.  Spreadsheet parsers can
 * interpret values such as 10/08/2026 as October 8 when the runtime uses an
 * American locale, so preserve the CSV text exactly instead of converting it
 * through an Excel serial date.
 */
function parseGoogleCsv(csv: string): RatingSheetRow[] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) records.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => value !== "")) records.push(row);

  const [headers = [], ...dataRows] = records;
  return dataRows.map((values) =>
    headers.reduce<RatingSheetRow>((record, header, index) => {
      const normalizedHeader = header.trim();
      const duplicateIndex = Object.keys(record).filter(
        (key) => key === normalizedHeader || key.startsWith(`${normalizedHeader}__duplicate_`),
      ).length;
      const key = duplicateIndex === 0 ? normalizedHeader : `${normalizedHeader}__duplicate_${duplicateIndex + 1}`;
      record[key] = values[index] ?? "";
      return record;
    }, {}),
  );
}

function sheetValue(row: RatingSheetRow, header: string) {
  if (!header) return "";
  const primary = row[header];
  if (String(primary ?? "").trim()) return primary;
  const duplicate = Object.keys(row).find((key) => key.startsWith(`${header}__duplicate_`) && String(row[key] ?? "").trim());
  return duplicate ? row[duplicate] : primary ?? "";
}

let ratingSheetCache: {
  rawRows: RatingSheetRow[];
  cachedAt: number;
} | null = null;

export const RATING_FIELD_OPTIONS = [
  { key: "dni", label: "DNI" },
  { key: "comment", label: "Comentario" },
  { key: "advisor", label: "Asesor" },
] as const;

export const DEFAULT_RATING_REQUIRED_FIELDS = ["dni"] as const;

type RatingField = (typeof RATING_FIELD_OPTIONS)[number]["key"];

type UserLite = Pick<User, "id" | "name" | "username" | "role" | "sede" | "color">;

function canAccessRatingRow(currentUser: UserLite, row: { sede: string; matchedUserId: number | null }, users: UserLite[]) {
  if (currentUser.role === UserRole.ADMIN) return true;
  if (currentUser.role !== UserRole.MANAGER) return row.matchedUserId === currentUser.id;
  const matchedUser = users.find((user) => user.id === row.matchedUserId);
  if (isPaymentsSupervisor(currentUser)) return !!matchedUser && isPaymentsTeamMember(matchedUser);
  if (matchedUser && isPaymentsTeamMember(matchedUser)) return false;
  return row.sede === normalizeSede(currentUser.sede);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeMonthKey(value?: string | null) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : null;
}

function ratingRowMonth(row: { approvedAt?: string; date?: string; rawDate?: string }) {
  // A rating belongs to the month it was submitted, even when its approval
  // happens in a later month.
  return monthFromDate(row.date || row.rawDate || row.approvedAt || "");
}

function ratingRowDateKey(row: { approvedAt?: string; date?: string; rawDate?: string }) {
  const value = row.date || row.rawDate || row.approvedAt || "";
  const direct = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function tokens(value: string) {
  return normalizeText(value).split(" ").filter((token) => token.length >= 3);
}

function headerIncludes(header: string, needles: string[]) {
  const normalized = normalizeText(header);
  return needles.some((needle) => normalized.includes(needle));
}

function firstHeader(headers: string[], needles: string[]) {
  return headers.find((header) => headerIncludes(header, needles)) || "";
}

function parseRating(value: unknown) {
  const text = String(value ?? "").trim();
  const direct = Number(text.replace(",", "."));
  if (Number.isFinite(direct)) return direct;
  const match = text.match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : 0;
}

function toLocalDateTimeString(parts: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}) {
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  const hour = String(parts.hour ?? 0).padStart(2, "0");
  const minute = String(parts.minute ?? 0).padStart(2, "0");
  const second = String(parts.second ?? 0).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function parseSheetDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 20000) {
    const baseUtc = Date.UTC(1899, 11, 30);
    const date = new Date(baseUtc + Math.round(serial * 86400 * 1000));
    return Number.isNaN(date.getTime())
      ? text
      : toLocalDateTimeString({
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour: date.getUTCHours(),
          minute: date.getUTCMinutes(),
          second: date.getUTCSeconds(),
        });
  }
  const parts = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (parts) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = parts;
    return toLocalDateTimeString({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    });
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? text
    : toLocalDateTimeString({
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds(),
      });
}

function ratingRowKey(input: {
  rowNumber: number;
  date: string;
  advisor: string;
  dni: string;
  rating: number;
  comment: string;
  nps?: string;
  valuableAspects?: string;
}) {
  return [
    input.rowNumber,
    input.date || "sin-fecha",
    normalizeText(input.advisor),
    normalizeText(input.dni),
    input.rating,
    normalizeText(input.comment),
    normalizeText(input.nps || ""),
    normalizeText(input.valuableAspects || ""),
  ].join("|");
}

function legacyApprovalKey(input: {
  rowNumber: number;
  advisor: string;
  dni?: string | null;
  rating: number;
}) {
  return [input.rowNumber, normalizeText(input.advisor), normalizeText(input.dni || ""), input.rating].join("|");
}

function stableApprovalKey(input: {
  advisor: string;
  dni?: string | null;
  rating: number;
  comment?: string | null;
  sede?: string | null;
}) {
  return [
    normalizeText(input.advisor),
    normalizeText(input.dni || ""),
    input.rating,
    normalizeText(input.comment || "").slice(0, 60),
    normalizeSede(String(input.sede || "")),
  ].join("|");
}

function stableApprovalKeyWithoutComment(input: {
  advisor: string;
  dni?: string | null;
  rating: number;
  sede?: string | null;
}) {
  return [
    normalizeText(input.advisor),
    normalizeText(input.dni || ""),
    input.rating,
    normalizeSede(String(input.sede || "")),
  ].join("|");
}

function stableApprovalKeyWithoutDni(input: {
  advisor: string;
  rating: number;
  comment?: string | null;
  sede?: string | null;
}) {
  return [
    normalizeText(input.advisor),
    input.rating,
    normalizeText(input.comment || "").slice(0, 60),
    normalizeSede(String(input.sede || "")),
  ].join("|");
}

/**
 * Algunas aprobaciones históricas se guardaron con una clave que empezaba por
 * "fila|fecha|asesor|dni|calificación|comentario". El asesor o la sede pueden
 * haber cambiado de escritura en la hoja, pero la respuesta original sigue
 * siendo identificable por estos cuatro datos. No se usa el DNI por sí solo:
 * un mismo cliente puede responder en días distintos.
 */
function historicalApprovalKey(input: {
  rowKey?: string | null;
  date?: string | null;
  dni?: string | null;
  rating: number;
  comment?: string | null;
}) {
  let date = String(input.date || "");
  let dni = String(input.dni || "");
  let rating = input.rating;
  let comment = String(input.comment || "");
  const parts = String(input.rowKey || "").split("|");

  if (/^\d+$/.test(parts[0] || "") && /^\d{4}-\d{2}-\d{2}T/.test(parts[1] || "")) {
    date = parts[1];
    dni = parts[3] || dni;
    rating = Number(parts[4]) || rating;
    comment = parts.slice(5).join("|") || comment;
  }

  return [date, normalizeText(dni), rating, normalizeText(comment)].join("|");
}

function countByKey<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = getKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function createUniqueLookup<T>(items: T[], getKey: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  items.forEach((item) => {
    const key = getKey(item);
    grouped.set(key, [...(grouped.get(key) || []), item]);
  });
  const lookup = new Map<string, T>();
  grouped.forEach((group, key) => {
    if (group.length === 1) {
      lookup.set(key, group[0]);
    }
  });
  return lookup;
}

function normalizeRatingSede(value: unknown) {
  const text = normalizeText(value);
  if (text.includes("lince") || text.includes("centro")) return "Lince";
  if (text.includes("sjm") || text.includes("san juan") || text.includes("sur")) return "Sur";
  if (text.includes("olivos") || text.includes("norte")) return "Norte";
  if (text.includes("miraflores") || text.includes("miraf")) return "Miraflores";
  return normalizeSede(String(value || ""));
}

function userMatchesAdvisor(user: UserLite, advisor: string, sede: string) {
  const userName = normalizeText(user.name);
  const advisorName = normalizeText(advisor);

  if (!advisorName || user.role === UserRole.ADMIN) return false;
  // Matching identifies the advisor; the form's recorded sede remains the
  // historical sede for this rating, even if the advisor later moves.
  void sede;

  if (advisorName.includes("alessandra")) {
    return userName.includes("valeria") && userName.includes("caballero");
  }

  // En el formulario externo, "VALERIA" corresponde a Valeria Lopez.
  // Alessandra se identifica de forma independiente por "ALESSANDRA".
  if (advisorName.includes("valeria")) {
    return userName.includes("valeria") && userName.includes("lopez");
  }

  if (advisorName.includes("cristian") || advisorName.includes("cristhian")) {
    return userName.includes("sulca");
  }

  if (advisorName === userName || userName.includes(advisorName) || advisorName.includes(userName)) return true;

  const advisorTokens = tokens(advisorName);
  const userTokens = tokens(userName);
  if (advisorTokens.length && advisorTokens.every((token) => userName.includes(token))) return true;
  return userTokens.length > 1 && userTokens.every((token) => advisorName.includes(token));
}

function matchAdvisor(advisor: string, sede: string, users: UserLite[]) {
  return users.find((user) => userMatchesAdvisor(user, advisor, sede)) || null;
}

function normalizeRequiredFields(value: unknown): RatingField[] {
  if (!Array.isArray(value)) return [...DEFAULT_RATING_REQUIRED_FIELDS];
  const allowed = new Set(RATING_FIELD_OPTIONS.map((item) => item.key));
  const fields = value.filter((field): field is RatingField => allowed.has(field as RatingField));
  return fields.length ? fields : [...DEFAULT_RATING_REQUIRED_FIELDS];
}

function parseDecisionStatus(value: unknown): RatingApprovalStatus | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (
    text.includes("aprobad") ||
    text === "ok" ||
    text === "si" ||
    text === "yes" ||
    text === "paid" ||
    text.includes("validad") ||
    text.includes("aceptad")
  ) {
    return RatingApprovalStatus.APPROVED;
  }
  if (text.includes("rechaz") || text.includes("deneg") || text.includes("observad")) {
    return RatingApprovalStatus.REJECTED;
  }
  return null;
}

function approvalDecisionDate(value: unknown, fallback = new Date()) {
  const parsed = parseSheetDate(value);
  if (!parsed) return fallback;
  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function ratingSheetFetchErrorMessage(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return "La hoja de calificaciones demoro demasiado en responder.";
  }
  return error instanceof Error
    ? error.message
    : "No se pudo leer la hoja de calificaciones.";
}

async function loadRatingSheetRows() {
  // Evita descargar y procesar toda la hoja en cada visita. En una instancia
  // activa, se consulta como máximo una vez cada dos minutos; el resto de
  // solicitudes usa la copia ya sincronizada en la base de datos.
  if (ratingSheetCache && Date.now() - ratingSheetCache.cachedAt < 2 * 60 * 1000) {
    return { rawRows: ratingSheetCache.rawRows, stale: false, warning: "" };
  }
  const csvUrl = `https://docs.google.com/spreadsheets/d/${RATING_SHEET_ID}/export?format=csv&gid=${RATING_SHEET_GID}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RATING_SHEET_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(csvUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("No se pudo leer la hoja de calificaciones. Revisa que este compartida como publica.");
    }

    const csv = await response.text();
    const rawRows = parseGoogleCsv(csv);

    ratingSheetCache = {
      rawRows,
      cachedAt: Date.now(),
    };

    return {
      rawRows,
      stale: false,
      warning: "",
    };
  } catch (error) {
    if (ratingSheetCache?.rawRows?.length) {
      return {
        rawRows: ratingSheetCache.rawRows,
        stale: true,
        warning: `${ratingSheetFetchErrorMessage(error)} Mostrando la ultima copia disponible sin borrar lo ya guardado.`,
      };
    }
    return {
      rawRows: null,
      stale: true,
      warning: `${ratingSheetFetchErrorMessage(error)} Mostrando solo las calificaciones ya guardadas.`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function pickAutomaticRatingDecider(input: {
  externalApprover: string;
  sede: string;
  users: UserLite[];
}) {
  const managers = input.users.filter((user) => user.role === UserRole.MANAGER);
  const admins = input.users.filter((user) => user.role === UserRole.ADMIN);
  const targetSede = normalizeSede(input.sede);
  const approver = normalizeText(input.externalApprover);

  const exactMatch =
    [...managers, ...admins].find((user) => {
      const userName = normalizeText(user.name);
      const username = normalizeText(user.username);
      return approver && (userName === approver || username === approver || userName.includes(approver));
    }) || null;
  if (exactMatch) return exactMatch;

  return managers.find((user) => normalizeSede(user.sede) === targetSede) || admins[0] || null;
}

function mergeRatingOverride<T extends {
  rowKey: string;
  rowNumber: number;
  date: string;
  rawDate: string;
  rawSede: string;
  advisor: string;
  dni: string;
  comment: string;
  sede: string;
  rating: number;
  matchedUserId: number | null;
  matchedUserName: string;
  matchedUsername: string;
  matchedUserColor: string;
  matchedUserRole: string;
}>(
  row: T,
  approval:
    | {
        advisor?: string;
        dni?: string | null;
        comment?: string | null;
        matchedUserId?: number | null;
        matchedUserName?: string | null;
        sede?: string;
      }
    | null
    | undefined,
  settings: Awaited<ReturnType<typeof getRatingSettings>>,
  users: UserLite[],
) {
  const advisor = String(approval?.advisor ?? row.advisor ?? "").trim();
  const dni = String(approval?.dni ?? row.dni ?? "").trim();
  const comment = String(approval?.comment ?? row.comment ?? "").trim();
  const storedSede = approval?.sede ? normalizeSede(approval.sede) : "";
  const seededUser = approval?.matchedUserId ? users.find((user) => user.id === approval.matchedUserId) || null : null;
  // Las aprobaciones antiguas pueden haber guardado una coincidencia ambigua.
  // Solo se conserva si sigue cumpliendo la regla actual del asesor.
  const matchedUser = seededUser && userMatchesAdvisor(seededUser, advisor, storedSede || row.sede)
    ? seededUser
    : matchAdvisor(advisor, storedSede || row.sede, users);
  const sede = matchedUser ? normalizeSede(matchedUser.sede) : storedSede || normalizeSede(row.sede);
  const requiredValues: Record<RatingField, string> = { dni, comment, advisor };
  const missingFields = Array.from(
    new Set([
      ...settings.requiredFields.filter((field) => !requiredValues[field]?.trim()),
      ...(!dni ? (["dni"] as RatingField[]) : []),
    ]),
  );
  const autoRejectedMissingDni = !dni;
  const valid = Number(row.rating || 0) >= 4 && Number(row.rating || 0) <= 5 && missingFields.length === 0 && !!matchedUser;

  return {
    ...row,
    advisor,
    dni,
    comment,
    sede,
    matchedUserId: matchedUser?.id ?? null,
    matchedUserName: matchedUser?.name ?? "",
    matchedUsername: matchedUser?.username ?? "",
    matchedUserColor: matchedUser?.color ?? "#4f8ef7",
    matchedUserRole: matchedUser?.role ?? "",
    missingFields,
    autoRejectedMissingDni,
    valid,
  };
}

export async function getRatingSettings() {
  const [settings, payoutSettings] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: 1 } }),
    readPayoutSettings().catch(() => null),
  ]);
  return {
    requiredFields: normalizeRequiredFields(settings?.ratingRequiredFields),
    fieldOptions: RATING_FIELD_OPTIONS,
    payoutSettings: payoutSettings || getPayoutSettings(settings),
    ratingSheetLastSyncedAt: settings?.ratingSheetLastSyncedAt ?? null,
  };
}

function buildRatingsSummary<T extends { valid: boolean; payable: boolean; approvalStatus: string; amount: number }>(rows: T[]) {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.valid).length,
    approved: rows.filter((row) => row.payable).length,
    pending: rows.filter((row) => row.approvalStatus === RatingApprovalStatus.PENDING).length,
    invalid: rows.filter((row) => !row.valid).length,
    amount: rows.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function buildStoredRatingsFallback(
  currentUser: UserLite,
  settings: Awaited<ReturnType<typeof getRatingSettings>>,
  users: UserLite[],
  warning: string,
  options?: { month?: string | null; from?: string | null; to?: string | null },
) {
  const scopedMonth = normalizeMonthKey(options?.month);
  const from = String(options?.from || "").slice(0, 10);
  const to = String(options?.to || "").slice(0, 10);
  const approvals = await prisma.ratingApproval.findMany({
    include: {
      decidedBy: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          sede: true,
          color: true,
          forcePasswordReset: true,
        },
      },
    },
    orderBy: [{ rowNumber: "desc" }, { updatedAt: "desc" }],
  });

  const rows = approvals.map((approval) => {
    const seededUser = approval.matchedUserId
      ? users.find((user) => user.id === approval.matchedUserId) || null
      : null;
    const matchedUser = seededUser && userMatchesAdvisor(seededUser, approval.advisor, approval.sede)
      ? seededUser
      : matchAdvisor(approval.advisor, approval.sede, users);

    const mergedRow = mergeRatingOverride(
      {
        id: approval.rowKey,
        rowKey: approval.rowKey,
        rowNumber: approval.rowNumber,
        date: approval.decidedAt?.toISOString() ?? approval.createdAt.toISOString(),
        rawDate: "",
        rawSede: approval.sede,
        sede: normalizeSede(approval.sede),
        advisor: approval.advisor,
        matchedUserId: matchedUser?.id ?? approval.matchedUserId ?? null,
        matchedUserName: matchedUser?.name ?? approval.matchedUserName,
        matchedUsername: matchedUser?.username ?? "",
        matchedUserColor: matchedUser?.color ?? "#4f8ef7",
        matchedUserRole: matchedUser?.role ?? "",
        rating: approval.rating,
        dni: approval.dni ?? "",
        comment: approval.comment ?? "",
        nps: "",
        valuableAspects: "",
        externalApprovalStatus: null,
        externalApprovalBy: "",
        externalApprovalAt: "",
        valid: true,
        missingFields: [],
        autoRejectedMissingDni: !approval.dni,
      },
      approval,
      settings,
      users,
    );

    const approvalStatus = mergedRow.autoRejectedMissingDni
      ? RatingApprovalStatus.REJECTED
      : !mergedRow.valid
        ? "INVALID"
        : approval.status;
    const payable = mergedRow.valid && approvalStatus === RatingApprovalStatus.APPROVED;

    return {
      ...mergedRow,
      approvalStatus,
      approvedAt: approval.status === RatingApprovalStatus.APPROVED ? approval.decidedAt?.toISOString() ?? "" : "",
      rejectedAt: approval.status === RatingApprovalStatus.REJECTED ? approval.decidedAt?.toISOString() ?? "" : "",
      decisionReason: approval.decisionReason ?? (mergedRow.autoRejectedMissingDni ? "Rechazo automatico: falta DNI." : ""),
      decidedBy: approval.decidedBy
        ? {
            ...approval.decidedBy,
            sede: normalizeSede(approval.decidedBy.sede),
          }
        : null,
      payable,
      amount: payable ? settings.payoutSettings.ratingCommission : 0,
    };
  });

  const inactiveUserIds = await readInactiveUserIds();
  const deletedKeys = new Set((await deletedRatingLogs()).map(log => log.targetId));
  const visibleRows = rows.filter((row) => {
    if (permanentlyRemovedRatingKeys.has(ratingDeletionKey(row.rowKey)) || deletedKeys.has(ratingDeletionKey(row.rowKey))) return false;
    if (row.matchedUserId && inactiveUserIds.has(row.matchedUserId)) return false;
    if (scopedMonth && ratingRowMonth(row) !== scopedMonth) return false;
    const date = ratingRowDateKey(row);
    if (from && date < from) return false;
    if (to && date > to) return false;
    return canAccessRatingRow(currentUser, row, users);
  });

  return {
    settings,
    columns: { dateHeader: "", sedeHeader: "", advisorHeader: "", ratingHeader: "", commentHeader: "", dniHeader: "" },
    rows: visibleRows,
    summary: buildRatingsSummary(visibleRows),
    warning,
    stale: true,
  };
}

export async function updateRatingSettings(requiredFields: string[]) {
  const normalized = normalizeRequiredFields(requiredFields);
  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: { ratingRequiredFields: normalized },
    create: { id: 1, ratingRequiredFields: normalized },
  });
  return {
    requiredFields: normalized,
    fieldOptions: RATING_FIELD_OPTIONS,
  };
}

async function readPersistedRatingDecisionData() {
  type Approval = Awaited<ReturnType<typeof readRatingApprovalsForResponse>>[number];
  type StoredApproval = Omit<Approval, "createdAt" | "updatedAt" | "decidedAt"> & { createdAt: string; updatedAt: string; decidedAt: string | null };
  const [stored] = await prisma.$queryRaw<Array<{
    settings: AppSettings | null;
    users: UserLite[];
    snapshots: RatingSnapshot[];
    approvals: StoredApproval[];
    deletedLogs: Array<{ targetId: string }>;
  }>>`
    SELECT
      (SELECT to_jsonb(s) FROM "AppSettings" s WHERE s.id = 1) AS settings,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', u.id, 'name', u.name, 'username', u.username, 'role', u.role,
        'sede', u.sede, 'color', u.color) ORDER BY u.name), '[]'::jsonb)
        FROM "User" u WHERE u.role <> 'ADMIN') AS users,
      (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."sourceDate" DESC, s.id DESC), '[]'::jsonb)
        FROM "RatingSnapshot" s) AS snapshots,
      (SELECT COALESCE(jsonb_agg(to_jsonb(a) || jsonb_build_object('decidedBy',
        CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', u.id, 'name', u.name, 'username', u.username, 'role', u.role,
          'sede', u.sede, 'color', u.color, 'forcePasswordReset', u."forcePasswordReset") END)), '[]'::jsonb)
        FROM "RatingApproval" a LEFT JOIN "User" u ON u.id = a."decidedById") AS approvals,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('targetId', d."targetId")), '[]'::jsonb)
        FROM (SELECT DISTINCT ON ("targetId") "targetId", action
          FROM "ChangeLog" WHERE module = 'Calificaciones' AND "targetType" = 'RatingDeletion'
            AND action IN ('ELIMINAR', 'RESTAURAR') AND "targetId" IS NOT NULL
          ORDER BY "targetId", "createdAt" DESC, id DESC) d
        WHERE d.action = 'ELIMINAR') AS "deletedLogs"
  `;
  if (!stored) throw new Error("No se pudieron consultar las calificaciones.");
  // Prisma's timestamp-without-timezone values are UTC, including in raw JSON.
  const utcDate = (value: string | Date) => new Date(
    typeof value === "string" && !/(Z|[+-]\d{2}:\d{2})$/i.test(value) ? value + "Z" : value,
  );
  return {
    users: stored.users,
    snapshots: stored.snapshots,
    deletedLogs: stored.deletedLogs,
    approvals: stored.approvals.map(approval => ({
      ...approval,
      createdAt: utcDate(approval.createdAt),
      updatedAt: utcDate(approval.updatedAt),
      decidedAt: approval.decidedAt ? utcDate(approval.decidedAt) : null,
    })),
    settings: {
      requiredFields: normalizeRequiredFields(stored.settings?.ratingRequiredFields),
      fieldOptions: RATING_FIELD_OPTIONS,
      payoutSettings: getPayoutSettings(stored.settings),
      ratingSheetLastSyncedAt: stored.settings?.ratingSheetLastSyncedAt ? utcDate(stored.settings.ratingSheetLastSyncedAt) : null,
    },
  };
}

async function readRatingApprovalsForResponse() {
  return prisma.ratingApproval.findMany({
    include: {
      decidedBy: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          sede: true,
          color: true,
          forcePasswordReset: true,
        },
      },
    },
  });
}

export async function buildRatingsResponse(currentUser: UserLite, options?: { month?: string | null; from?: string | null; to?: string | null; sync?: boolean }) {
  const scopedMonth = normalizeMonthKey(options?.month);
  const from = String(options?.from || "").slice(0, 10);
  const to = String(options?.to || "").slice(0, 10);
  const storedReads = options?.sync === false ? await readPersistedRatingDecisionData() : null;
  const [settings, users] = storedReads
    ? [storedReads.settings, storedReads.users] as const
    : await Promise.all([
        getRatingSettings(),
        prisma.user.findMany({
          where: { role: { not: UserRole.ADMIN } },
          select: { id: true, name: true, username: true, role: true, sede: true, color: true },
          orderBy: { name: "asc" },
        }),
      ]);

  let dateHeader = "";
  let sedeHeader = "";
  let advisorHeader = "";
  let ratingHeader = "";
  let commentHeader = "";
  let dniHeader = "";
  let warning = "";
  let stale = false;
  const syncDue = !settings.ratingSheetLastSyncedAt || Date.now() - settings.ratingSheetLastSyncedAt.getTime() >= 2 * 60 * 1000;

  if (syncDue && options?.sync !== false) {
    const sheetData = await loadRatingSheetRows();
    warning = sheetData.warning;
    stale = sheetData.stale;

    if (sheetData.rawRows) {
      const rawRows = sheetData.rawRows;
      const headers = rawRows.length ? Object.keys(rawRows[0]) : [];
      dateHeader = firstHeader(headers, ["marca temporal", "timestamp", "fecha"]);
      sedeHeader = firstHeader(headers, ["sede"]);
      advisorHeader = firstHeader(headers, ["asesor", "colaborador", "trabajador"]);
      ratingHeader = firstHeader(headers, ["calificar", "calificacion", "estrellas", "rating"]);
      commentHeader = firstHeader(headers, ["comentario", "coment", "experiencia"]);
      dniHeader = firstHeader(headers, ["dni"]);
      const npsHeader = firstHeader(headers, ["recomiendes", "probable", "nps"]);
      const valueHeader = firstHeader(headers, ["aspectos", "valiosos", "servicio"]);
      const approvalStatusHeader = firstHeader(headers, ["estado", "aprobacion", "aprobado", "status", "decision", "validacion"]);
      const approvalByHeader = firstHeader(headers, ["aprobado por", "revisado por", "jefe", "supervisor", "decidido por"]);
      const approvalDateHeader = firstHeader(headers, ["fecha aprobacion", "fecha de aprobacion", "aprobado el", "fecha decision", "fecha validacion"]);

      if (!advisorHeader || !ratingHeader) {
        warning = "No pude detectar las columnas de asesor y calificación. Se mantiene la última copia guardada.";
        stale = true;
      } else {
        const newSnapshots = rawRows.map((row, index) => {
    const advisor = String(sheetValue(row, advisorHeader) ?? "").trim();
    const sheetSede = normalizeRatingSede(sheetValue(row, sedeHeader));
    const matchedUser = matchAdvisor(advisor, sheetSede, users);
    const rating = parseRating(sheetValue(row, ratingHeader));
    const dni = String(sheetValue(row, dniHeader) ?? "").trim();
    const comment = String(sheetValue(row, commentHeader) ?? "").trim();
    const date = parseSheetDate(sheetValue(row, dateHeader));
    const nps = String(sheetValue(row, npsHeader) ?? "").trim();
    const valuableAspects = String(sheetValue(row, valueHeader) ?? "").trim();
    const externalApprovalStatus = parseDecisionStatus(sheetValue(row, approvalStatusHeader));
    const externalApprovalBy = String(sheetValue(row, approvalByHeader) ?? "").trim();
    const externalApprovalAt = parseSheetDate(sheetValue(row, approvalDateHeader));
    const rowNumber = index + 2;
    const sede = sheetSede || (matchedUser ? normalizeSede(matchedUser.sede) : "");
    const responseKey = ratingRowKey({ rowNumber, date, advisor, dni, rating, comment, nps, valuableAspects });
    return {
      responseKey,
      sourceRowNumber: rowNumber,
      sourceDate: date,
      rawDate: String(sheetValue(row, dateHeader) ?? ""),
      rawSede: String(sheetValue(row, sedeHeader) ?? ""),
      sede,
      advisor,
      matchedUserId: matchedUser?.id ?? null,
      matchedUserName: matchedUser?.name ?? "",
      rating,
      dni: dni || null,
      comment: comment || null,
      nps: nps || null,
      valuableAspects: valuableAspects || null,
      externalApprovalStatus,
      externalApprovalBy: externalApprovalBy || null,
      externalApprovalAt: externalApprovalAt || null,
    };
        });

        const existingSnapshots = await prisma.ratingSnapshot.findMany({
          where: { responseKey: { in: newSnapshots.map((snapshot) => snapshot.responseKey) } },
          select: { responseKey: true },
        });
        const existingResponseKeys = new Set(existingSnapshots.map((snapshot) => snapshot.responseKey));
        const unseenSnapshots = newSnapshots.filter((snapshot) => !existingResponseKeys.has(snapshot.responseKey) && !permanentlyRemovedRatingKeys.has(ratingDeletionKey(snapshot.responseKey)));
        if (unseenSnapshots.length) {
          await prisma.ratingSnapshot.createMany({ data: unseenSnapshots, skipDuplicates: true });
        }
        await prisma.appSettings.upsert({
          where: { id: 1 },
          update: { ratingSheetLastSyncedAt: new Date() },
          create: { id: 1, ratingSheetLastSyncedAt: new Date() },
        });
      }
    }
  }

  const snapshots = storedReads?.snapshots ?? await prisma.ratingSnapshot.findMany({ orderBy: [{ sourceDate: "desc" }, { id: "desc" }] });
  if (!snapshots.length) {
    return buildStoredRatingsFallback(currentUser, settings, users, warning || "Aún no hay encuestas sincronizadas.", { month: scopedMonth, from, to });
  }

  // A response can have old snapshots keyed by the advisor's then-current sede
  // and newer snapshots keyed by the sede recorded in the form. Keep one row
  // per original Google Sheets row so a sede correction never duplicates it.
  const snapshotsBySourceRow = new Map<number, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!snapshotsBySourceRow.has(snapshot.sourceRowNumber)) {
      snapshotsBySourceRow.set(snapshot.sourceRowNumber, snapshot);
    }
  }
  const mappedRows = [...snapshotsBySourceRow.values()].map((snapshot) => {
    const advisor = snapshot.advisor;
    const seededUser = snapshot.matchedUserId ? users.find((user) => user.id === snapshot.matchedUserId) || null : null;
    const matchedUser = seededUser && userMatchesAdvisor(seededUser, advisor, snapshot.sede)
      ? seededUser
      : matchAdvisor(advisor, snapshot.sede, users);
    const dni = snapshot.dni || "";
    const comment = snapshot.comment || "";
    const requiredValues: Record<RatingField, string> = { dni, comment, advisor };
    const missingFields = Array.from(new Set([
      ...settings.requiredFields.filter((field) => !requiredValues[field]?.trim()),
      ...(!dni ? (["dni"] as RatingField[]) : []),
    ]));
    const autoRejectedMissingDni = !dni;
    return {
      id: snapshot.responseKey,
      rowKey: snapshot.responseKey,
      rowNumber: snapshot.sourceRowNumber,
      date: snapshot.sourceDate,
      rawDate: snapshot.rawDate,
      rawSede: snapshot.rawSede,
      sede: normalizeRatingSede(snapshot.rawSede) || snapshot.sede || (matchedUser ? normalizeSede(matchedUser.sede) : ""),
      advisor,
      matchedUserId: matchedUser?.id ?? snapshot.matchedUserId ?? null,
      matchedUserName: matchedUser?.name ?? snapshot.matchedUserName,
      matchedUsername: matchedUser?.username ?? "",
      matchedUserColor: matchedUser?.color ?? "#4f8ef7",
      matchedUserRole: matchedUser?.role ?? "",
      rating: snapshot.rating,
      dni,
      comment,
      nps: snapshot.nps || "",
      valuableAspects: snapshot.valuableAspects || "",
      externalApprovalStatus: snapshot.externalApprovalStatus,
      externalApprovalBy: snapshot.externalApprovalBy || "",
      externalApprovalAt: snapshot.externalApprovalAt || "",
      valid: snapshot.rating >= 4 && snapshot.rating <= 5 && missingFields.length === 0 && !!matchedUser,
      missingFields,
      autoRejectedMissingDni,
    };
  });

  // Forms occasionally submit the same response twice a few seconds apart.
  // Keep both source rows visible for audit, but only the first can be approved
  // or paid. Require every identifying field to match and a very short window.
  const duplicateOfRowNumber = new Map<number, number>();
  const duplicateGroups = new Map<string, typeof mappedRows>();
  const chronologicallyOrderedRows = [...mappedRows].sort((left, right) =>
    (left.date || "").localeCompare(right.date || "") || left.rowNumber - right.rowNumber,
  );
  for (const row of chronologicallyOrderedRows) {
    if (!row.dni || !row.date || !row.advisor || !row.comment) continue;
    const fingerprint = [
      normalizeText(row.advisor), normalizeText(row.dni), row.rating,
      normalizeText(row.comment), normalizeSede(row.sede), row.date.slice(0, 10),
    ].join("|");
    const group = duplicateGroups.get(fingerprint) || [];
    const timestamp = new Date(row.date).getTime();
    const prior = [...group].reverse().find((candidate) => timestamp - new Date(candidate.date || "").getTime() <= 120_000);
    if (prior) duplicateOfRowNumber.set(row.rowNumber, duplicateOfRowNumber.get(prior.rowNumber) || prior.rowNumber);
    group.push(row);
    duplicateGroups.set(fingerprint, group);
  }
  const baseRows = mappedRows.map((row) => {
    const duplicateOf = duplicateOfRowNumber.get(row.rowNumber) || null;
    return {
      ...row,
      duplicateOfRowNumber: duplicateOf,
      valid: row.valid && !duplicateOf,
    };
  });

  const approvals = storedReads?.approvals ?? await readRatingApprovalsForResponse();
  const approvalSeeds = baseRows
    .filter(
      (
        row,
      ): row is (typeof baseRows)[number] & {
        externalApprovalStatus: RatingApprovalStatus;
      } => row.valid && !!row.externalApprovalStatus && !approvals.some((approval) => approval.rowKey === row.rowKey),
    )
    .map((row) => {
      const decidedBy = pickAutomaticRatingDecider({
        externalApprover: row.externalApprovalBy,
        sede: row.sede,
        users,
      });

      return decidedBy
        ? {
            rowKey: row.rowKey,
            rowNumber: row.rowNumber,
            advisor: row.advisor,
            matchedUserId: row.matchedUserId,
            matchedUserName: row.matchedUserName,
            sede: row.sede,
            rating: row.rating,
            dni: row.dni || null,
            comment: row.comment || null,
            status: row.externalApprovalStatus,
            decidedById: decidedBy.id,
            decidedAt: approvalDecisionDate(row.externalApprovalAt, row.date ? new Date(row.date) : new Date()),
            decisionReason: `Sincronizado automaticamente desde la hoja externa${row.externalApprovalBy ? ` (${row.externalApprovalBy})` : ""}.`,
          }
        : null;
    })
    .filter((approval): approval is NonNullable<typeof approval> => !!approval);

  if (approvalSeeds.length) {
    try {
      await prisma.$transaction(
        approvalSeeds.map((approval) =>
          prisma.ratingApproval.upsert({
            where: { rowKey: approval.rowKey },
            update: {
              status: approval.status,
              decidedById: approval.decidedById,
              decidedAt: approval.decidedAt,
              decisionReason: approval.decisionReason,
            },
            create: approval,
          }),
        ),
      );
      approvals.push(
        ...(await prisma.ratingApproval.findMany({
          where: { rowKey: { in: approvalSeeds.map((approval) => approval.rowKey) } },
          include: {
            decidedBy: {
              select: {
                id: true,
                name: true,
                username: true,
                role: true,
                sede: true,
                color: true,
                forcePasswordReset: true,
              },
            },
          },
        })),
      );
    } catch (error) {
      console.error("No se pudieron sincronizar aprobaciones externas de calificaciones", error);
    }
  }

  const approvalsByKey = new Map(approvals.map((approval) => [approval.rowKey, approval]));
  const approvalsByLegacyKey = createUniqueLookup(approvals, legacyApprovalKey);
  const approvalsByStableKey = createUniqueLookup(approvals, stableApprovalKey);
  const approvalsByStableKeyWithoutComment = createUniqueLookup(approvals, stableApprovalKeyWithoutComment);
  const approvalsByStableKeyWithoutDni = createUniqueLookup(approvals, stableApprovalKeyWithoutDni);
  const approvalsByHistoricalKey = createUniqueLookup(approvals, (approval) => historicalApprovalKey(approval));
  const baseRowsByStableKeyCount = countByKey(baseRows, stableApprovalKey);
  const baseRowsByStableKeyWithoutCommentCount = countByKey(baseRows, stableApprovalKeyWithoutComment);
  const baseRowsByStableKeyWithoutDniCount = countByKey(baseRows, stableApprovalKeyWithoutDni);
  const matchedApprovalIds = new Set<number>();
  const remappedApprovals: Array<{
    approval: (typeof approvals)[number];
    row: (typeof baseRows)[number];
  }> = [];

  const rowsWithApproval = baseRows.map((row) => {
    let approval = approvalsByKey.get(row.rowKey) || null;

    if (!approval) {
      const legacyMatch = approvalsByLegacyKey.get(legacyApprovalKey(row));
      if (legacyMatch && !matchedApprovalIds.has(legacyMatch.id)) {
        approval = legacyMatch;
      }
    }

    if (!approval) {
      const historicalKey = historicalApprovalKey(row);
      const historicalMatch = approvalsByHistoricalKey.get(historicalKey);
      if (historicalMatch && !matchedApprovalIds.has(historicalMatch.id)) {
        approval = historicalMatch;
      }
    }

    if (!approval) {
      const stableKey = stableApprovalKey(row);
      const stableMatch = approvalsByStableKey.get(stableKey);
      if (
        stableMatch &&
        !matchedApprovalIds.has(stableMatch.id) &&
        (baseRowsByStableKeyCount.get(stableKey) || 0) === 1
      ) {
        approval = stableMatch;
      }
    }

    if (!approval) {
      const stableKeyWithoutComment = stableApprovalKeyWithoutComment(row);
      const stableNoCommentMatch = approvalsByStableKeyWithoutComment.get(stableKeyWithoutComment);
      if (
        stableNoCommentMatch &&
        !matchedApprovalIds.has(stableNoCommentMatch.id) &&
        (baseRowsByStableKeyWithoutCommentCount.get(stableKeyWithoutComment) || 0) === 1
      ) {
        approval = stableNoCommentMatch;
      }
    }

    if (!approval && !row.dni) {
      const stableKeyWithoutDni = stableApprovalKeyWithoutDni(row);
      const stableNoDniMatch = approvalsByStableKeyWithoutDni.get(stableKeyWithoutDni);
      if (
        stableNoDniMatch &&
        !matchedApprovalIds.has(stableNoDniMatch.id) &&
        (baseRowsByStableKeyWithoutDniCount.get(stableKeyWithoutDni) || 0) === 1
      ) {
        approval = stableNoDniMatch;
      }
    }

    if (approval) {
      matchedApprovalIds.add(approval.id);
      if (approval.rowKey !== row.rowKey) {
        remappedApprovals.push({ approval, row });
      }
    }

    return { row, approval };
  });

  if (remappedApprovals.length) {
    // La migración de claves antiguas se resuelve en memoria al mostrar el
    // reporte. Persistirla desde cada lectura provocaba transacciones iguales
    // concurrentes cuando varios usuarios abrían Calificaciones a la vez.
    // Las decisiones ya guardadas se mantienen y el detalle se sigue viendo
    // aprobado; la lectura no debe modificar datos ni bloquear el login.
    remappedApprovals.forEach(({ approval, row }) => {
      approval.rowKey = row.rowKey;
      approval.rowNumber = row.rowNumber;
      approval.advisor = row.advisor;
      approval.matchedUserId = row.matchedUserId;
      approval.matchedUserName = row.matchedUserName || approval.matchedUserName;
      approval.sede = approval.sede || row.sede;
      approval.rating = row.rating;
      approval.dni = row.dni || null;
      approval.comment = row.comment || null;
      approvalsByKey.set(row.rowKey, approval);
    });
  }

  const rows = rowsWithApproval.map(({ row, approval }) => {
    const mergedRow = mergeRatingOverride(row, approval || null, settings, users);
    const approvalStatus = mergedRow.autoRejectedMissingDni
      ? RatingApprovalStatus.REJECTED
      : !mergedRow.valid
        ? "INVALID"
        : (approval?.status ?? RatingApprovalStatus.PENDING);
    const payable = mergedRow.valid && approvalStatus === RatingApprovalStatus.APPROVED;
    return {
      ...mergedRow,
      approvalStatus,
      approvedAt: approval?.status === RatingApprovalStatus.APPROVED ? approval.decidedAt?.toISOString() ?? "" : "",
      rejectedAt: approval?.status === RatingApprovalStatus.REJECTED ? approval.decidedAt?.toISOString() ?? "" : "",
      decisionReason: approval?.decisionReason ?? (row.duplicateOfRowNumber
        ? `Posible envío duplicado de la fila ${row.duplicateOfRowNumber}; no genera comisión.`
        : row.autoRejectedMissingDni ? "Rechazo automático: falta DNI." : ""),
      decidedBy: approval?.decidedBy
        ? {
            ...approval.decidedBy,
            sede: normalizeSede(approval.decidedBy.sede),
          }
        : null,
      payable,
      amount: payable ? settings.payoutSettings.ratingCommission : 0,
    };
  });

  const deletedKeys = new Set((storedReads?.deletedLogs ?? await deletedRatingLogs()).map(log => log.targetId));
  const visibleRows = rows.filter((row) => {
    if (permanentlyRemovedRatingKeys.has(ratingDeletionKey(row.rowKey)) || deletedKeys.has(ratingDeletionKey(row.rowKey))) return false;
    if (scopedMonth && ratingRowMonth(row) !== scopedMonth) return false;
    const date = ratingRowDateKey(row);
    if (from && date < from) return false;
    if (to && date > to) return false;
    return canAccessRatingRow(currentUser, row, users);
  });

  return {
    settings,
    columns: { dateHeader, sedeHeader, advisorHeader, ratingHeader, commentHeader, dniHeader },
    rows: visibleRows,
    summary: buildRatingsSummary(visibleRows),
    warning,
    stale,
  };
}

export async function decideRating(currentUser: UserLite, input: { rowKey: string; action: "approve" | "reject" | "pending"; reason?: string }) {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.MANAGER) {
    throw new Error("Solo admin o jefe de sede puede aprobar calificaciones.");
  }
  // Validate against persisted snapshots; sheet sync belongs to normal listing reads.
  const payload = await buildRatingsResponse(currentUser, { sync: false });
  const row = payload.rows.find((item) => item.rowKey === input.rowKey);
  if (!row) {
    throw new Error("No se encontro la calificacion o no pertenece a tu sede.");
  }
  if (!row.valid) {
    throw new Error("Esta calificacion no cumple la configuracion de validez.");
  }
  if (await isMonthClosedForRole(monthFromDate(row.approvedAt || row.date || row.rawDate), currentUser.role)) {
    throw new Error("Este mes esta cerrado. Solo el admin puede decidir calificaciones de un mes cerrado.");
  }

  const status =
    input.action === "approve"
      ? RatingApprovalStatus.APPROVED
      : input.action === "reject"
        ? RatingApprovalStatus.REJECTED
        : RatingApprovalStatus.PENDING;
  const approval = await prisma.ratingApproval.upsert({
    where: { rowKey: row.rowKey },
    update: {
      status,
      decidedById: currentUser.id,
      decidedAt: new Date(),
      decisionReason: input.action === "pending" ? null : input.reason?.trim() || null,
    },
    create: {
      rowKey: row.rowKey,
      rowNumber: row.rowNumber,
      advisor: row.advisor,
      matchedUserId: row.matchedUserId,
      matchedUserName: row.matchedUserName,
      sede: row.sede,
      rating: row.rating,
      dni: row.dni || null,
      comment: row.comment || null,
      status,
      decidedById: currentUser.id,
      decidedAt: new Date(),
      decisionReason: input.action === "pending" ? null : input.reason?.trim() || null,
    },
  });

  const payable = status === RatingApprovalStatus.APPROVED;
  await logChange({actorId:currentUser.id,module:"Calificaciones",action:input.action==="approve"?"APROBAR":input.action==="reject"?"RECHAZAR":"PENDIENTE",summary:`${input.action==="approve"?"Aprobó":input.action==="reject"?"Rechazó":"Devolvió a pendiente"} calificación de ${row.matchedUserName || row.advisor}.`,targetType:"RatingApproval",targetId:row.rowKey,sede:row.sede,before:{status:row.approvalStatus,reason:row.decisionReason},after:{status,reason:approval.decisionReason,decidedAt:approval.decidedAt}});
  return { approval, row: {
    ...row,
    approvalStatus: status,
    approvedAt: payable ? approval.decidedAt?.toISOString() ?? "" : "",
    rejectedAt: status === RatingApprovalStatus.REJECTED ? approval.decidedAt?.toISOString() ?? "" : "",
    decisionReason: approval.decisionReason ?? "",
    decidedBy: { id: currentUser.id, name: currentUser.name, username: currentUser.username, role: currentUser.role, sede: normalizeSede(currentUser.sede), color: currentUser.color },
    payable,
    amount: payable ? payload.settings.payoutSettings.ratingCommission : 0,
  } };
}

export async function updateRatingEntry(
  currentUser: UserLite,
  input: { rowKey: string; advisor: string; dni: string; comment?: string },
) {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.MANAGER) {
    throw new Error("Solo admin o jefe de sede puede editar calificaciones.");
  }

  const payload = await buildRatingsResponse(currentUser);
  const row = payload.rows.find((item) => item.rowKey === input.rowKey);
  if (!row) {
    throw new Error("No se encontro la calificacion o no pertenece a tu sede.");
  }
  if (await isMonthClosedForRole(monthFromDate(row.approvedAt || row.date || row.rawDate), currentUser.role)) {
    throw new Error("Este mes esta cerrado. Solo el admin puede editar calificaciones de un mes cerrado.");
  }

  const users = await prisma.user.findMany({
    where: { role: { not: UserRole.ADMIN } },
    select: { id: true, name: true, username: true, role: true, sede: true, color: true },
    orderBy: { name: "asc" },
  });
  const advisor = input.advisor.trim();
  const dni = input.dni.trim();
  const comment = input.comment?.trim() || null;
  const matchedUser = matchAdvisor(advisor, row.sede, users);

  const approval = await prisma.ratingApproval.upsert({
    where: { rowKey: row.rowKey },
    update: {
      advisor,
      dni: dni || null,
      comment,
      matchedUserId: matchedUser?.id ?? null,
      matchedUserName: matchedUser?.name ?? advisor,
      sede: matchedUser ? normalizeSede(matchedUser.sede) : row.sede,
      rating: row.rating,
    },
    create: {
      rowKey: row.rowKey,
      rowNumber: row.rowNumber,
      advisor,
      matchedUserId: matchedUser?.id ?? null,
      matchedUserName: matchedUser?.name ?? advisor,
      sede: matchedUser ? normalizeSede(matchedUser.sede) : row.sede,
      rating: row.rating,
      dni: dni || null,
      comment,
      status: row.approvalStatus === "APPROVED" ? RatingApprovalStatus.APPROVED : row.approvalStatus === "REJECTED" ? RatingApprovalStatus.REJECTED : RatingApprovalStatus.PENDING,
      decidedById: row.decidedBy?.id ?? null,
      decidedAt: row.approvedAt || row.rejectedAt ? new Date(row.approvedAt || row.rejectedAt) : null,
      decisionReason: row.decisionReason || null,
    },
  });

  await logChange({actorId:currentUser.id,module:"Calificaciones",action:"EDITAR",summary:`Editó calificación de ${row.matchedUserName || row.advisor}.`,targetType:"RatingApproval",targetId:row.rowKey,sede:row.sede,before:{advisor:row.advisor,dni:row.dni,comment:row.comment},after:{advisor,dni,comment}});
  return { approval };
}
