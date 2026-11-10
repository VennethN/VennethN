import { isMissing, type Dataset, type Variable } from '../core/dataset'
import { fmtCount, fmtNum, fmtPct, fmtSig, statDecimals } from '../core/format'
import { out, type BoxSummary, type OutputItem, type RowNode } from '../core/output'
import { percentileHaverage, rank, sortedCopy, summarize, trimmedMean, tukeyHinges } from '../stats/basic'
import { tInv } from '../stats/distributions'
import { blomScore, lilliefors, shapiroWilk } from '../stats/normality'
import {
  analysisCases,
  catKey,
  catLabel,
  categoriesOf,
  histogramBins,
  Notes,
  requireNumeric,
  resolveVars,
  vlabel,
} from './common'
import type { ExploreSpec } from './types'

interface Cell {
  dep: Variable
  factor: Variable | null
  level: number | string | null
  levelLabel: string
  values: number[]
  caseNos: number[]
  missing: number
  total: number
}

/** Box-plot summary using Tukey's hinges and 1.5/3 box-length fences like SPSS. */
export function boxSummary(label: string, values: number[], caseNos: number[]): BoxSummary {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b])
  const sorted = idx.map((i) => values[i])
  const [q1, med, q3] = tukeyHinges(sorted)
  const iqr = q3 - q1
  const outliers: BoxSummary['outliers'] = []
  const extremes: BoxSummary['extremes'] = []
  let lowW = Infinity
  let highW = -Infinity
  idx.forEach((i) => {
    const x = values[i]
    if (x > q3 + 3 * iqr || x < q1 - 3 * iqr) extremes.push({ value: x, caseNo: caseNos[i] })
    else if (x > q3 + 1.5 * iqr || x < q1 - 1.5 * iqr) outliers.push({ value: x, caseNo: caseNos[i] })
    else {
      lowW = Math.min(lowW, x)
      highW = Math.max(highW, x)
    }
  })
  if (!Number.isFinite(lowW)) {
    lowW = q1
    highW = q3
  }
  return { label, n: values.length, q1, median: med, q3, whiskerLow: lowW, whiskerHigh: highW, outliers, extremes }
}

