const BASE_URL = "https://zlink-open.minervaiot.com/open-apis";

export type ZlinkPunch = {
  id: string | number;
  punchTime: string;
  timezone: string;
  employeeCode: string;
  firstName: string;
  departmentName: string;
  source: number;
  status: string;
};

async function request(path: string, body: unknown, token?: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", "Accept-Language": "en-US", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.code !== "ZCOP0000") {
    // Never expose upstream request bodies, credentials or tokens in errors.
    const stage = path.includes("authen") ? "autenticacion" : "marcajes";
    throw new Error(`Zlink no pudo completar ${stage} (${response.status}, ${String(payload?.code || "SIN_RESPUESTA").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}, metodos admitidos: ${response.headers.get("allow") || "no indicados"}). Revisa la activacion y los permisos de la aplicacion.`);
  }
  return payload.data;
}

export function zlinkLimaPunch(punch: Pick<ZlinkPunch, "punchTime" | "timezone">) {
  const time = String(punch.punchTime || "").trim();
  const zone = String(punch.timezone || "").trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time) || !/^[+-]\d{2}:\d{2}$/.test(zone)) {
    throw new Error("Zlink devolvio una fecha o zona horaria invalida; no se importaron los marcajes.");
  }
  const instant = new Date(`${time.replace(" ", "T")}${zone}`);
  if (!Number.isFinite(instant.getTime())) throw new Error("Fecha de marcaje invalida.");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

export async function readZlinkPunches(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mes invalido.");
  const appKey = process.env.ZLINK_APP_KEY;
  const appSecret = process.env.ZLINK_APP_SECRET;
  if (!appKey || !appSecret) throw new Error("Falta configurar ZLINK_APP_KEY o ZLINK_APP_SECRET en Vercel.");
  const auth = await request("/authen/v1/tenantToken/internal", { appKey, appSecret });
  if (typeof auth?.tenantToken !== "string") throw new Error("Zlink no entrego un token valido.");
  const [year, number] = month.split("-").map(Number);
  const endDate = `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
  const rows: ZlinkPunch[] = [];
  const ids = new Set<string>();
  for (let pageNumber = 1; pageNumber <= 200; pageNumber++) {
    const data = await request("/att/v1/admin/transactions/search", {
      pageNumber, pageSize: 100, startDate: `${month}-01`, endDate, deviceSn: "", employeeIds: [], departmentIds: [],
    }, auth.tenantToken);
    if (!Array.isArray(data?.data)) throw new Error("Zlink devolvio un formato de marcajes desconocido.");
    for (const row of data.data as ZlinkPunch[]) {
      const key = String(row.id);
      if (!ids.has(key)) { ids.add(key); rows.push(row); }
    }
    const totalPages = Number(data.totalPages);
    if (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > 200) throw new Error("Cantidad de paginas Zlink invalida o demasiado grande.");
    if (pageNumber >= totalPages) return rows;
  }
  throw new Error("La consulta de Zlink excedio el limite; no se importaron datos parciales.");
}

export type ZlinkEvent = {
  id: string;
  eventTime: string;
  deviceSn: string;
  deviceName: string;
  eventValues: Array<{ name: string; value: string }>;
};

export async function readZlinkEvents(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mes invalido.");
  const appKey = process.env.ZLINK_APP_KEY;
  const appSecret = process.env.ZLINK_APP_SECRET;
  if (!appKey || !appSecret) throw new Error("Faltan las claves de Zlink.");
  const auth = await request("/authen/v1/tenantToken/internal", { appKey, appSecret });
  if (typeof auth?.tenantToken !== "string") throw new Error("Zlink no entrego un token valido.");
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const rows: ZlinkEvent[] = [];
  const ids = new Set<string>();
  for (let pageNumber = 1; pageNumber <= 200; pageNumber++) {
    const data = await request("/att/v1/events/search", {
      pageNumber, pageSize: 100, startDateTime: `${month}-01 00:00:00`, endDateTime: `${month}-${last} 23:59:59`, deviceName: "", operator: "",
    }, auth.tenantToken);
    if (!Array.isArray(data?.events)) throw new Error("Formato de eventos Zlink desconocido.");
    for (const row of data.events as ZlinkEvent[]) {
      if (!row.id || !row.eventTime || !Array.isArray(row.eventValues)) throw new Error("Evento de Zlink incompleto.");
      if (!ids.has(row.id)) { ids.add(row.id); rows.push(row); }
    }
    const totalPages = Number(data.totalPages);
    if (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > 200) throw new Error("Cantidad de paginas Zlink invalida.");
    if (pageNumber >= totalPages) return rows;
  }
  throw new Error("La consulta de eventos excedio el limite.");
}
