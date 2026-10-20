// CSV RFC 4180 : champs contenant `,`, `"` ou un saut de ligne entre guillemets (guillemets doublés),
// objets en JSON, null/undefined vides, fins de ligne `\n`.
const field = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return [columns, ...rows.map((r) => columns.map((c) => r[c]))].map((l) => l.map(field).join(',') + '\n').join('')
}
