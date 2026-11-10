// SVG chart rendering for output items (bar, line, pie, histogram, scatter, box).
// Visual rules: categorical hues in fixed order, thin marks with 4px rounded data-ends,
// hairline recessive grid, text in ink colors only, legend for 2+ series, per-mark tooltips,
// and a data-table view for every chart.

import { useId, useRef, useState, type ReactNode } from 'react'
import type { BoxSummary, ChartSpec } from '../../core/output'
import { normPdf } from '../../stats/distributions'
import { chartTable, fmtTick, fmtVal, H, INK, niceTicks, SERIES, W } from './chartUtils'

/** Rect with 4px rounded data-end and a square baseline end. */
function barPath(x: number, y0: number, w: number, y1: number, r = 4): string {
  const h = Math.abs(y1 - y0)
  const rr = Math.min(r, w / 2, h)
  if (y1 <= y0) {
    // grows upward: data end at top (y1)
    return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`
  }
  return `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`
}

interface Tip {
  clientX: number
  clientY: number
  value: string
  label: string
  color?: string
}

interface Frame {
  left: number
  right: number
  top: number
  bottom: number
}

function wrapText(text: string, max: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur)
      cur = w
    } else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 2)
}

function Title({ text }: { text: string }) {
  const lines = wrapText(text, 70)
  return (
    <text x={W / 2} y={22} textAnchor="middle" fontSize="14" fontWeight="600" fill={INK.primary}>
      {lines.map((l, i) => (
        <tspan key={i} x={W / 2} dy={i ? 17 : 0}>
          {l}
        </tspan>
      ))}
    </text>
  )
}

function YAxis({ f, ticks, scale, label }: { f: Frame; ticks: number[]; scale: (v: number) => number; label: string }) {
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={f.left} x2={W - f.right} y1={scale(t)} y2={scale(t)} stroke={t === 0 ? INK.axis : INK.grid} strokeWidth={1} />
          <text x={f.left - 8} y={scale(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={INK.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmtTick(t, step)}
          </text>
        </g>
      ))}
      <text
        transform={`translate(16 ${(f.top + H - f.bottom) / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize="12"
        fill={INK.secondary}
      >
        {label.length > 48 ? label.slice(0, 46) + '…' : label}
      </text>
    </g>
  )
}

function XAxisLinear({ f, ticks, scale, label }: { f: Frame; ticks: number[]; scale: (v: number) => number; label: string }) {
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1
  const y = H - f.bottom
  return (
    <g>
      <line x1={f.left} x2={W - f.right} y1={y} y2={y} stroke={INK.axis} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={scale(t)} x2={scale(t)} y1={y} y2={y + 4} stroke={INK.axis} />
          <text x={scale(t)} y={y + 16} textAnchor="middle" fontSize="11" fill={INK.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmtTick(t, step)}
          </text>
        </g>
      ))}
      <text x={(f.left + W - f.right) / 2} y={H - 10} textAnchor="middle" fontSize="12" fill={INK.secondary}>
        {label}
      </text>
    </g>
  )
}

