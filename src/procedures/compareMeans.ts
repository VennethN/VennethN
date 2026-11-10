import { isMissing, type Dataset, type Variable } from '../core/dataset'
import { fmtCount, fmtDf, fmtNum, fmtPct, fmtSig, statDecimals } from '../core/format'
import { out, type ColumnNode, type OutputItem, type RowNode } from '../core/output'
import { mean, median, sortedCopy, summarize } from '../stats/basic'
import { tInv } from '../stats/distributions'
import {
  brownForsythe,
  independentT,
  levene,
  oneSampleT,
  onewayAnova,
  pairedT,
  postHoc,
  welchAnova,
} from '../stats/tests'
import {
  analysisCases,
  catKey,
  catLabel,
  categoriesOf,
  listwiseCases,
  matchesGroup,
  Notes,
  ProcError,
  requireNumeric,
  resolveVar,
  resolveVars,
  validNumbers,
  vlabel,
} from './common'
import type { IndependentTSpec, MeansSpec, OnewaySpec, OneSampleTSpec, PairedTSpec, PostHoc } from './types'

const SIG_COLS: ColumnNode = { label: 'Significance', children: [{ label: 'One-Sided p' }, { label: 'Two-Sided p' }] }

function ciCols(conf: number, label = 'Confidence Interval of the Difference'): ColumnNode {
  return { label: `${fmtNum(conf, 0)}% ${label}`, children: [{ label: 'Lower' }, { label: 'Upper' }] }
}

// ------------------------------------------------------------------------- MEANS

const MEANS_LABEL: Record<string, string> = {
  mean: 'Mean',
  count: 'N',
  stddev: 'Std. Deviation',
  sum: 'Sum',
  min: 'Minimum',
  max: 'Maximum',
  median: 'Median',
  semean: 'Std. Error of Mean',
  variance: 'Variance',
  range: 'Range',
}

