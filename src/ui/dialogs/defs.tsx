// Analysis and graph dialogs, defined declaratively.

import { getVar, type Dataset } from '../../core/dataset'
import type { CommandSpec, DescStat, FreqStat, PostHoc } from '../../procedures/types'
import { DefineButton, type Control, type DialogDef, type DState } from './framework'
import { bool, isNumeric, num } from './util'

const chk = (key: string, label: string, disabled?: (st: DState) => boolean): Control => ({ type: 'check', key, label, disabled })
const group = (label: string, children: Control[], columns = 1): Control => ({ type: 'group', label, children, columns })
const need = (st: DState, key: string, n = 1, what = 'variable') =>
  (st.lists[key] ?? []).length >= n ? null : `Select at least ${n === 1 ? 'one' : n} ${what}${n > 1 ? 's' : ''}.`

function parseList(s: unknown): number[] {
  return String(s ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)
    .filter((x) => Number.isFinite(x))
}

const MISSING_RADIO = (label = 'Missing Values'): Control =>
  group(label, [
    {
      type: 'radio',
      key: 'missing',
      options: [
        { value: 'analysis', label: 'Exclude cases analysis by analysis' },
        { value: 'listwise', label: 'Exclude cases listwise' },
      ],
    },
  ])

// ------------------------------------------------------------------------- descriptive statistics

const FREQ_STATS: [FreqStat, string][] = [
  ['mean', 'Mean'],
  ['median', 'Median'],
  ['mode', 'Mode'],
  ['sum', 'Sum'],
  ['stddev', 'Std. deviation'],
  ['variance', 'Variance'],
  ['range', 'Range'],
  ['minimum', 'Minimum'],
  ['maximum', 'Maximum'],
  ['semean', 'S.E. mean'],
  ['skewness', 'Skewness'],
  ['kurtosis', 'Kurtosis'],
]

export const frequencies: DialogDef = {
  id: 'frequencies',
  title: 'Frequencies',
  targets: [{ key: 'vars', label: 'Variable(s):', rows: 9 }],
  bottom: [chk('showTables', 'Display frequency tables')],
  subs: [
    {
      key: 'stats',
      label: 'Statistics…',
      title: 'Frequencies: Statistics',
      width: 560,
      controls: [
        {
          type: 'row',
          children: [
            group('Percentile Values', [
              chk('quartiles', 'Quartiles'),
              chk('usePct', 'Percentile(s):'),
              { type: 'text', key: 'pcts', label: '', placeholder: 'e.g. 10, 90', width: 150, disabled: (st) => !st.v.usePct },
            ]),
            group('Central Tendency', [chk('mean', 'Mean'), chk('median', 'Median'), chk('mode', 'Mode'), chk('sum', 'Sum')]),
          ],
        },
        {
          type: 'row',
          children: [
            group(
              'Dispersion',
              [chk('stddev', 'Std. deviation'), chk('minimum', 'Minimum'), chk('variance', 'Variance'), chk('maximum', 'Maximum'), chk('range', 'Range'), chk('semean', 'S.E. mean')],
              2,
            ),
            group('Distribution', [chk('skewness', 'Skewness'), chk('kurtosis', 'Kurtosis')]),
          ],
        },
      ],
      validate: (st) => (st.v.usePct && !parseList(st.v.pcts).every((p) => p >= 0 && p <= 100) ? 'Percentiles must be between 0 and 100.' : null),
    },
    {
      key: 'charts',
      label: 'Charts…',
      title: 'Frequencies: Charts',
      controls: [
        group('Chart Type', [
          {
            type: 'radio',
            key: 'chart',
            options: [
              { value: 'none', label: 'None' },
              { value: 'bar', label: 'Bar charts' },
              { value: 'pie', label: 'Pie charts' },
              { value: 'histogram', label: 'Histograms' },
            ],
          },
          chk('normalCurve', 'Show normal curve on histogram', (st) => st.v.chart !== 'histogram'),
        ]),
        group('Chart Values', [
          {
            type: 'radio',
            key: 'chartValues',
            inline: true,
            options: [
              { value: 'freq', label: 'Frequencies' },
              { value: 'percent', label: 'Percentages' },
            ],
            disabled: (st) => st.v.chart !== 'bar' && st.v.chart !== 'pie',
          },
        ]),
      ],
    },
    {
      key: 'format',
      label: 'Format…',
      title: 'Frequencies: Format',
      controls: [
        group('Order by', [
          {
            type: 'radio',
            key: 'order',
            options: [
              { value: 'avalue', label: 'Ascending values' },
              { value: 'dvalue', label: 'Descending values' },
              { value: 'afreq', label: 'Ascending counts' },
              { value: 'dfreq', label: 'Descending counts' },
            ],
          },
        ]),
      ],
    },
  ],
  defaults: () => ({
    lists: { vars: [] },
    v: { showTables: true, quartiles: false, usePct: false, pcts: '', chart: 'none', chartValues: 'freq', normalCurve: false, order: 'avalue' },
  }),
  validate: (st) => need(st, 'vars'),
  build: (st) => [
    {
      proc: 'frequencies',
      variables: st.lists.vars,
      showTables: bool(st.v.showTables),
      statistics: FREQ_STATS.filter(([k]) => st.v[k]).map(([k]) => k),
      quartiles: bool(st.v.quartiles),
      percentiles: st.v.usePct ? parseList(st.v.pcts) : [],
      chart: st.v.chart as 'none',
      chartValues: st.v.chartValues as 'freq',
      normalCurve: bool(st.v.normalCurve),
      order: st.v.order as 'avalue',
    },
  ],
  help: 'Frequencies produces frequency tables, summary statistics and charts for each selected variable. Use Statistics… for means, percentiles, dispersion and distribution measures, Charts… for bar/pie charts or histograms, and Format… to change the order of categories.',
}

const DESC_STATS: [DescStat, string][] = [
  ['mean', 'Mean'],
  ['sum', 'Sum'],
  ['stddev', 'Std. deviation'],
  ['min', 'Minimum'],
  ['variance', 'Variance'],
  ['max', 'Maximum'],
  ['range', 'Range'],
  ['semean', 'S.E. mean'],
  ['kurtosis', 'Kurtosis'],
  ['skewness', 'Skewness'],
]

