(function(){var exports={};"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarSede = calendarSede;
exports.resolveWorkCalendar = resolveWorkCalendar;
exports.calendarRulesConflict = calendarRulesConflict;
exports.calendarRestPayment = calendarRestPayment;
function calendarSede(person, date) {
    const extra = person.extraBonuses || {};
    const department = String(person.department || "").toLowerCase();
    let sede = String(extra.__baseSede || extra.__currentSede ||
        (department.includes("norte") ? "Norte" : department.includes("sur") ? "Sur" : department.includes("miraf") ? "Miraflores" : department.includes("lince") || department.includes("centro") ? "Lince" : ""));
    const transfers = Array.isArray(extra.__sedeTransfers) ? extra.__sedeTransfers : [];
    for (const row of [...transfers].sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)))) {
        if (row.effectiveDate <= date && row.to)
            sede = row.to;
    }
    return sede;
}
function resolveWorkCalendar(rules, person, date, sede = calendarSede(person, date)) {
    const extra = person.extraBonuses || {};
    if (extra.__hireDate && date < String(extra.__hireDate).slice(0, 10))
        return null;
    if (extra.__terminationDate && date > String(extra.__terminationDate).slice(0, 10))
        return null;
    const priority = { ALL: 0, SEDE: 1, PEOPLE: 2 };
    return rules.filter(rule => rule.date === date &&
        (rule.scope === "ALL" || (rule.scope === "SEDE" && rule.sede === sede) ||
            (rule.scope === "PEOPLE" && rule.personIds.includes(String(person.personId)))))
        .sort((a, b) => priority[b.scope] - priority[a.scope] || a.id.localeCompare(b.id))[0] || null;
}
function calendarRulesConflict(a, b) {
    if (a.id === b.id || a.date !== b.date || a.scope !== b.scope)
        return false;
    return a.scope === "ALL" || (a.scope === "SEDE" ? a.sede === b.sede : a.personIds.some(id => b.personIds.includes(id)));
}
function calendarRestPayment(rule, dailyRate, hourlyRate, entry, exit, breakMinutes) {
    const regularPay = rule.kind === "PAID_REST" ? dailyRate : 0;
    const elapsed = entry !== null && exit !== null ? Math.max(0, exit - entry) : 0;
    const workedHours = Math.max(0, elapsed - (elapsed > 360 ? breakMinutes : 0)) / 60;
    const calendarAdditionalPay = workedHours * hourlyRate * rule.additionalPercent / 100;
    return { dailyPay: regularPay + calendarAdditionalPay, regularPay, overtimePay: calendarAdditionalPay,
        calendarAdditionalPay, latePenalty: 0, earlyLeavePenalty: 0, bonusPoints: rule.kind === "PAID_REST" ? 1 : 0,
        workedHours, regularHours: 0, overtimeHours: workedHours };
}
;window.WorkCalendar=exports;})();