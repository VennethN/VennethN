// CSV / TSV import with delimiter, decimal-comma and type detection; export with optional value labels.

import {
  createVariable,
  datasetFromColumns,
  validateVarName,
  type CellValue,
  type Dataset,
  type Variable,
} from '../core/dataset'
import { formatCell } from '../core/format'

export interface CsvOptions {
  delimiter?: ',' | ';' | '\t' | '|' | 'auto'
  header?: boolean
  decimal?: '.' | ',' | 'auto'
}

/** RFC 4180-style parser (quotes, doubled quotes, CRLF, quoted newlines). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let inQuotes = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  while (i < src.length) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') {
      inQuotes = true
      i++
      continue
    }
    if (c === delimiter) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\r' || c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (c === '\r' && src[i + 1] === '\n') i++
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  // drop trailing empty lines
  while (rows.length && rows[rows.length - 1].every((f) => f.trim() === '')) rows.pop()
  return rows
}

export function detectDelimiter(text: string): ',' | ';' | '\t' | '|' {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n')
  const cands: (',' | ';' | '\t' | '|')[] = [',', ';', '\t', '|']
  let best: ',' | ';' | '\t' | '|' = ','
  let bestScore = -1
  for (const d of cands) {
    const rows = parseDelimited(sample, d).slice(0, 15)
    if (!rows.length) continue
    const counts = rows.map((r) => r.length)
    const first = counts[0]
    if (first < 2) continue
    const consistent = counts.filter((c) => c === first).length / counts.length
    const score = first * consistent
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

function parseNum(s: string, decimal: '.' | ','): number | null {
  let t = s.trim()
  if (t === '') return null
  if (decimal === ',') t = t.replace(/\./g, '').replace(',', '.')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Make a valid, unique variable name from a header label. */
export function sanitizeName(raw: string, used: Set<string>, index: number): string {
  let name = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[^A-Za-z0-9_.@#$]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!name || !/^[A-Za-z@#$]/.test(name)) name = name ? `V${name}` : `VAR${String(index + 1).padStart(5, '0')}`
  name = name.replace(/[._]+$/, '').slice(0, 64)
  if (validateVarName(name)) name = `V_${name}`.slice(0, 64)
  let cand = name
  let k = 1
  while (used.has(cand.toLowerCase())) cand = `${name}_${k++}`
  used.add(cand.toLowerCase())
  return cand
}

const MISSING_TOKENS = new Set(['', 'NA', 'N/A', 'NaN', 'nan', 'null', 'NULL', '.', '#N/A'])

export function datasetFromCSV(text: string, opts: CsvOptions = {}, fileName?: string): Dataset {
  const delimiter = !opts.delimiter || opts.delimiter === 'auto' ? detectDelimiter(text) : opts.delimiter
  const rows = parseDelimited(text, delimiter)
  if (!rows.length) throw new Error('The file is empty.')
  const header = opts.header ?? true
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
  const head = header ? rows[0] : []
  const body = header ? rows.slice(1) : rows
  // decimal separator: comma when ';' delimited and comma decimals appear, or when explicitly set
  let decimal: '.' | ',' = '.'
  if (opts.decimal === ',') decimal = ','
  else if (opts.decimal !== '.' && delimiter !== ',') {
    const sample = body.slice(0, 200).flat()
    const commaNums = sample.filter((s) => /^[+-]?\d+,\d+$/.test(s.trim())).length
    const dotNums = sample.filter((s) => /^[+-]?\d+\.\d+$/.test(s.trim())).length
    if (commaNums > dotNums) decimal = ','
  }
  const used = new Set<string>()
  const vars: Variable[] = []
  const cols: CellValue[][] = []
  for (let j = 0; j < width; j++) {
    const rawCol = body.map((r) => r[j] ?? '')
    const nonEmpty = rawCol.filter((s) => !MISSING_TOKENS.has(s.trim()))
    const nums = nonEmpty.map((s) => parseNum(s, decimal))
    const numeric = nonEmpty.length > 0 && nums.every((x) => x !== null)
    const label = (head[j] ?? '').trim()
    const name = sanitizeName(label, used, j)
    if (numeric) {
      const values = rawCol.map((s) => (MISSING_TOKENS.has(s.trim()) ? null : parseNum(s, decimal)))
      const valid = values.filter((x): x is number => x !== null)
      const decimals = Math.min(
        6,
        valid.reduce((m, x) => {
          const s = String(x)
          const k = s.includes('.') && !s.includes('e') ? s.split('.')[1].length : 0
          return Math.max(m, k)
        }, 0),
      )
      const distinct = new Set(valid).size
      const allInt = valid.every((x) => Number.isInteger(x))
      vars.push(
        createVariable(name, {
          type: 'numeric',
          decimals,
          width: Math.max(8, ...valid.slice(0, 1000).map((x) => String(x).length)),
          label: label && label !== name ? label : '',
          measure: allInt && distinct < 24 ? 'nominal' : 'scale',
        }),
      )
      cols.push(values)
    } else {
      const w = Math.max(1, ...rawCol.map((s) => s.length))
      vars.push(
        createVariable(name, {
          type: 'string',
          width: Math.min(32767, w),
          label: label && label !== name ? label : '',
          measure: 'nominal',
          columns: Math.min(32, Math.max(8, w)),
        }),
      )
      cols.push(rawCol.map((s) => (MISSING_TOKENS.has(s.trim()) && s.trim() !== '' ? '' : s)))
    }
  }
  const ds = datasetFromColumns(vars, cols)
  ds.fileName = fileName ?? null
  return ds
}

function csvField(s: string, delimiter: string): string {
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function datasetToCSV(ds: Dataset, opts: { delimiter?: string; valueLabels?: boolean } = {}): string {
  const d = opts.delimiter ?? ','
  const lines = [ds.variables.map((v) => csvField(v.name, d)).join(d)]
  for (let r = 0; r < ds.nCases; r++) {
    lines.push(
      ds.variables
        .map((v) => {
          const x = ds.data[v.id][r]
          if (v.type === 'numeric') {
            if (x === null) return ''
            if (opts.valueLabels) {
              const l = formatCell(v, x, true)
              if (l !== formatCell(v, x, false)) return csvField(l, d)
            }
            return String(x)
          }
          return csvField(opts.valueLabels ? formatCell(v, x, true) : String(x ?? ''), d)
        })
        .join(d),
    )
  }
  return lines.join('\r\n') + '\r\n'
}
