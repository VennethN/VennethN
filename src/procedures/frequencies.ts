import { isSysMissing, isUserMissing, type Dataset, type Variable } from '../core/dataset'
import { fmtCount, fmtNum, fmtPct, statDecimals } from '../core/format'
import { out, type Cell, type OutputItem, type RowNode } from '../core/output'
import { mode, percentileHaverage, sortedCopy, summarize } from '../stats/basic'
import {
  analysisCases,
  catKey,
  catLabel,
  histogramBins,
  Notes,
  resolveVars,
  sortCategories,
  vlabel,
} from './common'
import type { FrequenciesSpec, FreqStat } from './types'

export interface FreqRow {
  value: number | string
  label: string
  count: number
}

export interface FreqTable {
  valid: FreqRow[]
  userMissing: FreqRow[]
  sysMissing: number
  nValid: number
  nMissing: number
  total: number
}

export function frequencyTable(ds: Dataset, v: Variable, cases: number[]): FreqTable {
  const col = ds.data[v.id]
  const valid = new Map<string, FreqRow>()
  const miss = new Map<string, FreqRow>()
  let sys = 0
  for (const i of cases) {
    const x = col[i]
    if (isSysMissing(v, x)) {
      sys++
      continue
    }
    const val = v.type === 'string' ? String(x ?? '').trimEnd() : (x as number)
    const key = catKey(v, val)
    const target = isUserMissing(v, x) ? miss : valid
    const r = target.get(key)
    if (r) r.count++
    else target.set(key, { value: val, label: catLabel(v, val), count: 1 })
  }
  const sortRows = (rows: FreqRow[]) => {
    const vals = sortCategories(v, rows.map((r) => r.value))
    const byKey = new Map(rows.map((r) => [catKey(v, r.value), r]))
    return vals.map((x) => byKey.get(catKey(v, x))!)
  }
  const validRows = sortRows([...valid.values()])
  const missRows = sortRows([...miss.values()])
  const nValid = validRows.reduce((s, r) => s + r.count, 0)
  const nMissing = missRows.reduce((s, r) => s + r.count, 0) + sys
  return { valid: validRows, userMissing: missRows, sysMissing: sys, nValid, nMissing, total: nValid + nMissing }
}

const STAT_ORDER: FreqStat[] = [
  'mean',
  'semean',
  'median',
  'mode',
  'stddev',
  'variance',
  'skewness',
  'kurtosis',
  'range',
  'minimum',
  'maximum',
  'sum',
]