export const descriptives: DialogDef = {
  id: 'descriptives',
  title: 'Descriptives',
  sourceFilter: isNumeric,
  targets: [{ key: 'vars', label: 'Variable(s):', rows: 9 }],
  bottom: [chk('saveZ', 'Save standardized values as variables')],
  subs: [
    {
      key: 'options',
      label: 'Options…',
      title: 'Descriptives: Options',
      controls: [
        { type: 'row', children: [chk('mean', 'Mean'), chk('sum', 'Sum')] },
        group('Dispersion', [chk('stddev', 'Std. deviation'), chk('min', 'Minimum'), chk('variance', 'Variance'), chk('max', 'Maximum'), chk('range', 'Range'), chk('semean', 'S.E. mean')], 2),
        group('Distribution', [chk('kurtosis', 'Kurtosis'), chk('skewness', 'Skewness')], 2),
        group('Display Order', [
          {
            type: 'radio',
            key: 'sort',
            options: [
              { value: 'variable', label: 'Variable list' },
              { value: 'alpha', label: 'Alphabetic' },
              { value: 'mean-a', label: 'Ascending means' },
              { value: 'mean-d', label: 'Descending means' },
            ],
          },
        ]),
      ],
    },
  ],
  defaults: () => ({ lists: { vars: [] }, v: { saveZ: false, mean: true, stddev: true, min: true, max: true, sort: 'variable' } }),
  validate: (st) => need(st, 'vars'),
  build: (st) => [
    {
      proc: 'descriptives',
      variables: st.lists.vars,
      statistics: DESC_STATS.filter(([k]) => st.v[k]).map(([k]) => k),
      saveZ: bool(st.v.saveZ),
      sort: st.v.sort as 'variable',
    },
  ],
  help: 'Descriptives displays univariate summary statistics for numeric variables in one table, and can save standardized (z) scores as new variables.',
}

export const explore: DialogDef = {
  id: 'explore',
  title: 'Explore',
  targets: [
    { key: 'deps', label: 'Dependent List:', rows: 6, accept: isNumeric },
    { key: 'factors', label: 'Factor List:', rows: 3 },
  ],
  bottom: [
    group('Display', [
      {
        type: 'radio',
        key: 'display',
        inline: true,
        options: [
          { value: 'both', label: 'Both' },
          { value: 'statistics', label: 'Statistics' },
          { value: 'plots', label: 'Plots' },
        ],
      },
    ]),
  ],
  subs: [
    {
      key: 'stats',
      label: 'Statistics…',
      title: 'Explore: Statistics',
      controls: [
        chk('descriptives', 'Descriptives'),
        { type: 'number', key: 'ci', label: 'Confidence Interval for Mean (%):', min: 1, max: 99.99, width: 70 },
        chk('outliers', 'Outliers'),
        chk('percentiles', 'Percentiles'),
      ],
    },
    {
      key: 'plots',
      label: 'Plots…',
      title: 'Explore: Plots',
      controls: [
        group('Boxplots', [
          {
            type: 'radio',
            key: 'boxplot',
            options: [
              { value: 'factor', label: 'Factor levels together' },
              { value: 'dependents', label: 'Dependents together' },
              { value: 'none', label: 'None' },
            ],
          },
        ]),
        group('Descriptive', [chk('stemleaf', 'Stem-and-leaf'), chk('histogram', 'Histogram')]),
        chk('normality', 'Normality plots with tests'),
      ],
    },
    {
      key: 'options',
      label: 'Options…',
      title: 'Explore: Options',
      controls: [
        group('Missing Values', [
          {
            type: 'radio',
            key: 'missing',
            options: [
              { value: 'listwise', label: 'Exclude cases listwise' },
              { value: 'pairwise', label: 'Exclude cases pairwise' },
            ],
          },
        ]),
      ],
    },
  ],
  defaults: () => ({
    lists: { deps: [], factors: [] },
    v: { display: 'both', descriptives: true, ci: 95, outliers: false, percentiles: false, boxplot: 'factor', stemleaf: true, histogram: false, normality: false, missing: 'listwise' },
  }),
  validate: (st) => need(st, 'deps', 1, 'dependent variable'),
  build: (st) => [
    {
      proc: 'explore',
      dependents: st.lists.deps,
      factors: st.lists.factors,
      display: st.v.display as 'both',
      descriptives: bool(st.v.descriptives),
      percentiles: bool(st.v.percentiles),
      outliers: bool(st.v.outliers),
      ci: num(st.v.ci, 95),
      boxplot: st.v.boxplot as 'factor',
      stemleaf: bool(st.v.stemleaf),
      histogram: bool(st.v.histogram),
      normality: bool(st.v.normality),
      missing: st.v.missing as 'listwise',
      noTotal: st.lists.factors.length > 0,
    },
  ],
  help: 'Explore screens data: descriptive statistics with confidence intervals and trimmed means, percentiles, outliers, boxplots, stem-and-leaf plots, histograms, and normality tests (Kolmogorov-Smirnov with Lilliefors correction and Shapiro-Wilk) under Plots… ▸ Normality plots with tests. Add a factor to compare groups.',
}

