// Executes command specs against a dataset, producing output blocks and a new dataset.

import {
  createVariable,
  deleteVariables,
  getVar,
  insertVariable,
  updateVariable,
  validateVarName,
  type Dataset,
} from '../core/dataset'
import { out, outId, type OutputBlock, type OutputItem } from '../core/output'
import { generateSyntax } from '../syntax/generate'
import { parseCommand, splitCommands, SyntaxError_ } from '../syntax/parser'
import { ExprError } from '../transform/expr'
import {
  applyAutoRecode,
  applyCompute,
  applyRank,
  applyRecode,
  applySample,
  applySelectIf,
  applySort,
} from '../transform/transforms'
import { ProcError } from './common'
import { runCorrelations, runNonparCorr } from './correlations'
import { runCrosstabs } from './crosstabs'
import { runDescriptives } from './descriptives'
import { runExplore } from './explore'
import { runFrequencies } from './frequencies'
import { runGraphBar, runGraphHistogram, runGraphLine, runGraphPie, runGraphScatter } from './graphs'
import { runIndependentT, runMeans, runOneSampleT, runOneway, runPairedT } from './compareMeans'
import { runFriedman, runKruskalWallis, runKS, runMannWhitney, runNparChiSquare, runWilcoxon } from './nonparametric'
import { runRegression } from './regression'
import { runReliability } from './reliability'
import type { CommandSpec } from './types'

const TITLES: Partial<Record<CommandSpec['proc'], string>> = {
  frequencies: 'Frequencies',
  descriptives: 'Descriptives',
  explore: 'Explore',
  crosstabs: 'Crosstabs',
  means: 'Means',
  'ttest-one': 'T-Test',
  'ttest-ind': 'T-Test',
  'ttest-paired': 'T-Test',
  oneway: 'Oneway',
  correlations: 'Correlations',
  nonparcorr: 'Nonparametric Correlations',
  regression: 'Regression',
  reliability: 'Reliability',
  'npar-chisquare': 'NPar Tests',
  'npar-mw': 'NPar Tests',
  'npar-kw': 'NPar Tests',
  'npar-wilcoxon': 'NPar Tests',
  'npar-friedman': 'NPar Tests',
  'npar-ks': 'NPar Tests',
  'graph-bar': 'Graph',
  'graph-line': 'Graph',
  'graph-pie': 'Graph',
  'graph-histogram': 'Graph',
  'graph-scatter': 'Graph',
}

export function isAnalysis(spec: CommandSpec): boolean {
  return spec.proc in TITLES
}

/** Run a single analysis spec. */
function runAnalysis(ds: Dataset, spec: CommandSpec): { items: OutputItem[]; dataset?: Dataset } {
  switch (spec.proc) {
    case 'frequencies':
      return { items: runFrequencies(ds, spec) }
    case 'descriptives':
      return runDescriptives(ds, spec)
    case 'explore':
      return { items: runExplore(ds, spec) }
    case 'crosstabs':
      return { items: runCrosstabs(ds, spec) }
    case 'means':
      return { items: runMeans(ds, spec) }
    case 'ttest-one':
      return { items: runOneSampleT(ds, spec) }
    case 'ttest-ind':
      return { items: runIndependentT(ds, spec) }
    case 'ttest-paired':
      return { items: runPairedT(ds, spec) }
    case 'oneway':
      return { items: runOneway(ds, spec) }
    case 'correlations':
      return { items: runCorrelations(ds, spec) }
    case 'nonparcorr':
      return { items: runNonparCorr(ds, spec) }
    case 'regression':
      return runRegression(ds, spec)
    case 'reliability':
      return { items: runReliability(ds, spec) }
    case 'npar-chisquare':
      return { items: runNparChiSquare(ds, spec) }
    case 'npar-mw':
      return { items: runMannWhitney(ds, spec) }
    case 'npar-kw':
      return { items: runKruskalWallis(ds, spec) }
    case 'npar-wilcoxon':
      return { items: runWilcoxon(ds, spec) }
    case 'npar-friedman':
      return { items: runFriedman(ds, spec) }
    case 'npar-ks':
      return { items: runKS(ds, spec) }
    case 'graph-bar':
      return { items: runGraphBar(ds, spec) }
    case 'graph-line':
      return { items: runGraphLine(ds, spec) }
    case 'graph-pie':
      return { items: runGraphPie(ds, spec) }
    case 'graph-histogram':
      return { items: runGraphHistogram(ds, spec) }
    case 'graph-scatter':
      return { items: runGraphScatter(ds, spec) }
    default:
      throw new ProcError(`Unsupported procedure ${spec.proc}.`)
  }
}

