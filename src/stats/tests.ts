// Pure implementations of the hypothesis tests used by the procedures (SPSS conventions).

import { mean, median, rank, sortedCopy, ssd, tieSum, trimmedMean, variance } from './basic'
import { chi2Sf, fSf, normSf, ptukeySf, qtukey, tInv, tSf2 } from './distributions'

export interface TResult {
  t: number
  df: number
  p2: number
  diff: number
  seDiff: number
  lo: number
  hi: number
}

function tci(diff: number, se: number, df: number, conf: number): [number, number] {
  const q = tInv(1 - (1 - conf) / 2, df)
  return [diff - q * se, diff + q * se]
}

export function oneSampleT(x: number[], mu0: number, conf = 0.95): TResult & { n: number; mean: number; sd: number; se: number } {
  const n = x.length
  const m = mean(x)
  const s = Math.sqrt(variance(x))
  const se = s / Math.sqrt(n)
  const t = (m - mu0) / se
  const df = n - 1
  const [lo, hi] = tci(m - mu0, se, df, conf)
  return { n, mean: m, sd: s, se, t, df, p2: tSf2(t, df), diff: m - mu0, seDiff: se, lo, hi }
}

export interface LeveneResult {
  f: number
  df1: number
  df2: number
  p: number
}

/** Levene's test on absolute deviations from the group mean, median or 5% trimmed mean. */
export function levene(groups: number[][], center: 'mean' | 'median' | 'trimmed' = 'mean'): LeveneResult {
  const devs = groups.map((g) => {
    const s = sortedCopy(g)
    const c = center === 'mean' ? mean(g) : center === 'median' ? median(s) : trimmedMean(s, 0.05)
    return g.map((x) => Math.abs(x - c))
  })
  const a = onewayAnova(devs)
  return { f: a.f, df1: a.dfb, df2: a.dfw, p: a.p }
}

export interface IndependentTResult {
  levene: LeveneResult
  equal: TResult
  welch: TResult
}

export function independentT(x1: number[], x2: number[], conf = 0.95): IndependentTResult {
  const n1 = x1.length
  const n2 = x2.length
  const m1 = mean(x1)
  const m2 = mean(x2)
  const v1 = variance(x1)
  const v2 = variance(x2)
  const diff = m1 - m2
  const df = n1 + n2 - 2
  const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / df
  const se = Math.sqrt(sp2 * (1 / n1 + 1 / n2))
  const t = diff / se
  const [lo, hi] = tci(diff, se, df, conf)
  const a = v1 / n1
  const b = v2 / n2
  const seW = Math.sqrt(a + b)
  const dfW = ((a + b) * (a + b)) / ((a * a) / (n1 - 1) + (b * b) / (n2 - 1))
  const tW = diff / seW
  const [loW, hiW] = tci(diff, seW, dfW, conf)
  return {
    levene: levene([x1, x2], 'mean'),
    equal: { t, df, p2: tSf2(t, df), diff, seDiff: se, lo, hi },
    welch: { t: tW, df: dfW, p2: tSf2(tW, dfW), diff, seDiff: seW, lo: loW, hi: hiW },
  }
}

export function pairedT(
  x: number[],
  y: number[],
  conf = 0.95,
): TResult & { meanDiff: number; sdDiff: number; se: number; r: number; pR: number; n: number } {
  const d = x.map((v, i) => v - y[i])
  const r = oneSampleT(d, 0, conf)
  const corr = pearsonTest(x, y)
  return { ...r, meanDiff: r.mean, sdDiff: r.sd, r: corr.r, pR: corr.p2, n: x.length }
}

export interface AnovaResult {
  ssb: number
  ssw: number
  sst: number
  dfb: number
  dfw: number
  dft: number
  msb: number
  msw: number
  f: number
  p: number
}

export function onewayAnova(groups: number[][]): AnovaResult {
  const all = groups.flat()
  const gm = mean(all)
  let ssb = 0
  let ssw = 0
  for (const g of groups) {
    if (!g.length) continue
    const m = mean(g)
    ssb += g.length * (m - gm) * (m - gm)
    ssw += ssd(g, m)
  }
  const k = groups.filter((g) => g.length).length
  const n = all.length
  const dfb = k - 1
  const dfw = n - k
  const msb = ssb / dfb
  const msw = ssw / dfw
  const f = msb / msw
  return { ssb, ssw, sst: ssb + ssw, dfb, dfw, dft: n - 1, msb, msw, f, p: fSf(f, dfb, dfw) }
}

export interface RobustF {
  statistic: number
  df1: number
  df2: number
  p: number
}

