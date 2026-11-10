// Descriptive building blocks using SPSS's definitions (sample variance, G1/G2 skewness & kurtosis,
// HAVERAGE percentiles, Tukey hinges, fractional 5% trimmed mean).

export function sum(x: ArrayLike<number>): number {
  // Neumaier compensated summation
  let s = 0
  let c = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const t = s + v
    if (Math.abs(s) >= Math.abs(v)) c += s - t + v
    else c += v - t + s
    s = t
  }
  return s + c
}

export function mean(x: ArrayLike<number>): number {
  return x.length ? sum(x) / x.length : NaN
}

/** Sum of squared deviations from the mean (two-pass). */
export function ssd(x: ArrayLike<number>, m = mean(x)): number {
  let s = 0
  for (let i = 0; i < x.length; i++) {
    const d = x[i] - m
    s += d * d
  }
  return s
}

export function variance(x: ArrayLike<number>): number {
  return x.length > 1 ? ssd(x) / (x.length - 1) : NaN
}

export function sd(x: ArrayLike<number>): number {
  return Math.sqrt(variance(x))
}

export function minmax(x: ArrayLike<number>): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < x.length; i++) {
    if (x[i] < lo) lo = x[i]
    if (x[i] > hi) hi = x[i]
  }
  return [lo, hi]
}

/** SPSS skewness (G1) and its standard error. */
export function skewness(x: ArrayLike<number>): { value: number; se: number } {
  const n = x.length
  if (n < 3) return { value: NaN, se: NaN }
  const m = mean(x)
  let m2 = 0
  let m3 = 0
  for (let i = 0; i < n; i++) {
    const d = x[i] - m
    m2 += d * d
    m3 += d * d * d
  }
  const s2 = m2 / (n - 1)
  const value = s2 === 0 ? NaN : (n * m3) / ((n - 1) * (n - 2) * Math.pow(s2, 1.5))
  return { value, se: seSkewness(n) }
}

export function seSkewness(n: number): number {
  if (n < 3) return NaN
  return Math.sqrt((6 * n * (n - 1)) / ((n - 2) * (n + 1) * (n + 3)))
}

/** SPSS kurtosis (G2, excess) and its standard error. */
export function kurtosis(x: ArrayLike<number>): { value: number; se: number } {
  const n = x.length
  if (n < 4) return { value: NaN, se: NaN }
  const m = mean(x)
  let m2 = 0
  let m4 = 0
  for (let i = 0; i < n; i++) {
    const d = x[i] - m
    const d2 = d * d
    m2 += d2
    m4 += d2 * d2
  }
  const s2 = m2 / (n - 1)
  const value =
    s2 === 0
      ? NaN
      : (n * (n + 1) * m4) / ((n - 1) * (n - 2) * (n - 3) * s2 * s2) - (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3))
  return { value, se: seKurtosis(n) }
}

export function seKurtosis(n: number): number {
  if (n < 4) return NaN
  const ses = seSkewness(n)
  return Math.sqrt((4 * (n * n - 1) * ses * ses) / ((n - 3) * (n + 5)))
}

export function sortedCopy(x: ArrayLike<number>): number[] {
  return Array.from(x).sort((a, b) => a - b)
}

/** SPSS HAVERAGE percentile (weighted average at (n+1)p), p in [0, 1], on sorted data. */
export function percentileHaverage(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  const tp = (n + 1) * p
  const k = Math.floor(tp)
  const frac = tp - k
  if (k < 1) return sorted[0]
  if (k >= n) return sorted[n - 1]
  return sorted[k - 1] + frac * (sorted[k] - sorted[k - 1])
}

export function median(sorted: ArrayLike<number>): number {
  const n = sorted.length
  if (n === 0) return NaN
  const h = n >> 1
  return n % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2
}