export function runMeans(ds: Dataset, spec: MeansSpec): OutputItem[] {
  const deps = resolveVars(ds, spec.dependents)
  deps.forEach((v) => requireNumeric(v, 'MEANS'))
  const indeps = resolveVars(ds, spec.independents)
  const cases = analysisCases(ds)
  const items: OutputItem[] = [out.title('Means')]
  const pairs: [Variable, Variable | null][] = []
  for (const d of deps) {
    if (!indeps.length) pairs.push([d, null])
    for (const f of indeps) pairs.push([d, f])
  }
  items.push(
    out.table({
      title: 'Case Processing Summary',
      columns: [
        {
          label: 'Cases',
          children: [
            { label: 'Included', children: [{ label: 'N' }, { label: 'Percent' }] },
            { label: 'Excluded', children: [{ label: 'N' }, { label: 'Percent' }] },
            { label: 'Total', children: [{ label: 'N' }, { label: 'Percent' }] },
          ],
        },
      ],
      rows: pairs.map(([d, f]) => {
        const inc = listwiseCases(ds, f ? [d, f] : [d], cases).length
        const tot = cases.length
        return {
          label: f ? `${vlabel(d)} * ${vlabel(f)}` : vlabel(d),
          cells: [
            fmtCount(inc),
            fmtPct(tot ? (100 * inc) / tot : 0) + '%',
            fmtCount(tot - inc),
            fmtPct(tot ? (100 * (tot - inc)) / tot : 0) + '%',
            fmtCount(tot),
            '100.0%',
          ],
        }
      }),
    }),
  )
  const cellsSpec = spec.cells.length ? spec.cells : (['mean', 'count', 'stddev'] as const)
  for (const [d, f] of pairs) {
    const valid = listwiseCases(ds, f ? [d, f] : [d], cases)
    const dd = statDecimals(d)
    const statCells = (xs: number[]) => {
      const s = summarize(xs)
      return cellsSpec.map((c) => {
        switch (c) {
          case 'mean':
            return fmtNum(s.mean, dd)
          case 'count':
            return fmtCount(s.n)
          case 'stddev':
            return fmtNum(s.sd, statDecimals(d, 3))
          case 'sum':
            return fmtNum(s.sum, d.decimals)
          case 'min':
            return fmtNum(s.min, d.decimals)
          case 'max':
            return fmtNum(s.max, d.decimals)
          case 'median':
            return fmtNum(median(sortedCopy(xs)), dd)
          case 'semean':
            return fmtNum(s.se, statDecimals(d, 3))
          case 'variance':
            return fmtNum(s.variance, statDecimals(d, 3))
          case 'range':
            return fmtNum(s.range, d.decimals)
        }
      })
    }
    const rows: RowNode[] = []
    const groups: number[][] = []
    if (f) {
      for (const cat of categoriesOf(ds, f, valid)) {
        const key = catKey(f, cat)
        const xs = valid
          .filter((i) => {
            const fx = ds.data[f.id][i]
            return catKey(f, f.type === 'string' ? String(fx).trimEnd() : (fx as number)) === key
          })
          .map((i) => ds.data[d.id][i] as number)
        groups.push(xs)
        rows.push({ label: catLabel(f, cat), cells: statCells(xs) })
      }
    }
    rows.push({ label: 'Total', cells: statCells(valid.map((i) => ds.data[d.id][i] as number)) })
    items.push(
      out.table({
        title: 'Report',
        caption: vlabel(d),
        corner: f ? [vlabel(f)] : undefined,
        columns: cellsSpec.map((c) => ({ label: MEANS_LABEL[c] })),
        rows,
      }),
    )
    if (spec.anova && f && groups.length > 1) {
      const a = onewayAnova(groups)
      items.push(
        out.table({
          title: 'ANOVA Table',
          columns: [{ label: 'Sum of Squares' }, { label: 'df' }, { label: 'Mean Square' }, { label: 'F' }, { label: 'Sig.' }],
          rows: [
            {
              label: `${vlabel(d)} * ${vlabel(f)}`,
              children: [
                { label: 'Between Groups', children: [{ label: '(Combined)', cells: [fmtNum(a.ssb, 3), String(a.dfb), fmtNum(a.msb, 3), fmtNum(a.f, 3), fmtSig(a.p)] }] },
                { label: 'Within Groups', cells: [fmtNum(a.ssw, 3), String(a.dfw), fmtNum(a.msw, 3), '', ''] },
                { label: 'Total', cells: [fmtNum(a.sst, 3), String(a.dft), '', '', ''] },
              ],
            },
          ],
        }),
      )
      const eta2 = a.ssb / a.sst
      items.push(
        out.table({
          title: 'Measures of Association',
          columns: [{ label: 'Eta' }, { label: 'Eta Squared' }],
          rows: [{ label: `${vlabel(d)} * ${vlabel(f)}`, cells: [fmtNum(Math.sqrt(eta2), 3), fmtNum(eta2, 3)] }],
        }),
      )
    }
  }
  return items
}

// ------------------------------------------------------------------------- T-TEST (one sample)

