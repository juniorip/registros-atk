import * as XLSX from "xlsx";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { canManageSafetypayPayments, isAdmin, resolveHistoricalSede } from "@/lib/domain";
import { currentMonthKey } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function normalizeHeader(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeDigits(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return String(value || "").replace(/\D/g, "");
}

function moneyValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/,/g, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value: unknown) {
  return Math.round(moneyValue(value) * 100);
}

function monthRange(month: string) {
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : currentMonthKey();
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  return {
    month: safeMonth,
    start: new Date(Date.UTC(year, monthNumber - 1, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, monthNumber, 0, 23, 59, 59, 999)),
  };
}

function findHeaderRow(rows: unknown[][]) {
  return rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return (
      (headers.includes("id. de operacion") || headers.includes("id de operacion") || headers.includes("orden de pago"))
      && (headers.includes("importe de la venta") || headers.includes("monto de la venta") || headers.includes("importe"))
    );
  });
}

function headerIndex(headers: string[], candidates: string[]) {
  return candidates.map((candidate) => headers.indexOf(candidate)).find((index) => Number(index) >= 0) ?? -1;
}

function excelRowMatchesCustomerCode(row: { operationId?: string; transactionId?: string }, customerCode: string) {
  if (!customerCode) return false;
  const values = [row.operationId, row.transactionId].filter(Boolean);
  return values.some((value) => value === customerCode || value?.includes(customerCode));
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  if (!isAdmin(auth.user) && !canManageSafetypayPayments(auth.user)) {
    return NextResponse.json({ error: "Solo el admin puede auditar Safetypay." }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const monthInput = String(form.get("month") || currentMonthKey());

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Debes subir el Excel mensual de Safetypay." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) {
    return NextResponse.json({ error: "El Excel no tiene hojas para auditar." }, { status: 400 });
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex < 0) {
    return NextResponse.json(
      { error: "No encontre las columnas Id. de operacion e Importe de la venta en el Excel." },
      { status: 400 },
    );
  }

  const headers = rows[headerRowIndex].map(normalizeHeader);
  const operationIndex = headerIndex(headers, ["id. de operacion", "id de operacion", "orden de pago"]);
  const transactionIndex = headerIndex(headers, ["id. de transaccion", "id de transaccion"]);
  // SafetyPay exports two official layouts: the payment report uses
  // "Importe de la venta" while the financial report uses "Monto de la Venta".
  const amountIndex = headerIndex(headers, ["importe de la venta", "monto de la venta", "importe"]);
  const statusIndex = headers.indexOf("estado");

  const excelRows = rows
    .slice(headerRowIndex + 1)
    .map((row, index) => ({
      rowNumber: headerRowIndex + index + 2,
      operationId: normalizeDigits(row[operationIndex]),
      transactionId: transactionIndex >= 0 ? normalizeDigits(row[transactionIndex]) : "",
      amount: moneyValue(row[amountIndex]),
      amountCents: cents(row[amountIndex]),
      status: statusIndex >= 0 ? String(row[statusIndex] || "") : "",
    }))
    .filter((row) => row.operationId || row.transactionId);

  const { month, start, end } = monthRange(monthInput);
  const entries = await prisma.safetypayCodeEntry.findMany({
    where: {
      createdAt: { gte: start, lte: end },
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: {
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

  const usedExcelRows = new Set<number>();
  const details = entries.map((entry) => {
    const customerCode = normalizeDigits(entry.customerCode);
    const matches = customerCode
      ? excelRows.filter((row) => excelRowMatchesCustomerCode(row, customerCode))
      : [];
    const amountMatch = matches.find((row) => row.amountCents === cents(entry.amount));
    if (amountMatch) usedExcelRows.add(amountMatch.rowNumber);

    const observedReasons: string[] = [];
    if (!customerCode) observedReasons.push("Falta codigo de 6 digitos");
    if (customerCode && !matches.length) observedReasons.push("Codigo no aparece en Id. de operacion ni Id. de transaccion");
    if (matches.length && !amountMatch) observedReasons.push("Importe de la venta no coincide");

    return {
      id: entry.id,
      status: amountMatch ? "VALID" : "OBSERVED",
      reason: amountMatch ? "Codigo, ID del Excel e importe coinciden" : observedReasons.join(" / "),
      customerCode,
      operationNumber: entry.operationNumber,
      amount: Number(entry.amount || 0),
      excelAmount: amountMatch?.amount ?? matches[0]?.amount ?? null,
      excelRow: amountMatch?.rowNumber ?? matches[0]?.rowNumber ?? null,
      excelOperationId: amountMatch?.operationId ?? matches[0]?.operationId ?? null,
      excelTransactionId: amountMatch?.transactionId ?? matches[0]?.transactionId ?? null,
      clientDni: entry.clientDni,
      bank: entry.bank,
      createdAt: entry.createdAt,
      sede: resolveHistoricalSede(entry.historicalSede, entry.user.sede),
      user: entry.user,
    };
  });

  const excelOnly = excelRows
    .filter((row) => !details.some((detail) => excelRowMatchesCustomerCode(row, detail.customerCode)))
    .map((row) => ({
      rowNumber: row.rowNumber,
      operationId: row.operationId,
      transactionId: row.transactionId,
      orderCode: row.operationId,
      amount: row.amount,
      status: row.status,
    }));

  const valid = details.filter((detail) => detail.status === "VALID").length;
  const observed = details.length - valid;

  return NextResponse.json({
    ok: true,
    fileName: file.name,
    sheetName,
    month,
    summary: {
      systemRows: details.length,
      excelRows: excelRows.length,
      valid,
      observed,
      excelOnly: excelOnly.length,
    },
    details,
    excelOnly,
  });
}
