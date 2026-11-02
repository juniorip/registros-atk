from __future__ import annotations

import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date as dt_date
from datetime import datetime, time
from pathlib import Path
from typing import Iterable

from openpyxl import load_workbook


ENTRY_TIME = time(9, 0)
EXIT_TIME = time(18, 0)
MIDDAY_CUTOFF = time(13, 0)
ENTRY_TOLERANCE_MINUTES = 5
DUPLICATE_PUNCH_THRESHOLD_SECONDS = 120
ROLE_DEFAULTS = {
    "Jefe de Pagos": 3000.0,
    "Encargado de Pagos": 2000.0,
    "Jefe de Sede": 1500.0,
    "Personal Registro": 1250.0,
    "Facturacion": 1500.0,
    "Marketing": 0.0,
    "Sin definir": 0.0,
}


@dataclass
class AttendanceDay:
    person_id: str
    person_name: str
    department: str
    date: str
    punches: list[str]
    entry_time: str | None
    exit_time: str | None
    entry_status: str
    exit_status: str
    late_minutes: int
    early_leave_minutes: int
    overtime_minutes: int
    status: str


def minutes_since_midnight(value: time) -> int:
    return value.hour * 60 + value.minute


def format_time(dt: datetime | None) -> str | None:
    if not dt:
        return None
    return dt.strftime("%H:%M:%S")


