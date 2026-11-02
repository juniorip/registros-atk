import { PrismaClient, UserRole } from "@prisma/client";

// This migration is intentionally opt-in. Run with --apply only after
// reviewing the dry-run output and backing up the production database.
const APPLY = process.argv.includes("--apply");
const START = new Date("2026-08-01T05:00:00.000Z"); // 00:00 on 1 August in Lima
const START_DATE = "2026-08-01";
const prisma = new PrismaClient();

const ASSIGNMENTS = [
  { label: "Valeria Alessandra", tokens: ["valeria", "alessandra"], role: UserRole.MANAGER, sede: "Miraflores" },
  { label: "Benedic", tokens: ["benedic"], role: UserRole.EMPLOYEE, sede: "Miraflores" },
  {
    label: "Cristhian Jose Sulca Constancio",
    tokens: ["sulca"],
    ratingTokens: ["cristian", "cristhian", "sulca"],
    role: UserRole.EMPLOYEE,
    sede: "Miraflores",
  },
  { label: "Camila", tokens: ["camila"], role: UserRole.EMPLOYEE, sede: "Miraflores" },
  { label: "Danna", tokens: ["danna"], role: UserRole.MANAGER, sede: "Lince" },
  { label: "Ivon", tokens: ["ivon"], role: UserRole.EMPLOYEE, sede: "Lince" },
];