function XAxisBand({ f, cats, label }: { f: Frame; cats: string[]; label: string }) {
  const y = H - f.bottom
  const band = (W - f.left - f.right) / Math.max(1, cats.length)
  const rotate = cats.some((c) => c.length * 6.2 > band - 6)
  return (
    <g>
      <line x1={f.left} x2={W - f.right} y1={y} y2={y} stroke={INK.axis} />
      {cats.map((c, i) => {
        const x = f.left + band * (i + 0.5)
        const text = c.length > 22 ? c.slice(0, 21) + '…' : c
        return rotate ? (
          <text key={i} transform={`translate(${x} ${y + 12}) rotate(-35)`} textAnchor="end" fontSize="11" fill={INK.secondary}>
            {text}
          </text>
        ) : (
          <text key={i} x={x} y={y + 16} textAnchor="middle" fontSize="11" fill={INK.secondary}>
            {text}
          </text>
        )
      })}
      <text x={(f.left + W - f.right) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill={INK.secondary}>
        {label}
      </text>
    </g>
  )
}

function Legend({ items, x, y, kind }: { items: { name: string; color: string; shape?: number }[]; x: number; y: number; kind: 'rect' | 'line' | 'dot' }) {
  return (
    <g>
      {items.map((it, i) => (
        <g key={i} transform={`translate(${x} ${y + i * 18})`}>
          {kind === 'rect' && <rect width="12" height="12" rx="2" fill={it.color} y={-1} />}
          {kind === 'line' && <line x1="0" x2="14" y1="5" y2="5" stroke={it.color} strokeWidth="2" strokeLinecap="round" />}
          {kind === 'dot' && <Marker x={6} y={5} color={it.color} shape={it.shape ?? 0} />}
          <text x={kind === 'line' ? 20 : 18} y={9} fontSize="11.5" fill={INK.secondary}>
            {it.name.length > 20 ? it.name.slice(0, 19) + '…' : it.name}
          </text>
        </g>
      ))}
    </g>
  )
}

function Marker({ x, y, color, shape, r = 4 }: { x: number; y: number; color: string; shape: number; r?: number }) {
  const common = { fill: color, stroke: INK.surface, strokeWidth: 2, paintOrder: 'stroke' as const }
  switch (shape % 4) {
    case 1:
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={1} {...common} />
    case 2:
      return <path d={`M${x},${y - r - 1}L${x + r + 1},${y + r}L${x - r - 1},${y + r}Z`} {...common} />
    case 3:
      return <path d={`M${x},${y - r - 1}L${x + r + 1},${y}L${x},${y + r + 1}L${x - r - 1},${y}Z`} {...common} />
    default:
      return <circle cx={x} cy={y} r={r} {...common} />
  }
}

// ------------------------------------------------------------------------- chart bodies

function BarChart({ c, tip }: { c: Extract<ChartSpec, { type: 'bar' }>; tip: (t: Tip | null) => void }) {
  const multi = c.series.length > 1
  const f: Frame = { left: 64, right: multi ? 150 : 24, top: 52, bottom: 70 }
  const vals = c.series.flatMap((s) => s.values.filter(Number.isFinite))
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals))
  const y0 = ticks[0]
  const y1 = ticks[ticks.length - 1]
  const sy = (v: number) => H - f.bottom - ((v - y0) / (y1 - y0)) * (H - f.top - f.bottom)
  const band = (W - f.left - f.right) / Math.max(1, c.categories.length)
  const k = c.series.length
  const bw = Math.max(3, Math.min(24, (band * 0.72 - (k - 1) * 2) / k))
  const groupW = k * bw + (k - 1) * 2
  const showLabels = !multi && c.categories.length <= 12
  return (
    <>
      <YAxis f={f} ticks={ticks} scale={sy} label={c.yLabel} />
      {c.categories.map((cat, i) =>
        c.series.map((s, j) => {
          const v = s.values[i]
          if (!Number.isFinite(v)) return null
          const x = f.left + band * i + (band - groupW) / 2 + j * (bw + 2)
          const color = SERIES[j % SERIES.length]
          const valText = c.percent ? `${fmtVal(v)}%` : fmtVal(v)
          return (
            <g key={`${i}-${j}`}>
              <path
                d={barPath(x, sy(0), bw, sy(v))}
                fill={color}
                className="mark"
                tabIndex={0}
                onPointerMove={(e) => tip({ clientX: e.clientX, clientY: e.clientY, value: valText, label: multi ? `${cat} · ${s.name}` : cat, color })}
                onPointerLeave={() => tip(null)}
                onFocus={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  tip({ clientX: r.left + r.width / 2, clientY: r.top, value: valText, label: multi ? `${cat} · ${s.name}` : cat, color })
                }}
                onBlur={() => tip(null)}
              />
              {showLabels && (
                <text x={x + bw / 2} y={sy(v) - 6} textAnchor="middle" fontSize="11" fill={INK.secondary}>
                  {valText}
                </text>
              )}
            </g>
          )
        }),
      )}
      <XAxisBand f={f} cats={c.categories} label={c.xLabel} />
      {multi && <Legend items={c.series.map((s, j) => ({ name: s.name, color: SERIES[j % SERIES.length] }))} x={W - f.right + 18} y={f.top + 4} kind="rect" />}
    </>
  )
}

