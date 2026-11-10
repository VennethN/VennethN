// Chart helpers shared by the renderer and exporters (palette, ticks, number formatting, data tables).

import type { ChartSpec } from '../../core/output'

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
export const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#ffffff' }
export const W = 620
export const H = 420

function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  if (lo === hi) {
    const d = Math.abs(lo) * 0.1 || 1
    lo -= d
    hi += d
  }
  const step = niceStep((hi - lo) / count)
  const start = Math.floor(lo / step + 1e-9) * step
  const end = Math.ceil(hi / step - 1e-9) * step
  const out: number[] = []
  for (let v = start; v <= end + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

export function fmtTick(v: number, step: number): string {
  const abs = Math.abs(v)
  if (abs >= 10000) {
    if (abs >= 1e9) return `${+(v / 1e9).toFixed(2)}B`
    if (abs >= 1e6) return `${+(v / 1e6).toFixed(2)}M`
    return `${+(v / 1e3).toFixed(1)}K`
  }
  const dec = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step) - 1e-9))
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).replace('-', '\u2212')
}

export function fmtVal(v: number): string {
  if (!Number.isFinite(v)) return '.'
  if (Number.isInteger(v)) return v.toLocaleString('en-US')
  const a = Math.abs(v)
  return v.toLocaleString('en-US', { maximumFractionDigits: a >= 100 ? 1 : a >= 1 ? 2 : 3 })
}

// ------------------------------------------------------------------------- data table view

export function chartTable(c: ChartSpec): { head: string[]; rows: string[][]; note?: string } {
  switch (c.type) {
    case 'bar':
      return { head: [c.xLabel || 'Category', ...c.series.map((s) => (c.series.length > 1 ? s.name : c.yLabel))], rows: c.categories.map((cat, i) => [cat, ...c.series.map((s) => fmtVal(s.values[i]))]) }
    case 'line':
      return { head: [c.xLabel, c.yLabel], rows: c.categories.map((cat, i) => [cat, c.values[i] === null ? '.' : fmtVal(c.values[i]!)]) }
    case 'pie': {
      const tot = c.values.reduce((s, v) => s + v, 0)
      return { head: ['Category', 'Count', 'Percent'], rows: c.categories.map((cat, i) => [cat, fmtVal(c.values[i]), `${((100 * c.values[i]) / tot).toFixed(1)}%`]) }
    }
    case 'histogram':
      return { head: ['Lower', 'Upper', 'Frequency'], rows: c.bins.map((b) => [fmtVal(b.x0), fmtVal(b.x1), String(b.count)]) }
    case 'scatter': {
      const rows = c.groups.flatMap((g) => g.points.map((p) => [g.name, fmtVal(p[0]), fmtVal(p[1])]))
      return { head: ['Group', c.xLabel, c.yLabel], rows: rows.slice(0, 500), note: rows.length > 500 ? `Showing 500 of ${rows.length} points.` : undefined }
    }
    case 'box':
      return {
        head: ['Group', 'N', 'Lower whisker', 'Q1', 'Median', 'Q3', 'Upper whisker', 'Outliers (case)'],
        rows: c.boxes.map((b) => [
          b.label,
          String(b.n),
          fmtVal(b.whiskerLow),
          fmtVal(b.q1),
          fmtVal(b.median),
          fmtVal(b.q3),
          fmtVal(b.whiskerHigh),
          [...b.outliers, ...b.extremes].map((o) => `${fmtVal(o.value)} (${o.caseNo})`).join(', '),
        ]),
      }
  }
}

/** Standalone SVG markup for export. */
export function chartToSVGString(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(clone)
}
