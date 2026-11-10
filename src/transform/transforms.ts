// Data transformations (COMPUTE, RECODE, SORT CASES, SELECT IF, ...) as pure Dataset -> Dataset functions.

import {
  createVariable,
  deleteVariables,
  getVar,
  insertVariable,
  isMissing,
  isSysMissing,
  normalizeCell,
  updateVariable,
  validateVarName,
  type CellValue,
  type Dataset,
  type Variable,
} from '../core/dataset'
import { mulberry32, rank } from '../stats/basic'
import { ProcError } from '../procedures/common'
import type {
  AutoRecodeSpec,
  ComputeSpec,
  RankSpec,
  RecodeOld,
  RecodeSpec,
  SampleSpec,
  SelectIfSpec,
  SortSpec,
} from '../procedures/types'
import { evaluateAll, isStringExpr, parseExpr } from './expr'

function mustVar(ds: Dataset, name: string): Variable {
  const v = getVar(ds, name)
  if (!v) throw new ProcError(`Variable "${name}" does not exist in the active dataset.`)
  return v
}

function ensureNewName(ds: Dataset, name: string): void {
  const err = validateVarName(name, ds)
  if (err) throw new ProcError(err)
}

export function applyCompute(ds: Dataset, spec: ComputeSpec, seed?: number): Dataset {
  const node = parseExpr(spec.expression)
  const values = evaluateAll(ds, spec.expression, seed)
  const cond = spec.condition ? evaluateAll(ds, spec.condition, seed) : null
  let target = getVar(ds, spec.target)
  let next = ds
  if (!target) {
    ensureNewName(ds, spec.target)
    const isStr = spec.stringWidth !== null || isStringExpr(node, ds)
    const width = spec.stringWidth ?? (isStr ? Math.max(8, ...values.map((v) => String(v ?? '').length)) : 8)
    target = createVariable(spec.target, isStr ? { type: 'string', width } : { type: 'numeric', decimals: 2 })
    next = insertVariable(ds, ds.variables.length, target)
  }
  const col = next.data[target.id].slice()
  for (let r = 0; r < next.nCases; r++) {
    if (cond && !(typeof cond[r] === 'number' && cond[r] !== 0)) continue
    const v = values[r]
    if (target.type === 'string') col[r] = (v === null ? '' : String(v)).slice(0, target.width)
    else {
      if (typeof v === 'string') throw new ProcError(`COMPUTE: cannot assign a string value to numeric variable ${target.name}.`)
      col[r] = v
    }
  }
  // Widen decimals for computed numeric results that are not integers? Keep F8.2 like SPSS.
  return { ...next, data: { ...next.data, [target.id]: col } }
}

function matchOld(v: Variable, x: CellValue, old: RecodeOld): boolean {
  switch (old.kind) {
    case 'else':
      return true
    case 'sysmis':
      return isSysMissing(v, x)
    case 'missing':
      return isMissing(v, x)
    case 'value':
      if (v.type === 'string') return String(x ?? '').trimEnd() === String(old.value).trimEnd()
      return typeof x === 'number' && x === Number(old.value)
    case 'range':
      return typeof x === 'number' && !isMissing(v, x) && x >= old.low && x <= old.high
    case 'lowest':
      return typeof x === 'number' && !isMissing(v, x) && x <= old.high
    case 'highest':
      return typeof x === 'number' && !isMissing(v, x) && x >= old.low
  }
}

export function applyRecode(ds: Dataset, spec: RecodeSpec): Dataset {
  const sources = spec.variables.map((n) => mustVar(ds, n))
  if (spec.into && spec.into.length !== sources.length)
    throw new ProcError('RECODE: the number of INTO variables must match the number of source variables.')
  let next = ds
  sources.forEach((src, k) => {
    let target: Variable
    let isNew = false
    if (spec.into) {
      const existing = getVar(next, spec.into[k])
      if (existing) target = existing
      else {
        ensureNewName(next, spec.into[k])
        const isStr = spec.intoString !== null
        target = createVariable(spec.into[k], isStr ? { type: 'string', width: spec.intoString! } : { type: 'numeric', decimals: 2 })
        next = insertVariable(next, next.variables.length, target)
        isNew = true
      }
    } else target = src
    const srcCol = next.data[src.id]
    const col = next.data[target.id].slice()
    for (let r = 0; r < next.nCases; r++) {
      const x = srcCol[r]
      const rule = spec.rules.find((ru) => ru.old.some((o) => matchOld(src, x, o)))
      if (!rule) {
        if (isNew) col[r] = target.type === 'string' ? '' : null
        continue
      }
      const to = rule.to
      if (to.kind === 'copy') col[r] = normalizeCell(target, x)
      else if (to.kind === 'sysmis') col[r] = target.type === 'string' ? '' : null
      else {
        if (target.type === 'numeric' && typeof to.value === 'string' && Number.isNaN(Number(to.value)))
          throw new ProcError(`RECODE: "${to.value}" is not a valid value for numeric variable ${target.name}.`)
        col[r] = normalizeCell(target, to.value)
      }
    }
    next = { ...next, data: { ...next.data, [target.id]: col } }
  })
  return next
}

