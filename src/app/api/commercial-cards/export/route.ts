import { NextResponse } from "next/server";

function retired() {
  return NextResponse.json({ error: "Este modulo ya no esta disponible en esta web." }, { status: 410 });
}

export const GET = retired;
export const POST = retired;
export const PATCH = retired;
export const PUT = retired;
export const DELETE = retired;
