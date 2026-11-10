import { describe, expect, it } from 'vitest'
import { setFormatOptions } from '../core/format'
import { datasetFrom, errorsIn, findTable, rowValues } from '../test/helpers'
import { chiSquareTests, crossCounts } from './crosstabs'
import { runSyntax } from './engine'
import ref from './proc_ref.fixture.json'
import { fitOLS } from './regression'
import { cronbachAlpha } from './reliability'

setFormatOptions({ leadingZero: false })

const ds = datasetFrom(ref.data as Record<string, (number | null)[]>, {
  gender: [
    { value: 1, label: 'Male' },
    { value: 2, label: 'Female' },
  ],
  group: [
    { value: 1, label: 'Control' },
    { value: 2, label: 'Treatment A' },
    { value: 3, label: 'Treatment B' },
  ],
})

function close(a: number, b: number, rel = 1e-8) {
  expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(Math.max(1e-12, rel * Math.abs(b)))
}

const fmt3 = (x: number) => {
  const s = x.toFixed(3)
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
}

describe('linear regression', () => {
  const D = ref.data as Record<string, (number | null)[]>
  const idx = D.score.map((_, i) => i).filter((i) => [D.score, D.age, D.income, D.pre].every((c) => c[i] !== null))
  const y = idx.map((i) => D.score[i]!)
  const xs = ['age', 'income', 'pre'].map((c) => idx.map((i) => D[c][i]!))
  const f = fitOLS(y, xs)!
  const R = ref.regression
  it('coefficients, standard errors, t and p match statsmodels', () => {
    expect(f.n).toBe(R.n)
    close(f.b0, R.params[0])
    close(f.se0, R.bse[0])
    close(f.t0, R.t[0])
    f.b.forEach((b, k) => {
      close(b, R.params[k + 1])
      close(f.se[k], R.bse[k + 1])
      close(f.t[k], R.t[k + 1])
      close(f.p[k], R.p[k + 1], 1e-6)
    })
  })
  it('model fit statistics', () => {
    close(f.r2, R.r2)
    close(f.adjR2, R.adj)
    close(f.f, R.f)
    close(f.pF, R.pf, 1e-6)
    close(f.durbinWatson, R.dw)
    close(f.ssRes, R.ssr)
    close(f.ssReg, R.ess)
    f.vif.forEach((v, k) => close(v, R.vif[k]))
  })
  it('REGRESSION syntax produces the SPSS tables', () => {
    const r = runSyntax(
      ds,
      `REGRESSION
  /STATISTICS COEFF OUTS CI(95) R ANOVA COLLIN TOL
  /DEPENDENT score
  /METHOD=ENTER age income pre
  /RESIDUALS DURBIN.`,
    )
    expect(errorsIn(r.blocks)).toEqual([])
    const coef = findTable(r.blocks, 'Coefficients')
    const age = rowValues(coef, '1', 'age')
    expect(age[0]).toBe(fmt3(R.params[1]))
    expect(age[5]).toBe(fmt3(R.ciLow[1]))
    expect(age[6]).toBe(fmt3(R.ciHigh[1]))
    expect(age[8]).toBe(fmt3(R.vif[0]))
    const sum = findTable(r.blocks, 'Model Summary')
    const row = rowValues(sum, '1')
    expect(row[1]).toBe(fmt3(R.r2))
    expect(row[4]).toBe(fmt3(R.dw))
    expect(findTable(r.blocks, 'Collinearity Diagnostics')).toBeTruthy()
  })
})

describe('crosstabs', () => {
  it('Pearson and likelihood-ratio chi-square', () => {
    const x = crossCounts(ds, ds.variables[0], ds.variables[1], [...Array(ds.nCases).keys()])
    expect(x.counts).toEqual(ref.crosstab.counts)
    const cs = chiSquareTests(x, [1, 2], [1, 2, 3])
    close(cs.pearson, ref.crosstab.chi2)
    close(cs.pPearson, ref.crosstab.p)
    close(cs.lr, ref.crosstab.lr)
    close(cs.pLr, ref.crosstab.plr)
  })
  it('2x2: Yates correction and Fisher exact test', () => {
    const r = runSyntax(
      ds,
      `COMPUTE hi = pre > 59.9.
CROSSTABS /TABLES=gender BY hi /STATISTICS=CHISQ PHI /CELLS=COUNT.`,
    )
    expect(errorsIn(r.blocks)).toEqual([])
    const t = findTable(r.blocks, 'Chi-Square Tests')
    expect(t.rows.map((x) => x.label)).toContain("Fisher's Exact Test")
  })
  it('Fisher exact matches scipy for the median split', () => {
    const median = [...(ref.data.pre as number[])].sort((a, b) => a - b)
    const m = (median[29] + median[30]) / 2
    const r = runSyntax(ds, `COMPUTE hi = pre > ${m}.\nCROSSTABS /TABLES=gender BY hi /STATISTICS=CHISQ.`)
    const t = findTable(r.blocks, 'Chi-Square Tests')
    expect(rowValues(t, 'Continuity Correction')[0]).toBe(fmt3(ref.crosstab2.yates))
    expect(rowValues(t, "Fisher's Exact Test")[3]).toBe(fmt3(ref.crosstab2.fisher))
  })
})

