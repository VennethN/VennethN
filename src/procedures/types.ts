// Command specifications. Dialogs build these, the syntax parser produces them, the generator turns
// them back into SPSS-style syntax and the engine executes them. Variables are referenced by name.

import type { Measure, MissingSpec, ValueLabel } from '../core/dataset'

export type FreqStat =
  | 'mean'
  | 'semean'
  | 'median'
  | 'mode'
  | 'sum'
  | 'stddev'
  | 'variance'
  | 'range'
  | 'minimum'
  | 'maximum'
  | 'skewness'
  | 'kurtosis'

export interface FrequenciesSpec {
  proc: 'frequencies'
  variables: string[]
  showTables: boolean
  statistics: FreqStat[]
  quartiles: boolean
  percentiles: number[]
  chart: 'none' | 'bar' | 'pie' | 'histogram'
  chartValues: 'freq' | 'percent'
  normalCurve: boolean
  order: 'avalue' | 'dvalue' | 'afreq' | 'dfreq'
}

export type DescStat = 'mean' | 'semean' | 'sum' | 'stddev' | 'variance' | 'range' | 'min' | 'max' | 'skewness' | 'kurtosis'

export interface DescriptivesSpec {
  proc: 'descriptives'
  variables: string[]
  statistics: DescStat[]
  saveZ: boolean
  sort: 'variable' | 'alpha' | 'mean-a' | 'mean-d'
}

export interface ExploreSpec {
  proc: 'explore'
  dependents: string[]
  factors: string[]
  display: 'both' | 'statistics' | 'plots'
  descriptives: boolean
  percentiles: boolean
  outliers: boolean
  ci: number
  boxplot: 'factor' | 'dependents' | 'none'
  stemleaf: boolean
  histogram: boolean
  normality: boolean
  missing: 'listwise' | 'pairwise'
  /** Hide the total (no-factor) analysis when factors are given (EXAMINE /NOTOTAL). */
  noTotal: boolean
}

export type CrossCell = 'count' | 'expected' | 'row' | 'column' | 'total' | 'resid' | 'sresid' | 'asresid'
export type CrossStat = 'chisq' | 'phi' | 'cc' | 'risk' | 'gamma' | 'btau' | 'ctau' | 'lambda' | 'corr' | 'kappa' | 'mcnemar'

export interface CrosstabsSpec {
  proc: 'crosstabs'
  rows: string[]
  columns: string[]
  cells: CrossCell[]
  statistics: CrossStat[]
  barchart: boolean
  suppressTables: boolean
}

export type MeansCell = 'mean' | 'count' | 'stddev' | 'sum' | 'min' | 'max' | 'median' | 'semean' | 'variance' | 'range'

export interface MeansSpec {
  proc: 'means'
  dependents: string[]
  independents: string[]
  cells: MeansCell[]
  anova: boolean
}

export interface OneSampleTSpec {
  proc: 'ttest-one'
  variables: string[]
  testValue: number
  ci: number
  missing: 'analysis' | 'listwise'
}

export type GroupDef = { kind: 'values'; g1: number | string; g2: number | string } | { kind: 'cut'; cut: number }

export interface IndependentTSpec {
  proc: 'ttest-ind'
  variables: string[]
  group: string
  groupDef: GroupDef
  ci: number
  missing: 'analysis' | 'listwise'
}

export interface PairedTSpec {
  proc: 'ttest-paired'
  pairs: [string, string][]
  ci: number
  missing: 'analysis' | 'listwise'
}

export type PostHoc = 'lsd' | 'bonferroni' | 'sidak' | 'scheffe' | 'tukey' | 'gh'

export interface OnewaySpec {
  proc: 'oneway'
  dependents: string[]
  factor: string
  descriptives: boolean
  homogeneity: boolean
  welch: boolean
  brownForsythe: boolean
  meansPlot: boolean
  posthoc: PostHoc[]
  alpha: number
  missing: 'analysis' | 'listwise'
}

export interface CorrelationsSpec {
  proc: 'correlations'
  variables: string[]
  tails: 1 | 2
  flag: boolean
  descriptives: boolean
  missing: 'pairwise' | 'listwise'
}

export interface NonparCorrSpec {
  proc: 'nonparcorr'
  variables: string[]
  kendall: boolean
  spearman: boolean
  tails: 1 | 2
  flag: boolean
  missing: 'pairwise' | 'listwise'
}

export interface RegressionSpec {
  proc: 'regression'
  dependent: string
  independents: string[]
  method: 'enter' | 'stepwise' | 'forward' | 'backward'
  pin: number
  pout: number
  statistics: {
    coeff: boolean
    ci: boolean
    ciLevel: number
    r: boolean
    anova: boolean
    change: boolean
    descriptives: boolean
    zpp: boolean
    collin: boolean
    durbin: boolean
  }
  plots: { histogram: boolean; normprob: boolean; scatter: boolean }
  save: { pred: boolean; zpred: boolean; resid: boolean; zresid: boolean }
  constant: boolean
}

export interface ReliabilitySpec {
  proc: 'reliability'
  variables: string[]
  scaleName: string
  model: 'alpha' | 'split'
  itemDescriptives: boolean
  scaleDescriptives: boolean
  itemTotal: boolean
  interItemCorr: boolean
}

export interface NparChiSquareSpec {
  proc: 'npar-chisquare'
  variables: string[]
  expected: 'equal' | number[]
  range: [number, number] | null
}

