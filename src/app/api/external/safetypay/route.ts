import { SafetypayBank, SafetypayCode } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizeSede } from "@/lib/domain";
import { currentMonthKey, isMonthClosed, monthFromDate } from "@/lib/monthly-closure";
import { prisma } from "@/lib/prisma";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

const externalSafetypaySchema = z.object({
  username: z.string().min(1).optional(),
  userId: z.number().int().positive().optional(),
  clientDni: z.string().min(6),
  cardLast4: z.string().regex(/^\d{4}$/),
  customerCode: z.string().regex(/^\d{6}$/),
  bank: z.preprocess((value) => String(value || "").trim().toUpperCase(), z.enum(["CMR", "IBK", "IO"])),
  code: z.preprocess((value) => String(value || "").trim().toUpperCase(), z.enum(["ATK1"])),
  amount: z.coerce.number().positive(),
  operationNumber: z.string().min(3),
  createdAt: z.string().datetime().optional(),
});

const externalSafetypayQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  code: z.preprocess((value) => (value == null || value === "" ? undefined : String(value).trim().toUpperCase()), z.enum(["ATK1"]).optional()),
  bank: z.preprocess((value) => (value == null || value === "" ? undefined : String(value).trim().toUpperCase()), z.enum(["CMR", "IBK", "IO"]).optional()),
  username: z.string().min(1).optional(),
  userId: z.coerce.number().int().positive().optional(),
  operationNumber: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || request.headers.get("x-api-key")?.trim() || "";
}

function expectedApiToken() {
  return process.env.SAFETYPAY_API_TOKEN?.trim() || "";
}

function authError(request: Request) {
  const expectedToken = expectedApiToken();
  if (!expectedToken) {
    return json(
      { error: "Falta configurar SAFETYPAY_API_TOKEN en el servidor." },
      { status: 500 },
    );
  }
  if (bearerToken(request) !== expectedToken) {
    return json({ error: "Token invalido." }, { status: 401 });
  }
  return null;
}

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfDay(value: string) {
  return new Date(`${value}T23:59:59.999Z`);
}

function startOfMonth(value: string) {
  return new Date(`${value}-01T00:00:00.000Z`);
}

function endOfMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders,
      ...(init?.headers || {}),
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const authResponse = authError(request);
  if (authResponse) return authResponse;

  const { searchParams } = new URL(request.url);
  const parsed = externalSafetypayQuerySchema.safeParse({
    date: searchParams.get("date") || undefined,
    month: searchParams.get("month") || undefined,
    code: searchParams.get("code") || undefined,
    bank: searchParams.get("bank") || undefined,
    username: searchParams.get("username") || undefined,
    userId: searchParams.get("userId") || undefined,
    operationNumber: searchParams.get("operationNumber") || undefined,
    limit: searchParams.get("limit") || 100,
  });

  if (!parsed.success) {
    return json({ error: "Parametros invalidos.", details: parsed.error.flatten() }, { status: 400 });
  }

  const query = parsed.data;
  const where: {
    createdAt?: { gte: Date; lte: Date };
    code?: SafetypayCode;
    bank?: SafetypayBank;
    operationNumber?: { contains: string; mode: "insensitive" };
    customerCode?: string;
    userId?: number;
    user?: { username?: string };
  } = {};

  if (query.date) {
    where.createdAt = {
      gte: startOfDay(query.date),
      lte: endOfDay(query.date),
    };
  } else if (query.month) {
    where.createdAt = {
      gte: startOfMonth(query.month),
      lte: endOfMonth(query.month),
    };
  }

  if (query.code) where.code = query.code as SafetypayCode;
  if (query.bank) where.bank = query.bank as SafetypayBank;
  if (query.userId) where.userId = query.userId;
  if (query.username) where.user = { username: query.username };
  if (query.operationNumber) {
    where.operationNumber = { contains: query.operationNumber.trim(), mode: "insensitive" };
  }

  const entries = await prisma.safetypayCodeEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: query.limit || 100,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          sede: true,
        },
      },
    },
  });

  return json({
    ok: true,
    filters: {
      date: query.date || null,
      month: query.month || null,
      code: query.code || null,
      bank: query.bank || null,
      username: query.username || null,
      userId: query.userId || null,
      operationNumber: query.operationNumber || null,
      limit: query.limit || 100,
    },
    count: entries.length,
    entries,
  });
}

export async function POST(request: Request) {
  const authResponse = authError(request);
  if (authResponse) return authResponse;

  const body = await request.json();
  const parsed = externalSafetypaySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Datos invalidos.", details: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  if (!data.username && !data.userId) {
    return json({ error: "Envia username o userId del colaborador." }, { status: 400 });
  }

  const entryDate = data.createdAt ? new Date(data.createdAt) : new Date();
  const entryMonth = monthFromDate(entryDate) || currentMonthKey();

  if (await isMonthClosed(entryMonth)) {
    return json({ error: "Este mes esta cerrado. Reabrelo para agregar codigos." }, { status: 403 });
  }

  const user = await prisma.user.findFirst({
    where: data.userId ? { id: data.userId } : { username: data.username },
    select: { id: true, name: true, username: true, role: true, sede: true },
  });

  if (!user) {
    return json({ error: "No se encontro el colaborador." }, { status: 404 });
  }

  const operationNumber = data.operationNumber.trim();
  const existing = await prisma.safetypayCodeEntry.findFirst({
    where: { operationNumber },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          sede: true,
          forcePasswordReset: true,
          color: true,
        },
      },
    },
  });

  if (existing) {
    return json({ ok: true, duplicate: true, entry: existing });
  }

  const entry = await prisma.safetypayCodeEntry.create({
    data: {
      userId: user.id,
      historicalSede: normalizeSede(user.sede),
      clientDni: data.clientDni.trim(),
      cardLast4: data.cardLast4.trim(),
      customerCode: data.customerCode.trim(),
      bank: data.bank as SafetypayBank,
      code: data.code as SafetypayCode,
      amount: data.amount,
      operationNumber,
      createdAt: entryDate,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          sede: true,
          forcePasswordReset: true,
          color: true,
        },
      },
    },
  });

  return json({ ok: true, duplicate: false, entry });
}