/** Tukey's hinges on sorted data: [lower hinge, median, upper hinge]. */
export function tukeyHinges(sorted: ArrayLike<number>): [number, number, number] {
  const n = sorted.length
  if (n === 0) return [NaN, NaN, NaN]
  const depthMedian = (n + 1) / 2
  const depthHinge = (Math.floor(depthMedian) + 1) / 2
  const at = (depth: number, fromTop: boolean) => {
    const lo = Math.floor(depth)
    const hi = Math.ceil(depth)
    const get = (d: number) => (fromTop ? sorted[n - d] : sorted[d - 1])
    return (get(lo) + get(hi)) / 2
  }
  return [at(depthHinge, false), median(sorted), at(depthHinge, true)]
}

/** SPSS 5% trimmed mean with fractional weighting of the partially trimmed cases (sorted data). */
export function trimmedMean(sorted: ArrayLike<number>, prop = 0.05): number {
  const n = sorted.length
  if (n === 0) return NaN
  const tc = prop * n
  if (tc <= 0) return mean(sorted)
  // Weighted sum of the middle with fractional end weights. Cases are 1-indexed with cumulative count i.
  const k1 = Math.max(1, Math.ceil(tc - 1e-12))
  const k2 = Math.max(k1, Math.ceil(n - tc - 1e-12))
  let s = 0
  if (k1 === k2) {
    s = (n - 2 * tc) * sorted[k1 - 1]
  } else {
    s += (k1 - tc) * sorted[k1 - 1]
    for (let i = k1 + 1; i <= k2 - 1; i++) s += sorted[i - 1]
    s += (n - tc - (k2 - 1)) * sorted[k2 - 1]
  }
  return s / (n * (1 - 2 * prop))
}

/** Mode(s): returns the smallest mode and whether multiple modes exist. */
export function mode(x: ArrayLike<number>): { value: number; multiple: boolean } {
  const counts = new Map<number, number>()
  for (let i = 0; i < x.length; i++) counts.set(x[i], (counts.get(x[i]) ?? 0) + 1)
  let best = 0
  for (const c of counts.values()) if (c > best) best = c
  let value = Infinity
  let nBest = 0
  for (const [v, c] of counts)
    if (c === best) {
      nBest++
      if (v < value) value = v
    }
  return { value: nBest ? value : NaN, multiple: nBest > 1 }
}

export interface RankResult {
  ranks: number[]
  /** Sizes of tie groups (only groups with size > 1). */
  ties: number[]
}

/** Average ranks (1-based), ties get the mean rank. */
export function rank(x: ArrayLike<number>): RankResult {
  const n = x.length
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b])
  const ranks = new Array<number>(n)
  const ties: number[] = []
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && x[idx[j + 1]] === x[idx[i]]) j++
    const r = (i + j + 2) / 2
    for (let k = i; k <= j; k++) ranks[idx[k]] = r
    if (j > i) ties.push(j - i + 1)
    i = j + 1
  }
  return { ranks, ties }
}

/** Σ (t³ − t) over tie groups. */
export function tieSum(ties: number[]): number {
  let s = 0
  for (const t of ties) s += t * t * t - t
  return s
}

export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return NaN
  return sxy / Math.sqrt(sxx * syy)
}

export function covariance(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length
  const mx = mean(x)
  const my = mean(y)
  let s = 0
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my)
  return s / (n - 1)
}

/** Seeded PRNG (mulberry32) for reproducible sample data and random selections. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Summary {
  n: number
  mean: number
  sd: number
  variance: number
  se: number
  min: number
  max: number
  range: number
  sum: number
  median: number
  skew: number
  seSkew: number
  kurt: number
  seKurt: number
}

/** All the usual descriptive statistics of a sample. */
export function summarize(values: ArrayLike<number>): Summary {
  const n = values.length
  const s = sortedCopy(values)
  const m = mean(s)
  const v = variance(s)
  const sk = skewness(s)
  const ku = kurtosis(s)
  return {
    n,
    mean: m,
    sd: Math.sqrt(v),
    variance: v,
    se: Math.sqrt(v / n),
    min: n ? s[0] : NaN,
    max: n ? s[n - 1] : NaN,
    range: n ? s[n - 1] - s[0] : NaN,
    sum: sum(s),
    median: median(s),
    skew: sk.value,
    seSkew: sk.se,
    kurt: ku.value,
    seKurt: ku.se,
  }
}
