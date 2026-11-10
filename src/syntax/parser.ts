// Command syntax parser: SPSS-style text -> CommandSpec[].
// Commands end with a period at the end of a line (or a blank line); keywords may be
// abbreviated to three characters; variable lists accept TO and ALL.

import type { Dataset, Measure, MissingSpec, ValueLabel } from '../core/dataset'
import type {
  BarSummary,
  CommandSpec,
  CrossCell,
  CrossStat,
  DescStat,
  ExploreSpec,
  FreqStat,
  FrequenciesSpec,
  MeansCell,
  PostHoc,
  RecodeNew,
  RecodeOld,
  RecodeRule,
  RegressionSpec,
} from '../procedures/types'

export class SyntaxError_ extends Error {
  line: number
  constructor(message: string, line: number) {
    super(message)
    this.line = line
  }
}

export interface RawCommand {
  text: string
  /** 1-based line where the command starts. */
  line: number
}

/** Remove /* *\/ comments outside quotes. */
function stripInlineComments(line: string): string {
  let out = ''
  let q: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      out += c
      if (c === q) q = null
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      out += c
      continue
    }
    if (c === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2)
      if (end < 0) break
      i = end + 1
      continue
    }
    out += c
  }
  return out
}

function endsWithTerminator(line: string): boolean {
  const t = line.trimEnd()
  if (!t.endsWith('.')) return false
  // ensure the final period is not inside quotes
  let q: string | null = null
  for (let i = 0; i < t.length - 1; i++) {
    const c = t[i]
    if (q) {
      if (c === q) q = null
    } else if (c === "'" || c === '"') q = c
  }
  return q === null
}

/** Split a syntax program into commands (comments removed). */
export function splitCommands(text: string): RawCommand[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: RawCommand[] = []
  let cur: string[] = []
  let start = 0
  let isComment = false
  const flush = () => {
    if (cur.length && !isComment) {
      let t = cur.join('\n').trim()
      if (t.endsWith('.')) t = t.slice(0, -1).trimEnd()
      if (t) out.push({ text: t, line: start + 1 })
    }
    cur = []
    isComment = false
  }
  lines.forEach((raw, idx) => {
    const line = isComment ? raw : stripInlineComments(raw)
    if (!cur.length) {
      if (!line.trim()) return
      start = idx
      const first = line.trimStart()
      isComment = first.startsWith('*') || /^COMMENT\b/i.test(first)
    } else if (!line.trim()) {
      flush()
      return
    }
    cur.push(line)
    if (endsWithTerminator(line)) flush()
  })
  flush()
  return out
}

// ------------------------------------------------------------------------- tokens

export type Token =
  | { t: 'id'; v: string; raw: string }
  | { t: 'num'; v: number; raw: string }
  | { t: 'str'; v: string; raw: string }
  | { t: 'op'; v: string; raw: string }

export function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  // A leading sign belongs to a number unless it follows a number or ")" (no arithmetic outside expressions).
  const prevAllowsSign = () => {
    const p = out[out.length - 1]
    return !p || (p.t !== 'num' && !(p.t === 'op' && p.v === ')'))
  }
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      let s = ''
      for (;;) {
        if (j >= src.length) throw new Error('Unterminated string.')
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
      out.push({ t: 'str', v: s, raw: src.slice(i, j + 1) })
      i = j + 1
      continue
    }
    const next = src[i + 1] ?? ''
    const startsNum =
      /[0-9]/.test(c) ||
      (c === '.' && /[0-9]/.test(next)) ||
      ((c === '-' || c === '+') && prevAllowsSign() && (/[0-9]/.test(next) || (next === '.' && /[0-9]/.test(src[i + 2] ?? ''))))
    if (startsNum) {
      const numM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!
      out.push({ t: 'num', v: Number(numM[0]), raw: numM[0] })
      i += numM[0].length
      continue
    }
    const idM = /^[A-Za-z@#$À-￿][A-Za-z0-9_.@#$À-￿]*(?:-[A-Za-z][A-Za-z0-9_]*)*/.exec(src.slice(i))
    if (idM) {
      let w = idM[0]
      while (w.endsWith('.')) w = w.slice(0, -1)
      out.push({ t: 'id', v: w, raw: w })
      i += w.length
      continue
    }
    const two = src.slice(i, i + 2)
    if (['<=', '>=', '<>', '~=', '**'].includes(two)) {
      out.push({ t: 'op', v: two, raw: two })
      i += 2
      continue
    }
    out.push({ t: 'op', v: c, raw: c })
    i++
  }
  return out
}

/** Keyword match allowing abbreviation to at least `min` characters. */
export function kw(word: string | undefined, keyword: string, min = 3): boolean {
  if (!word) return false
  const w = word.toUpperCase()
  const k = keyword.toUpperCase()
  if (w === k) return true
  return w.length >= Math.min(min, k.length) && k.startsWith(w)
}

class Stream {
  pos = 0
  toks: Token[]
  ctx: Ctx
  constructor(toks: Token[], ctx: Ctx) {
    this.toks = toks
    this.ctx = ctx
  }
  peek(o = 0): Token | undefined {
    return this.toks[this.pos + o]
  }
  next(): Token {
    const t = this.toks[this.pos++]
    if (!t) this.ctx.fail('Unexpected end of command.')
    return t
  }
  atEnd(): boolean {
    return this.pos >= this.toks.length
  }
  isOp(v: string, o = 0): boolean {
    const t = this.peek(o)
    return !!t && t.t === 'op' && t.v === v
  }
  eatOp(v: string): boolean {
    if (this.isOp(v)) {
      this.pos++
      return true
    }
    return false
  }
  expectOp(v: string): void {
    if (!this.eatOp(v)) this.ctx.fail(`Expected "${v}" but found ${this.peek() ? `"${this.peek()!.raw}"` : 'end of command'}.`)
  }
  isKw(k: string, o = 0, min = 3): boolean {
    const t = this.peek(o)
    return !!t && t.t === 'id' && kw(t.v, k, min)
  }
  eatKw(k: string, min = 3): boolean {
    if (this.isKw(k, 0, min)) {
      this.pos++
      return true
    }
    return false
  }
  expectKw(k: string, min = 3): void {
    if (!this.eatKw(k, min)) this.ctx.fail(`Expected keyword ${k}.`)
  }
  number(): number {
    const t = this.next()
    if (t.t !== 'num') this.ctx.fail(`Expected a number but found "${t.raw}".`)
    return (t as { v: number }).v
  }
  ident(): string {
    const t = this.next()
    if (t.t !== 'id') this.ctx.fail(`Expected a name but found "${t.raw}".`)
    return (t as { v: string }).v
  }
  string(): string {
    const t = this.next()
    if (t.t !== 'str') this.ctx.fail(`Expected a quoted string but found "${t.raw}".`)
    return (t as { v: string }).v
  }
}

interface Ctx {
  ds: Dataset
  line: number
  fail(msg: string): never
}

/** Split tokens into the main specification and subcommands at top-level slashes. */
function subcommands(toks: Token[]): Token[][] {
  const out: Token[][] = [[]]
  let depth = 0
  for (const t of toks) {
    if (t.t === 'op' && t.v === '(') depth++
    if (t.t === 'op' && t.v === ')') depth--
    if (t.t === 'op' && t.v === '/' && depth === 0) {
      out.push([])
      continue
    }
    out[out.length - 1].push(t)
  }
  return out
}

