// Small dense linear algebra for regression and reliability (matrices are arrays of rows).

export type Matrix = number[][]

export function zeros(r: number, c: number): Matrix {
  return Array.from({ length: r }, () => new Array<number>(c).fill(0))
}

export function identity(n: number): Matrix {
  const m = zeros(n, n)
  for (let i = 0; i < n; i++) m[i][i] = 1
  return m
}

export function copy(m: Matrix): Matrix {
  return m.map((r) => r.slice())
}

export function transpose(m: Matrix): Matrix {
  if (m.length === 0) return []
  return m[0].map((_, j) => m.map((r) => r[j]))
}

export function mul(a: Matrix, b: Matrix): Matrix {
  const n = a.length
  const k = b.length
  const p = b[0]?.length ?? 0
  const out = zeros(n, p)
  for (let i = 0; i < n; i++)
    for (let l = 0; l < k; l++) {
      const v = a[i][l]
      if (v === 0) continue
      for (let j = 0; j < p; j++) out[i][j] += v * b[l][j]
    }
  return out
}

/**
 * Goodnight's sweep operator, in place, on a symmetric matrix at pivot k.
 * Sweeping a set S of a covariance/correlation matrix yields A_SS^-1 in that block, regression
 * coefficients in the off-diagonal block and residual (co)variances in the remaining block.
 */
export function sweep(a: Matrix, k: number): void {
  const n = a.length
  const d = a[k][k]
  if (d === 0) throw new Error('sweep: zero pivot')
  for (let j = 0; j < n; j++) a[k][j] /= d
  for (let i = 0; i < n; i++) {
    if (i === k) continue
    const b = a[i][k]
    if (b === 0) continue
    for (let j = 0; j < n; j++) a[i][j] -= b * a[k][j]
    a[i][k] = -b / d
  }
  a[k][k] = 1 / d
}

/** Inverse of a symmetric positive-definite matrix via sweeping. Returns null if singular. */
export function invertSymmetric(m: Matrix, tol = 1e-12): Matrix | null {
  const a = copy(m)
  const n = a.length
  for (let k = 0; k < n; k++) {
    if (Math.abs(a[k][k]) < tol * Math.max(1, Math.abs(m[k][k]))) return null
    sweep(a, k)
  }
  return a
}

/** Eigen-decomposition of a symmetric matrix (cyclic Jacobi). Eigenvalues sorted descending. */
export function symmetricEigen(m: Matrix): { values: number[]; vectors: Matrix } {
  const n = m.length
  const a = copy(m)
  const v = identity(n)
  for (let sweepIter = 0; sweepIter < 100; sweepIter++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j]
    if (off < 1e-30) break
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i])
  return {
    values: order.map((i) => a[i][i]),
    vectors: v.map((row) => order.map((i) => row[i])),
  }
}

/** Correlation matrix from column vectors (complete data). */
export function correlationMatrix(cols: number[][]): Matrix {
  const p = cols.length
  const n = cols[0]?.length ?? 0
  const means = cols.map((c) => c.reduce((s, x) => s + x, 0) / n)
  const dev = cols.map((c, j) => c.map((x) => x - means[j]))
  const ss = dev.map((d) => d.reduce((s, x) => s + x * x, 0))
  const r = zeros(p, p)
  for (let i = 0; i < p; i++)
    for (let j = i; j < p; j++) {
      let s = 0
      for (let k = 0; k < n; k++) s += dev[i][k] * dev[j][k]
      const v = i === j ? 1 : s / Math.sqrt(ss[i] * ss[j])
      r[i][j] = v
      r[j][i] = v
    }
  return r
}
