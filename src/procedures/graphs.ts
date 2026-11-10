import { isMissing, type Dataset, type Variable } from '../core/dataset'
import { out, type OutputItem } from '../core/output'
import { mean, median, sortedCopy, summarize } from '../stats/basic'
import { pearsonTest } from '../stats/tests'
import {
  analysisCases,
  catKey,
  catLabel,
  categoriesOf,
  histogramBins,
  listwiseCases,
  requireNumeric,
  resolveVar,
  validNumbers,
  vlabel,
} from './common'
import type { BarSummary, GraphBarSpec, GraphHistogramSpec, GraphLineSpec, GraphPieSpec, GraphScatterSpec } from './types'

function summaryLabel(s: BarSummary, ds: Dataset): string {
  if (s.kind === 'count') return 'Count'
  if (s.kind === 'pct') return 'Percent'
  const v = resolveVar(ds, s.variable)
  return `${s.kind === 'mean' ? 'Mean' : s.kind === 'sum' ? 'Sum' : 'Median'} ${vlabel(v)}`
}

function summarizeCases(ds: Dataset, s: BarSummary, cases: number[], total: number): number {
  if (s.kind === 'count') return cases.length
  if (s.kind === 'pct') return total ? (100 * cases.length) / total : 0
  const v = resolveVar(ds, s.variable)
  const xs = validNumbers(ds, v, cases)
  if (!xs.length) return NaN
  if (s.kind === 'mean') return mean(xs)
  if (s.kind === 'sum') return xs.reduce((a, b) => a + b, 0)
  return median(sortedCopy(xs))
}

function casesWith(ds: Dataset, v: Variable, cases: number[], cat: number | string): number[] {
  const key = catKey(v, cat)
  return cases.filter((i) => {
    const x = ds.data[v.id][i]
    if (isMissing(v, x)) return false
    return catKey(v, v.type === 'string' ? String(x).trimEnd() : (x as number)) === key
  })
}

export function runGraphBar(ds: Dataset, spec: GraphBarSpec): OutputItem[] {
  const cat = resolveVar(ds, spec.category)
  const cl = spec.cluster ? resolveVar(ds, spec.cluster) : null
  let cases = analysisCases(ds).filter((i) => !isMissing(cat, ds.data[cat.id][i]))
  if (cl) cases = cases.filter((i) => !isMissing(cl, ds.data[cl.id][i]))
  if (spec.summary.kind !== 'count' && spec.summary.kind !== 'pct') requireNumeric(resolveVar(ds, spec.summary.variable), 'GRAPH')
  const cats = categoriesOf(ds, cat, cases)
  const yLabel = summaryLabel(spec.summary, ds)
  const series = cl
    ? categoriesOf(ds, cl, cases).map((c) => ({
        name: catLabel(cl, c),
        values: cats.map((k) => summarizeCases(ds, spec.summary, casesWith(ds, cl, casesWith(ds, cat, cases, k), c), cases.length)),
      }))
    : [{ name: yLabel, values: cats.map((k) => summarizeCases(ds, spec.summary, casesWith(ds, cat, cases, k), cases.length)) }]
  return [
    out.title('Graph'),
    out.chart({
      type: 'bar',
      title: cl ? `${yLabel} by ${vlabel(cat)} and ${vlabel(cl)}` : `${yLabel} by ${vlabel(cat)}`,
      xLabel: vlabel(cat),
      yLabel,
      categories: cats.map((c) => catLabel(cat, c)),
      series,
      percent: spec.summary.kind === 'pct',
    }),
  ]
}

export function runGraphLine(ds: Dataset, spec: GraphLineSpec): OutputItem[] {
  const cat = resolveVar(ds, spec.category)
  const cases = analysisCases(ds).filter((i) => !isMissing(cat, ds.data[cat.id][i]))
  const cats = categoriesOf(ds, cat, cases)
  const yLabel = summaryLabel(spec.summary, ds)
  return [
    out.title('Graph'),
    out.chart({
      type: 'line',
      title: `${yLabel} by ${vlabel(cat)}`,
      xLabel: vlabel(cat),
      yLabel,
      categories: cats.map((c) => catLabel(cat, c)),
      values: cats.map((k) => {
        const v = summarizeCases(ds, spec.summary, casesWith(ds, cat, cases, k), cases.length)
        return Number.isFinite(v) ? v : null
      }),
    }),
  ]
}

export function runGraphPie(ds: Dataset, spec: GraphPieSpec): OutputItem[] {
  const cat = resolveVar(ds, spec.category)
  const cases = analysisCases(ds).filter((i) => !isMissing(cat, ds.data[cat.id][i]))
  const cats = categoriesOf(ds, cat, cases)
  return [
    out.title('Graph'),
    out.chart({
      type: 'pie',
      title: `Pie Chart of ${vlabel(cat)}`,
      legendTitle: vlabel(cat),
      categories: cats.map((c) => catLabel(cat, c)),
      values: cats.map((k) => casesWith(ds, cat, cases, k).length),
    }),
  ]
}

export function runGraphHistogram(ds: Dataset, spec: GraphHistogramSpec): OutputItem[] {
  const v = resolveVar(ds, spec.variable)
  requireNumeric(v, 'GRAPH')
  const xs = validNumbers(ds, v, analysisCases(ds))
  const s = summarize(xs)
  return [
    out.title('Graph'),
    out.chart({
      type: 'histogram',
      title: `Histogram of ${vlabel(v)}`,
      xLabel: vlabel(v),
      bins: histogramBins(xs),
      normal: spec.normal ? { mean: s.mean, sd: s.sd, n: s.n } : undefined,
      stats: { mean: s.mean, sd: s.sd, n: s.n },
    }),
  ]
}

export function runGraphScatter(ds: Dataset, spec: GraphScatterSpec): OutputItem[] {
  const x = resolveVar(ds, spec.x)
  const y = resolveVar(ds, spec.y)
  requireNumeric(x, 'GRAPH')
  requireNumeric(y, 'GRAPH')
  const g = spec.group ? resolveVar(ds, spec.group) : null
  const cases = listwiseCases(ds, g ? [x, y, g] : [x, y], analysisCases(ds))
  const pts = (cs: number[]) => cs.map((i) => [ds.data[x.id][i] as number, ds.data[y.id][i] as number] as [number, number])
  const groups = g
    ? categoriesOf(ds, g, cases).map((c) => ({ name: catLabel(g, c), points: pts(casesWith(ds, g, cases, c)) }))
    : [{ name: vlabel(y), points: pts(cases) }]
  const lines: { slope: number; intercept: number; label?: string }[] = []
  if (spec.fitLine && cases.length > 2) {
    const xs = cases.map((i) => ds.data[x.id][i] as number)
    const ys = cases.map((i) => ds.data[y.id][i] as number)
    const mx = mean(xs)
    const my = mean(ys)
    let sxy = 0
    let sxx = 0
    xs.forEach((xv, i) => {
      sxy += (xv - mx) * (ys[i] - my)
      sxx += (xv - mx) ** 2
    })
    const slope = sxy / sxx
    const r = pearsonTest(xs, ys).r
    lines.push({ slope, intercept: my - slope * mx, label: `R² Linear = ${(r * r).toFixed(3)}` })
  }
  return [
    out.title('Graph'),
    out.chart({
      type: 'scatter',
      title: `${vlabel(y)} by ${vlabel(x)}`,
      xLabel: vlabel(x),
      yLabel: vlabel(y),
      groups,
      lines,
    }),
  ]
}
