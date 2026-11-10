// Number formatting that mimics SPSS pivot-table conventions (".123", "<.001", "12.5").

import type { CellValue, Variable } from './dataset'

export interface FormatOptions {
  /** SPSS omits the leading zero for values between -1 and 1 by default (".45"). */
  leadingZero: boolean
}

export const formatOptions: FormatOptions = { leadingZero: false }

export function setFormatOptions(patch: Partial<FormatOptions>): void {
  Object.assign(formatOptions, patch)
}

function stripLeadingZero(s: string): string {
  if (formatOptions.leadingZero) return s
  if (s.startsWith('0.')) return s.slice(1)
  if (s.startsWith('-0.')) return '-' + s.slice(2)
  return s
}

/** Fixed-point formatting with SPSS-like handling of tiny/huge values. */
export function fmtNum(x: number | null | undefined, decimals = 3): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '.'
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '-∞'
  const d = Math.max(0, Math.min(16, Math.round(decimals)))
  const ax = Math.abs(x)
  if (ax !== 0 && (ax >= 1e15 || (ax < 0.5 * Math.pow(10, -d) && d > 0))) return fmtSci(x)
  let s = x.toFixed(d)
  // Avoid "-0.000"
  if (/^-0\.?0*$/.test(s)) s = s.slice(1)
  return stripLeadingZero(s)
}

export function fmtSci(x: number, digits = 3): string {
  const s = x.toExponential(digits - 1) // e.g. 1.23e-5
  const [mant, exp] = s.split('e')
  const e = Number(exp)
  return `${stripLeadingZero(mant)}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(1, '0')}`
}

/** Significance values: three decimals, "<.001" for very small values. */
export function fmtSig(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return '.'
  if (p < 0.0005) return formatOptions.leadingZero ? '<0.001' : '<.001'
  return fmtNum(Math.min(1, p), 3)
}

/** Counts: integers when integral, otherwise two decimals (weighted data). */
export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '.'
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n))
  return fmtNum(n, 2)
}

export function fmtPct(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return '.'
  return fmtNum(p, 1)
}

export function fmtInt(n: number): string {
  return String(Math.round(n))
}

/** Degrees of freedom: integers as-is, fractional (Welch) with three decimals. */
export function fmtDf(df: number): string {
  if (Math.abs(df - Math.round(df)) < 1e-9) return String(Math.round(df))
  return fmtNum(df, 3)
}

/** Decimals for statistics of a variable: SPSS shows means with the variable's decimals + 2. */
export function statDecimals(v: Variable | undefined, extra = 2): number {
  const base = v && v.type === 'numeric' ? v.decimals : 2
  return Math.min(16, base + extra)
}

/** Format a cell value for display with the variable's print format. */
export function formatCell(v: Variable, value: CellValue, showValueLabels = false): string {
  if (v.type === 'string') {
    const s = value === null ? '' : String(value)
    if (showValueLabels) {
      const l = v.valueLabels.find((x) => String(x.value).trimEnd() === s.trimEnd())
      if (l) return l.label
    }
    return s
  }
  if (value === null || typeof value !== 'number' || Number.isNaN(value)) return showValueLabels ? '' : '.'
  if (showValueLabels) {
    const l = v.valueLabels.find((x) => Number(x.value) === value)
    if (l) return l.label
  }
  return formatValue(v, value)
}

/** Format a numeric value with the variable's decimals (no value labels). */
export function formatValue(v: Variable, value: number | string): string {
  if (typeof value === 'string') return value
  const s = value.toFixed(Math.max(0, Math.min(16, v.decimals)))
  if (/^-0\.?0*$/.test(s)) return s.slice(1)
  return stripLeadingZero(s)
}

/** Label for a category value in output: the value label if defined, else the formatted value. */
export function categoryLabel(v: Variable, value: number | string): string {
  if (v.type === 'string') {
    const s = String(value)
    const l = v.valueLabels.find((x) => String(x.value).trimEnd() === s.trimEnd())
    return l ? l.label : s
  }
  const l = v.valueLabels.find((x) => Number(x.value) === value)
  return l ? l.label : formatValue(v, value as number)
}

/** Format a number for syntax / CSV output (full precision, no locale). */
export function plainNumber(x: number): string {
  if (Number.isInteger(x)) return String(x)
  const s = String(x)
  return s
}