function LineChart({ c, tip }: { c: Extract<ChartSpec, { type: 'line' }>; tip: (t: Tip | null) => void }) {
  const f: Frame = { left: 64, right: 24, top: 52, bottom: 70 }
  const vals = c.values.filter((v): v is number => v !== null && Number.isFinite(v))
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 1
  const ticks = niceTicks(lo - pad, hi + pad)
  const y0 = ticks[0]
  const y1 = ticks[ticks.length - 1]
  const sy = (v: number) => H - f.bottom - ((v - y0) / (y1 - y0)) * (H - f.top - f.bottom)
  const band = (W - f.left - f.right) / Math.max(1, c.categories.length)
  const px = (i: number) => f.left + band * (i + 0.5)
  const pts = c.values.map((v, i) => (v === null ? null : ([px(i), sy(v)] as [number, number])))
  let d = ''
  pts.forEach((p) => {
    if (!p) return
    d += `${d ? 'L' : 'M'}${p[0]},${p[1]}`
  })
  return (
    <>
      <YAxis f={f} ticks={ticks} scale={sy} label={c.yLabel} />
      <path d={d} fill="none" stroke={SERIES[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) =>
        p ? (
          <g
            key={i}
            tabIndex={0}
            className="mark"
            onPointerMove={(e) => tip({ clientX: e.clientX, clientY: e.clientY, value: fmtVal(c.values[i]!), label: c.categories[i], color: SERIES[0] })}
            onPointerLeave={() => tip(null)}
          >
            <circle cx={p[0]} cy={p[1]} r={12} fill="transparent" />
            <Marker x={p[0]} y={p[1]} color={SERIES[0]} shape={0} />
          </g>
        ) : null,
      )}
      <XAxisBand f={f} cats={c.categories} label={c.xLabel} />
    </>
  )
}

function PieChart({ c, tip }: { c: Extract<ChartSpec, { type: 'pie' }>; tip: (t: Tip | null) => void }) {
  // Fold categories beyond 8 into "Other".
  let cats = c.categories
  let vals = c.values
  if (cats.length > 8) {
    cats = [...cats.slice(0, 7), 'Other']
    vals = [...vals.slice(0, 7), vals.slice(7).reduce((s, v) => s + v, 0)]
  }
  const total = vals.reduce((s, v) => s + v, 0)
  const cx = 230
  const cy = 230
  const r = 150
  const starts: number[] = []
  vals.reduce((acc, v) => {
    starts.push(acc)
    return acc + (v / total) * 2 * Math.PI
  }, -Math.PI / 2)
  return (
    <>
      {vals.map((v, i) => {
        if (v <= 0) return null
        const frac = v / total
        const a = starts[i]
        const a2 = a + frac * 2 * Math.PI
        const large = frac > 0.5 ? 1 : 0
        const p1 = [cx + r * Math.cos(a), cy + r * Math.sin(a)]
        const p2 = [cx + r * Math.cos(a2), cy + r * Math.sin(a2)]
        const mid = (a + a2) / 2
        const d =
          frac >= 0.9999
            ? `M${cx - r},${cy}A${r},${r} 0 1 1 ${cx + r},${cy}A${r},${r} 0 1 1 ${cx - r},${cy}Z`
            : `M${cx},${cy}L${p1[0]},${p1[1]}A${r},${r} 0 ${large} 1 ${p2[0]},${p2[1]}Z`
        const color = SERIES[i % SERIES.length]
        const light = color === '#eda100'
        return (
          <g key={i}>
            <path
              d={d}
              fill={color}
              stroke={INK.surface}
              strokeWidth={2}
              tabIndex={0}
              className="mark"
              onPointerMove={(e) =>
                tip({ clientX: e.clientX, clientY: e.clientY, value: `${fmtVal(v)} (${(frac * 100).toFixed(1)}%)`, label: cats[i], color })
              }
              onPointerLeave={() => tip(null)}
            />
            {frac >= 0.06 && (
              <text
                x={cx + r * 0.66 * Math.cos(mid)}
                y={cy + r * 0.66 * Math.sin(mid)}
                textAnchor="middle"
                dy="0.35em"
                fontSize="12"
                fontWeight="600"
                fill={light ? INK.primary : '#ffffff'}
                pointerEvents="none"
              >
                {(frac * 100).toFixed(1)}%
              </text>
            )}
          </g>
        )
      })}
      <text x={410} y={78} fontSize="12" fontWeight="600" fill={INK.secondary}>
        {c.legendTitle ?? ''}
      </text>
      <Legend items={cats.map((n, i) => ({ name: `${n} (${fmtVal(vals[i])})`, color: SERIES[i % SERIES.length] }))} x={410} y={96} kind="rect" />
    </>
  )
}

