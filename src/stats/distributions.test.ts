import { describe, expect, it } from 'vitest'
import ref from './__fixtures__/dist_ref.json'
import {
  chi2Inv,
  chi2Sf,
  fInv,
  fSf,
  gammaP,
  ibeta,
  lgamma,
  normCdf,
  normInv,
  ptukey,
  qtukey,
  tCdf,
  tInv,
  tSf2,
} from './distributions'

/** Relative closeness with an absolute floor. */
function close(actual: number, expected: number, rel = 1e-9, abs = 1e-300) {
  const tol = Math.max(abs, rel * Math.abs(expected))
  expect(Math.abs(actual - expected), `actual ${actual} expected ${expected}`).toBeLessThanOrEqual(tol)
}

describe('special functions', () => {
  it('lgamma', () => ref.lgamma.forEach(([x, v]) => close(lgamma(x), v, 1e-12, 1e-13)))
  it('regularized incomplete gamma', () => ref.gammaP.forEach(([a, x, v]) => close(gammaP(a, x), v, 1e-11, 1e-14)))
  it('regularized incomplete beta', () => ref.ibeta.forEach(([x, a, b, v]) => close(ibeta(x, a, b), v, 1e-11, 1e-14)))
})

describe('normal distribution', () => {
  it('cdf', () => ref.normCdf.forEach(([z, v]) => close(normCdf(z), v, 1e-10)))
  it('quantile', () => ref.normInv.forEach(([p, v]) => close(normInv(p), v, 1e-12, 1e-14)))
})

describe('t distribution', () => {
  it('cdf', () => ref.tCdf.forEach(([t, df, v]) => close(tCdf(t, df), v, 1e-10)))
  it('two-sided p', () => ref.tSf2.forEach(([t, df, v]) => close(tSf2(t, df), v, 1e-10)))
  it('quantile', () => ref.tInv.forEach(([p, df, v]) => close(tInv(p, df), v, 1e-9)))
})

describe('F and chi-square', () => {
  it('F upper tail', () => ref.fSf.forEach(([f, a, b, v]) => close(fSf(f, a, b), v, 1e-10)))
  it('F quantile', () => ref.fInv.forEach(([p, a, b, v]) => close(fInv(p, a, b), v, 1e-9)))
  it('chi-square upper tail', () => ref.chi2Sf.forEach(([x, k, v]) => close(chi2Sf(x, k), v, 1e-10)))
  it('chi-square quantile', () => ref.chi2Inv.forEach(([p, k, v]) => close(chi2Inv(p, k), v, 1e-9)))
})

describe('studentized range', () => {
  it('cdf', () => ref.ptukey.forEach(([q, k, df, v]) => close(ptukey(q, k, df), v, 1e-6, 1e-7)))
  it('quantile', () => ref.qtukey.forEach(([p, k, df, v]) => close(qtukey(p, k, df), v, 1e-6)))
})
