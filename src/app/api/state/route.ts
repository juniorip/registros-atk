import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { withDbRetry } from "@/lib/db-retry";
import { buildStateResponse, initialStateModules, STATE_MODULE_KEYS, type StateModuleKey } from "@/lib/state-response";
import { isAdmin } from "@/lib/domain";
import { stateRevision } from "@/lib/state-revision";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  const currentUser = auth.user;
  const { searchParams } = new URL(request.url);
  const modules = searchParams
    .getAll("module")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value): value is StateModuleKey => (STATE_MODULE_KEYS as readonly string[]).includes(value));
  const month = searchParams.get("month")?.trim() || null;
  const requestedModules = searchParams.get("bootstrap") === "1" ? initialStateModules(isAdmin(currentUser)) : modules.length ? [...new Set(modules)].sort() : null;
  let payload;
  let revision;
  try {
    revision = await withDbRetry(() => stateRevision(
      [currentUser.id, currentUser.role, currentUser.sede, currentUser.name, currentUser.username, month, requestedModules],
      requestedModules,
    ));
    if (searchParams.get("since") === revision) {
      return NextResponse.json({ unchanged: true, revision }, { headers: { "Cache-Control": "no-store, private" } });
    }
    payload = await withDbRetry(() => buildStateResponse(currentUser, {
      modules: requestedModules,
      month,
    }));
  } catch (error) {
    console.error("No se pudo cargar el estado del sistema", error);
    return NextResponse.json({ error: "No se pudo cargar la información. Actualiza la página en unos segundos." }, { status: 503 });
  }

  return NextResponse.json(
    { ...payload, revision },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
  );
}