function compareCells(a: CellValue, b: CellValue): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

export function applySort(ds: Dataset, spec: SortSpec): Dataset {
  const keys = spec.keys.map((k) => ({ v: mustVar(ds, k.variable), desc: k.descending }))
  const order = Array.from({ length: ds.nCases }, (_, i) => i)
  order.sort((i, j) => {
    for (const { v, desc } of keys) {
      const c = compareCells(ds.data[v.id][i], ds.data[v.id][j])
      if (c !== 0) return desc ? -c : c
    }
    return i - j
  })
  return permuteCases(ds, order)
}

export function permuteCases(ds: Dataset, order: number[]): Dataset {
  const data: Record<string, CellValue[]> = {}
  for (const v of ds.variables) {
    const col = ds.data[v.id]
    data[v.id] = order.map((i) => col[i])
  }
  return { ...ds, data, nCases: order.length }
}

export function applySelectIf(ds: Dataset, spec: SelectIfSpec): Dataset {
  const vals = evaluateAll(ds, spec.condition)
  const keep: number[] = []
  vals.forEach((v, i) => {
    if (typeof v === 'number' && v !== 0) keep.push(i)
  })
  return permuteCases(ds, keep)
}

export function applySample(ds: Dataset, spec: SampleSpec): Dataset {
  const rand = mulberry32(spec.seed)
  const keep: number[] = []
  if (spec.fraction !== null) {
    for (let i = 0; i < ds.nCases; i++) if (rand() < spec.fraction) keep.push(i)
  } else if (spec.count) {
    // exactly n cases from the first `from` cases (selection sampling)
    const N = Math.min(spec.count.from, ds.nCases)
    let need = Math.min(spec.count.n, N)
    for (let i = 0; i < N && need > 0; i++) {
      if (rand() * (N - i) < need) {
        keep.push(i)
        need--
      }
    }
  }
  return permuteCases(ds, keep)
}

export function applyAutoRecode(ds: Dataset, spec: AutoRecodeSpec): Dataset {
  let next = ds
  spec.variables.forEach((name, k) => {
    const src = mustVar(next, name)
    const intoName = spec.into[k]
    ensureNewName(next, intoName)
    const col = next.data[src.id]
    const vals = new Map<string, CellValue>()
    for (const x of col) {
      if (isSysMissing(src, x)) continue
      if (src.type === 'string' && String(x ?? '').trim() === '') continue
      const key = src.type === 'string' ? `s:${String(x).trimEnd()}` : `n:${x}`
      if (!vals.has(key)) vals.set(key, src.type === 'string' ? String(x).trimEnd() : x)
    }
    const sorted = [...vals.values()].sort((a, b) => compareCells(a, b) * (spec.descending ? -1 : 1))
    const codeOf = new Map(sorted.map((x, i) => [src.type === 'string' ? `s:${x}` : `n:${x}`, i + 1]))
    const labels = sorted.map((x, i) => {
      const vl = src.valueLabels.find((l) => (src.type === 'string' ? String(l.value).trimEnd() === x : Number(l.value) === x))
      return { value: i + 1, label: vl ? vl.label : String(x) }
    })
    const target = createVariable(intoName, {
      type: 'numeric',
      decimals: 0,
      label: src.label,
      valueLabels: labels,
      measure: src.type === 'string' ? 'nominal' : src.measure,
    })
    const values = col.map((x) => {
      if (isSysMissing(src, x)) return null
      const key = src.type === 'string' ? `s:${String(x ?? '').trimEnd()}` : `n:${x}`
      return codeOf.get(key) ?? null
    })
    next = insertVariable(next, next.variables.length, target, values)
  })
  return next
}

export function applyRank(ds: Dataset, spec: RankSpec): Dataset {
  let next = ds
  spec.variables.forEach((name, k) => {
    const src = mustVar(next, name)
    const intoName = spec.into[k]
    ensureNewName(next, intoName)
    const col = next.data[src.id]
    const idx: number[] = []
    const xs: number[] = []
    col.forEach((x, i) => {
      if (typeof x === 'number' && !isMissing(src, x)) {
        idx.push(i)
        xs.push(spec.descending ? -x : x)
      }
    })
    const { ranks } = rank(xs)
    const values: (number | null)[] = new Array(next.nCases).fill(null)
    idx.forEach((i, j) => (values[i] = ranks[j]))
    const target = createVariable(intoName, { decimals: 3, label: `Rank of ${src.name}`, measure: 'ordinal' })
    next = insertVariable(next, next.variables.length, target, values)
  })
  return next
}

export { deleteVariables, updateVariable }