function Histogram({ c, tip }: { c: Extract<ChartSpec, { type: 'histogram' }>; tip: (t: Tip | null) => void }) {
  const f: Frame = { left: 64, right: 24, top: 52, bottom: 56 }
  const bins = c.bins
  const x0 = bins.length ? bins[0].x0 : 0
  const x1 = bins.length ? bins[bins.length - 1].x1 : 1
  const width = bins.length ? bins[0].x1 - bins[0].x0 : 1
  let maxY = Math.max(1, ...bins.map((b) => b.count))
  if (c.normal && c.normal.sd > 0) maxY = Math.max(maxY, (c.normal.n * width * normPdf(0)) / c.normal.sd)
  const yt = niceTicks(0, maxY)
  const sy = (v: number) => H - f.bottom - (v / yt[yt.length - 1]) * (H - f.top - f.bottom)
  const xt = niceTicks(x0, x1, 6).filter((t) => t >= x0 - 1e-9 && t <= x1 + 1e-9)
  const sx = (v: number) => f.left + ((v - x0) / (x1 - x0 || 1)) * (W - f.left - f.right)
  let curve = ''
  if (c.normal && c.normal.sd > 0) {
    const { mean, sd, n } = c.normal
    for (let i = 0; i <= 120; i++) {
      const x = x0 + ((x1 - x0) * i) / 120
      const y = (n * width * normPdf((x - mean) / sd)) / sd
      curve += `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`
    }
  }
  return (
    <>
      <YAxis f={f} ticks={yt} scale={sy} label="Frequency" />
      {bins.map((b, i) => {
        if (!b.count) return null
        const xa = sx(b.x0) + 1
        const w = Math.max(1, sx(b.x1) - sx(b.x0) - 2)
        return (
          <path
            key={i}
            d={barPath(xa, sy(0), w, sy(b.count))}
            fill={SERIES[0]}
            className="mark"
            tabIndex={0}
            onPointerMove={(e) => tip({ clientX: e.clientX, clientY: e.clientY, value: String(b.count), label: `${fmtVal(b.x0)} – ${fmtVal(b.x1)}`, color: SERIES[0] })}
            onPointerLeave={() => tip(null)}
          />
        )
      })}
      {curve && <path d={curve} fill="none" stroke={INK.primary} strokeWidth={2} strokeLinejoin="round" />}
      <XAxisLinear f={f} ticks={xt} scale={sx} label={c.xLabel} />
      {c.stats && (
        <text x={W - f.right} y={f.top - 8} textAnchor="end" fontSize="11.5" fill={INK.secondary}>
          Mean = {fmtVal(c.stats.mean)}, Std. Dev. = {fmtVal(c.stats.sd)}, N = {c.stats.n}
        </text>
      )}
    </>
  )
}