/** Parse a variable list (existing variables) with TO and ALL. */
function varList(s: Stream, opts: { stop?: string[]; allowNew?: boolean } = {}): string[] {
  const names: string[] = []
  const ds = s.ctx.ds
  const stop = new Set([...(opts.stop ?? []).map((x) => x.toUpperCase()), 'BY', 'WITH', 'INTO'])
  while (!s.atEnd()) {
    const t = s.peek()!
    if (t.t !== 'id' || stop.has(t.v.toUpperCase())) break
    s.pos++
    if (t.v.toUpperCase() === 'ALL' && !ds.variables.some((v) => v.name.toUpperCase() === 'ALL')) {
      names.push(...ds.variables.map((v) => v.name))
      continue
    }
    if (s.isKw('TO', 0, 2) && s.peek(1)?.t === 'id') {
      s.pos++
      const end = s.ident()
      const a = ds.variables.findIndex((v) => v.name.toLowerCase() === t.v.toLowerCase())
      const b = ds.variables.findIndex((v) => v.name.toLowerCase() === end.toLowerCase())
      if (a < 0 || b < 0) {
        if (opts.allowNew) {
          // NEW1 TO NEW5 style generation
          const m1 = /^(.*?)(\d+)$/.exec(t.v)
          const m2 = /^(.*?)(\d+)$/.exec(end)
          if (m1 && m2 && m1[1].toLowerCase() === m2[1].toLowerCase()) {
            const w = m1[2].length
            for (let k = Number(m1[2]); k <= Number(m2[2]); k++) names.push(`${m1[1]}${String(k).padStart(w, '0')}`)
            continue
          }
        }
        s.ctx.fail(`Variable ${a < 0 ? t.v : end} in a TO range does not exist.`)
      }
      if (b < a) s.ctx.fail(`In "${t.v} TO ${end}" the first variable must come before the second.`)
      for (let k = a; k <= b; k++) names.push(ds.variables[k].name)
      continue
    }
    const v = ds.variables.find((x) => x.name.toLowerCase() === t.v.toLowerCase())
    if (!v && !opts.allowNew) s.ctx.fail(`Variable "${t.v}" does not exist in the active dataset.`)
    names.push(v ? v.name : t.v)
  }
  return names
}

/** Read the remaining tokens of a subcommand as uppercase keywords (ignores punctuation). */
function keywords(toks: Token[]): string[] {
  return toks.filter((t) => t.t === 'id').map((t) => (t as { v: string }).v.toUpperCase())
}

function hasKw(words: string[], k: string, min = 3): boolean {
  return words.some((w) => kw(w, k, min))
}

function subName(seg: Token[]): string {
  const t = seg[0]
  return t && t.t === 'id' ? t.v.toUpperCase() : ''
}

function rest(seg: Token[]): Token[] {
  const r = seg.slice(1)
  if (r[0]?.t === 'op' && r[0].v === '=') return r.slice(1)
  return r
}

function numbersIn(toks: Token[]): number[] {
  return toks.filter((t) => t.t === 'num').map((t) => (t as { v: number }).v)
}

/** Raw command text after the first n words (used for expressions). */
function afterWords(text: string, n: number): string {
  let s = text.trimStart()
  for (let i = 0; i < n; i++) s = s.replace(/^\S+\s*/, '')
  return s
}

/** Extract a balanced parenthesized group at the start of `s`: returns [inner, rest]. */
function balanced(s: string): [string, string] | null {
  const t = s.trimStart()
  if (!t.startsWith('(')) return null
  let depth = 0
  let q: string | null = null
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === q) q = null
      continue
    }
    if (c === "'" || c === '"') q = c
    else if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return [t.slice(1, i), t.slice(i + 1)]
    }
  }
  return null
}

function splitAssign(s: string): [string, string] | null {
  let depth = 0
  let q: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === q) q = null
      continue
    }
    if (c === "'" || c === '"') q = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === '=' && depth === 0) return [s.slice(0, i).trim(), s.slice(i + 1).trim()]
  }
  return null
}

// ------------------------------------------------------------------------- command table

type Parser = (s: Stream, raw: string, ctx: Ctx) => CommandSpec[]

interface CommandDef {
  words: string[]
  parse: Parser
}

const COMMANDS: CommandDef[] = [
  { words: ['FREQUENCIES'], parse: parseFrequencies },
  { words: ['DESCRIPTIVES'], parse: parseDescriptives },
  { words: ['EXAMINE'], parse: parseExamine },
  { words: ['CROSSTABS'], parse: parseCrosstabs },
  { words: ['MEANS'], parse: parseMeans },
  { words: ['T-TEST'], parse: parseTTest },
  { words: ['ONEWAY'], parse: parseOneway },
  { words: ['CORRELATIONS'], parse: parseCorrelations },
  { words: ['NONPAR', 'CORR'], parse: parseNonparCorr },
  { words: ['REGRESSION'], parse: parseRegression },
  { words: ['RELIABILITY'], parse: parseReliability },
  { words: ['NPAR', 'TESTS'], parse: parseNparTests },
  { words: ['GRAPH'], parse: parseGraph },
  { words: ['COMPUTE'], parse: parseCompute },
  { words: ['IF'], parse: parseIf },
  { words: ['RECODE'], parse: parseRecode },
  { words: ['SORT', 'CASES'], parse: parseSort },
  { words: ['SELECT', 'IF'], parse: parseSelectIf },
  { words: ['FILTER'], parse: parseFilter },
  { words: ['USE'], parse: () => [{ proc: 'use-all' }] },
  { words: ['WEIGHT'], parse: parseWeight },
  { words: ['SAMPLE'], parse: parseSample },
  { words: ['VARIABLE', 'LABELS'], parse: parseVariableLabels },
  { words: ['ADD', 'VALUE', 'LABELS'], parse: (s, r, c) => parseValueLabels(s, r, c, true) },
  { words: ['VALUE', 'LABELS'], parse: (s, r, c) => parseValueLabels(s, r, c, false) },
  { words: ['MISSING', 'VALUES'], parse: parseMissingValues },
  { words: ['VARIABLE', 'LEVEL'], parse: parseVariableLevel },
  { words: ['FORMATS'], parse: parseFormats },
  { words: ['STRING'], parse: parseStringDecl },
  { words: ['NUMERIC'], parse: parseNumericDecl },
  { words: ['DELETE', 'VARIABLES'], parse: (s) => [{ proc: 'delete-variables', variables: varList(s) }] },
  { words: ['RENAME', 'VARIABLES'], parse: parseRename },
  { words: ['AUTORECODE'], parse: parseAutorecode },
  { words: ['RANK'], parse: parseRank },
  { words: ['EXECUTE'], parse: () => [{ proc: 'execute' }] },
  { words: ['TITLE'], parse: (s) => [{ proc: 'title', text: s.atEnd() ? '' : s.peek()!.t === 'str' ? s.string() : s.toks.map((t) => t.raw).join(' ') }] },
]

/** Commands that are accepted and ignored (they have no effect in the browser). */
const IGNORED = ['DATASET', 'OUTPUT', 'SET', 'SHOW', 'CACHE', 'PRESERVE', 'RESTORE', 'NEW FILE', 'GET', 'SAVE', 'FINISH']

export interface ParsedCommand {
  raw: RawCommand
  specs: CommandSpec[]
  ignored?: boolean
}

function matchCommand(words: string[]): { def: CommandDef; consumed: number } | null {
  let best: { def: CommandDef; consumed: number } | null = null
  for (const def of COMMANDS) {
    if (def.words.length > words.length) continue
    let ok = true
    for (let i = 0; i < def.words.length; i++) {
      const w = words[i]
      const k = def.words[i]
      // multi-word commands: allow abbreviation of each word to 3+ characters
      if (!(w === k || (w.length >= 3 && k.startsWith(w)) || (k === 'T-TEST' && w === 'T-TEST'))) {
        ok = false
        break
      }
    }
    if (ok && (!best || def.words.length > best.def.words.length)) best = { def, consumed: def.words.length }
  }
  return best
}