export function runFrequencies(ds: Dataset, spec: FrequenciesSpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  const cases = analysisCases(ds)
  const items: OutputItem[] = [out.title('Frequencies')]
  const tables = vars.map((v) => frequencyTable(ds, v, cases))

  // ---------------- Statistics table
  const notes = new Notes()
  const pcts = [...(spec.quartiles ? [25, 50, 75] : []), ...spec.percentiles]
  const uniqPcts = [...new Set(pcts)].sort((a, b) => a - b)
  const statRows: RowNode[] = [
    {
      label: 'N',
      children: [
        { label: 'Valid', cells: tables.map((t) => fmtCount(t.nValid)) },
        { label: 'Missing', cells: tables.map((t) => fmtCount(t.nMissing)) },
      ],
    },
  ]
  const values = vars.map((v) => {
    if (v.type !== 'numeric') return [] as number[]
    const col = ds.data[v.id]
    const xs: number[] = []
    for (const i of cases) {
      const x = col[i]
      if (typeof x === 'number' && !Number.isNaN(x) && !isUserMissing(v, x)) xs.push(x)
    }
    return xs
  })
  const sums = values.map((xs) => (xs.length ? summarize(xs) : null))
  const sorted = values.map((xs) => sortedCopy(xs))
  const cell = (fn: (k: number) => Cell): Cell[] => vars.map((v, k) => (v.type !== 'numeric' || !sums[k] ? '' : fn(k)))
  const stats = new Set(spec.statistics)
  for (const st of STAT_ORDER) {
    if (!stats.has(st)) continue
    switch (st) {
      case 'mean':
        statRows.push({ label: 'Mean', cells: cell((k) => fmtNum(sums[k]!.mean, statDecimals(vars[k]))) })
        break
      case 'semean':
        statRows.push({ label: 'Std. Error of Mean', cells: cell((k) => fmtNum(sums[k]!.se, statDecimals(vars[k], 3))) })
        break
      case 'median':
        statRows.push({ label: 'Median', cells: cell((k) => fmtNum(sums[k]!.median, statDecimals(vars[k]))) })
        break
      case 'mode':
        statRows.push({
          label: 'Mode',
          cells: cell((k) => {
            const m = mode(values[k])
            return m.multiple
              ? { text: fmtNum(m.value, vars[k].decimals), sup: notes.mark('Multiple modes exist. The smallest value is shown') }
              : fmtNum(m.value, vars[k].decimals)
          }),
        })
        break
      case 'stddev':
        statRows.push({ label: 'Std. Deviation', cells: cell((k) => fmtNum(sums[k]!.sd, statDecimals(vars[k], 3))) })
        break
      case 'variance':
        statRows.push({ label: 'Variance', cells: cell((k) => fmtNum(sums[k]!.variance, statDecimals(vars[k], 3))) })
        break
      case 'skewness':
        statRows.push({ label: 'Skewness', cells: cell((k) => fmtNum(sums[k]!.skew, 3)) })
        statRows.push({ label: 'Std. Error of Skewness', cells: cell((k) => fmtNum(sums[k]!.seSkew, 3)) })
        break
      case 'kurtosis':
        statRows.push({ label: 'Kurtosis', cells: cell((k) => fmtNum(sums[k]!.kurt, 3)) })
        statRows.push({ label: 'Std. Error of Kurtosis', cells: cell((k) => fmtNum(sums[k]!.seKurt, 3)) })
        break
      case 'range':
        statRows.push({ label: 'Range', cells: cell((k) => fmtNum(sums[k]!.range, vars[k].decimals)) })
        break
      case 'minimum':
        statRows.push({ label: 'Minimum', cells: cell((k) => fmtNum(sums[k]!.min, vars[k].decimals)) })
        break
      case 'maximum':
        statRows.push({ label: 'Maximum', cells: cell((k) => fmtNum(sums[k]!.max, vars[k].decimals)) })
        break
      case 'sum':
        statRows.push({ label: 'Sum', cells: cell((k) => fmtNum(sums[k]!.sum, vars[k].decimals)) })
        break
    }
  }
  if (uniqPcts.length)
    statRows.push({
      label: 'Percentiles',
      children: uniqPcts.map((p) => ({
        label: String(p),
        cells: cell((k) => fmtNum(percentileHaverage(sorted[k], p / 100), statDecimals(vars[k]))),
      })),
    })
  items.push(
    out.table({
      title: 'Statistics',
      columns: vars.map((v) => ({ label: vlabel(v) })),
      rows: statRows,
      footnotes: notes.footnotes,
    }),
  )

  // ---------------- Frequency tables
  if (spec.showTables) {
    vars.forEach((v, k) => {
      const t = tables[k]
      let rows = t.valid.slice()
      if (spec.order === 'dvalue') rows.reverse()
      else if (spec.order === 'afreq') rows = rows.sort((a, b) => a.count - b.count)
      else if (spec.order === 'dfreq') rows = rows.sort((a, b) => b.count - a.count)
      let cum = 0
      const validRows: RowNode[] = rows.map((r) => {
        cum += r.count
        return {
          label: r.label,
          cells: [
            fmtCount(r.count),
            fmtPct((100 * r.count) / t.total),
            fmtPct((100 * r.count) / t.nValid),
            fmtPct((100 * cum) / t.nValid),
          ],
        }
      })
      validRows.push({
        label: 'Total',
        cells: [fmtCount(t.nValid), fmtPct((100 * t.nValid) / t.total), t.nValid ? '100.0' : '', ''],
      })
      const body: RowNode[] = []
      if (t.nValid > 0) body.push({ label: 'Valid', children: validRows })
      if (t.nMissing > 0) {
        const missRows: RowNode[] = t.userMissing.map((r) => ({
          label: r.label,
          cells: [fmtCount(r.count), fmtPct((100 * r.count) / t.total), '', ''],
        }))
        if (t.sysMissing) missRows.push({ label: 'System', cells: [fmtCount(t.sysMissing), fmtPct((100 * t.sysMissing) / t.total), '', ''] })
        missRows.push({ label: 'Total', cells: [fmtCount(t.nMissing), fmtPct((100 * t.nMissing) / t.total), '', ''] })
        body.push({ label: 'Missing', children: missRows })
        body.push({ label: 'Total', cells: [fmtCount(t.total), '100.0', '', ''] })
      }
      items.push(
        out.table({
          title: vlabel(v),
          columns: [{ label: 'Frequency' }, { label: 'Percent' }, { label: 'Valid Percent' }, { label: 'Cumulative Percent' }],
          rows: body,
        }),
      )
    })
  }

  // ---------------- Charts
  if (spec.chart !== 'none') {
    vars.forEach((v, k) => {
      const t = tables[k]
      const title = vlabel(v)
      if (spec.chart === 'histogram') {
        if (v.type !== 'numeric' || !values[k].length) return
        const s = sums[k]!
        items.push(
          out.chart({
            type: 'histogram',
            title,
            xLabel: vlabel(v),
            bins: histogramBins(values[k]),
            normal: spec.normalCurve ? { mean: s.mean, sd: s.sd, n: s.n } : undefined,
            stats: { mean: s.mean, sd: s.sd, n: s.n },
          }),
        )
      } else if (spec.chart === 'bar') {
        items.push(
          out.chart({
            type: 'bar',
            title,
            xLabel: vlabel(v),
            yLabel: spec.chartValues === 'percent' ? 'Percent' : 'Frequency',
            categories: t.valid.map((r) => r.label),
            series: [
              {
                name: title,
                values: t.valid.map((r) => (spec.chartValues === 'percent' ? (100 * r.count) / t.nValid : r.count)),
              },
            ],
            percent: spec.chartValues === 'percent',
          }),
        )
      } else if (spec.chart === 'pie') {
        items.push(
          out.chart({
            type: 'pie',
            title,
            legendTitle: vlabel(v),
            categories: t.valid.map((r) => r.label),
            values: t.valid.map((r) => r.count),
          }),
        )
      }
    })
  }
  return items
}
