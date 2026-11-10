import { isMissing, type Dataset, type Variable } from '../core/dataset'
import { fmtCount, fmtNum, fmtPct, fmtSig, statDecimals } from '../core/format'
import { out, type Cell, type OutputItem, type RowNode } from '../core/output'
import { summarize } from '../stats/basic'
import { lilliefors } from '../stats/normality'
import { chiSquareGOF, friedman, kruskalWallis, mannWhitney, wilcoxonSignedRank } from '../stats/tests'
import {
  analysisCases,
  catLabel,
  categoriesOf,
  listwiseCases,
  Notes,
  ProcError,
  requireNumeric,
  resolveVar,
  resolveVars,
  validNumbers,
  vlabel,
} from './common'
import type {
  NparChiSquareSpec,
  NparFriedmanSpec,
  NparKIndepSpec,
  NparKSSpec,
  NparTwoIndepSpec,
  NparWilcoxonSpec,
} from './types'

export function runNparChiSquare(ds: Dataset, spec: NparChiSquareSpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'NPAR TESTS'))
  const cases = analysisCases(ds)
  const items: OutputItem[] = [out.title('NPar Tests'), out.title('Chi-Square Test'), out.title('Frequencies')]
  const notes = new Notes()
  const testCells: Cell[][] = [[], [], []]
  for (const v of vars) {
    let xs = validNumbers(ds, v, cases)
    let cats: number[]
    if (spec.range) {
      const [lo, hi] = spec.range
      xs = xs.filter((x) => x >= lo && x <= hi).map((x) => Math.trunc(x))
      cats = []
      for (let c = Math.ceil(lo); c <= Math.floor(hi); c++) cats.push(c)
    } else cats = [...new Set(xs)].sort((a, b) => a - b)
    const obs = cats.map((c) => xs.filter((x) => x === c).length)
    const n = xs.length
    let exp: number[]
    if (spec.expected === 'equal') exp = cats.map(() => n / cats.length)
    else {
      const w = spec.expected
      if (w.length !== cats.length)
        throw new ProcError(
          `The number of expected values (${w.length}) does not match the number of categories (${cats.length}) for ${v.name}.`,
        )
      const tw = w.reduce((s, x) => s + x, 0)
      exp = w.map((x) => (n * x) / tw)
    }
    items.push(
      out.table({
        title: vlabel(v),
        columns: [{ label: 'Observed N' }, { label: 'Expected N' }, { label: 'Residual' }],
        rows: [
          ...cats.map((c, k) => ({
            label: catLabel(v, c),
            cells: [fmtCount(obs[k]), fmtNum(exp[k], 1), fmtNum(obs[k] - exp[k], 1)],
          })),
          { label: 'Total', cells: [fmtCount(n), '', ''] },
        ],
      }),
    )
    const r = chiSquareGOF(obs, exp)
    const below = exp.filter((e) => e < 5).length
    const mark = notes.mark(
      `${below} cells (${fmtPct((100 * below) / cats.length)}%) have expected frequencies less than 5. The minimum expected cell frequency is ${fmtNum(Math.min(...exp), 1)}.`,
    )
    testCells[0].push({ text: fmtNum(r.chi2, 3), sup: mark })
    testCells[1].push(String(r.df))
    testCells[2].push(fmtSig(r.p))
  }
  items.push(
    out.table({
      title: 'Test Statistics',
      columns: vars.map((v) => ({ label: vlabel(v) })),
      rows: [
        { label: 'Chi-Square', cells: testCells[0] },
        { label: 'df', cells: testCells[1] },
        { label: 'Asymp. Sig.', cells: testCells[2] },
      ],
      footnotes: notes.footnotes,
    }),
  )
  return items
}

function groupValues(ds: Dataset, v: Variable, g: Variable, cases: number[], value: number): number[] {
  return validNumbers(
    ds,
    v,
    cases.filter((i) => {
      const x = ds.data[g.id][i]
      return !isMissing(g, x) && x === value
    }),
  )
}