export const crosstabs: DialogDef = {
  id: 'crosstabs',
  title: 'Crosstabs',
  width: 660,
  targets: [
    { key: 'rows', label: 'Row(s):', rows: 4 },
    { key: 'cols', label: 'Column(s):', rows: 4 },
  ],
  bottom: [{ type: 'row', children: [chk('barchart', 'Display clustered bar charts'), chk('suppress', 'Suppress tables')] }],
  subs: [
    {
      key: 'stats',
      label: 'Statistics…',
      title: 'Crosstabs: Statistics',
      controls: [
        chk('chisq', 'Chi-square'),
        group('Nominal', [chk('cc', 'Contingency coefficient'), chk('phi', "Phi and Cramer's V")]),
        chk('risk', 'Risk (odds ratio, 2×2 tables)'),
      ],
    },
    {
      key: 'cells',
      label: 'Cells…',
      title: 'Crosstabs: Cell Display',
      controls: [
        group('Counts', [chk('count', 'Observed'), chk('expected', 'Expected')]),
        group('Percentages', [chk('row', 'Row'), chk('column', 'Column'), chk('total', 'Total')]),
        group('Residuals', [chk('resid', 'Unstandardized'), chk('sresid', 'Standardized'), chk('asresid', 'Adjusted standardized')]),
      ],
    },
  ],
  defaults: () => ({ lists: { rows: [], cols: [] }, v: { count: true, chisq: false, phi: false, cc: false, risk: false, barchart: false, suppress: false } }),
  validate: (st) => need(st, 'rows', 1, 'row variable') ?? need(st, 'cols', 1, 'column variable'),
  build: (st) => [
    {
      proc: 'crosstabs',
      rows: st.lists.rows,
      columns: st.lists.cols,
      cells: (['count', 'expected', 'row', 'column', 'total', 'resid', 'sresid', 'asresid'] as const).filter((k) => st.v[k]),
      statistics: (['chisq', 'phi', 'cc', 'risk'] as const).filter((k) => st.v[k]),
      barchart: bool(st.v.barchart),
      suppressTables: bool(st.v.suppress),
    },
  ],
  help: 'Crosstabs forms two-way contingency tables. Statistics… adds Pearson chi-square, likelihood ratio, Fisher’s exact test (2×2), linear-by-linear association, phi, Cramér’s V, the contingency coefficient and risk estimates. Cells… adds expected counts, percentages and residuals.',
}

// ------------------------------------------------------------------------- compare means

export const means: DialogDef = {
  id: 'means',
  title: 'Means',
  targets: [
    { key: 'deps', label: 'Dependent List:', rows: 5, accept: isNumeric },
    { key: 'indeps', label: 'Independent List:', rows: 4 },
  ],
  subs: [
    {
      key: 'options',
      label: 'Options…',
      title: 'Means: Options',
      width: 460,
      controls: [
        group(
          'Cell Statistics',
          [
            chk('mean', 'Mean'),
            chk('count', 'Number of cases'),
            chk('stddev', 'Standard deviation'),
            chk('median', 'Median'),
            chk('sum', 'Sum'),
            chk('min', 'Minimum'),
            chk('max', 'Maximum'),
            chk('range', 'Range'),
            chk('variance', 'Variance'),
            chk('semean', 'Standard error of mean'),
          ],
          2,
        ),
        group('Statistics for First Layer', [chk('anova', 'Anova table and eta')]),
      ],
    },
  ],
  defaults: () => ({ lists: { deps: [], indeps: [] }, v: { mean: true, count: true, stddev: true, anova: false } }),
  validate: (st) => need(st, 'deps', 1, 'dependent variable'),
  build: (st) => [
    {
      proc: 'means',
      dependents: st.lists.deps,
      independents: st.lists.indeps,
      cells: (['mean', 'count', 'stddev', 'median', 'sum', 'min', 'max', 'range', 'variance', 'semean'] as const).filter((k) => st.v[k]),
      anova: bool(st.v.anova),
    },
  ],
  help: 'Means computes subgroup means and related statistics of dependent variables within categories of independent variables, optionally with a one-way ANOVA table and eta.',
}

const T_OPTIONS = {
  key: 'options',
  label: 'Options…',
  title: 'Options',
  controls: [{ type: 'number', key: 'ci', label: 'Confidence Interval Percentage:', min: 1, max: 99.99, width: 70 } as Control, MISSING_RADIO()],
  validate: (st: DState) => (num(st.v.ci, 0) > 0 && num(st.v.ci, 0) < 100 ? null : 'The confidence level must be between 0 and 100.'),
}

export const oneSampleT: DialogDef = {
  id: 'ttest-one',
  title: 'One-Sample T Test',
  sourceFilter: isNumeric,
  targets: [{ key: 'vars', label: 'Test Variable(s):', rows: 8 }],
  bottom: [{ type: 'number', key: 'testValue', label: 'Test Value:', width: 100 }],
  subs: [T_OPTIONS],
  defaults: () => ({ lists: { vars: [] }, v: { testValue: 0, ci: 95, missing: 'analysis' } }),
  validate: (st) => need(st, 'vars') ?? (st.v.testValue === '' ? 'Enter a test value.' : null),
  build: (st) => [{ proc: 'ttest-one', variables: st.lists.vars, testValue: num(st.v.testValue, 0), ci: num(st.v.ci, 95), missing: st.v.missing as 'analysis' }],
  help: 'Tests whether the mean of each variable differs from a specified test value. Output includes the t statistic, one- and two-sided p values, the mean difference with its confidence interval, and Cohen’s d.',
}

function groupDefText(st: DState): string {
  if (st.v.groupMode === 'cut') return st.v.cut === '' ? 'Groups not defined' : `Cut point: ${st.v.cut}`
  return st.v.g1 === '' || st.v.g2 === '' ? 'Groups not defined (? ?)' : `Groups: ${st.v.g1} and ${st.v.g2}`
}

