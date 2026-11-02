import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/current-user";

export async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "No autorizado." }, { status: 401 }),
      user: null,
    };
  }

  return { error: null, user };
}
