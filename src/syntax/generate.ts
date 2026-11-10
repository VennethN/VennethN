// Spec -> command syntax, in the style SPSS dialogs paste.

import type { MissingSpec, ValueLabel } from '../core/dataset'
import type { CommandSpec, RecodeNew, RecodeOld } from '../procedures/types'

export function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function num(x: number): string {
  if (Number.isInteger(x)) return String(x)
  const s = String(x)
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
}

function val(x: number | string): string {
  return typeof x === 'number' ? num(x) : quote(x)
}

function cmd(head: string, subs: (string | false | null | undefined)[]): string {
  const lines = [head, ...subs.filter((s): s is string => !!s).map((s) => `  /${s}`)]
  return lines.join('\n') + '.'
}

function list(names: string[]): string {
  return names.join(' ')
}

function recodeOld(o: RecodeOld): string {
  switch (o.kind) {
    case 'value':
      return val(o.value)
    case 'sysmis':
      return 'SYSMIS'
    case 'missing':
      return 'MISSING'
    case 'range':
      return `${num(o.low)} thru ${num(o.high)}`
    case 'lowest':
      return `Lowest thru ${num(o.high)}`
    case 'highest':
      return `${num(o.low)} thru Highest`
    case 'else':
      return 'ELSE'
  }
}

function recodeNew(n: RecodeNew): string {
  return n.kind === 'copy' ? 'COPY' : n.kind === 'sysmis' ? 'SYSMIS' : val(n.value)
}

export function missingSpecText(m: MissingSpec): string {
  if (m.kind === 'none') return '()'
  if (m.kind === 'discrete') return `(${m.values.map(val).join(', ')})`
  return `(${num(m.low)} THRU ${num(m.high)}${m.value !== undefined ? `, ${num(m.value)}` : ''})`
}

export function valueLabelsText(labels: ValueLabel[]): string {
  return labels.map((l) => `${val(l.value)} ${quote(l.label)}`).join(' ')
}

