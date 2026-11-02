import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { requireApiUser } from "@/lib/api-auth";
import { canManageSafetypayPayments, isAdmin, isManager, isPaymentsSupervisor, isPaymentsTeamMember, normalizeSede, resolveHistoricalSede } from "@/lib/domain";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const REPORT_COLUMNS = [
  "Fecha", "Id. de operación", "Orden de pago", "País de origen del tx", "Divisa", "Importe",
  "País de pago", "Moneda de pago", "Importe del pago", "Estado", "Tiempo de caducidad",
  "Canal de pago", "Id. de ventas de comercios", "Correo electrónico del cliente", "Creado por",
] as const;

function formatDateTime(value: Date) {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function formatPaymentStatus(value: string) {
  return value === "PAID" ? "Pagado" : "Pendiente";
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user) && !isManager(auth.user) && !canManageSafetypayPayments(auth.user)) {
    return NextResponse.json({ error: "No tienes permiso para descargar Safetypay." }, { status: 403 });
  }

  const url = new URL(request.url);
  const requestedMonth = (url.searchParams.get("month") || "").trim();
  const month = /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : new Date().toISOString().slice(0, 7);
  const requestedSede = normalizeSede(url.searchParams.get("sede") || "");
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, monthNumber - 1, 1));
  const nextMonthStart = new Date(Date.UTC(year, monthNumber, 1));

  const entries = await prisma.safetypayCodeEntry.findMany({
    where: {
      createdAt: {
        gte: monthStart,
        lt: nextMonthStart,
      },
    },
    include: { user: { select: { id: true, name: true, username: true, role: true, sede: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const visible = entries.filter((entry) => {
    const entrySede = resolveHistoricalSede(entry.historicalSede, entry.user.sede);
    const isAdminEntry = String(entry.user.role) === "ADMIN";
    if (isAdmin(auth.user) || canManageSafetypayPayments(auth.user)) return !requestedSede || (!isAdminEntry && entrySede === requestedSede);
    if (isPaymentsSupervisor(auth.user)) return isPaymentsTeamMember(entry.user);
    return !isAdminEntry && !isPaymentsTeamMember(entry.user) && entrySede === normalizeSede(auth.user.sede);
  });

  const rows = visible.map((entry) => ({
    "Fecha": formatDateTime(entry.createdAt),
    "Id. de operación": entry.customerCode,
    "Orden de pago": entry.operationNumber,
    "País de origen del tx": "Peru",
    "Divisa": "PEN",
    "Importe": Number(entry.amount),
    "País de pago": "Peru",
    "Moneda de pago": "PEN",
    "Importe del pago": Number(entry.amount),
    "Estado": formatPaymentStatus(entry.paymentStatus),
    "Tiempo de caducidad": "",
    "Canal de pago": "En línea",
    "Id. de ventas de comercios": entry.customerCode,
    "Correo electrónico del cliente": "",
    "Creado por": entry.user.username || entry.user.name,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: [...REPORT_COLUMNS] });
  worksheet["!autofilter"] = { ref: `A1:O${Math.max(rows.length + 1, 1)}` };
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  worksheet["!cols"] = [
    { wch: 21 }, { wch: 20 }, { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 14 }, { wch: 18 },
    { wch: 18 }, { wch: 17 }, { wch: 14 }, { wch: 23 }, { wch: 16 }, { wch: 26 }, { wch: 32 }, { wch: 24 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Direct Payment Request");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="QueryPaymentReport-${month}.xlsx"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