/** Parse one command against the current dataset (needed to expand TO / ALL). */
export function parseCommand(raw: RawCommand, ds: Dataset): ParsedCommand {
  const ctx: Ctx = {
    ds,
    line: raw.line,
    fail(msg: string): never {
      throw new SyntaxError_(msg, raw.line)
    },
  }
  let toks: Token[]
  try {
    toks = tokenize(raw.text)
  } catch (e) {
    ctx.fail((e as Error).message)
  }
  const words = toks.slice(0, 4).map((t) => (t.t === 'id' ? t.v.toUpperCase() : ''))
  const m = matchCommand(words)
  if (!m) {
    const first = words[0]
    if (IGNORED.some((w) => w.split(' ')[0] === first)) return { raw, specs: [], ignored: true }
    ctx.fail(`Unrecognized command: ${raw.text.split(/\s+/)[0]}.`)
  }
  const s = new Stream(toks.slice(m.consumed), ctx)
  const specs = m.def.parse(s, raw.text, ctx)
  return { raw, specs }
}

// ------------------------------------------------------------------------- analysis commands

function parseFrequencies(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  const spec: FrequenciesSpec = {
    proc: 'frequencies',
    variables: [],
    showTables: true,
    statistics: [],
    quartiles: false,
    percentiles: [],
    chart: 'none',
    chartValues: 'freq',
    normalCurve: false,
    order: 'avalue',
  }
  segs.forEach((seg, i) => {
    const name = subName(seg)
    if (i === 0 || kw(name, 'VARIABLES')) {
      const toks = i === 0 && !kw(name, 'VARIABLES') ? seg : rest(seg)
      spec.variables.push(...varList(new Stream(toks, ctx)))
      return
    }
    const words = keywords(rest(seg))
    if (kw(name, 'FORMAT')) {
      if (hasKw(words, 'NOTABLE')) spec.showTables = false
      if (hasKw(words, 'DVALUE')) spec.order = 'dvalue'
      if (hasKw(words, 'AFREQ')) spec.order = 'afreq'
      if (hasKw(words, 'DFREQ')) spec.order = 'dfreq'
    } else if (kw(name, 'STATISTICS')) {
      const map: [string, FreqStat][] = [
        ['MEAN', 'mean'],
        ['SEMEAN', 'semean'],
        ['MEDIAN', 'median'],
        ['MODE', 'mode'],
        ['STDDEV', 'stddev'],
        ['VARIANCE', 'variance'],
        ['SKEWNESS', 'skewness'],
        ['SESKEW', 'skewness'],
        ['KURTOSIS', 'kurtosis'],
        ['SEKURT', 'kurtosis'],
        ['RANGE', 'range'],
        ['MINIMUM', 'minimum'],
        ['MAXIMUM', 'maximum'],
        ['SUM', 'sum'],
      ]
      const set = new Set<FreqStat>()
      if (!words.length || hasKw(words, 'DEFAULT')) ['mean', 'stddev', 'minimum', 'maximum'].forEach((x) => set.add(x as FreqStat))
      if (hasKw(words, 'ALL')) map.forEach(([, v]) => set.add(v))
      for (const w of words) {
        // exact matches first to avoid MEAN vs MEDIAN ambiguity
        const exact = map.find(([k]) => k === w)
        if (exact) set.add(exact[1])
        else {
          const pre = map.find(([k]) => kw(w, k, 4))
          if (pre) set.add(pre[1])
        }
      }
      spec.statistics = [...set]
    } else if (kw(name, 'NTILES')) {
      const n = numbersIn(rest(seg))[0]
      if (n === 4) spec.quartiles = true
      else if (n > 1) for (let k = 1; k < n; k++) spec.percentiles.push(Number(((100 * k) / n).toFixed(4)))
    } else if (kw(name, 'PERCENTILES')) {
      spec.percentiles.push(...numbersIn(rest(seg)))
    } else if (kw(name, 'BARCHART') || kw(name, 'PIECHART')) {
      spec.chart = kw(name, 'BARCHART') ? 'bar' : 'pie'
      if (hasKw(words, 'PERCENT')) spec.chartValues = 'percent'
    } else if (kw(name, 'HISTOGRAM')) {
      spec.chart = 'histogram'
      spec.normalCurve = hasKw(words, 'NORMAL')
    }
  })
  if (!spec.variables.length) ctx.fail('FREQUENCIES requires a variable list.')
  return [spec]
}

function parseDescriptives(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  const vars: string[] = []
  let stats: DescStat[] | null = null
  let saveZ = false
  let sort: 'variable' | 'alpha' | 'mean-a' | 'mean-d' = 'variable'
  segs.forEach((seg, i) => {
    const name = subName(seg)
    if (i === 0 || kw(name, 'VARIABLES')) {
      const toks = i === 0 && !kw(name, 'VARIABLES') ? seg : rest(seg)
      vars.push(...varList(new Stream(toks, ctx)))
      return
    }
    const words = keywords(rest(seg))
    if (kw(name, 'SAVE')) saveZ = true
    else if (kw(name, 'STATISTICS')) {
      const map: [string, DescStat][] = [
        ['MEAN', 'mean'],
        ['SEMEAN', 'semean'],
        ['STDDEV', 'stddev'],
        ['VARIANCE', 'variance'],
        ['RANGE', 'range'],
        ['MIN', 'min'],
        ['MAX', 'max'],
        ['SUM', 'sum'],
        ['SKEWNESS', 'skewness'],
        ['KURTOSIS', 'kurtosis'],
      ]
      const set = new Set<DescStat>()
      if (hasKw(words, 'DEFAULT')) ['mean', 'stddev', 'min', 'max'].forEach((x) => set.add(x as DescStat))
      if (hasKw(words, 'ALL')) map.forEach(([, v]) => set.add(v))
      for (const w of words) {
        const exact = map.find(([k]) => k === w)
        if (exact) set.add(exact[1])
        else {
          const pre = map.find(([k]) => w.length >= 3 && k.startsWith(w))
          if (pre) set.add(pre[1])
        }
      }
      stats = [...set]
    } else if (kw(name, 'SORT')) {
      const desc = rest(seg).some((t) => t.t === 'id' && t.v.toUpperCase() === 'D')
      sort = hasKw(words, 'NAME') ? 'alpha' : desc ? 'mean-d' : 'mean-a'
    }
  })
  if (!vars.length) ctx.fail('DESCRIPTIVES requires a variable list.')
  return [{ proc: 'descriptives', variables: vars, statistics: stats ?? ['mean', 'stddev', 'min', 'max'], saveZ, sort }]
}