export function runMannWhitney(ds: Dataset, spec: NparTwoIndepSpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'NPAR TESTS'))
  const g = resolveVar(ds, spec.group)
  requireNumeric(g, 'NPAR TESTS')
  const cases = analysisCases(ds)
  const results = vars.map((v) => {
    const x1 = groupValues(ds, v, g, cases, spec.g1)
    const x2 = groupValues(ds, v, g, cases, spec.g2)
    return { v, x1, x2, r: x1.length && x2.length ? mannWhitney(x1, x2) : null }
  })
  const items: OutputItem[] = [out.title('NPar Tests'), out.title('Mann-Whitney Test')]
  items.push(
    out.table({
      title: 'Ranks',
      corner: ['', vlabel(g)],
      columns: [{ label: 'N' }, { label: 'Mean Rank' }, { label: 'Sum of Ranks' }],
      rows: results.map(({ v, x1, x2, r }) => ({
        label: vlabel(v),
        children: [
          { label: catLabel(g, spec.g1), cells: [fmtCount(x1.length), r ? fmtNum(r.meanRank1, 2) : '.', r ? fmtNum(r.sumRank1, 2) : '.'] },
          { label: catLabel(g, spec.g2), cells: [fmtCount(x2.length), r ? fmtNum(r.meanRank2, 2) : '.', r ? fmtNum(r.sumRank2, 2) : '.'] },
          { label: 'Total', cells: [fmtCount(x1.length + x2.length), '', ''] },
        ],
      })),
    }),
  )
  const notes = new Notes()
  const gMark = notes.mark(`Grouping Variable: ${vlabel(g)}`)
  const anyExact = results.some((x) => x.r?.exactP !== null && x.r?.exactP !== undefined)
  const rows: RowNode[] = [
    { label: 'Mann-Whitney U', cells: results.map((x) => (x.r ? fmtNum(x.r.u, 3) : '.')) },
    { label: 'Wilcoxon W', cells: results.map((x) => (x.r ? fmtNum(x.r.w, 3) : '.')) },
    { label: 'Z', cells: results.map((x) => (x.r ? fmtNum(x.r.z, 3) : '.')) },
    { label: 'Asymp. Sig. (2-tailed)', cells: results.map((x) => (x.r ? fmtSig(x.r.p2) : '.')) },
  ]
  if (anyExact) {
    const bMark = notes.mark('Not corrected for ties.')
    rows.push({
      label: 'Exact Sig. [2*(1-tailed Sig.)]',
      cells: results.map((x) => (x.r && x.r.exactP !== null ? { text: fmtSig(x.r.exactP), sup: bMark } : '')),
    })
  }
  items.push(
    out.table({ title: 'Test Statistics', titleSup: gMark, columns: vars.map((v) => ({ label: vlabel(v) })), rows, footnotes: notes.footnotes }),
  )
  return items
}