function Scatter({ c, tip }: { c: Extract<ChartSpec, { type: 'scatter' }>; tip: (t: Tip | null) => void }) {
  const multi = c.groups.length > 1
  const f: Frame = { left: 64, right: multi ? 150 : 24, top: 52, bottom: 56 }
  const all = c.groups.flatMap((g) => g.points)
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const padded = (vals: number[]) => {
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const pad = (hi - lo) * 0.04 || 1
    return [lo >= 0 && lo - pad < 0 ? 0 : lo - pad, hi + pad] as const
  }
  const [x0, x1] = padded(xs)
  const [y0, y1] = padded(ys)
  const xt = c.xDomain ? niceTicks(c.xDomain[0], c.xDomain[1]) : niceTicks(x0, x1, 6)
  const yt = c.yDomain ? niceTicks(c.yDomain[0], c.yDomain[1]) : niceTicks(y0, y1)
  const [xa, xb] = [xt[0], xt[xt.length - 1]]
  const [ya, yb] = [yt[0], yt[yt.length - 1]]
  const sx = (v: number) => f.left + ((v - xa) / (xb - xa || 1)) * (W - f.left - f.right)
  const sy = (v: number) => H - f.bottom - ((v - ya) / (yb - ya || 1)) * (H - f.top - f.bottom)
  const clipId = `clip${useId().replace(/:/g, '')}`
  const many = all.length > 2000
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={f.left} y={f.top} width={W - f.left - f.right} height={H - f.top - f.bottom} />
        </clipPath>
      </defs>
      <YAxis f={f} ticks={yt} scale={sy} label={c.yLabel} />
      <XAxisLinear f={f} ticks={xt} scale={sx} label={c.xLabel} />
      <g clipPath={`url(#${clipId})`}>
        {(c.lines ?? []).map((l, i) => {
          const isRef = !l.label
          return (
            <line
              key={i}
              x1={sx(xa)}
              x2={sx(xb)}
              y1={sy(l.intercept + l.slope * xa)}
              y2={sy(l.intercept + l.slope * xb)}
              stroke={isRef ? INK.muted : INK.primary}
              strokeWidth={isRef ? 1.5 : 2}
            />
          )
        })}
        {c.groups.map((g, gi) =>
          g.points.map((p, i) => (
            <g
              key={`${gi}-${i}`}
              onPointerMove={(e) =>
                tip({
                  clientX: e.clientX,
                  clientY: e.clientY,
                  value: `(${fmtVal(p[0])}, ${fmtVal(p[1])})`,
                  label: multi ? g.name : `${c.xLabel} × ${c.yLabel}`,
                  color: SERIES[gi % SERIES.length],
                })
              }
              onPointerLeave={() => tip(null)}
            >
              {!many && <circle cx={sx(p[0])} cy={sy(p[1])} r={10} fill="transparent" />}
              <Marker x={sx(p[0])} y={sy(p[1])} color={SERIES[gi % SERIES.length]} shape={multi ? gi : 0} r={many ? 2.5 : 4} />
            </g>
          )),
        )}
      </g>
      {(c.lines ?? [])
        .filter((l) => l.label)
        .map((l, i) => (
          <text key={i} x={W - f.right - 4} y={f.top + 14 + i * 16} textAnchor="end" fontSize="11.5" fill={INK.secondary}>
            {l.label}
          </text>
        ))}
      {multi && (
        <Legend items={c.groups.map((g, i) => ({ name: g.name, color: SERIES[i % SERIES.length], shape: i }))} x={W - f.right + 18} y={f.top + 4} kind="dot" />
      )}
    </>
  )
}

function BoxPlot({ c, tip }: { c: Extract<ChartSpec, { type: 'box' }>; tip: (t: Tip | null) => void }) {
  const f: Frame = { left: 64, right: 24, top: 52, bottom: 70 }
  const all = c.boxes.flatMap((b) => [b.whiskerLow, b.whiskerHigh, b.q1, b.q3, ...b.outliers.map((o) => o.value), ...b.extremes.map((o) => o.value)])
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const pad = (hi - lo) * 0.06 || 1
  const yt = niceTicks(lo - pad, hi + pad)
  const [ya, yb] = [yt[0], yt[yt.length - 1]]
  const sy = (v: number) => H - f.bottom - ((v - ya) / (yb - ya || 1)) * (H - f.top - f.bottom)
  const band = (W - f.left - f.right) / Math.max(1, c.boxes.length)
  const bw = Math.min(44, band * 0.45)
  const tipFor = (b: BoxSummary) =>
    `n=${b.n} · median ${fmtVal(b.median)} · IQR ${fmtVal(b.q1)}–${fmtVal(b.q3)} · whiskers ${fmtVal(b.whiskerLow)}–${fmtVal(b.whiskerHigh)}`
  return (
    <>
      <YAxis f={f} ticks={yt} scale={sy} label={c.yLabel} />
      {c.boxes.map((b, i) => {
        const cx = f.left + band * (i + 0.5)
        return (
          <g
            key={i}
            tabIndex={0}
            className="mark"
            onPointerMove={(e) => tip({ clientX: e.clientX, clientY: e.clientY, value: fmtVal(b.median), label: `${b.label}: ${tipFor(b)}`, color: SERIES[0] })}
            onPointerLeave={() => tip(null)}
          >
            <line x1={cx} x2={cx} y1={sy(b.whiskerHigh)} y2={sy(b.q3)} stroke={INK.secondary} strokeWidth={1.5} />
            <line x1={cx} x2={cx} y1={sy(b.q1)} y2={sy(b.whiskerLow)} stroke={INK.secondary} strokeWidth={1.5} />
            <line x1={cx - bw / 4} x2={cx + bw / 4} y1={sy(b.whiskerHigh)} y2={sy(b.whiskerHigh)} stroke={INK.secondary} strokeWidth={1.5} />
            <line x1={cx - bw / 4} x2={cx + bw / 4} y1={sy(b.whiskerLow)} y2={sy(b.whiskerLow)} stroke={INK.secondary} strokeWidth={1.5} />
            <rect x={cx - bw / 2} y={sy(b.q3)} width={bw} height={Math.max(1, sy(b.q1) - sy(b.q3))} rx={3} fill="#cde2fb" stroke={SERIES[0]} strokeWidth={1.5} />
            <line x1={cx - bw / 2} x2={cx + bw / 2} y1={sy(b.median)} y2={sy(b.median)} stroke={INK.primary} strokeWidth={2} />
            {b.outliers.map((o, k) => (
              <g key={`o${k}`}>
                <circle cx={cx} cy={sy(o.value)} r={4} fill={INK.surface} stroke={INK.secondary} strokeWidth={1.5} />
                <text x={cx + 7} y={sy(o.value)} dy="0.32em" fontSize="10" fill={INK.muted}>
                  {o.caseNo}
                </text>
              </g>
            ))}
            {b.extremes.map((o, k) => (
              <g key={`e${k}`}>
                <text x={cx} y={sy(o.value)} dy="0.42em" textAnchor="middle" fontSize="15" fontWeight="700" fill={INK.secondary}>
                  *
                </text>
                <text x={cx + 7} y={sy(o.value)} dy="0.32em" fontSize="10" fill={INK.muted}>
                  {o.caseNo}
                </text>
              </g>
            ))}
          </g>
        )
      })}
      <XAxisBand f={f} cats={c.boxes.map((b) => b.label)} label={c.xLabel ?? ''} />
    </>
  )
}

