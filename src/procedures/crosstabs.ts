import { isMissing, type Dataset, type Variable } from '../core/dataset'
import { fmtCount, fmtNum, fmtPct, fmtPctSign, fmtSig } from '../core/format'
import { out, type OutputItem, type RowNode } from '../core/output'
import { chi2Sf, hypergeomPmf, normInv } from '../stats/distributions'
import { analysisCases, catKey, catLabel, categoriesOf, Notes, ProcError, resolveVars, vlabel } from './common'
import type { CrosstabsSpec } from './types'

export interface CrossResult {
  rowCats: (number | string)[]
  colCats: (number | string)[]
  counts: number[][]
  rowTotals: number[]
  colTotals: number[]
  n: number
  missing: number
}

export function crossCounts(ds: Dataset, r: Variable, c: Variable, cases: number[]): CrossResult {
  const valid = cases.filter((i) => !isMissing(r, ds.data[r.id][i]) && !isMissing(c, ds.data[c.id][i]))
  const rowCats = categoriesOf(ds, r, valid)
  const colCats = categoriesOf(ds, c, valid)
  const ri = new Map(rowCats.map((x, k) => [catKey(r, x), k]))
  const ci = new Map(colCats.map((x, k) => [catKey(c, x), k]))
  const counts = rowCats.map(() => new Array<number>(colCats.length).fill(0))
  const val = (v: Variable, i: number) => (v.type === 'string' ? String(ds.data[v.id][i]).trimEnd() : (ds.data[v.id][i] as number))
  for (const i of valid) counts[ri.get(catKey(r, val(r, i)))!][ci.get(catKey(c, val(c, i)))!]++
  const rowTotals = counts.map((row) => row.reduce((s, x) => s + x, 0))
  const colTotals = colCats.map((_, j) => counts.reduce((s, row) => s + row[j], 0))
  return { rowCats, colCats, counts, rowTotals, colTotals, n: valid.length, missing: cases.length - valid.length }
}

export interface ChiSquareResults {
  pearson: number
  df: number
  pPearson: number
  lr: number
  pLr: number
  yates: number | null
  pYates: number | null
  fisher2: number | null
  fisher1: number | null
  linear: number | null
  pLinear: number | null
  minExpected: number
  cellsBelow5: number
  nCells: number
  phi: number
  cramersV: number
  contingency: number
}

export function chiSquareTests(x: CrossResult, rowScores: number[], colScores: number[]): ChiSquareResults {
  const { counts, rowTotals, colTotals, n } = x
  const R = rowTotals.length
  const C = colTotals.length
  let pearson = 0
  let lr = 0
  let minExpected = Infinity
  let below5 = 0
  for (let i = 0; i < R; i++)
    for (let j = 0; j < C; j++) {
      const e = (rowTotals[i] * colTotals[j]) / n
      const o = counts[i][j]
      if (e < minExpected) minExpected = e
      if (e < 5) below5++
      pearson += ((o - e) * (o - e)) / e
      if (o > 0) lr += o * Math.log(o / e)
    }
  lr *= 2
  const df = (R - 1) * (C - 1)
  let yates: number | null = null
  let fisher2: number | null = null
  let fisher1: number | null = null
  if (R === 2 && C === 2) {
    const [[a, b], [c, d]] = counts
    const diff = Math.abs(a * d - b * c)
    yates = diff > 0.5 * n ? (n * Math.pow(diff - 0.5 * n, 2)) / (rowTotals[0] * rowTotals[1] * colTotals[0] * colTotals[1]) : 0
    const r1 = rowTotals[0]
    const c1 = colTotals[0]
    const lo = Math.max(0, r1 + c1 - n)
    const hi = Math.min(r1, c1)
    const pObs = hypergeomPmf(a, r1, c1, n)
    let two = 0
    let left = 0
    let right = 0
    for (let k = lo; k <= hi; k++) {
      const p = hypergeomPmf(k, r1, c1, n)
      if (p <= pObs * (1 + 1e-7)) two += p
      if (k <= a) left += p
      if (k >= a) right += p
    }
    fisher2 = Math.min(1, two)
    fisher1 = Math.min(1, Math.min(left, right))
  }
  // Linear-by-linear association: (N - 1) r^2 with the category scores.
  let linear: number | null = null
  let pLinear: number | null = null
  if (R > 1 && C > 1) {
    let sx = 0
    let sy = 0
    for (let i = 0; i < R; i++) sx += rowScores[i] * rowTotals[i]
    for (let j = 0; j < C; j++) sy += colScores[j] * colTotals[j]
    const mx = sx / n
    const my = sy / n
    let sxx = 0
    let syy = 0
    let sxy = 0
    for (let i = 0; i < R; i++) sxx += rowTotals[i] * (rowScores[i] - mx) ** 2
    for (let j = 0; j < C; j++) syy += colTotals[j] * (colScores[j] - my) ** 2
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) sxy += counts[i][j] * (rowScores[i] - mx) * (colScores[j] - my)
    const r = sxy / Math.sqrt(sxx * syy)
    linear = (n - 1) * r * r
    pLinear = chi2Sf(linear, 1)
  }
  let phi = Math.sqrt(pearson / n)
  if (R === 2 && C === 2) {
    const [[a, b], [c, d]] = counts
    phi = (a * d - b * c) / Math.sqrt(rowTotals[0] * rowTotals[1] * colTotals[0] * colTotals[1])
  }
  return {
    pearson,
    df,
    pPearson: chi2Sf(pearson, df),
    lr,
    pLr: chi2Sf(lr, df),
    yates,
    pYates: yates === null ? null : chi2Sf(yates, 1),
    fisher2,
    fisher1,
    linear,
    pLinear,
    minExpected,
    cellsBelow5: below5,
    nCells: R * C,
    phi,
    cramersV: Math.sqrt(pearson / (n * (Math.min(R, C) - 1))),
    contingency: Math.sqrt(pearson / (pearson + n)),
  }
}

