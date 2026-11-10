// Data-grid helpers shared by the Data View and menus: column widths, typed input parsing,
// block writes (editing / paste) that create variables and cases as needed.

import {
  createVariable,
  insertCases,
  insertVariable,
  nextDefaultVarName,
  parseNumber,
  updateVariable,
  type CellValue,
  type Dataset,
  type Variable,
} from '../../core/dataset'
import { applySort } from '../../transform/transforms'

export interface Pos {
  row: number
  col: number
}

export function colWidthPx(v: Variable): number {
  return Math.max(52, Math.min(400, v.columns * 8 + 18))
}

/** Raw (editable) text of a cell. */
export function rawText(v: Variable, x: CellValue): string {
  if (v.type === 'string') return String(x ?? '')
  if (x === null || typeof x !== 'number' || Number.isNaN(x)) return ''
  return String(x)
}

/** Ensure variables exist up to column `col` (typing into an empty column creates VAR00001 ...). */
export function ensureColumns(ds: Dataset, col: number, firstText?: string): Dataset {
  let next = ds
  while (next.variables.length <= col) {
    const isLast = next.variables.length === col
    const looksString = isLast && firstText !== undefined && firstText.trim() !== '' && parseNumber(firstText) === null
    const v = createVariable(
      nextDefaultVarName(next),
      looksString ? { type: 'string', width: Math.max(8, firstText!.length), measure: 'nominal' } : { type: 'numeric', decimals: 2 },
    )
    next = insertVariable(next, next.variables.length, v)
  }
  return next
}

/** Convert typed text into a stored value; returns an error message for invalid input. */
export function parseCellInput(v: Variable, text: string): { value: CellValue } | { error: string } {
  if (v.type === 'string') return { value: text }
  const t = text.trim()
  if (t === '' || t === '.') return { value: null }
  const n = parseNumber(t)
  if (n !== null) return { value: n }
  const byLabel = v.valueLabels.find((l) => l.label.toLowerCase() === t.toLowerCase())
  if (byLabel) return { value: Number(byLabel.value) }
  return { error: `"${text}" is not a valid number for ${v.name}.` }
}

/** Write a block of values (from paste or editing) starting at a position. */
export function writeBlock(ds: Dataset, at: Pos, rows: string[][]): { ds: Dataset; errors: number } {
  let next = ds
  let errors = 0
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0)
  if (!maxCols) return { ds, errors }
  next = ensureColumns(next, at.col + maxCols - 1, rows[0]?.[0])
  const lastRow = at.row + rows.length - 1
  if (lastRow >= next.nCases) next = insertCases(next, next.nCases, lastRow - next.nCases + 1)
  const cols: Record<string, CellValue[]> = {}
  for (let j = 0; j < maxCols; j++) {
    let v = next.variables[at.col + j]
    // widen string variables when needed
    const maxLen = Math.max(...rows.map((r) => (r[j] ?? '').length))
    if (v.type === 'string' && maxLen > v.width) {
      next = updateVariable(next, v.id, { width: maxLen })
      v = next.variables[at.col + j]
    }
    const col = next.data[v.id].slice()
    rows.forEach((r, i) => {
      if (j >= r.length) return
      const p = parseCellInput(v, r[j])
      if ('error' in p) errors++
      else col[at.row + i] = p.value
    })
    cols[v.id] = col
  }
  return { ds: { ...next, data: { ...next.data, ...cols } }, errors }
}

/** Helpers exposed for menus (Insert Variable / Insert Cases at the active position). */
export function insertVariableAtEnd(ds: Dataset): Dataset {
  return insertVariable(ds, ds.variables.length)
}

export function sortDataset(ds: Dataset, name: string, descending: boolean): Dataset {
  return applySort(ds, { proc: 'sort', keys: [{ variable: name, descending }] })
}
