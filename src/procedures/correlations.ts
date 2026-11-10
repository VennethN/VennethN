import type { Dataset, Variable } from '../core/dataset'
import { fmtCount, fmtNum, fmtSig, statDecimals } from '../core/format'
import { out, type Cell, type OutputItem, type RowNode } from '../core/output'
import { summarize } from '../stats/basic'
import { kendallTauB, pearsonTest, spearman } from '../stats/tests'
import { analysisCases, listwiseCases, Notes, requireNumeric, resolveVars, vlabel } from './common'
import type { CorrelationsSpec, NonparCorrSpec } from './types'

function pairData(ds: Dataset, a: Variable, b: Variable, cases: number[]): [number[], number[]] {
  const valid = listwiseCases(ds, [a, b], cases)
  return [valid.map((i) => ds.data[a.id][i] as number), valid.map((i) => ds.data[b.id][i] as number)]
}

function flagCell(value: string, p: number, flag: boolean, notes: Notes, tails: 1 | 2): Cell {
  if (!flag || !(p < 0.05)) return value
  if (p < 0.01) return { text: value, sup: notes.symbol('**', `Correlation is significant at the 0.01 level (${tails}-tailed).`) }
  return { text: value, sup: notes.symbol('*', `Correlation is significant at the 0.05 level (${tails}-tailed).`) }
}

export function runCorrelations(ds: Dataset, spec: CorrelationsSpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'CORRELATIONS'))
  let cases = analysisCases(ds)
  if (spec.missing === 'listwise') cases = listwiseCases(ds, vars, cases)
  const items: OutputItem[] = [out.title('Correlations')]
  if (spec.descriptives) {
    items.push(
      out.table({
        title: 'Descriptive Statistics',
        columns: [{ label: 'Mean' }, { label: 'Std. Deviation' }, { label: 'N' }],
        rows: vars.map((v) => {
          const xs = listwiseCases(ds, [v], cases).map((i) => ds.data[v.id][i] as number)
          const s = summarize(xs)
          return { label: vlabel(v), cells: [fmtNum(s.mean, statDecimals(v)), fmtNum(s.sd, statDecimals(v, 3)), fmtCount(s.n)] }
        }),
      }),
    )
  }
  const notes = new Notes()
  const sigLabel = `Sig. (${spec.tails}-tailed)`
  const rows: RowNode[] = vars.map((a) => ({
    label: vlabel(a),
    children: [
      {
        label: 'Pearson Correlation',
        cells: vars.map((b) => {
          if (a === b) return '1'
          const [x, y] = pairData(ds, a, b, cases)
          const r = pearsonTest(x, y)
          const p = spec.tails === 1 ? r.p2 / 2 : r.p2
          return flagCell(fmtNum(r.r, 3), p, spec.flag, notes, spec.tails)
        }),
      },
      {
        label: sigLabel,
        cells: vars.map((b) => {
          if (a === b) return ''
          const [x, y] = pairData(ds, a, b, cases)
          const r = pearsonTest(x, y)
          return fmtSig(spec.tails === 1 ? r.p2 / 2 : r.p2)
        }),
      },
      { label: 'N', cells: vars.map((b) => fmtCount(pairData(ds, a, b, cases)[0].length)) },
    ],
  }))
  items.push(
    out.table({
      title: 'Correlations',
      columns: vars.map((v) => ({ label: vlabel(v) })),
      rows,
      footnotes: [
        ...(notes.footnotes ?? []),
        ...(spec.missing === 'listwise' ? [{ mark: 'c', text: `Listwise N=${cases.length}` }] : []),
      ],
    }),
  )
  return items
}

export function runNonparCorr(ds: Dataset, spec: NonparCorrSpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'NONPAR CORR'))
  let cases = analysisCases(ds)
  if (spec.missing === 'listwise') cases = listwiseCases(ds, vars, cases)
  const notes = new Notes()
  const sigLabel = `Sig. (${spec.tails}-tailed)`
  const block = (name: string, fn: (x: number[], y: number[]) => { r: number; p2: number }): RowNode => ({
    label: name,
    children: vars.map((a) => ({
      label: vlabel(a),
      children: [
        {
          label: 'Correlation Coefficient',
          cells: vars.map((b) => {
            if (a === b) return '1.000'
            const [x, y] = pairData(ds, a, b, cases)
            const r = fn(x, y)
            return flagCell(fmtNum(r.r, 3), spec.tails === 1 ? r.p2 / 2 : r.p2, spec.flag, notes, spec.tails)
          }),
        },
        {
          label: sigLabel,
          cells: vars.map((b) => {
            if (a === b) return '.'
            const [x, y] = pairData(ds, a, b, cases)
            const r = fn(x, y)
            return fmtSig(spec.tails === 1 ? r.p2 / 2 : r.p2)
          }),
        },
        { label: 'N', cells: vars.map((b) => fmtCount(pairData(ds, a, b, cases)[0].length)) },
      ],
    })),
  })
  const rows: RowNode[] = []
  if (spec.kendall)
    rows.push(
      block("Kendall's tau_b", (x, y) => {
        const k = kendallTauB(x, y)
        return { r: k.tau, p2: k.p2 }
      }),
    )
  if (spec.spearman) rows.push(block("Spearman's rho", (x, y) => spearman(x, y)))
  return [
    out.title('Nonparametric Correlations'),
    out.table({ title: 'Correlations', columns: vars.map((v) => ({ label: vlabel(v) })), rows, footnotes: notes.footnotes }),
  ]
}
