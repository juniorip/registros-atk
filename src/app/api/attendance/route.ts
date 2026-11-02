import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/current-user";
import { logChange } from "@/lib/change-log";
import { withDbRetry } from "@/lib/db-retry";
import { attendanceRevision } from "@/lib/attendance-revision";
import { isAdmin, isManager, isPaymentsSupervisor, normalizeSede } from "@/lib/domain";
import { currentMonthKey, isMonthClosedForRole, monthFromDate } from "@/lib/monthly-closure";
import {
  clearAttendanceMonth,
  approvePendingAttendanceChangeRequests,
  createAttendanceChangeRequest,
  deleteAttendanceCollaborator,
  deletePendingAttendanceChangeRequests,
  decideAttendanceChangeRequest,
  importAttendanceWorkbook,
  markAttendanceCommissionsPaid,
  markAttendanceAllCommissionsPaid,
  markAttendanceSalaryPaid,
  markAttendanceSalariesPaid,
  readAttendanceData,
  reactivateAttendanceCollaborator,
  terminateAttendanceCollaborator,
  readAttendanceChangeRequestHistory,
  readPendingAttendanceChangeRequests,
  updateAttendanceBonus,
  writeAttendanceOverride,
  writeAttendanceProfile,
} from "@/lib/attendance";

export const dynamic = "force-dynamic";

function departmentSede(department?: string | null) {
  const value = (department || "").toUpperCase();
  if (value.includes("NORTE")) return "Norte";
  if (value.includes("SUR")) return "Sur";
  if (value.includes("MIRAFLORES") || value.includes("MIRAF")) return "Miraflores";
  if (value.includes("LINCE") || value.includes("CENTRO")) return "Lince";
  return null;
}

function personSede(person?: { department?: string | null; extraBonuses?: unknown } | null) {
  const extraBonuses = person?.extraBonuses && typeof person.extraBonuses === "object" && !Array.isArray(person.extraBonuses)
    ? person.extraBonuses as Record<string, unknown>
    : {};
  const currentSede = typeof extraBonuses.__currentSede === "string"
    ? normalizeSede(extraBonuses.__currentSede)
    : "";
  return currentSede || departmentSede(person?.department) || null;
}

function normalizePersonName(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function matchesCurrentUserName(personName: string | null | undefined, userName: string | null | undefined) {
  const person = normalizePersonName(personName);
  const user = normalizePersonName(userName);
  if (!person || !user) return false;
  if (person === user || person.includes(user) || user.includes(person)) return true;
  if (person.includes("alessandra") && person.includes("caballero") && user.includes("valeria") && user.includes("caballero")) return true;
  const userTokens = user.split(" ").filter((token) => token.length >= 3);
  return userTokens.length > 1 && userTokens.every((token) => person.includes(token));
}

function isPaymentsTeamPerson(person?: { personId?: string | null; personName?: string | null; department?: string | null; payrollRole?: string | null } | null) {
  const words = normalizePersonName(person?.personName).split(" ");
  const department = normalizePersonName(person?.department);
  const payrollRole = normalizePersonName(person?.payrollRole);
  return ["franco", "junior", "laura", "andrea", "matias"].some((name) => words.includes(name)) ||
    department.includes("pagos") || payrollRole.includes("pagos");
}

function normalizeMonthKey(value?: string | null) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : null;
}

function buildAttendanceSummary(people: Awaited<ReturnType<typeof readAttendanceData>>["people"]) {
  const summary = {
    totalPeople: people.length,
    totalDays: 0,
    totalPunches: 0,
    completeDays: 0,
    lateEntries: 0,
    earlyLeaves: 0,
    missingEntries: 0,
    missingExits: 0,
  };

  for (const person of people) {
    for (const day of person.days) {
      summary.totalDays += 1;
      summary.totalPunches += (day.punches || []).length;
      if (day.entryTime && day.exitTime) summary.completeDays += 1;
      if ((day.lateMinutes || 0) > 0) summary.lateEntries += 1;
      if ((day.earlyLeaveMinutes || 0) > 0) summary.earlyLeaves += 1;
      if (!day.entryTime && !(day.calendarException && day.calendarException.kind !== "SPECIAL_SHIFT")) summary.missingEntries += 1;
      if (!day.exitTime && !(day.calendarException && day.calendarException.kind !== "SPECIAL_SHIFT")) summary.missingExits += 1;
    }
  }

  return summary;
}

