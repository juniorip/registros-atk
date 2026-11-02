import {
  AppSettings,
  PenaltyReport,
  Prisma,
  Record,
  RecordMode,
  RecordType,
  Referral,
  ReferralBank,
  UploadPlatform,
  User,
  UserRole,
  WrongCardReport,
} from "@prisma/client";

export const SEDES = ["Lince", "Sur", "Norte", "Miraflores"] as const;
export const WARN_DAY = 6;
export const EXPIRE_DAY = 7;
export const WRONG_CARD_BONUS = 10;

export const DEFAULT_PAYROLL_ROLE_CONFIG = {
  "Jefe de Pagos": { baseSalary: 3000, penaltyPerMinute: 1, bonus: 150, balanceBonus: 75 },
  "Subjefe de Pagos": { baseSalary: 2500, penaltyPerMinute: 1, bonus: 150, balanceBonus: 75 },
  "Encargado de Pagos": { baseSalary: 2000, penaltyPerMinute: 1, bonus: 150, balanceBonus: 75 },
  "Jefe de Sede": { baseSalary: 1500, penaltyPerMinute: 0.7, bonus: 70, balanceBonus: 0 },
  "Personal Registro": { baseSalary: 1250, penaltyPerMinute: 0.5, bonus: 50, balanceBonus: 0 },
  Facturacion: { baseSalary: 1500, penaltyPerMinute: 0.7, bonus: 50, balanceBonus: 0 },
  Marketing: { baseSalary: 0, penaltyPerMinute: 0, bonus: 0, balanceBonus: 0 },
  "Sin definir": { baseSalary: 0, penaltyPerMinute: 0, bonus: 0, balanceBonus: 0 },
};

export const DEFAULT_PAYOUT_SETTINGS = {
  callCommission: 0.05,
  ratingCommission: 2,
  wrongCardBonus: 10,
  managerRatingApprovalCommission: 0.3,
  managerRecordValidationCommission: 0.3,
  managerPenaltyApprovalCommission: 0.5,
  safetypaySharedThreshold: 0.8,
  safetypaySharedBonusPool: 300,
  safetypayManagerBonus: 300,
  commercialCardCommissionRate: 0.08,
  commercialCardMinimumCommission: 30,
  commercialCardMinimumThreshold: 375,
  roleDefaults: DEFAULT_PAYROLL_ROLE_CONFIG,
};

export type PayrollRoleDefault = {
  baseSalary: number;
  penaltyPerMinute: number;
  bonus: number;
  balanceBonus?: number;
};

export type CustomerServicePenalty = {
  code: string;
  label: string;
  amount: number;
  description: string;
};

export type PayoutSettings = {
  callCommission: number;
  ratingCommission: number;
  wrongCardBonus: number;
  managerRatingApprovalCommission: number;
  managerRecordValidationCommission?: number;
  managerPenaltyApprovalCommission: number;
  safetypaySharedThreshold: number;
  safetypaySharedBonusPool: number;
  safetypayManagerBonus: number;
  commercialCardCommissionRate: number;
  commercialCardMinimumCommission: number;
  commercialCardMinimumThreshold: number;
  roleDefaults?: globalThis.Record<string, PayrollRoleDefault>;
  customerServicePenalties?: CustomerServicePenalty[];
};

export type VisibleStateUser = Pick<
  User,
  "id" | "name" | "username" | "role" | "sede" | "forcePasswordReset" | "color"
>;

export type VisibleStateRecord = Record & {
  user: VisibleStateUser;
  validatedBy: VisibleStateUser | null;
  historicalSede?: string | null;
};

export type VisibleStateReferral = Referral & {
  user: VisibleStateUser;
  validatedBy: VisibleStateUser | null;
  historicalSede?: string | null;
};

export type VisibleStatePenaltyReport = PenaltyReport & {
  sentBy: VisibleStateUser;
  receiver: VisibleStateUser | null;
  decidedBy: VisibleStateUser | null;
};

export type VisibleStateWrongCardReport = WrongCardReport & {
  user: VisibleStateUser;
  validatedBy: VisibleStateUser | null;
  historicalSede?: string | null;
};

