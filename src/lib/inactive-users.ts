import { prisma } from "@/lib/prisma";

type Identity = { id: number; name: string; username: string; dni?: string | null };
type Profile = { personId: string; personName: string; extraBonuses: unknown };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/([a-z])\1+/g, "$1").replace(/[^a-z0-9]+/g, " ").trim();

export function inactiveUserIdsFor(profiles: Profile[], users: Identity[]) {
  const ids = new Set<number>();
  for (const profile of profiles) {
    const extra = profile.extraBonuses as Record<string, unknown> | null;
    if (!extra || !extra.__inactive) continue;
    const linkedId = Number(extra.__linkedUserId || 0);
    if (linkedId) { ids.add(linkedId); continue; }
    const dniMatch = users.filter(user => user.dni && user.dni.trim() === profile.personId.trim());
    if (dniMatch.length === 1) { ids.add(dniMatch[0].id); continue; }
    const name = normalize(profile.personName);
    const exact = users.filter(user => normalize(user.name) === name || normalize(user.username) === name);
    if (exact.length === 1) { ids.add(exact[0].id); continue; }
    const tokens = name.split(" ");
    const partial = users.filter(user => {
      const candidate = normalize(user.name).split(" ");
      return tokens.length >= 2 && candidate.length >= 2 && (candidate.every(token => tokens.includes(token)) || tokens.every(token => candidate.includes(token)));
    });
    if (partial.length === 1) ids.add(partial[0].id);
  }
  return ids;
}

export async function readInactiveUserIds() {
  const [profiles, users] = await Promise.all([
    prisma.attendanceProfile.findMany({ select: { personId: true, personName: true, extraBonuses: true } }),
    prisma.user.findMany({ select: { id: true, name: true, username: true, dni: true } }),
  ]);
  return inactiveUserIdsFor(profiles, users);
}
