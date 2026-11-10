import { createVariable, insertVariable, nextSuffixName, type Dataset, type Variable } from '../core/dataset'
import { fmtCount, fmtNum, fmtSig, statDecimals } from '../core/format'
import { out, type ColumnNode, type OutputItem, type RowNode } from '../core/output'
import { mean, sd } from '../stats/basic'
import { fSf, normCdf, tInv, tSf2 } from '../stats/distributions'
import { copy, symmetricEigen, sweep, type Matrix } from '../stats/matrix'
import { analysisCases, histogramBins, listwiseCases, Notes, ProcError, requireNumeric, resolveVar, resolveVars, vlabel } from './common'
import type { RegressionSpec } from './types'

export interface RegressionFit {
  /** Indices (into the predictor list) of entered predictors, in model order. */
  entered: number[]
  n: number
  b: number[]
  se: number[]
  beta: number[]
  t: number[]
  p: number[]
  b0: number
  se0: number
  t0: number
  p0: number
  r2: number
  adjR2: number
  seEst: number
  ssReg: number
  ssRes: number
  ssTot: number
  dfReg: number
  dfRes: number
  f: number
  pF: number
  tolerance: number[]
  vif: number[]
  partial: number[]
  part: number[]
  zeroOrder: number[]
  predicted: number[]
  residuals: number[]
  durbinWatson: number
}

interface Prepared {
  y: number[]
  xs: number[][]
  means: number[]
  sds: number[]
  corr: Matrix
  n: number
}

function prepare(y: number[], xs: number[][]): Prepared {
  const n = y.length
  const cols = [...xs, y]
  const means = cols.map((c) => mean(c))
  const sds = cols.map((c) => sd(c))
  const p = cols.length
  const corr: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0))
  for (let i = 0; i < p; i++)
    for (let j = i; j < p; j++) {
      let s = 0
      for (let k = 0; k < n; k++) s += (cols[i][k] - means[i]) * (cols[j][k] - means[j])
      const r = i === j ? 1 : s / ((n - 1) * sds[i] * sds[j])
      corr[i][j] = r
      corr[j][i] = r
    }
  return { y, xs, means, sds, corr, n }
}

const TOL = 1e-4

/** Fit OLS with the predictors in `order` (indices into xs) using the sweep operator on the correlation matrix. */
export function fitModel(prep: Prepared, order: number[]): RegressionFit | null {
  const { y, xs, means, sds, corr, n } = prep
  const p = xs.length
  const a = copy(corr)
  const entered: number[] = []
  for (const j of order) {
    if (!(sds[j] > 0)) continue
    if (a[j][j] < TOL) continue
    sweep(a, j)
    entered.push(j)
  }
  const yi = p
  const k = entered.length
  const dfRes = n - k - 1
  if (dfRes < 1 && k > 0) return null
  const r2 = Math.max(0, Math.min(1, 1 - a[yi][yi]))
  const ssTot = (n - 1) * sds[yi] * sds[yi]
  const ssRes = a[yi][yi] * ssTot
  const ssReg = ssTot - ssRes
  const mse = ssRes / dfRes
  const beta = entered.map((j) => a[j][yi])
  const b = entered.map((j, idx) => (beta[idx] * sds[yi]) / sds[j])
  const vif = entered.map((j) => a[j][j])
  const se = entered.map((j, idx) => Math.sqrt((mse * vif[idx]) / ((n - 1) * sds[j] * sds[j])))
  const t = b.map((v, i) => v / se[i])
  const pv = t.map((v) => tSf2(v, dfRes))
  const b0 = means[yi] - entered.reduce((s, j, idx) => s + b[idx] * means[j], 0)
  // Var(b0) = MSE * (1/n + x̄' (Xc'Xc)^-1 x̄), with (Xc'Xc)^-1 = D^-1 R^-1 D^-1 / (n-1)
  let q = 0
  for (let u = 0; u < k; u++)
    for (let v = 0; v < k; v++) {
      const ju = entered[u]
      const jv = entered[v]
      q += (means[ju] * a[ju][jv] * means[jv]) / ((n - 1) * sds[ju] * sds[jv])
    }
  const se0 = Math.sqrt(mse * (1 / n + q))
  const t0 = b0 / se0
  const dfReg = k
  const f = dfReg > 0 ? ssReg / dfReg / mse : NaN
  const predicted = y.map((_, i) => b0 + entered.reduce((s, j, idx) => s + b[idx] * xs[j][i], 0))
  const residuals = y.map((v, i) => v - predicted[i])
  let dwNum = 0
  let dwDen = 0
  for (let i = 0; i < n; i++) {
    dwDen += residuals[i] * residuals[i]
    if (i > 0) dwNum += (residuals[i] - residuals[i - 1]) ** 2
  }
  return {
    entered,
    n,
    b,
    se,
    beta,
    t,
    p: pv,
    b0,
    se0,
    t0,
    p0: tSf2(t0, dfRes),
    r2,
    adjR2: 1 - ((1 - r2) * (n - 1)) / dfRes,
    seEst: Math.sqrt(mse),
    ssReg,
    ssRes,
    ssTot,
    dfReg,
    dfRes,
    f,
    pF: dfReg > 0 ? fSf(f, dfReg, dfRes) : NaN,
    tolerance: vif.map((v) => 1 / v),
    vif,
    partial: t.map((tv) => tv / Math.sqrt(tv * tv + dfRes)),
    part: t.map((tv) => tv * Math.sqrt((1 - r2) / dfRes)),
    zeroOrder: entered.map((j) => corr[j][yi]),
    predicted,
    residuals,
    durbinWatson: dwNum / dwDen,
  }
}