export const CUSTOMER_SERVICE_PENALTIES = [
  {
    code: "ERROR_DATOS",
    label: "Error de datos",
    amount: 2,
    description: "Dato errado remanente en formulario detectado por Facturación o jefe.",
  },
  {
    code: "ABANDONO_CHAT",
    label: "Abandono chat",
    amount: 2,
    description: "Chat con más de 20 minutos sin respuesta.",
  },
  {
    code: "MAL_FLUJO_CMR_SAFETY",
    label: "Mal flujo CMR / Safety",
    amount: 2,
    description: "Omitir protocolo obligatorio o responder con textos genéricos.",
  },
  {
    code: "PROCESO_AL_AIRE",
    label: "Dejar conversación / proceso al aire",
    amount: 2,
    description: "Chat abandonado sin registrar datos obligatorios de cuentas o tarjetas.",
  },
  {
    code: "ERROR_REGISTRO_MANUAL",
    label: "Error en registro manual o código",
    amount: 2,
    description: "DNI, nombre, celular, correo o código ingresado incorrectamente.",
  },
  {
    code: "FALTA_UNIFORME",
    label: "Falta de uniforme completo",
    amount: 10,
    description: "Asistencia sin polo o uniforme oficial de la empresa.",
  },
] as const;

export function normalizeSede(value?: string | null) {
  // "Centro" was the former name of the Lince office. Keep historical data
  // visible, but expose and route it consistently as Lince.
  return value === "Centro" ? "Lince" : value || "Lince";
}

export function resolveHistoricalSede(
  value?: string | null,
  fallback?: string | null,
) {
  return normalizeSede(value || fallback);
}

function ownedEntrySede(
  entry: { historicalSede?: string | null; user: Pick<User, "sede"> },
) {
  return resolveHistoricalSede(entry.historicalSede, entry.user.sede);
}

export function isAdmin(user: VisibleStateUser | User) {
  return user.role === UserRole.ADMIN;
}

export function isManager(user: VisibleStateUser | User) {
  return user.role === UserRole.MANAGER;
}

export function isEmployee(user: VisibleStateUser | User) {
  return user.role === UserRole.EMPLOYEE;
}