export function runOneSampleT(ds: Dataset, spec: OneSampleTSpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'T-TEST'))
  let cases = analysisCases(ds)
  if (spec.missing === 'listwise') cases = listwiseCases(ds, vars, cases)
  const conf = spec.ci
  const res = vars.map((v) => {
    const xs = validNumbers(ds, v, cases)
    return xs.length > 1 ? oneSampleT(xs, spec.testValue, conf / 100) : null
  })
  const items: OutputItem[] = [out.title('T-Test')]
  items.push(
    out.table({
      title: 'One-Sample Statistics',
      columns: [{ label: 'N' }, { label: 'Mean' }, { label: 'Std. Deviation' }, { label: 'Std. Error Mean' }],
      rows: vars.map((v, k) => {
        const r = res[k]
        const n = validNumbers(ds, v, cases).length
        return {
          label: vlabel(v),
          cells: r
            ? [fmtCount(r.n), fmtNum(r.mean, statDecimals(v)), fmtNum(r.sd, statDecimals(v, 3)), fmtNum(r.se, statDecimals(v, 3))]
            : [fmtCount(n), '.', '.', '.'],
        }
      }),
    }),
  )
  items.push(
    out.table({
      title: 'One-Sample Test',
      columns: [
        {
          label: `Test Value = ${spec.testValue}`,
          children: [{ label: 't' }, { label: 'df' }, SIG_COLS, { label: 'Mean Difference' }, ciCols(conf)],
        },
      ],
      rows: vars.map((v, k) => {
        const r = res[k]
        if (!r) return { label: vlabel(v), cells: ['.', '.', '.', '.', '.', '.', '.'] }
        return {
          label: vlabel(v),
          cells: [
            fmtNum(r.t, 3),
            fmtDf(r.df),
            fmtSig(r.p2 / 2),
            fmtSig(r.p2),
            fmtNum(r.diff, statDecimals(v)),
            fmtNum(r.lo, statDecimals(v)),
            fmtNum(r.hi, statDecimals(v)),
          ],
        }
      }),
    }),
  )
  items.push(
    out.table({
      title: 'One-Sample Effect Sizes',
      columns: [{ label: 'Standardizer', sup: 'a' }, { label: 'Point Estimate' }],
      rows: vars.flatMap((v, k) => {
        const r = res[k]
        if (!r) return []
        const n = r.n
        const d = r.diff / r.sd
        const corr = 1 - 3 / (4 * (n - 1) - 1)
        return [
          {
            label: vlabel(v),
            children: [
              { label: "Cohen's d", cells: [fmtNum(r.sd, 3), fmtNum(d, 3)] },
              { label: "Hedges' correction", cells: [fmtNum(r.sd / corr, 3), fmtNum(d * corr, 3)] },
            ],
          },
        ]
      }),
      footnotes: [
        {
          mark: 'a',
          text: "The denominator used in estimating the effect sizes. Cohen's d uses the sample standard deviation. Hedges' correction uses the sample standard deviation, plus a correction factor.",
        },
      ],
    }),
  )
  return items
}

// ------------------------------------------------------------------------- T-TEST (independent)

