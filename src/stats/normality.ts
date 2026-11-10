// Normality tests as reported by SPSS EXAMINE ("Tests of Normality") and NPAR TESTS /K-S.

import { mean, sd } from './basic'
import { normCdf, normInv, normSf } from './distributions'

function poly(c: number[], x: number): number {
  let r = c[c.length - 1]
  for (let i = c.length - 2; i >= 0; i--) r = r * x + c[i]
  return r
}

// Royston (1995), Algorithm AS R94 polynomial coefficients.
const C1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056]
const C2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633]
const C3 = [0.544, -0.39978, 0.025054, -6.714e-4]
const C4 = [1.3822, -0.77857, 0.062767, -0.0020322]
const C5 = [-1.5861, -0.31082, -0.083751, 0.0038915]
const C6 = [-0.4803, -0.082676, 0.0030302]
const G = [-2.273, 0.459]

/** Shapiro–Wilk W test (Royston's approximation, valid for 3 <= n <= 5000). */
export function shapiroWilk(x: number[]): { w: number; p: number } {
  const n = x.length
  if (n < 3) return { w: NaN, p: NaN }
  const s = [...x].sort((a, b) => a - b)
  if (s[n - 1] - s[0] < 1e-19 * Math.max(1, Math.abs(s[0]))) return { w: NaN, p: NaN }
  const nn2 = Math.floor(n / 2)
  const a = new Array<number>(nn2 + 1).fill(0) // 1-indexed
  if (n === 3) {
    a[1] = Math.SQRT1_2
  } else {
    const an25 = n + 0.25
    const m = new Array<number>(nn2 + 1).fill(0)
    let summ2 = 0
    for (let i = 1; i <= nn2; i++) {
      m[i] = normInv((i - 0.375) / an25)
      summ2 += m[i] * m[i]
    }
    summ2 *= 2
    const ssumm2 = Math.sqrt(summ2)
    const rsn = 1 / Math.sqrt(n)
    const a1 = poly(C1, rsn) - m[1] / ssumm2
    let i1: number
    let fac: number
    if (n > 5) {
      i1 = 3
      const a2 = -m[2] / ssumm2 + poly(C2, rsn)
      fac = Math.sqrt((summ2 - 2 * m[1] * m[1] - 2 * m[2] * m[2]) / (1 - 2 * a1 * a1 - 2 * a2 * a2))
      a[2] = a2
    } else {
      i1 = 2
      fac = Math.sqrt((summ2 - 2 * m[1] * m[1]) / (1 - 2 * a1 * a1))
    }
    a[1] = a1
    for (let i = i1; i <= nn2; i++) a[i] = -m[i] / fac
  }
  const mu = mean(s)
  let ssq = 0
  for (const v of s) ssq += (v - mu) * (v - mu)
  let b = 0
  for (let i = 1; i <= nn2; i++) b += a[i] * (s[n - i] - s[i - 1])
  const w = Math.min(1, (b * b) / ssq)

  if (n === 3) {
    const p = Math.max(0, Math.min(1, (6 / Math.PI) * (Math.asin(Math.sqrt(w)) - Math.PI / 3)))
    return { w, p }
  }
  const w1 = Math.log(1 - w)
  let y: number
  let mm: number
  let ss: number
  if (n <= 11) {
    const gamma = poly(G, n)
    if (w1 >= gamma) return { w, p: 0 }
    y = -Math.log(gamma - w1)
    mm = poly(C3, n)
    ss = Math.exp(poly(C4, n))
  } else {
    const xx = Math.log(n)
    mm = poly(C5, xx)
    ss = Math.exp(poly(C6, xx))
    y = w1
  }
  return { w, p: normSf((y - mm) / ss) }
}

export interface KSResult {
  /** Most extreme differences. */
  d: number
  dPlus: number
  dMinus: number
  mean: number
  sd: number
  /** Lilliefors-corrected significance. */
  p: number
  /** True when p is a lower bound (reported as .200*). */
  lowerBound: boolean
}

/**
 * Kolmogorov–Smirnov test against a normal with estimated mean/SD and Lilliefors-corrected
 * significance using the Dallal & Wilkinson (1986) approximation; values above .200 are reported
 * as the lower bound .200 like SPSS.
 */
export function lilliefors(x: number[]): KSResult {
  const n = x.length
  const s = [...x].sort((a, b) => a - b)
  const m = mean(s)
  const sdev = sd(s)
  let dPlus = 0
  let dMinus = 0
  if (!(sdev > 0)) return { d: NaN, dPlus: NaN, dMinus: NaN, mean: m, sd: sdev, p: NaN, lowerBound: false }
  for (let i = 0; i < n; i++) {
    const f = normCdf((s[i] - m) / sdev)
    // last occurrence of a tie gets the full ECDF jump
    if (i === n - 1 || s[i + 1] !== s[i]) dPlus = Math.max(dPlus, (i + 1) / n - f)
    if (i === 0 || s[i - 1] !== s[i]) dMinus = Math.max(dMinus, f - i / n)
  }
  const d = Math.max(dPlus, dMinus)
  const { p, lowerBound } = lillieforsP(d, n)
  return { d, dPlus, dMinus: -dMinus, mean: m, sd: sdev, p, lowerBound }
}

export function lillieforsP(d: number, n: number): { p: number; lowerBound: boolean } {
  let nn = n
  let dd = d
  if (n > 100) {
    dd = d * Math.pow(n / 100, 0.49)
    nn = 100
  }
  let p = Math.exp(
    -7.01256 * dd * dd * (nn + 2.78019) +
      2.99587 * dd * Math.sqrt(nn + 2.78019) -
      0.122119 +
      0.974598 / Math.sqrt(nn) +
      1.67997 / nn,
  )
  if (p > 0.2 || !Number.isFinite(p)) return { p: 0.2, lowerBound: true }
  p = Math.max(0, p)
  return { p, lowerBound: false }
}

/** Blom normal scores used by Q-Q plots: Φ⁻¹((r − 3/8) / (n + 1/4)). */
export function blomScore(rank: number, n: number): number {
  return normInv((rank - 0.375) / (n + 0.25))
}
