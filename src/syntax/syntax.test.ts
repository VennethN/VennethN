import { describe, expect, it } from 'vitest'
import { createVariable, datasetFromColumns } from '../core/dataset'
import type { CommandSpec } from '../procedures/types'
import { generateSyntax } from './generate'
import { parseCommand, splitCommands, tokenize } from './parser'

const names = ['id', 'gender', 'group', 'age', 'income', 'score', 'pre', 'post', 'q1', 'q2', 'q3', 'city']
const vars = names.map((n) => createVariable(n, n === 'city' ? { type: 'string', width: 12 } : {}))
const ds = datasetFromColumns(vars, names.map(() => []))

function roundTrip(spec: CommandSpec): CommandSpec[] {
  const text = generateSyntax(spec)
  const cmds = splitCommands(text)
  return cmds.flatMap((c) => parseCommand(c, ds).specs)
}

const SPECS: CommandSpec[] = [
  {
    proc: 'frequencies',
    variables: ['gender', 'group'],
    showTables: true,
    statistics: ['mean', 'median', 'mode', 'stddev', 'skewness', 'kurtosis', 'minimum', 'maximum'],
    quartiles: true,
    percentiles: [10, 90],
    chart: 'histogram',
    chartValues: 'freq',
    normalCurve: true,
    order: 'dfreq',
  },
  { proc: 'descriptives', variables: ['age', 'income'], statistics: ['mean', 'stddev', 'min', 'max', 'skewness'], saveZ: true, sort: 'mean-d' },
  {
    proc: 'explore',
    dependents: ['score'],
    factors: ['gender'],
    display: 'both',
    descriptives: true,
    percentiles: true,
    outliers: true,
    ci: 95,
    boxplot: 'factor',
    stemleaf: true,
    histogram: true,
    normality: true,
    missing: 'listwise',
    noTotal: true,
  },
  { proc: 'crosstabs', rows: ['gender'], columns: ['group'], cells: ['count', 'expected', 'row'], statistics: ['chisq', 'phi', 'cc'], barchart: true, suppressTables: false },
  { proc: 'means', dependents: ['score'], independents: ['group'], cells: ['mean', 'count', 'stddev', 'median'], anova: true },
  { proc: 'ttest-one', variables: ['score', 'age'], testValue: 50, ci: 95, missing: 'analysis' },
  { proc: 'ttest-ind', variables: ['score'], group: 'gender', groupDef: { kind: 'values', g1: 1, g2: 2 }, ci: 90, missing: 'listwise' },
  { proc: 'ttest-ind', variables: ['score'], group: 'age', groupDef: { kind: 'cut', cut: 30 }, ci: 95, missing: 'analysis' },
  { proc: 'ttest-ind', variables: ['score'], group: 'city', groupDef: { kind: 'values', g1: 'Jakarta', g2: "O'Hare" }, ci: 95, missing: 'analysis' },
  { proc: 'ttest-paired', pairs: [['pre', 'post'], ['q1', 'q2']], ci: 95, missing: 'analysis' },
  {
    proc: 'oneway',
    dependents: ['score'],
    factor: 'group',
    descriptives: true,
    homogeneity: true,
    welch: true,
    brownForsythe: false,
    meansPlot: true,
    posthoc: ['tukey', 'bonferroni', 'gh'],
    alpha: 0.05,
    missing: 'analysis',
  },
  { proc: 'correlations', variables: ['age', 'income', 'score'], tails: 2, flag: true, descriptives: true, missing: 'pairwise' },
  { proc: 'nonparcorr', variables: ['age', 'score'], kendall: true, spearman: true, tails: 1, flag: false, missing: 'listwise' },
  {
    proc: 'regression',
    dependent: 'score',
    independents: ['age', 'income', 'pre'],
    method: 'enter',
    pin: 0.05,
    pout: 0.1,
    statistics: { coeff: true, ci: true, ciLevel: 95, r: true, anova: true, change: true, descriptives: true, zpp: true, collin: true, durbin: true },
    plots: { histogram: true, normprob: true, scatter: true },
    save: { pred: true, zpred: false, resid: true, zresid: true },
    constant: true,
  },
  { proc: 'reliability', variables: ['q1', 'q2', 'q3'], scaleName: 'Satisfaction', model: 'alpha', itemDescriptives: true, scaleDescriptives: true, itemTotal: true, interItemCorr: true },
  { proc: 'npar-chisquare', variables: ['group'], expected: [1, 2, 1], range: null },
  { proc: 'npar-mw', variables: ['score'], group: 'gender', g1: 1, g2: 2 },
  { proc: 'npar-kw', variables: ['score'], group: 'group', min: 1, max: 3 },
  { proc: 'npar-wilcoxon', pairs: [['pre', 'post']] },
  { proc: 'npar-friedman', variables: ['q1', 'q2', 'q3'] },
  { proc: 'npar-ks', variables: ['score', 'age'] },
  { proc: 'graph-bar', category: 'group', cluster: 'gender', summary: { kind: 'mean', variable: 'score' } },
  { proc: 'graph-bar', category: 'group', cluster: null, summary: { kind: 'pct' } },
  { proc: 'graph-pie', category: 'group' },
  { proc: 'graph-histogram', variable: 'score', normal: true },
  { proc: 'graph-scatter', x: 'age', y: 'score', group: 'gender', fitLine: true },
  { proc: 'graph-line', category: 'group', summary: { kind: 'median', variable: 'score' } },
  { proc: 'compute', target: 'total', expression: 'SUM(q1, q2, q3) / 3', condition: null, stringWidth: null },
  { proc: 'compute', target: 'flag', expression: '1', condition: "city = 'Jakarta' AND age > 30", stringWidth: null },
  {
    proc: 'recode',
    variables: ['age'],
    into: ['agegrp'],
    rules: [
      { old: [{ kind: 'lowest', high: 29 }], to: { kind: 'value', value: 1 } },
      { old: [{ kind: 'range', low: 30, high: 49 }], to: { kind: 'value', value: 2 } },
      { old: [{ kind: 'highest', low: 50 }], to: { kind: 'value', value: 3 } },
      { old: [{ kind: 'sysmis' }], to: { kind: 'sysmis' } },
      { old: [{ kind: 'else' }], to: { kind: 'copy' } },
    ],
    intoString: null,
  },
  { proc: 'recode', variables: ['q1', 'q2'], into: null, rules: [{ old: [{ kind: 'value', value: 1 }, { kind: 'value', value: 2 }], to: { kind: 'value', value: 0 } }], intoString: null },
  { proc: 'sort', keys: [{ variable: 'gender', descending: false }, { variable: 'score', descending: true }] },
  { proc: 'select-if', condition: 'age >= 18 & NOT MISSING(score)' },
  { proc: 'filter', variable: 'gender' },
  { proc: 'filter', variable: null },
  { proc: 'weight', variable: 'q1' },
  { proc: 'variable-labels', items: [{ variable: 'score', label: "Test score (it's 0-100)" }, { variable: 'age', label: 'Age in years' }] },
  { proc: 'value-labels', variables: ['gender'], labels: [{ value: 1, label: 'Male' }, { value: 2, label: 'Female' }], add: false },
  { proc: 'value-labels', variables: ['city'], labels: [{ value: 'JKT', label: 'Jakarta' }], add: true },
  { proc: 'missing-values', variables: ['q1', 'q2'], missing: { kind: 'discrete', values: [9, 99] } },
  { proc: 'missing-values', variables: ['income'], missing: { kind: 'range', low: -99, high: -1, value: 999 } },
  { proc: 'missing-values', variables: ['age'], missing: { kind: 'none' } },
  { proc: 'variable-level', variables: ['q1', 'q2'], level: 'ordinal' },
  { proc: 'formats', variables: ['score'], width: 8, decimals: 1 },
  { proc: 'delete-variables', variables: ['q3'] },
  { proc: 'rename', from: ['q1', 'q2'], to: ['item1', 'item2'] },
  { proc: 'autorecode', variables: ['city'], into: ['city_n'], descending: false },
  { proc: 'rank', variables: ['score'], into: ['Rscore'], descending: true },
  { proc: 'execute' },
  { proc: 'title', text: 'My analysis' },
]

