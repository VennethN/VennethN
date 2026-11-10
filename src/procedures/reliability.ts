import type { Dataset } from '../core/dataset'
import { fmtCount, fmtNum, fmtPct, statDecimals } from '../core/format'
import { out, type ColumnNode, type OutputItem, type RowNode } from '../core/output'
import { mean, pearson, variance } from '../stats/basic'
import { correlationMatrix, invertSymmetric } from '../stats/matrix'
import { analysisCases, listwiseCases, Notes, ProcError, requireNumeric, resolveVars, vlabel } from './common'
import type { ReliabilitySpec } from './types'

export function cronbachAlpha(items: number[][]): number {
  const k = items.length
  const n = items[0]?.length ?? 0
  const totals = new Array<number>(n).fill(0)
  for (const it of items) for (let i = 0; i < n; i++) totals[i] += it[i]
  const sumVar = items.reduce((s, it) => s + variance(it), 0)
  return (k / (k - 1)) * (1 - sumVar / variance(totals))
}

export function standardizedAlpha(items: number[][]): number {
  const k = items.length
  const r = correlationMatrix(items)
  let s = 0
  let c = 0
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      s += r[i][j]
      c++
    }
  const rbar = s / c
  return (k * rbar) / (1 + (k - 1) * rbar)
}

