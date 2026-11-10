import {
  activeCases,
  caseWeights,
  getVar,
  isMissing,
  isUserMissing,
  type CellValue,
  type Dataset,
  type Variable,
} from '../core/dataset'
import { categoryLabel } from '../core/format'
import type { Footnote, RowNode } from '../core/output'

export class ProcError extends Error {}

export function resolveVar(ds: Dataset, name: string): Variable {
  const v = getVar(ds, name)
  if (!v) throw new ProcError(`Variable "${name}" does not exist in the active dataset.`)
  return v
}

export function resolveVars(ds: Dataset, names: string[]): Variable[] {
  return names.map((n) => resolveVar(ds, n))
}

export function requireNumeric(v: Variable, proc: string): void {
  if (v.type !== 'numeric')
    throw new ProcError(`${proc}: variable "${v.name}" is a string variable. Only numeric variables can be analyzed here.`)
}

const MAX_EXPANDED = 5_000_000

/**
 * Case indices used for analysis: the active (filtered) cases, each repeated by its rounded
 * frequency weight when WEIGHT BY is on. Repetition makes every procedure honor frequency weights.
 */
export function analysisCases(ds: Dataset): number[] {
  const active = activeCases(ds)
  const w = caseWeights(ds)
  if (!w) return active
  const out: number[] = []
  for (const i of active) {
    const k = Math.round(w[i])
    for (let j = 0; j < k; j++) out.push(i)
    if (out.length > MAX_EXPANDED) throw new ProcError('The weighted number of cases is too large to analyze.')
  }
  return out
}

/** Numeric values for cases, null when missing (system or user). */
export function numericColumn(ds: Dataset, v: Variable, cases: number[]): (number | null)[] {
  const col = ds.data[v.id]
  return cases.map((i) => {
    const x = col[i]
    if (typeof x !== 'number' || Number.isNaN(x) || isUserMissing(v, x)) return null
    return x
  })
}

/** Valid (non-missing) numeric values. */
export function validNumbers(ds: Dataset, v: Variable, cases: number[]): number[] {
  const out: number[] = []
  const col = ds.data[v.id]
  for (const i of cases) {
    const x = col[i]
    if (typeof x === 'number' && !Number.isNaN(x) && !isUserMissing(v, x)) out.push(x)
  }
  return out
}

/** Cases with valid values on all variables. */
export function listwiseCases(ds: Dataset, vars: Variable[], cases: number[]): number[] {
  return cases.filter((i) => vars.every((v) => !isMissing(v, ds.data[v.id][i])))
}

export function rawValue(ds: Dataset, v: Variable, i: number): CellValue {
  return ds.data[v.id][i]
}

export function validValue(ds: Dataset, v: Variable, i: number): number | string | null {
  const x = ds.data[v.id][i]
  if (isMissing(v, x)) return null
  if (v.type === 'string') return String(x ?? '')
  return x as number
}

/** Distinct valid category values in sorted order. */
export function categoriesOf(ds: Dataset, v: Variable, cases: number[]): (number | string)[] {
  const set = new Set<number | string>()
  for (const i of cases) {
    const x = validValue(ds, v, i)
    if (x !== null) set.add(v.type === 'string' ? String(x).trimEnd() : x)
  }
  return sortCategories(v, [...set])
}

export function sortCategories(v: Variable, vals: (number | string)[]): (number | string)[] {
  return v.type === 'string'
    ? (vals as string[]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    : (vals as number[]).sort((a, b) => a - b)
}

export function catKey(v: Variable, x: number | string): string {
  return v.type === 'string' ? `s:${String(x).trimEnd()}` : `n:${x}`
}

export function catLabel(v: Variable, x: number | string): string {
  return categoryLabel(v, x)
}

/** Header label for a variable in output tables. */
export function vlabel(v: Variable): string {
  return v.label || v.name
}

/** Parse a group value given in syntax/dialog against a variable type. */
export function matchesGroup(v: Variable, x: number | string | null, g: number | string): boolean {
  if (x === null) return false
  if (v.type === 'string') return String(x).trimEnd() === String(g).trimEnd()
  return x === Number(g)
}

// ------------------------------------------------------------------------- footnotes

/** Assigns footnote letters a, b, c ... in order of first use. */
export class Notes {
  private list: Footnote[] = []
  mark(text: string): string {
    const existing = this.list.find((f) => f.text === text)
    if (existing) return existing.mark
    const mark = String.fromCharCode(97 + this.list.filter((f) => /^[a-z]$/.test(f.mark)).length)
    this.list.push({ mark, text })
    return mark
  }
  symbol(mark: string, text: string): string {
    if (!this.list.find((f) => f.mark === mark)) this.list.push({ mark, text })
    return mark
  }
  get footnotes(): Footnote[] | undefined {
    if (!this.list.length) return undefined
    const sym = this.list.filter((f) => !/^[a-z]$/.test(f.mark))
    const let_ = this.list.filter((f) => /^[a-z]$/.test(f.mark))
    return [...sym, ...let_]
  }
}

export function supJoin(...marks: (string | undefined | false)[]): string | undefined {
  const m = marks.filter(Boolean) as string[]
  return m.length ? m.join(',') : undefined
}

// ------------------------------------------------------------------------- histogram binning

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * p
}

export function histogramBins(values: number[]): { x0: number; x1: number; count: number }[] {
  if (!values.length) return []
  let lo = Infinity
  let hi = -Infinity
  for (const x of values) {
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  const allInt = values.every((x) => Number.isInteger(x))
  let width: number
  let start: number
  const n = values.length
  if (lo === hi) {
    width = 1
    start = lo - 0.5
  } else if (allInt && hi - lo <= 20) {
    width = 1
    start = lo - 0.5
  } else {
    const k = Math.min(30, Math.max(5, Math.ceil(Math.log2(n) + 1)))
    width = niceStep((hi - lo) / k)
    start = Math.floor(lo / width) * width
  }
  const nb = Math.max(1, Math.floor((hi - start) / width + 1e-9) + 1)
  const bins = Array.from({ length: nb }, (_, i) => ({ x0: start + i * width, x1: start + (i + 1) * width, count: 0 }))
  for (const x of values) {
    let b = Math.floor((x - start) / width + 1e-9)
    if (b >= nb) b = nb - 1
    if (b < 0) b = 0
    bins[b].count++
  }
  // trim empty trailing bins
  while (bins.length > 1 && bins[bins.length - 1].count === 0) bins.pop()
  return bins
}

/** Helper to build a row node with value cells. */
export function row(label: string, cells: (string | { text: string; sup?: string })[], sup?: string): RowNode {
  return { label, cells, sup }
}

export function group(label: string, children: RowNode[], sup?: string): RowNode {
  return { label, children, sup }
}