function must(ds: Dataset, name: string) {
  const v = getVar(ds, name)
  if (!v) throw new ProcError(`Variable "${name}" does not exist in the active dataset.`)
  return v
}

/** Apply a transformation spec. Returns the new dataset and an optional note. */
export function applyTransform(ds: Dataset, spec: CommandSpec): { ds: Dataset; note?: OutputItem } {
  switch (spec.proc) {
    case 'compute':
      return { ds: applyCompute(ds, spec) }
    case 'recode':
      return { ds: applyRecode(ds, spec) }
    case 'sort':
      return { ds: applySort(ds, spec) }
    case 'select-if':
      return { ds: { ...applySelectIf(ds, spec), filterVarId: ds.filterVarId } }
    case 'sample':
      return { ds: applySample(ds, spec) }
    case 'filter':
      if (!spec.variable) return { ds: { ...ds, filterVarId: null } }
      {
        const v = must(ds, spec.variable)
        if (v.type !== 'numeric') throw new ProcError('FILTER BY requires a numeric variable.')
        return { ds: { ...ds, filterVarId: v.id } }
      }
    case 'use-all':
      return { ds: { ...ds, filterVarId: null } }
    case 'weight':
      if (!spec.variable) return { ds: { ...ds, weightVarId: null } }
      {
        const v = must(ds, spec.variable)
        if (v.type !== 'numeric') throw new ProcError('WEIGHT BY requires a numeric variable.')
        return { ds: { ...ds, weightVarId: v.id } }
      }
    case 'variable-labels': {
      let next = ds
      for (const it of spec.items) next = updateVariable(next, must(next, it.variable).id, { label: it.label })
      return { ds: next }
    }
    case 'value-labels': {
      let next = ds
      for (const name of spec.variables) {
        const v = must(next, name)
        const conv = spec.labels.map((l) => ({
          value: v.type === 'numeric' ? Number(l.value) : String(l.value),
          label: l.label,
        }))
        if (v.type === 'numeric' && conv.some((l) => Number.isNaN(l.value as number)))
          throw new ProcError(`VALUE LABELS: string values cannot label numeric variable ${v.name}.`)
        const merged = spec.add ? [...v.valueLabels.filter((l) => !conv.some((c) => c.value === l.value)), ...conv] : conv
        merged.sort((a, b) => (typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : String(a.value).localeCompare(String(b.value))))
        next = updateVariable(next, v.id, { valueLabels: merged })
      }
      return { ds: next }
    }
    case 'missing-values': {
      let next = ds
      for (const name of spec.variables) next = updateVariable(next, must(next, name).id, { missing: spec.missing })
      return { ds: next }
    }
    case 'variable-level': {
      let next = ds
      for (const name of spec.variables) {
        const v = must(next, name)
        if (v.type === 'string' && spec.level === 'scale') throw new ProcError(`String variable ${v.name} cannot have a scale measurement level.`)
        next = updateVariable(next, v.id, { measure: spec.level })
      }
      return { ds: next }
    }
    case 'formats': {
      let next = ds
      for (const name of spec.variables) {
        const v = must(next, name)
        if (v.type !== 'numeric') throw new ProcError(`FORMATS: ${v.name} is a string variable.`)
        next = updateVariable(next, v.id, { width: spec.width, decimals: spec.decimals })
      }
      return { ds: next }
    }
    case 'string':
    case 'numeric': {
      let next = ds
      for (const name of spec.variables) {
        if (getVar(next, name)) continue
        const err = validateVarName(name, next)
        if (err) throw new ProcError(err)
        const v =
          spec.proc === 'string'
            ? createVariable(name, { type: 'string', width: spec.width })
            : createVariable(name, { type: 'numeric', decimals: spec.decimals })
        next = insertVariable(next, next.variables.length, v)
      }
      return { ds: next }
    }
    case 'delete-variables':
      return { ds: deleteVariables(ds, spec.variables.map((n) => must(ds, n).id)) }
    case 'rename': {
      let next = ds
      const ids = spec.from.map((n) => must(ds, n).id)
      // two-phase rename to allow swaps
      ids.forEach((id, k) => (next = updateVariable(next, id, { name: `__tmp_${k}_${id}` })))
      ids.forEach((id, k) => {
        const err = validateVarName(spec.to[k], next, id)
        if (err) throw new ProcError(err)
        next = updateVariable(next, id, { name: spec.to[k] })
      })
      return { ds: next }
    }
    case 'autorecode':
      return { ds: applyAutoRecode(ds, spec) }
    case 'rank':
      return { ds: applyRank(ds, spec) }
    case 'execute':
      return { ds }
    case 'title':
      return { ds, note: out.title(spec.text) }
    default:
      throw new ProcError(`Unsupported command ${spec.proc}.`)
  }
}

