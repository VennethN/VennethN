// Special functions and probability distributions.
// Algorithms: Lanczos log-gamma, Numerical-Recipes style continued fractions for the incomplete
// gamma/beta functions, Hart/West normal CDF, Wichura AS241 normal quantile, Brent root finding.

const FPMIN = 1e-300
const LN_SQRT_2PI = 0.9189385332046727 // ln(sqrt(2*pi))

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]

/** Natural log of the gamma function for x > 0 (reflection for x < 0.5). */
export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x)
  x -= 1
  let a = LANCZOS[0]
  const t = x + 7.5
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i)
  return LN_SQRT_2PI + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

export function lbeta(a: number, b: number): number {
  return lgamma(a) + lgamma(b) - lgamma(a + b)
}

/** ln(n!) */
export function lfact(n: number): number {
  return lgamma(n + 1)
}

// ---------------------------------------------------------------- incomplete gamma

function gser(a: number, x: number): number {
  let ap = a
  let sum = 1 / a
  let del = sum
  for (let n = 0; n < 100000; n++) {
    ap += 1
    del *= x / ap
    sum += del
    if (Math.abs(del) < Math.abs(sum) * 1e-16) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a))
}

function gcf(a: number, x: number): number {
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i < 100000; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-16) break
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0
  if (!Number.isFinite(x)) return 1
  return x < a + 1 ? gser(a, x) : 1 - gcf(a, x)
}

/** Regularized upper incomplete gamma Q(a, x) = 1 - P(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1
  if (!Number.isFinite(x)) return 0
  return x < a + 1 ? 1 - gser(a, x) : gcf(a, x)
}

// ---------------------------------------------------------------- incomplete beta

function betacf(a: number, b: number, x: number): number {
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 100000; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-16) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
export function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lbt = a * Math.log(x) + b * Math.log1p(-x) - lbeta(a, b)
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(lbt) * betacf(a, b, x)) / a
  return 1 - (Math.exp(lbt) * betacf(b, a, 1 - x)) / b
}

/** 1 - I_x(a, b), computed without cancellation. */
export function ibetac(x: number, a: number, b: number): number {
  return ibeta(1 - x, b, a)
}

// ---------------------------------------------------------------- normal

/** Standard normal density. */
export function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z - LN_SQRT_2PI)
}

/** Standard normal CDF (Hart 1968 / West 2005, double precision). */
export function normCdf(z: number): number {
  if (Number.isNaN(z)) return NaN
  const xa = Math.abs(z)
  let c: number
  if (xa > 37) c = 0
  else {
    const e = Math.exp((-xa * xa) / 2)
    if (xa < 7.07106781186547) {
      let n = 3.52624965998911e-2 * xa + 0.700383064443688
      n = n * xa + 6.37396220353165
      n = n * xa + 33.912866078383
      n = n * xa + 112.079291497871
      n = n * xa + 221.213596169931
      n = n * xa + 220.206867912376
      let d = 8.83883476483184e-2 * xa + 1.75566716318264
      d = d * xa + 16.064177579207
      d = d * xa + 86.7807322029461
      d = d * xa + 296.564248779674
      d = d * xa + 637.333633378831
      d = d * xa + 793.826512519948
      d = d * xa + 440.413735824752
      c = (e * n) / d
    } else {
      // Far tail: Φ(-x) = Q(1/2, x²/2) / 2 via the incomplete-gamma continued fraction.
      c = 0.5 * gammaQ(0.5, (xa * xa) / 2)
    }
  }
  return z > 0 ? 1 - c : c
}

/** Upper tail of the standard normal. */
export function normSf(z: number): number {
  return normCdf(-z)
}

/** Standard normal quantile (Wichura AS241, ~1e-16 relative accuracy). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  const q = p - 0.5
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q
    return (
      (q *
        (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r +
          45921.953931549871457) *
          r +
          13731.693765509461125) *
          r +
          1971.5909503065514427) *
          r +
          133.14166789178437745) *
          r +
          3.387132872796366608)) /
      (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r +
        21213.794301586595867) *
        r +
        5394.1960214247511077) *
        r +
        687.1870074920579083) *
        r +
        42.313330701600911252) *
        r +
        1)
    )
  }
  let r = q < 0 ? p : 1 - p
  r = Math.sqrt(-Math.log(r))
  let val: number
  if (r <= 5) {
    r -= 1.6
    val =
      (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r +
        1.27045825245236838258) *
        r +
        3.64784832476320460504) *
        r +
        5.7694972214606914055) *
        r +
        4.6303378461565452959) *
        r +
        1.42343711074968357734) /
      (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r +
        0.14810397642748007459) *
        r +
        0.68976733498510000455) *
        r +
        1.6763848301838038494) *
        r +
        2.05319162663775882187) *
        r +
        1)
  } else {
    r -= 5
    val =
      (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r +
        0.026532189526576123093) *
        r +
        0.29656057182850489123) *
        r +
        1.7848265399172913358) *
        r +
        5.4637849111641143699) *
        r +
        6.6579046435011037772) /
      (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r +
        7.868691311456132591e-4) *
        r +
        0.0148753612908506148525) *
        r +
        0.13692988092273580531) *
        r +
        0.59983220655588793769) *
        r +
        1)
  }
  return q < 0 ? -val : val
}

// ---------------------------------------------------------------- Student t

export function tCdf(t: number, df: number): number {
  if (Number.isNaN(t)) return NaN
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0
  if (df > 1e8) return normCdf(t)
  const x = df / (df + t * t)
  const tail = 0.5 * ibeta(x, df / 2, 0.5)
  return t > 0 ? 1 - tail : tail
}

/** Two-sided p-value for a t statistic. */
export function tSf2(t: number, df: number): number {
  if (Number.isNaN(t)) return NaN
  if (df > 1e8) return 2 * normSf(Math.abs(t))
  return ibeta(df / (df + t * t), df / 2, 0.5)
}