export function runWilcoxon(ds: Dataset, spec: NparWilcoxonSpec): OutputItem[] {
  const pairs = spec.pairs.map(([a, b]) => [resolveVar(ds, a), resolveVar(ds, b)] as [Variable, Variable])
  pairs.flat().forEach((v) => requireNumeric(v, 'NPAR TESTS'))
  const cases = analysisCases(ds)
  const results = pairs.map(([a, b]) => {
    const valid = listwiseCases(ds, [a, b], cases)
    const x = valid.map((i) => ds.data[a.id][i] as number)
    const y = valid.map((i) => ds.data[b.id][i] as number)
    return { a, b, r: wilcoxonSignedRank(x, y), n: valid.length }
  })
  const notes = new Notes()
  const items: OutputItem[] = [out.title('NPar Tests'), out.title('Wilcoxon Signed Ranks Test')]
  items.push(
    out.table({
      title: 'Ranks',
      columns: [{ label: 'N' }, { label: 'Mean Rank' }, { label: 'Sum of Ranks' }],
      rows: results.map(({ a, b, r, n }) => {
        const ma = notes.mark(`${vlabel(b)} < ${vlabel(a)}`)
        const mb = notes.mark(`${vlabel(b)} > ${vlabel(a)}`)
        const mc = notes.mark(`${vlabel(b)} = ${vlabel(a)}`)
        return {
          label: `${vlabel(b)} - ${vlabel(a)}`,
          children: [
            { label: 'Negative Ranks', cells: [{ text: fmtCount(r.nNeg), sup: ma }, r.nNeg ? fmtNum(r.meanRankNeg, 2) : '.00', fmtNum(r.sumNeg, 2)] },
            { label: 'Positive Ranks', cells: [{ text: fmtCount(r.nPos), sup: mb }, r.nPos ? fmtNum(r.meanRankPos, 2) : '.00', fmtNum(r.sumPos, 2)] },
            { label: 'Ties', cells: [{ text: fmtCount(r.nTies), sup: mc }, '', ''] },
            { label: 'Total', cells: [fmtCount(n), '', ''] },
          ],
        }
      }),
      footnotes: notes.footnotes,
    }),
  )
  const tn = new Notes()
  const aMark = tn.mark('Wilcoxon Signed Ranks Test')
  items.push(
    out.table({
      title: 'Test Statistics',
      titleSup: aMark,
      columns: results.map(({ a, b }) => ({ label: `${vlabel(b)} - ${vlabel(a)}` })),
      rows: [
        {
          label: 'Z',
          cells: results.map(({ r }) =>
            Number.isFinite(r.z)
              ? { text: fmtNum(r.z, 3), sup: tn.mark(r.basedOn === 'negative' ? 'Based on negative ranks.' : 'Based on positive ranks.') }
              : '.',
          ),
        },
        { label: 'Asymp. Sig. (2-tailed)', cells: results.map(({ r }) => fmtSig(r.p2)) },
      ],
      footnotes: tn.footnotes,
    }),
  )
  return items
}

export function runKruskalWallis(ds: Dataset, spec: NparKIndepSpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'NPAR TESTS'))
  const g = resolveVar(ds, spec.group)
  requireNumeric(g, 'NPAR TESTS')
  const cases = analysisCases(ds)
  const levels = categoriesOf(ds, g, cases).filter((x) => (x as number) >= spec.min && (x as number) <= spec.max && Number.isInteger(x)) as number[]
  const results = vars.map((v) => {
    const groups = levels.map((l) => groupValues(ds, v, g, cases, l))
    const used = groups.map((x, k) => ({ x, l: levels[k] })).filter((o) => o.x.length)
    return { v, used, r: used.length > 1 ? kruskalWallis(used.map((o) => o.x)) : null }
  })
  const items: OutputItem[] = [out.title('NPar Tests'), out.title('Kruskal-Wallis Test')]
  items.push(
    out.table({
      title: 'Ranks',
      corner: ['', vlabel(g)],
      columns: [{ label: 'N' }, { label: 'Mean Rank' }],
      rows: results.map(({ v, used, r }) => ({
        label: vlabel(v),
        children: [
          ...used.map((o, k) => ({ label: catLabel(g, o.l), cells: [fmtCount(o.x.length), r ? fmtNum(r.meanRanks[k], 2) : '.'] })),
          { label: 'Total', cells: [fmtCount(used.reduce((s, o) => s + o.x.length, 0)), ''] },
        ],
      })),
    }),
  )
  const notes = new Notes()
  const a = notes.mark('Kruskal Wallis Test')
  const b = notes.mark(`Grouping Variable: ${vlabel(g)}`)
  items.push(
    out.table({
      title: 'Test Statistics',
      titleSup: `${a},${b}`,
      columns: vars.map((v) => ({ label: vlabel(v) })),
      rows: [
        { label: 'Kruskal-Wallis H', cells: results.map(({ r }) => (r ? fmtNum(r.h, 3) : '.')) },
        { label: 'df', cells: results.map(({ r }) => (r ? String(r.df) : '.')) },
        { label: 'Asymp. Sig.', cells: results.map(({ r }) => (r ? fmtSig(r.p) : '.')) },
      ],
      footnotes: notes.footnotes,
    }),
  )
  return items
}