export interface RunResult {
  dataset: Dataset
  blocks: OutputBlock[]
  /** Number of commands that failed. */
  errors: number
}

function errorItem(e: unknown): OutputItem {
  const msg = e instanceof Error ? e.message : String(e)
  return out.text(msg, 'error', 'Error')
}

function block(title: string, items: OutputItem[]): OutputBlock {
  return { id: outId('b'), title, items, createdAt: Date.now() }
}

/** Execute specs (e.g. from a dialog). Log text defaults to the generated syntax. */
export function executeSpecs(ds: Dataset, specs: CommandSpec[], logText?: string): RunResult {
  let cur = ds
  const blocks: OutputBlock[] = []
  let errors = 0
  let pendingLog: string[] = []
  let pendingItems: OutputItem[] = []
  const flushTransforms = () => {
    if (pendingLog.length || pendingItems.length) {
      blocks.push(block('Log', [...(pendingLog.length ? [out.log(pendingLog.join('\n'))] : []), ...pendingItems]))
      pendingLog = []
      pendingItems = []
    }
  }
  specs.forEach((spec, k) => {
    const syntax = logText && specs.length === 1 ? logText : generateSyntax(spec)
    if (isAnalysis(spec)) {
      flushTransforms()
      try {
        const r = runAnalysis(cur, spec)
        if (r.dataset) cur = r.dataset
        blocks.push(block(TITLES[spec.proc]!, [out.log(syntax), ...r.items]))
      } catch (e) {
        errors++
        blocks.push(block(TITLES[spec.proc]!, [out.log(syntax), errorItem(wrapError(e))]))
      }
    } else {
      pendingLog.push(syntax)
      try {
        const r = applyTransform(cur, spec)
        cur = r.ds
        if (r.note) pendingItems.push(r.note)
      } catch (e) {
        errors++
        pendingItems.push(errorItem(wrapError(e)))
      }
    }
    void k
  })
  flushTransforms()
  return { dataset: cur, blocks, errors }
}

function wrapError(e: unknown): Error {
  if (e instanceof ProcError || e instanceof ExprError || e instanceof SyntaxError_) return e
  if (e instanceof Error) return new Error(`Internal error: ${e.message}`)
  return new Error(String(e))
}

/** Parse and run a syntax program command by command (later commands see earlier changes). */
export function runSyntax(ds: Dataset, text: string): RunResult {
  let cur = ds
  const blocks: OutputBlock[] = []
  let errors = 0
  const commands = splitCommands(text)
  const push = (b: OutputBlock) => {
    const last = blocks[blocks.length - 1]
    if (b.title === 'Log' && last && last.title === 'Log') {
      for (const it of b.items) {
        const tail = last.items[last.items.length - 1]
        // consecutive commands share one log entry, as in the SPSS Viewer
        if (it.kind === 'log' && tail?.kind === 'log') last.items[last.items.length - 1] = { ...tail, text: `${tail.text}\n${it.text}` }
        else last.items.push(it)
      }
    } else blocks.push(b)
  }
  for (const raw of commands) {
    let specs: CommandSpec[]
    try {
      const parsed = parseCommand(raw, cur)
      if (parsed.ignored) {
        push(block('Log', [out.log(raw.text + '.'), out.text(`Command ignored in the browser: ${raw.text.split(/\s+/)[0]}.`, 'warning', 'Warnings')]))
        continue
      }
      specs = parsed.specs
    } catch (e) {
      errors++
      const msg = e instanceof SyntaxError_ ? `Line ${e.line}: ${e.message}` : (e as Error).message
      push(block('Log', [out.log(raw.text + '.'), out.text(msg, 'error', 'Error')]))
      continue
    }
    const r = executeSpecs(cur, specs, raw.text + '.')
    cur = r.dataset
    errors += r.errors
    for (const b of r.blocks) push(b)
  }
  return { dataset: cur, blocks, errors }
}
