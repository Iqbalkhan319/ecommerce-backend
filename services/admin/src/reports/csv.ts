export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = neutralise(String(value));
  return /["\n\r,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const UTF8_BOM = '\uFEFF';

export function toCsv<T>(rows: T[], columns: Array<CsvColumn<T>>): string {
  const header = columns.map((column) => escapeCell(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCell(column.value(row))).join(','));
  return `${UTF8_BOM}${[header, ...body].join('\r\n')}\r\n`;
}

export function csvFilename(report: string, from: string, to: string): string {
  const stamp = (value: string) => value.slice(0, 10);
  return `${report}-${stamp(from)}-to-${stamp(to)}.csv`;
}
