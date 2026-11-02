import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const LEGACY_SESSION_COOKIE = "registros_session";
const BROWSER_COOKIE = "registros_browser_binding";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function getSecret() {
  return new TextEncoder().encode(process.env.SESSION_SECRET || "dev-session-secret-change-me");
}
function browserHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createSession(userId: number) {
  const store = await cookies();
  const existing = store.get(BROWSER_COOKIE)?.value;
  const browserBinding = existing && /^[a-f0-9]{64}$/.test(existing) ? existing : randomBytes(32).toString("hex");
  // This HttpOnly cookie cannot authenticate on its own. The signed token lives
  // only in the current tab and must be presented alongside this browser binding.
  store.set(BROWSER_COOKIE, browserBinding, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: SESSION_SECONDS,
  });
  await clearSession();
  return new SignJWT({ userId, browserHash: browserHash(browserBinding), tabSession: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime("7d").sign(getSecret());
}

export async function clearSession() {
  const store = await cookies();
  // Remove the former persistent login without invalidating other signed-in tabs.
  store.set(LEGACY_SESSION_COOKIE, "", {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 0, expires: new Date(0),
  });
}

export async function getSession() {
  const requestHeaders = await headers();
  const authorization = requestHeaders.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const store = await cookies();
  const browserBinding = store.get(BROWSER_COOKIE)?.value;
  const reject = (reason: string) => {
    if (token || browserBinding || store.get(LEGACY_SESSION_COOKIE)?.value) {
      console.warn("Registros tab session rejected", {
        reason,
        client: requestHeaders.get("x-registros-client") === "tab-login-v1" ? "tab-login-v1" : "older-or-unknown",
        browser: /Firefox\//.test(requestHeaders.get("user-agent") || "") ? "Firefox" : "Other",
      });
    }
    return null;
  };
  if (!token) return reject("missing-tab-token");
  if (!browserBinding) return reject("missing-browser-binding");
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (payload.tabSession !== true) return reject("older-session-token");
    if (payload.browserHash !== browserHash(browserBinding)) return reject("browser-binding-changed");
    return Number.isInteger(payload.userId) && Number(payload.userId) > 0 ? { userId: Number(payload.userId) } : null;
  } catch {
    return reject("invalid-or-expired-token");
  }
}
