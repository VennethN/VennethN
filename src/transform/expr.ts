// Expression language for COMPUTE, IF and SELECT IF, following SPSS semantics:
// system-missing propagates through arithmetic, logical operators use three-valued logic,
// user-missing values count as missing except inside VALUE() / MISSING().

import { getVar, isUserMissing, type CellValue, type Dataset, type Variable } from '../core/dataset'
import { mulberry32 } from '../stats/basic'
import { chi2Cdf, chi2Inv, chi2Sf, fCdf, fInv, fSf, normCdf, normInv, normPdf, tCdf, tInv } from '../stats/distributions'

export class ExprError extends Error {}

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' }

const KEYWORD_OPS: Record<string, string> = {
  AND: '&',
  OR: '|',
  NOT: '~',
  EQ: '=',
  NE: '<>',
  LT: '<',
  LE: '<=',
  GT: '>',
  GE: '>=',
}

export function tokenizeExpr(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!
      out.push({ t: 'num', v: Number(m[0]) })
      i += m[0].length
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      let s = ''
      for (;;) {
        if (j >= src.length) throw new ExprError('Unterminated string in expression.')
        if (src[j] === c) {
          if (src[j + 1] === c) {
            s += c
            j += 2
            continue
          }
          break
        }
        s += src[j++]
      }
      out.push({ t: 'str', v: s })
      i = j + 1
      continue
    }
    if (/[A-Za-z@#$_À-￿]/.test(c)) {
      const m = /^[A-Za-z@#$_À-￿][A-Za-z0-9_.@#$À-￿]*/.exec(src.slice(i))!
      let word = m[0]
      // a trailing period is not part of a name
      while (word.endsWith('.')) word = word.slice(0, -1)
      const upper = word.toUpperCase()
      if (KEYWORD_OPS[upper]) out.push({ t: 'op', v: KEYWORD_OPS[upper] })
      else out.push({ t: 'id', v: word })
      i += word.length
      continue
    }
    const two = src.slice(i, i + 2)
    if (['**', '<=', '>=', '<>', '~=', '¬='].includes(two)) {
      out.push({ t: 'op', v: two === '~=' || two === '¬=' ? '<>' : two })
      i += 2
      continue
    }
    if ('+-*/()=<>&|~,'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    throw new ExprError(`Unexpected character "${c}" in expression.`)
  }
  out.push({ t: 'eof' })
  return out
}

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'var'; name: string }
  | { k: 'sys'; name: string }
  | { k: 'call'; fn: string; min: number | null; args: Node[] }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }

