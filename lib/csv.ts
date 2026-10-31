// RFC 4180 quoting, plus: a cell starting with = + - @ is run as a formula by
// spreadsheets, and this text came from speech, so prefix those with '.
const cell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const toCsv = (columns: string[], rows: string[][]) =>
  [columns, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