/** Stepwise/forward/backward selection on the F-to-enter / F-to-remove probabilities. */
function selectSteps(prep: Prepared, method: RegressionSpec['method'], candidates: number[], pin: number, pout: number): number[][] {
  const steps: number[][] = []
  if (method === 'backward') {
    let cur = candidates.slice()
    let fit = fitModel(prep, cur)
    if (!fit) return [cur]
    cur = fit.entered.slice()
    steps.push(cur.slice())
    for (;;) {
      fit = fitModel(prep, cur)
      if (!fit || !cur.length) break
      let worst = -1
      let worstP = -1
      fit.entered.forEach((j, idx) => {
        if (fit!.p[idx] > worstP) {
          worstP = fit!.p[idx]
          worst = j
        }
      })
      if (worstP < pout) break
      cur = cur.filter((j) => j !== worst)
      steps.push(cur.slice())
    }
    return steps
  }
  let cur: number[] = []
  for (let guard = 0; guard < candidates.length * 3 + 5; guard++) {
    // try to enter
    let best = -1
    let bestP = Infinity
    for (const j of candidates) {
      if (cur.includes(j)) continue
      const fit = fitModel(prep, [...cur, j])
      if (!fit || !fit.entered.includes(j)) continue
      const idx = fit.entered.indexOf(j)
      if (fit.p[idx] < bestP) {
        bestP = fit.p[idx]
        best = j
      }
    }
    if (best < 0 || bestP >= pin) break
    cur = [...cur, best]
    steps.push(cur.slice())
    if (method === 'stepwise') {
      // removal step
      for (;;) {
        const fit = fitModel(prep, cur)
        if (!fit) break
        let worst = -1
        let worstP = -1
        fit.entered.forEach((j, idx) => {
          if (fit.p[idx] > worstP) {
            worstP = fit.p[idx]
            worst = j
          }
        })
        if (worstP <= pout || worst === best) break
        cur = cur.filter((j) => j !== worst)
        steps.push(cur.slice())
      }
    }
  }
  return steps
}

