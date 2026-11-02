import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function databaseUrl() {
  // The recovered project kept a placeholder DATABASE_URL, while the Vercel
  // integration exposes the real connection with a project-specific prefix.
  // Prefer whichever variable contains an actual PostgreSQL URL so local
  // development and Vercel deployments both use a valid connection.
  const candidates = [
    process.env.REGISTROS_DB_POSTGRES_PRISMA_URL,
    process.env.REGISTROS_DB_DATABASE_URL,
    process.env.DATABASE_URL,
  ];
  const raw = candidates.find((value) => /^postgres(?:ql)?:\/\//i.test(value || ""));
  if (!raw) return raw;
  const url = new URL(raw);
  if (process.env.ATK_LOCAL_PREVIEW === "1" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("La vista local solo puede usar una base de datos local.");
  }
  // En serverless cada pantalla puede abrir una instancia propia. Usamos el
  // endpoint de Prisma/Neon y un pool mínimo por instancia para no agotar la
  // cuota de conexiones de la base de datos.
  if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "1");
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
  return url.toString();
}

export const prisma =
  global.prismaGlobal ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: databaseUrl()
      ? {
          db: {
            url: databaseUrl(),
          },
        }
      : undefined,
  });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}