function normalized(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesTokens(value, tokens) {
  const text = normalized(value);
  return tokens.every((token) => text.includes(token));
}

function ratingMatches(approval, assignment) {
  const ratingTokens = assignment.ratingTokens || assignment.tokens;
  return [approval.advisor, approval.matchedUserName]
    .filter(Boolean)
    .some((value) => ratingTokens.some((token) => matchesTokens(value, [token])));
}

function linkedUserId(profile) {
  const raw = profile?.extraBonuses?.__linkedUserId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function currentSede(value) {
  return value === "Centro" ? "Lince" : value || "Lince";
}

function attendanceSedeTransfer(extraBonuses, sede) {
  const extras = extraBonuses && typeof extraBonuses === "object" && !Array.isArray(extraBonuses)
    ? { ...extraBonuses }
    : {};
  const previous = Array.isArray(extras.__sedeTransfers) ? extras.__sedeTransfers : [];
  // From August 1 onward, the current sede is authoritative. Keep only
  // transfers before that date and add one explicit migration transfer.
  extras.__sedeTransfers = [
    ...previous.filter((item) => String(item?.effectiveDate || "") < START_DATE),
    { effectiveDate: START_DATE, to: sede, source: "sede-migration" },
  ];
  // The attendance API uses this current-sede marker to scope the manager's
  // collaborator list before rendering monthly attendance.
  extras.__currentSede = sede;
  return extras;
}

async function updateOwnedEntries(userId, sede) {
  const where = { userId, createdAt: { gte: START } };
  const results = await Promise.all([
    prisma.record.updateMany({ where, data: { historicalSede: sede } }),
    prisma.referral.updateMany({ where, data: { historicalSede: sede } }),
    prisma.wrongCardReport.updateMany({ where, data: { historicalSede: sede } }),
    prisma.callReport.updateMany({ where, data: { historicalSede: sede } }),
    prisma.safetypayCodeEntry.updateMany({ where, data: { historicalSede: sede } }),
    prisma.commercialCardEntry.updateMany({ where, data: { historicalSede: sede } }),
    prisma.penaltyReport.updateMany({
      where: { workerUserId: userId, createdAt: { gte: START } },
      data: { workerSede: sede, targetSede: sede },
    }),
  ]);
  return results.reduce((total, result) => total + result.count, 0);
}

async function countOwnedEntries(userId) {
  const where = { userId, createdAt: { gte: START } };
  const results = await Promise.all([
    prisma.record.count({ where }),
    prisma.referral.count({ where }),
    prisma.wrongCardReport.count({ where }),
    prisma.callReport.count({ where }),
    prisma.safetypayCodeEntry.count({ where }),
    prisma.commercialCardEntry.count({ where }),
    prisma.penaltyReport.count({ where: { workerUserId: userId, createdAt: { gte: START } } }),
  ]);
  return results.reduce((total, count) => total + count, 0);
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, username: true, role: true, sede: true },
    orderBy: { name: "asc" },
  });
  // Persisted collaborator profiles used by the Colaboradores screen. This
  // does not read or modify an attendance Excel file.
  const profiles = await prisma.attendanceProfile.findMany({
    select: { personId: true, personName: true, department: true, payrollRole: true, extraBonuses: true },
    orderBy: { personName: "asc" },
  });

  const resolved = ASSIGNMENTS.map((assignment) => {
    const profileMatches = profiles.filter((profile) => matchesTokens(profile.personName, assignment.tokens));
    const directUserMatches = users.filter((user) =>
      matchesTokens(user.name, assignment.tokens) || matchesTokens(user.username, assignment.tokens),
    );
    const linkedUserIds = new Set(profileMatches.map(linkedUserId).filter(Boolean));
    const matches = users.filter((user) =>
      linkedUserIds.has(user.id) || directUserMatches.some((candidate) => candidate.id === user.id),
    );
    return { ...assignment, profileMatches, matches };
  });

  const invalid = resolved.filter((item) => item.matches.length !== 1 || item.profileMatches.length !== 1);
  if (invalid.length) {
    console.error("No changes made. Review these collaborator/profile matches:");
    invalid.forEach((item) => {
      console.error(`- ${item.label}: ${item.profileMatches.length} profile(s), ${item.matches.length} user(s)`);
      item.profileMatches.forEach((profile) => console.error(`  profile: ${profile.personName} (${profile.personId})`));
      item.matches.forEach((user) => console.error(`  user: ${user.name} (${user.username})`));
      profiles
        .filter((profile) => item.tokens.some((token) => matchesTokens(profile.personName, [token])))
        .forEach((profile) => console.error(`  possible profile: ${profile.personName} (${profile.personId})`));
      users
        .filter((user) => item.tokens.some((token) => matchesTokens(user.name, [token]) || matchesTokens(user.username, [token])))
        .forEach((user) => console.error(`  possible user: ${user.name} (${user.username})`));
    });
    process.exitCode = 1;
    return;
  }

  console.table(resolved.map((item) => ({
    persona: item.label,
    ficha: item.profileMatches[0].personName,
    usuario: item.matches[0].name,
    username: item.matches[0].username,
    rol_nuevo: item.role,
    sede_nueva: item.sede,
  })));

  const ratings = await prisma.ratingApproval.findMany({
    where: { createdAt: { gte: START } },
    select: { id: true, advisor: true, matchedUserName: true, matchedUserId: true },
  });

  const plannedUsers = users.map((user) => {
    const assignment = resolved.find((item) => item.matches[0].id === user.id);
    return { ...user, role: assignment?.role || user.role, sede: assignment?.sede || currentSede(user.sede) };
  });

  function ratingOwner(rating, candidates) {
    const byId = candidates.find((user) => user.id === rating.matchedUserId);
    if (byId) return byId;
    const assigned = resolved.find((item) => ratingMatches(rating, item));
    if (assigned) return candidates.find((user) => user.id === assigned.matches[0].id) || null;
    const names = [rating.advisor, rating.matchedUserName].filter(Boolean).map(normalized);
    const exact = candidates.filter((user) =>
      names.some((name) => name === normalized(user.name) || name === normalized(user.username)),
    );
    return exact.length === 1 ? exact[0] : null;
  }

  const plannedRatings = ratings.filter((rating) => ratingOwner(rating, plannedUsers));
  if (!APPLY) {
    const previewRows = [];
    for (const user of plannedUsers) {
      const entries = await countOwnedEntries(user.id);
      if (entries) previewRows.push({ usuario: user.name, sede_actual: user.sede, entradas_a_migrar: entries });
    }
    console.table(previewRows);
    const linkedAttendanceProfiles = profiles.filter((profile) =>
      plannedUsers.some((user) => user.id === linkedUserId(profile)),
    ).length;
    console.log(`Preview only. ${previewRows.length} user(s) with entries, ${plannedRatings.length} rating(s), and ${linkedAttendanceProfiles} attendance profile(s) will be assigned to each creator's current sede from August 1.`);
    console.log("No database changes and no attendance Excel access.");
    console.log("After reviewing and backing up the database, run with --apply.");
    return;
  }

  for (const item of resolved) {
    const user = item.matches[0];
    const profile = item.profileMatches[0];
    await prisma.user.update({ where: { id: user.id }, data: { role: item.role, sede: item.sede } });
    await prisma.attendanceProfile.update({
      where: { personId: profile.personId },
      data: {
        department: item.sede,
        extraBonuses: attendanceSedeTransfer(profile.extraBonuses, item.sede),
        ...(item.role === UserRole.MANAGER ? { payrollRole: "Jefe de Sede" } : {}),
      },
    });
  }

  const currentUsers = await prisma.user.findMany({
    select: { id: true, name: true, username: true, role: true, sede: true },
    orderBy: { name: "asc" },
  });
  let reassignedEntries = 0;
  for (const user of currentUsers) {
    const sede = currentSede(user.sede);
    if (user.sede !== sede) await prisma.user.update({ where: { id: user.id }, data: { sede } });
    reassignedEntries += await updateOwnedEntries(user.id, sede);
  }

  const currentUsersById = new Map(currentUsers.map((user) => [user.id, user]));
  const currentProfiles = await prisma.attendanceProfile.findMany({
    select: { personId: true, extraBonuses: true },
  });
  let reassignedAttendanceProfiles = 0;
  for (const profile of currentProfiles) {
    const user = currentUsersById.get(linkedUserId(profile));
    if (!user) continue;
    await prisma.attendanceProfile.update({
      where: { personId: profile.personId },
      data: { extraBonuses: attendanceSedeTransfer(profile.extraBonuses, currentSede(user.sede)) },
    });
    reassignedAttendanceProfiles += 1;
  }

  let reassignedRatings = 0;
  for (const rating of ratings) {
    const owner = ratingOwner(rating, currentUsers);
    if (!owner) continue;
    await prisma.ratingApproval.update({
      where: { id: rating.id },
      data: {
        sede: currentSede(owner.sede),
        matchedUserId: owner.id,
        matchedUserName: owner.name,
      },
    });
    reassignedRatings += 1;
  }

  console.log(`Migration finished: ${reassignedEntries} entries, ${reassignedRatings} ratings, and ${reassignedAttendanceProfiles} attendance profiles reassigned from August 1.`);
  console.log("No attendance Excel was read or modified.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
