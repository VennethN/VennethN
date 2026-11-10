// Core data model: variables (the "Variable View") and column-oriented case data (the "Data View").

export type VarType = 'numeric' | 'string'
export type Measure = 'scale' | 'ordinal' | 'nominal'
export type Align = 'left' | 'right' | 'center'
export type Role = 'input' | 'target' | 'both' | 'none' | 'partition' | 'split'

/** A value stored in a cell. Numeric system-missing is `null`. */
export type CellValue = number | string | null

export interface ValueLabel {
  value: number | string
  label: string
}

export type MissingSpec =
  | { kind: 'none' }
  | { kind: 'discrete'; values: (number | string)[] }
  | { kind: 'range'; low: number; high: number; value?: number }

export interface Variable {
  /** Stable internal id (survives renames). */
  id: string
  name: string
  type: VarType
  /** Display width in characters (string variables: maximum length). */
  width: number
  /** Decimal places shown for numeric variables. */
  decimals: number
  label: string
  valueLabels: ValueLabel[]
  missing: MissingSpec
  /** Column width in the Data View, in characters. */
  columns: number
  align: Align
  measure: Measure
  role: Role
}

export interface Dataset {
  name: string
  fileName: string | null
  variables: Variable[]
  /** Column data keyed by variable id. Numeric columns hold numbers/null, string columns hold strings. */
  data: Record<string, CellValue[]>
  nCases: number
  /** Variable id used by FILTER BY (cases with 0 or missing are excluded), or null. */
  filterVarId: string | null
  /** Variable id used by WEIGHT BY, or null. */
  weightVarId: string | null
}