export const independentT: DialogDef = {
  id: 'ttest-ind',
  title: 'Independent-Samples T Test',
  targets: [
    { key: 'vars', label: 'Test Variable(s):', rows: 6, accept: isNumeric },
    {
      key: 'group',
      label: 'Grouping Variable:',
      max: 1,
      after: (ctx) => (
        <div className="row" style={{ gap: 8 }}>
          <DefineButton ctx={ctx} sub="groups" text="Define Groups…" />
          <span className="muted small">{groupDefText(ctx.st)}</span>
        </div>
      ),
    },
  ],
  subs: [
    {
      key: 'groups',
      label: 'Define Groups…',
      side: false,
      title: 'Define Groups',
      width: 340,
      controls: [
        {
          type: 'radio',
          key: 'groupMode',
          options: [
            { value: 'values', label: 'Use specified values' },
            { value: 'cut', label: 'Cut point' },
          ],
        },
        { type: 'text', key: 'g1', label: 'Group 1:', width: 100, disabled: (st) => st.v.groupMode !== 'values' },
        { type: 'text', key: 'g2', label: 'Group 2:', width: 100, disabled: (st) => st.v.groupMode !== 'values' },
        { type: 'number', key: 'cut', label: 'Cut point:', width: 100, disabled: (st) => st.v.groupMode !== 'cut' },
      ],
    },
    T_OPTIONS,
  ],
  defaults: () => ({ lists: { vars: [], group: [] }, v: { groupMode: 'values', g1: '', g2: '', cut: '', ci: 95, missing: 'analysis' } }),
  validate: (st) => {
    const e = need(st, 'vars', 1, 'test variable') ?? need(st, 'group', 1, 'grouping variable')
    if (e) return e
    if (st.v.groupMode === 'cut') return st.v.cut === '' ? 'Define the groups (Define Groups…).' : null
    if (st.v.g1 === '' || st.v.g2 === '') return 'Define the groups (Define Groups…).'
    return null
  },
  build: (st, ds) => {
    const g = getVar(ds, st.lists.group[0])!
    const conv = (x: unknown) => (g.type === 'numeric' ? Number(x) : String(x))
    if (g.type === 'numeric' && st.v.groupMode === 'values' && (Number.isNaN(Number(st.v.g1)) || Number.isNaN(Number(st.v.g2))))
      throw new Error('Group values must be numbers for a numeric grouping variable.')
    return [
      {
        proc: 'ttest-ind',
        variables: st.lists.vars,
        group: g.name,
        groupDef: st.v.groupMode === 'cut' ? { kind: 'cut', cut: num(st.v.cut, 0) } : { kind: 'values', g1: conv(st.v.g1), g2: conv(st.v.g2) },
        ci: num(st.v.ci, 95),
        missing: st.v.missing as 'analysis',
      },
    ]
  },
  help: 'Compares the means of two groups. Choose a grouping variable and use Define Groups… to give the two group values (or a cut point). Output includes Levene’s test for equality of variances, t tests with and without the equal-variance assumption, and effect sizes.',
}

export const pairedT: DialogDef = {
  id: 'ttest-paired',
  title: 'Paired-Samples T Test',
  sourceFilter: isNumeric,
  targets: [{ key: 'pairs', label: 'Paired Variables:', kind: 'pairs', rows: 8 }],
  bottom: [{ type: 'note', text: 'Select two variables and click the arrow to add a pair (Variable2 − Variable1 differences are tested).' }],
  subs: [T_OPTIONS],
  defaults: () => ({ lists: { pairs: [] }, v: { ci: 95, missing: 'analysis' } }),
  validate: (st) => (st.lists.pairs.some((p) => !p.endsWith('|') && !p.startsWith('|')) ? null : 'Add at least one complete pair.'),
  build: (st) => [
    {
      proc: 'ttest-paired',
      pairs: st.lists.pairs.map((p) => p.split('|') as [string, string]).filter(([a, b]) => a && b),
      ci: num(st.v.ci, 95),
      missing: st.v.missing as 'analysis',
    },
  ],
  help: 'Compares the means of two related variables (for example before and after). Output includes the pair correlation, the mean difference with its confidence interval, the t test and Cohen’s d.',
}

const POSTHOC: [PostHoc, string][] = [
  ['lsd', 'LSD'],
  ['bonferroni', 'Bonferroni'],
  ['sidak', 'Sidak'],
  ['scheffe', 'Scheffe'],
  ['tukey', 'Tukey'],
  ['gh', 'Games-Howell'],
]

export const oneway: DialogDef = {
  id: 'oneway',
  title: 'One-Way ANOVA',
  targets: [
    { key: 'deps', label: 'Dependent List:', rows: 6, accept: isNumeric },
    { key: 'factor', label: 'Factor:', max: 1 },
  ],
  subs: [
    {
      key: 'posthoc',
      label: 'Post Hoc…',
      title: 'One-Way ANOVA: Post Hoc Multiple Comparisons',
      width: 500,
      controls: [
        group('Equal Variances Assumed', POSTHOC.slice(0, 5).map(([k, l]) => chk(k, l)), 3),
        group('Equal Variances Not Assumed', [chk('gh', 'Games-Howell')]),
        { type: 'number', key: 'alpha', label: 'Significance level:', min: 0.0001, max: 0.5, step: 0.01, width: 80 },
      ],
      validate: (st) => (num(st.v.alpha, 0) > 0 && num(st.v.alpha, 0) < 1 ? null : 'The significance level must be between 0 and 1.'),
    },
    {
      key: 'options',
      label: 'Options…',
      title: 'One-Way ANOVA: Options',
      controls: [
        group('Statistics', [
          chk('descriptives', 'Descriptive'),
          chk('homogeneity', 'Homogeneity of variance test'),
          chk('brownForsythe', 'Brown-Forsythe'),
          chk('welch', 'Welch'),
        ]),
        chk('meansPlot', 'Means plot'),
        MISSING_RADIO(),
      ],
    },
  ],
  defaults: () => ({ lists: { deps: [], factor: [] }, v: { alpha: 0.05, descriptives: false, homogeneity: false, brownForsythe: false, welch: false, meansPlot: false, missing: 'analysis' } }),
  validate: (st) => need(st, 'deps', 1, 'dependent variable') ?? need(st, 'factor', 1, 'factor'),
  build: (st) => [
    {
      proc: 'oneway',
      dependents: st.lists.deps,
      factor: st.lists.factor[0],
      descriptives: bool(st.v.descriptives),
      homogeneity: bool(st.v.homogeneity),
      welch: bool(st.v.welch),
      brownForsythe: bool(st.v.brownForsythe),
      meansPlot: bool(st.v.meansPlot),
      posthoc: POSTHOC.filter(([k]) => st.v[k]).map(([k]) => k),
      alpha: num(st.v.alpha, 0.05),
      missing: st.v.missing as 'analysis',
    },
  ],
  help: 'One-way analysis of variance for one factor. Options… adds descriptives, Levene’s homogeneity test, the Welch and Brown-Forsythe robust tests and a means plot; Post Hoc… adds pairwise comparisons (LSD, Bonferroni, Sidak, Scheffe, Tukey HSD, Games-Howell).',
}

// ------------------------------------------------------------------------- correlate / regression / scale