function parseExamine(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  const spec: ExploreSpec = {
    proc: 'explore',
    dependents: [],
    factors: [],
    display: 'both',
    descriptives: true,
    percentiles: false,
    outliers: false,
    ci: 95,
    boxplot: 'factor',
    stemleaf: true,
    histogram: false,
    normality: false,
    missing: 'listwise',
    noTotal: false,
  }
  let plotNone = false
  let statsNone = false
  let sawPlot = false
  segs.forEach((seg, i) => {
    const name = subName(seg)
    if (i === 0 || kw(name, 'VARIABLES')) {
      const toks = i === 0 && !kw(name, 'VARIABLES') ? seg : rest(seg)
      const st = new Stream(toks, ctx)
      spec.dependents.push(...varList(st))
      while (st.eatKw('BY', 2)) spec.factors.push(...varList(st))
      return
    }
    const words = keywords(rest(seg))
    if (kw(name, 'PLOT')) {
      sawPlot = true
      spec.stemleaf = hasKw(words, 'STEMLEAF') || hasKw(words, 'ALL')
      spec.histogram = hasKw(words, 'HISTOGRAM') || hasKw(words, 'ALL')
      spec.normality = hasKw(words, 'NPPLOT') || hasKw(words, 'ALL')
      const box = hasKw(words, 'BOXPLOT') || hasKw(words, 'ALL')
      if (!box) spec.boxplot = 'none'
      plotNone = hasKw(words, 'NONE')
    } else if (kw(name, 'COMPARE')) {
      if (hasKw(words, 'VARIABLES') && spec.boxplot !== 'none') spec.boxplot = 'dependents'
    } else if (kw(name, 'STATISTICS')) {
      spec.descriptives = hasKw(words, 'DESCRIPTIVES') || hasKw(words, 'ALL')
      spec.outliers = hasKw(words, 'EXTREME') || hasKw(words, 'ALL')
      statsNone = hasKw(words, 'NONE')
    } else if (kw(name, 'PERCENTILES')) spec.percentiles = true
    else if (kw(name, 'CINTERVAL')) spec.ci = numbersIn(rest(seg))[0] ?? 95
    else if (kw(name, 'MISSING')) spec.missing = hasKw(words, 'PAIRWISE') ? 'pairwise' : 'listwise'
    else if (kw(name, 'NOTOTAL')) spec.noTotal = true
  })
  if (!sawPlot) {
    spec.boxplot = 'factor'
    spec.stemleaf = true
  }
  // COMPARE VARIABLES may appear before PLOT; re-check
  const cmp = segs.find((seg) => kw(subName(seg), 'COMPARE'))
  if (cmp && hasKw(keywords(rest(cmp)), 'VARIABLES') && spec.boxplot !== 'none') spec.boxplot = 'dependents'
  if (plotNone || (sawPlot && spec.boxplot === 'none' && !spec.stemleaf && !spec.histogram && !spec.normality)) spec.display = 'statistics'
  if (statsNone && !spec.percentiles) spec.display = spec.display === 'statistics' ? 'both' : 'plots'
  if (!spec.dependents.length) ctx.fail('EXAMINE requires a dependent variable list.')
  return [spec]
}

function parseCrosstabs(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  const out: CommandSpec[] = []
  let cells: CrossCell[] = ['count']
  let stats: CrossStat[] = []
  let barchart = false
  let suppress = false
  const tables: [string[], string[]][] = []
  segs.forEach((seg, i) => {
    const name = subName(seg)
    if ((i === 0 && seg.length) || kw(name, 'TABLES')) {
      const toks = kw(name, 'TABLES') ? rest(seg) : seg
      if (!toks.length) return
      const st = new Stream(toks, ctx)
      const rows = varList(st)
      st.expectKw('BY')
      const cols = varList(st)
      tables.push([rows, cols])
      return
    }
    const words = keywords(rest(seg))
    if (kw(name, 'CELLS')) {
      const all: CrossCell[] = ['count', 'expected', 'row', 'column', 'total', 'resid', 'sresid', 'asresid']
      cells = all.filter((c) => words.includes(c.toUpperCase()))
      if (hasKw(words, 'ALL')) cells = all
      if (hasKw(words, 'NONE')) cells = []
    } else if (kw(name, 'STATISTICS')) {
      const all: CrossStat[] = ['chisq', 'phi', 'cc', 'risk', 'gamma', 'btau', 'ctau', 'lambda', 'corr', 'kappa', 'mcnemar']
      stats = all.filter((c) => words.includes(c.toUpperCase()))
      if (hasKw(words, 'ALL')) stats = all
    } else if (kw(name, 'BARCHART')) barchart = true
    else if (kw(name, 'FORMAT')) suppress = hasKw(words, 'NOTABLES')
  })
  if (!tables.length) ctx.fail('CROSSTABS requires a /TABLES specification.')
  for (const [rows, cols] of tables)
    out.push({ proc: 'crosstabs', rows, columns: cols, cells, statistics: stats, barchart, suppressTables: suppress })
  return out
}

function parseMeans(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  let deps: string[] = []
  let indeps: string[] = []
  let cells: MeansCell[] = ['mean', 'count', 'stddev']
  let anova = false
  segs.forEach((seg, i) => {
    const name = subName(seg)
    if ((i === 0 && seg.length) || kw(name, 'TABLES')) {
      const toks = kw(name, 'TABLES') ? rest(seg) : seg
      if (!toks.length) return
      const st = new Stream(toks, ctx)
      deps = varList(st)
      if (st.eatKw('BY', 2)) indeps = varList(st)
      return
    }
    const words = keywords(rest(seg))
    if (kw(name, 'CELLS')) {
      const map: [string, MeansCell][] = [
        ['MEAN', 'mean'],
        ['COUNT', 'count'],
        ['STDDEV', 'stddev'],
        ['SUM', 'sum'],
        ['MIN', 'min'],
        ['MAX', 'max'],
        ['MEDIAN', 'median'],
        ['SEMEAN', 'semean'],
        ['VAR', 'variance'],
        ['RANGE', 'range'],
      ]
      cells = words.map((w) => map.find(([k]) => k === w)?.[1]).filter((x): x is MeansCell => !!x)
      if (hasKw(words, 'DEFAULT') || !cells.length) cells = ['mean', 'count', 'stddev']
    } else if (kw(name, 'STATISTICS')) anova = hasKw(words, 'ANOVA') || hasKw(words, 'ALL')
  })
  if (!deps.length) ctx.fail('MEANS requires a TABLES specification.')
  return [{ proc: 'means', dependents: deps, independents: indeps, cells, anova }]
}

function parseCI(toks: Token[]): number | null {
  const n = numbersIn(toks)[0]
  if (n === undefined) return null
  return n < 1 ? Math.round(n * 10000) / 100 : n
}

function parseTTest(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  let testVal: number | null = null
  let groups: { group: string; def: { kind: 'values'; g1: number | string; g2: number | string } | { kind: 'cut'; cut: number } } | null = null
  let pairs: [string, string][] | null = null
  let vars: string[] = []
  let ci = 95
  let missing: 'analysis' | 'listwise' = 'analysis'
  for (const seg of segs) {
    if (!seg.length) continue
    const name = subName(seg)
    const r = rest(seg)
    if (kw(name, 'TESTVAL')) testVal = numbersIn(r)[0] ?? 0
    else if (kw(name, 'GROUPS')) {
      const st = new Stream(r, ctx)
      const g = st.ident()
      const v = ctx.ds.variables.find((x) => x.name.toLowerCase() === g.toLowerCase())
      if (!v) ctx.fail(`Variable "${g}" does not exist in the active dataset.`)
      st.expectOp('(')
      const vals: (number | string)[] = []
      while (!st.isOp(')') && !st.atEnd()) {
        const t = st.next()
        if (t.t === 'num' || t.t === 'str') vals.push(t.v)
        else if (t.t === 'id') vals.push(t.v)
      }
      st.expectOp(')')
      if (vals.length === 1) groups = { group: v.name, def: { kind: 'cut', cut: Number(vals[0]) } }
      else if (vals.length >= 2) groups = { group: v.name, def: { kind: 'values', g1: vals[0], g2: vals[1] } }
      else ctx.fail('GROUPS requires one cut point or two group values.')
    } else if (kw(name, 'PAIRS')) {
      const st = new Stream(r, ctx)
      const a = varList(st)
      let b: string[] | null = null
      if (st.eatKw('WITH', 4)) b = varList(st)
      let paired = false
      if (st.eatOp('(')) {
        paired = st.eatKw('PAIRED')
        st.eatOp(')')
      }
      pairs = []
      if (b && paired) {
        if (a.length !== b.length) ctx.fail('With (PAIRED), the lists before and after WITH must have the same length.')
        a.forEach((x, k) => pairs!.push([x, b![k]]))
      } else if (b) for (const x of a) for (const y of b) pairs.push([x, y])
      else for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) pairs.push([a[i], a[j]])
    } else if (kw(name, 'VARIABLES')) vars = varList(new Stream(r, ctx))
    else if (kw(name, 'CRITERIA')) ci = parseCI(r) ?? 95
    else if (kw(name, 'MISSING')) missing = hasKw(keywords(r), 'LISTWISE') ? 'listwise' : 'analysis'
  }
  if (pairs) return [{ proc: 'ttest-paired', pairs, ci, missing }]
  if (groups) {
    if (!vars.length) ctx.fail('T-TEST GROUPS requires a /VARIABLES list.')
    return [{ proc: 'ttest-ind', variables: vars, group: groups.group, groupDef: groups.def, ci, missing }]
  }
  if (!vars.length) ctx.fail('T-TEST requires a /VARIABLES list.')
  return [{ proc: 'ttest-one', variables: vars, testValue: testVal ?? 0, ci, missing }]
}