/** Statistics keyword lists are sets; compare them order-insensitively. */
function normalize(spec: CommandSpec): CommandSpec {
  const c = structuredClone(spec) as Record<string, unknown>
  for (const k of ['statistics', 'cells']) if (Array.isArray(c[k])) (c[k] as string[]).sort()
  return c as unknown as CommandSpec
}

describe('syntax round trip (spec -> syntax -> spec)', () => {
  for (const spec of SPECS) {
    it(`${spec.proc}: ${generateSyntax(spec).split('\n')[0].slice(0, 60)}`, () => {
      expect(roundTrip(spec).map(normalize)).toEqual([normalize(spec)])
    })
  }
})

describe('command splitting', () => {
  it('handles comments, continuation lines and blank-line terminators', () => {
    const cmds = splitCommands(`* comment line.
FREQUENCIES VARIABLES=gender
  /ORDER=ANALYSIS.
DESCRIPTIVES age /* inline comment */ income

COMMENT another comment.
COMPUTE x = 'a.b'.
`)
    expect(cmds.map((c) => c.text)).toEqual([
      'FREQUENCIES VARIABLES=gender\n  /ORDER=ANALYSIS',
      'DESCRIPTIVES age  income',
      "COMPUTE x = 'a.b'",
    ])
    expect(cmds[0].line).toBe(2)
  })
  it('tokenizes hyphenated keywords, negative numbers and formats', () => {
    expect(tokenize("M-W= x BY g(1 2) (-9) F8.2 'it''s'").map((t) => t.v)).toEqual([
      'M-W', '=', 'x', 'BY', 'g', '(', 1, 2, ')', '(', -9, ')', 'F8.2', "it's",
    ])
  })
})

describe('parser conveniences', () => {
  const p = (text: string) => splitCommands(text).flatMap((c) => parseCommand(c, ds).specs)
  it('expands TO ranges and ALL', () => {
    const [f] = p('FREQ q1 TO q3.')
    expect(f).toMatchObject({ proc: 'frequencies', variables: ['q1', 'q2', 'q3'] })
    const [d] = p('DESC ALL.')
    expect((d as { variables: string[] }).variables.length).toBe(names.length)
  })
  it('accepts three-letter abbreviations and case-insensitive names', () => {
    expect(p('DESCRIPT VAR=AGE /STAT=MEAN.')[0]).toMatchObject({ variables: ['age'], statistics: ['mean'] })
  })
  it('splits multi-test NPAR TESTS into specs', () => {
    expect(p('NPAR TESTS /M-W=score BY gender(1 2) /K-S(NORMAL)=age.').map((s) => s.proc)).toEqual(['npar-mw', 'npar-ks'])
  })
  it('parses T-TEST PAIRS without WITH as all pairs', () => {
    expect(p('T-TEST PAIRS=q1 q2 q3.')[0]).toMatchObject({ pairs: [['q1', 'q2'], ['q1', 'q3'], ['q2', 'q3']] })
  })
  it('reports unknown variables with the line number', () => {
    expect(() => p('\n\nFREQ nothere.')).toThrow(/nothere/)
  })
})