export const bivariate: DialogDef = {
  id: 'correlations',
  title: 'Bivariate Correlations',
  sourceFilter: isNumeric,
  targets: [{ key: 'vars', label: 'Variables:', rows: 8 }],
  bottom: [
    group('Correlation Coefficients', [{ type: 'row', children: [chk('pearson', 'Pearson'), chk('kendall', "Kendall's tau-b"), chk('spearman', 'Spearman')] }]),
    group('Test of Significance', [
      {
        type: 'radio',
        key: 'tails',
        inline: true,
        options: [
          { value: '2', label: 'Two-tailed' },
          { value: '1', label: 'One-tailed' },
        ],
      },
    ]),
    chk('flag', 'Flag significant correlations'),
  ],
  subs: [
    {
      key: 'options',
      label: 'Options…',
      title: 'Bivariate Correlations: Options',
      controls: [
        group('Statistics', [chk('descriptives', 'Means and standard deviations')]),
        group('Missing Values', [
          {
            type: 'radio',
            key: 'missing',
            options: [
              { value: 'pairwise', label: 'Exclude cases pairwise' },
              { value: 'listwise', label: 'Exclude cases listwise' },
            ],
          },
        ]),
      ],
    },
  ],
  defaults: () => ({ lists: { vars: [] }, v: { pearson: true, kendall: false, spearman: false, tails: '2', flag: true, descriptives: false, missing: 'pairwise' } }),
  validate: (st) => need(st, 'vars', 2) ?? (st.v.pearson || st.v.kendall || st.v.spearman ? null : 'Choose at least one correlation coefficient.'),
  build: (st) => {
    const out: CommandSpec[] = []
    const tails = st.v.tails === '1' ? 1 : 2
    if (st.v.pearson)
      out.push({ proc: 'correlations', variables: st.lists.vars, tails, flag: bool(st.v.flag), descriptives: bool(st.v.descriptives), missing: st.v.missing as 'pairwise' })
    if (st.v.kendall || st.v.spearman)
      out.push({ proc: 'nonparcorr', variables: st.lists.vars, kendall: bool(st.v.kendall), spearman: bool(st.v.spearman), tails, flag: bool(st.v.flag), missing: st.v.missing as 'pairwise' })
    return out
  },
  help: 'Computes Pearson’s r, Spearman’s rho and/or Kendall’s tau-b with significance levels. Significant coefficients are flagged with * (p < .05) and ** (p < .01).',
}

export const regression: DialogDef = {
  id: 'regression',
  title: 'Linear Regression',
  sourceFilter: isNumeric,
  targets: [
    { key: 'dep', label: 'Dependent:', max: 1 },
    { key: 'indeps', label: 'Independent(s):', rows: 6 },
  ],
  controls: [
    {
      type: 'select',
      key: 'method',
      label: 'Method:',
      options: [
        { value: 'enter', label: 'Enter' },
        { value: 'stepwise', label: 'Stepwise' },
        { value: 'forward', label: 'Forward' },
        { value: 'backward', label: 'Backward' },
      ],
    },
  ],
  subs: [
    {
      key: 'stats',
      label: 'Statistics…',
      title: 'Linear Regression: Statistics',
      width: 480,
      controls: [
        {
          type: 'row',
          children: [
            group('Regression Coefficients', [
              chk('coeff', 'Estimates'),
              chk('ci', 'Confidence intervals'),
              { type: 'number', key: 'ciLevel', label: 'Level (%):', min: 1, max: 99.99, width: 64, disabled: (st) => !st.v.ci },
            ]),
            {
              type: 'custom',
              render: (ctx) => (
                <div className="col">
                  {(
                    [
                      ['r', 'Model fit'],
                      ['change', 'R squared change'],
                      ['descriptives', 'Descriptives'],
                      ['zpp', 'Part and partial correlations'],
                      ['collin', 'Collinearity diagnostics'],
                    ] as const
                  ).map(([k, l]) => (
                    <label key={k} className="check">
                      <input type="checkbox" checked={!!ctx.st.v[k]} onChange={(e) => ctx.set({ [k]: e.target.checked })} />
                      <span>{l}</span>
                    </label>
                  ))}
                </div>
              ),
            },
          ],
        },
        group('Residuals', [chk('durbin', 'Durbin-Watson')]),
      ],
    },
    {
      key: 'plots',
      label: 'Plots…',
      title: 'Linear Regression: Plots',
      controls: [
        chk('scatter', 'Scatterplot of *ZRESID against *ZPRED'),
        group('Standardized Residual Plots', [chk('histogram', 'Histogram'), chk('normprob', 'Normal probability plot')]),
      ],
    },
    {
      key: 'save',
      label: 'Save…',
      title: 'Linear Regression: Save',
      controls: [
        group('Predicted Values', [chk('pred', 'Unstandardized'), chk('zpred', 'Standardized')]),
        group('Residuals', [chk('resid', 'Unstandardized'), chk('zresid', 'Standardized')]),
      ],
    },
    {
      key: 'options',
      label: 'Options…',
      title: 'Linear Regression: Options',
      controls: [
        group('Stepping Method Criteria (use probability of F)', [
          { type: 'number', key: 'pin', label: 'Entry:', min: 0.0001, max: 0.99, step: 0.01, width: 70 },
          { type: 'number', key: 'pout', label: 'Removal:', min: 0.0001, max: 0.99, step: 0.01, width: 70 },
        ]),
      ],
      validate: (st) => (num(st.v.pin, 0) < num(st.v.pout, 0) ? null : 'Entry must be less than Removal.'),
    },
  ],
  defaults: () => ({
    lists: { dep: [], indeps: [] },
    v: {
      method: 'enter',
      coeff: true,
      ci: false,
      ciLevel: 95,
      r: true,
      change: false,
      descriptives: false,
      zpp: false,
      collin: false,
      durbin: false,
      scatter: false,
      histogram: false,
      normprob: false,
      pred: false,
      zpred: false,
      resid: false,
      zresid: false,
      pin: 0.05,
      pout: 0.1,
    },
  }),
  validate: (st) => need(st, 'dep', 1, 'dependent variable') ?? need(st, 'indeps', 1, 'independent variable'),
  build: (st) => [
    {
      proc: 'regression',
      dependent: st.lists.dep[0],
      independents: st.lists.indeps,
      method: st.v.method as 'enter',
      pin: num(st.v.pin, 0.05),
      pout: num(st.v.pout, 0.1),
      statistics: {
        coeff: bool(st.v.coeff),
        ci: bool(st.v.ci),
        ciLevel: num(st.v.ciLevel, 95),
        r: bool(st.v.r),
        anova: bool(st.v.r),
        change: bool(st.v.change),
        descriptives: bool(st.v.descriptives),
        zpp: bool(st.v.zpp),
        collin: bool(st.v.collin),
        durbin: bool(st.v.durbin),
      },
      plots: { histogram: bool(st.v.histogram), normprob: bool(st.v.normprob), scatter: bool(st.v.scatter) },
      save: { pred: bool(st.v.pred), zpred: bool(st.v.zpred), resid: bool(st.v.resid), zresid: bool(st.v.zresid) },
      constant: true,
    },
  ],
  help: 'Ordinary least squares regression with Enter, Stepwise, Forward or Backward variable selection. Statistics… adds confidence intervals, R² change, part/partial correlations, collinearity diagnostics (tolerance, VIF, condition indices) and Durbin-Watson; Plots… adds residual histograms, normal P-P plots and ZRESID×ZPRED scatterplots; Save… writes predicted values and residuals to the dataset.',
}