def format_minutes(total: int) -> str:
    hours, minutes = divmod(abs(total), 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    return f"{minutes} min"


def normalize(text: str | None) -> str:
    return (text or "").strip()


def guess_payroll_role(department: str) -> str:
    dept = normalize(department).upper()
    if "AREA PAGOS" in dept:
        return "Encargado de Pagos"
    if "MARKETING" in dept:
        return "Marketing"
    if "FACTUR" in dept:
        return "Facturacion"
    if "ATENCION AL CLIENTE" in dept:
        return "Personal Registro"
    return "Sin definir"


def iter_punch_rows(path: Path) -> tuple[str, list[dict[str, object]]]:
    workbook = load_workbook(path, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    rows = list(sheet.iter_rows(values_only=True))

    if len(rows) < 3:
        return workbook.sheetnames[0], []

    headers = list(rows[1])
    data_rows: list[dict[str, object]] = []
    for values in rows[2:]:
        row = {str(headers[i]): values[i] for i in range(len(headers))}
        punch_time = row.get("Punch Time")
        if not isinstance(punch_time, datetime):
            continue
        data_rows.append(row)

    return workbook.sheetnames[0], data_rows


def parse_total_punch_record(value: object) -> list[time]:
    if isinstance(value, time):
        return [value]
    if isinstance(value, datetime):
        return [value.time()]
    text = normalize(str(value))
    if not text or text.lower() == "none":
        return []

    punches: list[time] = []
    for part in [segment.strip() for segment in text.split(",")]:
        if not part:
            continue
        for pattern in ("%H:%M:%S", "%H:%M"):
            try:
                punches.append(datetime.strptime(part, pattern).time())
                break
            except ValueError:
                continue
    return punches


def iter_total_punch_rows(path: Path) -> tuple[str, list[dict[str, object]]]:
    workbook = load_workbook(path, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    rows = list(sheet.iter_rows(values_only=True))

    if len(rows) < 3:
        return workbook.sheetnames[0], []

    headers = list(rows[1])
    data_rows: list[dict[str, object]] = []
    for values in rows[2:]:
        row = {str(headers[i]): values[i] for i in range(len(headers))}
        row_date = row.get("Date")
        if not isinstance(row_date, datetime):
            continue
        punches = parse_total_punch_record(row.get("Punch Records"))
        if not punches:
            continue
        data_rows.append(
            {
                "Person ID": row.get("Person ID"),
                "Person Name": row.get("Person Name"),
                "Department": row.get("Department"),
                "Date": row_date,
                "Punches": punches,
            }
        )

    return workbook.sheetnames[0], data_rows


def resolve_entry_exit(punches: list[datetime]) -> tuple[datetime | None, datetime | None]:
    if not punches:
        return None, None
    if len(punches) == 1:
        only = punches[0]
        return (only, None) if only.time() <= MIDDAY_CUTOFF else (None, only)
    return punches[0], punches[-1]


def collapse_duplicate_punches(punches: list[datetime]) -> list[datetime]:
    if not punches:
        return []
    punches = sorted(punches)
    collapsed = [punches[0]]
    for punch in punches[1:]:
        previous = collapsed[-1]
        delta_seconds = abs((punch - previous).total_seconds())
        if delta_seconds <= DUPLICATE_PUNCH_THRESHOLD_SECONDS:
            continue
        collapsed.append(punch)
    return collapsed


def summarize_day(
    person_id: str,
    person_name: str,
    department: str,
    day: str,
    punches: list[datetime],
) -> AttendanceDay:
    punches = collapse_duplicate_punches(punches)
    entry_dt, exit_dt = resolve_entry_exit(punches)

    late_minutes = 0
    early_leave_minutes = 0
    overtime_minutes = 0

    if entry_dt:
      late_minutes = max(
          0,
          minutes_since_midnight(entry_dt.time())
          - (minutes_since_midnight(ENTRY_TIME) + ENTRY_TOLERANCE_MINUTES),
      )
    if exit_dt:
      early_leave_minutes = max(0, minutes_since_midnight(EXIT_TIME) - minutes_since_midnight(exit_dt.time()))
      overtime_minutes = max(0, minutes_since_midnight(exit_dt.time()) - minutes_since_midnight(EXIT_TIME))

    if entry_dt:
        entry_status = "Tarde" if late_minutes > 0 else "A tiempo"
    else:
        entry_status = "Sin entrada"

    if exit_dt:
        if early_leave_minutes > 0:
            exit_status = "Salida anticipada"
        elif overtime_minutes > 0:
            exit_status = "Salida extendida"
        else:
            exit_status = "A tiempo"
    else:
        exit_status = "Sin salida"

    if entry_dt and exit_dt:
        status = "Completo"
    elif entry_dt and not exit_dt:
        status = "Falta salida"
    elif not entry_dt and exit_dt:
        status = "Falta entrada"
    else:
        status = "Sin marcajes"

    return AttendanceDay(
        person_id=person_id,
        person_name=person_name,
        department=department,
        date=day,
        punches=[p.strftime("%H:%M:%S") for p in punches],
        entry_time=format_time(entry_dt),
        exit_time=format_time(exit_dt),
        entry_status=entry_status,
        exit_status=exit_status,
        late_minutes=late_minutes,
        early_leave_minutes=early_leave_minutes,
        overtime_minutes=overtime_minutes,
        status=status,
    )


def build_payload(path: Path) -> dict[str, object]:
    workbook = load_workbook(path, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    rows = list(sheet.iter_rows(values_only=True))
    headers = {str(value) for value in rows[1]} if len(rows) > 1 else set()

    if "Punch Time" in headers:
        sheet_name, raw_rows = iter_punch_rows(path)
        grouped: dict[tuple[str, str], list[datetime]] = defaultdict(list)
        person_meta: dict[str, dict[str, str]] = {}

        for row in raw_rows:
            person_id = normalize(str(row["Person ID"]))
            person_name = normalize(str(row["Person Name"]))
            department = normalize(str(row["Department"]))
            punch_time = row["Punch Time"]
            assert isinstance(punch_time, datetime)
            day = punch_time.strftime("%Y-%m-%d")
            grouped[(person_id, day)].append(punch_time)
            person_meta[person_id] = {
                "personId": person_id,
                "personName": person_name,
                "department": department,
            }
    elif "Punch Records" in headers and "Date" in headers:
        sheet_name, raw_rows = iter_total_punch_rows(path)
        grouped = defaultdict(list)
        person_meta = {}

        for row in raw_rows:
            person_id = normalize(str(row["Person ID"]))
            person_name = normalize(str(row["Person Name"]))
            department = normalize(str(row["Department"]))
            row_date = row["Date"]
            assert isinstance(row_date, datetime)
            day = row_date.strftime("%Y-%m-%d")
            punches = row["Punches"]
            assert isinstance(punches, list)
            for punch in punches:
                grouped[(person_id, day)].append(datetime.combine(row_date.date(), punch))
            person_meta[person_id] = {
                "personId": person_id,
                "personName": person_name,
                "department": department,
            }
    else:
        raise ValueError("El Excel no tiene un formato de asistencia compatible. Debe incluir 'Punch Time' o 'Punch Records'.")

    attendance_days: list[AttendanceDay] = []
    for (person_id, day), punches in grouped.items():
        meta = person_meta[person_id]
        attendance_days.append(
            summarize_day(
                person_id=person_id,
                person_name=meta["personName"],
                department=meta["department"],
                day=day,
                punches=punches,
            )
        )

    attendance_days.sort(key=lambda item: (item.date, item.person_name.lower()), reverse=True)

    per_person: dict[str, dict[str, object]] = {}
    late_entries = 0
    early_leaves = 0
    missing_entries = 0
    missing_exits = 0
    complete_days = 0

    for item in attendance_days:
        if item.late_minutes > 0:
            late_entries += 1
        if item.early_leave_minutes > 0:
            early_leaves += 1
        if item.entry_time is None:
            missing_entries += 1
        if item.exit_time is None:
            missing_exits += 1
        if item.entry_time and item.exit_time:
            complete_days += 1

        person = per_person.setdefault(
            item.person_id,
            {
                "personId": item.person_id,
                "personName": item.person_name,
                "department": item.department,
                "totalDays": 0,
                "completeDays": 0,
                "lateEntries": 0,
                "missingEntries": 0,
                "missingExits": 0,
                "earlyLeaves": 0,
                "totalLateMinutes": 0,
                "totalEarlyLeaveMinutes": 0,
                "days": [],
            },
        )
        person["totalDays"] += 1
        person["completeDays"] += 1 if item.entry_time and item.exit_time else 0
        person["lateEntries"] += 1 if item.late_minutes > 0 else 0
        person["missingEntries"] += 1 if item.entry_time is None else 0
        person["missingExits"] += 1 if item.exit_time is None else 0
        person["earlyLeaves"] += 1 if item.early_leave_minutes > 0 else 0
        person["totalLateMinutes"] += item.late_minutes
        person["totalEarlyLeaveMinutes"] += item.early_leave_minutes
        person["days"].append(
            {
                "date": item.date,
                "punches": item.punches,
                "entryTime": item.entry_time,
                "exitTime": item.exit_time,
                "entryStatus": item.entry_status,
                "exitStatus": item.exit_status,
                "lateMinutes": item.late_minutes,
                "lateLabel": format_minutes(item.late_minutes) if item.late_minutes else "0 min",
                "earlyLeaveMinutes": item.early_leave_minutes,
                "earlyLeaveLabel": format_minutes(item.early_leave_minutes)
                if item.early_leave_minutes
                else "0 min",
                "overtimeMinutes": item.overtime_minutes,
                "overtimeLabel": format_minutes(item.overtime_minutes)
                if item.overtime_minutes
                else "0 min",
                "status": item.status,
              }
        )

    people = sorted(
        per_person.values(),
        key=lambda person: (
            -int(person["totalDays"]),
            -int(person["lateEntries"]),
            str(person["personName"]).lower(),
        ),
    )

    all_dates = sorted({day.date for day in attendance_days}, reverse=True)

    if not people:
        raise ValueError("El Excel no trajo marcaciones válidas para importar.")

    return {
        "sourceFile": str(path),
        "sheetName": sheet_name,
        "importedAt": datetime.now().isoformat(timespec="seconds"),
        "schedule": {
        "entry": "09:00",
        "exit": "18:00",
        "singlePunchCutoff": "13:00",
        "entryToleranceMinutes": ENTRY_TOLERANCE_MINUTES,
      },
        "summary": {
            "totalPeople": len(people),
            "totalDays": len(attendance_days),
            "totalPunches": sum(len(day.punches) for day in attendance_days),
            "completeDays": complete_days,
            "lateEntries": late_entries,
            "earlyLeaves": early_leaves,
            "missingEntries": missing_entries,
            "missingExits": missing_exits,
        },
        "availableDates": all_dates,
        "people": people,
        "profiles": [
            {
                "personId": person["personId"],
                "personName": person["personName"],
                "department": person["department"],
                "payrollRole": guess_payroll_role(str(person["department"])),
                "monthlySalary": ROLE_DEFAULTS.get(guess_payroll_role(str(person["department"])), 0.0),
            }
            for person in people
        ],
    }


def main(argv: Iterable[str]) -> int:
    args = list(argv)
    if len(args) < 3:
        print("Uso: import-attendance.py <input.xlsx> <output.json>")
        return 1

    input_path = Path(args[1]).expanduser().resolve()
    output_path = Path(args[2]).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = build_payload(input_path)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Archivo generado: {output_path}")
    print(f"Personas: {payload['summary']['totalPeople']} · Días: {payload['summary']['totalDays']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