function parseOneway(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  let deps: string[] = []
  let factor = ''
  const spec = {
    descriptives: false,
    homogeneity: false,
    welch: false,
    brownForsythe: false,
    meansPlot: false,
    posthoc: [] as PostHoc[],
    alpha: 0.05,
    missing: 'analysis' as 'analysis' | 'listwise',
  }
  segs.forEach((seg, i) => {
    const name = subName(seg)
    if (i === 0 || kw(name, 'VARIABLES')) {
      const st = new Stream(i === 0 && !kw(name, 'VARIABLES') ? seg : rest(seg), ctx)
      deps = varList(st)
      st.expectKw('BY')
      factor = varList(st)[0]
      return
    }
    const words = keywords(rest(seg))
    if (kw(name, 'STATISTICS')) {
      spec.descriptives = hasKw(words, 'DESCRIPTIVES') || hasKw(words, 'ALL')
      spec.homogeneity = hasKw(words, 'HOMOGENEITY') || hasKw(words, 'ALL')
      spec.welch = hasKw(words, 'WELCH') || hasKw(words, 'ALL')
      spec.brownForsythe = hasKw(words, 'BROWNFORSYTHE') || hasKw(words, 'ALL')
    } else if (kw(name, 'PLOT')) spec.meansPlot = hasKw(words, 'MEANS')
    else if (kw(name, 'MISSING')) spec.missing = hasKw(words, 'LISTWISE') ? 'listwise' : 'analysis'
    else if (kw(name, 'POSTHOC')) {
      const all: PostHoc[] = ['lsd', 'bonferroni', 'sidak', 'scheffe', 'tukey', 'gh']
      // keep the order in which the tests were requested
      spec.posthoc = []
      for (const w of words) {
        const m = all.find((ph) => w === ph.toUpperCase() || (ph === 'bonferroni' && kw(w, 'BONFERRONI', 4)))
        if (m && !spec.posthoc.includes(m)) spec.posthoc.push(m)
      }
      const a = numbersIn(rest(seg))[0]
      if (a !== undefined) spec.alpha = a
    }
  })
  if (!deps.length || !factor) ctx.fail('ONEWAY requires a dependent list and BY factor.')
  return [{ proc: 'oneway', dependents: deps, factor, ...spec }]
}

function parseCorrelations(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  let vars: string[] = []
  let tails: 1 | 2 = 2
  let flag = true
  let descriptives = false
  let missing: 'pairwise' | 'listwise' = 'pairwise'
  segs.forEach((seg, i) => {
    const name = subName(seg)
    if ((i === 0 && seg.length) || kw(name, 'VARIABLES')) {
      const toks = kw(name, 'VARIABLES') ? rest(seg) : seg
      if (toks.length) vars = varList(new Stream(toks, ctx))
      return
    }
    const words = keywords(rest(seg))
    if (kw(name, 'PRINT')) {
      if (hasKw(words, 'ONETAIL')) tails = 1
      if (words.includes('SIG')) flag = false
      if (hasKw(words, 'NOSIG')) flag = true
    } else if (kw(name, 'STATISTICS')) descriptives = hasKw(words, 'DESCRIPTIVES') || hasKw(words, 'ALL')
    else if (kw(name, 'MISSING')) missing = hasKw(words, 'LISTWISE') ? 'listwise' : 'pairwise'
  })
  if (vars.length < 2) ctx.fail('CORRELATIONS requires at least two variables.')
  return [{ proc: 'correlations', variables: vars, tails, flag, descriptives, missing }]
}

function parseNonparCorr(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  let vars: string[] = []
  let tails: 1 | 2 = 2
  let flag = true
  let kendall = false
  let spearman = true
  let missing: 'pairwise' | 'listwise' = 'pairwise'
  segs.forEach((seg, i) => {
    const name = subName(seg)
    if ((i === 0 && seg.length) || kw(name, 'VARIABLES')) {
      const toks = kw(name, 'VARIABLES') ? rest(seg) : seg
      if (toks.length) vars = varList(new Stream(toks, ctx))
      return
    }
    const words = keywords(rest(seg))
    if (kw(name, 'PRINT')) {
      if (hasKw(words, 'ONETAIL')) tails = 1
      if (words.includes('SIG')) flag = false
      if (hasKw(words, 'NOSIG')) flag = true
      if (hasKw(words, 'BOTH')) {
        kendall = true
        spearman = true
      } else if (hasKw(words, 'KENDALL')) {
        kendall = true
        spearman = false
      } else if (hasKw(words, 'SPEARMAN')) {
        kendall = false
        spearman = true
      }
    } else if (kw(name, 'MISSING')) missing = hasKw(words, 'LISTWISE') ? 'listwise' : 'pairwise'
  })
  if (vars.length < 2) ctx.fail('NONPAR CORR requires at least two variables.')
  return [{ proc: 'nonparcorr', variables: vars, kendall, spearman, tails, flag, missing }]
}