export function runRegression(ds: Dataset, spec: RegressionSpec): { items: OutputItem[]; dataset?: Dataset } {
  const dep = resolveVar(ds, spec.dependent)
  const ivs = resolveVars(ds, spec.independents).filter((v) => v.id !== dep.id)
  requireNumeric(dep, 'REGRESSION')
  ivs.forEach((v) => requireNumeric(v, 'REGRESSION'))
  if (!ivs.length) throw new ProcError('REGRESSION requires at least one independent variable.')
  const cases = listwiseCases(ds, [dep, ...ivs], analysisCases(ds))
  const n = cases.length
  if (n < 3) throw new ProcError('There are not enough valid cases to compute the regression.')
  const y = cases.map((i) => ds.data[dep.id][i] as number)
  const xs = ivs.map((v) => cases.map((i) => ds.data[v.id][i] as number))
  const prep = prepare(y, xs)
  const all = ivs.map((_, j) => j)
  const models: number[][] =
    spec.method === 'enter' ? [all] : selectSteps(prep, spec.method, all, spec.pin, spec.pout)
  const fits = models.map((m) => fitModel(prep, m)).filter((f): f is RegressionFit => !!f)
  const items: OutputItem[] = [out.title('Regression')]
  if (!fits.length) {
    items.push(out.text('No variables were entered into the equation.', 'warning', 'Warnings'))
    return { items }
  }
  const st = spec.statistics
  const depNote = `Dependent Variable: ${vlabel(dep)}`
  const predNote = (f: RegressionFit) => `Predictors: (Constant), ${[...f.entered].reverse().map((j) => vlabel(ivs[j])).join(', ')}`

  if (st.descriptives) {
    items.push(
      out.table({
        title: 'Descriptive Statistics',
        columns: [{ label: 'Mean' }, { label: 'Std. Deviation' }, { label: 'N' }],
        rows: [dep, ...ivs].map((v, k) => ({
          label: vlabel(v),
          cells: [
            fmtNum(k === 0 ? prep.means[ivs.length] : prep.means[k - 1], statDecimals(v)),
            fmtNum(k === 0 ? prep.sds[ivs.length] : prep.sds[k - 1], statDecimals(v, 3)),
            fmtCount(n),
          ],
        })),
      }),
    )
    const all2 = [dep, ...ivs]
    const idx = (k: number) => (k === 0 ? ivs.length : k - 1)
    items.push(
      out.table({
        title: 'Correlations',
        columns: all2.map((v) => ({ label: vlabel(v) })),
        rows: [
          { label: 'Pearson Correlation', children: all2.map((a, i) => ({ label: vlabel(a), cells: all2.map((_, j) => fmtNum(prep.corr[idx(i)][idx(j)], 3)) })) },
          {
            label: 'Sig. (1-tailed)',
            children: all2.map((a, i) => ({
              label: vlabel(a),
              cells: all2.map((_, j) => {
                if (i === j) return '.'
                const r = prep.corr[idx(i)][idx(j)]
                const t = r * Math.sqrt((n - 2) / (1 - r * r))
                return fmtSig(tSf2(t, n - 2) / 2)
              }),
            })),
          },
          { label: 'N', children: all2.map((a) => ({ label: vlabel(a), cells: all2.map(() => fmtCount(n)) })) },
        ],
      }),
    )
  }

  // Variables Entered/Removed
  {
    const notes = new Notes()
    const aMark = notes.mark(depNote)
    const rows: RowNode[] = fits.map((f, m) => {
      const prev = m ? fits[m - 1].entered : []
      const ent = f.entered.filter((j) => !prev.includes(j))
      const rem = prev.filter((j) => !f.entered.includes(j))
      let method = 'Enter'
      if (spec.method === 'stepwise')
        method = `Stepwise (Criteria: Probability-of-F-to-enter <= ${fmtNum(spec.pin, 3)}, Probability-of-F-to-remove >= ${fmtNum(spec.pout, 3)}).`
      else if (spec.method === 'forward') method = `Forward (Criterion: Probability-of-F-to-enter <= ${fmtNum(spec.pin, 3)})`
      else if (spec.method === 'backward') method = m === 0 ? 'Enter' : `Backward (criterion: Probability of F-to-remove >= ${fmtNum(spec.pout, 3)}).`
      const allEntered = spec.method === 'enter' && f.entered.length === ivs.length
      const bMark = allEntered ? notes.mark('All requested variables entered.') : undefined
      return {
        label: String(m + 1),
        cells: [
          { text: ent.map((j) => vlabel(ivs[j])).join(', ') || '.', sup: bMark, align: 'left' },
          { text: rem.map((j) => vlabel(ivs[j])).join(', ') || '.', align: 'left' },
          { text: method, align: 'left' },
        ],
      }
    })
    items.push(
      out.table({
        title: 'Variables Entered/Removed',
        titleSup: aMark,
        corner: ['Model'],
        columns: [{ label: 'Variables Entered' }, { label: 'Variables Removed' }, { label: 'Method' }],
        rows,
        footnotes: notes.footnotes,
      }),
    )
    const excluded = ivs.map((_, j) => j).filter((j) => !fits[fits.length - 1].entered.includes(j))
    if (spec.method === 'enter' && excluded.length)
      items.push(
        out.text(
          `The following variables were not entered because of tolerance (collinearity) or zero variance: ${excluded.map((j) => ivs[j].name).join(', ')}.`,
          'warning',
          'Warnings',
        ),
      )
  }

  // Model Summary
  if (st.r) {
    const notes = new Notes()
    const predMarks = fits.map((f) => notes.mark(predNote(f)))
    const depMark = notes.mark(depNote)
    const cols: ColumnNode[] = [{ label: 'R' }, { label: 'R Square' }, { label: 'Adjusted R Square' }, { label: 'Std. Error of the Estimate' }]
    if (st.change)
      cols.push({
        label: 'Change Statistics',
        children: [{ label: 'R Square Change' }, { label: 'F Change' }, { label: 'df1' }, { label: 'df2' }, { label: 'Sig. F Change' }],
      })
    if (st.durbin) cols.push({ label: 'Durbin-Watson' })
    items.push(
      out.table({
        title: 'Model Summary',
        titleSup: st.durbin ? depMark : undefined,
        corner: ['Model'],
        columns: cols,
        rows: fits.map((f, m) => {
          const cells: (string | { text: string; sup?: string })[] = [
            { text: fmtNum(Math.sqrt(f.r2), 3), sup: predMarks[m] },
            fmtNum(f.r2, 3),
            fmtNum(f.adjR2, 3),
            fmtNum(f.seEst, 5),
          ]
          if (st.change) {
            const prevR2 = m ? fits[m - 1].r2 : 0
            const prevK = m ? fits[m - 1].entered.length : 0
            const df1 = Math.abs(f.entered.length - prevK)
            const dch = f.r2 - prevR2
            const fch = df1 > 0 ? (Math.abs(dch) / df1) / ((1 - f.r2) / f.dfRes) : NaN
            cells.push(fmtNum(dch, 3), fmtNum(fch, 3), String(df1), String(f.dfRes), fmtSig(df1 > 0 ? fSf(fch, df1, f.dfRes) : NaN))
          }
          if (st.durbin) cells.push(m === fits.length - 1 ? fmtNum(f.durbinWatson, 3) : '')
          return { label: String(m + 1), cells }
        }),
        footnotes: notes.footnotes,
      }),
    )
  }

  // ANOVA
  if (st.anova) {
    const notes = new Notes()
    const aMark = notes.mark(depNote)
    const pm = fits.map((f) => notes.mark(predNote(f)))
    items.push(
      out.table({
        title: 'ANOVA',
        titleSup: aMark,
        corner: ['Model'],
        columns: [{ label: 'Sum of Squares' }, { label: 'df' }, { label: 'Mean Square' }, { label: 'F' }, { label: 'Sig.' }],
        rows: fits.map((f, m) => ({
          label: String(m + 1),
          children: [
            {
              label: 'Regression',
              cells: [fmtNum(f.ssReg, 3), String(f.dfReg), fmtNum(f.ssReg / f.dfReg, 3), fmtNum(f.f, 3), { text: fmtSig(f.pF), sup: pm[m] }],
            },
            { label: 'Residual', cells: [fmtNum(f.ssRes, 3), String(f.dfRes), fmtNum(f.ssRes / f.dfRes, 3), '', ''] },
            { label: 'Total', cells: [fmtNum(f.ssTot, 3), String(n - 1), '', '', ''] },
          ],
        })),
        footnotes: notes.footnotes,
      }),
    )
  }

  // Coefficients
  if (st.coeff) {
    const notes = new Notes()
    const aMark = notes.mark(depNote)
    const cols: ColumnNode[] = [
      { label: 'Unstandardized Coefficients', children: [{ label: 'B' }, { label: 'Std. Error' }] },
      { label: 'Standardized Coefficients', children: [{ label: 'Beta' }] },
      { label: 't' },
      { label: 'Sig.' },
    ]
    const ciLevel = st.ciLevel
    if (st.ci) cols.push({ label: `${fmtNum(ciLevel, 1)}% Confidence Interval for B`, children: [{ label: 'Lower Bound' }, { label: 'Upper Bound' }] })
    if (st.zpp) cols.push({ label: 'Correlations', children: [{ label: 'Zero-order' }, { label: 'Partial' }, { label: 'Part' }] })
    if (st.collin) cols.push({ label: 'Collinearity Statistics', children: [{ label: 'Tolerance' }, { label: 'VIF' }] })
    items.push(
      out.table({
        title: 'Coefficients',
        titleSup: aMark,
        corner: ['Model'],
        columns: cols,
        rows: fits.map((f, m) => {
          const q = tInv(1 - (1 - ciLevel / 100) / 2, f.dfRes)
          const d = 3
          const constRow: RowNode = {
            label: '(Constant)',
            cells: [
              fmtNum(f.b0, d),
              fmtNum(f.se0, d),
              '',
              fmtNum(f.t0, 3),
              fmtSig(f.p0),
              ...(st.ci ? [fmtNum(f.b0 - q * f.se0, d), fmtNum(f.b0 + q * f.se0, d)] : []),
              ...(st.zpp ? ['', '', ''] : []),
              ...(st.collin ? ['', ''] : []),
            ],
          }
          const varRows: RowNode[] = f.entered.map((j, idx) => ({
            label: vlabel(ivs[j]),
            cells: [
              fmtNum(f.b[idx], d),
              fmtNum(f.se[idx], d),
              fmtNum(f.beta[idx], 3),
              fmtNum(f.t[idx], 3),
              fmtSig(f.p[idx]),
              ...(st.ci ? [fmtNum(f.b[idx] - q * f.se[idx], d), fmtNum(f.b[idx] + q * f.se[idx], d)] : []),
              ...(st.zpp ? [fmtNum(f.zeroOrder[idx], 3), fmtNum(f.partial[idx], 3), fmtNum(f.part[idx], 3)] : []),
              ...(st.collin ? [fmtNum(f.tolerance[idx], 3), fmtNum(f.vif[idx], 3)] : []),
            ],
          }))
          return { label: String(m + 1), children: [constRow, ...varRows] }
        }),
        footnotes: notes.footnotes,
      }),
    )
  }

  if (st.collin) {
    const notes = new Notes()
    const aMark = notes.mark(depNote)
    const last = fits[fits.length - 1]
    // Eigen-decomposition of the scaled, uncentered cross-products matrix (incl. intercept).
    const cols = [y.map(() => 1), ...last.entered.map((j) => xs[j])]
    const p = cols.length
    const xtx: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0))
    for (let i = 0; i < p; i++)
      for (let j = i; j < p; j++) {
        let s = 0
        for (let k = 0; k < n; k++) s += cols[i][k] * cols[j][k]
        xtx[i][j] = s
        xtx[j][i] = s
      }
    const dsc = xtx.map((_, i) => Math.sqrt(xtx[i][i]))
    const scaled = xtx.map((r, i) => r.map((v, j) => v / (dsc[i] * dsc[j])))
    const { values, vectors } = symmetricEigen(scaled)
    const phi = vectors.map((r) => r.map((v, d) => (v * v) / values[d]))
    const props = phi.map((r) => {
      const tot = r.reduce((acc, v) => acc + v, 0)
      return r.map((v) => v / tot)
    })
    items.push(
      out.table({
        title: 'Collinearity Diagnostics',
        titleSup: aMark,
        corner: ['Model', 'Dimension'],
        columns: [
          { label: 'Eigenvalue' },
          { label: 'Condition Index' },
          { label: 'Variance Proportions', children: [{ label: '(Constant)' }, ...last.entered.map((j) => ({ label: vlabel(ivs[j]) }))] },
        ],
        rows: [
          {
            label: String(fits.length),
            children: values.map((ev, d) => ({
              label: String(d + 1),
              cells: [fmtNum(ev, 3), fmtNum(Math.sqrt(values[0] / ev), 3), ...props.map((r) => fmtNum(r[d], 2))],
            })),
          },
        ],
        footnotes: notes.footnotes,
      }),
    )
  }

  const final = fits[fits.length - 1]
  const mse = final.ssRes / final.dfRes
  const zres = final.residuals.map((e) => e / Math.sqrt(mse))
  const pm = mean(final.predicted)
  const psd = sd(final.predicted)
  const zpred = final.predicted.map((v) => (v - pm) / psd)
  const anyResid = spec.plots.histogram || spec.plots.normprob || spec.plots.scatter || Object.values(spec.save).some(Boolean)
  if (anyResid) {
    const notes = new Notes()
    const aMark = notes.mark(depNote)
    const statRow = (label: string, v: number[]) => {
      let lo = Infinity
      let hi = -Infinity
      for (const x of v) {
        lo = Math.min(lo, x)
        hi = Math.max(hi, x)
      }
      return { label, cells: [fmtNum(lo, 3), fmtNum(hi, 3), fmtNum(mean(v), 3), fmtNum(sd(v), 3), fmtCount(v.length)] }
    }
    items.push(
      out.table({
        title: 'Residuals Statistics',
        titleSup: aMark,
        columns: [{ label: 'Minimum' }, { label: 'Maximum' }, { label: 'Mean' }, { label: 'Std. Deviation' }, { label: 'N' }],
        rows: [
          statRow('Predicted Value', final.predicted),
          statRow('Residual', final.residuals),
          statRow('Std. Predicted Value', zpred),
          statRow('Std. Residual', zres),
        ],
        footnotes: notes.footnotes,
      }),
    )
  }
  if (spec.plots.histogram) {
    items.push(
      out.chart({
        type: 'histogram',
        title: `Histogram — Dependent Variable: ${vlabel(dep)}`,
        xLabel: 'Regression Standardized Residual',
        bins: histogramBins(zres),
        normal: { mean: mean(zres), sd: sd(zres), n },
        stats: { mean: mean(zres), sd: sd(zres), n },
      }),
    )
  }
  if (spec.plots.normprob) {
    // P-P plot: observed cumulative proportion (Blom) vs expected normal cumulative probability.
    const obs = zres
      .slice()
      .sort((a, b) => a - b)
      .map((z, i) => [(i + 1 - 0.375) / (n + 0.25), normCdf(z)] as [number, number])
    items.push(
      out.chart({
        type: 'scatter',
        title: `Normal P-P Plot of Regression Standardized Residual — Dependent Variable: ${vlabel(dep)}`,
        xLabel: 'Observed Cum Prob',
        yLabel: 'Expected Cum Prob',
        groups: [{ name: 'Residuals', points: obs }],
        lines: [{ slope: 1, intercept: 0 }],
        xDomain: [0, 1],
        yDomain: [0, 1],
      }),
    )
  }
  if (spec.plots.scatter) {
    items.push(
      out.chart({
        type: 'scatter',
        title: `Scatterplot — Dependent Variable: ${vlabel(dep)}`,
        xLabel: 'Regression Standardized Predicted Value',
        yLabel: 'Regression Standardized Residual',
        groups: [{ name: 'Cases', points: zpred.map((x, i) => [x, zres[i]]) }],
        lines: [{ slope: 0, intercept: 0 }],
      }),
    )
  }

  let dataset: Dataset | undefined
  const saves: [boolean, string, string, number[]][] = [
    [spec.save.pred, 'PRE', 'Unstandardized Predicted Value', final.predicted],
    [spec.save.zpred, 'ZPR', 'Standardized Predicted Value', zpred],
    [spec.save.resid, 'RES', 'Unstandardized Residual', final.residuals],
    [spec.save.zresid, 'ZRE', 'Standardized Residual', zres],
  ]
  if (saves.some((s) => s[0])) {
    dataset = ds
    const created: string[] = []
    for (const [on, prefix, label, values] of saves) {
      if (!on) continue
      const name = nextSuffixName(dataset, prefix)
      const col: (number | null)[] = new Array(ds.nCases).fill(null)
      cases.forEach((ci, k) => (col[ci] = values[k]))
      const v: Variable = createVariable(name, { decimals: 5, width: 11, label, measure: 'scale' })
      dataset = insertVariable(dataset, dataset.variables.length, v, col)
      created.push(`${name} (${label})`)
    }
    items.push(out.text(`New variables created: ${created.join('; ')}.`, 'note', 'Notes'))
  }
  return { items, dataset }
}

/** OLS with all predictors entered (convenience for tests and scripts). */
export function fitOLS(y: number[], xs: number[][]): RegressionFit | null {
  return fitModel(prepare(y, xs), xs.map((_, j) => j))
}