export const reliability: DialogDef = {
  id: 'reliability',
  title: 'Reliability Analysis',
  sourceFilter: isNumeric,
  targets: [{ key: 'items', label: 'Items:', rows: 9 }],
  bottom: [
    {
      type: 'row',
      children: [
        {
          type: 'select',
          key: 'model',
          label: 'Model:',
          options: [
            { value: 'alpha', label: 'Alpha' },
            { value: 'split', label: 'Split-half' },
          ],
        },
        { type: 'text', key: 'scaleName', label: 'Scale label:', width: 200 },
      ],
    },
  ],
  subs: [
    {
      key: 'stats',
      label: 'Statistics…',
      title: 'Reliability Analysis: Statistics',
      controls: [
        group('Descriptives for', [chk('itemDescriptives', 'Item'), chk('scaleDescriptives', 'Scale'), chk('itemTotal', 'Scale if item deleted')]),
        group('Inter-Item', [chk('interItemCorr', 'Correlations')]),
      ],
    },
  ],
  defaults: () => ({ lists: { items: [] }, v: { model: 'alpha', scaleName: '', itemDescriptives: false, scaleDescriptives: false, itemTotal: false, interItemCorr: false } }),
  validate: (st) => need(st, 'items', 2, 'item'),
  build: (st) => [
    {
      proc: 'reliability',
      variables: st.lists.items,
      scaleName: String(st.v.scaleName || 'ALL VARIABLES'),
      model: st.v.model as 'alpha',
      itemDescriptives: bool(st.v.itemDescriptives),
      scaleDescriptives: bool(st.v.scaleDescriptives),
      itemTotal: bool(st.v.itemTotal),
      interItemCorr: bool(st.v.interItemCorr),
    },
  ],
  help: 'Computes Cronbach’s alpha (or split-half reliability) for a set of scale items. Statistics… ▸ Scale if item deleted shows corrected item-total correlations and alpha if each item were removed — the usual item validity check.',
}

// ------------------------------------------------------------------------- nonparametric (legacy)

export const nparChiSquare: DialogDef = {
  id: 'npar-chisquare',
  title: 'Chi-square Test',
  sourceFilter: isNumeric,
  targets: [{ key: 'vars', label: 'Test Variable List:', rows: 6 }],
  bottom: [
    {
      type: 'row',
      children: [
        group('Expected Range', [
          {
            type: 'radio',
            key: 'rangeMode',
            options: [
              { value: 'data', label: 'Get from data' },
              { value: 'range', label: 'Use specified range' },
            ],
          },
          { type: 'number', key: 'lower', label: 'Lower:', width: 70, disabled: (st) => st.v.rangeMode !== 'range' },
          { type: 'number', key: 'upper', label: 'Upper:', width: 70, disabled: (st) => st.v.rangeMode !== 'range' },
        ]),
        group('Expected Values', [
          {
            type: 'radio',
            key: 'expMode',
            options: [
              { value: 'equal', label: 'All categories equal' },
              { value: 'values', label: 'Values:' },
            ],
          },
          { type: 'text', key: 'expValues', label: '', placeholder: 'e.g. 1 2 1', width: 140, disabled: (st) => st.v.expMode !== 'values' },
        ]),
      ],
    },
  ],
  defaults: () => ({ lists: { vars: [] }, v: { rangeMode: 'data', lower: '', upper: '', expMode: 'equal', expValues: '' } }),
  validate: (st) => {
    const e = need(st, 'vars')
    if (e) return e
    if (st.v.rangeMode === 'range' && (st.v.lower === '' || st.v.upper === '' || num(st.v.lower, 0) >= num(st.v.upper, 0))) return 'Enter a valid range (Lower < Upper).'
    if (st.v.expMode === 'values' && parseList(st.v.expValues).length < 2) return 'Enter at least two expected values.'
    return null
  },
  build: (st) => [
    {
      proc: 'npar-chisquare',
      variables: st.lists.vars,
      expected: st.v.expMode === 'values' ? parseList(st.v.expValues) : 'equal',
      range: st.v.rangeMode === 'range' ? [num(st.v.lower, 0), num(st.v.upper, 0)] : null,
    },
  ],
  help: 'Chi-square goodness-of-fit test: compares observed category frequencies with expected frequencies (all equal, or proportional to the values you enter, in ascending category order).',
}

export const nparKS: DialogDef = {
  id: 'npar-ks',
  title: 'One-Sample Kolmogorov-Smirnov Test',
  sourceFilter: isNumeric,
  targets: [{ key: 'vars', label: 'Test Variable List:', rows: 8 }],
  bottom: [{ type: 'note', text: 'Test distribution: Normal (mean and standard deviation estimated from the data; Lilliefors significance correction).' }],
  defaults: () => ({ lists: { vars: [] }, v: {} }),
  validate: (st) => need(st, 'vars'),
  build: (st) => [{ proc: 'npar-ks', variables: st.lists.vars }],
  help: 'Tests whether each variable comes from a normal distribution, using the Kolmogorov-Smirnov statistic with the Lilliefors significance correction (as in recent SPSS versions). Commonly run on regression residuals.',
}