function identityWords(user: Pick<User, "name" | "username">) {
  return `${user.name} ${user.username}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Matías supervisa el equipo de Pagos sin mezclarlo con la sede Lince. */
export function isPaymentsSupervisor(user: Pick<User, "name" | "username">) {
  return identityWords(user).includes("matias");
}

export function isPaymentsTeamMember(user: Pick<User, "name" | "username">) {
  const words = new Set(identityWords(user));
  return ["franco", "junior", "laura", "andrea"].some((name) => words.has(name));
}

export function canManageSafetypayPayments(user: VisibleStateUser | User) {
  return user.username.trim().toLowerCase() === "laura";
}

export function canPreviewAllSedesAsManager(user: VisibleStateUser | User) {
  return user.role === UserRole.MANAGER && user.username.trim().toLowerCase() === "jefe.temporal";
}

export function daysSince(date: Date | string) {
  const base = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - base.getTime();
  return Math.floor(diff / 86400000);
}

export function operationDelay(record: Pick<Record, "registrationDate" | "operationDate">) {
  if (!record.operationDate) return null;
  // Match the YYYY-MM-DD dates displayed by the client. Turnos registrations
  // retain their time, while an edited operation date is stored at midnight.
  const calendarDay = (date: Date) =>
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return (calendarDay(record.operationDate) - calendarDay(record.registrationDate)) / 86400000;
}

export function operatedWithinWindow(record: Pick<Record, "registrationDate" | "operationDate">) {
  const delay = operationDelay(record);
  return delay !== null && delay >= 0 && delay <= EXPIRE_DAY;
}

export function isPendingApproval(
  record: Pick<
    Record,
    "type" | "operationDate" | "registrationDate" | "validatedAt" | "rejectedAt"
  >,
) {
  return (
    record.type === RecordType.OPERACION &&
    !!record.operationDate &&
    operatedWithinWindow(record) &&
    !record.validatedAt &&
    !record.rejectedAt
  );
}

export function isApprovalLocked(
  record: Pick<
    Record,
    "type" | "operationDate" | "registrationDate" | "validatedAt" | "rejectedAt"
  >,
) {
  return isPendingApproval(record) || !!record.validatedAt || !!record.rejectedAt;
}

export function getVisibleUsers(currentUser: VisibleStateUser, users: VisibleStateUser[]) {
  if (isAdmin(currentUser) || canPreviewAllSedesAsManager(currentUser)) return users;
  if (isManager(currentUser)) {
    if (isPaymentsSupervisor(currentUser)) {
      return users.filter((user) => user.id === currentUser.id || isPaymentsTeamMember(user));
    }
    return users.filter(
      (user) =>
        user.role !== UserRole.ADMIN &&
        !isPaymentsTeamMember(user) &&
        normalizeSede(user.sede) === normalizeSede(currentUser.sede),
    );
  }
  return users.filter((user) => user.id === currentUser.id);
}

export function canManageUsers(currentUser: VisibleStateUser) {
  if (canPreviewAllSedesAsManager(currentUser)) return false;
  return isAdmin(currentUser) || isManager(currentUser);
}

export function canManageUserRole(currentUser: VisibleStateUser, role: UserRole) {
  if (canPreviewAllSedesAsManager(currentUser)) return false;
  if (isAdmin(currentUser)) return true;
  return isManager(currentUser) && role === UserRole.EMPLOYEE;
}

export function canManageUser(currentUser: VisibleStateUser, user: VisibleStateUser) {
  if (canPreviewAllSedesAsManager(currentUser)) return false;
  if (isAdmin(currentUser)) return user.id !== currentUser.id;
  if (isPaymentsSupervisor(currentUser)) return isPaymentsTeamMember(user);
  return (
    isManager(currentUser) &&
    user.role === UserRole.EMPLOYEE &&
    !isPaymentsTeamMember(user) &&
    normalizeSede(user.sede) === normalizeSede(currentUser.sede)
  );
}

export function canViewRecord(currentUser: VisibleStateUser, record: VisibleStateRecord) {
  if (isAdmin(currentUser) || canPreviewAllSedesAsManager(currentUser)) return true;
  if (isManager(currentUser)) {
    if (isPaymentsSupervisor(currentUser)) return isPaymentsTeamMember(record.user);
    if (isPaymentsTeamMember(record.user)) return false;
    return ownedEntrySede(record) === normalizeSede(currentUser.sede);
  }
  return record.userId === currentUser.id;
}

export function canValidateOrReject(currentUser: VisibleStateUser, record: VisibleStateRecord) {
  if (!isPendingApproval(record)) return false;
  if (isAdmin(currentUser)) return true;
  if (canPreviewAllSedesAsManager(currentUser)) return false;
  if (isManager(currentUser)) {
    if (isPaymentsSupervisor(currentUser)) return isPaymentsTeamMember(record.user);
    if (isPaymentsTeamMember(record.user)) return false;
    return ownedEntrySede(record) === normalizeSede(currentUser.sede);
  }
  return false;
}

export function canDeleteRecord(currentUser: VisibleStateUser, record: VisibleStateRecord) {
  if (isAdmin(currentUser)) return true;
  if (canPreviewAllSedesAsManager(currentUser)) return false;
  if (isManager(currentUser)) {
    if (isPaymentsSupervisor(currentUser)) return isPaymentsTeamMember(record.user);
    if (isPaymentsTeamMember(record.user)) return false;
    return ownedEntrySede(record) === normalizeSede(currentUser.sede);
  }
  return false;
}

export function canViewReferral(currentUser: VisibleStateUser, referral: VisibleStateReferral) {
  if (isAdmin(currentUser) || canPreviewAllSedesAsManager(currentUser)) return true;
  if (isManager(currentUser)) {
    if (isPaymentsSupervisor(currentUser)) return isPaymentsTeamMember(referral.user);
    if (isPaymentsTeamMember(referral.user)) return false;
    return ownedEntrySede(referral) === normalizeSede(currentUser.sede);
  }
  return referral.userId === currentUser.id;
}

export function canValidateReferral(currentUser: VisibleStateUser, referral: VisibleStateReferral) {
  if (referral.validatedAt || referral.rejectedAt) return false;
  if (isAdmin(currentUser)) return true;
  if (canPreviewAllSedesAsManager(currentUser)) return false;
  if (isManager(currentUser)) {
    if (isPaymentsSupervisor(currentUser)) return isPaymentsTeamMember(referral.user);
    if (isPaymentsTeamMember(referral.user)) return false;
    return ownedEntrySede(referral) === normalizeSede(currentUser.sede);
  }
  return false;
}

export function canDeleteReferral(currentUser: VisibleStateUser, referral: VisibleStateReferral) {
  if (isAdmin(currentUser)) return true;
  if (canPreviewAllSedesAsManager(currentUser)) return false;
  if (isManager(currentUser)) {
    if (isPaymentsSupervisor(currentUser)) return isPaymentsTeamMember(referral.user);
    if (isPaymentsTeamMember(referral.user)) return false;
    return ownedEntrySede(referral) === normalizeSede(currentUser.sede);
  }
  return referral.userId === currentUser.id && !referral.validatedAt;
}

export function getPenaltyByCode(code: string) {
  return CUSTOMER_SERVICE_PENALTIES.find((penalty) => penalty.code === code);
}

export function canCreatePenaltyReport(currentUser: VisibleStateUser) {
  if (canPreviewAllSedesAsManager(currentUser)) return false;
  return isManager(currentUser) || isAdmin(currentUser);
}

export const PAYMENT_AUDIT_PENALTY_CODE = "PAYMENT_AUDIT_ERROR";
export const PAYMENT_AUDIT_PENALTY_LABEL = "Error detectado por Pagos";
export const PAYMENT_AUDIT_ADVISOR_PENALTY = 0.5;
export const PAYMENT_AUDIT_MANAGER_PENALTY = 0.5;
export const PAYMENT_AUDIT_REPORTER_BONUS = 1;

const PAYMENT_AUDITOR_NAMES = new Set(["franco", "matias", "junior", "andrea", "laura"]);

function normalizedWords(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Only the named Pagos team may create this kind of audit. */
export function canCreatePaymentAudit(currentUser: VisibleStateUser) {
  if (!currentUser || canPreviewAllSedesAsManager(currentUser)) return false;
  const words = new Set([
    ...normalizedWords(currentUser.name),
    ...normalizedWords(currentUser.username),
  ]);
  return Array.from(PAYMENT_AUDITOR_NAMES).some((name) => words.has(name));
}

export function canViewPenaltyReport(
  currentUser: VisibleStateUser,
  report: Pick<PenaltyReport, "sentById" | "targetSede" | "workerSede" | "workerUserId">,
) {
  if (isAdmin(currentUser) || canPreviewAllSedesAsManager(currentUser)) return true;
  if (report.sentById === currentUser.id) return true;
  if (!isManager(currentUser)) return report.workerUserId === currentUser.id;
  const sede = normalizeSede(currentUser.sede);
  return (
    report.sentById === currentUser.id ||
    normalizeSede(report.targetSede) === sede ||
    normalizeSede(report.workerSede) === sede
  );
}

export function canDecidePenaltyReport(
  currentUser: VisibleStateUser,
  report: Pick<PenaltyReport, "status" | "targetSede">,
) {
  if (report.status !== "PENDING") return false;
  if (isAdmin(currentUser)) return true;
  if (canPreviewAllSedesAsManager(currentUser)) return false;
  return isManager(currentUser) && normalizeSede(report.targetSede) === normalizeSede(currentUser.sede);
}

export function canViewWrongCardReport(
  currentUser: VisibleStateUser,
  report: Pick<WrongCardReport, "userId"> & { historicalSede?: string | null; user: Pick<User, "sede" | "name" | "username"> },
) {
  if (isAdmin(currentUser) || canPreviewAllSedesAsManager(currentUser)) return true;
  if (isManager(currentUser)) {
    if (isPaymentsSupervisor(currentUser)) return isPaymentsTeamMember(report.user);
    if (isPaymentsTeamMember(report.user)) return false;
    return ownedEntrySede(report) === normalizeSede(currentUser.sede);
  }
  return report.userId === currentUser.id;
}

export function canValidateWrongCardReport(
  currentUser: VisibleStateUser,
  report: Pick<WrongCardReport, "status"> & { historicalSede?: string | null; user: Pick<User, "sede" | "name" | "username"> },
) {
  if (report.status !== "PENDING") return false;
  if (isAdmin(currentUser)) return true;
  if (canPreviewAllSedesAsManager(currentUser)) return false;
  if (isPaymentsSupervisor(currentUser)) return isPaymentsTeamMember(report.user);
  if (isPaymentsTeamMember(report.user)) return false;
  return isManager(currentUser) && ownedEntrySede(report) === normalizeSede(currentUser.sede);
}

export function calcReferralBankCommission(bank: ReferralBank, amount: number) {
  return amount;
}

export function calcReferralCommission(bank: ReferralBank, amount: number) {
  return amount * 0.004;
}

export function formatReferralBank(bank: ReferralBank) {
  if (bank === ReferralBank.BBVA) return "BBVA";
  if (bank === ReferralBank.BCP) return "BCP";
  if (bank === ReferralBank.SCOTIABANK) return "Scotiabank";
  if (bank === ReferralBank.INTERBANK) return "Interbank";
  return bank;
}

export function getCommissionRate(settings: AppSettings | null) {
  if (!settings) return 0.4;
  return Number(settings.commissionPerRecord);
}

function positiveNumber(value: unknown, fallback: number, options: { allowZero?: boolean; max?: number } = {}) {
  const numeric = Number(value);
  const min = options.allowZero ? 0 : Number.MIN_VALUE;
  if (!Number.isFinite(numeric) || numeric < min) return fallback;
  if (Number.isFinite(options.max) && numeric > Number(options.max)) return fallback;
  return numeric;
}

function payrollRoleDefaults(value: unknown): globalThis.Record<string, PayrollRoleDefault> {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as { [key: string]: unknown }
    : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_PAYROLL_ROLE_CONFIG).map(([role, fallback]) => {
      const candidate = raw[role] && typeof raw[role] === "object" && !Array.isArray(raw[role])
        ? raw[role] as { [key: string]: unknown }
        : {};
      return [role, {
        baseSalary: positiveNumber(candidate.baseSalary, fallback.baseSalary, { allowZero: true }),
        penaltyPerMinute: positiveNumber(candidate.penaltyPerMinute, fallback.penaltyPerMinute, { allowZero: true }),
        bonus: positiveNumber(candidate.bonus, fallback.bonus, { allowZero: true }),
        balanceBonus: positiveNumber(candidate.balanceBonus, fallback.balanceBonus, { allowZero: true }),
      }];
    }),
  );
}

function customerServicePenalties(value: unknown): CustomerServicePenalty[] {
  const raw = Array.isArray(value) ? value : [];
  const byCode = new Map<string, CustomerServicePenalty>();
  CUSTOMER_SERVICE_PENALTIES.forEach((penalty) => byCode.set(penalty.code, { ...penalty }));
  raw.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const candidate = item as { [key: string]: unknown };
    const code = String(candidate.code || "").trim();
    if (!code || !byCode.has(code)) return;
    const fallback = byCode.get(code)!;
    byCode.set(code, {
      code,
      label: String(candidate.label || fallback.label).trim() || fallback.label,
      amount: positiveNumber(candidate.amount, fallback.amount, { allowZero: true }),
      description: String(candidate.description || fallback.description).trim() || fallback.description,
    });
  });
  return Array.from(byCode.values());
}

export function getPayoutSettings(settings: AppSettings | null): PayoutSettings {
  const payoutSettings = (settings as unknown as { payoutSettings?: unknown } | null)?.payoutSettings;
  const raw = payoutSettings && typeof payoutSettings === "object" && !Array.isArray(payoutSettings)
    ? payoutSettings as { [key: string]: unknown }
    : {};
  return {
    callCommission: positiveNumber(raw.callCommission, DEFAULT_PAYOUT_SETTINGS.callCommission, { allowZero: true }),
    ratingCommission: positiveNumber(raw.ratingCommission, DEFAULT_PAYOUT_SETTINGS.ratingCommission, { allowZero: true }),
    wrongCardBonus: positiveNumber(raw.wrongCardBonus, DEFAULT_PAYOUT_SETTINGS.wrongCardBonus, { allowZero: true }),
    managerRatingApprovalCommission: positiveNumber(raw.managerRatingApprovalCommission, DEFAULT_PAYOUT_SETTINGS.managerRatingApprovalCommission, { allowZero: true }),
    managerRecordValidationCommission: positiveNumber(raw.managerRecordValidationCommission, DEFAULT_PAYOUT_SETTINGS.managerRecordValidationCommission, { allowZero: true }),
    managerPenaltyApprovalCommission: positiveNumber(raw.managerPenaltyApprovalCommission, DEFAULT_PAYOUT_SETTINGS.managerPenaltyApprovalCommission, { allowZero: true }),
    safetypaySharedThreshold: positiveNumber(raw.safetypaySharedThreshold, DEFAULT_PAYOUT_SETTINGS.safetypaySharedThreshold, { allowZero: true, max: 1 }),
    safetypaySharedBonusPool: positiveNumber(raw.safetypaySharedBonusPool, DEFAULT_PAYOUT_SETTINGS.safetypaySharedBonusPool, { allowZero: true }),
    safetypayManagerBonus: positiveNumber(raw.safetypayManagerBonus, DEFAULT_PAYOUT_SETTINGS.safetypayManagerBonus, { allowZero: true }),
    commercialCardCommissionRate: positiveNumber(raw.commercialCardCommissionRate, DEFAULT_PAYOUT_SETTINGS.commercialCardCommissionRate, { allowZero: true, max: 1 }),
    commercialCardMinimumCommission: positiveNumber(raw.commercialCardMinimumCommission, DEFAULT_PAYOUT_SETTINGS.commercialCardMinimumCommission, { allowZero: true }),
    commercialCardMinimumThreshold: positiveNumber(raw.commercialCardMinimumThreshold, DEFAULT_PAYOUT_SETTINGS.commercialCardMinimumThreshold, { allowZero: true }),
    roleDefaults: payrollRoleDefaults(raw.roleDefaults),
    customerServicePenalties: customerServicePenalties(raw.customerServicePenalties),
  };
}

export function getCommissionableRecordsForUser(
  user: VisibleStateUser,
  records: VisibleStateRecord[],
) {
  if (user.role === UserRole.MANAGER || user.role === UserRole.EMPLOYEE) {
    return records.filter((record) => record.userId === user.id && !!record.validatedAt);
  }

  return [];
}

export function calcUserCommission(
  user: VisibleStateUser,
  records: VisibleStateRecord[],
  settings: AppSettings | null,
) {
  return getCommissionableRecordsForUser(user, records).length * getCommissionRate(settings);
}

export function formatDate(date?: Date | null) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("es-PE").format(date);
}

export function formatDateTime(date?: Date | null) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function formatRole(role: UserRole) {
  if (role === UserRole.ADMIN) return "Admin General";
  if (role === UserRole.MANAGER) return "Jefe de sede";
  return "Atención al cliente";
}

export function formatRecordType(type: RecordType) {
  return type === RecordType.OPERACION ? "Operación" : "Registro";
}

export function formatRecordMode(mode: RecordMode) {
  return mode === RecordMode.PRESENCIAL ? "Presencial" : "Virtual";
}

export function formatPlatform(platform: UploadPlatform) {
  return platform === UploadPlatform.DRIVE ? "Drive" : "Web";
}

export function validationLabel(record: VisibleStateRecord) {
  if (record.validatedAt) return `Validado ${formatDate(record.validatedAt)}`;
  if (record.rejectedAt) return "Rechazado";
  if (
    record.type === RecordType.OPERACION &&
    record.operationDate &&
    !operatedWithinWindow(record)
  ) {
    return "Operó fuera de plazo";
  }
  if (isPendingApproval(record)) return "Pendiente de aprobación";
  if (record.type === RecordType.REGISTRO && daysSince(record.registrationDate) > EXPIRE_DAY) {
    return "Sin operación válida";
  }
  return "Aún sin validar";
}

export function createSeedUser(input: {
  name: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  sede: string;
  color: string;
  forcePasswordReset?: boolean;
}): Prisma.UserCreateInput {
  return {
    name: input.name,
    username: input.username,
    passwordHash: input.passwordHash,
    role: input.role,
    sede: normalizeSede(input.sede),
    color: input.color,
    forcePasswordReset: input.forcePasswordReset ?? false,
  };
}