describe('reliability', () => {
  it("Cronbach's alpha and alpha if item deleted", () => {
    const items = ['q1', 'q2', 'q3', 'q4', 'q5'].map((c) => (ref.data as Record<string, number[]>)[c])
    close(cronbachAlpha(items), ref.alpha.alpha)
    const r = runSyntax(ds, `RELIABILITY /VARIABLES=q1 TO q5 /SCALE('ALL VARIABLES') ALL /MODEL=ALPHA /SUMMARY=TOTAL.`)
    expect(errorsIn(r.blocks)).toEqual([])
    const it = findTable(r.blocks, 'Item-Total Statistics')
    ref.alpha.alphaDrop.forEach((a, k) => expect(rowValues(it, `q${k + 1}`).at(-1)).toBe(fmt3(a)))
  })
})

describe('end-to-end syntax programs', () => {
  it('runs a typical analysis session without errors', () => {
    const program = `
* A typical session.
COMPUTE gain = post - pre.
RECODE age (LO THRU 29=1) (30 THRU 39=2) (40 THRU HI=3) INTO agegrp.
VARIABLE LABELS agegrp 'Age group'.
VALUE LABELS agegrp 1 'Under 30' 2 '30-39' 3 '40+'.
EXECUTE.
FREQUENCIES VARIABLES=gender agegrp /STATISTICS=MEAN MEDIAN MODE /BARCHART FREQ /ORDER=ANALYSIS.
DESCRIPTIVES VARIABLES=age income score /STATISTICS=MEAN STDDEV MIN MAX SKEWNESS KURTOSIS.
EXAMINE VARIABLES=score BY gender /PLOT BOXPLOT STEMLEAF NPPLOT /STATISTICS DESCRIPTIVES /NOTOTAL.
T-TEST GROUPS=gender(1 2) /VARIABLES=score.
T-TEST PAIRS=pre WITH post (PAIRED).
T-TEST /TESTVAL=60 /VARIABLES=pre.
ONEWAY score BY group /STATISTICS DESCRIPTIVES HOMOGENEITY WELCH BROWNFORSYTHE /PLOT MEANS /POSTHOC=TUKEY BONFERRONI GH ALPHA(0.05).
MEANS TABLES=score BY group /CELLS=MEAN COUNT STDDEV /STATISTICS ANOVA.
CORRELATIONS /VARIABLES=age income score /PRINT=TWOTAIL NOSIG.
NONPAR CORR /VARIABLES=age income score /PRINT=BOTH TWOTAIL NOSIG.
NPAR TESTS /M-W= score BY gender(1 2) /K-W=score BY group(1 3) /WILCOXON=pre WITH post (PAIRED) /FRIEDMAN=q1 q2 q3 /K-S(NORMAL)=score /CHISQUARE=group /EXPECTED=EQUAL.
GRAPH /BAR(SIMPLE)=MEAN(score) BY group.
GRAPH /SCATTERPLOT(BIVAR)=age WITH score BY gender /FITLINE TOTAL.
GRAPH /HISTOGRAM(NORMAL)=score.
GRAPH /PIE=COUNT BY group.
SORT CASES BY score (D).
SELECT IF (gender = 1).
DESCRIPTIVES VARIABLES=score.
`
    const r = runSyntax(ds, program)
    expect(errorsIn(r.blocks)).toEqual([])
    expect(r.dataset.variables.map((v) => v.name)).toContain('gain')
    expect(r.dataset.nCases).toBeLessThan(ds.nCases)
    const anova = findTable(r.blocks, 'ANOVA')
    expect(rowValues(anova, 'score', 'Between Groups')[3]).toBe(fmt3(ref.anova.f))
    const tt = findTable(r.blocks, 'Independent Samples Test')
    expect(rowValues(tt, 'score', 'Equal variances assumed')[2]).toBe(fmt3(ref.ttest.t))
    const freq = findTable(r.blocks, 'Age group')
    const total = rowValues(freq, 'Valid', 'Total')
    expect(Number(total[0])).toBe(ds.nCases - 1)
  })

  it('reports helpful errors and keeps going', () => {
    const r = runSyntax(ds, 'FREQUENCIES VARIABLES=nope.\nDESCRIPTIVES VARIABLES=age.\nFOO BAR.')
    const errs = errorsIn(r.blocks)
    expect(errs.length).toBe(2)
    expect(errs[0]).toMatch(/nope/)
    expect(errs[1]).toMatch(/Unrecognized command/)
    expect(findTable(r.blocks, 'Descriptive Statistics')).toBeTruthy()
  })

  it('filters and weights cases', () => {
    const r = runSyntax(
      ds,
      `COMPUTE filter_$=(gender=2).
FILTER BY filter_$.
FREQUENCIES VARIABLES=gender.
FILTER OFF.
COMPUTE w = 2.
WEIGHT BY w.
FREQUENCIES VARIABLES=gender.`,
    )
    expect(errorsIn(r.blocks)).toEqual([])
    const stats = r.blocks.flatMap((b) => b.items).filter((i) => i.kind === 'table' && i.table.title === 'Statistics')
    const n1 = rowValues((stats[0] as { table: never }).table, 'N', 'Valid')[0]
    const n2 = rowValues((stats[1] as { table: never }).table, 'N', 'Valid')[0]
    const females = (ref.data.gender as number[]).filter((g) => g === 2).length
    expect(Number(n1)).toBe(females)
    expect(Number(n2)).toBe(2 * ds.nCases)
  })
})