let idCounter = 0
export function newVarId(): string {
  idCounter += 1
  return `v${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function createVariable(name: string, init: Partial<Omit<Variable, 'id' | 'name'>> = {}): Variable {
  const type = init.type ?? 'numeric'
  return {
    id: newVarId(),
    name,
    type,
    width: init.width ?? 8,
    decimals: init.decimals ?? (type === 'numeric' ? 2 : 0),
    label: init.label ?? '',
    valueLabels: init.valueLabels ?? [],
    missing: init.missing ?? { kind: 'none' },
    columns: init.columns ?? Math.max(8, Math.min(32, init.width ?? 8)),
    align: init.align ?? (type === 'numeric' ? 'right' : 'left'),
    measure: init.measure ?? (type === 'numeric' ? 'scale' : 'nominal'),
    role: init.role ?? 'input',
  }
}

export function emptyDataset(name = 'DataSet1'): Dataset {
  return { name, fileName: null, variables: [], data: {}, nCases: 0, filterVarId: null, weightVarId: null }
}

/** Build a dataset from variables and row-oriented or column-oriented values. */
export function datasetFromColumns(variables: Variable[], columns: CellValue[][], name = 'DataSet1'): Dataset {
  const nCases = columns.reduce((m, c) => Math.max(m, c.length), 0)
  const data: Record<string, CellValue[]> = {}
  variables.forEach((v, i) => {
    const col = columns[i] ?? []
    const out: CellValue[] = new Array(nCases)
    for (let r = 0; r < nCases; r++) out[r] = normalizeCell(v, col[r] ?? null)
    data[v.id] = out
  })
  return { name, fileName: null, variables, data, nCases, filterVarId: null, weightVarId: null }
}

export function normalizeCell(v: Variable, value: CellValue): CellValue {
  if (v.type === 'string') {
    if (value === null || value === undefined) return ''
    return String(value)
  }
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const n = parseNumber(value)
  return n
}

/** Parse user-typed numeric text. Accepts leading/trailing spaces and a decimal comma when unambiguous. */
export function parseNumber(text: string): number | null {
  const t = text.trim()
  if (t === '' || t === '.') return null
  let n = Number(t)
  if (Number.isFinite(n)) return n
  if (/^[+-]?\d+,\d+$/.test(t)) {
    n = Number(t.replace(',', '.'))
    if (Number.isFinite(n)) return n
  }
  return null
}

export function getVar(ds: Dataset, nameOrId: string): Variable | undefined {
  const lower = nameOrId.toLowerCase()
  return ds.variables.find((v) => v.id === nameOrId) ?? ds.variables.find((v) => v.name.toLowerCase() === lower)
}

export function varIndex(ds: Dataset, id: string): number {
  return ds.variables.findIndex((v) => v.id === id)
}

/** Whether a value is a user-defined missing value for the variable (system-missing is checked separately). */
export function isUserMissing(v: Variable, value: CellValue): boolean {
  const m = v.missing
  if (m.kind === 'none' || value === null) return false
  if (m.kind === 'discrete') {
    if (v.type === 'string') {
      const s = String(value).trimEnd()
      return m.values.some((x) => String(x).trimEnd() === s)
    }
    return m.values.some((x) => Number(x) === value)
  }
  if (typeof value !== 'number') return false
  if (value >= m.low && value <= m.high) return true
  return m.value !== undefined && m.value === value
}

export function isSysMissing(v: Variable, value: CellValue): boolean {
  return v.type === 'numeric' && (value === null || (typeof value === 'number' && Number.isNaN(value)))
}

export function isMissing(v: Variable, value: CellValue): boolean {
  return isSysMissing(v, value) || isUserMissing(v, value)
}

export function valueLabelFor(v: Variable, value: CellValue): string | undefined {
  if (value === null) return undefined
  if (v.type === 'string') {
    const s = String(value).trimEnd()
    return v.valueLabels.find((l) => String(l.value).trimEnd() === s)?.label
  }
  return v.valueLabels.find((l) => Number(l.value) === value)?.label
}

/** Name shown in output and dialogs: the label when present, otherwise the name. */
export function varTitle(v: Variable): string {
  return v.label ? v.label : v.name
}

const RESERVED = new Set(['ALL', 'AND', 'BY', 'EQ', 'GE', 'GT', 'LE', 'LT', 'NE', 'NOT', 'OR', 'TO', 'WITH'])

export function validateVarName(name: string, ds?: Dataset, selfId?: string): string | null {
  if (!name) return 'Variable name cannot be empty.'
  if (name.length > 64) return 'Variable names cannot exceed 64 characters.'
  if (!/^[A-Za-z@#$À-￿][A-Za-z0-9_.@#$À-￿]*$/.test(name))
    return 'Variable names must begin with a letter and may contain letters, digits, ".", "_", "@", "#" and "$".'
  if (name.endsWith('.') || name.endsWith('_')) return 'Variable names cannot end with a period or underscore.'
  if (RESERVED.has(name.toUpperCase())) return `"${name}" is a reserved word.`
  if (ds) {
    const lower = name.toLowerCase()
    if (ds.variables.some((v) => v.id !== selfId && v.name.toLowerCase() === lower)) return `A variable named "${name}" already exists.`
  }
  return null
}

/** Next free default name like VAR00001. */
export function nextDefaultVarName(ds: Dataset, prefix = 'VAR'): string {
  const used = new Set(ds.variables.map((v) => v.name.toUpperCase()))
  for (let i = 1; ; i++) {
    const name = `${prefix}${String(i).padStart(5, '0')}`
    if (!used.has(name.toUpperCase())) return name
  }
}

/** Make a unique name from a base (used for generated variables such as ZRE_1, filter_$). */
export function uniqueVarName(ds: Dataset, base: string): string {
  const used = new Set(ds.variables.map((v) => v.name.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let i = 1; ; i++) {
    const cand = `${base}_${i}`
    if (!used.has(cand.toLowerCase())) return cand
  }
}

/** Generated-variable names that increment a numeric suffix: PRE_1, PRE_2, ... */
export function nextSuffixName(ds: Dataset, prefix: string): string {
  const used = new Set(ds.variables.map((v) => v.name.toLowerCase()))
  for (let i = 1; ; i++) {
    const cand = `${prefix}_${i}`
    if (!used.has(cand.toLowerCase())) return cand
  }
}

// ---------------------------------------------------------------------------------------------
// Immutable dataset edits. Each returns a new Dataset sharing untouched columns.

export function setCell(ds: Dataset, varId: string, row: number, value: CellValue): Dataset {
  const v = ds.variables.find((x) => x.id === varId)
  if (!v) return ds
  let next = ds
  if (row >= ds.nCases) next = insertCases(ds, ds.nCases, row - ds.nCases + 1)
  const col = next.data[varId].slice()
  col[row] = normalizeCell(v, value)
  return { ...next, data: { ...next.data, [varId]: col } }
}

export function insertCases(ds: Dataset, at: number, count = 1): Dataset {
  const data: Record<string, CellValue[]> = {}
  for (const v of ds.variables) {
    const col = ds.data[v.id].slice()
    const fill: CellValue[] = new Array(count).fill(v.type === 'string' ? '' : null)
    col.splice(at, 0, ...fill)
    data[v.id] = col
  }
  return { ...ds, data, nCases: ds.nCases + count }
}

export function deleteCases(ds: Dataset, rows: number[]): Dataset {
  const drop = new Set(rows)
  const data: Record<string, CellValue[]> = {}
  for (const v of ds.variables) data[v.id] = ds.data[v.id].filter((_, i) => !drop.has(i))
  return { ...ds, data, nCases: ds.nCases - [...drop].filter((r) => r < ds.nCases).length }
}

export function insertVariable(ds: Dataset, at: number, variable?: Variable, values?: CellValue[]): Dataset {
  const v = variable ?? createVariable(nextDefaultVarName(ds))
  const vars = ds.variables.slice()
  vars.splice(at, 0, v)
  const col: CellValue[] = new Array(ds.nCases)
  for (let r = 0; r < ds.nCases; r++) col[r] = values ? normalizeCell(v, values[r] ?? null) : v.type === 'string' ? '' : null
  return { ...ds, variables: vars, data: { ...ds.data, [v.id]: col } }
}

export function deleteVariables(ds: Dataset, ids: string[]): Dataset {
  const drop = new Set(ids)
  const data = { ...ds.data }
  for (const id of ids) delete data[id]
  return {
    ...ds,
    variables: ds.variables.filter((v) => !drop.has(v.id)),
    data,
    filterVarId: ds.filterVarId && drop.has(ds.filterVarId) ? null : ds.filterVarId,
    weightVarId: ds.weightVarId && drop.has(ds.weightVarId) ? null : ds.weightVarId,
  }
}

/** Update variable properties. Changing the type converts the stored column. */
export function updateVariable(ds: Dataset, id: string, patch: Partial<Variable>): Dataset {
  const idx = ds.variables.findIndex((v) => v.id === id)
  if (idx < 0) return ds
  const old = ds.variables[idx]
  const updated: Variable = { ...old, ...patch, id: old.id }
  const vars = ds.variables.slice()
  vars[idx] = updated
  let data = ds.data
  if (patch.type && patch.type !== old.type) {
    const col = ds.data[id]
    let converted: CellValue[]
    if (patch.type === 'string') {
      converted = col.map((x) => (x === null ? '' : formatPlain(x as number, old.decimals)))
      updated.decimals = 0
      updated.align = 'left'
      updated.measure = 'nominal'
      const maxLen = converted.reduce<number>((m, s) => Math.max(m, String(s).length), 1)
      updated.width = Math.max(patch.width ?? 8, maxLen)
      updated.valueLabels = old.valueLabels.map((l) => ({ ...l, value: String(l.value) }))
      updated.missing = { kind: 'none' }
    } else {
      converted = col.map((x) => (typeof x === 'string' ? parseNumber(x) : x))
      updated.align = 'right'
      updated.decimals = patch.decimals ?? 2
      updated.measure = 'scale'
      updated.valueLabels = old.valueLabels
        .map((l) => ({ ...l, value: parseNumber(String(l.value)) as number }))
        .filter((l) => l.value !== null)
      updated.missing = { kind: 'none' }
    }
    data = { ...ds.data, [id]: converted }
  } else if (updated.type === 'string' && patch.width !== undefined && patch.width < old.width) {
    data = { ...ds.data, [id]: ds.data[id].map((s) => String(s ?? '').slice(0, patch.width)) }
  }
  return { ...ds, variables: vars, data }
}

export function moveVariable(ds: Dataset, from: number, to: number): Dataset {
  const vars = ds.variables.slice()
  const [v] = vars.splice(from, 1)
  vars.splice(to, 0, v)
  return { ...ds, variables: vars }
}

function formatPlain(x: number, decimals: number): string {
  return Number.isInteger(x) && decimals === 0 ? String(x) : x.toFixed(decimals)
}

// ---------------------------------------------------------------------------------------------
// Case selection helpers used by procedures.

/** Indices of cases that pass the active filter (FILTER BY). */
export function activeCases(ds: Dataset): number[] {
  const out: number[] = []
  const f = ds.filterVarId ? ds.data[ds.filterVarId] : null
  for (let i = 0; i < ds.nCases; i++) {
    if (f) {
      const x = f[i]
      if (x === null || x === 0 || x === '' || (typeof x === 'number' && Number.isNaN(x))) continue
    }
    out.push(i)
  }
  return out
}

/**
 * Case weights (WEIGHT BY). Returns null when weighting is off.
 * Cases with missing, zero or negative weights get weight 0 and are dropped by procedures.
 */
export function caseWeights(ds: Dataset): (number[] | null) {
  if (!ds.weightVarId) return null
  const col = ds.data[ds.weightVarId]
  const v = ds.variables.find((x) => x.id === ds.weightVarId)
  if (!col || !v) return null
  return col.map((x) => (typeof x === 'number' && x > 0 && !isUserMissing(v, x) ? x : 0))
}

/** Numeric value or null if missing (system or user). */
export function numericValue(v: Variable, x: CellValue): number | null {
  if (v.type !== 'numeric') return null
  if (x === null || typeof x !== 'number' || Number.isNaN(x)) return null
  if (isUserMissing(v, x)) return null
  return x
}

export function cloneDataset(ds: Dataset): Dataset {
  const data: Record<string, CellValue[]> = {}
  for (const k of Object.keys(ds.data)) data[k] = ds.data[k].slice()
  return { ...ds, variables: ds.variables.map((v) => ({ ...v, valueLabels: v.valueLabels.slice() })), data }
}