/** Text stem-and-leaf display in the classic SPSS layout. */
export function stemAndLeaf(title: string, values: number[]): string {
  const s = sortedCopy(values)
  const n = s.length
  if (!n) return `${title} Stem-and-Leaf Plot\n\n(no valid cases)`
  const [q1, , q3] = tukeyHinges(s)
  const iqr = q3 - q1
  const loFence = q1 - 1.5 * iqr
  const hiFence = q3 + 1.5 * iqr
  const low = s.filter((x) => x < loFence)
  const high = s.filter((x) => x > hiFence)
  const mid = s.filter((x) => x >= loFence && x <= hiFence)
  const lo = mid[0]
  const hi = mid[mid.length - 1]
  const span = Math.max(hi - lo, Math.abs(hi) * 1e-9, 1e-9)
  // Choose leaf unit u (power of ten) and lines per stem m in {1, 2, 5} to give a sensible number of lines.
  const target = Math.min(20, Math.max(5, Math.round(10 * Math.log10(Math.max(n, 2)))))
  let best = { u: 1, m: 1, score: Infinity }
  const baseExp = Math.floor(Math.log10(span)) - 1
  for (let e = baseExp - 1; e <= baseExp + 1; e++) {
    const u = Math.pow(10, e)
    for (const m of [1, 2, 5]) {
      const sw = 10 * u
      const lines = (Math.floor(hi / sw) - Math.floor(lo / sw) + 1) * m
      const score = Math.abs(lines - target) + (lines < 4 ? 50 : 0) + (lines > 30 ? 50 : 0)
      if (score < best.score) best = { u, m, score }
    }
  }
  const { u, m } = best
  const sw = 10 * u
  const per = 10 / m
  // Group leaves by line key.
  const lines = new Map<string, { neg: boolean; stem: number; sub: number; leaves: number[] }>()
  for (const x of mid) {
    const neg = x < 0
    const ax = Math.abs(x)
    const stem = Math.floor(ax / sw + 1e-9)
    const leaf = Math.min(9, Math.floor((ax - stem * sw) / u + 1e-9))
    const sub = Math.floor(leaf / per)
    const key = `${neg ? '-' : '+'}${stem}:${sub}`
    const l = lines.get(key) ?? { neg, stem, sub, leaves: [] }
    l.leaves.push(leaf)
    lines.set(key, l)
  }
  // Fill in empty lines between min and max.
  const order = (l: { neg: boolean; stem: number; sub: number }) => (l.neg ? -(l.stem * m + l.sub) - 0.5 : l.stem * m + l.sub)
  const all = [...lines.values()]
  const first = all.reduce((a, b) => (order(a) < order(b) ? a : b))
  const last = all.reduce((a, b) => (order(a) > order(b) ? a : b))
  const seq: { neg: boolean; stem: number; sub: number }[] = []
  if (first.neg) {
    for (let k = first.stem * m + first.sub; k >= 0; k--) seq.push({ neg: true, stem: Math.floor(k / m), sub: k % m })
  }
  if (!last.neg) {
    const start = first.neg ? 0 : first.stem * m + first.sub
    for (let k = start; k <= last.stem * m + last.sub; k++) seq.push({ neg: false, stem: Math.floor(k / m), sub: k % m })
  }
  const maxCount = Math.max(...all.map((l) => l.leaves.length))
  const perLeaf = maxCount > 60 ? Math.ceil(maxCount / 60) : 1
  const fmtFreq = (c: number) => c.toFixed(2).padStart(10)
  const outLines: string[] = [`${title} Stem-and-Leaf Plot`, '', ' Frequency    Stem &  Leaf', '']
  if (low.length) outLines.push(`${fmtFreq(low.length)} Extremes    (=<${fmtNum(low[low.length - 1], 1)})`)
  for (const l of seq) {
    const rec = lines.get(`${l.neg ? '-' : '+'}${l.stem}:${l.sub}`)
    const leaves = rec ? rec.leaves.slice().sort((a, b) => (l.neg ? b - a : a - b)) : []
    let leafStr = ''
    for (let k = 0; k < leaves.length; k += perLeaf) leafStr += k + perLeaf <= leaves.length ? String(leaves[k]) : '&'
    const stemStr = `${l.neg ? '-' : ''}${l.stem}`
    outLines.push(`${fmtFreq(leaves.length)} ${stemStr.padStart(8)} .  ${leafStr}`)
  }
  if (high.length) outLines.push(`${fmtFreq(high.length)} Extremes    (>=${fmtNum(high[0], 1)})`)
  outLines.push('', ` Stem width: ${String(sw).padStart(10)}`, ` Each leaf: ${String(perLeaf).padStart(10)} case(s)`)
  if (perLeaf > 1) outLines.push('', ' & denotes fractional leaves.')
  return outLines.join('\n')
}