function filterAttendanceMonth(
  attendance: Awaited<ReturnType<typeof readAttendanceData>>,
  month: string | null,
  personId: string | null,
) {
  const visiblePeople = attendance.people
    .filter((person) => !personId || person.personId === personId)
    .map((person) => ({
      ...person,
      days: (month ? person.days.filter((day) => String(day.date || "").startsWith(month)) : person.days)
        .map(day => day.calendarException ? {
          ...day,
          calendarException: { ...day.calendarException, personIds: day.calendarException.personIds.filter(id => id === person.personId) },
        } : day),
    }));

  return {
    ...attendance,
    people: visiblePeople,
    workCalendar: (attendance.workCalendar || [])
      .filter(rule => visiblePeople.some(person => person.days.some(day => day.calendarException?.id === rule.id)))
      .map(rule => ({ ...rule, personIds: rule.personIds.filter(id => visiblePeople.some(person => person.personId === id)) })),
    availableDates: month
      ? (attendance.availableDates || []).filter((date) => String(date || "").startsWith(month))
      : attendance.availableDates,
    summary: buildAttendanceSummary(visiblePeople),
  };
}

function filterAttendanceForUser(
  attendance: Awaited<ReturnType<typeof readAttendanceData>>,
  currentUser: Awaited<ReturnType<typeof requireCurrentUser>>,
) {
  if (isAdmin(currentUser)) return attendance;
  if (isPaymentsSupervisor(currentUser)) {
    const people = attendance.people.filter((person) => isPaymentsTeamPerson(person));
    return {
      ...attendance,
      people,
      profiles: (attendance.profiles || []).filter((profile) => isPaymentsTeamPerson(profile)),
      summary: buildAttendanceSummary(people),
    };
  }
  if (!isManager(currentUser)) {
    const people = attendance.people.filter((person) =>
      matchesCurrentUserName(person.personName, currentUser.name) &&
      personSede(person) === normalizeSede(currentUser.sede),
    );

    return {
      ...attendance,
      people,
      profiles: (attendance.profiles || []).filter((profile) =>
        matchesCurrentUserName(profile.personName, currentUser.name) &&
        personSede(profile) === normalizeSede(currentUser.sede),
      ),
      summary: buildAttendanceSummary(people),
    };
  }

  const sede = normalizeSede(currentUser.sede);
  const people = attendance.people.filter(
    (person) => personSede(person) === sede && !isPaymentsTeamPerson(person),
  );

  return {
    ...attendance,
    people,
    profiles: (attendance.profiles || []).filter(
      (profile) => personSede(profile) === sede && !isPaymentsTeamPerson(profile),
    ),
    summary: buildAttendanceSummary(people),
  };
}

async function withVisibleChangeRequests(
  attendance: Awaited<ReturnType<typeof readAttendanceData>>,
  currentUser: Awaited<ReturnType<typeof requireCurrentUser>>,
) {
  const requests = await readPendingAttendanceChangeRequests();
  const history = await readAttendanceChangeRequestHistory();
  const scopedRequests = isManager(currentUser)
    ? isPaymentsSupervisor(currentUser)
      ? requests.filter((request) => isPaymentsTeamPerson(request))
      : requests.filter((request) => departmentSede(request.department) === normalizeSede(currentUser.sede) && !isPaymentsTeamPerson(request))
    : requests;
  const scopedHistory = isManager(currentUser)
    ? isPaymentsSupervisor(currentUser)
      ? history.filter((request) => isPaymentsTeamPerson(request))
      : history.filter((request) => departmentSede(request.department) === normalizeSede(currentUser.sede) && !isPaymentsTeamPerson(request))
    : history;

  return {
    ...attendance,
    changeRequests: isAdmin(currentUser) || isManager(currentUser) ? scopedRequests : [],
    changeRequestHistory: isAdmin(currentUser) || isManager(currentUser) ? scopedHistory : [],
  };
}