export function welchAnova(groups: number[][]): RobustF {
  const k = groups.length
  const w = groups.map((g) => g.length / variance(g))
  const W = w.reduce((s, x) => s + x, 0)
  const means = groups.map((g) => mean(g))
  const mw = means.reduce((s, m, i) => s + w[i] * m, 0) / W
  const a = means.reduce((s, m, i) => s + w[i] * (m - mw) ** 2, 0) / (k - 1)
  const lam = groups.reduce((s, g, i) => s + (1 - w[i] / W) ** 2 / (g.length - 1), 0)
  const b = 1 + ((2 * (k - 2)) / (k * k - 1)) * lam
  const f = a / b
  const df2 = (k * k - 1) / (3 * lam)
  return { statistic: f, df1: k - 1, df2, p: fSf(f, k - 1, df2) }
}

export function brownForsythe(groups: number[][]): RobustF {
  const k = groups.length
  const n = groups.reduce((s, g) => s + g.length, 0)
  const gm = mean(groups.flat())
  const means = groups.map((g) => mean(g))
  const vars = groups.map((g) => variance(g))
  const num = groups.reduce((s, g, i) => s + g.length * (means[i] - gm) ** 2, 0)
  const parts = groups.map((g, i) => (1 - g.length / n) * vars[i])
  const den = parts.reduce((s, x) => s + x, 0)
  const f = num / den
  const c = parts.map((p) => p / den)
  const df2 = 1 / groups.reduce((s, g, i) => s + (c[i] * c[i]) / (g.length - 1), 0)
  return { statistic: f, df1: k - 1, df2, p: fSf(f, k - 1, df2) }
}

export interface Comparison {
  i: number
  j: number
  diff: number
  se: number
  p: number
  lo: number
  hi: number
}

/** Pairwise post hoc comparisons for one-way ANOVA. */
export function postHoc(
  groups: number[][],
  method: 'lsd' | 'bonferroni' | 'sidak' | 'scheffe' | 'tukey' | 'gh',
  msw: number,
  dfw: number,
  alpha = 0.05,
): Comparison[] {
  const k = groups.length
  const means = groups.map((g) => mean(g))
  const ns = groups.map((g) => g.length)
  const vars = groups.map((g) => variance(g))
  const nComp = (k * (k - 1)) / 2
  const out: Comparison[] = []
  let qcrit = NaN
  if (method === 'tukey') qcrit = qtukey(1 - alpha, k, dfw)
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      if (i === j) continue
      const diff = means[i] - means[j]
      let se = Math.sqrt(msw * (1 / ns[i] + 1 / ns[j]))
      let p: number
      let half: number
      switch (method) {
        case 'lsd': {
          p = tSf2(diff / se, dfw)
          half = tInv(1 - alpha / 2, dfw) * se
          break
        }
        case 'bonferroni': {
          p = Math.min(1, tSf2(diff / se, dfw) * nComp)
          half = tInv(1 - alpha / (2 * nComp), dfw) * se
          break
        }
        case 'sidak': {
          p = Math.min(1, 1 - Math.pow(1 - tSf2(diff / se, dfw), nComp))
          const a1 = 1 - Math.pow(1 - alpha, 1 / nComp)
          half = tInv(1 - a1 / 2, dfw) * se
          break
        }
        case 'scheffe': {
          const f = (diff * diff) / (se * se * (k - 1))
          p = fSf(f, k - 1, dfw)
          half = Math.sqrt((k - 1) * fInvUpper(alpha, k - 1, dfw)) * se
          break
        }
        case 'tukey': {
          const q = Math.abs(diff) / (se / Math.SQRT2)
          p = ptukeySf(q, k, dfw)
          half = (qcrit / Math.SQRT2) * se
          break
        }
        case 'gh': {
          const a = vars[i] / ns[i]
          const b = vars[j] / ns[j]
          se = Math.sqrt(a + b)
          const df = ((a + b) * (a + b)) / ((a * a) / (ns[i] - 1) + (b * b) / (ns[j] - 1))
          const q = (Math.abs(diff) / se) * Math.SQRT2
          p = ptukeySf(q, k, df)
          half = (qtukey(1 - alpha, k, df) / Math.SQRT2) * se
          break
        }
      }
      out.push({ i, j, diff, se, p: Math.min(1, Math.max(0, p)), lo: diff - half, hi: diff + half })
    }
  return out
}

function fInvUpper(alpha: number, d1: number, d2: number): number {
  // upper alpha critical value of F
  let lo = 0
  let hi = 1
  while (fSf(hi, d1, d2) > alpha) hi *= 2
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2
    if (fSf(mid, d1, d2) > alpha) lo = mid
    else hi = mid
    if (hi - lo < 1e-12 * Math.max(1, hi)) break
  }
  return (lo + hi) / 2
}