export function generateSyntax(spec: CommandSpec): string {
  switch (spec.proc) {
    case 'frequencies': {
      const statMap: Record<string, string[]> = {
        stddev: ['STDDEV'],
        variance: ['VARIANCE'],
        range: ['RANGE'],
        minimum: ['MINIMUM'],
        maximum: ['MAXIMUM'],
        semean: ['SEMEAN'],
        mean: ['MEAN'],
        median: ['MEDIAN'],
        mode: ['MODE'],
        sum: ['SUM'],
        skewness: ['SKEWNESS', 'SESKEW'],
        kurtosis: ['KURTOSIS', 'SEKURT'],
      }
      const order = ['stddev', 'variance', 'range', 'minimum', 'maximum', 'semean', 'mean', 'median', 'mode', 'sum', 'skewness', 'kurtosis']
      const stats = order.filter((s) => spec.statistics.includes(s as never)).flatMap((s) => statMap[s])
      const chart =
        spec.chart === 'bar'
          ? `BARCHART ${spec.chartValues === 'percent' ? 'PERCENT' : 'FREQ'}`
          : spec.chart === 'pie'
            ? `PIECHART ${spec.chartValues === 'percent' ? 'PERCENT' : 'FREQ'}`
            : spec.chart === 'histogram'
              ? `HISTOGRAM${spec.normalCurve ? ' NORMAL' : ''}`
              : null
      const fmt = !spec.showTables ? 'FORMAT=NOTABLE' : spec.order !== 'avalue' ? `FORMAT=${spec.order.toUpperCase()}` : null
      return cmd(`FREQUENCIES VARIABLES=${list(spec.variables)}`, [
        fmt,
        spec.quartiles && 'NTILES=4',
        spec.percentiles.length > 0 && `PERCENTILES=${spec.percentiles.map((p) => p.toFixed(1)).join(' ')}`,
        stats.length > 0 && `STATISTICS=${stats.join(' ')}`,
        chart,
        'ORDER=ANALYSIS',
      ])
    }
    case 'descriptives': {
      const order = ['mean', 'sum', 'stddev', 'variance', 'range', 'min', 'max', 'semean', 'kurtosis', 'skewness']
      const stats = order.filter((s) => spec.statistics.includes(s as never)).map((s) => s.toUpperCase())
      const sort = spec.sort === 'alpha' ? 'SORT=NAME (A)' : spec.sort === 'mean-a' ? 'SORT=MEAN (A)' : spec.sort === 'mean-d' ? 'SORT=MEAN (D)' : null
      return cmd(`DESCRIPTIVES VARIABLES=${list(spec.variables)}`, [spec.saveZ && 'SAVE', `STATISTICS=${stats.join(' ')}`, sort])
    }
    case 'explore': {
      const plots: string[] = []
      if (spec.display !== 'statistics') {
        if (spec.boxplot !== 'none') plots.push('BOXPLOT')
        if (spec.stemleaf) plots.push('STEMLEAF')
        if (spec.histogram) plots.push('HISTOGRAM')
        if (spec.normality) plots.push('NPPLOT')
      }
      const stats: string[] = []
      if (spec.display !== 'plots') {
        if (spec.descriptives) stats.push('DESCRIPTIVES')
        if (spec.outliers) stats.push('EXTREME')
      }
      return cmd(`EXAMINE VARIABLES=${list(spec.dependents)}${spec.factors.length ? ` BY ${list(spec.factors)}` : ''}`, [
        spec.display !== 'statistics' ? `PLOT ${plots.length ? plots.join(' ') : 'NONE'}` : 'PLOT NONE',
        spec.boxplot === 'dependents' ? 'COMPARE VARIABLES' : 'COMPARE GROUPS',
        spec.display !== 'plots' && spec.percentiles && 'PERCENTILES(5,10,25,50,75,90,95) HAVERAGE',
        spec.display !== 'plots' ? `STATISTICS ${stats.length ? stats.join(' ') : 'NONE'}` : 'STATISTICS NONE',
        `CINTERVAL ${num(spec.ci)}`,
        `MISSING ${spec.missing === 'listwise' ? 'LISTWISE' : 'PAIRWISE'}`,
        spec.noTotal ? 'NOTOTAL' : null,
      ])
    }
    case 'crosstabs':
      return cmd('CROSSTABS', [
        `TABLES=${list(spec.rows)} BY ${list(spec.columns)}`,
        `FORMAT=AVALUE ${spec.suppressTables ? 'NOTABLES' : 'TABLES'}`,
        spec.statistics.length > 0 && `STATISTICS=${spec.statistics.map((s) => s.toUpperCase()).join(' ')}`,
        `CELLS=${(spec.cells.length ? spec.cells : ['count']).map((c) => c.toUpperCase()).join(' ')}`,
        'COUNT ROUND CELL',
        spec.barchart && 'BARCHART',
      ])
    case 'means':
      return cmd(`MEANS TABLES=${list(spec.dependents)}${spec.independents.length ? ` BY ${list(spec.independents)}` : ''}`, [
        `CELLS=${spec.cells.map((c) => (c === 'min' ? 'MIN' : c === 'max' ? 'MAX' : c === 'variance' ? 'VAR' : c.toUpperCase())).join(' ')}`,
        spec.anova && 'STATISTICS ANOVA',
      ])
    case 'ttest-one':
      return cmd('T-TEST', [
        `TESTVAL=${num(spec.testValue)}`,
        `MISSING=${spec.missing === 'listwise' ? 'LISTWISE' : 'ANALYSIS'}`,
        `VARIABLES=${list(spec.variables)}`,
        'ES DISPLAY(TRUE)',
        `CRITERIA=CI(${num(spec.ci / 100)})`,
      ])
    case 'ttest-ind': {
      const g = spec.groupDef.kind === 'cut' ? `(${num(spec.groupDef.cut)})` : `(${val(spec.groupDef.g1)} ${val(spec.groupDef.g2)})`
      return cmd(`T-TEST GROUPS=${spec.group}${g}`, [
        `MISSING=${spec.missing === 'listwise' ? 'LISTWISE' : 'ANALYSIS'}`,
        `VARIABLES=${list(spec.variables)}`,
        'ES DISPLAY(TRUE)',
        `CRITERIA=CI(${num(spec.ci / 100)})`,
      ])
    }
    case 'ttest-paired':
      return cmd(`T-TEST PAIRS=${list(spec.pairs.map((p) => p[0]))} WITH ${list(spec.pairs.map((p) => p[1]))} (PAIRED)`, [
        'ES DISPLAY(TRUE) STANDARDIZER(SD)',
        `CRITERIA=CI(${num(spec.ci / 100)})`,
        `MISSING=${spec.missing === 'listwise' ? 'LISTWISE' : 'ANALYSIS'}`,
      ])
    case 'oneway': {
      const stats = [
        spec.descriptives && 'DESCRIPTIVES',
        spec.homogeneity && 'HOMOGENEITY',
        spec.brownForsythe && 'BROWNFORSYTHE',
        spec.welch && 'WELCH',
      ].filter(Boolean)
      return cmd(`ONEWAY ${list(spec.dependents)} BY ${spec.factor}`, [
        'ES=OVERALL',
        stats.length > 0 && `STATISTICS ${stats.join(' ')}`,
        spec.meansPlot && 'PLOT MEANS',
        `MISSING ${spec.missing === 'listwise' ? 'LISTWISE' : 'ANALYSIS'}`,
        'CRITERIA=CILEVEL(0.95)',
        spec.posthoc.length > 0 && `POSTHOC=${spec.posthoc.map((p) => p.toUpperCase()).join(' ')} ALPHA(${num(spec.alpha)})`,
      ])
    }
    case 'correlations':
      return cmd('CORRELATIONS', [
        `VARIABLES=${list(spec.variables)}`,
        `PRINT=${spec.tails === 2 ? 'TWOTAIL' : 'ONETAIL'} ${spec.flag ? 'NOSIG' : 'SIG'} FULL`,
        spec.descriptives && 'STATISTICS DESCRIPTIVES',
        `MISSING=${spec.missing === 'listwise' ? 'LISTWISE' : 'PAIRWISE'}`,
      ])
    case 'nonparcorr': {
      const which = spec.kendall && spec.spearman ? 'BOTH' : spec.kendall ? 'KENDALL' : 'SPEARMAN'
      return cmd('NONPAR CORR', [
        `VARIABLES=${list(spec.variables)}`,
        `PRINT=${which} ${spec.tails === 2 ? 'TWOTAIL' : 'ONETAIL'} ${spec.flag ? 'NOSIG' : 'SIG'} FULL`,
        `MISSING=${spec.missing === 'listwise' ? 'LISTWISE' : 'PAIRWISE'}`,
      ])
    }
    case 'regression': {
      const st = spec.statistics
      const stats = [
        st.coeff && 'COEFF',
        'OUTS',
        st.ci && `CI(${num(st.ciLevel)})`,
        st.r && 'R',
        st.anova && 'ANOVA',
        st.collin && 'COLLIN',
        st.collin && 'TOL',
        st.change && 'CHANGE',
        st.zpp && 'ZPP',
      ].filter(Boolean)
      const resid = [
        st.durbin && 'DURBIN',
        spec.plots.histogram && 'HISTOGRAM(ZRESID)',
        spec.plots.normprob && 'NORMPROB(ZRESID)',
      ].filter(Boolean)
      const save = [spec.save.pred && 'PRED', spec.save.zpred && 'ZPRED', spec.save.resid && 'RESID', spec.save.zresid && 'ZRESID'].filter(Boolean)
      return cmd('REGRESSION', [
        st.descriptives && 'DESCRIPTIVES MEAN STDDEV CORR SIG N',
        'MISSING LISTWISE',
        `STATISTICS ${stats.join(' ')}`,
        `CRITERIA=PIN(${num(spec.pin)}) POUT(${num(spec.pout)})`,
        spec.constant ? 'NOORIGIN' : 'ORIGIN',
        `DEPENDENT ${spec.dependent}`,
        `METHOD=${spec.method.toUpperCase()} ${list(spec.independents)}`,
        spec.plots.scatter && 'SCATTERPLOT=(*ZRESID ,*ZPRED)',
        resid.length > 0 && `RESIDUALS ${resid.join(' ')}`,
        save.length > 0 && `SAVE ${save.join(' ')}`,
      ])
    }
    case 'reliability': {
      const stats = [spec.itemDescriptives && 'DESCRIPTIVE', spec.scaleDescriptives && 'SCALE', spec.interItemCorr && 'CORR'].filter(Boolean)
      return cmd('RELIABILITY', [
        `VARIABLES=${list(spec.variables)}`,
        `SCALE(${quote(spec.scaleName || 'ALL VARIABLES')}) ALL`,
        `MODEL=${spec.model === 'split' ? 'SPLIT' : 'ALPHA'}`,
        stats.length > 0 && `STATISTICS=${stats.join(' ')}`,
        spec.itemTotal && 'SUMMARY=TOTAL',
      ])
    }
    case 'npar-chisquare':
      return cmd('NPAR TESTS', [
        `CHISQUARE=${list(spec.variables)}${spec.range ? ` (${num(spec.range[0])},${num(spec.range[1])})` : ''}`,
        `EXPECTED=${spec.expected === 'equal' ? 'EQUAL' : spec.expected.map(num).join(' ')}`,
        'MISSING ANALYSIS',
      ])
    case 'npar-mw':
      return cmd('NPAR TESTS', [`M-W= ${list(spec.variables)} BY ${spec.group}(${num(spec.g1)} ${num(spec.g2)})`, 'MISSING ANALYSIS'])
    case 'npar-kw':
      return cmd('NPAR TESTS', [`K-W=${list(spec.variables)} BY ${spec.group}(${num(spec.min)} ${num(spec.max)})`, 'MISSING ANALYSIS'])
    case 'npar-wilcoxon':
      return cmd('NPAR TESTS', [
        `WILCOXON=${list(spec.pairs.map((p) => p[0]))} WITH ${list(spec.pairs.map((p) => p[1]))} (PAIRED)`,
        'MISSING ANALYSIS',
      ])
    case 'npar-friedman':
      return cmd('NPAR TESTS', [`FRIEDMAN=${list(spec.variables)}`, 'MISSING LISTWISE'])
    case 'npar-ks':
      return cmd('NPAR TESTS', [`K-S(NORMAL)=${list(spec.variables)}`, 'MISSING ANALYSIS'])
    case 'graph-bar': {
      const s = spec.summary
      const fn = s.kind === 'count' ? 'COUNT' : s.kind === 'pct' ? 'PCT' : `${s.kind.toUpperCase()}(${s.variable})`
      return cmd('GRAPH', [`BAR(${spec.cluster ? 'GROUPED' : 'SIMPLE'})=${fn} BY ${spec.category}${spec.cluster ? ` BY ${spec.cluster}` : ''}`])
    }
    case 'graph-line': {
      const s = spec.summary
      const fn = s.kind === 'count' ? 'COUNT' : s.kind === 'pct' ? 'PCT' : `${s.kind.toUpperCase()}(${s.variable})`
      return cmd('GRAPH', [`LINE(SIMPLE)=${fn} BY ${spec.category}`])
    }
    case 'graph-pie':
      return cmd('GRAPH', [`PIE=COUNT BY ${spec.category}`])
    case 'graph-histogram':
      return cmd('GRAPH', [`HISTOGRAM${spec.normal ? '(NORMAL)' : ''}=${spec.variable}`])
    case 'graph-scatter':
      return cmd('GRAPH', [
        `SCATTERPLOT(BIVAR)=${spec.x} WITH ${spec.y}${spec.group ? ` BY ${spec.group}` : ''}`,
        spec.fitLine && 'FITLINE TOTAL',
        'MISSING=LISTWISE',
      ])
    // ------------------------------------------------------------ transformations
    case 'compute': {
      const pre = spec.stringWidth !== null ? `STRING ${spec.target} (A${spec.stringWidth}).\n` : ''
      if (spec.condition) return `${pre}IF (${spec.condition}) ${spec.target}=${spec.expression}.`
      return `${pre}COMPUTE ${spec.target}=${spec.expression}.`
    }
    case 'recode': {
      const rules = spec.rules.map((r) => `(${r.old.map(recodeOld).join(',')}=${recodeNew(r.to)})`).join(' ')
      const pre = spec.into && spec.intoString !== null ? `STRING ${list(spec.into)} (A${spec.intoString}).\n` : ''
      return `${pre}RECODE ${list(spec.variables)} ${rules}${spec.into ? ` INTO ${list(spec.into)}` : ''}.`
    }
    case 'sort':
      return `SORT CASES BY ${spec.keys.map((k) => `${k.variable}(${k.descending ? 'D' : 'A'})`).join(' ')}.`
    case 'select-if':
      return `SELECT IF (${spec.condition}).`
    case 'filter':
      return spec.variable ? `FILTER BY ${spec.variable}.` : 'FILTER OFF.'
    case 'use-all':
      return 'USE ALL.'
    case 'weight':
      return spec.variable ? `WEIGHT BY ${spec.variable}.` : 'WEIGHT OFF.'
    case 'sample':
      return spec.fraction !== null ? `SAMPLE ${num(spec.fraction)}.` : `SAMPLE ${spec.count!.n} FROM ${spec.count!.from}.`
    case 'variable-labels':
      return `VARIABLE LABELS ${spec.items.map((i) => `${i.variable} ${quote(i.label)}`).join('\n  /')}.`
    case 'value-labels':
      return `${spec.add ? 'ADD ' : ''}VALUE LABELS ${list(spec.variables)}\n  ${valueLabelsText(spec.labels)}.`
    case 'missing-values':
      return `MISSING VALUES ${list(spec.variables)} ${missingSpecText(spec.missing)}.`
    case 'variable-level':
      return `VARIABLE LEVEL ${list(spec.variables)} (${spec.level.toUpperCase()}).`
    case 'formats':
      return `FORMATS ${list(spec.variables)} (F${spec.width}.${spec.decimals}).`
    case 'string':
      return `STRING ${list(spec.variables)} (A${spec.width}).`
    case 'numeric':
      return `NUMERIC ${list(spec.variables)} (F8.${spec.decimals}).`
    case 'delete-variables':
      return `DELETE VARIABLES ${list(spec.variables)}.`
    case 'rename':
      return `RENAME VARIABLES (${list(spec.from)}=${list(spec.to)}).`
    case 'autorecode':
      return `AUTORECODE VARIABLES=${list(spec.variables)}\n  /INTO ${list(spec.into)}${spec.descending ? '\n  /DESCENDING' : ''}\n  /PRINT.`
    case 'rank':
      return `RANK VARIABLES=${list(spec.variables)} (${spec.descending ? 'D' : 'A'})\n  /RANK INTO ${list(spec.into)}\n  /PRINT=YES\n  /TIES=MEAN.`
    case 'execute':
      return 'EXECUTE.'
    case 'title':
      return `TITLE ${quote(spec.text)}.`
  }
}

export function generateProgram(specs: CommandSpec[]): string {
  return specs.map(generateSyntax).join('\n')
}