export interface NparTwoIndepSpec {
  proc: 'npar-mw'
  variables: string[]
  group: string
  g1: number
  g2: number
}

export interface NparKIndepSpec {
  proc: 'npar-kw'
  variables: string[]
  group: string
  min: number
  max: number
}

export interface NparWilcoxonSpec {
  proc: 'npar-wilcoxon'
  pairs: [string, string][]
}

export interface NparFriedmanSpec {
  proc: 'npar-friedman'
  variables: string[]
}

export interface NparKSSpec {
  proc: 'npar-ks'
  variables: string[]
}

export type BarSummary = { kind: 'count' } | { kind: 'pct' } | { kind: 'mean' | 'sum' | 'median'; variable: string }

export interface GraphBarSpec {
  proc: 'graph-bar'
  category: string
  cluster: string | null
  summary: BarSummary
}

export interface GraphPieSpec {
  proc: 'graph-pie'
  category: string
}

export interface GraphHistogramSpec {
  proc: 'graph-histogram'
  variable: string
  normal: boolean
}

export interface GraphScatterSpec {
  proc: 'graph-scatter'
  x: string
  y: string
  group: string | null
  fitLine: boolean
}

export interface GraphLineSpec {
  proc: 'graph-line'
  category: string
  summary: BarSummary
}

// ------------------------------------------------------------------------- data transformations

export type RecodeOld =
  | { kind: 'value'; value: number | string }
  | { kind: 'sysmis' }
  | { kind: 'missing' }
  | { kind: 'range'; low: number; high: number }
  | { kind: 'lowest'; high: number }
  | { kind: 'highest'; low: number }
  | { kind: 'else' }

export type RecodeNew = { kind: 'value'; value: number | string } | { kind: 'sysmis' } | { kind: 'copy' }

export interface RecodeRule {
  old: RecodeOld[]
  to: RecodeNew
}

export interface RecodeSpec {
  proc: 'recode'
  variables: string[]
  into: string[] | null
  rules: RecodeRule[]
  /** Create INTO variables as strings of this width. */
  intoString: number | null
}

export interface ComputeSpec {
  proc: 'compute'
  target: string
  expression: string
  condition: string | null
  /** For new string variables: STRING target (A8). */
  stringWidth: number | null
}

export interface SortSpec {
  proc: 'sort'
  keys: { variable: string; descending: boolean }[]
}

export interface SelectIfSpec {
  proc: 'select-if'
  condition: string
}

export interface FilterSpec {
  proc: 'filter'
  variable: string | null
}

export interface WeightSpec {
  proc: 'weight'
  variable: string | null
}

export interface SampleSpec {
  proc: 'sample'
  fraction: number | null
  count: { n: number; from: number } | null
  seed: number
}

export interface VariableLabelsSpec {
  proc: 'variable-labels'
  items: { variable: string; label: string }[]
}

export interface ValueLabelsSpec {
  proc: 'value-labels'
  variables: string[]
  labels: ValueLabel[]
  add: boolean
}

export interface MissingValuesSpec {
  proc: 'missing-values'
  variables: string[]
  missing: MissingSpec
}

export interface VariableLevelSpec {
  proc: 'variable-level'
  variables: string[]
  level: Measure
}

export interface FormatsSpec {
  proc: 'formats'
  variables: string[]
  width: number
  decimals: number
}

export interface StringDeclSpec {
  proc: 'string'
  variables: string[]
  width: number
}

export interface NumericDeclSpec {
  proc: 'numeric'
  variables: string[]
  decimals: number
}

export interface DeleteVariablesSpec {
  proc: 'delete-variables'
  variables: string[]
}

export interface RenameSpec {
  proc: 'rename'
  from: string[]
  to: string[]
}

export interface AutoRecodeSpec {
  proc: 'autorecode'
  variables: string[]
  into: string[]
  descending: boolean
}

export interface RankSpec {
  proc: 'rank'
  variables: string[]
  into: string[]
  descending: boolean
}

export interface ExecuteSpec {
  proc: 'execute'
}

export interface TitleSpec {
  proc: 'title'
  text: string
}

export interface UseAllSpec {
  proc: 'use-all'
}

export type AnalysisSpec =
  | FrequenciesSpec
  | DescriptivesSpec
  | ExploreSpec
  | CrosstabsSpec
  | MeansSpec
  | OneSampleTSpec
  | IndependentTSpec
  | PairedTSpec
  | OnewaySpec
  | CorrelationsSpec
  | NonparCorrSpec
  | RegressionSpec
  | ReliabilitySpec
  | NparChiSquareSpec
  | NparTwoIndepSpec
  | NparKIndepSpec
  | NparWilcoxonSpec
  | NparFriedmanSpec
  | NparKSSpec
  | GraphBarSpec
  | GraphPieSpec
  | GraphHistogramSpec
  | GraphScatterSpec
  | GraphLineSpec

export type TransformSpec =
  | RecodeSpec
  | ComputeSpec
  | SortSpec
  | SelectIfSpec
  | FilterSpec
  | WeightSpec
  | SampleSpec
  | VariableLabelsSpec
  | ValueLabelsSpec
  | MissingValuesSpec
  | VariableLevelSpec
  | FormatsSpec
  | StringDeclSpec
  | NumericDeclSpec
  | DeleteVariablesSpec
  | RenameSpec
  | AutoRecodeSpec
  | RankSpec
  | ExecuteSpec
  | TitleSpec
  | UseAllSpec

export type CommandSpec = AnalysisSpec | TransformSpec

export type ProcName = CommandSpec['proc']
