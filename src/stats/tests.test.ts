import { describe, expect, it } from 'vitest'
import ref from './__fixtures__/tests_ref.json'
import { kurtosis, percentileHaverage, skewness, sortedCopy, trimmedMean, tukeyHinges } from './basic'
import { lilliefors, shapiroWilk } from './normality'
import {
  chiSquareGOF,
  friedman,
  independentT,
  kendallTauB,
  kruskalWallis,
  levene,
  mannWhitney,
  oneSampleT,
  onewayAnova,
  pairedT,
  pearsonTest,
  postHoc,
  spearman,
  welchAnova,
  wilcoxonSignedRank,
} from './tests'

const D = ref.data

function close(actual: number, expected: number, rel = 1e-8, abs = 1e-12) {
  const tol = Math.max(abs, rel * Math.abs(expected))
  expect(Math.abs(actual - expected), `actual ${actual} expected ${expected}`).toBeLessThanOrEqual(tol)
}

describe('t tests', () => {
  it('one-sample', () => {
    const r = oneSampleT(D.g1, 48)
    close(r.t, ref.oneSample.t)
    close(r.df, ref.oneSample.df)
    close(r.p2, ref.oneSample.p)
    close(r.lo, ref.oneSample.lo)
    close(r.hi, ref.oneSample.hi)
  })
  it('independent samples with Levene and Welch', () => {
    const r = independentT(D.g1, D.g2)
    const e = ref.indep
    close(r.equal.t, e.t)
    close(r.equal.df, e.df)
    close(r.equal.p2, e.p)
    close(r.equal.lo, e.lo)
    close(r.equal.hi, e.hi)
    close(r.welch.t, e.tW)
    close(r.welch.df, e.dfW)
    close(r.welch.p2, e.pW)
    close(r.welch.lo, e.loW)
    close(r.welch.hi, e.hiW)
    close(r.levene.f, e.levF)
    close(r.levene.p, e.levP)
  })
  it('paired samples', () => {
    const r = pairedT(D.t1, D.t2)
    const e = ref.paired
    close(r.t, e.t)
    close(r.p2, e.p)
    close(r.lo, e.lo)
    close(r.hi, e.hi)
    close(r.r, e.r)
    close(r.pR, e.pR)
  })
})

describe('one-way ANOVA', () => {
  const groups = [D.g1, D.g2, D.g3]
  it('F test', () => {
    const a = onewayAnova(groups)
    close(a.f, ref.anova.F)
    close(a.p, ref.anova.p)
  })
  it('Levene (mean and median)', () => {
    close(levene(groups, 'mean').f, ref.anova.levMeanF)
    close(levene(groups, 'mean').p, ref.anova.levMeanP)
    close(levene(groups, 'median').f, ref.anova.levMedianF)
    close(levene(groups, 'median').p, ref.anova.levMedianP)
  })
  it('Welch', () => {
    const w = welchAnova(groups)
    close(w.statistic, ref.anova.welchF)
    close(w.df2, ref.anova.welchDf2)
    close(w.p, ref.anova.welchP)
  })
  it('Tukey HSD', () => {
    const a = onewayAnova(groups)
    const comps = postHoc(groups, 'tukey', a.msw, a.dfw)
    for (const c of comps) {
      close(c.p, ref.tukey.p[c.i][c.j], 1e-5, 1e-6)
      close(c.lo, ref.tukey.low[c.i][c.j], 1e-6)
      close(c.hi, ref.tukey.high[c.i][c.j], 1e-6)
    }
  })
  it('Games-Howell', () => {
    const a = onewayAnova(groups)
    const comps = postHoc(groups, 'gh', a.msw, a.dfw)
    const idx: Record<string, number> = { a: 0, b: 1, c: 2 }
    ref.gh.A.forEach((A, k) => {
      const c = comps.find((x) => x.i === idx[A] && x.j === idx[ref.gh.B[k]])!
      close(c.diff, ref.gh.diff[k])
      close(c.se, ref.gh.se[k])
      close(c.p, ref.gh.p[k], 1e-4, 1e-5)
    })
  })
})