export function runIndependentT(ds: Dataset, spec: IndependentTSpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'T-TEST'))
  const g = resolveVar(ds, spec.group)
  let cases = analysisCases(ds).filter((i) => !isMissing(g, ds.data[g.id][i]))
  if (spec.missing === 'listwise') cases = listwiseCases(ds, vars, cases)
  const def = spec.groupDef
  if (def.kind === 'cut' && g.type !== 'numeric') throw new ProcError('A cut point requires a numeric grouping variable.')
  const inGroup = (i: number, which: 1 | 2): boolean => {
    const x = ds.data[g.id][i]
    if (def.kind === 'cut') return which === 1 ? (x as number) >= def.cut : (x as number) < def.cut
    return matchesGroup(g, g.type === 'string' ? String(x) : (x as number), which === 1 ? def.g1 : def.g2)
  }
  const label = (which: 1 | 2) => {
    if (def.kind === 'cut') return which === 1 ? `>= ${def.cut}` : `< ${def.cut}`
    const val = which === 1 ? def.g1 : def.g2
    return catLabel(g, g.type === 'numeric' ? Number(val) : String(val))
  }
  const conf = spec.ci
  const data = vars.map((v) => ({
    v,
    x1: validNumbers(ds, v, cases.filter((i) => inGroup(i, 1))),
    x2: validNumbers(ds, v, cases.filter((i) => inGroup(i, 2))),
  }))
  const items: OutputItem[] = [out.title('T-Test')]
  items.push(
    out.table({
      title: 'Group Statistics',
      corner: ['', vlabel(g)],
      columns: [{ label: 'N' }, { label: 'Mean' }, { label: 'Std. Deviation' }, { label: 'Std. Error Mean' }],
      rows: data.map(({ v, x1, x2 }) => ({
        label: vlabel(v),
        children: ([1, 2] as const).map((w) => {
          const xs = w === 1 ? x1 : x2
          const s = summarize(xs)
          return {
            label: label(w),
            cells: [fmtCount(s.n), fmtNum(s.mean, statDecimals(v)), fmtNum(s.sd, statDecimals(v, 3)), fmtNum(s.se, statDecimals(v, 3))],
          }
        }),
      })),
    }),
  )
  const notes = new Notes()
  const rows: RowNode[] = data.map(({ v, x1, x2 }) => {
    if (x1.length < 2 || x2.length < 2) {
      notes.mark(`t cannot be computed for ${vlabel(v)} because at least one of the groups has fewer than two cases.`)
      return { label: vlabel(v), cells: new Array(10).fill('.') }
    }
    const r = independentT(x1, x2, conf / 100)
    const d = statDecimals(v)
    const tRow = (t: typeof r.equal) => [
      fmtNum(t.t, 3),
      fmtDf(t.df),
      fmtSig(t.p2 / 2),
      fmtSig(t.p2),
      fmtNum(t.diff, d),
      fmtNum(t.seDiff, statDecimals(v, 3)),
      fmtNum(t.lo, d),
      fmtNum(t.hi, d),
    ]
    return {
      label: vlabel(v),
      children: [
        { label: 'Equal variances assumed', cells: [fmtNum(r.levene.f, 3), fmtSig(r.levene.p), ...tRow(r.equal)] },
        { label: 'Equal variances not assumed', cells: ['', '', ...tRow(r.welch)] },
      ],
    }
  })
  items.push(
    out.table({
      title: 'Independent Samples Test',
      columns: [
        { label: "Levene's Test for Equality of Variances", children: [{ label: 'F' }, { label: 'Sig.' }] },
        {
          label: 't-test for Equality of Means',
          children: [{ label: 't' }, { label: 'df' }, SIG_COLS, { label: 'Mean Difference' }, { label: 'Std. Error Difference' }, ciCols(conf)],
        },
      ],
      rows,
      footnotes: notes.footnotes,
    }),
  )
  // Effect sizes (Cohen's d with pooled SD, Hedges' g, Glass's delta)
  const esRows: RowNode[] = []
  for (const { v, x1, x2 } of data) {
    if (x1.length < 2 || x2.length < 2) continue
    const s1 = summarize(x1)
    const s2 = summarize(x2)
    const n1 = s1.n
    const n2 = s2.n
    const sp = Math.sqrt(((n1 - 1) * s1.variance + (n2 - 1) * s2.variance) / (n1 + n2 - 2))
    const diff = s1.mean - s2.mean
    const corr = 1 - 3 / (4 * (n1 + n2) - 9)
    esRows.push({
      label: vlabel(v),
      children: [
        { label: "Cohen's d", cells: [fmtNum(sp, 3), fmtNum(diff / sp, 3)] },
        { label: "Hedges' correction", cells: [fmtNum(sp / corr, 3), fmtNum((diff / sp) * corr, 3)] },
        { label: "Glass's delta", cells: [fmtNum(s2.sd, 3), fmtNum(diff / s2.sd, 3)] },
      ],
    })
  }
  if (esRows.length)
    items.push(
      out.table({
        title: 'Independent Samples Effect Sizes',
        columns: [{ label: 'Standardizer', sup: 'a' }, { label: 'Point Estimate' }],
        rows: esRows,
        footnotes: [
          {
            mark: 'a',
            text: "The denominator used in estimating the effect sizes. Cohen's d uses the pooled standard deviation. Hedges' correction uses the pooled standard deviation, plus a correction factor. Glass's delta uses the sample standard deviation of the control group (group 2).",
          },
        ],
      }),
    )
  return items
}

// ------------------------------------------------------------------------- T-TEST (paired)

