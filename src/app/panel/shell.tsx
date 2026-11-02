"use client";

import { UserRole } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ApiUser = {
  id: number;
  name: string;
  username: string;
  dni?: string | null;
  role: UserRole;
  sede: string;
  forcePasswordReset: boolean;
  color: string;
  roleLabel: string;
  commission: number;
  commissionCount: number;
};

type ApiRecord = {
  id: number;
  userId: number;
  clientName: string;
  dni: string;
  type: "REGISTRO" | "OPERACION";
  mode: "VIRTUAL" | "PRESENCIAL";
  registrationDate: string;
  operationDate: string | null;
  uploadPlatform: "WEB" | "DRIVE";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  validatedAt: string | null;
  validatedById: number | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  roleLabel: string;
  platformLabel: string;
  pendingApproval: boolean;
  validationLabel: string;
  isDuplicate?: boolean;
  user: ApiUser;
  validatedBy: ApiUser | null;
};

type ApiState = {
  currentUser: ApiUser;
  settings: {
    commissionPerRecord: number;
  };
  users: ApiUser[];
  records: ApiRecord[];
};
type WorkGroup = { id?: number; name: string; chiefDni: string | null; members: { dni: string }[] };

type View =
  | "dashboard"
  | "mis-registros"
  | "todos"
  | "alertas"
  | "mis-comisiones"
  | "admin"
  | "reportes";

const EXPIRE_DAY = 7;
const WARN_DAY = 6;

const defaultRecordForm = {
  clientName: "",
  dni: "",
  registrationDate: new Date().toISOString().slice(0, 10),
  type: "REGISTRO" as "REGISTRO" | "OPERACION",
  operationDate: "",
  mode: "VIRTUAL" as "VIRTUAL" | "PRESENCIAL",
  uploadPlatform: "WEB" as "WEB" | "DRIVE",
  notes: "",
};

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function formatDate(date?: string | null) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("es-PE").format(new Date(date));
}

function formatDateTime(date?: string | null) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(date),
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function isApprovalLocked(record: ApiRecord) {
  return record.pendingApproval || !!record.validatedAt || !!record.rejectedAt;
}

function getStatusChip(record: ApiRecord) {
  if (record.validatedAt) {
    return (
      <span className="inline-flex rounded-[6px] bg-[rgba(34,201,122,0.1)] px-2 py-1 text-[11px] font-semibold text-[#22c97a]">
        Validado {formatDate(record.validatedAt)}
      </span>
    );
  }

  if (record.rejectedAt) {
    return (
      <span className="inline-flex rounded-[6px] bg-[rgba(239,68,68,0.1)] px-2 py-1 text-[11px] font-semibold text-[#ef4444]">
        Rechazado
      </span>
    );
  }

  if (record.pendingApproval) {
    return (
      <span className="inline-flex rounded-[6px] bg-[rgba(245,166,35,0.12)] px-2 py-1 text-[11px] font-semibold text-[#f5a623]">
        Pendiente de aprobación
      </span>
    );
  }

  const days = daysSince(record.registrationDate);
  const tone =
    days > EXPIRE_DAY
      ? "bg-[rgba(239,68,68,0.1)] text-[#ef4444]"
      : days === WARN_DAY
        ? "bg-[rgba(245,166,35,0.12)] text-[#f5a623]"
        : "bg-[rgba(34,201,122,0.12)] text-[#22c97a]";

  return <span className={`inline-flex rounded-[6px] px-2 py-1 text-[11px] font-semibold ${tone}`}>Día {days}</span>;
}