export const nparMW: DialogDef = {
  id: 'npar-mw',
  title: 'Two-Independent-Samples Tests',
  sourceFilter: isNumeric,
  targets: [
    { key: 'vars', label: 'Test Variable List:', rows: 6 },
    {
      key: 'group',
      label: 'Grouping Variable:',
      max: 1,
      after: (ctx) => (
        <div className="row" style={{ gap: 8 }}>
          <DefineButton ctx={ctx} sub="groups" text="Define Groups…" />
          <span className="muted small">{ctx.st.v.g1 === '' || ctx.st.v.g2 === '' ? '(? ?)' : `(${ctx.st.v.g1} ${ctx.st.v.g2})`}</span>
        </div>
      ),
    },
  ],
  bottom: [{ type: 'note', text: 'Test Type: Mann-Whitney U' }],
  subs: [
    {
      key: 'groups',
      label: 'Define Groups…',
      side: false,
      title: 'Two Independent Samples: Define Groups',
      width: 320,
      controls: [
        { type: 'number', key: 'g1', label: 'Group 1:', width: 90 },
        { type: 'number', key: 'g2', label: 'Group 2:', width: 90 },
      ],
    },
  ],
  defaults: () => ({ lists: { vars: [], group: [] }, v: { g1: '', g2: '' } }),
  validate: (st) => need(st, 'vars') ?? need(st, 'group', 1, 'grouping variable') ?? (st.v.g1 === '' || st.v.g2 === '' ? 'Define the groups (Define Groups…).' : null),
  build: (st) => [{ proc: 'npar-mw', variables: st.lists.vars, group: st.lists.group[0], g1: num(st.v.g1, 1), g2: num(st.v.g2, 2) }],
  help: 'Mann-Whitney U test: a nonparametric alternative to the independent-samples t test. Reports mean ranks, U, Wilcoxon W, Z and the asymptotic (and, for small samples, exact) significance.',
}

export const nparKW: DialogDef = {
  id: 'npar-kw',
  title: 'Tests for Several Independent Samples',
  sourceFilter: isNumeric,
  targets: [
    { key: 'vars', label: 'Test Variable List:', rows: 6 },
    {
      key: 'group',
      label: 'Grouping Variable:',
      max: 1,
      after: (ctx) => (
        <div className="row" style={{ gap: 8 }}>
          <DefineButton ctx={ctx} sub="range" text="Define Range…" />
          <span className="muted small">{ctx.st.v.min === '' || ctx.st.v.max === '' ? '(? ?)' : `(${ctx.st.v.min} ${ctx.st.v.max})`}</span>
        </div>
      ),
    },
  ],
  bottom: [{ type: 'note', text: 'Test Type: Kruskal-Wallis H' }],
  subs: [
    {
      key: 'range',
      label: 'Define Range…',
      side: false,
      title: 'Several Independent Samples: Define Range',
      width: 320,
      controls: [
        { type: 'number', key: 'min', label: 'Minimum:', width: 90 },
        { type: 'number', key: 'max', label: 'Maximum:', width: 90 },
      ],
    },
  ],
  defaults: () => ({ lists: { vars: [], group: [] }, v: { min: '', max: '' } }),
  validate: (st) =>
    need(st, 'vars') ??
    need(st, 'group', 1, 'grouping variable') ??
    (st.v.min === '' || st.v.max === '' || num(st.v.min, 0) >= num(st.v.max, 0) ? 'Define the range of group values (Define Range…).' : null),
  build: (st) => [{ proc: 'npar-kw', variables: st.lists.vars, group: st.lists.group[0], min: num(st.v.min, 1), max: num(st.v.max, 2) }],
  help: 'Kruskal-Wallis H test: a nonparametric alternative to one-way ANOVA. Groups are the integer values of the grouping variable between Minimum and Maximum.',
}

export const nparWilcoxon: DialogDef = {
  id: 'npar-wilcoxon',
  title: 'Two-Related-Samples Tests',
  sourceFilter: isNumeric,
  targets: [{ key: 'pairs', label: 'Test Pairs:', kind: 'pairs', rows: 8 }],
  bottom: [{ type: 'note', text: 'Test Type: Wilcoxon signed-rank' }],
  defaults: () => ({ lists: { pairs: [] }, v: {} }),
  validate: (st) => (st.lists.pairs.some((p) => !p.endsWith('|') && !p.startsWith('|')) ? null : 'Add at least one complete pair.'),
  build: (st) => [{ proc: 'npar-wilcoxon', pairs: st.lists.pairs.map((p) => p.split('|') as [string, string]).filter(([a, b]) => a && b) }],
  help: 'Wilcoxon signed-rank test for two related samples: a nonparametric alternative to the paired-samples t test.',
}

export const nparFriedman: DialogDef = {
  id: 'npar-friedman',
  title: 'Tests for Several Related Samples',
  sourceFilter: isNumeric,
  targets: [{ key: 'vars', label: 'Test Variables:', rows: 8 }],
  bottom: [{ type: 'note', text: 'Test Type: Friedman' }],
  defaults: () => ({ lists: { vars: [] }, v: {} }),
  validate: (st) => need(st, 'vars', 2),
  build: (st) => [{ proc: 'npar-friedman', variables: st.lists.vars }],
  help: 'Friedman test for k related samples (for example repeated measurements): a nonparametric alternative to repeated-measures ANOVA.',
}

// ------------------------------------------------------------------------- graphs (legacy dialogs)

const SUMMARY: Control = group('Bars Represent', [
  {
    type: 'radio',
    key: 'summary',
    options: [
      { value: 'count', label: 'N of cases' },
      { value: 'pct', label: '% of cases' },
      { value: 'mean', label: 'Mean of variable' },
      { value: 'median', label: 'Median of variable' },
      { value: 'sum', label: 'Sum of variable' },
    ],
  },
])

function summaryOf(st: DState) {
  const k = st.v.summary as string
  if (k === 'count' || k === 'pct') return { kind: k } as const
  return { kind: k as 'mean', variable: st.lists.stat[0] }
}

