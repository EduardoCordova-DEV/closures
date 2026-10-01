export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "1900-01-01" &&
    value <= "9999-12-31" && dateKey(parseDate(value)) === value;
}

export function addDays(value: string, amount: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

export function daysBetween(start: string, end: string): number {
  if (!isDate(start) || !isDate(end)) throw new RangeError("Las fechas no son validas.");
  // Compare calendar dates in UTC so daylight-saving changes never add or remove a day.
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
}

export function weekStart(value = dateKey()): string {
  const date = parseDate(value);
  return addDays(value, -((date.getDay() + 6) % 7));
}

export function weekEnd(start: string): string {
  return addDays(start, 4);
}

export function isWorkday(value: string): boolean {
  if (!isDate(value)) return false;
  const day = parseDate(value).getDay();
  return day >= 1 && day <= 5;
}

export function inWeek(value: string | null, start: string): boolean {
  return value !== null && value >= start && value <= weekEnd(start);
}

export function formatDate(value: string, year = false): string {
  return parseDate(value).toLocaleDateString("es-MX", {
    day: "2-digit", month: "short", ...(year ? { year: "numeric" } : {})
  }).replace(".", "");
}

export function weekLabel(start: string): string {
  return `${formatDate(start)} \u2014 ${formatDate(weekEnd(start), true)}`;
}