function parseRegression(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  const spec: RegressionSpec = {
    proc: 'regression',
    dependent: '',
    independents: [],
    method: 'enter',
    pin: 0.05,
    pout: 0.1,
    statistics: {
      coeff: true,
      ci: false,
      ciLevel: 95,
      r: true,
      anova: true,
      change: false,
      descriptives: false,
      zpp: false,
      collin: false,
      durbin: false,
    },
    plots: { histogram: false, normprob: false, scatter: false },
    save: { pred: false, zpred: false, resid: false, zresid: false },
    constant: true,
  }
  let sawStats = false
  for (const seg of segs) {
    if (!seg.length) continue
    const name = subName(seg)
    const r = rest(seg)
    const words = keywords(r)
    if (kw(name, 'DEPENDENT')) spec.dependent = varList(new Stream(r, ctx))[0]
    else if (kw(name, 'METHOD')) {
      const st = new Stream(r, ctx)
      const m = st.ident().toUpperCase()
      if (kw(m, 'STEPWISE')) spec.method = 'stepwise'
      else if (kw(m, 'FORWARD')) spec.method = 'forward'
      else if (kw(m, 'BACKWARD')) spec.method = 'backward'
      else spec.method = spec.independents.length ? spec.method : 'enter'
      spec.independents.push(...varList(st).filter((v) => !spec.independents.includes(v)))
    } else if (kw(name, 'STATISTICS')) {
      sawStats = true
      const st = spec.statistics
      st.coeff = hasKw(words, 'COEFF') || hasKw(words, 'DEFAULTS')
      st.r = words.includes('R') || hasKw(words, 'DEFAULTS')
      st.anova = hasKw(words, 'ANOVA') || hasKw(words, 'DEFAULTS')
      st.ci = words.some((w) => w === 'CI')
      if (st.ci) {
        const ciTok = r.findIndex((t) => t.t === 'id' && t.v.toUpperCase() === 'CI')
        const n = r[ciTok + 2]
        if (n && n.t === 'num') st.ciLevel = n.v
      }
      st.collin = hasKw(words, 'COLLIN')
      st.change = hasKw(words, 'CHANGE')
      st.zpp = words.includes('ZPP')
    } else if (kw(name, 'DESCRIPTIVES')) spec.statistics.descriptives = true
    else if (kw(name, 'CRITERIA')) {
      const pinI = r.findIndex((t) => t.t === 'id' && kw(t.v, 'PIN'))
      const poutI = r.findIndex((t) => t.t === 'id' && kw(t.v, 'POUT'))
      if (pinI >= 0 && r[pinI + 2]?.t === 'num') spec.pin = (r[pinI + 2] as { v: number }).v
      if (poutI >= 0 && r[poutI + 2]?.t === 'num') spec.pout = (r[poutI + 2] as { v: number }).v
    } else if (kw(name, 'ORIGIN')) spec.constant = false
    else if (kw(name, 'NOORIGIN')) spec.constant = true
    else if (kw(name, 'RESIDUALS')) {
      spec.statistics.durbin = hasKw(words, 'DURBIN')
      spec.plots.histogram = hasKw(words, 'HISTOGRAM')
      spec.plots.normprob = hasKw(words, 'NORMPROB')
    } else if (kw(name, 'SCATTERPLOT')) spec.plots.scatter = true
    else if (kw(name, 'SAVE')) {
      spec.save.pred = words.includes('PRED')
      spec.save.zpred = words.includes('ZPRED')
      spec.save.resid = words.includes('RESID')
      spec.save.zresid = words.includes('ZRESID')
    }
  }
  if (!sawStats) Object.assign(spec.statistics, { coeff: true, r: true, anova: true })
  if (!spec.dependent) ctx.fail('REGRESSION requires a /DEPENDENT variable.')
  if (!spec.independents.length) ctx.fail('REGRESSION requires a /METHOD subcommand with independent variables.')
  return [spec]
}

function parseReliability(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  let vars: string[] = []
  let scaleName = 'ALL VARIABLES'
  let model: 'alpha' | 'split' = 'alpha'
  let itemDesc = false
  let scale = false
  let corr = false
  let itemTotal = false
  for (const seg of segs) {
    if (!seg.length) continue
    const name = subName(seg)
    const r = rest(seg)
    const words = keywords(r)
    if (kw(name, 'VARIABLES')) vars = varList(new Stream(r, ctx))
    else if (kw(name, 'SCALE')) {
      const str = seg.find((t) => t.t === 'str')
      if (str) scaleName = (str as { v: string }).v
    } else if (kw(name, 'MODEL')) model = hasKw(words, 'SPLIT') ? 'split' : 'alpha'
    else if (kw(name, 'STATISTICS')) {
      itemDesc = hasKw(words, 'DESCRIPTIVE')
      scale = hasKw(words, 'SCALE')
      corr = words.includes('CORR')
    } else if (kw(name, 'SUMMARY')) itemTotal = hasKw(words, 'TOTAL') || hasKw(words, 'ALL')
  }
  if (vars.length < 2) ctx.fail('RELIABILITY requires at least two variables.')
  return [
    {
      proc: 'reliability',
      variables: vars,
      scaleName,
      model,
      itemDescriptives: itemDesc,
      scaleDescriptives: scale,
      itemTotal,
      interItemCorr: corr,
    },
  ]
}

function parseNparTests(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  const out: CommandSpec[] = []
  let expected: 'equal' | number[] = 'equal'
  for (const seg of segs) {
    if (!seg.length) continue
    const name = subName(seg)
    if (kw(name, 'EXPECTED')) {
      const r = rest(seg)
      expected = hasKw(keywords(r), 'EQUAL') ? 'equal' : numbersIn(r)
    }
  }
  for (const seg of segs) {
    if (!seg.length) continue
    const name = subName(seg)
    let r = rest(seg)
    if (kw(name, 'CHISQUARE')) {
      const st = new Stream(r, ctx)
      const vars = varList(st)
      let range: [number, number] | null = null
      if (st.eatOp('(')) {
        const a = st.number()
        st.eatOp(',')
        const b = st.number()
        st.expectOp(')')
        range = [a, b]
      }
      out.push({ proc: 'npar-chisquare', variables: vars, expected, range })
    } else if (name === 'M-W' || name === 'K-W') {
      const st = new Stream(r, ctx)
      const vars = varList(st)
      st.expectKw('BY')
      const g = varList(st)[0]
      st.expectOp('(')
      const a = st.number()
      st.eatOp(',')
      const b = st.number()
      st.expectOp(')')
      if (name === 'M-W') out.push({ proc: 'npar-mw', variables: vars, group: g, g1: a, g2: b })
      else out.push({ proc: 'npar-kw', variables: vars, group: g, min: Math.min(a, b), max: Math.max(a, b) })
    } else if (kw(name, 'WILCOXON')) {
      const st = new Stream(r, ctx)
      const a = varList(st)
      const pairs: [string, string][] = []
      if (st.eatKw('WITH', 4)) {
        const b = varList(st)
        let paired = false
        if (st.eatOp('(')) {
          paired = st.eatKw('PAIRED')
          st.eatOp(')')
        }
        if (paired) a.forEach((x, k) => pairs.push([x, b[k]]))
        else for (const x of a) for (const y of b) pairs.push([x, y])
      } else for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) pairs.push([a[i], a[j]])
      out.push({ proc: 'npar-wilcoxon', pairs })
    } else if (kw(name, 'FRIEDMAN')) {
      out.push({ proc: 'npar-friedman', variables: varList(new Stream(r, ctx)) })
    } else if (name === 'K-S') {
      // K-S(NORMAL)=vars
      if (r[0]?.t === 'op' && r[0].v === '(') {
        const close = r.findIndex((t) => t.t === 'op' && t.v === ')')
        r = r.slice(close + 1)
        if (r[0]?.t === 'op' && r[0].v === '=') r = r.slice(1)
      }
      out.push({ proc: 'npar-ks', variables: varList(new Stream(r, ctx)) })
    }
  }
  if (!out.length) ctx.fail('NPAR TESTS requires a test subcommand (CHISQUARE, M-W, WILCOXON, K-W, FRIEDMAN or K-S).')
  return out
}

function parseSummaryFn(st: Stream): BarSummary {
  const fn = st.ident().toUpperCase()
  if (kw(fn, 'COUNT')) return { kind: 'count' }
  if (kw(fn, 'PCT')) return { kind: 'pct' }
  const kind = kw(fn, 'MEAN') ? 'mean' : kw(fn, 'SUM') ? 'sum' : kw(fn, 'MEDIAN') ? 'median' : null
  if (!kind) st.ctx.fail(`Unsupported summary function ${fn}.`)
  st.expectOp('(')
  const v = varList(st)[0]
  st.expectOp(')')
  return { kind, variable: v }
}