export function DashboardShell() {
  const router = useRouter();
  const [data, setData] = useState<ApiState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [approvalFilter, setApprovalFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [newRecordOpen, setNewRecordOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ApiRecord | null>(null);
  const [recordForm, setRecordForm] = useState(defaultRecordForm);
  const [saving, setSaving] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    dni: "",
    username: "",
    password: "",
    role: "EMPLOYEE" as "ADMIN" | "MANAGER" | "EMPLOYEE",
    sede: "Lince",
  });
  const [adminPassword, setAdminPassword] = useState({
    currentPassword: "",
    newPassword: "",
    repeatPassword: "",
  });
  const [commissionValue, setCommissionValue] = useState("0.40");
  const [groups, setGroups] = useState<WorkGroup[]>([]);

  async function loadState() {
    setLoading(true);
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) {
      setError("No se pudo cargar el panel.");
      setLoading(false);
      return;
    }
    const payload = (await response.json()) as ApiState;
    setData(payload);
    setCommissionValue(String(payload.settings.commissionPerRecord.toFixed(2)));
    setView(payload.currentUser.role === "EMPLOYEE" ? "mis-registros" : "dashboard");
    setLoading(false);
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadState();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);
  async function loadGroups() {
    const response = await fetch("/api/groups", { cache: "no-store" });
    if (response.ok) setGroups((await response.json()).groups);
  }
  useEffect(() => { void loadGroups(); }, []);

  async function saveGroups() {
    const payload = groups.map((group) => ({ name: group.name, chiefDni: group.chiefDni || null, memberDnis: group.members.map((member) => member.dni).filter(Boolean) }));
    const response = await fetch("/api/groups", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groups: payload }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return alert(result.error || "No se pudieron guardar los grupos.");
    await loadGroups();
  }

  const records = data?.records ?? [];
  const users = data?.users ?? [];
  const currentUser = data?.currentUser ?? null;
  const commissionRate = data?.settings.commissionPerRecord ?? 0.4;

  const duplicateIds = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const record of records) {
      map.set(record.dni, [...(map.get(record.dni) || []), record.id]);
    }
    const dup = new Set<number>();
    for (const ids of map.values()) {
      if (ids.length > 1) ids.forEach((id) => dup.add(id));
    }
    for (const record of records) {
      if (record.isDuplicate) dup.add(record.id);
    }
    return dup;
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const fullText = `${record.clientName} ${record.dni} ${record.user.name}`.toLowerCase();
      const matchQuery = !query || fullText.includes(query.toLowerCase());
      const matchType = !typeFilter || record.type === typeFilter;
      const matchUser = !userFilter || String(record.userId) === userFilter;
      const matchApproval =
        !approvalFilter ||
        (approvalFilter === "pending" && record.pendingApproval) ||
        (approvalFilter === "validated" && !!record.validatedAt) ||
        (approvalFilter === "rejected" && !!record.rejectedAt);
      return matchQuery && matchType && matchUser && matchApproval;
    });
  }, [approvalFilter, query, records, typeFilter, userFilter]);

  const myRecords = filteredRecords.filter((record) => record.userId === currentUser?.id);
  const daySix = records.filter(
    (record) => record.type === "REGISTRO" && daysSince(record.registrationDate) === WARN_DAY,
  );
  const expired = records.filter(
    (record) => record.type === "REGISTRO" && daysSince(record.registrationDate) > EXPIRE_DAY,
  );
  const pendingApproval = records.filter((record) => record.pendingApproval);

  function openNewRecord() {
    setEditingRecord(null);
    setRecordForm(defaultRecordForm);
    setNewRecordOpen(true);
  }

  function openEditRecord(record: ApiRecord) {
    setEditingRecord(record);
    setRecordForm({
      clientName: record.clientName,
      dni: record.dni,
      registrationDate: record.registrationDate.slice(0, 10),
      type: record.type,
      operationDate: record.operationDate ? record.operationDate.slice(0, 10) : "",
      mode: record.mode,
      uploadPlatform: record.uploadPlatform,
      notes: record.notes || "",
    });
    setNewRecordOpen(true);
  }

  async function saveRecord() {
    setSaving(true);
    const payload = {
      ...recordForm,
      operationDate: recordForm.type === "OPERACION" ? recordForm.operationDate || null : null,
    };

    const response = await fetch(editingRecord ? `/api/records/${editingRecord.id}` : "/api/records", {
      method: editingRecord ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(result.error || "No se pudo guardar el registro.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setNewRecordOpen(false);
    await loadState();
  }

  async function performDecision(recordId: number, action: "validate" | "reject") {
    const reason = action === "reject" ? window.prompt("Motivo del rechazo:") || "" : "";
    if (action === "reject" && !reason.trim()) return;

    const response = await fetch(`/api/records/${recordId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(result.error || "No se pudo procesar la decisión.");
      return;
    }
    await loadState();
  }

  async function deleteRecord(recordId: number) {
    if (!window.confirm("¿Eliminar este registro?")) return;
    const response = await fetch(`/api/records/${recordId}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(result.error || "No se pudo eliminar.");
      return;
    }
    await loadState();
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  async function createUser() {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newUser),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(result.error || "No se pudo crear el usuario.");
      return;
    }
    setNewUser({ name: "", dni: "", username: "", password: "", role: "EMPLOYEE", sede: "Lince" });
    await loadState();
  }

  async function saveCommission() {
    const response = await fetch("/api/settings/commission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionPerRecord: Number(commissionValue) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(result.error || "No se pudo guardar la comisión.");
      return;
    }
    await loadState();
  }

  async function saveAdminPassword() {
    const response = await fetch("/api/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adminPassword),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(result.error || "No se pudo cambiar la contraseña.");
      return;
    }
    setAdminPassword({ currentPassword: "", newPassword: "", repeatPassword: "" });
    await loadState();
    router.replace("/panel");
    router.refresh();
    alert("Contraseña actualizada.");
  }

  function exportReport(mode: "all" | "user") {
    if (!data || !currentUser) return;
    const reportRecords =
      mode === "user"
        ? records.filter((record) => record.userId === currentUser.id && record.validatedAt)
        : records.filter((record) => record.validatedAt);
    const summary = users
      .filter((user) => user.commissionCount > 0)
      .map(
        (user) =>
          `<tr><td>${user.name}</td><td>${user.roleLabel}</td><td>${user.sede}</td><td>${user.commissionCount}</td><td>S/ ${user.commission.toFixed(2)}</td></tr>`,
      )
      .join("");
    const rows = reportRecords
      .map(
        (record) =>
          `<tr><td>${record.clientName}</td><td>${record.dni}</td><td>${record.user.name}</td><td>${formatDate(record.registrationDate)}</td><td>${formatDate(record.operationDate)}</td><td>${formatDate(record.validatedAt)}</td><td>S/ ${commissionRate.toFixed(2)}</td></tr>`,
      )
      .join("");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Reporte</title><style>body{font-family:Arial;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #d9dee7;padding:8px;font-size:12px;text-align:left}th{background:#f3f6fb}h1{margin:0}p{color:#555}</style></head><body><h1>Reporte de Registros</h1><p>${currentUser.name} · ${currentUser.roleLabel} · ${currentUser.sede}</p>${mode === "all" ? `<h2>Resumen por atención al cliente</h2><table><thead><tr><th>Atención al cliente</th><th>Rol</th><th>Sede</th><th>Validados</th><th>Comisión</th></tr></thead><tbody>${summary}</tbody></table>` : ""}<h2>Detalle</h2><table><thead><tr><th>Cliente</th><th>DNI</th><th>Atención al cliente</th><th>Registro</th><th>Operación</th><th>Validado</th><th>Comisión</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print();<\/script></body></html>`);
    win.document.close();
  }

  if (loading) {
    return <main className="min-h-screen bg-[#0a0d14] p-10 text-[#e8ecf4]">Cargando panel...</main>;
  }

  if (!data || !currentUser) {
    return <main className="min-h-screen bg-[#0a0d14] p-10 text-[#ef4444]">{error || "No se pudo cargar."}</main>;
  }

  const nav =
    currentUser.role === "ADMIN"
      ? [
          ["dashboard", "Dashboard"],
          ["todos", "Todos los Registros"],
          ["alertas", "Alertas"],
          ["admin", "Administración"],
          ["reportes", "Reportes"],
        ]
      : currentUser.role === "MANAGER"
        ? [
            ["dashboard", "Dashboard"],
            ["mis-registros", "Mis Registros"],
            ["todos", "Registros de Sede"],
            ["alertas", "Alertas"],
            ["mis-comisiones", "Mis Comisiones"],
            ["admin", "Mi Equipo"],
            ["reportes", "Reportes"],
          ]
        : [
            ["mis-registros", "Mis Registros"],
            ["alertas", "Alertas"],
            ["mis-comisiones", "Mis Comisiones"],
          ];

  return (
    <main className="min-h-screen bg-[#0a0d14] text-[#e8ecf4]">
      <div className="flex min-h-screen">
        <aside className="hidden w-[220px] shrink-0 border-r border-white/8 bg-[#111520] py-6 md:flex md:flex-col">
          <div className="mb-5 text-center">
            <div className="font-display animate-[float_4.4s_ease-in-out_infinite] text-[31px] font-extrabold tracking-[-0.14em]">
              <span className="text-[#ffcc00]">A</span>
              <span className="text-white">TK</span>
            </div>
            <div className="font-display text-[9px] font-bold text-white/85">
              ALTOQUE PERU <span className="text-[#ffcc00]">WK</span>
            </div>
          </div>

          <nav className="space-y-1">
            {nav.map(([id, label]) => (
              <button
                key={id}
                className={`w-full border-l-[3px] px-5 py-2.5 text-left text-[13px] font-medium transition ${
                  view === id
                    ? "border-l-[#4f8ef7] bg-[rgba(79,142,247,0.1)] text-[#4f8ef7]"
                    : "border-l-transparent text-[#8b92a9] hover:bg-[#181d2c] hover:text-[#e8ecf4]"
                }`}
                onClick={() => setView(id as View)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-auto border-t border-white/8 px-5 pt-4">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: currentUser.color }}
              >
                {initials(currentUser.name)}
              </div>
              <div>
                <div className="text-[13px] font-medium">{currentUser.name}</div>
                <div className="text-[10px] uppercase tracking-[0.5px] text-[#555e75]">
                  {currentUser.roleLabel} · {currentUser.sede}
                </div>
              </div>
            </div>
            <button
              className="mt-3 w-full rounded-[6px] px-3 py-1.5 text-[11px] text-[#555e75] transition hover:bg-[rgba(239,68,68,0.1)] hover:text-[#ef4444]"
              onClick={logout}
            >
              Cerrar sesión
            </button>
          </div>
        </aside>

        <section className="flex-1 px-5 py-6 md:px-8">
          <header className="mb-6 overflow-hidden rounded-[22px] border border-white/8 bg-[linear-gradient(135deg,rgba(79,142,247,0.16),rgba(45,212,191,0.08)_48%,rgba(167,139,250,0.12))] p-6">
            <div className="text-[11px] font-bold uppercase tracking-[1.6px] text-[#b8c7ea]">
              Panel de trabajo
            </div>
            <h1 className="font-display mt-2 text-[34px] font-bold leading-none">Hola {currentUser.name}</h1>
            <div className="mt-4 flex flex-wrap gap-3 text-[12px]">
              <span className="rounded-full border border-white/8 bg-[rgba(9,13,20,0.35)] px-4 py-2">
                Sede: <strong>{currentUser.sede}</strong>
              </span>
              <span className="rounded-full border border-white/8 bg-[rgba(9,13,20,0.35)] px-4 py-2">
                Cargo: <strong>{currentUser.roleLabel}</strong>
              </span>
            </div>
          </header>

          {currentUser.forcePasswordReset ? (
            <section className="mb-6 rounded-[12px] border border-[rgba(245,166,35,0.2)] bg-[rgba(245,166,35,0.08)] p-6">
              <h2 className="font-display text-xl font-bold">Cambio de contraseña obligatorio</h2>
              <p className="mt-2 max-w-2xl text-sm text-[#f8bb59]">
                Antes de seguir usando el sistema, actualiza tu contraseña.
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <input className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" placeholder="Contraseña actual" type="password" value={adminPassword.currentPassword} onChange={(event) => setAdminPassword((prev) => ({ ...prev, currentPassword: event.target.value }))} />
                <input className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" placeholder="Nueva contraseña" type="password" value={adminPassword.newPassword} onChange={(event) => setAdminPassword((prev) => ({ ...prev, newPassword: event.target.value }))} />
                <input className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" placeholder="Repite la nueva contraseña" type="password" value={adminPassword.repeatPassword} onChange={(event) => setAdminPassword((prev) => ({ ...prev, repeatPassword: event.target.value }))} />
              </div>
              <button className="font-display mt-4 rounded-[8px] bg-[#4f8ef7] px-5 py-3 font-semibold text-white hover:bg-[#3d7aee]" onClick={saveAdminPassword}>
                Guardar contraseña
              </button>
            </section>
          ) : null}

          {view === "dashboard" ? (
            <div className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-4">
                <StatCard label="Total comisiones" value={`S/ ${currentUser.commission.toFixed(2)}`} sub={`${currentUser.commissionCount} registros válidos`} tone="green" />
                <StatCard label="Pendientes aprobación" value={String(pendingApproval.length)} sub="Operaron dentro del plazo" tone="amber" />
                <StatCard label="Clientes día 6" value={String(daySix.length)} sub="Alerta previa al vencimiento" tone="amber" />
                <StatCard label="Duplicados" value={String(duplicateIds.size)} sub="DNIs repetidos visibles" tone="red" />
              </div>

              <PanelCard title="Comisiones visibles">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {users
                    .filter((user) => user.role !== "ADMIN")
                    .map((user) => (
                      <article key={user.id} className="rounded-[12px] border border-white/8 bg-[#181d2c] p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: user.color }}>
                            {initials(user.name)}
                          </div>
                          <div>
                            <div className="font-medium">{user.name}</div>
                            <div className="text-xs text-[#8b92a9]">{user.roleLabel}</div>
                          </div>
                        </div>
                        <div className="font-display mt-4 text-3xl font-bold text-[#22c97a]">S/ {user.commission.toFixed(2)}</div>
                        <div className="mt-2 text-sm text-[#8b92a9]">{user.commissionCount} registros validados</div>
                      </article>
                    ))}
                </div>
              </PanelCard>
            </div>
          ) : null}

          {view === "mis-registros" || view === "todos" ? (
            <PanelCard
              title={
                view === "mis-registros"
                  ? "Mis Registros"
                  : currentUser.role === "MANAGER"
                    ? "Registros de Sede"
                    : "Todos los Registros"
              }
              subtitle="Seguimiento compartido con validaciones reales y alertas."
              headerActions={
                <>
                  {view === "mis-registros" ? (
                    <button className="rounded-[8px] border border-[#4f8ef7] px-4 py-2 text-[12px] font-semibold text-[#4f8ef7] hover:bg-[#4f8ef7] hover:text-white" onClick={openNewRecord}>
                      Nuevo registro
                    </button>
                  ) : null}
                  <input className="rounded-[8px] border border-white/8 bg-[#181d2c] px-3 py-2 text-[13px] outline-none focus:border-[#4f8ef7]" placeholder="Buscar cliente, DNI o atención al cliente..." value={query} onChange={(event) => setQuery(event.target.value)} />
                  <select className="rounded-[8px] border border-white/8 bg-[#181d2c] px-3 py-2 text-[13px] outline-none focus:border-[#4f8ef7]" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                    <option value="">Todos</option>
                    <option value="REGISTRO">Registro</option>
                    <option value="OPERACION">Operación</option>
                  </select>
                  {currentUser.role !== "EMPLOYEE" ? (
                    <select className="rounded-[8px] border border-white/8 bg-[#181d2c] px-3 py-2 text-[13px] outline-none focus:border-[#4f8ef7]" value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
                      <option value="">Todo el equipo</option>
                      {users.filter((user) => user.role !== "ADMIN").map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {currentUser.role !== "EMPLOYEE" ? (
                    <select className="rounded-[8px] border border-white/8 bg-[#181d2c] px-3 py-2 text-[13px] outline-none focus:border-[#4f8ef7]" value={approvalFilter} onChange={(event) => setApprovalFilter(event.target.value)}>
                      <option value="">Toda aprobación</option>
                      <option value="pending">Pendientes</option>
                      <option value="validated">Validados</option>
                      <option value="rejected">Rechazados</option>
                    </select>
                  ) : null}
                </>
              }
            >
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className="bg-[#111520]">
                      {["Cliente", "DNI", "Atención al cliente", "Tipo", "Registro", "Estado", "Aprobación", "Plataforma", "Acciones"].map((label) => (
                        <th key={label} className="border-b border-white/8 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-[#555e75]">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(view === "mis-registros" ? myRecords : filteredRecords).map((record) => (
                      <tr key={record.id} className="border-b border-white/8 last:border-b-0 hover:bg-white/[0.015]">
                        <td className="px-3.5 py-3 text-[13px] font-semibold">{record.clientName}</td>
                        <td className="px-3.5 py-3 text-[13px]">
                          {record.dni}
                          {duplicateIds.has(record.id) ? (
                            <span className="ml-2 inline-flex rounded-full border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.15)] px-2 py-0.5 text-[10px] font-semibold text-[#f77171]">
                              DUP
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3.5 py-3 text-[13px]">{record.user.name}</td>
                        <td className="px-3.5 py-3 text-[13px]">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${record.type === "OPERACION" ? "border-[rgba(34,201,122,0.25)] bg-[rgba(34,201,122,0.15)] text-[#4de09a]" : "border-[rgba(79,142,247,0.25)] bg-[rgba(79,142,247,0.15)] text-[#7bb3fa]"}`}>
                            {record.type === "OPERACION" ? "Operación" : "Registro"}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 text-[13px]">{formatDate(record.registrationDate)}</td>
                        <td className="px-3.5 py-3 text-[13px]">
                          {record.type === "OPERACION" && record.operationDate ? (
                            <span className="inline-flex rounded-[6px] bg-[rgba(34,201,122,0.12)] px-2 py-1 text-[11px] font-semibold text-[#22c97a]">
                              Operó en {formatDate(record.operationDate)}
                            </span>
                          ) : (
                            getStatusChip(record)
                          )}
                        </td>
                        <td className="px-3.5 py-3 text-[13px]">{record.validationLabel}</td>
                        <td className="px-3.5 py-3 text-[13px]">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${record.uploadPlatform === "DRIVE" ? "border-[rgba(167,139,250,0.2)] bg-[rgba(167,139,250,0.15)] text-[#c4affe]" : "border-[rgba(45,212,191,0.2)] bg-[rgba(45,212,191,0.15)] text-[#5ee7d4]"}`}>
                            {record.platformLabel}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 text-[13px]">
                          <div className="flex flex-wrap gap-2">
                            <button className="rounded-[5px] border border-white/12 px-2.5 py-1 text-[11px] text-[#8b92a9] hover:bg-[#181d2c] hover:text-[#e8ecf4]" onClick={() => openEditRecord(record)}>
                              {isApprovalLocked(record) ? "Ver" : "Editar"}
                            </button>
                            {(currentUser.role === "ADMIN" || currentUser.role === "MANAGER") && (
                              <button className="rounded-[5px] border border-[rgba(239,68,68,0.3)] px-2.5 py-1 text-[11px] text-[#ef4444] hover:bg-[rgba(239,68,68,0.1)]" onClick={() => deleteRecord(record.id)}>
                                Eliminar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PanelCard>
          ) : null}

          {view === "alertas" ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <AlertCard title="Día 6" count={daySix.length} items={daySix} tone="amber" />
              <AlertCard title="Expirados" count={expired.length} items={expired} tone="red" />
              <AlertCard title="Duplicados" count={duplicateIds.size} items={records.filter((record) => duplicateIds.has(record.id))} tone="rose" />
            </div>
          ) : null}

          {view === "mis-comisiones" ? (
            <section className="mb-6 rounded-[12px] border border-[rgba(79,142,247,0.2)] bg-[linear-gradient(135deg,rgba(79,142,247,0.12),rgba(167,139,250,0.08))] p-7">
              <div className="text-[11px] font-semibold uppercase tracking-[1px] text-[#4f8ef7]">Total comisiones ganadas</div>
              <div className="font-display mt-2 text-[44px] font-bold leading-none">S/ {currentUser.commission.toFixed(2)}</div>
              <div className="mt-2 text-[13px] text-[#8b92a9]">
                {currentUser.commissionCount} registros válidos × S/ {commissionRate.toFixed(2)} cada uno
              </div>
            </section>
          ) : null}

          {view === "admin" ? (
            <div className="space-y-6">
              {currentUser.role === "ADMIN" ? (
                <>
                  <PanelCard title="Comisión por registro">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="block flex-1">
                        <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.3px] text-[#8b92a9]">Monto</span>
                        <input className="w-full rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3 outline-none focus:border-[#4f8ef7]" value={commissionValue} onChange={(event) => setCommissionValue(event.target.value)} />
                      </label>
                      <button className="font-display rounded-[8px] bg-[#4f8ef7] px-5 py-3 text-[14px] font-semibold text-white hover:bg-[#3d7aee]" onClick={saveCommission}>Guardar comisión</button>
                    </div>
                  </PanelCard>

                  <PanelCard title="Cambiar contraseña de admin">
                    <div className="grid gap-3 md:grid-cols-3">
                      <input className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" type="password" placeholder="Contraseña actual" value={adminPassword.currentPassword} onChange={(event) => setAdminPassword((prev) => ({ ...prev, currentPassword: event.target.value }))} />
                      <input className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" type="password" placeholder="Nueva contraseña" value={adminPassword.newPassword} onChange={(event) => setAdminPassword((prev) => ({ ...prev, newPassword: event.target.value }))} />
                      <input className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" type="password" placeholder="Repite la nueva contraseña" value={adminPassword.repeatPassword} onChange={(event) => setAdminPassword((prev) => ({ ...prev, repeatPassword: event.target.value }))} />
                    </div>
                    <button className="font-display mt-4 rounded-[8px] bg-[#4f8ef7] px-5 py-3 text-[14px] font-semibold text-white hover:bg-[#3d7aee]" onClick={saveAdminPassword}>Cambiar contraseña</button>
                  </PanelCard>
                </>
              ) : null}

              <PanelCard title={currentUser.role === "ADMIN" ? "Crear atención al cliente o jefe de sede" : "Crear atención al cliente de tu sede"}>
                <div className="grid gap-3 md:grid-cols-6">
                  <input className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" placeholder="Nombre completo" value={newUser.name} onChange={(event) => setNewUser((prev) => ({ ...prev, name: event.target.value }))} />
                  <input className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" inputMode="numeric" placeholder="DNI" value={newUser.dni} onChange={(event) => setNewUser((prev) => ({ ...prev, dni: event.target.value }))} />
                  <input className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" placeholder="Usuario" value={newUser.username} onChange={(event) => setNewUser((prev) => ({ ...prev, username: event.target.value }))} />
                  <input className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" placeholder="Contraseña temporal" value={newUser.password} onChange={(event) => setNewUser((prev) => ({ ...prev, password: event.target.value }))} />
                  <select className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" value={newUser.role} onChange={(event) => setNewUser((prev) => ({ ...prev, role: event.target.value as "ADMIN" | "MANAGER" | "EMPLOYEE" }))}>
                    <option value="EMPLOYEE">Atención al cliente</option>
                    {currentUser.role === "ADMIN" ? <option value="MANAGER">Jefe de sede</option> : null}
                    {currentUser.role === "ADMIN" ? <option value="ADMIN">Admin General</option> : null}
                  </select>
                  <select className="rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" value={newUser.sede} onChange={(event) => setNewUser((prev) => ({ ...prev, sede: event.target.value }))}>
                    {["Lince", "Sur", "Norte", "Miraflores"].map((sede) => (
                      <option key={sede} value={sede}>
                        {sede}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="font-display mt-4 rounded-[8px] bg-[#4f8ef7] px-5 py-3 text-[14px] font-semibold text-white hover:bg-[#3d7aee]" onClick={createUser}>{currentUser.role === "ADMIN" ? "Crear usuario" : "Crear atención al cliente"}</button>
              </PanelCard>
              {currentUser.role === "ADMIN" ? <PanelCard title="Grupos de trabajo por DNI">
                <p className="mb-4 text-[13px] text-[#8b92a9]">Los miembros se identifican por DNI. Puedes mover un DNI cortándolo de un grupo y pegándolo en otro; las calificaciones continúan usando el nombre del asesor.</p>
                <div className="grid gap-4 xl:grid-cols-2">
                  {groups.map((group, index) => <div key={`${group.name}-${index}`} className="rounded-[10px] border border-white/10 bg-[#181d2c] p-4">
                    <div className="grid gap-3 md:grid-cols-2"><label className="text-[11px] text-[#8b92a9]">Grupo<input className="mt-1 w-full rounded-[7px] border border-white/12 bg-[#111625] px-3 py-2 text-sm text-white" value={group.name} onChange={(event) => setGroups((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></label><label className="text-[11px] text-[#8b92a9]">DNI de jefe<input className="mt-1 w-full rounded-[7px] border border-white/12 bg-[#111625] px-3 py-2 text-sm text-white" value={group.chiefDni || ""} onChange={(event) => setGroups((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, chiefDni: event.target.value || null } : item))} /></label></div>
                    <label className="mt-3 block text-[11px] text-[#8b92a9]">DNIs de miembros, separados por coma o salto de línea<textarea className="mt-1 min-h-20 w-full rounded-[7px] border border-white/12 bg-[#111625] px-3 py-2 text-sm text-white" value={group.members.map((member) => member.dni).join(", ")} onChange={(event) => { const members = event.target.value.split(/[\s,;]+/).filter(Boolean).map((dni) => ({ dni })); setGroups((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, members } : item)); }} /></label>
                    <button className="mt-3 text-[12px] text-[#f08a94]" onClick={() => setGroups((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Quitar grupo</button>
                  </div>)}
                </div>
                <div className="mt-4 flex flex-wrap gap-3"><button className="rounded-[8px] border border-[#4f8ef7] px-4 py-2 text-sm text-[#87b4ff]" onClick={() => setGroups((items) => [...items, { name: "Nuevo grupo", chiefDni: null, members: [] }])}>+ Agregar grupo</button><button className="font-display rounded-[8px] bg-[#4f8ef7] px-5 py-2 text-sm font-semibold text-white" onClick={saveGroups}>Guardar grupos</button></div>
              </PanelCard> : null}
            </div>
          ) : null}

          {view === "reportes" ? (
            <PanelCard title="Exportar reportes">
              <div className="flex flex-wrap gap-3">
                <button className="font-display rounded-[8px] bg-[#4f8ef7] px-5 py-3 text-[14px] font-semibold text-white hover:bg-[#3d7aee]" onClick={() => exportReport("all")}>
                  Descargar reporte general
                </button>
                <button className="rounded-[8px] border border-[#4f8ef7] px-5 py-3 text-[14px] font-semibold text-[#4f8ef7] hover:bg-[#4f8ef7] hover:text-white" onClick={() => exportReport("user")}>
                  Descargar mi reporte
                </button>
              </div>
            </PanelCard>
          ) : null}
        </section>
      </div>

      {newRecordOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5">
          <div className="w-full max-w-3xl rounded-[16px] border border-white/12 bg-[#1a1f30] p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="font-display text-[16px] font-semibold">{editingRecord ? "Editar registro" : "Nuevo registro"}</h3>
                <p className="text-sm text-[#8b92a9]">Cliente, operación, plataforma y estado de aprobación.</p>
              </div>
              <button className="rounded-[8px] border border-white/12 px-4 py-2 text-sm text-[#8b92a9] hover:bg-[#181d2c] hover:text-[#e8ecf4]" onClick={() => setNewRecordOpen(false)}>
                Cerrar
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.3px] text-[#8b92a9]">Nombre del cliente</span>
                <input className="w-full rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3 disabled:opacity-70" value={recordForm.clientName} disabled={!!editingRecord} onChange={(event) => setRecordForm((prev) => ({ ...prev, clientName: event.target.value }))} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.3px] text-[#8b92a9]">DNI</span>
                <input className="w-full rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3 disabled:opacity-70" value={recordForm.dni} disabled={!!editingRecord} onChange={(event) => setRecordForm((prev) => ({ ...prev, dni: event.target.value }))} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.3px] text-[#8b92a9]">Fecha de registro</span>
                <input className="w-full rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3 disabled:opacity-70" type="date" value={recordForm.registrationDate} disabled={!!editingRecord} onChange={(event) => setRecordForm((prev) => ({ ...prev, registrationDate: event.target.value }))} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.3px] text-[#8b92a9]">Tipo</span>
                <select className="w-full rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" value={recordForm.type} onChange={(event) => setRecordForm((prev) => ({ ...prev, type: event.target.value as "REGISTRO" | "OPERACION", operationDate: event.target.value === "REGISTRO" ? "" : prev.operationDate }))}>
                  <option value="REGISTRO">Registro</option>
                  <option value="OPERACION">Operación</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.3px] text-[#8b92a9]">Fecha de operación</span>
                <input className="w-full rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" type="date" value={recordForm.operationDate} onChange={(event) => setRecordForm((prev) => ({ ...prev, operationDate: event.target.value, type: event.target.value ? "OPERACION" : prev.type }))} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.3px] text-[#8b92a9]">Dónde se subió</span>
                <select className="w-full rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" value={recordForm.uploadPlatform} onChange={(event) => setRecordForm((prev) => ({ ...prev, uploadPlatform: event.target.value as "WEB" | "DRIVE" }))}>
                  <option value="WEB">Página web</option>
                  <option value="DRIVE">Drive</option>
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.3px] text-[#8b92a9]">Notas</span>
                <textarea className="min-h-28 w-full rounded-[8px] border border-white/12 bg-[#181d2c] px-4 py-3" value={recordForm.notes} onChange={(event) => setRecordForm((prev) => ({ ...prev, notes: event.target.value }))} />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button className="rounded-[8px] border border-white/12 px-5 py-3 text-sm text-[#8b92a9] hover:bg-[#181d2c] hover:text-[#e8ecf4]" onClick={() => setNewRecordOpen(false)}>
                Cancelar
              </button>
              <button className="font-display rounded-[8px] bg-[#4f8ef7] px-5 py-3 text-sm font-semibold text-white hover:bg-[#3d7aee] disabled:opacity-60" disabled={saving} onClick={saveRecord}>
                {saving ? "Guardando..." : "Guardar registro"}
              </button>
            </div>

            {editingRecord && (currentUser.role === "ADMIN" || currentUser.role === "MANAGER") && editingRecord.pendingApproval ? (
              <div className="mt-4 flex flex-wrap justify-end gap-3 border-t border-white/8 pt-4">
                <button className="rounded-[8px] border border-[rgba(34,201,122,0.25)] px-5 py-2.5 text-sm font-semibold text-[#22c97a] hover:bg-[rgba(34,201,122,0.12)]" onClick={() => performDecision(editingRecord.id, "validate")}>
                  Validar
                </button>
                <button className="rounded-[8px] border border-[rgba(239,68,68,0.3)] px-5 py-2.5 text-sm font-semibold text-[#ef4444] hover:bg-[rgba(239,68,68,0.1)]" onClick={() => performDecision(editingRecord.id, "reject")}>
                  Rechazar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "green" | "amber" | "red";
}) {
  const colors = {
    green: "text-[#22c97a]",
    amber: "text-[#f5a623]",
    red: "text-[#ef4444]",
  };

  return (
    <article className="rounded-[12px] border border-white/8 bg-[#1a1f30] p-5">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-[#555e75]">{label}</div>
      <div className={`font-display text-[26px] font-bold leading-none ${colors[tone]}`}>{value}</div>
      <div className="mt-1.5 text-[11px] text-[#555e75]">{sub}</div>
    </article>
  );
}

function PanelCard({
  title,
  subtitle,
  headerActions,
  children,
}: {
  title: string;
  subtitle?: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-white/8 bg-[#1a1f30]">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/8 px-5 py-4">
        <div className="min-w-[160px] flex-1">
          <h2 className="font-display text-[14px] font-semibold">{title}</h2>
          {subtitle ? <p className="mt-1 text-[13px] text-[#8b92a9]">{subtitle}</p> : null}
        </div>
        {headerActions ? <div className="flex flex-wrap gap-3">{headerActions}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function AlertCard({
  title,
  count,
  items,
  tone,
}: {
  title: string;
  count: number;
  items: ApiRecord[];
  tone: "amber" | "red" | "rose";
}) {
  const className =
    tone === "amber"
      ? "border-[rgba(245,166,35,0.2)] bg-[rgba(245,166,35,0.08)]"
      : tone === "red"
        ? "border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)]"
        : "border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.06)]";

  return (
    <article className={`rounded-[12px] border p-5 ${className}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[#e8ecf4]">{title}</div>
      <div className="font-display mt-2 text-4xl font-bold">{count}</div>
      <div className="mt-4 space-y-3 text-sm">
        {items.length ? (
          items.slice(0, 6).map((item) => (
            <div key={item.id} className="rounded-[8px] bg-black/15 px-4 py-3">
              <div className="font-medium">{item.clientName}</div>
              <div className="text-xs text-white/70">
                {item.dni} · {item.user.name}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-[8px] bg-black/10 px-4 py-3 text-white/70">Sin registros en esta categoría.</div>
        )}
      </div>
    </article>
  );
}