export function runExplore(ds: Dataset, spec: ExploreSpec): OutputItem[] {
  const deps = resolveVars(ds, spec.dependents)
  deps.forEach((v) => requireNumeric(v, 'EXAMINE'))
  const factors = resolveVars(ds, spec.factors)
  let cases = analysisCases(ds)
  if (spec.missing === 'listwise') cases = cases.filter((i) => [...deps, ...factors].every((v) => !isMissing(v, ds.data[v.id][i])))
  const items: OutputItem[] = [out.title('Explore')]

  const analyses: { factor: Variable | null }[] = []
  if (!factors.length || !spec.noTotal) analyses.push({ factor: null })
  for (const f of factors) analyses.push({ factor: f })

  const showStats = spec.display !== 'plots'
  const showPlots = spec.display !== 'statistics'

  for (const { factor } of analyses) {
    const cells: Cell[] = []
    for (const dep of deps) {
      const levels: (number | string | null)[] = factor ? categoriesOf(ds, factor, cases) : [null]
      for (const level of levels) {
        const values: number[] = []
        const caseNos: number[] = []
        let missing = 0
        let total = 0
        const key = factor && level !== null ? catKey(factor, level) : null
        for (const i of cases) {
          if (factor) {
            const fx = ds.data[factor.id][i]
            if (isMissing(factor, fx)) continue
            const fv = factor.type === 'string' ? String(fx).trimEnd() : (fx as number)
            if (catKey(factor, fv) !== key) continue
          }
          total++
          const x = ds.data[dep.id][i]
          if (isMissing(dep, x)) missing++
          else {
            values.push(x as number)
            caseNos.push(i + 1)
          }
        }
        cells.push({
          dep,
          factor,
          level,
          levelLabel: factor && level !== null ? catLabel(factor, level) : '',
          values,
          caseNos,
          missing,
          total,
        })
      }
    }
    if (factor) items.push(out.title(`${vlabel(factor)}`))

    // Case Processing Summary
    const cpsRow = (c: Cell) => [
      fmtCount(c.values.length),
      fmtPct(c.total ? (100 * c.values.length) / c.total : 0) + '%',
      fmtCount(c.missing),
      fmtPct(c.total ? (100 * c.missing) / c.total : 0) + '%',
      fmtCount(c.total),
      '100.0%',
    ]
    const groupRows = (fn: (c: Cell) => RowNode['cells'] | RowNode[]): RowNode[] =>
      deps.map((dep) => {
        const mine = cells.filter((c) => c.dep === dep)
        if (!factor) return { label: vlabel(dep), cells: fn(mine[0]) as RowNode['cells'] }
        return { label: vlabel(dep), children: mine.map((c) => ({ label: c.levelLabel, cells: fn(c) as RowNode['cells'] })) }
      })
    items.push(
      out.table({
        title: 'Case Processing Summary',
        columns: [
          {
            label: 'Cases',
            children: [
              { label: 'Valid', children: [{ label: 'N' }, { label: 'Percent' }] },
              { label: 'Missing', children: [{ label: 'N' }, { label: 'Percent' }] },
              { label: 'Total', children: [{ label: 'N' }, { label: 'Percent' }] },
            ],
          },
        ],
        rows: groupRows(cpsRow),
        corner: factor ? ['', vlabel(factor)] : undefined,
      }),
    )

    if (showStats && spec.descriptives) {
      const conf = spec.ci
      const descRows = (c: Cell): RowNode[] => {
        const s = summarize(c.values)
        const sorted = sortedCopy(c.values)
        const d = statDecimals(c.dep)
        const tcrit = s.n > 1 ? tInv(1 - (1 - conf / 100) / 2, s.n - 1) : NaN
        const iqr = percentileHaverage(sorted, 0.75) - percentileHaverage(sorted, 0.25)
        return [
          { label: 'Mean', cells: [fmtNum(s.mean, d), fmtNum(s.se, statDecimals(c.dep, 3))] },
          {
            label: `${conf}% Confidence Interval for Mean`,
            children: [
              { label: 'Lower Bound', cells: [fmtNum(s.mean - tcrit * s.se, d), ''] },
              { label: 'Upper Bound', cells: [fmtNum(s.mean + tcrit * s.se, d), ''] },
            ],
          },
          { label: '5% Trimmed Mean', cells: [fmtNum(trimmedMean(sorted, 0.05), d), ''] },
          { label: 'Median', cells: [fmtNum(s.median, d), ''] },
          { label: 'Variance', cells: [fmtNum(s.variance, statDecimals(c.dep, 3)), ''] },
          { label: 'Std. Deviation', cells: [fmtNum(s.sd, statDecimals(c.dep, 3)), ''] },
          { label: 'Minimum', cells: [fmtNum(s.min, c.dep.decimals), ''] },
          { label: 'Maximum', cells: [fmtNum(s.max, c.dep.decimals), ''] },
          { label: 'Range', cells: [fmtNum(s.range, c.dep.decimals), ''] },
          { label: 'Interquartile Range', cells: [fmtNum(iqr, d), ''] },
          { label: 'Skewness', cells: [fmtNum(s.skew, 3), fmtNum(s.seSkew, 3)] },
          { label: 'Kurtosis', cells: [fmtNum(s.kurt, 3), fmtNum(s.seKurt, 3)] },
        ]
      }
      items.push(
        out.table({
          title: 'Descriptives',
          columns: [{ label: 'Statistic' }, { label: 'Std. Error' }],
          rows: deps.map((dep) => {
            const mine = cells.filter((c) => c.dep === dep)
            if (!factor) return { label: vlabel(dep), children: descRows(mine[0]) }
            return { label: vlabel(dep), children: mine.map((c) => ({ label: c.levelLabel, children: descRows(c) })) }
          }),
        }),
      )
    }

    if (showStats && spec.percentiles) {
      const ps = [5, 10, 25, 50, 75, 90, 95]
      const pRows = (c: Cell): RowNode[] => {
        const sorted = sortedCopy(c.values)
        const d = statDecimals(c.dep)
        const [h1, h2, h3] = tukeyHinges(sorted)
        return [
          { label: 'Weighted Average(Definition 1)', cells: ps.map((p) => fmtNum(percentileHaverage(sorted, p / 100), d)) },
          {
            label: "Tukey's Hinges",
            cells: ps.map((p) => (p === 25 ? fmtNum(h1, d) : p === 50 ? fmtNum(h2, d) : p === 75 ? fmtNum(h3, d) : '')),
          },
        ]
      }
      items.push(
        out.table({
          title: 'Percentiles',
          columns: [{ label: 'Percentiles', children: ps.map((p) => ({ label: String(p) })) }],
          rows: deps.map((dep) => {
            const mine = cells.filter((c) => c.dep === dep)
            if (!factor) return { label: vlabel(dep), children: pRows(mine[0]) }
            return { label: vlabel(dep), children: mine.map((c) => ({ label: c.levelLabel, children: pRows(c) })) }
          }),
        }),
      )
    }

    if (showStats && spec.outliers) {
      const exRows = (c: Cell): RowNode[] => {
        const idx = c.values.map((_, i) => i).sort((a, b) => c.values[b] - c.values[a] || c.caseNos[a] - c.caseNos[b])
        const k = Math.min(5, idx.length)
        const hi = idx.slice(0, k)
        const lo = idx
          .slice()
          .sort((a, b) => c.values[a] - c.values[b] || c.caseNos[a] - c.caseNos[b])
          .slice(0, k)
        const d = c.dep.decimals
        return [
          { label: 'Highest', children: hi.map((i, r) => ({ label: String(r + 1), cells: [String(c.caseNos[i]), fmtNum(c.values[i], d)] })) },
          { label: 'Lowest', children: lo.map((i, r) => ({ label: String(r + 1), cells: [String(c.caseNos[i]), fmtNum(c.values[i], d)] })) },
        ]
      }
      items.push(
        out.table({
          title: 'Extreme Values',
          columns: [{ label: 'Case Number' }, { label: 'Value' }],
          rows: deps.map((dep) => {
            const mine = cells.filter((c) => c.dep === dep)
            if (!factor) return { label: vlabel(dep), children: exRows(mine[0]) }
            return { label: vlabel(dep), children: mine.map((c) => ({ label: c.levelLabel, children: exRows(c) })) }
          }),
        }),
      )
    }

    if (spec.normality && spec.display !== 'statistics') {
      const notes = new Notes()
      const nRows = (c: Cell) => {
        const ks = c.values.length >= 3 ? lilliefors(c.values) : null
        const sw = c.values.length >= 3 && c.values.length <= 5000 ? shapiroWilk(c.values) : null
        const ksSig = ks
          ? ks.lowerBound
            ? { text: fmtSig(ks.p), sup: notes.symbol('*', 'This is a lower bound of the true significance.') }
            : fmtSig(ks.p)
          : '.'
        return [
          ks ? fmtNum(ks.d, 3) : '.',
          fmtCount(c.values.length),
          ksSig,
          sw ? fmtNum(sw.w, 3) : '.',
          fmtCount(c.values.length),
          sw ? fmtSig(sw.p) : '.',
        ]
      }
      const ksMark = notes.mark('Lilliefors Significance Correction')
      const rows = groupRows(nRows as never)
      items.push(
        out.table({
          title: 'Tests of Normality',
          columns: [
            { label: 'Kolmogorov-Smirnov', sup: ksMark, children: [{ label: 'Statistic' }, { label: 'df' }, { label: 'Sig.' }] },
            { label: 'Shapiro-Wilk', children: [{ label: 'Statistic' }, { label: 'df' }, { label: 'Sig.' }] },
          ],
          rows,
          corner: factor ? ['', vlabel(factor)] : undefined,
          footnotes: notes.footnotes,
        }),
      )
    }

    if (showPlots) {
      for (const c of cells) {
        const suffix = factor ? ` for ${factor.name}= ${c.levelLabel}` : ''
        if (!c.values.length) continue
        if (spec.histogram) {
          const s = summarize(c.values)
          items.push(
            out.chart({
              type: 'histogram',
              title: `Histogram of ${vlabel(c.dep)}${suffix}`,
              xLabel: vlabel(c.dep),
              bins: histogramBins(c.values),
              stats: { mean: s.mean, sd: s.sd, n: s.n },
            }),
          )
        }
        if (spec.stemleaf) {
          items.push(out.text(stemAndLeaf(`${vlabel(c.dep)}${suffix}`, c.values), 'note', `${vlabel(c.dep)} Stem-and-Leaf Plot${suffix}`, true))
        }
        if (spec.normality && c.values.length >= 3) {
          const s = summarize(c.values)
          const { ranks } = rank(c.values)
          const n = c.values.length
          const pts: [number, number][] = c.values.map((x, i) => [x, blomScore(ranks[i], n)])
          items.push(
            out.chart({
              type: 'scatter',
              title: `Normal Q-Q Plot of ${vlabel(c.dep)}${suffix}`,
              xLabel: 'Observed Value',
              yLabel: 'Expected Normal',
              groups: [{ name: vlabel(c.dep), points: pts }],
              lines: s.sd > 0 ? [{ slope: 1 / s.sd, intercept: -s.mean / s.sd }] : [],
            }),
          )
          const detr: [number, number][] = c.values.map((x, i) => [x, (x - s.mean) / s.sd - blomScore(ranks[i], n)])
          items.push(
            out.chart({
              type: 'scatter',
              title: `Detrended Normal Q-Q Plot of ${vlabel(c.dep)}${suffix}`,
              xLabel: 'Observed Value',
              yLabel: 'Dev from Normal',
              groups: [{ name: vlabel(c.dep), points: detr }],
              lines: [{ slope: 0, intercept: 0 }],
            }),
          )
        }
      }
      if (spec.boxplot !== 'none') {
        if (spec.boxplot === 'factor' || deps.length === 1) {
          for (const dep of deps) {
            const mine = cells.filter((c) => c.dep === dep && c.values.length)
            if (!mine.length) continue
            items.push(
              out.chart({
                type: 'box',
                title: `Boxplot of ${vlabel(dep)}${factor ? ` by ${vlabel(factor)}` : ''}`,
                xLabel: factor ? vlabel(factor) : undefined,
                yLabel: vlabel(dep),
                boxes: mine.map((c) => boxSummary(factor ? c.levelLabel : vlabel(dep), c.values, c.caseNos)),
              }),
            )
          }
        } else {
          const levels = factor ? [...new Set(cells.map((c) => c.levelLabel))] : ['']
          for (const lv of levels) {
            const mine = cells.filter((c) => c.levelLabel === lv && c.values.length)
            if (!mine.length) continue
            items.push(
              out.chart({
                type: 'box',
                title: `Boxplot${factor ? ` for ${factor.name}= ${lv}` : ''}`,
                yLabel: '',
                boxes: mine.map((c) => boxSummary(vlabel(c.dep), c.values, c.caseNos)),
              }),
            )
          }
        }
      }
    }
  }
  return items
}
