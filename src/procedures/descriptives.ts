import { createVariable, insertVariable, isUserMissing, nextSuffixName, uniqueVarName, type Dataset } from '../core/dataset'
import { fmtCount, fmtNum, statDecimals } from '../core/format'
import { out, type ColumnNode, type OutputItem, type RowNode } from '../core/output'
import { summarize, type Summary } from '../stats/basic'
import { analysisCases, listwiseCases, requireNumeric, resolveVars, validNumbers, vlabel } from './common'
import type { DescriptivesSpec } from './types'

export function runDescriptives(ds: Dataset, spec: DescriptivesSpec): { items: OutputItem[]; dataset?: Dataset } {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'DESCRIPTIVES'))
  const cases = analysisCases(ds)
  const sums: Summary[] = vars.map((v) => summarize(validNumbers(ds, v, cases)))
  const stats = new Set(spec.statistics)

  let order = vars.map((_, i) => i)
  if (spec.sort === 'alpha') order.sort((a, b) => vars[a].name.localeCompare(vars[b].name))
  else if (spec.sort === 'mean-a') order.sort((a, b) => sums[a].mean - sums[b].mean)
  else if (spec.sort === 'mean-d') order.sort((a, b) => sums[b].mean - sums[a].mean)

  const cols: ColumnNode[] = [{ label: 'N', children: [{ label: 'Statistic' }] }]
  const getters: ((s: Summary, k: number) => string)[] = [(s) => fmtCount(s.n)]
  const add = (label: string, fn: (s: Summary, k: number) => string) => {
    cols.push({ label, children: [{ label: 'Statistic' }] })
    getters.push(fn)
  }
  const anySE = stats.has('semean') || stats.has('skewness') || stats.has('kurtosis')
  if (stats.has('range')) add('Range', (s, k) => fmtNum(s.range, vars[k].decimals))
  if (stats.has('min')) add('Minimum', (s, k) => fmtNum(s.min, vars[k].decimals))
  if (stats.has('max')) add('Maximum', (s, k) => fmtNum(s.max, vars[k].decimals))
  if (stats.has('sum')) add('Sum', (s, k) => fmtNum(s.sum, vars[k].decimals))
  if (stats.has('mean')) {
    if (stats.has('semean')) {
      cols.push({ label: 'Mean', children: [{ label: 'Statistic' }, { label: 'Std. Error' }] })
      getters.push((s, k) => fmtNum(s.mean, statDecimals(vars[k])))
      getters.push((s, k) => fmtNum(s.se, statDecimals(vars[k], 3)))
    } else add('Mean', (s, k) => fmtNum(s.mean, statDecimals(vars[k])))
  }
  if (stats.has('stddev')) add('Std. Deviation', (s, k) => fmtNum(s.sd, statDecimals(vars[k], 3)))
  if (stats.has('variance')) add('Variance', (s, k) => fmtNum(s.variance, statDecimals(vars[k], 3)))
  if (stats.has('skewness')) {
    cols.push({ label: 'Skewness', children: [{ label: 'Statistic' }, { label: 'Std. Error' }] })
    getters.push((s) => fmtNum(s.skew, 3))
    getters.push((s) => fmtNum(s.seSkew, 3))
  }
  if (stats.has('kurtosis')) {
    cols.push({ label: 'Kurtosis', children: [{ label: 'Statistic' }, { label: 'Std. Error' }] })
    getters.push((s) => fmtNum(s.kurt, 3))
    getters.push((s) => fmtNum(s.seKurt, 3))
  }
  // SPSS only shows the "Statistic" sub-header when some column needs a "Std. Error".
  const columns: ColumnNode[] = anySE ? cols : cols.map((c) => ({ label: c.label }))

  const rows: RowNode[] = order.map((k) => ({ label: vlabel(vars[k]), cells: getters.map((g) => g(sums[k], k)) }))
  const listwiseN = listwiseCases(ds, vars, cases).length
  rows.push({ label: 'Valid N (listwise)', cells: [fmtCount(listwiseN), ...getters.slice(1).map(() => '')] })

  const items: OutputItem[] = [
    out.title('Descriptives'),
    out.table({ title: 'Descriptive Statistics', columns, rows }),
  ]

  let dataset: Dataset | undefined
  if (spec.saveZ) {
    dataset = ds
    const created: string[] = []
    const active = new Set(cases)
    vars.forEach((v, k) => {
      const s = sums[k]
      if (!(s.sd > 0)) return
      const base = `Z${v.name}`.slice(0, 64)
      const name = uniqueVarName(dataset!, base) === base ? base : nextSuffixName(dataset!, 'ZSC')
      const col = dataset!.data[v.id]
      const vals = col.map((x, i) => {
        if (typeof x !== 'number' || Number.isNaN(x) || isUserMissing(v, x) || !active.has(i)) return null
        return (x - s.mean) / s.sd
      })
      const nv = createVariable(name, {
        decimals: 5,
        width: 11,
        label: `Zscore${v.label ? `: ${v.label}` : `(${v.name})`}`,
        measure: 'scale',
      })
      dataset = insertVariable(dataset!, dataset!.variables.length, nv, vals)
      created.push(`${name} (from ${v.name})`)
    })
    if (created.length) items.push(out.text(`Standardized values saved as new variables: ${created.join(', ')}.`, 'note', 'Notes'))
  }
  return { items, dataset }
}