export function runFriedman(ds: Dataset, spec: NparFriedmanSpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'NPAR TESTS'))
  if (vars.length < 2) throw new ProcError('The Friedman test requires at least two variables.')
  const cases = listwiseCases(ds, vars, analysisCases(ds))
  const rows = cases.map((i) => vars.map((v) => ds.data[v.id][i] as number))
  const r = friedman(rows)
  const notes = new Notes()
  const a = notes.mark('Friedman Test')
  return [
    out.title('NPar Tests'),
    out.title('Friedman Test'),
    out.table({ title: 'Ranks', columns: [{ label: 'Mean Rank' }], rows: vars.map((v, k) => ({ label: vlabel(v), cells: [fmtNum(r.meanRanks[k], 2)] })) }),
    out.table({
      title: 'Test Statistics',
      titleSup: a,
      columns: [{ label: '' }],
      rows: [
        { label: 'N', cells: [fmtCount(r.n)] },
        { label: 'Chi-Square', cells: [fmtNum(r.chi2, 3)] },
        { label: 'df', cells: [String(r.df)] },
        { label: 'Asymp. Sig.', cells: [fmtSig(r.p)] },
      ],
      footnotes: notes.footnotes,
    }),
  ]
}

export function runKS(ds: Dataset, spec: NparKSSpec): OutputItem[] {
  const vars = resolveVars(ds, spec.variables)
  vars.forEach((v) => requireNumeric(v, 'NPAR TESTS'))
  const cases = analysisCases(ds)
  const notes = new Notes()
  const a = notes.mark('Test distribution is Normal.')
  const b = notes.mark('Calculated from data.')
  const c = notes.mark('Lilliefors Significance Correction.')
  const res = vars.map((v) => {
    const xs = validNumbers(ds, v, cases)
    return { v, xs, s: summarize(xs), k: xs.length >= 2 ? lilliefors(xs) : null }
  })
  const d = res.some((r) => r.k?.lowerBound) ? notes.mark('This is a lower bound of the true significance.') : undefined
  return [
    out.title('NPar Tests'),
    out.table({
      title: 'One-Sample Kolmogorov-Smirnov Test',
      columns: res.map(({ v }) => ({ label: vlabel(v) })),
      rows: [
        { label: 'N', cells: res.map((r) => fmtCount(r.xs.length)) },
        {
          label: 'Normal Parameters',
          sup: `${a},${b}`,
          children: [
            { label: 'Mean', cells: res.map((r) => fmtNum(r.s.mean, statDecimals(r.v))) },
            { label: 'Std. Deviation', cells: res.map((r) => fmtNum(r.s.sd, statDecimals(r.v, 3))) },
          ],
        },
        {
          label: 'Most Extreme Differences',
          children: [
            { label: 'Absolute', cells: res.map((r) => (r.k ? fmtNum(r.k.d, 3) : '.')) },
            { label: 'Positive', cells: res.map((r) => (r.k ? fmtNum(r.k.dPlus, 3) : '.')) },
            { label: 'Negative', cells: res.map((r) => (r.k ? fmtNum(r.k.dMinus, 3) : '.')) },
          ],
        },
        { label: 'Test Statistic', cells: res.map((r) => (r.k ? fmtNum(r.k.d, 3) : '.')) },
        {
          label: 'Asymp. Sig. (2-tailed)',
          sup: c,
          cells: res.map((r) => (r.k ? (r.k.lowerBound ? { text: fmtSig(r.k.p), sup: d } : fmtSig(r.k.p)) : '.')),
        },
      ],
      footnotes: notes.footnotes,
    }),
  ]
}
