import { constants, createCipheriv, createHash, publicEncrypt, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { isAdmin } from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { BACKUP_PUBLIC_KEY } from "@/lib/backup-public-key";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';

export async function POST() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: "Solo administradores." }, { status: 403 });
  try {
    const database = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const names = await tx.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename`;
      const tables: Record<string, unknown[]> = {};
      for (const { tablename } of names) {
        const rows = await tx.$queryRawUnsafe<Array<{ row: unknown }>>(`SELECT row_to_json(t) AS row FROM public.${identifier(tablename)} t`);
        tables[tablename] = rows.map(item => item.row);
      }
      const columns = await tx.$queryRaw`SELECT table_name,column_name,data_type,udt_name,column_default,is_nullable,ordinal_position FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`;
      const constraints = await tx.$queryRaw`SELECT c.conrelid::regclass::text AS table_name,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON c.connamespace=n.oid WHERE n.nspname='public' ORDER BY c.conrelid::regclass::text,c.conname`;
      const sequences = await tx.$queryRaw`SELECT sequencename,last_value,start_value,increment_by,min_value,max_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`;
      return { tables, columns, constraints, sequences };
    }, { isolationLevel: "RepeatableRead", maxWait: 10000, timeout: 50000 });
    const configuration = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(DATABASE_URL|REGISTROS_|SESSION_SECRET|SAFETYPAY_API_TOKEN|ZLINK_|GOOGLE_)/.test(key)));
    const serialized = JSON.stringify({ format: "registros-atk-full-backup", version: 1, createdAt: new Date().toISOString(), database, configuration }, (_key, value) => typeof value === "bigint" ? value.toString() : value);
    const key = randomBytes(32), iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(gzipSync(serialized)), cipher.final()]);
    const envelope = JSON.stringify({ format: "registros-atk-encrypted-backup", version: 1, algorithm: "RSA-OAEP-SHA256+AES-256-GCM+gzip", sha256: createHash("sha256").update(serialized).digest("hex"), encryptedKey: publicEncrypt({ key: BACKUP_PUBLIC_KEY, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key).toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
    return new Response(envelope, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="registros-atk-respaldo-completo.atkbackup"', "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
  } catch {
    console.error("No se pudo crear el respaldo cifrado de Registros ATK");
    return NextResponse.json({ error: "No se pudo completar el respaldo. No se modificaron los datos." }, { status: 503 });
  }
}
