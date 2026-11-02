import { NextRequest, NextResponse } from "next/server";

const maintenanceHtml = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Registros ATK · Mantenimiento</title><style>body{margin:0;background:#0a0d14;color:#e8ecf4;font:15px system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}.card{max-width:480px;margin:24px;padding:36px;background:#141e30;border:1px solid #29364c;border-radius:16px}.brand{font-size:27px;font-weight:800;letter-spacing:-2px}.brand span{color:#ffca37}h1{font-size:22px;margin:26px 0 12px}p{color:#9caec8;line-height:1.6}.code{font-size:12px;color:#6984aa;margin-top:24px}</style></head><body><main class="card"><div class="brand"><span>A</span>TK</div><h1>Sistema temporalmente no disponible</h1><p>Estamos actualizando Registros ATK. El acceso volverá a estar disponible cuando terminemos las pruebas.</p><div class="code">503 · Mantenimiento programado</div></main></body></html>`;

export function proxy(request: NextRequest) {
  const legacyHost = ["registros-atk.vercel.app", "registros.atkportal.app"].includes(request.nextUrl.hostname);
  const pathForRedirect = request.nextUrl.pathname;
  // Redirect page visits only. Existing integrations keep their original endpoints.
  if (legacyHost && (request.method === "GET" || request.method === "HEAD") &&
      !pathForRedirect.startsWith("/api/") && pathForRedirect !== "/api" &&
      !pathForRedirect.startsWith("/_next/") &&
      (!/\.[^/]+$/.test(pathForRedirect) || pathForRedirect.endsWith(".html"))) {
    const destination = new URL(request.url);
    destination.protocol = "https:";
    destination.hostname = "atkportal.app";
    destination.port = "";
    return NextResponse.redirect(destination, 307);
  }
  if (process.env.REGISTROS_MAINTENANCE !== "1") return NextResponse.next();
  const path = request.nextUrl.pathname;
  // Keep signed attendance callbacks and authenticated integrations operational.
  if (path === "/api/attendance/zlink/webhook" || path.startsWith("/api/external/")) return NextResponse.next();
  // Turnos ATK verifies its existing users through this credential-protected API.
  // Interactive state, pages, and record writes remain blocked below.
  if (path === "/api/auth/login" && request.method === "POST") return NextResponse.next();
  const headers = { "Cache-Control": "no-store, private", "Retry-After": "3600", "X-Robots-Tag": "noindex, nofollow" };
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Sistema temporalmente no disponible por mantenimiento.", maintenance: true }, { status: 503, headers });
  return new NextResponse(maintenanceHtml, { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

export const config = { matcher: "/:path*" };