export function ChartView({ chart, showTable }: { chart: ChartSpec; showTable: boolean }) {
  const [tip, setTipState] = useState<(Tip & { left: number; top: number }) | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  // Convert client coordinates to positions inside the chart box when the event happens.
  const setTip = (t: Tip | null) => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (!t || !rect) return setTipState(null)
    setTipState({
      ...t,
      left: Math.max(0, Math.min(t.clientX - rect.left + 12, rect.width - 200)),
      top: Math.max(0, t.clientY - rect.top - 52),
    })
  }
  let body: ReactNode
  switch (chart.type) {
    case 'bar':
      body = <BarChart c={chart} tip={setTip} />
      break
    case 'line':
      body = <LineChart c={chart} tip={setTip} />
      break
    case 'pie':
      body = <PieChart c={chart} tip={setTip} />
      break
    case 'histogram':
      body = <Histogram c={chart} tip={setTip} />
      break
    case 'scatter':
      body = <Scatter c={chart} tip={setTip} />
      break
    case 'box':
      body = <BoxPlot c={chart} tip={setTip} />
      break
  }
  const table = showTable ? chartTable(chart) : null
  return (
    <div className="chart-box" ref={boxRef} style={{ position: 'relative', width: W, maxWidth: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={chart.title}
        style={{ fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}
      >
        <rect width={W} height={H} fill={INK.surface} />
        <Title text={chart.title} />
        {body}
      </svg>
      {tip && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: tip.left,
            top: tip.top,
            background: '#fff',
            border: '1px solid rgba(11,11,11,0.12)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            borderRadius: 6,
            padding: '6px 9px',
            pointerEvents: 'none',
            fontSize: 12,
            maxWidth: 320,
            zIndex: 3,
          }}
        >
          <div style={{ fontWeight: 700, color: INK.primary }}>{tip.value}</div>
          <div style={{ color: INK.secondary, display: 'flex', alignItems: 'center', gap: 6 }}>
            {tip.color && <span style={{ width: 12, height: 2, background: tip.color, display: 'inline-block', flex: 'none' }} />}
            <span>{tip.label}</span>
          </div>
        </div>
      )}
      {table && (
        <div style={{ borderTop: '1px solid #e3e7ed', padding: 8, maxHeight: 260, overflow: 'auto' }}>
          <table className="chart-data" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {table.head.map((h, i) => (
                  <th key={i} style={{ textAlign: i ? 'right' : 'left', padding: '2px 8px', borderBottom: '1px solid #dadfe6', color: INK.secondary, fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j} style={{ textAlign: j ? 'right' : 'left', padding: '2px 8px', fontVariantNumeric: 'tabular-nums' }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {table.note && <div className="muted small">{table.note}</div>}
        </div>
      )}
    </div>
  )
}