export function runPairedT(ds: Dataset, spec: PairedTSpec): OutputItem[] {
  const pairs = spec.pairs.map(([a, b]) => [resolveVar(ds, a), resolveVar(ds, b)] as [Variable, Variable])
  pairs.flat().forEach((v) => requireNumeric(v, 'T-TEST'))
  let cases = analysisCases(ds)
  if (spec.missing === 'listwise') cases = listwiseCases(ds, pairs.flat(), cases)
  const conf = spec.ci
  const data = pairs.map(([a, b]) => {
    const valid = listwiseCases(ds, [a, b], cases)
    const x = valid.map((i) => ds.data[a.id][i] as number)
    const y = valid.map((i) => ds.data[b.id][i] as number)
    return { a, b, x, y, r: x.length > 1 ? pairedT(x, y, conf / 100) : null }
  })
  const items: OutputItem[] = [out.title('T-Test')]
  items.push(
    out.table({
      title: 'Paired Samples Statistics',
      columns: [{ label: 'Mean' }, { label: 'N' }, { label: 'Std. Deviation' }, { label: 'Std. Error Mean' }],
      rows: data.map(({ a, b, x, y }, k) => ({
        label: `Pair ${k + 1}`,
        children: [
          [a, x],
          [b, y],
        ].map(([v, xs]) => {
          const s = summarize(xs as number[])
          const vv = v as Variable
          return {
            label: vlabel(vv),
            cells: [fmtNum(s.mean, statDecimals(vv)), fmtCount(s.n), fmtNum(s.sd, statDecimals(vv, 3)), fmtNum(s.se, statDecimals(vv, 3))],
          }
        }),
      })),
    }),
  )
  items.push(
    out.table({
      title: 'Paired Samples Correlations',
      columns: [{ label: 'N' }, { label: 'Correlation' }, SIG_COLS],
      rows: data.map(({ a, b, r, x }, k) => ({
        label: `Pair ${k + 1}`,
        children: [
          {
            label: `${vlabel(a)} & ${vlabel(b)}`,
            cells: r ? [fmtCount(x.length), fmtNum(r.r, 3), fmtSig(r.pR / 2), fmtSig(r.pR)] : [fmtCount(x.length), '.', '.', '.'],
          },
        ],
      })),
    }),
  )
  items.push(
    out.table({
      title: 'Paired Samples Test',
      columns: [
        {
          label: 'Paired Differences',
          children: [{ label: 'Mean' }, { label: 'Std. Deviation' }, { label: 'Std. Error Mean' }, ciCols(conf, 'Confidence Interval of the Difference')],
        },
        { label: 't' },
        { label: 'df' },
        SIG_COLS,
      ],
      rows: data.map(({ a, b, r }, k) => {
        const d = statDecimals(a)
        return {
          label: `Pair ${k + 1}`,
          children: [
            {
              label: `${vlabel(a)} - ${vlabel(b)}`,
              cells: r
                ? [
                    fmtNum(r.meanDiff, d),
                    fmtNum(r.sdDiff, statDecimals(a, 3)),
                    fmtNum(r.se, statDecimals(a, 3)),
                    fmtNum(r.lo, d),
                    fmtNum(r.hi, d),
                    fmtNum(r.t, 3),
                    fmtDf(r.df),
                    fmtSig(r.p2 / 2),
                    fmtSig(r.p2),
                  ]
                : new Array(9).fill('.'),
            },
          ],
        }
      }),
    }),
  )
  const es = data.filter((x) => x.r)
  if (es.length)
    items.push(
      out.table({
        title: 'Paired Samples Effect Sizes',
        columns: [{ label: 'Standardizer', sup: 'a' }, { label: 'Point Estimate' }],
        rows: es.map(({ a, b, r }, k) => {
          const n = r!.n
          const corr = 1 - 3 / (4 * (n - 1) - 1)
          return {
            label: `Pair ${k + 1}`,
            children: [
              {
                label: `${vlabel(a)} - ${vlabel(b)}`,
                children: [
                  { label: "Cohen's d", cells: [fmtNum(r!.sdDiff, 3), fmtNum(r!.meanDiff / r!.sdDiff, 3)] },
                  { label: "Hedges' correction", cells: [fmtNum(r!.sdDiff / corr, 3), fmtNum((r!.meanDiff / r!.sdDiff) * corr, 3)] },
                ],
              },
            ],
          }
        }),
        footnotes: [
          {
            mark: 'a',
            text: "The denominator used in estimating the effect sizes. Cohen's d uses the sample standard deviation of the mean difference. Hedges' correction uses the sample standard deviation of the mean difference, plus a correction factor.",
          },
        ],
      }),
    )
  return items
}

// ------------------------------------------------------------------------- ONEWAY

const POSTHOC_NAME: Record<PostHoc, string> = {
  tukey: 'Tukey HSD',
  scheffe: 'Scheffe',
  lsd: 'LSD',
  bonferroni: 'Bonferroni',
  sidak: 'Sidak',
  gh: 'Games-Howell',
}