function parseGraph(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  const out: CommandSpec[] = []
  const fit = segs.some((seg) => kw(subName(seg), 'FITLINE'))
  for (const seg of segs) {
    if (!seg.length) continue
    const name = subName(seg)
    const st = new Stream(seg.slice(1), ctx)
    let opt = ''
    if (st.eatOp('(')) {
      opt = st.ident().toUpperCase()
      st.expectOp(')')
    }
    st.eatOp('=')
    if (kw(name, 'BAR') || kw(name, 'LINE')) {
      const summary = parseSummaryFn(st)
      st.expectKw('BY')
      const cat = varList(st)[0]
      let cluster: string | null = null
      if (st.eatKw('BY')) cluster = varList(st)[0]
      if (kw(name, 'LINE')) out.push({ proc: 'graph-line', category: cat, summary })
      else out.push({ proc: 'graph-bar', category: cat, cluster: kw(opt, 'GROUPED') || cluster ? cluster : null, summary })
    } else if (kw(name, 'PIE')) {
      parseSummaryFn(st)
      st.expectKw('BY')
      out.push({ proc: 'graph-pie', category: varList(st)[0] })
    } else if (kw(name, 'HISTOGRAM')) {
      out.push({ proc: 'graph-histogram', variable: varList(st)[0], normal: kw(opt, 'NORMAL') })
    } else if (kw(name, 'SCATTERPLOT')) {
      const x = varList(st)[0]
      st.expectKw('WITH', 4)
      const y = varList(st)[0]
      let g: string | null = null
      if (st.eatKw('BY')) g = varList(st)[0]
      out.push({ proc: 'graph-scatter', x, y, group: g, fitLine: fit })
    }
  }
  if (!out.length) ctx.fail('GRAPH requires a chart subcommand such as /BAR, /PIE, /HISTOGRAM or /SCATTERPLOT.')
  return out
}

// ------------------------------------------------------------------------- transformations