export const graphBar: DialogDef = {
  id: 'graph-bar',
  title: 'Bar Chart',
  targets: [
    { key: 'stat', label: 'Variable (for mean, median or sum):', max: 1, accept: isNumeric },
    { key: 'category', label: 'Category Axis:', max: 1 },
    { key: 'cluster', label: 'Define Clusters by (optional):', max: 1 },
  ],
  bottom: [SUMMARY],
  defaults: () => ({ lists: { stat: [], category: [], cluster: [] }, v: { summary: 'count' } }),
  validate: (st) =>
    need(st, 'category', 1, 'category variable') ??
    (st.v.summary !== 'count' && st.v.summary !== 'pct' && !st.lists.stat.length ? 'Choose the variable to summarize.' : null),
  build: (st) => [{ proc: 'graph-bar', category: st.lists.category[0], cluster: st.lists.cluster[0] ?? null, summary: summaryOf(st) }],
  help: 'Simple or clustered bar charts of counts, percentages, or the mean/median/sum of a variable for each category. Add a cluster variable for a clustered chart.',
}

export const graphLine: DialogDef = {
  id: 'graph-line',
  title: 'Line Chart',
  targets: [
    { key: 'stat', label: 'Variable (for mean, median or sum):', max: 1, accept: isNumeric },
    { key: 'category', label: 'Category Axis:', max: 1 },
  ],
  bottom: [{ ...(SUMMARY as Extract<Control, { type: 'group' }>), label: 'Line Represents' }],
  defaults: () => ({ lists: { stat: [], category: [] }, v: { summary: 'mean' } }),
  validate: (st) =>
    need(st, 'category', 1, 'category variable') ??
    (st.v.summary !== 'count' && st.v.summary !== 'pct' && !st.lists.stat.length ? 'Choose the variable to summarize.' : null),
  build: (st) => [{ proc: 'graph-line', category: st.lists.category[0], summary: summaryOf(st) }],
  help: 'A simple line chart of a summary statistic across the categories of a variable.',
}

export const graphPie: DialogDef = {
  id: 'graph-pie',
  title: 'Pie Chart',
  targets: [{ key: 'category', label: 'Define Slices by:', max: 1 }],
  bottom: [{ type: 'note', text: 'Slices represent: N of cases' }],
  defaults: () => ({ lists: { category: [] }, v: {} }),
  validate: (st) => need(st, 'category'),
  build: (st) => [{ proc: 'graph-pie', category: st.lists.category[0] }],
  help: 'A pie chart of the number of cases in each category. Categories beyond eight are combined into “Other”.',
}

export const graphHistogram: DialogDef = {
  id: 'graph-histogram',
  title: 'Histogram',
  sourceFilter: isNumeric,
  targets: [{ key: 'var', label: 'Variable:', max: 1 }],
  bottom: [chk('normal', 'Display normal curve')],
  defaults: () => ({ lists: { var: [] }, v: { normal: false } }),
  validate: (st) => need(st, 'var'),
  build: (st) => [{ proc: 'graph-histogram', variable: st.lists.var[0], normal: bool(st.v.normal) }],
  help: 'A histogram of a scale variable, optionally with a fitted normal curve.',
}

export const graphScatter: DialogDef = {
  id: 'graph-scatter',
  title: 'Simple Scatterplot',
  targets: [
    { key: 'y', label: 'Y Axis:', max: 1, accept: isNumeric },
    { key: 'x', label: 'X Axis:', max: 1, accept: isNumeric },
    { key: 'group', label: 'Set Markers by (optional):', max: 1 },
  ],
  bottom: [chk('fit', 'Add a linear fit line (with R²)')],
  defaults: () => ({ lists: { y: [], x: [], group: [] }, v: { fit: false } }),
  validate: (st) => need(st, 'y', 1, 'Y variable') ?? need(st, 'x', 1, 'X variable'),
  build: (st) => [{ proc: 'graph-scatter', x: st.lists.x[0], y: st.lists.y[0], group: st.lists.group[0] ?? null, fitLine: bool(st.v.fit) }],
  help: 'A scatterplot of two scale variables. Set Markers by colours and shapes points by a grouping variable; the fit line shows the least-squares line and R².',
}

export const graphBox: DialogDef = {
  id: 'graph-box',
  title: 'Boxplot',
  targets: [
    { key: 'vars', label: 'Variable:', rows: 4, accept: isNumeric },
    { key: 'category', label: 'Category Axis (optional):', max: 1 },
  ],
  defaults: () => ({ lists: { vars: [], category: [] }, v: {} }),
  validate: (st) => need(st, 'vars'),
  build: (st) => [
    {
      proc: 'explore',
      dependents: st.lists.vars,
      factors: st.lists.category,
      display: 'plots',
      descriptives: false,
      percentiles: false,
      outliers: false,
      ci: 95,
      boxplot: st.lists.category.length ? 'factor' : 'dependents',
      stemleaf: false,
      histogram: false,
      normality: false,
      missing: 'listwise',
      noTotal: st.lists.category.length > 0,
    },
  ],
  help: 'Boxplots show the median, quartiles (Tukey’s hinges), whiskers, outliers (○, 1.5–3 box lengths) and extremes (*, more than 3 box lengths) labelled with case numbers.',
}

export const ANALYSIS_DIALOGS: DialogDef[] = [
  frequencies,
  descriptives,
  explore,
  crosstabs,
  means,
  oneSampleT,
  independentT,
  pairedT,
  oneway,
  bivariate,
  regression,
  reliability,
  nparChiSquare,
  nparKS,
  nparMW,
  nparKW,
  nparWilcoxon,
  nparFriedman,
  graphBar,
  graphLine,
  graphPie,
  graphHistogram,
  graphScatter,
  graphBox,
]

/** Used by tests: build specs from defaults plus some variables. */
export function buildFromDefaults(def: DialogDef, lists: Record<string, string[]>, ds: Dataset, v: Record<string, unknown> = {}): CommandSpec[] {
  const st = def.defaults()
  return def.build({ lists: { ...st.lists, ...lists }, v: { ...st.v, ...v } }, ds)
}