export function runOneway(ds: Dataset, spec: OnewaySpec): OutputItem[] {
  const deps = resolveVars(ds, spec.dependents)
  deps.forEach((v) => requireNumeric(v, 'ONEWAY'))
  const f = resolveVar(ds, spec.factor)
  let cases = analysisCases(ds).filter((i) => !isMissing(f, ds.data[f.id][i]))
  if (spec.missing === 'listwise') cases = listwiseCases(ds, deps, cases)
  const cats = categoriesOf(ds, f, cases)
  const items: OutputItem[] = [out.title('Oneway')]
  const dataFor = (d: Variable) =>
    cats.map((cat) => {
      const key = catKey(f, cat)
      return validNumbers(
        ds,
        d,
        cases.filter((i) => {
          const fx = ds.data[f.id][i]
          return catKey(f, f.type === 'string' ? String(fx).trimEnd() : (fx as number)) === key
        }),
      )
    })
  const all = deps.map((d) => ({ d, groups: dataFor(d) }))
  const conf = 0.95

  if (spec.descriptives) {
    items.push(
      out.table({
        title: 'Descriptives',
        columns: [
          { label: 'N' },
          { label: 'Mean' },
          { label: 'Std. Deviation' },
          { label: 'Std. Error' },
          { label: '95% Confidence Interval for Mean', children: [{ label: 'Lower Bound' }, { label: 'Upper Bound' }] },
          { label: 'Minimum' },
          { label: 'Maximum' },
        ],
        rows: all.map(({ d, groups }) => {
          const rowFor = (label: string, xs: number[]): RowNode => {
            const s = summarize(xs)
            const q = s.n > 1 ? tInv(1 - (1 - conf) / 2, s.n - 1) : NaN
            const dd = statDecimals(d)
            return {
              label,
              cells: [
                fmtCount(s.n),
                fmtNum(s.mean, dd),
                fmtNum(s.sd, statDecimals(d, 3)),
                fmtNum(s.se, statDecimals(d, 3)),
                fmtNum(s.mean - q * s.se, dd),
                fmtNum(s.mean + q * s.se, dd),
                fmtNum(s.min, d.decimals),
                fmtNum(s.max, d.decimals),
              ],
            }
          }
          return {
            label: vlabel(d),
            children: [...cats.map((c, k) => rowFor(catLabel(f, c), groups[k])), rowFor('Total', groups.flat())],
          }
        }),
      }),
    )
  }

  if (spec.homogeneity) {
    items.push(
      out.table({
        title: 'Tests of Homogeneity of Variances',
        columns: [{ label: 'Levene Statistic' }, { label: 'df1' }, { label: 'df2' }, { label: 'Sig.' }],
        rows: all.map(({ d, groups }) => {
          const g = groups.filter((x) => x.length)
          const rows: RowNode[] = (
            [
              ['Based on Mean', 'mean'],
              ['Based on Median', 'median'],
              ['Based on trimmed mean', 'trimmed'],
            ] as const
          ).map(([label, c]) => {
            const l = levene(g, c)
            return { label, cells: [fmtNum(l.f, 3), String(l.df1), fmtDf(l.df2), fmtSig(l.p)] }
          })
          return { label: vlabel(d), children: rows }
        }),
      }),
    )
  }

  items.push(
    out.table({
      title: 'ANOVA',
      columns: [{ label: 'Sum of Squares' }, { label: 'df' }, { label: 'Mean Square' }, { label: 'F' }, { label: 'Sig.' }],
      rows: all.map(({ d, groups }) => {
        const a = onewayAnova(groups.filter((x) => x.length))
        return {
          label: vlabel(d),
          children: [
            { label: 'Between Groups', cells: [fmtNum(a.ssb, 3), String(a.dfb), fmtNum(a.msb, 3), fmtNum(a.f, 3), fmtSig(a.p)] },
            { label: 'Within Groups', cells: [fmtNum(a.ssw, 3), String(a.dfw), fmtNum(a.msw, 3), '', ''] },
            { label: 'Total', cells: [fmtNum(a.sst, 3), String(a.dft), '', '', ''] },
          ],
        }
      }),
    }),
  )

  // ANOVA effect sizes
  items.push(
    out.table({
      title: 'ANOVA Effect Sizes',
      columns: [{ label: 'Point Estimate' }],
      rows: all.map(({ d, groups }) => {
        const a = onewayAnova(groups.filter((x) => x.length))
        const eta2 = a.ssb / a.sst
        const eps2 = (a.ssb - a.dfb * a.msw) / a.sst
        const omega2 = (a.ssb - a.dfb * a.msw) / (a.sst + a.msw)
        return {
          label: vlabel(d),
          children: [
            { label: 'Eta-squared', cells: [fmtNum(eta2, 3)] },
            { label: 'Epsilon-squared', cells: [fmtNum(eps2, 3)] },
            { label: 'Omega-squared Fixed-effect', cells: [fmtNum(omega2, 3)] },
          ],
        }
      }),
    }),
  )

  if (spec.welch || spec.brownForsythe) {
    const notes = new Notes()
    const aMark = notes.mark('Asymptotically F distributed.')
    items.push(
      out.table({
        title: 'Robust Tests of Equality of Means',
        columns: [{ label: 'Statistic', sup: aMark }, { label: 'df1' }, { label: 'df2' }, { label: 'Sig.' }],
        rows: all.map(({ d, groups }) => {
          const g = groups.filter((x) => x.length > 1)
          const rows: RowNode[] = []
          if (spec.welch) {
            const w = welchAnova(g)
            rows.push({ label: 'Welch', cells: [fmtNum(w.statistic, 3), String(w.df1), fmtDf(w.df2), fmtSig(w.p)] })
          }
          if (spec.brownForsythe) {
            const b = brownForsythe(g)
            rows.push({ label: 'Brown-Forsythe', cells: [fmtNum(b.statistic, 3), String(b.df1), fmtDf(b.df2), fmtSig(b.p)] })
          }
          return { label: vlabel(d), children: rows }
        }),
        footnotes: notes.footnotes,
      }),
    )
  }

  if (spec.posthoc.length && cats.length > 2) {
    items.push(out.title('Post Hoc Tests'))
    for (const { d, groups } of all) {
      const a = onewayAnova(groups)
      const notes = new Notes()
      const star = '*'
      const rows: RowNode[] = spec.posthoc.map((m) => {
        const comps = postHoc(groups, m, a.msw, a.dfw, spec.alpha)
        return {
          label: POSTHOC_NAME[m],
          children: cats.map((ci, i) => ({
            label: catLabel(f, ci),
            children: cats
              .map((cj, j) => ({ cj, j }))
              .filter(({ j }) => j !== i)
              .map(({ cj, j }) => {
                const c = comps.find((x) => x.i === i && x.j === j)!
                const dd = statDecimals(d)
                const sig = c.p < spec.alpha
                if (sig) notes.symbol(star, `The mean difference is significant at the ${spec.alpha} level.`)
                return {
                  label: catLabel(f, cj),
                  cells: [
                    sig ? { text: fmtNum(c.diff, dd), sup: star } : fmtNum(c.diff, dd),
                    fmtNum(c.se, statDecimals(d, 3)),
                    fmtSig(c.p),
                    fmtNum(c.lo, dd),
                    fmtNum(c.hi, dd),
                  ],
                }
              }),
          })),
        }
      })
      items.push(
        out.table({
          title: 'Multiple Comparisons',
          caption: `Dependent Variable: ${vlabel(d)}`,
          corner: ['', `(I) ${vlabel(f)}`, `(J) ${vlabel(f)}`],
          columns: [
            { label: 'Mean Difference (I-J)' },
            { label: 'Std. Error' },
            { label: 'Sig.' },
            { label: `${fmtNum((1 - spec.alpha) * 100, 0)}% Confidence Interval`, children: [{ label: 'Lower Bound' }, { label: 'Upper Bound' }] },
          ],
          rows,
          footnotes: notes.footnotes,
        }),
      )
    }
  } else if (spec.posthoc.length) {
    items.push(out.text(`Post hoc tests are not performed for ${vlabel(f)} because there are fewer than three groups.`, 'warning', 'Warnings'))
  }

  if (spec.meansPlot) {
    for (const { d, groups } of all) {
      items.push(
        out.chart({
          type: 'line',
          title: `Means Plot of ${vlabel(d)}`,
          xLabel: vlabel(f),
          yLabel: `Mean of ${vlabel(d)}`,
          categories: cats.map((c) => catLabel(f, c)),
          values: groups.map((g) => (g.length ? mean(g) : null)),
        }),
      )
    }
  }
  return items
}
