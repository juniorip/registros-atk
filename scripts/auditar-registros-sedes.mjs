import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const START = new Date("2026-08-01T05:00:00.000Z");
const PEOPLE = [
  { label: "Benedic", tokens: ["benedic"] },
  { label: "Cristhian", tokens: ["sulca"] },
  { label: "Ivon", tokens: ["ivon"] },
];

function text(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, username: true, sede: true },
    orderBy: { name: "asc" },
  });

  for (const person of PEOPLE) {
    const matches = users.filter((user) =>
      person.tokens.every((token) => text(user.name).includes(token) || text(user.username).includes(token)),
    );
    if (matches.length !== 1) {
      console.log(`${person.label}: ${matches.length} user match(es); no data changed.`);
      continue;
    }
    const user = matches[0];
    const [total, sinceAugust, bySede] = await Promise.all([
      prisma.record.count({ where: { userId: user.id } }),
      prisma.record.count({ where: { userId: user.id, createdAt: { gte: START } } }),
      prisma.record.groupBy({
        by: ["historicalSede"],
        where: { userId: user.id },
        _count: { _all: true },
      }),
    ]);
    console.log(`\n${person.label}: ${user.name} (@${user.username}), sede actual: ${user.sede}`);
    console.log(`  Registros totales: ${total}; desde 1 de agosto: ${sinceAugust}`);
    console.table(bySede.map((row) => ({ sede_historica: row.historicalSede || "sin sede", registros: row._count._all })));
  }
  console.log("Auditoria terminada. No se modifico ningun dato.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