function parseCompute(_s: Stream, raw: string, ctx: Ctx): CommandSpec[] {
  const body = afterWords(raw, 1)
  const parts = splitAssign(body)
  if (!parts) ctx.fail('COMPUTE requires "target = expression".')
  const [target, expr] = parts
  if (!/^[A-Za-z@#$À-￿][\w.@#$À-￿]*$/.test(target)) ctx.fail(`"${target}" is not a valid target variable name.`)
  if (!expr) ctx.fail('COMPUTE requires an expression after "=".')
  return [{ proc: 'compute', target, expression: expr, condition: null, stringWidth: null }]
}

function parseIf(_s: Stream, raw: string, ctx: Ctx): CommandSpec[] {
  const body = afterWords(raw, 1)
  const b = balanced(body)
  if (!b) ctx.fail('IF requires a condition in parentheses.')
  const [cond, restText] = b
  const parts = splitAssign(restText)
  if (!parts) ctx.fail('IF requires "target = expression" after the condition.')
  return [{ proc: 'compute', target: parts[0], expression: parts[1], condition: cond.trim(), stringWidth: null }]
}

function parseSelectIf(_s: Stream, raw: string, ctx: Ctx): CommandSpec[] {
  const body = afterWords(raw, 2).trim()
  if (!body) ctx.fail('SELECT IF requires a condition.')
  const b = balanced(body)
  const cond = b && !b[1].trim() ? b[0] : body
  return [{ proc: 'select-if', condition: cond.trim() }]
}

function parseRecodeValue(st: Stream): RecodeOld[] {
  const out: RecodeOld[] = []
  for (;;) {
    const t = st.peek()
    if (!t || (t.t === 'op' && (t.v === '=' || t.v === ')'))) break
    if (t.t === 'op' && t.v === ',') {
      st.pos++
      continue
    }
    if (t.t === 'id') {
      const w = t.v.toUpperCase()
      if (w === 'ELSE') {
        st.pos++
        out.push({ kind: 'else' })
        continue
      }
      if (w === 'SYSMIS') {
        st.pos++
        out.push({ kind: 'sysmis' })
        continue
      }
      if (w === 'MISSING') {
        st.pos++
        out.push({ kind: 'missing' })
        continue
      }
      if (kw(w, 'LOWEST', 2) || w === 'LO') {
        st.pos++
        st.expectKw('THRU', 4)
        out.push({ kind: 'lowest', high: st.number() })
        continue
      }
      st.ctx.fail(`Unexpected "${t.v}" in RECODE value list.`)
    }
    if (t.t === 'num') {
      st.pos++
      if (st.isKw('THRU', 0, 4)) {
        st.pos++
        if (st.isKw('HIGHEST', 0, 2) || st.isKw('HI', 0, 2)) {
          st.pos++
          out.push({ kind: 'highest', low: t.v })
        } else out.push({ kind: 'range', low: t.v, high: st.number() })
      } else out.push({ kind: 'value', value: t.v })
      continue
    }
    if (t.t === 'str') {
      st.pos++
      out.push({ kind: 'value', value: t.v })
      continue
    }
    st.ctx.fail(`Unexpected "${t.raw}" in RECODE value list.`)
  }
  return out
}

function parseRecode(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const out: CommandSpec[] = []
  const segs = subcommands(s.toks.slice(s.pos))
  for (const seg of segs) {
    if (!seg.length) continue
    const st = new Stream(seg, ctx)
    const vars = varList(st)
    const rules: RecodeRule[] = []
    while (st.eatOp('(')) {
      const old = parseRecodeValue(st)
      st.expectOp('=')
      const t = st.next()
      let to: RecodeNew
      if (t.t === 'num' || t.t === 'str') to = { kind: 'value', value: t.v }
      else if (t.t === 'id' && t.v.toUpperCase() === 'SYSMIS') to = { kind: 'sysmis' }
      else if (t.t === 'id' && t.v.toUpperCase() === 'COPY') to = { kind: 'copy' }
      else ctx.fail(`Invalid new value "${t.raw}" in RECODE.`)
      st.expectOp(')')
      rules.push({ old, to })
    }
    let into: string[] | null = null
    if (st.eatKw('INTO', 4)) into = varList(st, { allowNew: true })
    if (!st.atEnd()) ctx.fail(`Unexpected "${st.peek()!.raw}" in RECODE.`)
    if (!rules.length) ctx.fail('RECODE requires at least one (old=new) specification.')
    out.push({ proc: 'recode', variables: vars, into, rules, intoString: null })
  }
  return out
}

function parseSort(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  s.eatKw('BY', 2)
  const keys: { variable: string; descending: boolean }[] = []
  let pending: string[] = []
  while (!s.atEnd()) {
    if (s.eatOp('(')) {
      const d = s.ident().toUpperCase()
      s.expectOp(')')
      for (const p of pending) keys.push({ variable: p, descending: d === 'D' })
      pending = []
      continue
    }
    pending.push(...varList(s))
    if (!s.atEnd() && !s.isOp('(')) ctx.fail(`Unexpected "${s.peek()!.raw}" in SORT CASES.`)
  }
  for (const p of pending) keys.push({ variable: p, descending: false })
  if (!keys.length) ctx.fail('SORT CASES requires at least one variable.')
  return [{ proc: 'sort', keys }]
}

function parseFilter(s: Stream): CommandSpec[] {
  if (s.eatKw('OFF', 3)) return [{ proc: 'filter', variable: null }]
  s.expectKw('BY')
  return [{ proc: 'filter', variable: varList(s)[0] }]
}

function parseWeight(s: Stream): CommandSpec[] {
  if (s.eatKw('OFF', 3)) return [{ proc: 'weight', variable: null }]
  s.expectKw('BY')
  return [{ proc: 'weight', variable: varList(s)[0] }]
}

function parseSample(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const a = s.number()
  if (s.eatKw('FROM', 4)) return [{ proc: 'sample', fraction: null, count: { n: a, from: s.number() }, seed: Date.now() }]
  if (a <= 0 || a >= 1) ctx.fail('SAMPLE requires a fraction between 0 and 1, or "n FROM m".')
  return [{ proc: 'sample', fraction: a, count: null, seed: Date.now() }]
}

function parseVariableLabels(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const items: { variable: string; label: string }[] = []
  while (!s.atEnd()) {
    if (s.eatOp('/')) continue
    const names = varList(s)
    let label = ''
    // labels may be split into several strings joined with +
    label = s.string()
    while (s.eatOp('+')) label += s.string()
    for (const n of names) items.push({ variable: n, label })
    if (!names.length) ctx.fail('VARIABLE LABELS expects a variable name before each label.')
  }
  return [{ proc: 'variable-labels', items }]
}

function parseValueLabels(s: Stream, _raw: string, ctx: Ctx, add: boolean): CommandSpec[] {
  const out: CommandSpec[] = []
  while (!s.atEnd()) {
    if (s.eatOp('/')) continue
    const vars = varList(s)
    if (!vars.length) ctx.fail('VALUE LABELS expects a variable list.')
    const labels: ValueLabel[] = []
    while (!s.atEnd() && !s.isOp('/')) {
      const t = s.next()
      if (t.t !== 'num' && t.t !== 'str') ctx.fail(`Expected a value but found "${t.raw}".`)
      const label = s.string()
      labels.push({ value: (t as { v: number | string }).v, label })
    }
    out.push({ proc: 'value-labels', variables: vars, labels, add })
  }
  return out
}

function parseMissingValues(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const out: CommandSpec[] = []
  while (!s.atEnd()) {
    if (s.eatOp('/')) continue
    const vars = varList(s)
    s.expectOp('(')
    const vals: (number | string)[] = []
    let range: { low: number; high: number } | null = null
    while (!s.isOp(')')) {
      if (s.eatOp(',')) continue
      const t = s.next()
      if (t.t === 'id' && (kw(t.v, 'LOWEST', 2) || kw(t.v, 'LO', 2))) {
        s.expectKw('THRU', 4)
        range = { low: -Infinity, high: s.number() }
      } else if (t.t === 'num' && s.isKw('THRU', 0, 4)) {
        s.pos++
        if (s.isKw('HIGHEST', 0, 2) || s.isKw('HI', 0, 2)) {
          s.pos++
          range = { low: t.v, high: Infinity }
        } else range = { low: t.v, high: s.number() }
      } else if (t.t === 'num' || t.t === 'str') vals.push(t.v)
      else ctx.fail(`Unexpected "${t.raw}" in MISSING VALUES.`)
    }
    s.expectOp(')')
    let missing: MissingSpec
    if (range) missing = { kind: 'range', low: range.low, high: range.high, value: typeof vals[0] === 'number' ? (vals[0] as number) : undefined }
    else if (vals.length) missing = { kind: 'discrete', values: vals.slice(0, 3) }
    else missing = { kind: 'none' }
    out.push({ proc: 'missing-values', variables: vars, missing })
  }
  return out
}

function parseVariableLevel(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const out: CommandSpec[] = []
  while (!s.atEnd()) {
    if (s.eatOp('/')) continue
    const vars = varList(s)
    s.expectOp('(')
    const w = s.ident().toUpperCase()
    s.expectOp(')')
    const level: Measure | null = kw(w, 'SCALE') ? 'scale' : kw(w, 'ORDINAL') ? 'ordinal' : kw(w, 'NOMINAL') ? 'nominal' : null
    if (!level) ctx.fail(`Unknown measurement level ${w}.`)
    out.push({ proc: 'variable-level', variables: vars, level })
  }
  return out
}

function parseFormats(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const out: CommandSpec[] = []
  while (!s.atEnd()) {
    if (s.eatOp('/')) continue
    const vars = varList(s)
    s.expectOp('(')
    const f = s.ident()
    s.expectOp(')')
    const m = /^[A-Za-z]+(\d+)(?:\.(\d+))?$/.exec(f.replace(/\.$/, ''))
    // the tokenizer splits "F8.2" into id "F8.2"
    if (!m) ctx.fail(`Invalid format ${f}.`)
    out.push({ proc: 'formats', variables: vars, width: Number(m[1]), decimals: Number(m[2] ?? 0) })
  }
  return out
}

function parseStringDecl(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const out: CommandSpec[] = []
  while (!s.atEnd()) {
    if (s.eatOp('/')) continue
    const vars = varList(s, { allowNew: true })
    s.expectOp('(')
    const f = s.ident()
    s.expectOp(')')
    const m = /^A(\d+)$/i.exec(f)
    if (!m) ctx.fail(`Invalid string format ${f}; use e.g. (A8).`)
    out.push({ proc: 'string', variables: vars, width: Number(m[1]) })
  }
  return out
}

function parseNumericDecl(s: Stream): CommandSpec[] {
  const vars = varList(s, { allowNew: true })
  let decimals = 2
  if (s.eatOp('(')) {
    const f = s.ident()
    s.expectOp(')')
    const m = /^F\d+\.(\d+)$/i.exec(f)
    if (m) decimals = Number(m[1])
  }
  return [{ proc: 'numeric', variables: vars, decimals }]
}

function parseRename(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const from: string[] = []
  const to: string[] = []
  while (!s.atEnd()) {
    const paren = s.eatOp('(')
    const a = varList(s)
    s.expectOp('=')
    const b = varList(s, { allowNew: true })
    if (paren) s.expectOp(')')
    if (a.length !== b.length) ctx.fail('RENAME VARIABLES: the old and new name lists must have the same length.')
    from.push(...a)
    to.push(...b)
  }
  return [{ proc: 'rename', from, to }]
}

function parseAutorecode(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  let vars: string[] = []
  let into: string[] = []
  let desc = false
  for (const seg of segs) {
    if (!seg.length) continue
    const name = subName(seg)
    if (kw(name, 'VARIABLES')) vars = varList(new Stream(rest(seg), ctx))
    else if (kw(name, 'INTO')) into = varList(new Stream(rest(seg), ctx), { allowNew: true })
    else if (kw(name, 'DESCENDING')) desc = true
  }
  if (!vars.length || vars.length !== into.length) ctx.fail('AUTORECODE requires VARIABLES= and an INTO list of the same length.')
  return [{ proc: 'autorecode', variables: vars, into, descending: desc }]
}

function parseRank(s: Stream, _raw: string, ctx: Ctx): CommandSpec[] {
  const segs = subcommands(s.toks.slice(s.pos))
  let vars: string[] = []
  let into: string[] = []
  let desc = false
  for (const seg of segs) {
    if (!seg.length) continue
    const name = subName(seg)
    if (kw(name, 'VARIABLES')) {
      const st = new Stream(rest(seg), ctx)
      vars = varList(st)
      if (st.eatOp('(')) {
        desc = st.ident().toUpperCase() === 'D'
        st.expectOp(')')
      }
    } else if (kw(name, 'RANK')) {
      const st = new Stream(seg.slice(1), ctx)
      if (st.eatKw('INTO', 4)) into = varList(st, { allowNew: true })
    }
  }
  if (!vars.length) ctx.fail('RANK requires VARIABLES=.')
  if (!into.length) into = vars.map((v) => `R${v}`.slice(0, 64))
  return [{ proc: 'rank', variables: vars, into, descending: desc }]
}
