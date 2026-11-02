import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { zlinkLimaPunch } from "@/lib/zlink";

export function verifyZlinkSignature(params: URLSearchParams, token: string, now = Date.now()) {
  const timestamp = params.get("timestamp") || "";
  const nonce = params.get("nonce") || "";
  const sign = params.get("sign") || "";
  if (!token || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300000 || !/^[A-Za-z0-9_-]{1,128}$/.test(nonce) || !/^[a-f0-9]{32}$/.test(sign)) return false;
  const expected = createHash("md5").update(token + timestamp + nonce).digest();
  return timingSafeEqual(expected, Buffer.from(sign, "hex"));
}

export function decryptZlinkData(ciphertext: unknown, appKey: string, iv: string) {
  if (typeof ciphertext !== "string" || !/^[a-fA-F0-9]+$/.test(ciphertext) || ciphertext.length % 32 || ciphertext.length > 2_000_000 || Buffer.byteLength(appKey) !== 16 || Buffer.byteLength(iv) !== 16) throw new Error("Contenido cifrado invalido.");
  const decipher = createDecipheriv("aes-128-cbc", Buffer.from(appKey), Buffer.from(iv));
  decipher.setAutoPadding(false);
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]);
  // Zlink documents AES/CBC/NoPadding. Handle zero or PKCS#7 trailing padding.
  const last = plaintext[plaintext.length - 1];
  const unpadded = last >= 1 && last <= 16 && plaintext.subarray(-last).every(byte => byte === last)
    ? plaintext.subarray(0, -last) : plaintext;
  return unpadded.toString("utf8").replace(/\0+$/, "").trim();
}

export function parseZlinkWebhook(input: unknown, eventCode = "open:att_transaction:push") {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Evento invalido.");
  const event = input as Record<string, unknown>;
  const access = eventCode === "open:acc_transaction:push";
  if (!access && eventCode !== "open:att_transaction:push") throw new Error("Tipo de evento invalido.");
  const logs = access ? event.accLogs : event.attLogs;
  if (typeof event.companyId !== "string" || !event.companyId || !Array.isArray(logs) || logs.length > 1000) throw new Error("Datos de asistencia invalidos.");
  // Only normal successful personal verifications count as attendance, never
  // door schedules, remote opening, alarms, or unsuccessful access attempts.
  const personalVerification = new Set(["149d255862a1404089993a487c04f035", "007b231565d84cb3ad1f5241dd5aab04"]);
  return logs.filter(value => !access || (value && typeof value === "object" && personalVerification.has(String(value.eventTypeCode)))).map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Marcaje invalido.");
    const log = value as Record<string, unknown>;
    const punchTime = access ? log.time : log.punchTime;
    if (typeof log.operator !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(log.operator) || typeof punchTime !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(punchTime)) throw new Error("Codigo u hora invalida.");
    const local = zlinkLimaPunch({ punchTime: punchTime.slice(0, 19).replace("T", " "), timezone: punchTime.slice(19) });
    if (new Date(punchTime).getTime() > Date.now() + 300000) throw new Error("Marcaje con fecha futura.");
    return { code: log.operator, ...local };
  });
}