const CELL_LABELS: Record<string, string> = {
  count: 'Count',
  expected: 'Expected Count',
  row: '% within ROW',
  column: '% within COL',
  total: '% of Total',
  resid: 'Residual',
  sresid: 'Standardized Residual',
  asresid: 'Adjusted Residual',
}

export function runCrosstabs(ds: Dataset, spec: CrosstabsSpec): OutputItem[] {
  const rows = resolveVars(ds, spec.rows)
  const cols = resolveVars(ds, spec.columns)
  if (!rows.length || !cols.length) throw new ProcError('CROSSTABS requires at least one row and one column variable.')
  const cases = analysisCases(ds)
  const items: OutputItem[] = [out.title('Crosstabs')]
  const pairs: [Variable, Variable][] = []
  for (const r of rows) for (const c of cols) pairs.push([r, c])
  const results = pairs.map(([r, c]) => crossCounts(ds, r, c, cases))

  items.push(
    out.table({
      title: 'Case Processing Summary',
      columns: [
        {
          label: 'Cases',
          children: [
            { label: 'Valid', children: [{ label: 'N' }, { label: 'Percent' }] },
            { label: 'Missing', children: [{ label: 'N' }, { label: 'Percent' }] },
            { label: 'Total', children: [{ label: 'N' }, { label: 'Percent' }] },
          ],
        },
      ],
      rows: pairs.map(([r, c], k) => {
        const x = results[k]
        const tot = x.n + x.missing
        return {
          label: `${vlabel(r)} * ${vlabel(c)}`,
          cells: [
            fmtCount(x.n),
            fmtPctSign(tot ? (100 * x.n) / tot : 0),
            fmtCount(x.missing),
            fmtPctSign(tot ? (100 * x.missing) / tot : 0),
            fmtCount(tot),
            fmtPctSign(100),
          ],
        }
      }),
    }),
  )

  pairs.forEach(([r, c], k) => {
    const x = results[k]
    if (!x.n) {
      items.push(out.text(`${vlabel(r)} * ${vlabel(c)}: no valid cases.`, 'warning'))
      return
    }
    const R = x.rowCats.length
    const C = x.colCats.length
    const cellTypes = spec.cells.length ? spec.cells : ['count' as const]
    const statRows = (i: number | null): RowNode[] =>
      cellTypes.map((t) => {
        const label = CELL_LABELS[t].replace('ROW', vlabel(r)).replace('COL', vlabel(c))
        const values: string[] = []
        for (let j = 0; j <= C; j++) {
          const isTotCol = j === C
          const o = i === null ? (isTotCol ? x.n : x.colTotals[j]) : isTotCol ? x.rowTotals[i] : x.counts[i][j]
          const rt = i === null ? x.n : x.rowTotals[i]
          const ct = isTotCol ? x.n : x.colTotals[j]
          const e = (rt * ct) / x.n
          switch (t) {
            case 'count':
              values.push(fmtCount(o))
              break
            case 'expected':
              values.push(fmtNum(e, 1))
              break
            case 'row':
              values.push(fmtPctSign(rt ? (100 * o) / rt : 0))
              break
            case 'column':
              values.push(fmtPctSign(ct ? (100 * o) / ct : 0))
              break
            case 'total':
              values.push(fmtPctSign((100 * o) / x.n))
              break
            case 'resid':
              values.push(i === null || isTotCol ? '' : fmtNum(o - e, 1))
              break
            case 'sresid':
              values.push(i === null || isTotCol ? '' : fmtNum((o - e) / Math.sqrt(e), 1))
              break
            case 'asresid':
              values.push(
                i === null || isTotCol ? '' : fmtNum((o - e) / Math.sqrt(e * (1 - rt / x.n) * (1 - ct / x.n)), 1),
              )
              break
          }
        }
        return { label, cells: values }
      })

    if (!spec.suppressTables) {
      items.push(
        out.table({
          title: `${vlabel(r)} * ${vlabel(c)} Crosstabulation`,
          columns: [
            { label: vlabel(c), children: x.colCats.map((cc) => ({ label: catLabel(c, cc) })) },
            { label: 'Total' },
          ],
          rows: [
            {
              label: vlabel(r),
              children: x.rowCats.map((rc, i) => ({ label: catLabel(r, rc), children: statRows(i) })),
            },
            { label: 'Total', children: statRows(null) },
          ],
        }),
      )
    }

    const stats = new Set(spec.statistics)
    if (R < 2 || C < 2) {
      if (stats.size)
        items.push(
          out.text(
            `No statistics are computed because ${R < 2 ? vlabel(r) : vlabel(c)} is a constant.`,
            'warning',
            'Statistics',
          ),
        )
    } else {
      const scores = (v: Variable, cats: (number | string)[]) =>
        cats.map((cv, idx) => (v.type === 'numeric' ? (cv as number) : idx + 1))
      const cs = chiSquareTests(x, scores(r, x.rowCats), scores(c, x.colCats))
      if (stats.has('chisq')) {
        const notes = new Notes()
        const is2x2 = R === 2 && C === 2
        const pctBelow = (100 * cs.cellsBelow5) / cs.nCells
        const aMark = notes.mark(
          `${cs.cellsBelow5} cells (${fmtPct(pctBelow)}%) have expected count less than 5. The minimum expected count is ${fmtNum(cs.minExpected, 2)}.`,
        )
        const bMark = is2x2 ? notes.mark('Computed only for a 2x2 table') : undefined
        const cols5 = is2x2
          ? [
              { label: 'Value' },
              { label: 'df' },
              { label: 'Asymptotic Significance (2-sided)' },
              { label: 'Exact Sig. (2-sided)' },
              { label: 'Exact Sig. (1-sided)' },
            ]
          : [{ label: 'Value' }, { label: 'df' }, { label: 'Asymptotic Significance (2-sided)' }]
        const pad = (a: (string | { text: string; sup?: string })[]) => (is2x2 ? [...a, ...new Array(5 - a.length).fill('')] : a)
        const body: RowNode[] = [
          { label: 'Pearson Chi-Square', cells: pad([{ text: fmtNum(cs.pearson, 3), sup: aMark }, String(cs.df), fmtSig(cs.pPearson)]) },
        ]
        if (is2x2)
          body.push({ label: 'Continuity Correction', sup: bMark, cells: pad([fmtNum(cs.yates!, 3), '1', fmtSig(cs.pYates!)]) })
        body.push({ label: 'Likelihood Ratio', cells: pad([fmtNum(cs.lr, 3), String(cs.df), fmtSig(cs.pLr)]) })
        if (is2x2) body.push({ label: "Fisher's Exact Test", cells: ['', '', '', fmtSig(cs.fisher2!), fmtSig(cs.fisher1!)] })
        if (cs.linear !== null)
          body.push({ label: 'Linear-by-Linear Association', cells: pad([fmtNum(cs.linear, 3), '1', fmtSig(cs.pLinear!)]) })
        body.push({ label: 'N of Valid Cases', cells: pad([fmtCount(x.n)]) })
        items.push(out.table({ title: 'Chi-Square Tests', columns: cols5, rows: body, footnotes: notes.footnotes }))
      }
      if (stats.has('phi') || stats.has('cc')) {
        const body: RowNode[] = []
        const nn: RowNode[] = []
        if (stats.has('phi')) {
          nn.push({ label: 'Phi', cells: [fmtNum(cs.phi, 3), fmtSig(cs.pPearson)] })
          nn.push({ label: "Cramer's V", cells: [fmtNum(cs.cramersV, 3), fmtSig(cs.pPearson)] })
        }
        if (stats.has('cc')) nn.push({ label: 'Contingency Coefficient', cells: [fmtNum(cs.contingency, 3), fmtSig(cs.pPearson)] })
        body.push({ label: 'Nominal by Nominal', children: nn })
        body.push({ label: 'N of Valid Cases', cells: [fmtCount(x.n), ''] })
        items.push(
          out.table({
            title: 'Symmetric Measures',
            columns: [{ label: 'Value' }, { label: 'Approximate Significance' }],
            rows: body,
          }),
        )
      }
      if (stats.has('risk')) {
        if (R === 2 && C === 2) {
          const [[a, b], [c2, d]] = x.counts
          const z = normInv(0.975)
          const or = (a * d) / (b * c2)
          const seOr = Math.sqrt(1 / a + 1 / b + 1 / c2 + 1 / d)
          const rr1 = a / (a + b) / (c2 / (c2 + d))
          const se1 = Math.sqrt(b / (a * (a + b)) + d / (c2 * (c2 + d)))
          const rr2 = b / (a + b) / (d / (c2 + d))
          const se2 = Math.sqrt(a / (b * (a + b)) + c2 / (d * (c2 + d)))
          const ciRow = (val: number, se: number) => [
            fmtNum(val, 3),
            Number.isFinite(se) ? fmtNum(Math.exp(Math.log(val) - z * se), 3) : '.',
            Number.isFinite(se) ? fmtNum(Math.exp(Math.log(val) + z * se), 3) : '.',
          ]
          items.push(
            out.table({
              title: 'Risk Estimate',
              columns: [
                { label: 'Value' },
                { label: '95% Confidence Interval', children: [{ label: 'Lower' }, { label: 'Upper' }] },
              ],
              rows: [
                {
                  label: `Odds Ratio for ${vlabel(r)} (${catLabel(r, x.rowCats[0])} / ${catLabel(r, x.rowCats[1])})`,
                  cells: ciRow(or, seOr),
                },
                { label: `For cohort ${vlabel(c)} = ${catLabel(c, x.colCats[0])}`, cells: ciRow(rr1, se1) },
                { label: `For cohort ${vlabel(c)} = ${catLabel(c, x.colCats[1])}`, cells: ciRow(rr2, se2) },
                { label: 'N of Valid Cases', cells: [fmtCount(x.n), '', ''] },
              ],
            }),
          )
        } else {
          items.push(out.text('Risk Estimate statistics cannot be computed. They are only computed for a 2*2 table without empty cells.', 'warning', 'Risk Estimate'))
        }
      }
    }

    if (spec.barchart) {
      items.push(
        out.chart({
          type: 'bar',
          title: `Bar Chart of ${vlabel(r)} by ${vlabel(c)}`,
          xLabel: vlabel(r),
          yLabel: 'Count',
          categories: x.rowCats.map((rc) => catLabel(r, rc)),
          series: x.colCats.map((cc, j) => ({ name: catLabel(c, cc), values: x.counts.map((row) => row[j]) })),
        }),
      )
    }
  })
  return items
}