/** One-sided upper-tail p-value P(T > t). */
export function tSf(t: number, df: number): number {
  return t >= 0 ? 0.5 * tSf2(t, df) : 1 - 0.5 * tSf2(t, df)
}

export function tInv(p: number, df: number): number {
  if (df > 1e8) return normInv(p)
  if (p === 0.5) return 0
  return invertIncreasing((x) => tCdf(x, df), p, normInv(p), -Infinity, Infinity)
}

// ---------------------------------------------------------------- F and chi-square

export function fCdf(f: number, d1: number, d2: number): number {
  if (f <= 0) return 0
  return ibeta((d1 * f) / (d1 * f + d2), d1 / 2, d2 / 2)
}

/** Upper tail P(F > f). */
export function fSf(f: number, d1: number, d2: number): number {
  if (Number.isNaN(f)) return NaN
  if (f <= 0) return 1
  return ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2)
}

export function fInv(p: number, d1: number, d2: number): number {
  return invertIncreasing((x) => fCdf(x, d1, d2), p, 1, 0, Infinity)
}

export function chi2Cdf(x: number, k: number): number {
  return gammaP(k / 2, x / 2)
}

export function chi2Sf(x: number, k: number): number {
  if (Number.isNaN(x)) return NaN
  return gammaQ(k / 2, x / 2)
}

export function chi2Inv(p: number, k: number): number {
  return invertIncreasing((x) => chi2Cdf(x, k), p, Math.max(k, 1), 0, Infinity)
}

// ---------------------------------------------------------------- numerical tools

/** Brent's method (zeroin) for a root of f in [a, b] where f(a), f(b) have opposite signs. */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-13, maxIter = 300): number {
  let fa = f(a)
  let fb = f(b)
  if (fa === 0) return a
  if (fb === 0) return b
  if (fa * fb > 0) throw new Error('brent: root not bracketed')
  let c = a
  let fc = fa
  let d = b - a
  let e = d
  for (let iter = 0; iter < maxIter; iter++) {
    if (fb * fc > 0) {
      c = a
      fc = fa
      d = b - a
      e = d
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b
      b = c
      c = a
      fa = fb
      fb = fc
      fc = fa
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol
    const xm = 0.5 * (c - b)
    if (Math.abs(xm) <= tol1 || fb === 0) return b
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa
      let p: number
      let q: number
      if (a === c) {
        p = 2 * xm * s
        q = 1 - s
      } else {
        const qq = fa / fc
        const r = fb / fc
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1))
        q = (qq - 1) * (r - 1) * (s - 1)
      }
      if (p > 0) q = -q
      p = Math.abs(p)
      const min1 = 3 * xm * q - Math.abs(tol1 * q)
      const min2 = Math.abs(e * q)
      if (2 * p < Math.min(min1, min2)) {
        e = d
        d = p / q
      } else {
        d = xm
        e = d
      }
    } else {
      d = xm
      e = d
    }
    a = b
    fa = fb
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1
    fb = f(b)
  }
  return b
}

/** Invert an increasing CDF: find x with cdf(x) = p, expanding a bracket around a guess. */
export function invertIncreasing(
  cdf: (x: number) => number,
  p: number,
  guess: number,
  lower: number,
  upper: number,
  relTol = 1e-14,
): number {
  if (p <= 0) return lower
  if (p >= 1) return upper
  let lo = guess
  let hi = guess
  let step = Math.max(1, Math.abs(guess) * 0.5)
  // expand downward
  let guard = 0
  while (cdf(lo) > p && guard++ < 2000) {
    lo = lo - step
    step *= 2
    if (lo <= lower) {
      lo = lower === -Infinity ? lo : lower
      if (lower !== -Infinity) break
    }
  }
  step = Math.max(1, Math.abs(guess) * 0.5)
  guard = 0
  while (cdf(hi) < p && guard++ < 2000) {
    hi = hi + step
    step *= 2
    if (hi >= upper) {
      hi = upper
      break
    }
  }
  const scale = Math.max(1, Math.abs(lo), Math.abs(hi))
  return brent((x) => cdf(x) - p, lo, hi, relTol * scale)
}