// ------------------------------------------------------------------------- correlations

export function pearsonTest(x: number[], y: number[]): { r: number; p2: number; n: number } {
  const n = x.length
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  const r = sxx > 0 && syy > 0 ? Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))) : NaN
  let p2 = NaN
  if (n > 2 && Number.isFinite(r)) {
    if (Math.abs(r) >= 1) p2 = 0
    else {
      const t = r * Math.sqrt((n - 2) / (1 - r * r))
      p2 = tSf2(t, n - 2)
    }
  }
  return { r, p2, n }
}

export function spearman(x: number[], y: number[]): { r: number; p2: number; n: number } {
  return pearsonTest(rank(x).ranks, rank(y).ranks)
}

/** Kendall's tau-b with the SPSS large-sample significance. */
export function kendallTauB(x: number[], y: number[]): { tau: number; p2: number; n: number } {
  const n = x.length
  let concord = 0
  let discord = 0
  let tiesX = 0
  let tiesY = 0
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign(x[i] - x[j])
      const dy = Math.sign(y[i] - y[j])
      if (dx === 0 && dy === 0) continue
      if (dx === 0) tiesX++
      else if (dy === 0) tiesY++
      else if (dx === dy) concord++
      else discord++
    }
  const tau = (concord - discord) / Math.sqrt((concord + discord + tiesX) * (concord + discord + tiesY))
  // Variance of S with tie corrections (Kendall 1970), used for the asymptotic test.
  const tx = groupSizes(x)
  const ty = groupSizes(y)
  const v0 = n * (n - 1) * (2 * n + 5)
  const vt = tx.reduce((s, t) => s + t * (t - 1) * (2 * t + 5), 0)
  const vu = ty.reduce((s, u) => s + u * (u - 1) * (2 * u + 5), 0)
  const v1 =
    (tx.reduce((s, t) => s + t * (t - 1), 0) * ty.reduce((s, u) => s + u * (u - 1), 0)) / (2 * n * (n - 1))
  const v2 =
    n > 2
      ? (tx.reduce((s, t) => s + t * (t - 1) * (t - 2), 0) * ty.reduce((s, u) => s + u * (u - 1) * (u - 2), 0)) /
        (9 * n * (n - 1) * (n - 2))
      : 0
  const varS = (v0 - vt - vu) / 18 + v1 + v2
  const S = concord - discord
  const z = S / Math.sqrt(varS)
  return { tau, p2: 2 * normSf(Math.abs(z)), n }
}

function groupSizes(x: number[]): number[] {
  const m = new Map<number, number>()
  for (const v of x) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.values()].filter((c) => c > 1)
}

// ------------------------------------------------------------------------- nonparametric

export interface MannWhitneyResult {
  n1: number
  n2: number
  meanRank1: number
  meanRank2: number
  sumRank1: number
  sumRank2: number
  u: number
  w: number
  z: number
  p2: number
  exactP: number | null
}

export function mannWhitney(x1: number[], x2: number[]): MannWhitneyResult {
  const n1 = x1.length
  const n2 = x2.length
  const all = [...x1, ...x2]
  const { ranks, ties } = rank(all)
  const r1 = ranks.slice(0, n1).reduce((s, r) => s + r, 0)
  const r2 = ranks.slice(n1).reduce((s, r) => s + r, 0)
  // U for each group = its rank sum minus the minimum possible rank sum; SPSS reports the smaller
  // U and, as Wilcoxon W, the rank sum of the group that produced it.
  const u1 = r1 - (n1 * (n1 + 1)) / 2
  const u2 = r2 - (n2 * (n2 + 1)) / 2
  const u = Math.min(u1, u2)
  const w = u1 <= u2 ? r1 : r2
  const n = n1 + n2
  const varU = ((n1 * n2) / (n * (n - 1))) * ((n * n * n - n) / 12 - tieSum(ties) / 12)
  const z = (u - (n1 * n2) / 2) / Math.sqrt(varU)
  let exactP: number | null = null
  if (n1 * n2 <= 400 && (n1 * n2) / 2 + Math.min(n1, n2) <= 220) exactP = Math.min(1, 2 * exactUCdf(Math.floor(u + 1e-9), n1, n2))
  return {
    n1,
    n2,
    meanRank1: r1 / n1,
    meanRank2: r2 / n2,
    sumRank1: r1,
    sumRank2: r2,
    u,
    w,
    z,
    p2: 2 * normSf(Math.abs(z)),
    exactP,
  }
}