describe('correlations', () => {
  it('pearson', () => {
    const r = pearsonTest(D.g1, D.g3.slice(0, 23))
    close(r.r, ref.pearson.r)
    close(r.p2, ref.pearson.p)
  })
  it('spearman', () => {
    const r = spearman(D.t1, D.t2)
    close(r.r, ref.spearman.r)
    close(r.p2, ref.spearman.p)
  })
  it('kendall tau-b', () => {
    const r = kendallTauB(D.t1, D.t2)
    close(r.tau, ref.kendall.tau)
    close(r.p2, ref.kendall.p, 1e-6)
  })
})

describe('nonparametric', () => {
  it('Mann-Whitney asymptotic (ties)', () => {
    const r = mannWhitney(D.t1, D.t2.slice(0, 20))
    close(r.u, ref.mw.U)
    close(r.p2, ref.mw.p)
  })
  it('Mann-Whitney exact', () => {
    const r = mannWhitney(D.small_a, D.small_b)
    close(r.u, ref.mwExact.U)
    close(r.exactP!, ref.mwExact.p)
  })
  it('Wilcoxon signed rank', () => {
    const r = wilcoxonSignedRank(D.t1, D.t2)
    close(Math.min(r.sumPos, r.sumNeg), ref.wilcoxon.stat)
    close(r.p2, ref.wilcoxon.p)
    close(r.z, ref.wilcoxon.z)
  })
  it('Kruskal-Wallis', () => {
    const r = kruskalWallis([D.t1, D.t2, D.t3])
    close(r.h, ref.kw.H)
    close(r.p, ref.kw.p)
  })
  it('Friedman', () => {
    const rows = D.t1.map((_, i) => [D.t1[i], D.t2[i], D.t3[i]])
    const r = friedman(rows)
    close(r.chi2, ref.friedman.chi2)
    close(r.p, ref.friedman.p)
  })
  it('chi-square goodness of fit', () => {
    const r = chiSquareGOF([18, 25, 30, 27], [25, 25, 25, 25])
    close(r.chi2, ref.chisq.chi2)
    close(r.p, ref.chisq.p)
  })
})

describe('normality', () => {
  for (const [name, c] of Object.entries(ref.shapiro)) {
    it(`Shapiro-Wilk ${name}`, () => {
      const r = shapiroWilk(c.x)
      close(r.w, c.W, 1e-6)
      close(r.p, c.p, 1e-4, 1e-6)
    })
  }
  it('Lilliefors statistic and Dallal-Wilkinson p', () => {
    close(lilliefors(ref.lilliefors.g1.x).d, ref.lilliefors.g1.D)
    const s = lilliefors(ref.lilliefors.skew.x)
    close(s.d, ref.lilliefors.skew.D)
    close(s.p, ref.lilliefors.skew.p, 1e-8)
    const b = lilliefors(ref.lilliefors.big.x)
    close(b.d, ref.lilliefors.big.D)
    close(b.p, ref.lilliefors.big.p, 1e-8, 1e-40)
    // p above .2 is reported as the lower bound .200
    expect(lilliefors(ref.lilliefors.g1.x)).toMatchObject({ p: 0.2, lowerBound: true })
  })
})

describe('descriptives', () => {
  it('skewness & kurtosis match the bias-corrected G1/G2', () => {
    close(skewness(D.g2).value, ref.desc.skew)
    close(kurtosis(D.g2).value, ref.desc.kurt)
  })
  it('HAVERAGE percentiles match the (n+1)p definition', () => {
    const s = sortedCopy(D.g2)
    close(percentileHaverage(s, 0.25), ref.desc.p25)
    close(percentileHaverage(s, 0.9), ref.desc.p90)
    close(percentileHaverage(s, 0.05), ref.desc.p5)
  })
  it("Tukey's hinges", () => {
    expect(tukeyHinges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([3, 5.5, 8])
    expect(tukeyHinges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toEqual([3.5, 6, 8.5])
  })
  it('5% trimmed mean with fractional weights', () => {
    // n = 20: trims exactly one case from each end
    const x = Array.from({ length: 20 }, (_, i) => (i + 1) ** 2)
    const expected = x.slice(1, 19).reduce((a, b) => a + b, 0) / 18
    close(trimmedMean(x, 0.05), expected)
    // n = 10: half weights on the extremes
    const y = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
    close(trimmedMean(y, 0.05), (0.5 * 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 0.5 * 100) / 9)
  })
})