/** Gauss–Legendre nodes and weights on [-1, 1]. */
export function gaussLegendre(n: number): { x: Float64Array; w: Float64Array } {
  const x = new Float64Array(n)
  const w = new Float64Array(n)
  const m = (n + 1) >> 1
  for (let i = 0; i < m; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5))
    let pp = 0
    for (let iter = 0; iter < 100; iter++) {
      let p1 = 1
      let p2 = 0
      for (let j = 0; j < n; j++) {
        const p3 = p2
        p2 = p1
        p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1)
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1)
      const z1 = z
      z = z1 - p1 / pp
      if (Math.abs(z - z1) < 1e-15) break
    }
    x[i] = -z
    x[n - 1 - i] = z
    w[i] = 2 / ((1 - z * z) * pp * pp)
    w[n - 1 - i] = w[i]
  }
  return { x, w }
}

const GL20 = gaussLegendre(20)

/** Composite 20-point Gauss–Legendre integration over [a, b] with `pieces` equal panels. */
export function integrate(f: (x: number) => number, a: number, b: number, pieces = 8): number {
  const h = (b - a) / pieces
  let sum = 0
  for (let k = 0; k < pieces; k++) {
    const mid = a + (k + 0.5) * h
    const half = h / 2
    let s = 0
    for (let i = 0; i < 20; i++) s += GL20.w[i] * f(mid + half * GL20.x[i])
    sum += s * half
  }
  return sum
}

// ---------------------------------------------------------------- studentized range

/** P(range of k iid N(0,1) <= w). */
function rangeCdf(w: number, k: number): number {
  if (w <= 0) return 0
  if (k === 2) return 2 * normCdf(w / Math.SQRT2) - 1
  // k * ∫ φ(z) [Φ(z + w) − Φ(z)]^(k−1) dz, z = sample minimum
  const f = (z: number) => {
    const d = normCdf(z + w) - normCdf(z)
    return d <= 0 ? 0 : normPdf(z) * Math.pow(d, k - 1)
  }
  const v = k * integrate(f, -8.5, 8.5, 14)
  return Math.min(1, Math.max(0, v))
}

/** CDF of the studentized range distribution Q(k, df). */
export function ptukey(q: number, k: number, df: number): number {
  if (q <= 0) return 0
  if (!Number.isFinite(df) || df > 1e6) return rangeCdf(q, k)
  // Mix over s = sqrt(chi2_df / df): density f(s) = df^(df/2) s^(df-1) exp(-df s^2 / 2) / (Γ(df/2) 2^(df/2-1))
  const logC = (df / 2) * Math.log(df) - lgamma(df / 2) - (df / 2 - 1) * Math.LN2
  const dens = (s: number) => (s <= 0 ? 0 : Math.exp(logC + (df - 1) * Math.log(s) - (df * s * s) / 2))
  // Integration range from Wilson–Hilferty chi-square quantiles at ±9 sd, padded.
  const wh = (z: number) => {
    const c = 1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))
    return c <= 0 ? 0 : df * c * c * c
  }
  const sLo = Math.max(0, Math.sqrt(wh(-9) / df) - 0.05)
  const sHi = Math.sqrt(wh(9) / df) + 0.05 + (df < 5 ? 2 : 0)
  const v = integrate((s) => dens(s) * rangeCdf(q * s, k), sLo, sHi, df < 10 ? 24 : 16)
  return Math.min(1, Math.max(0, v))
}

export function ptukeySf(q: number, k: number, df: number): number {
  return Math.max(0, 1 - ptukey(q, k, df))
}

export function qtukey(p: number, k: number, df: number): number {
  return invertIncreasing((x) => ptukey(x, k, df), p, 3.5, 0, Infinity, 1e-10)
}

// ---------------------------------------------------------------- discrete helpers

/** Hypergeometric probability of the 2x2 table with top-left cell a, given margins. */
export function hypergeomPmf(a: number, row1: number, col1: number, n: number): number {
  const b = row1 - a
  const c = col1 - a
  const d = n - row1 - c
  if (a < 0 || b < 0 || c < 0 || d < 0) return 0
  return Math.exp(
    lfact(row1) + lfact(n - row1) + lfact(col1) + lfact(n - col1) - lfact(n) - lfact(a) - lfact(b) - lfact(c) - lfact(d),
  )
}