export function parseExpr(src: string): Node {
  const toks = tokenizeExpr(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => {
    const t = toks[p]
    return t.t === 'op' && t.v === v
  }
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Expected "${v}" in expression.`)
    p++
  }
  const or = (): Node => {
    let a = and()
    while (isOp('|')) {
      p++
      a = { k: 'bin', op: '|', a, b: and() }
    }
    return a
  }
  const and = (): Node => {
    let a = not()
    while (isOp('&')) {
      p++
      a = { k: 'bin', op: '&', a, b: not() }
    }
    return a
  }
  const not = (): Node => {
    if (isOp('~')) {
      p++
      return { k: 'un', op: '~', a: not() }
    }
    return cmp()
  }
  const cmp = (): Node => {
    const a = add()
    const t = peek()
    if (t.t === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(t.v)) {
      p++
      return { k: 'bin', op: t.v, a, b: add() }
    }
    return a
  }
  const add = (): Node => {
    let a = mul()
    for (;;) {
      if (isOp('+') || isOp('-')) {
        const op = (toks[p] as { v: string }).v
        p++
        a = { k: 'bin', op, a, b: mul() }
      } else return a
    }
  }
  const mul = (): Node => {
    let a = unary()
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = (toks[p] as { v: string }).v
        p++
        a = { k: 'bin', op, a, b: unary() }
      } else return a
    }
  }
  const unary = (): Node => {
    if (isOp('-')) {
      p++
      return { k: 'un', op: '-', a: unary() }
    }
    if (isOp('+')) {
      p++
      return unary()
    }
    return power()
  }
  const power = (): Node => {
    const a = primary()
    if (isOp('**')) {
      p++
      return { k: 'bin', op: '**', a, b: unary() }
    }
    return a
  }
  const primary = (): Node => {
    const t = peek()
    if (t.t === 'num') {
      p++
      return { k: 'num', v: t.v }
    }
    if (t.t === 'str') {
      p++
      return { k: 'str', v: t.v }
    }
    if (t.t === 'id') {
      p++
      if (isOp('(')) {
        p++
        const args: Node[] = []
        const upper = t.v.toUpperCase()
        const takesFormat = upper === 'STRING' || upper === 'NUMBER'
        const arg = (): Node => {
          // format specifications such as F8.2 are bare words in SPSS syntax
          const a = toks[p]
          const after = toks[p + 1]
          if (takesFormat && args.length === 1 && a.t === 'id' && /^[A-Za-z]+\d+(\.\d+)?$/.test(a.v) && after.t === 'op' && after.v === ')') {
            p++
            return { k: 'str', v: a.v }
          }
          return or()
        }
        if (!isOp(')')) {
          args.push(arg())
          while (isOp(',')) {
            p++
            args.push(arg())
          }
        }
        expect(')')
        let fn = upper
        let min: number | null = null
        const m = /^(.*)\.(\d+)$/.exec(fn)
        if (m && STAT_FUNCS.has(m[1])) {
          fn = m[1]
          min = Number(m[2])
        }
        if (!FUNCS[fn]) throw new ExprError(`Unknown function ${t.v}.`)
        return { k: 'call', fn, min, args }
      }
      if (t.v.startsWith('$')) return { k: 'sys', name: t.v.toUpperCase() }
      return { k: 'var', name: t.v }
    }
    if (t.t === 'op' && t.v === '(') {
      p++
      const e = or()
      expect(')')
      return e
    }
    throw new ExprError(t.t === 'eof' ? 'Expression is incomplete.' : `Unexpected "${(t as { v: unknown }).v}" in expression.`)
  }
  const e = or()
  if (peek().t !== 'eof') throw new ExprError(`Unexpected "${(peek() as { v: unknown }).v}" in expression.`)
  return e
}

export type Val = number | string | null

export interface EvalCtx {
  ds: Dataset
  row: number
  vars: Map<string, Variable>
  rand: () => number
}

const STAT_FUNCS = new Set(['MEAN', 'SUM', 'SD', 'VARIANCE', 'MIN', 'MAX', 'MEDIAN', 'CFVAR'])

const num = (v: Val): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null)

function statArgs(args: Val[], min: number | null, def: number): number[] | null {
  const xs = args.map(num).filter((x): x is number => x !== null)
  if (xs.length < (min ?? def)) return null
  return xs
}

type Fn = (args: Val[], ctx: EvalCtx, nodes: Node[], min: number | null) => Val

const n1 = (f: (x: number) => number): Fn => (a) => {
  const x = num(a[0])
  if (x === null) return null
  const r = f(x)
  return Number.isFinite(r) ? r : null
}

function fmtString(x: number, format: string): string {
  const m = /^[A-Za-z]*(\d+)(?:\.(\d+))?$/.exec(format.trim())
  const w = m ? Number(m[1]) : 8
  const d = m && m[2] ? Number(m[2]) : 0
  return x.toFixed(d).padStart(w)
}

const FUNCS: Record<string, Fn> = {
  ABS: n1(Math.abs),
  SQRT: n1((x) => (x < 0 ? NaN : Math.sqrt(x))),
  EXP: n1(Math.exp),
  LN: n1((x) => (x <= 0 ? NaN : Math.log(x))),
  LG10: n1((x) => (x <= 0 ? NaN : Math.log10(x))),
  SIN: n1(Math.sin),
  COS: n1(Math.cos),
  TAN: n1(Math.tan),
  ARSIN: n1(Math.asin),
  ARCOS: n1(Math.acos),
  ARTAN: n1(Math.atan),
  TRUNC: n1(Math.trunc),
  RND: (a) => {
    const x = num(a[0])
    if (x === null) return null
    const m = a.length > 1 ? num(a[1]) : 1
    if (!m) return null
    // round half away from zero, like SPSS
    const q = x / m
    return Math.sign(q) * Math.floor(Math.abs(q) + 0.5 + 1e-12) * m
  },
  MOD: (a) => {
    const x = num(a[0])
    const y = num(a[1])
    if (x === null || y === null || y === 0) return null
    return x % y
  },
  MEAN: (a, _c, _n, min) => {
    const xs = statArgs(a, min, 1)
    return xs ? xs.reduce((s, x) => s + x, 0) / xs.length : null
  },
  SUM: (a, _c, _n, min) => {
    const xs = statArgs(a, min, 1)
    return xs ? xs.reduce((s, x) => s + x, 0) : null
  },
  SD: (a, _c, _n, min) => {
    const xs = statArgs(a, min, 2)
    if (!xs) return null
    const m = xs.reduce((s, x) => s + x, 0) / xs.length
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
  },
  VARIANCE: (a, _c, _n, min) => {
    const xs = statArgs(a, min, 2)
    if (!xs) return null
    const m = xs.reduce((s, x) => s + x, 0) / xs.length
    return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)
  },
  CFVAR: (a, _c, _n, min) => {
    const xs = statArgs(a, min, 2)
    if (!xs) return null
    const m = xs.reduce((s, x) => s + x, 0) / xs.length
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) / m
  },
  MIN: (a, _c, _n, min) => {
    const xs = statArgs(a, min, 1)
    return xs ? Math.min(...xs) : null
  },
  MAX: (a, _c, _n, min) => {
    const xs = statArgs(a, min, 1)
    return xs ? Math.max(...xs) : null
  },
  MEDIAN: (a, _c, _n, min) => {
    const xs = statArgs(a, min, 1)
    if (!xs) return null
    const s = xs.sort((x, y) => x - y)
    const h = s.length >> 1
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
  },
  NVALID: (a) => a.filter((x) => num(x) !== null || (typeof x === 'string' && x !== null)).length,
  NMISS: (a) => a.filter((x) => x === null).length,
  MISSING: (_a, ctx, nodes) => {
    const n = nodes[0]
    if (n.k === 'var') {
      const v = lookup(ctx, n.name)
      const x = ctx.ds.data[v.id][ctx.row]
      return x === null || isUserMissing(v, x) ? 1 : 0
    }
    return evalNode(n, ctx) === null ? 1 : 0
  },
  SYSMIS: (_a, ctx, nodes) => {
    const n = nodes[0]
    if (n.k === 'var') {
      const v = lookup(ctx, n.name)
      return v.type === 'numeric' && ctx.ds.data[v.id][ctx.row] === null ? 1 : 0
    }
    return evalNode(n, ctx) === null ? 1 : 0
  },
  VALUE: (_a, ctx, nodes) => {
    const n = nodes[0]
    if (n.k === 'var') {
      const v = lookup(ctx, n.name)
      return ctx.ds.data[v.id][ctx.row] as Val
    }
    return evalNode(n, ctx)
  },
  RANGE: (a) => {
    const x = a[0]
    if (x === null) return null
    for (let i = 1; i + 1 < a.length; i += 2) {
      const lo = a[i]
      const hi = a[i + 1]
      if (lo === null || hi === null) continue
      if (x >= lo && x <= hi) return 1
    }
    return 0
  },
  ANY: (a) => {
    const x = a[0]
    if (x === null) return null
    for (let i = 1; i < a.length; i++) if (a[i] !== null && (typeof x === 'string' ? String(a[i]).trimEnd() === x.trimEnd() : a[i] === x)) return 1
    return 0
  },
  // distributions
  'CDF.NORMAL': (a) => {
    const [q, m, s] = a.map(num)
    return q === null || m === null || s === null || s <= 0 ? null : normCdf((q - m) / s)
  },
  'PDF.NORMAL': (a) => {
    const [q, m, s] = a.map(num)
    return q === null || m === null || s === null || s <= 0 ? null : normPdf((q - m) / s) / s
  },
  'IDF.NORMAL': (a) => {
    const [p, m, s] = a.map(num)
    return p === null || m === null || s === null || p <= 0 || p >= 1 ? null : m + s * normInv(p)
  },
  'CDF.T': (a) => {
    const [q, df] = a.map(num)
    return q === null || df === null || df <= 0 ? null : tCdf(q, df)
  },
  'IDF.T': (a) => {
    const [p, df] = a.map(num)
    return p === null || df === null || p <= 0 || p >= 1 ? null : tInv(p, df)
  },
  'CDF.CHISQ': (a) => {
    const [q, df] = a.map(num)
    return q === null || df === null || df <= 0 ? null : chi2Cdf(q, df)
  },
  'IDF.CHISQ': (a) => {
    const [p, df] = a.map(num)
    return p === null || df === null || p <= 0 || p >= 1 ? null : chi2Inv(p, df)
  },
  'SIG.CHISQ': (a) => {
    const [q, df] = a.map(num)
    return q === null || df === null ? null : chi2Sf(q, df)
  },
  'CDF.F': (a) => {
    const [q, d1, d2] = a.map(num)
    return q === null || d1 === null || d2 === null ? null : fCdf(q, d1, d2)
  },
  'IDF.F': (a) => {
    const [p, d1, d2] = a.map(num)
    return p === null || d1 === null || d2 === null || p <= 0 || p >= 1 ? null : fInv(p, d1, d2)
  },
  'SIG.F': (a) => {
    const [q, d1, d2] = a.map(num)
    return q === null || d1 === null || d2 === null ? null : fSf(q, d1, d2)
  },
  'RV.NORMAL': (a, ctx) => {
    const [m, s] = a.map(num)
    if (m === null || s === null) return null
    const u1 = Math.max(ctx.rand(), 1e-300)
    const u2 = ctx.rand()
    return m + s * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  },
  'RV.UNIFORM': (a, ctx) => {
    const [lo, hi] = a.map(num)
    return lo === null || hi === null ? null : lo + (hi - lo) * ctx.rand()
  },
  UNIFORM: (a, ctx) => {
    const m = num(a[0])
    return m === null ? null : m * ctx.rand()
  },
  NORMAL: (a, ctx) => {
    const s = num(a[0])
    if (s === null) return null
    const u1 = Math.max(ctx.rand(), 1e-300)
    return s * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * ctx.rand())
  },
  // strings
  CONCAT: (a) => a.map((x) => (x === null ? '' : String(x))).join(''),
  LENGTH: (a) => (a[0] === null ? null : String(a[0]).trimEnd().length),
  'CHAR.LENGTH': (a) => (a[0] === null ? null : String(a[0]).trimEnd().length),
  UPCASE: (a) => (a[0] === null ? null : String(a[0]).toUpperCase()),
  LOWER: (a) => (a[0] === null ? null : String(a[0]).toLowerCase()),
  LTRIM: (a) => (a[0] === null ? null : String(a[0]).trimStart()),
  RTRIM: (a) => (a[0] === null ? null : String(a[0]).trimEnd()),
  'CHAR.SUBSTR': (a) => substr(a),
  SUBSTR: (a) => substr(a),
  'CHAR.INDEX': (a) => (a[0] === null || a[1] === null ? null : String(a[0]).indexOf(String(a[1])) + 1),
  INDEX: (a) => (a[0] === null || a[1] === null ? null : String(a[0]).indexOf(String(a[1])) + 1),
  REPLACE: (a) => (a[0] === null ? null : String(a[0]).split(String(a[1] ?? '')).join(String(a[2] ?? ''))),
  NUMBER: (a) => {
    if (a[0] === null) return null
    const s = String(a[0]).trim()
    if (s === '') return null
    const n = Number(s.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  },
  STRING: (a) => {
    const x = num(a[0])
    if (x === null) return ''
    return fmtString(x, String(a[1] ?? 'F8.2'))
  },
}

function substr(a: Val[]): Val {
  if (a[0] === null) return null
  const s = String(a[0])
  const pos = num(a[1])
  if (pos === null) return null
  const len = a.length > 2 ? num(a[2]) : null
  return len === null ? s.slice(pos - 1) : s.slice(pos - 1, pos - 1 + len)
}

function lookup(ctx: EvalCtx, name: string): Variable {
  const v = ctx.vars.get(name.toLowerCase())
  if (!v) throw new ExprError(`Variable "${name}" does not exist.`)
  return v
}

function truth(v: Val): boolean | null {
  if (v === null) return null
  if (typeof v === 'string') return v.trim() !== ''
  return v !== 0
}

function compare(op: string, a: Val, b: Val): Val {
  if (a === null || b === null) return null
  let c: number
  if (typeof a === 'string' || typeof b === 'string') {
    const x = String(a).trimEnd()
    const y = String(b).trimEnd()
    c = x < y ? -1 : x > y ? 1 : 0
  } else c = a < b ? -1 : a > b ? 1 : 0
  switch (op) {
    case '=':
      return c === 0 ? 1 : 0
    case '<>':
      return c !== 0 ? 1 : 0
    case '<':
      return c < 0 ? 1 : 0
    case '<=':
      return c <= 0 ? 1 : 0
    case '>':
      return c > 0 ? 1 : 0
    default:
      return c >= 0 ? 1 : 0
  }
}

export function evalNode(n: Node, ctx: EvalCtx): Val {
  switch (n.k) {
    case 'num':
      return n.v
    case 'str':
      return n.v
    case 'sys':
      if (n.name === '$CASENUM') return ctx.row + 1
      if (n.name === '$SYSMIS') return null
      throw new ExprError(`Unknown system variable ${n.name}.`)
    case 'var': {
      const v = lookup(ctx, n.name)
      const x: CellValue = ctx.ds.data[v.id][ctx.row]
      if (v.type === 'string') return isUserMissing(v, x) ? null : String(x ?? '')
      if (x === null || typeof x !== 'number' || Number.isNaN(x) || isUserMissing(v, x)) return null
      return x
    }
    case 'call': {
      const fn = FUNCS[n.fn]
      const lazy = n.fn === 'MISSING' || n.fn === 'SYSMIS' || n.fn === 'VALUE'
      const args = lazy ? [] : n.args.map((a) => evalNode(a, ctx))
      return fn(args, ctx, n.args, n.min)
    }
    case 'un': {
      const a = evalNode(n.a, ctx)
      if (n.op === '-') {
        const x = num(a)
        return x === null ? null : -x
      }
      const t = truth(a)
      return t === null ? null : t ? 0 : 1
    }
    case 'bin': {
      if (n.op === '&' || n.op === '|') {
        const a = truth(evalNode(n.a, ctx))
        const b = truth(evalNode(n.b, ctx))
        if (n.op === '&') {
          if (a === false || b === false) return 0
          if (a === null || b === null) return null
          return 1
        }
        if (a === true || b === true) return 1
        if (a === null || b === null) return null
        return 0
      }
      const a = evalNode(n.a, ctx)
      const b = evalNode(n.b, ctx)
      if (['=', '<>', '<', '<=', '>', '>='].includes(n.op)) return compare(n.op, a, b)
      const x = num(a)
      const y = num(b)
      if (x === null || y === null) return null
      let r: number
      switch (n.op) {
        case '+':
          r = x + y
          break
        case '-':
          r = x - y
          break
        case '*':
          r = x * y
          break
        case '/':
          if (y === 0) return null
          r = x / y
          break
        default:
          r = Math.pow(x, y)
      }
      return Number.isFinite(r) ? r : null
    }
  }
}

/** Names of variables referenced by an expression. */
export function referencedVars(n: Node, out = new Set<string>()): Set<string> {
  if (n.k === 'var') out.add(n.name.toLowerCase())
  else if (n.k === 'call') n.args.forEach((a) => referencedVars(a, out))
  else if (n.k === 'un') referencedVars(n.a, out)
  else if (n.k === 'bin') {
    referencedVars(n.a, out)
    referencedVars(n.b, out)
  }
  return out
}

/** Whether an expression is string-typed (for creating new target variables). */
export function isStringExpr(n: Node, ds: Dataset): boolean {
  if (n.k === 'str') return true
  if (n.k === 'var') return getVar(ds, n.name)?.type === 'string'
  if (n.k === 'call')
    return ['CONCAT', 'UPCASE', 'LOWER', 'LTRIM', 'RTRIM', 'CHAR.SUBSTR', 'SUBSTR', 'REPLACE', 'STRING'].includes(n.fn) ||
      (n.fn === 'VALUE' && isStringExpr(n.args[0], ds))
  return false
}

/** Evaluate an expression for every case. */
export function evaluateAll(ds: Dataset, src: string, seed = Date.now()): Val[] {
  const node = parseExpr(src)
  const vars = new Map(ds.variables.map((v) => [v.name.toLowerCase(), v]))
  for (const name of referencedVars(node)) if (!vars.has(name)) throw new ExprError(`Variable "${name}" does not exist.`)
  const ctx: EvalCtx = { ds, row: 0, vars, rand: mulberry32(seed) }
  const out: Val[] = new Array(ds.nCases)
  for (let r = 0; r < ds.nCases; r++) {
    ctx.row = r
    out[r] = evalNode(node, ctx)
  }
  return out
}

export const FUNCTION_NAMES = Object.keys(FUNCS).sort()