export function runReliability(ds: Dataset, spec: ReliabilitySpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'RELIABILITY'))
  if (vars.length < 2) throw new ProcError('RELIABILITY requires at least two items.')
  const all = analysisCases(ds)
  const cases = listwiseCases(ds, vars, all)
  const n = cases.length
  const items = vars.map((v) => cases.map((i) => ds.data[v.id][i] as number))
  const k = vars.length
  const out_: OutputItem[] = [out.title('Reliability'), out.title(`Scale: ${spec.scaleName || 'ALL VARIABLES'}`)]
  const notes = new Notes()
  const aMark = notes.mark('Listwise deletion based on all variables in the procedure.')
  out_.push(
    out.table({
      title: 'Case Processing Summary',
      columns: [{ label: 'N' }, { label: '%' }],
      rows: [
        {
          label: 'Cases',
          children: [
            { label: 'Valid', cells: [fmtCount(n), fmtPct(all.length ? (100 * n) / all.length : 0)] },
            { label: 'Excluded', sup: aMark, cells: [fmtCount(all.length - n), fmtPct(all.length ? (100 * (all.length - n)) / all.length : 0)] },
            { label: 'Total', cells: [fmtCount(all.length), '100.0'] },
          ],
        },
      ],
      footnotes: notes.footnotes,
    }),
  )
  if (n < 2) {
    out_.push(out.text('There are too few cases (N < 2) for the analysis.', 'warning', 'Warnings'))
    return out_
  }
  const totals = cases.map((_, r) => items.reduce((s, it) => s + it[r], 0))
  const alpha = cronbachAlpha(items)
  const showStd = spec.interItemCorr

  if (spec.model === 'split') {
    const k1 = Math.ceil(k / 2)
    const p1 = items.slice(0, k1)
    const p2 = items.slice(k1)
    const sum = (part: number[][]) => cases.map((_, r) => part.reduce((s, it) => s + it[r], 0))
    const s1 = sum(p1)
    const s2 = sum(p2)
    const r = pearson(s1, s2)
    const k2 = k - k1
    const sbEqual = (2 * r) / (1 + r)
    const r2 = r * r
    const f = (k1 * k2) / (k * k)
    const sbUnequal = (-r2 + Math.sqrt(r2 * r2 + 4 * r2 * (1 - r2) * f)) / (2 * (1 - r2) * f)
    const guttman = 2 * (1 - (variance(s1) + variance(s2)) / variance(totals))
    const partNotes = new Notes()
    const am = partNotes.mark(`The items are: ${vars.slice(0, k1).map(vlabel).join(', ')}.`)
    const bm = partNotes.mark(`The items are: ${vars.slice(k1).map(vlabel).join(', ')}.`)
    out_.push(
      out.table({
        title: 'Reliability Statistics',
        columns: [{ label: 'Value' }],
        rows: [
          {
            label: "Cronbach's Alpha",
            children: [
              { label: 'Part 1', children: [{ label: 'Value', cells: [p1.length > 1 ? fmtNum(cronbachAlpha(p1), 3) : '.'] }, { label: 'N of Items', cells: [{ text: String(k1), sup: am }] }] },
              { label: 'Part 2', children: [{ label: 'Value', cells: [p2.length > 1 ? fmtNum(cronbachAlpha(p2), 3) : '.'] }, { label: 'N of Items', cells: [{ text: String(k2), sup: bm }] }] },
              { label: 'Total N of Items', cells: [String(k)] },
            ],
          },
          { label: 'Correlation Between Forms', cells: [fmtNum(r, 3)] },
          { label: 'Spearman-Brown Coefficient', children: [{ label: 'Equal Length', cells: [fmtNum(sbEqual, 3)] }, { label: 'Unequal Length', cells: [fmtNum(sbUnequal, 3)] }] },
          { label: 'Guttman Split-Half Coefficient', cells: [fmtNum(guttman, 3)] },
        ],
        footnotes: partNotes.footnotes,
      }),
    )
  } else {
    const cols: ColumnNode[] = [{ label: "Cronbach's Alpha" }]
    const cells = [fmtNum(alpha, 3)]
    if (showStd) {
      cols.push({ label: "Cronbach's Alpha Based on Standardized Items" })
      cells.push(fmtNum(standardizedAlpha(items), 3))
    }
    cols.push({ label: 'N of Items' })
    cells.push(String(k))
    out_.push(out.table({ title: 'Reliability Statistics', columns: cols, rows: [{ label: '', cells }] }))
  }

  if (spec.itemDescriptives) {
    out_.push(
      out.table({
        title: 'Item Statistics',
        columns: [{ label: 'Mean' }, { label: 'Std. Deviation' }, { label: 'N' }],
        rows: vars.map((v, j) => ({
          label: vlabel(v),
          cells: [fmtNum(mean(items[j]), statDecimals(v)), fmtNum(Math.sqrt(variance(items[j])), statDecimals(v, 3)), fmtCount(n)],
        })),
      }),
    )
  }
  const corr = correlationMatrix(items)
  if (spec.interItemCorr) {
    out_.push(
      out.table({
        title: 'Inter-Item Correlation Matrix',
        columns: vars.map((v) => ({ label: vlabel(v) })),
        rows: vars.map((v, i) => ({ label: vlabel(v), cells: vars.map((_, j) => fmtNum(corr[i][j], 3)) })),
      }),
    )
  }
  if (spec.itemTotal) {
    const inv = spec.interItemCorr ? invertSymmetric(corr) : null
    const rows: RowNode[] = vars.map((v, j) => {
      const rest = cases.map((_, r) => totals[r] - items[j][r])
      const restItems = items.filter((_, i) => i !== j)
      const cells = [
        fmtNum(mean(rest), statDecimals(v)),
        fmtNum(variance(rest), 3),
        fmtNum(pearson(items[j], rest), 3),
      ]
      if (spec.interItemCorr) cells.push(inv ? fmtNum(1 - 1 / inv[j][j], 3) : '.')
      cells.push(restItems.length > 1 ? fmtNum(cronbachAlpha(restItems), 3) : '.')
      return { label: vlabel(v), cells }
    })
    const cols: ColumnNode[] = [
      { label: 'Scale Mean if Item Deleted' },
      { label: 'Scale Variance if Item Deleted' },
      { label: 'Corrected Item-Total Correlation' },
    ]
    if (spec.interItemCorr) cols.push({ label: 'Squared Multiple Correlation' })
    cols.push({ label: "Cronbach's Alpha if Item Deleted" })
    out_.push(out.table({ title: 'Item-Total Statistics', columns: cols, rows }))
  }
  if (spec.scaleDescriptives) {
    out_.push(
      out.table({
        title: 'Scale Statistics',
        columns: [{ label: 'Mean' }, { label: 'Variance' }, { label: 'Std. Deviation' }, { label: 'N of Items' }],
        rows: [{ label: '', cells: [fmtNum(mean(totals), 2), fmtNum(variance(totals), 3), fmtNum(Math.sqrt(variance(totals)), 3), String(k)] }],
      }),
    )
  }
  return out_
}