/** P(U <= u) for the Mann–Whitney U statistic without ties (exact distribution). */
export function exactUCdf(u: number, n1: number, n2: number): number {
  // f[i][j][k] = number of orderings of i and j observations with U = k:
  // f(i, j, k) = f(i - 1, j, k - j) + f(i, j - 1, k)
  const f: number[][][] = []
  for (let i = 0; i <= n1; i++) {
    f[i] = []
    for (let j = 0; j <= n2; j++) {
      const arr = new Array<number>(i * j + 1).fill(0)
      if (i === 0 || j === 0) arr[0] = 1
      else {
        const a = f[i - 1][j]
        const b = f[i][j - 1]
        for (let k = 0; k <= i * j; k++) arr[k] = (k - j >= 0 && k - j < a.length ? a[k - j] : 0) + (k < b.length ? b[k] : 0)
      }
      f[i][j] = arr
    }
  }
  const counts = f[n1][n2]
  let total = 0
  for (const c of counts) total += c
  let cum = 0
  for (let k = 0; k <= Math.min(u, n1 * n2); k++) cum += counts[k]
  return cum / total
}

export interface WilcoxonResult {
  nNeg: number
  nPos: number
  nTies: number
  meanRankNeg: number
  meanRankPos: number
  sumNeg: number
  sumPos: number
  z: number
  p2: number
  basedOn: 'positive' | 'negative'
}

/** Wilcoxon signed-rank test for second minus first (SPSS: var2 - var1). */
export function wilcoxonSignedRank(first: number[], second: number[]): WilcoxonResult {
  const d = first.map((x, i) => second[i] - x)
  const nz = d.filter((x) => x !== 0)
  const nTies = d.length - nz.length
  const { ranks, ties } = rank(nz.map(Math.abs))
  let sumPos = 0
  let sumNeg = 0
  let nPos = 0
  let nNeg = 0
  nz.forEach((x, i) => {
    if (x > 0) {
      sumPos += ranks[i]
      nPos++
    } else {
      sumNeg += ranks[i]
      nNeg++
    }
  })
  const n = nz.length
  const mu = (n * (n + 1)) / 4
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tieSum(ties) / 48)
  const basedOn: 'positive' | 'negative' = sumPos < sumNeg ? 'positive' : 'negative'
  const s = Math.min(sumPos, sumNeg)
  const z = n ? (s - mu) / sigma : NaN
  return {
    nNeg,
    nPos,
    nTies,
    meanRankNeg: nNeg ? sumNeg / nNeg : NaN,
    meanRankPos: nPos ? sumPos / nPos : NaN,
    sumNeg,
    sumPos,
    z,
    p2: 2 * normSf(Math.abs(z)),
    basedOn,
  }
}

export function kruskalWallis(groups: number[][]): { h: number; df: number; p: number; meanRanks: number[]; ns: number[] } {
  const all = groups.flat()
  const N = all.length
  const { ranks, ties } = rank(all)
  let off = 0
  let s = 0
  const meanRanks: number[] = []
  for (const g of groups) {
    const r = ranks.slice(off, off + g.length).reduce((a, b) => a + b, 0)
    off += g.length
    if (g.length) s += (r * r) / g.length
    meanRanks.push(g.length ? r / g.length : NaN)
  }
  const h0 = (12 / (N * (N + 1))) * s - 3 * (N + 1)
  const h = h0 / (1 - tieSum(ties) / (N * N * N - N))
  const df = groups.filter((g) => g.length).length - 1
  return { h, df, p: chi2Sf(h, df), meanRanks, ns: groups.map((g) => g.length) }
}

/** Friedman test on rows = cases, columns = related variables. */
export function friedman(rows: number[][]): { chi2: number; df: number; p: number; meanRanks: number[]; n: number } {
  const n = rows.length
  const k = rows[0]?.length ?? 0
  const rankSums = new Array<number>(k).fill(0)
  let tieTerm = 0
  for (const r of rows) {
    const { ranks, ties } = rank(r)
    ranks.forEach((x, j) => (rankSums[j] += x))
    tieTerm += tieSum(ties)
  }
  const sumR2 = rankSums.reduce((s, r) => s + r * r, 0)
  const num = 12 * sumR2 - 3 * n * n * k * (k + 1) * (k + 1)
  const den = n * k * (k + 1) - tieTerm / (k - 1)
  const chi2 = num / den
  return { chi2, df: k - 1, p: chi2Sf(chi2, k - 1), meanRanks: rankSums.map((r) => r / n), n }
}

export function chiSquareGOF(observed: number[], expected: number[]): { chi2: number; df: number; p: number } {
  let chi2 = 0
  for (let i = 0; i < observed.length; i++) chi2 += (observed[i] - expected[i]) ** 2 / expected[i]
  const df = observed.length - 1
  return { chi2, df, p: chi2Sf(chi2, df) }
}