export async function GET(request: Request) {
  const currentUser = await requireCurrentUser();
  const { searchParams } = new URL(request.url);
  const month = normalizeMonthKey(searchParams.get("month"));
  const personId = searchParams.get("personId")?.trim() || null;
  const includeInactive = searchParams.get("includeInactive") === "1" && isAdmin(currentUser);
  const revision = await withDbRetry(() => attendanceRevision(JSON.stringify([currentUser.id, currentUser.role, currentUser.sede, currentUser.name, month, personId, includeInactive])));
  if (searchParams.get("since") === revision) {
    return NextResponse.json({ unchanged: true, revision }, { headers: { "Cache-Control": "no-store" } });
  }

  const attendance = await withDbRetry(async () =>
    withVisibleChangeRequests(
      filterAttendanceMonth(filterAttendanceForUser(await readAttendanceData(includeInactive, month), currentUser), month, personId),
      currentUser,
    ),
  );

  return NextResponse.json({ ...attendance, revision }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}

export async function POST(request: Request) {
  const currentUser = await requireCurrentUser();

  if (!isAdmin(currentUser) && !isManager(currentUser)) {
    return NextResponse.json(
      { error: "Solo admin y jefes de sede pueden editar la asistencia." },
      { status: 403 },
    );
  }

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    if (!isAdmin(currentUser)) {
      return NextResponse.json(
        { error: "Solo el admin puede subir Excel de asistencia." },
        { status: 403 },
      );
    }
    if (await isMonthClosedForRole(currentMonthKey(), currentUser.role)) {
      return NextResponse.json(
        { error: "Este mes está cerrado. Reábrelo para subir asistencia." },
        { status: 403 },
      );
    }
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Debes adjuntar un archivo Excel." }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "Solo se aceptan archivos .xlsx" }, { status: 400 });
    }

    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      await importAttendanceWorkbook(file.name, bytes);
      await logChange({actorId:currentUser.id,module:"Asistencia",action:"IMPORTAR",summary:`Importó asistencia desde ${file.name}.`,targetType:"AttendanceStore",targetId:"1"});
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "No se pudo importar el Excel." },
        { status: 400 },
      );
    }

    const attendance = await withVisibleChangeRequests(await readAttendanceData(), currentUser);
    return NextResponse.json(attendance, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: string;
        personId?: string;
        date?: string;
        field?: string;
        value?: string;
        entryTime?: string | null;
        exitTime?: string | null;
        justifiedEntry?: boolean;
        justifiedExit?: boolean;
        justifiedDay?: boolean;
        absence?: boolean;
        confirmText?: string;
        payrollRole?: string;
        monthlySalary?: number;
        salaryEffectiveMonth?: string;
        penaltyPerMinute?: number;
        bonusAmount?: number;
        bonusDisabled?: boolean;
        bonusDisabledReason?: string | null;
        extraBonuses?: Record<string, unknown>;
        salaryPaidMonth?: string;
        commissionPaidMonth?: string;
        personIds?: string[];
        lastWorkingDate?: string;
        paid?: boolean;
        employmentType?: string;
        partTimeMode?: string | null;
        requestId?: number;
        requestIds?: number[];
        reason?: string;
        decisionReason?: string | null;
      }
    | null;

  try {
    if (body?.action === "delete-collaborator") {
      if (!isAdmin(currentUser)) {
        return NextResponse.json({ error: "Solo el admin puede eliminar colaboradores." }, { status: 403 });
      }
      if (!body.personId) {
        return NextResponse.json({ error: "Persona invalida." }, { status: 400 });
      }
      if ((body.confirmText || "").trim().toUpperCase() !== "INACTIVAR COLABORADOR") {
        return NextResponse.json(
          { error: "Debes escribir INACTIVAR COLABORADOR para confirmar." },
          { status: 400 },
        );
      }
      if (await isMonthClosedForRole(currentMonthKey(), currentUser.role)) {
        return NextResponse.json({ error: "Este mes esta cerrado. Reabrelo para eliminar colaboradores." }, { status: 403 });
      }
      await deleteAttendanceCollaborator(body.personId);
      await logChange({actorId:currentUser.id,module:"Colaboradores",action:"INACTIVAR",summary:`Inactivó colaborador ${body.personId}.`,targetType:"AttendanceProfile",targetId:body.personId});
    } else if (body?.action === "terminate-collaborator") {
      if (!isAdmin(currentUser)) return NextResponse.json({ error: "Solo el admin puede registrar renuncias." }, { status: 403 });
      if (!body.personId || !body.lastWorkingDate) return NextResponse.json({ error: "Indica el último día de trabajo." }, { status: 400 });
      await terminateAttendanceCollaborator({ personId: body.personId, lastWorkingDate: body.lastWorkingDate, reason: body.reason });
      await logChange({ actorId: currentUser.id, module: "Colaboradores", action: "CESE", summary: `Cese registrado desde ${body.lastWorkingDate}`, targetType: "attendanceProfile", targetId: body.personId });
    } else if (body?.action === "reactivate-collaborator") {
      if (!isAdmin(currentUser)) {
        return NextResponse.json({ error: "Solo el admin puede reactivar colaboradores." }, { status: 403 });
      }
      if (!body.personId) return NextResponse.json({ error: "Persona inválida." }, { status: 400 });
      const profile = await reactivateAttendanceCollaborator(body.personId);
      await logChange({ actorId: currentUser.id, module: "Colaboradores", action: "REACTIVAR", summary: `Reactivó a ${profile.personName}.`, targetType: "AttendanceProfile", targetId: profile.personId, sede: personSede({ department: profile.department, extraBonuses: profile.extraBonuses }), before: { inactive: true }, after: { inactive: false } });
    } else if (body?.action === "profile") {
      if (!isAdmin(currentUser) && !isManager(currentUser)) {
        return NextResponse.json({ error: "Solo administración y jefes de sede pueden editar colaboradores." }, { status: 403 });
      }
      if (!body.personId) {
        return NextResponse.json({ error: "Persona invalida." }, { status: 400 });
      }
      if (await isMonthClosedForRole(currentMonthKey(), currentUser.role)) {
        return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para cambiar sueldos." }, { status: 403 });
      }
      const attendance = await readAttendanceData();
      const person = attendance.people.find((item) => item.personId === body.personId);
      if (!person) {
        return NextResponse.json({ error: "No se encontró al colaborador." }, { status: 404 });
      }
      if (isManager(currentUser) && !filterAttendanceForUser(attendance, currentUser).people.some((item) => item.personId === person.personId)) {
        return NextResponse.json({ error: "Solo puedes editar colaboradores de tu sede." }, { status: 403 });
      }

      if (body.salaryEffectiveMonth && await isMonthClosedForRole(body.salaryEffectiveMonth, currentUser.role)) {
        return NextResponse.json({ error: "Reabre el mes antes de cambiar su sueldo histórico." }, { status: 403 });
      }

      await writeAttendanceProfile({
        personId: body.personId,
        payrollRole: body.payrollRole || "",
        monthlySalary: Number(body.monthlySalary ?? 0),
        salaryEffectiveMonth: body.salaryEffectiveMonth,
        actorId: currentUser.id,
        penaltyPerMinute: Number(body.penaltyPerMinute ?? 0),
        bonusAmount: Number(body.bonusAmount ?? 0),
        bonusDisabled: !!body.bonusDisabled,
        bonusDisabledReason: body.bonusDisabledReason,
        extraBonuses: body.extraBonuses || {},
        employmentType: body.employmentType,
        partTimeMode: body.partTimeMode ?? null,
      });
      await logChange({ actorId: currentUser.id, module: "Colaboradores", action: "PERFIL_SALARIAL", summary: `Actualizó el perfil salarial de ${person.personName}.`, targetType: "AttendanceProfile", targetId: person.personId, before: { monthlySalary: person.monthlySalary, payrollRole: person.payrollRole, salaryHistory: person.extraBonuses?.__salaryHistory }, after: { monthlySalary: body.monthlySalary, payrollRole: body.payrollRole, salaryEffectiveMonth: body.salaryEffectiveMonth || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).format(new Date()) } });
    } else if (body?.action === "bonus") {
      if (!isAdmin(currentUser)) {
        return NextResponse.json({ error: "Solo el admin puede editar el bono." }, { status: 403 });
      }
      if (!body.personId) {
        return NextResponse.json({ error: "Persona invalida." }, { status: 400 });
      }
      if (await isMonthClosedForRole(currentMonthKey(), currentUser.role)) {
        return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para editar bonos." }, { status: 403 });
      }
      await updateAttendanceBonus({
        personId: body.personId,
        bonusDisabled: !!body.bonusDisabled,
        bonusDisabledReason: body.bonusDisabledReason,
      });
      await logChange({actorId:currentUser.id,module:"Sueldos",action:"EDITAR",summary:`Cambió bono de ${body.personId}.`,targetType:"AttendanceProfile",targetId:body.personId,after:{bonusDisabled:body.bonusDisabled,reason:body.bonusDisabledReason}});
    } else if (body?.action === "mark-paid") {
      if (!isAdmin(currentUser)) {
        return NextResponse.json({ error: "Solo el admin puede marcar sueldos pagados." }, { status: 403 });
      }
      if (!body.personId || !body.salaryPaidMonth) {
        return NextResponse.json({ error: "Datos invalidos." }, { status: 400 });
      }
      if (await isMonthClosedForRole(body.salaryPaidMonth, currentUser.role)) {
        return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para cambiar pagos." }, { status: 403 });
      }
      await markAttendanceSalaryPaid({
        personId: body.personId,
        month: body.salaryPaidMonth,
        paid: !!body.paid,
      });
      await logChange({actorId:currentUser.id,module:"Sueldos",action:"CAMBIAR_PAGO",summary:`${body.paid?"Marcó pagado":"Retiró pago de"} sueldo de ${body.personId}, ${body.salaryPaidMonth}.`,targetType:"AttendanceProfile",targetId:body.personId,after:{month:body.salaryPaidMonth,paid:!!body.paid}});
    } else if (body?.action === "mark-all-salaries-paid") {
      if (!isAdmin(currentUser)) return NextResponse.json({ error: "Solo el admin puede marcar sueldos pagados." }, { status: 403 });
      if (!body.salaryPaidMonth || !Array.isArray(body.personIds)) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
      if (await isMonthClosedForRole(body.salaryPaidMonth, currentUser.role)) return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para cambiar pagos." }, { status: 403 });
      const result = await markAttendanceSalariesPaid({ personIds: body.personIds, month: body.salaryPaidMonth });
      await logChange({ actorId: currentUser.id, module: "Sueldos", action: "PAGO MASIVO", summary: `${result.count} sueldo(s) marcados como pagados para ${body.salaryPaidMonth}`, targetType: "attendanceProfile" });
    } else if (body?.action === "mark-all-commissions-paid") {
      if (!isAdmin(currentUser)) return NextResponse.json({ error: "Solo el admin puede marcar comisiones pagadas." }, { status: 403 });
      if (!body.commissionPaidMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.commissionPaidMonth) || !Array.isArray(body.personIds) || !body.personIds.length || body.personIds.some((id: unknown) => typeof id !== "string" || !id.trim())) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
      if (await isMonthClosedForRole(body.commissionPaidMonth, currentUser.role)) return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para cambiar pagos." }, { status: 403 });
      const result = await markAttendanceAllCommissionsPaid({ personIds: body.personIds, month: body.commissionPaidMonth });
      await logChange({ actorId: currentUser.id, module: "Sueldos", action: "PAGO MASIVO COMISIONES", summary: `${result.count} comisión(es) marcadas como pagadas para ${body.commissionPaidMonth}`, targetType: "attendanceProfile" });
    } else if (body?.action === "mark-commissions-paid") {
      if (!isAdmin(currentUser)) {
        return NextResponse.json({ error: "Solo el admin puede marcar comisiones pagadas." }, { status: 403 });
      }
      if (!body.personId || !body.commissionPaidMonth) {
        return NextResponse.json({ error: "Datos invalidos." }, { status: 400 });
      }
      if (await isMonthClosedForRole(body.commissionPaidMonth, currentUser.role)) {
        return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para cambiar pagos." }, { status: 403 });
      }
      await markAttendanceCommissionsPaid({
        personId: body.personId,
        month: body.commissionPaidMonth,
        paid: !!body.paid,
      });
      await logChange({actorId:currentUser.id,module:"Sueldos",action:"CAMBIAR_PAGO",summary:`${body.paid?"Marcó pagadas":"Retiró pago de"} comisiones de ${body.personId}, ${body.commissionPaidMonth}.`,targetType:"AttendanceProfile",targetId:body.personId,after:{month:body.commissionPaidMonth,paid:!!body.paid}});
    } else if (body?.action === "reset") {
      if (!isAdmin(currentUser)) {
        return NextResponse.json({ error: "Solo el admin puede borrar el mes." }, { status: 403 });
      }
      if ((body.confirmText || "").trim().toUpperCase() !== "BORRAR ASISTENCIA") {
        return NextResponse.json(
          { error: "Debes escribir BORRAR ASISTENCIA para confirmar." },
          { status: 400 },
        );
      }
      await clearAttendanceMonth();
      await logChange({actorId:currentUser.id,module:"Asistencia",action:"ELIMINAR",summary:"Restableció asistencia con confirmación BORRAR ASISTENCIA.",targetType:"AttendanceStore",targetId:"1"});
    } else if (body?.action === "approve-requests") {
      if (!isAdmin(currentUser)) {
        return NextResponse.json({ error: "Solo el admin puede aprobar solicitudes." }, { status: 403 });
      }
      await approvePendingAttendanceChangeRequests(body.requestIds || [], currentUser.id);
    } else if (body?.action === "delete-requests") {
      if (!isAdmin(currentUser)) {
        return NextResponse.json({ error: "Solo el admin puede eliminar solicitudes." }, { status: 403 });
      }
      const result = await deletePendingAttendanceChangeRequests(body.requestIds || []);
      if (!result.count) {
        return NextResponse.json({ error: "Las solicitudes seleccionadas ya no estan pendientes." }, { status: 400 });
      }
      await logChange({actorId:currentUser.id,module:"Asistencia",action:"ELIMINAR_SOLICITUDES",summary:`Eliminó ${result.count} solicitudes pendientes.`,targetType:"AttendanceChangeRequest",after:{ids:body.requestIds}});
    } else if (body?.action === "approve-request" || body?.action === "reject-request") {
      if (!isAdmin(currentUser)) {
        return NextResponse.json({ error: "Solo el admin puede revisar solicitudes." }, { status: 403 });
      }
      if (!body.requestId) {
        return NextResponse.json({ error: "Solicitud invalida." }, { status: 400 });
      }
      await decideAttendanceChangeRequest({
        requestId: Number(body.requestId),
        action: body.action === "approve-request" ? "approve" : "reject",
        decidedById: currentUser.id,
        decisionReason: body.decisionReason,
      });
    } else if (body?.action === "request-change") {
      if (!isManager(currentUser)) {
        return NextResponse.json({ error: "Solo los jefes de sede deben solicitar cambios." }, { status: 403 });
      }
      if (!body.personId || !body.date) {
        return NextResponse.json({ error: "Datos invalidos." }, { status: 400 });
      }
      if (await isMonthClosedForRole(monthFromDate(body.date), currentUser.role)) {
        return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para solicitar cambios." }, { status: 403 });
      }
      const scoped = filterAttendanceForUser(await readAttendanceData(), currentUser);
      const person = scoped.people.find((item) => item.personId === body.personId);
      const day = person?.days.find((item) => item.date === body.date);
      if (!person || !day) {
        return NextResponse.json({ error: "No puedes solicitar cambios fuera de tu sede." }, { status: 403 });
      }
      await createAttendanceChangeRequest({
        absence: body.absence,
        personId: body.personId,
        personName: person.personName,
        department: person.department,
        date: body.date,
        currentEntry: day.entryTime,
        currentExit: day.exitTime,
        requestedEntry: body.entryTime,
        requestedExit: body.exitTime,
        justifiedEntry: body.justifiedEntry,
        justifiedExit: body.justifiedExit,
        justifiedDay: body.justifiedDay,
        reason: body.reason || "",
        requestedById: currentUser.id,
      });
      await logChange({actorId:currentUser.id,module:"Asistencia",action:"SOLICITAR_CAMBIO",summary:`Solicitó cambio de ${person.personName}, ${body.date}${body.absence?" (falta)":""}.`,targetType:"AttendanceDay",targetId:`${body.personId}__${body.date}`,sede:personSede(person),before:{entry:day.entryTime,exit:day.exitTime,absence:day.absence},after:{entry:body.entryTime,exit:body.exitTime,justifiedDay:body.justifiedDay,absence:body.absence,reason:body.reason}});
    } else {
      if (!body?.personId || !body?.date) {
        return NextResponse.json({ error: "Datos invalidos." }, { status: 400 });
      }
      if (await isMonthClosedForRole(monthFromDate(body.date), currentUser.role)) {
        return NextResponse.json({ error: "Este mes está cerrado. Reábrelo para editar asistencia." }, { status: 403 });
      }

      if (isManager(currentUser)) {
        const scoped = filterAttendanceForUser(await readAttendanceData(), currentUser);
        const allowed = scoped.people.some((person) => person.personId === body.personId);
        if (!allowed) {
          return NextResponse.json({ error: "No puedes editar asistencias fuera de tu sede." }, { status: 403 });
        }
      }

      if (!isAdmin(currentUser)) {
        return NextResponse.json({ error: "Los jefes de sede deben enviar una solicitud de cambio." }, { status: 403 });
      }

      const beforeData=await readAttendanceData(false,body.date.slice(0,7));
      const beforePerson=beforeData.people.find(person=>person.personId===body.personId);
      const beforeDay=beforePerson?.days.find(day=>day.date===body.date);
      await writeAttendanceOverride({
        absence: body.absence,
        personId: body.personId,
        date: body.date,
        entryTime: body.field === "entryTime" ? body.value ?? null : body.entryTime,
        exitTime: body.field === "exitTime" ? body.value ?? null : body.exitTime,
        justifiedEntry: body.justifiedEntry,
        justifiedExit: body.justifiedExit,
        justifiedDay: body.justifiedDay,
      });
      await logChange({ actorId: currentUser.id, module: "Asistencia", action: typeof body.absence==="boolean"?(body.absence?"FALTA":"QUITAR_FALTA"):"EDITAR", summary: `Ajustó asistencia de ${beforePerson?.personName || body.personId}, ${body.date}${body.absence?" (falta)":""}.`, targetType: "AttendanceDay", targetId: `${body.personId}__${body.date}`,sede:personSede(beforePerson),before:beforeDay,after:{date:body.date,entry:body.field==="entryTime"?body.value:body.entryTime,exit:body.field==="exitTime"?body.value:body.exitTime,absence:body.absence,justifiedEntry:body.justifiedEntry,justifiedExit:body.justifiedExit,justifiedDay:body.justifiedDay} });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar el ajuste." },
      { status: 400 },
    );
  }

  const attendance = await withVisibleChangeRequests(
    filterAttendanceForUser(await readAttendanceData(), currentUser),
    currentUser,
  );
  return NextResponse.json(attendance, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
