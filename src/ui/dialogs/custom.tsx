// Dialogs with bespoke layouts: Compute, Recode, Select/Sort/Weight Cases, variable property editors, etc.

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import {
  getVar,
  isMissing,
  updateVariable,
  validateVarName,
  type MissingSpec,
  type ValueLabel,
  type Variable,
} from '../../core/dataset'
import { formatValue } from '../../core/format'
import { datasetFromCSV, detectDelimiter, parseDelimited } from '../../io/csv'
import type { CommandSpec, RecodeNew, RecodeOld, RecodeRule } from '../../procedures/types'
import { SAMPLES } from '../../samples/samples'
import { useApp } from '../../state/store'
import { FUNCTION_NAMES, parseExpr } from '../../transform/expr'
import { Check, DialogShell, GroupBox, Logo, MeasureIcon, Radio } from '../common'
import { missingText } from '../data/varText'
import { VarListBox } from './framework'
import { varDisplay } from './util'

type Sel = { list: string; names: string[]; anchor: string | null }
const noSel: Sel = { list: '', names: [], anchor: null }

function Footer({
  onOk,
  onPaste,
  onReset,
  onCancel,
  okLabel = 'OK',
  error,
}: {
  onOk: () => void
  onPaste?: () => void
  onReset?: () => void
  onCancel: () => void
  okLabel?: string
  error?: string | null
}) {
  return (
    <>
      <button className="btn primary" onClick={onOk} disabled={!!error} title={error ?? undefined}>
        {okLabel}
      </button>
      {onPaste && (
        <button className="btn" onClick={onPaste} disabled={!!error}>
          Paste
        </button>
      )}
      {onReset && (
        <button className="btn" onClick={onReset}>
          Reset
        </button>
      )}
      <button className="btn" onClick={onCancel}>
        Cancel
      </button>
      {error && <div className="msg">{error}</div>}
    </>
  )
}

function useDialogActions() {
  const close = useApp((s) => s.closeDialog)
  const runSpecs = useApp((s) => s.runSpecs)
  const pasteSyntax = useApp((s) => s.pasteSyntax)
  const notify = useApp((s) => s.notify)
  return {
    close,
    notify,
    run: (specs: CommandSpec[]) => {
      close()
      runSpecs(specs)
    },
    paste: (specs: CommandSpec[]) => {
      close()
      pasteSyntax(specs)
    },
  }
}

/** Calculator keypad used by Compute and If… */
function Keypad({ onKey }: { onKey: (s: string) => void }) {
  const keys = ['+', '<', '>', '7', '8', '9', '-', '<=', '>=', '4', '5', '6', '*', '=', '~=', '1', '2', '3', '/', '&', '|', '0', '.', '(', '**', '~', ')']
  return (
    <div className="calc" aria-label="Calculator keypad">
      {keys.map((k) => (
        <button key={k} type="button" onClick={() => onKey(k === '(' ? '( )' : k)} title={k}>
          {k}
        </button>
      ))}
    </div>
  )
}

const FUNCTION_HELP: Record<string, string> = {
  MEAN: 'MEAN(numexpr, numexpr, ...) — mean of valid arguments. MEAN.n requires n valid values.',
  SUM: 'SUM(numexpr, ...) — sum of valid arguments.',
  SD: 'SD(numexpr, ...) — standard deviation of valid arguments.',
  MIN: 'MIN(...) — smallest valid argument.',
  MAX: 'MAX(...) — largest valid argument.',
  ABS: 'ABS(x) — absolute value.',
  SQRT: 'SQRT(x) — square root.',
  LN: 'LN(x) — natural logarithm.',
  LG10: 'LG10(x) — base-10 logarithm.',
  EXP: 'EXP(x) — exponential.',
  RND: 'RND(x [, mult]) — round to the nearest integer (or multiple).',
  TRUNC: 'TRUNC(x) — truncate toward zero.',
  MOD: 'MOD(x, m) — remainder of x / m.',
  MISSING: 'MISSING(var) — 1 if the value is system- or user-missing.',
  SYSMIS: 'SYSMIS(var) — 1 if the value is system-missing.',
  'CDF.NORMAL': 'CDF.NORMAL(q, mean, sd) — normal cumulative probability.',
  'IDF.NORMAL': 'IDF.NORMAL(p, mean, sd) — normal quantile.',
  'RV.NORMAL': 'RV.NORMAL(mean, sd) — random normal value.',
  'RV.UNIFORM': 'RV.UNIFORM(min, max) — random uniform value.',
  CONCAT: 'CONCAT(str, str, ...) — join strings.',
  UPCASE: 'UPCASE(str) — upper case.',
  'CHAR.SUBSTR': 'CHAR.SUBSTR(str, pos [, len]) — substring.',
  NUMBER: 'NUMBER(str, F8.2) — convert a string to a number.',
  STRING: 'STRING(num, F8.2) — convert a number to a string.',
  ANY: 'ANY(x, v1, v2, ...) — 1 if x equals any of the values.',
  RANGE: 'RANGE(x, lo, hi) — 1 if lo <= x <= hi.',
}

/** Insert text into a textarea value at the cursor. */
function insertAt(el: HTMLTextAreaElement | null, value: string, text: string, set: (s: string) => void) {
  if (!el) return set(value + text)
  const a = el.selectionStart
  const b = el.selectionEnd
  const pad = (s: string) => (a > 0 && !/\s|\($/.test(value[a - 1]) ? ' ' : '') + s
  const t = pad(text)
  const next = value.slice(0, a) + t + value.slice(b)
  set(next)
  const caret = text.includes('?') ? a + t.indexOf('?') : a + t.length
  setTimeout(() => {
    el.focus()
    el.setSelectionRange(caret, caret + (text.includes('?') ? 1 : 0))
  }, 0)
}

function exprError(src: string): string | null {
  if (!src.trim()) return null
  try {
    parseExpr(src)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

function ExpressionBuilder({
  value,
  onChange,
  label,
  rows = 4,
}: {
  value: string
  onChange: (s: string) => void
  label: string
  rows?: number
}) {
  const ds = useApp((s) => s.ds)
  const mode = useApp((s) => s.options.dialogLabels)
  const [taEl, setTaEl] = useState<HTMLTextAreaElement | null>(null)
  const [sel, setSel] = useState<Sel>(noSel)
  const [fn, setFn] = useState('MEAN')
  const err = exprError(value)
  return (
    <div className="row" style={{ alignItems: 'stretch', flexWrap: 'nowrap', gap: 12 }}>
      <div className="col" style={{ width: 220 }}>
        <span className="lbl-small">Variables (double-click to insert):</span>
        <VarListBox
          id="src"
          vars={ds.variables}
          sel={sel}
          setSel={setSel}
          mode={mode}
          height={250}
          ariaLabel="Variables"
          onTransfer={(names) => insertAt(taEl, value, names.join(' '), onChange)}
          onDropNames={() => {}}
        />
      </div>
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        <label className="lbl-small" htmlFor="expr">
          {label}
        </label>
        <textarea id="expr" ref={setTaEl} className="input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
        {err && <span className="err-text">{err}</span>}
        <div className="row" style={{ alignItems: 'flex-start', marginTop: 6, flexWrap: 'nowrap' }}>
          <Keypad onKey={(k) => insertAt(taEl, value, k === '( )' ? '(?)' : k, onChange)} />
          <div className="col" style={{ flex: 1, minWidth: 0 }}>
            <span className="lbl-small">Functions:</span>
            <select className="input" size={6} value={fn} onChange={(e) => setFn(e.target.value)} onDoubleClick={() => insertAt(taEl, value, `${fn}(?)`, onChange)} style={{ height: 'auto' }}>
              {FUNCTION_NAMES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <button className="btn small" style={{ marginTop: 4 }} onClick={() => insertAt(taEl, value, `${fn}(?)`, onChange)}>
              Insert function
            </button>
          </div>
        </div>
        <div className="muted small" style={{ minHeight: 32 }}>
          {FUNCTION_HELP[fn] ?? `${fn}(...)`}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------- Compute Variable

export function ComputeDialog() {
  const ds = useApp((s) => s.ds)
  const memory = useApp((s) => s.dialogMemory.compute) as { target: string; expr: string; cond: string; label: string; isString: boolean; width: number } | undefined
  const remember = useApp((s) => s.rememberDialog)
  const { close, run, paste } = useDialogActions()
  const [target, setTarget] = useState(memory?.target ?? '')
  const [expr, setExpr] = useState(memory?.expr ?? '')
  const [cond, setCond] = useState(memory?.cond ?? '')
  const [useCond, setUseCond] = useState(!!memory?.cond)
  const [label, setLabel] = useState(memory?.label ?? '')
  const [isString, setIsString] = useState(memory?.isString ?? false)
  const [width, setWidth] = useState(memory?.width ?? 8)
  const [sub, setSub] = useState<'if' | 'type' | null>(null)
  const existing = getVar(ds, target)
  const nameErr = !target ? 'Enter a target variable.' : existing ? null : validateVarName(target, ds)
  const error = nameErr ?? (!expr.trim() ? 'Enter a numeric expression.' : exprError(expr)) ?? (useCond && cond.trim() ? exprError(cond) : null)
  const specs = (): CommandSpec[] => {
    const out: CommandSpec[] = [
      {
        proc: 'compute',
        target: existing ? existing.name : target,
        expression: expr.trim(),
        condition: useCond && cond.trim() ? cond.trim() : null,
        stringWidth: !existing && isString ? width : null,
      },
    ]
    if (label) out.push({ proc: 'variable-labels', items: [{ variable: existing ? existing.name : target, label }] })
    out.push({ proc: 'execute' })
    return out
  }
  const save = () => remember('compute', { target, expr, cond: useCond ? cond : '', label, isString, width })
  return (
    <>
      <DialogShell
        title="Compute Variable"
        width={760}
        onClose={close}
        footer={
          <Footer
            error={error}
            onOk={() => {
              save()
              run(specs())
            }}
            onPaste={() => {
              save()
              paste(specs())
            }}
            onReset={() => {
              setTarget('')
              setExpr('')
              setCond('')
              setUseCond(false)
              setLabel('')
            }}
            onCancel={close}
          />
        }
      >
        <div className="row" style={{ marginBottom: 10, alignItems: 'flex-end' }}>
          <label className="field">
            <span className="lbl-small">Target Variable:</span>
            <input className="input" style={{ width: 200 }} value={target} onChange={(e) => setTarget(e.target.value.trim())} data-autofocus />
          </label>
          <button className="btn" onClick={() => setSub('type')}>
            Type &amp; Label…
          </button>
          <span className="muted small">{existing ? `Existing variable — values will be replaced${existing.type === 'string' ? ' (string)' : ''}.` : target ? 'A new variable will be created.' : ''}</span>
        </div>
        <ExpressionBuilder value={expr} onChange={setExpr} label="Numeric Expression:" />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => setSub('if')}>
            If…
          </button>
          <span className="muted small">{useCond && cond.trim() ? `Only cases where: ${cond}` : '(optional case selection condition)'}</span>
        </div>
      </DialogShell>
      {sub === 'if' && (
        <IfDialog
          initialUse={useCond}
          initial={cond}
          onCancel={() => setSub(null)}
          onContinue={(u, c) => {
            setUseCond(u)
            setCond(c)
            setSub(null)
          }}
        />
      )}
      {sub === 'type' && (
        <DialogShell
          title="Compute Variable: Type and Label"
          width={380}
          layer={1}
          onClose={() => setSub(null)}
          footer={<Footer okLabel="Continue" onOk={() => setSub(null)} onCancel={() => setSub(null)} />}
        >
          <GroupBox title="Label">
            <input className="input" style={{ width: '100%' }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Variable label (optional)" />
          </GroupBox>
          <GroupBox title="Type">
            <Radio name="ctype" value="n" current={isString ? 's' : 'n'} label="Numeric" onChange={() => setIsString(false)} disabled={!!existing} />
            <div className="row">
              <Radio name="ctype" value="s" current={isString ? 's' : 'n'} label="String   Width:" onChange={() => setIsString(true)} disabled={!!existing} />
              <input className="input" type="number" min={1} max={32767} style={{ width: 70 }} value={width} disabled={!isString || !!existing} onChange={(e) => setWidth(Math.max(1, Number(e.target.value) || 8))} />
            </div>
          </GroupBox>
        </DialogShell>
      )}
    </>
  )
}

function IfDialog({ initialUse, initial, onCancel, onContinue }: { initialUse: boolean; initial: string; onCancel: () => void; onContinue: (use: boolean, cond: string) => void }) {
  const [use, setUse] = useState(initialUse || !!initial)
  const [cond, setCond] = useState(initial)
  const err = use ? (!cond.trim() ? 'Enter a condition.' : exprError(cond)) : null
  return (
    <DialogShell title="If Cases" width={740} layer={1} onClose={onCancel} footer={<Footer okLabel="Continue" error={err} onOk={() => onContinue(use, cond)} onCancel={onCancel} />}>
      <div className="col" style={{ marginBottom: 8 }}>
        <Radio name="ifm" value="all" current={use ? 'if' : 'all'} label="Include all cases" onChange={() => setUse(false)} />
        <Radio name="ifm" value="if" current={use ? 'if' : 'all'} label="Include if case satisfies condition:" onChange={() => setUse(true)} />
      </div>
      <ExpressionBuilder value={cond} onChange={(s) => (setCond(s), setUse(true))} label="Condition (e.g. age >= 18 AND gender = 2):" rows={3} />
    </DialogShell>
  )
}

// ------------------------------------------------------------------------- Recode

interface RecodeRuleUI extends RecodeRule {
  text: string
}

function oldText(o: RecodeOld, v?: Variable): string {
  const f = (x: number) => (v ? formatValue(v, x) : String(x))
  switch (o.kind) {
    case 'value':
      return typeof o.value === 'string' ? `'${o.value}'` : f(o.value)
    case 'sysmis':
      return 'SYSMIS'
    case 'missing':
      return 'MISSING'
    case 'range':
      return `${f(o.low)} thru ${f(o.high)}`
    case 'lowest':
      return `Lowest thru ${f(o.high)}`
    case 'highest':
      return `${f(o.low)} thru Highest`
    case 'else':
      return 'ELSE'
  }
}

function newText(n: RecodeNew): string {
  return n.kind === 'copy' ? 'Copy' : n.kind === 'sysmis' ? 'SYSMIS' : typeof n.value === 'string' ? `'${n.value}'` : String(n.value)
}

function OldNewDialog({
  initial,
  different,
  stringSource,
  initialString,
  onCancel,
  onContinue,
}: {
  initial: RecodeRuleUI[]
  different: boolean
  stringSource: boolean
  initialString: { on: boolean; width: number }
  onCancel: () => void
  onContinue: (rules: RecodeRuleUI[], str: { on: boolean; width: number }) => void
}) {
  const [rules, setRules] = useState(initial)
  const [oldMode, setOldMode] = useState<'value' | 'sysmis' | 'missing' | 'range' | 'lowest' | 'highest' | 'else'>('value')
  const [newMode, setNewMode] = useState<'value' | 'sysmis' | 'copy'>('value')
  const [o1, setO1] = useState('')
  const [o2, setO2] = useState('')
  const [nv, setNv] = useState('')
  const [selIdx, setSelIdx] = useState<number | null>(null)
  const [str, setStr] = useState(initialString)
  const parse = (s: string) => (stringSource ? s : Number(s))
  const build = (): RecodeRuleUI | string => {
    let old: RecodeOld
    const n1 = Number(o1)
    const n2 = Number(o2)
    switch (oldMode) {
      case 'value':
        if (o1 === '' || (!stringSource && Number.isNaN(n1))) return 'Enter an old value.'
        old = { kind: 'value', value: parse(o1) }
        break
      case 'range':
        if (o1 === '' || o2 === '' || Number.isNaN(n1) || Number.isNaN(n2) || n1 > n2) return 'Enter a valid range.'
        old = { kind: 'range', low: n1, high: n2 }
        break
      case 'lowest':
        if (o1 === '' || Number.isNaN(n1)) return 'Enter the upper value.'
        old = { kind: 'lowest', high: n1 }
        break
      case 'highest':
        if (o1 === '' || Number.isNaN(n1)) return 'Enter the lower value.'
        old = { kind: 'highest', low: n1 }
        break
      default:
        old = { kind: oldMode }
    }
    let to: RecodeNew
    if (newMode === 'value') {
      const outString = different ? str.on : stringSource
      if (nv === '' || (!outString && Number.isNaN(Number(nv)))) return 'Enter a valid new value.'
      to = { kind: 'value', value: outString ? nv : Number(nv) }
    } else to = { kind: newMode }
    return { old: [old], to, text: `${oldText(old)} --> ${newText(to)}` }
  }
  const candidate = build()
  const add = () => {
    if (typeof candidate === 'string') return
    // ELSE always goes last
    const next = [...rules.filter((r) => r.old[0].kind !== 'else'), candidate, ...rules.filter((r) => r.old[0].kind === 'else')]
    if (candidate.old[0].kind === 'else') setRules([...rules.filter((r) => r.old[0].kind !== 'else'), candidate])
    else setRules(next)
    setO1('')
    setO2('')
    setNv('')
  }
  const rangeDisabled = stringSource
  return (
    <DialogShell
      title={different ? 'Recode into Different Variables: Old and New Values' : 'Recode into Same Variables: Old and New Values'}
      width={720}
      layer={1}
      onClose={onCancel}
      footer={<Footer okLabel="Continue" error={rules.length ? null : 'Add at least one Old --> New rule.'} onOk={() => onContinue(rules, str)} onCancel={onCancel} />}
    >
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <GroupBox title="Old Value" style={{ flex: 1 }}>
          <div className="col" style={{ gap: 4 }}>
            <Radio name="om" value="value" current={oldMode} label="Value:" onChange={setOldMode} />
            <input className="input" disabled={oldMode !== 'value'} value={oldMode === 'value' ? o1 : ''} onChange={(e) => setO1(e.target.value)} style={{ marginLeft: 22 }} />
            <Radio name="om" value="sysmis" current={oldMode} label="System-missing" onChange={setOldMode} disabled={stringSource} />
            <Radio name="om" value="missing" current={oldMode} label="System- or user-missing" onChange={setOldMode} />
            <Radio name="om" value="range" current={oldMode} label="Range:" onChange={setOldMode} disabled={rangeDisabled} />
            <div className="row" style={{ marginLeft: 22, gap: 4 }}>
              <input className="input" style={{ width: 80 }} disabled={oldMode !== 'range'} value={oldMode === 'range' ? o1 : ''} onChange={(e) => setO1(e.target.value)} aria-label="Range low" />
              <span>through</span>
              <input className="input" style={{ width: 80 }} disabled={oldMode !== 'range'} value={oldMode === 'range' ? o2 : ''} onChange={(e) => setO2(e.target.value)} aria-label="Range high" />
            </div>
            <Radio name="om" value="lowest" current={oldMode} label="Range, LOWEST through value:" onChange={setOldMode} disabled={rangeDisabled} />
            <input className="input" style={{ marginLeft: 22 }} disabled={oldMode !== 'lowest'} value={oldMode === 'lowest' ? o1 : ''} onChange={(e) => setO1(e.target.value)} aria-label="Lowest through" />
            <Radio name="om" value="highest" current={oldMode} label="Range, value through HIGHEST:" onChange={setOldMode} disabled={rangeDisabled} />
            <input className="input" style={{ marginLeft: 22 }} disabled={oldMode !== 'highest'} value={oldMode === 'highest' ? o1 : ''} onChange={(e) => setO1(e.target.value)} aria-label="Through highest" />
            <Radio name="om" value="else" current={oldMode} label="All other values" onChange={setOldMode} />
          </div>
        </GroupBox>
        <div className="col" style={{ flex: 1, gap: 8 }}>
          <GroupBox title="New Value">
            <div className="row">
              <Radio name="nm" value="value" current={newMode} label="Value:" onChange={setNewMode} />
              <input className="input" style={{ width: 120 }} disabled={newMode !== 'value'} value={nv} onChange={(e) => setNv(e.target.value)} aria-label="New value" />
            </div>
            <Radio name="nm" value="sysmis" current={newMode} label="System-missing" onChange={setNewMode} />
            {different && <Radio name="nm" value="copy" current={newMode} label="Copy old value(s)" onChange={setNewMode} />}
          </GroupBox>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <div className="col" style={{ gap: 4 }}>
              <button className="btn small" disabled={typeof candidate === 'string'} title={typeof candidate === 'string' ? candidate : undefined} onClick={add}>
                Add
              </button>
              <button
                className="btn small"
                disabled={selIdx === null || typeof candidate === 'string'}
                onClick={() => {
                  if (selIdx === null || typeof candidate === 'string') return
                  setRules(rules.map((r, i) => (i === selIdx ? candidate : r)))
                }}
              >
                Change
              </button>
              <button
                className="btn small"
                disabled={selIdx === null}
                onClick={() => {
                  setRules(rules.filter((_, i) => i !== selIdx))
                  setSelIdx(null)
                }}
              >
                Remove
              </button>
            </div>
            <div className="col" style={{ flex: 1, minWidth: 0 }}>
              <span className="lbl-small">Old --&gt; New:</span>
              <div className="list-simple" style={{ height: 150 }} role="listbox" aria-label="Recode rules">
                {rules.map((r, i) => (
                  <div key={i} className={`li ${selIdx === i ? 'sel' : ''}`} onMouseDown={() => setSelIdx(i)}>
                    {r.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {different && (
            <div className="row">
              <Check label="Output variables are strings" checked={str.on} onChange={(on) => setStr({ ...str, on })} />
              <span>Width:</span>
              <input className="input" type="number" style={{ width: 60 }} min={1} disabled={!str.on} value={str.width} onChange={(e) => setStr({ ...str, width: Math.max(1, Number(e.target.value) || 8) })} />
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  )
}

export function RecodeDialog({ different }: { different: boolean }) {
  const ds = useApp((s) => s.ds)
  const mode = useApp((s) => s.options.dialogLabels)
  const key = different ? 'recode-diff' : 'recode-same'
  const memory = useApp((s) => s.dialogMemory[key]) as { vars: string[]; out: Record<string, { name: string; label: string }>; rules: RecodeRuleUI[]; str: { on: boolean; width: number } } | undefined
  const remember = useApp((s) => s.rememberDialog)
  const { close, run, paste } = useDialogActions()
  const names = new Set(ds.variables.map((v) => v.name))
  const [vars, setVars] = useState<string[]>((memory?.vars ?? []).filter((n) => names.has(n)))
  const [out, setOut] = useState<Record<string, { name: string; label: string }>>(memory?.out ?? {})
  const [rules, setRules] = useState<RecodeRuleUI[]>(memory?.rules ?? [])
  const [str, setStr] = useState(memory?.str ?? { on: false, width: 8 })
  const [sel, setSel] = useState<Sel>(noSel)
  const [sub, setSub] = useState(false)
  const [outName, setOutName] = useState('')
  const [outLabel, setOutLabel] = useState('')
  const byName = useMemo(() => new Map(ds.variables.map((v) => [v.name, v])), [ds.variables])
  const firstType = vars.length ? byName.get(vars[0])?.type : undefined
  const source = ds.variables.filter((v) => !vars.includes(v.name) && (!firstType || v.type === firstType))
  const current = sel.list === 'targets' && sel.names.length === 1 ? sel.names[0] : null

  const error =
    !vars.length
      ? 'Select at least one variable.'
      : !rules.length
        ? 'Define the recode with Old and New Values….'
        : different && vars.some((v) => !out[v]?.name)
          ? 'Give every input variable an output variable name (Change).'
          : null

  const specs = (): CommandSpec[] => {
    const res: CommandSpec[] = [
      {
        proc: 'recode',
        variables: vars,
        into: different ? vars.map((v) => out[v].name) : null,
        rules: rules.map(({ old, to }) => ({ old, to })),
        intoString: different && str.on ? str.width : null,
      },
    ]
    if (different) {
      const items = vars.filter((v) => out[v].label).map((v) => ({ variable: out[v].name, label: out[v].label }))
      if (items.length) res.push({ proc: 'variable-labels', items })
    }
    res.push({ proc: 'execute' })
    return res
  }
  const save = () => remember(key, { vars, out, rules, str })
  const moveIn = (ns: string[]) => {
    setVars([...vars, ...ns.filter((n) => !vars.includes(n))])
    setSel(noSel)
  }
  const moveOut = (ns: string[]) => {
    setVars(vars.filter((n) => !ns.includes(n)))
    setSel(noSel)
  }
  const fromSource = sel.list === 'source' && sel.names.length > 0
  return (
    <>
      <DialogShell
        title={different ? 'Recode into Different Variables' : 'Recode into Same Variables'}
        width={different ? 780 : 620}
        onClose={close}
        footer={
          <Footer
            error={error}
            onOk={() => {
              save()
              run(specs())
            }}
            onPaste={() => {
              save()
              paste(specs())
            }}
            onReset={() => {
              setVars([])
              setRules([])
              setOut({})
            }}
            onCancel={close}
          />
        }
      >
        <div className="row" style={{ alignItems: 'stretch', flexWrap: 'nowrap' }}>
          <div className="col" style={{ width: 220 }}>
            <span className="lbl-small">Variables:</span>
            <VarListBox id="source" vars={source} sel={sel} setSel={setSel} mode={mode} height={260} ariaLabel="Variables" onTransfer={moveIn} onDropNames={(_, ns) => moveOut(ns)} />
          </div>
          <div style={{ paddingTop: 22 }}>
            <button
              className="arrow-btn"
              aria-label={fromSource ? 'Add variables' : 'Remove variables'}
              disabled={!sel.names.length}
              onClick={() => (fromSource ? moveIn(sel.names) : moveOut(sel.names))}
            >
              {fromSource || !sel.names.length ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
            </button>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 0 }}>
            <span className="lbl-small">{different ? 'Input Variable --> Output Variable:' : `${firstType === 'string' ? 'String' : 'Numeric'} Variables:`}</span>
            <VarListBox
              id="targets"
              vars={vars.map((n) => byName.get(n)).filter((v): v is Variable => !!v)}
              sel={sel}
              setSel={(s) => {
                setSel(s)
                if (different && s.names.length === 1) {
                  const o = out[s.names[0]]
                  setOutName(o?.name ?? '')
                  setOutLabel(o?.label ?? '')
                }
              }}
              mode={mode}
              height={different ? 190 : 260}
              ariaLabel="Variables to recode"
              onTransfer={moveOut}
              onDropNames={(_, ns) => moveIn(ns)}
              extraFor={different ? (v) => `--> ${out[v.name]?.name || '?'}` : undefined}
            />
            {different && (
              <GroupBox title="Output Variable">
                <div className="row">
                  <label className="field">
                    <span className="lbl-small">Name:</span>
                    <input className="input" style={{ width: 150 }} value={outName} disabled={!current} onChange={(e) => setOutName(e.target.value.trim())} />
                  </label>
                  <label className="field">
                    <span className="lbl-small">Label:</span>
                    <input className="input" style={{ width: 200 }} value={outLabel} disabled={!current} onChange={(e) => setOutLabel(e.target.value)} />
                  </label>
                  <button
                    className="btn small"
                    style={{ alignSelf: 'flex-end' }}
                    disabled={!current || !outName || (!!validateVarName(outName, ds) && !getVar(ds, outName))}
                    title={current && outName ? (validateVarName(outName, ds) ?? undefined) : undefined}
                    onClick={() => current && setOut({ ...out, [current]: { name: outName, label: outLabel } })}
                  >
                    Change
                  </button>
                </div>
              </GroupBox>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => setSub(true)} disabled={!vars.length}>
                Old and New Values…
              </button>
              <span className="muted small">{rules.length ? `${rules.length} rule${rules.length > 1 ? 's' : ''} defined` : 'No rules yet'}</span>
            </div>
          </div>
        </div>
      </DialogShell>
      {sub && (
        <OldNewDialog
          initial={rules}
          different={different}
          stringSource={firstType === 'string'}
          initialString={str}
          onCancel={() => setSub(false)}
          onContinue={(r, s) => {
            setRules(r)
            setStr(s)
            setSub(false)
          }}
        />
      )}
    </>
  )
}

// ------------------------------------------------------------------------- Select Cases

export function SelectCasesDialog() {
  const ds = useApp((s) => s.ds)
  const mode = useApp((s) => s.options.dialogLabels)
  const memory = useApp((s) => s.dialogMemory['select-cases']) as { cond: string; pct: number } | undefined
  const remember = useApp((s) => s.rememberDialog)
  const { close, run, paste } = useDialogActions()
  const [how, setHow] = useState<'all' | 'if' | 'random' | 'filter'>('all')
  const [cond, setCond] = useState(memory?.cond ?? '')
  const [sampleMode, setSampleMode] = useState<'pct' | 'exact'>('pct')
  const [pct, setPct] = useState(memory?.pct ?? 10)
  const [n, setN] = useState(10)
  const [from, setFrom] = useState(ds.nCases)
  const [output, setOutput] = useState<'filter' | 'delete'>('filter')
  const [filterVar, setFilterVar] = useState<string[]>([])
  const [sel, setSel] = useState<Sel>(noSel)
  const [sub, setSub] = useState<'if' | 'sample' | null>(null)
  const filterName = ds.filterVarId ? ds.variables.find((v) => v.id === ds.filterVarId)?.name : null
  const error =
    how === 'if' && !cond.trim()
      ? 'Enter the condition (If…).'
      : how === 'if'
        ? exprError(cond)
        : how === 'filter' && !filterVar.length
          ? 'Choose a filter variable.'
          : how === 'random' && sampleMode === 'exact' && output === 'filter'
            ? 'An exact-size sample can only be drawn with “Delete unselected cases”.'
            : null

  const specs = (): CommandSpec[] => {
    const filterSpecs = (expr: string, label: string): CommandSpec[] => [
      { proc: 'use-all' },
      { proc: 'compute', target: 'filter_$', expression: `(${expr})`, condition: null, stringWidth: null },
      { proc: 'variable-labels', items: [{ variable: 'filter_$', label: `${label} (FILTER)` }] },
      {
        proc: 'value-labels',
        variables: ['filter_$'],
        labels: [
          { value: 0, label: 'Not Selected' },
          { value: 1, label: 'Selected' },
        ],
        add: false,
      },
      { proc: 'formats', variables: ['filter_$'], width: 1, decimals: 0 },
      { proc: 'filter', variable: 'filter_$' },
      { proc: 'execute' },
    ]
    switch (how) {
      case 'all':
        return [{ proc: 'filter', variable: null }, { proc: 'use-all' }, { proc: 'execute' }]
      case 'if':
        return output === 'filter' ? filterSpecs(cond.trim(), cond.trim().slice(0, 100)) : [{ proc: 'select-if', condition: cond.trim() }, { proc: 'execute' }]
      case 'random':
        if (sampleMode === 'pct') {
          const frac = Math.max(0.0001, Math.min(0.9999, pct / 100))
          return output === 'filter'
            ? filterSpecs(`UNIFORM(1) <= ${frac}`, `Approximately ${pct}% of the cases`)
            : [{ proc: 'sample', fraction: frac, count: null, seed: Date.now() }, { proc: 'execute' }]
        }
        return [{ proc: 'sample', fraction: null, count: { n, from }, seed: Date.now() }, { proc: 'execute' }]
      case 'filter':
        return [{ proc: 'filter', variable: filterVar[0] }, { proc: 'execute' }]
    }
  }
  const save = () => remember('select-cases', { cond, pct })
  const fromSource = sel.list === 'source' && sel.names.length > 0
  return (
    <>
      <DialogShell
        title="Select Cases"
        width={640}
        onClose={close}
        footer={
          <Footer
            error={error}
            onOk={() => {
              save()
              run(specs())
            }}
            onPaste={() => {
              save()
              paste(specs())
            }}
            onCancel={close}
          />
        }
      >
        <div className="row" style={{ alignItems: 'stretch', flexWrap: 'nowrap' }}>
          <div className="col" style={{ width: 210 }}>
            <span className="lbl-small">Variables:</span>
            <VarListBox
              id="source"
              vars={ds.variables.filter((v) => v.type === 'numeric' && !filterVar.includes(v.name))}
              sel={sel}
              setSel={setSel}
              mode={mode}
              height={300}
              ariaLabel="Variables"
              onTransfer={(ns) => {
                setFilterVar([ns[0]])
                setHow('filter')
              }}
              onDropNames={() => setFilterVar([])}
            />
          </div>
          <div className="col" style={{ flex: 1, gap: 6 }}>
            <GroupBox title="Select">
              <div className="col" style={{ gap: 6 }}>
                <Radio name="sc" value="all" current={how} label="All cases" onChange={setHow} />
                <div className="row">
                  <Radio name="sc" value="if" current={how} label="If condition is satisfied" onChange={setHow} />
                  <button className="btn small" onClick={() => (setHow('if'), setSub('if'))}>
                    If…
                  </button>
                </div>
                {cond && <code className="small muted" style={{ marginLeft: 22 }}>{cond}</code>}
                <div className="row">
                  <Radio name="sc" value="random" current={how} label="Random sample of cases" onChange={setHow} />
                  <button className="btn small" onClick={() => (setHow('random'), setSub('sample'))}>
                    Sample…
                  </button>
                </div>
                <span className="small muted" style={{ marginLeft: 22 }}>
                  {sampleMode === 'pct' ? `Approximately ${pct}% of all cases` : `Exactly ${n} cases from the first ${from} cases`}
                </span>
                <Radio name="sc" value="filter" current={how} label="Use filter variable:" onChange={setHow} />
                <div className="row" style={{ marginLeft: 22 }}>
                  <button className="arrow-btn" aria-label="Set filter variable" disabled={!fromSource} onClick={() => (setFilterVar([sel.names[0]]), setHow('filter'))}>
                    <ArrowRight size={16} />
                  </button>
                  <div className="varlist" style={{ height: 30, flex: 1 }}>
                    {filterVar.map((nme) => {
                      const v = getVar(ds, nme)!
                      return (
                        <div key={nme} className="vitem" onDoubleClick={() => setFilterVar([])}>
                          <MeasureIcon v={v} />
                          {varDisplay(v, mode)}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </GroupBox>
            <GroupBox title="Output">
              <Radio name="out" value="filter" current={output} label="Filter out unselected cases" onChange={setOutput} />
              <Radio name="out" value="delete" current={output} label="Delete unselected cases" onChange={setOutput} />
            </GroupBox>
            <div className="small muted">Current Status: {filterName ? `Filter cases by values of ${filterName}` : 'Do not filter cases'}</div>
          </div>
        </div>
      </DialogShell>
      {sub === 'if' && (
        <IfDialog
          initialUse
          initial={cond}
          onCancel={() => setSub(null)}
          onContinue={(_, c) => {
            setCond(c)
            setSub(null)
          }}
        />
      )}
      {sub === 'sample' && (
        <DialogShell title="Select Cases: Random Sample" width={420} layer={1} onClose={() => setSub(null)} footer={<Footer okLabel="Continue" onOk={() => setSub(null)} onCancel={() => setSub(null)} />}>
          <GroupBox title="Sample Size">
            <div className="row">
              <Radio name="sm" value="pct" current={sampleMode} label="Approximately" onChange={setSampleMode} />
              <input className="input" type="number" min={0.01} max={99.99} style={{ width: 70 }} value={pct} disabled={sampleMode !== 'pct'} onChange={(e) => setPct(Number(e.target.value))} />
              <span>% of all cases</span>
            </div>
            <div className="row">
              <Radio name="sm" value="exact" current={sampleMode} label="Exactly" onChange={setSampleMode} />
              <input className="input" type="number" min={1} style={{ width: 70 }} value={n} disabled={sampleMode !== 'exact'} onChange={(e) => setN(Number(e.target.value))} />
              <span>cases from the first</span>
              <input className="input" type="number" min={1} style={{ width: 70 }} value={from} disabled={sampleMode !== 'exact'} onChange={(e) => setFrom(Number(e.target.value))} />
              <span>cases</span>
            </div>
          </GroupBox>
        </DialogShell>
      )}
    </>
  )
}

// ------------------------------------------------------------------------- Sort Cases / Weight Cases / Automatic Recode / Rank

export function SortCasesDialog() {
  const ds = useApp((s) => s.ds)
  const mode = useApp((s) => s.options.dialogLabels)
  const { close, run, paste } = useDialogActions()
  const [keys, setKeys] = useState<{ name: string; desc: boolean }[]>([])
  const [order, setOrder] = useState<'A' | 'D'>('A')
  const [sel, setSel] = useState<Sel>(noSel)
  const byName = useMemo(() => new Map(ds.variables.map((v) => [v.name, v])), [ds.variables])
  const add = (ns: string[]) => {
    setKeys([...keys, ...ns.filter((n) => !keys.some((k) => k.name === n)).map((name) => ({ name, desc: order === 'D' }))])
    setSel(noSel)
  }
  const remove = (ns: string[]) => {
    setKeys(keys.filter((k) => !ns.includes(k.name)))
    setSel(noSel)
  }
  const specs = (): CommandSpec[] => [{ proc: 'sort', keys: keys.map((k) => ({ variable: k.name, descending: k.desc })) }]
  const fromSource = sel.list === 'source' && sel.names.length > 0
  return (
    <DialogShell
      title="Sort Cases"
      width={560}
      onClose={close}
      footer={<Footer error={keys.length ? null : 'Choose at least one variable to sort by.'} onOk={() => run(specs())} onPaste={() => paste(specs())} onReset={() => setKeys([])} onCancel={close} />}
    >
      <div className="row" style={{ alignItems: 'stretch', flexWrap: 'nowrap' }}>
        <div className="col" style={{ width: 210 }}>
          <span className="lbl-small">Variables:</span>
          <VarListBox id="source" vars={ds.variables.filter((v) => !keys.some((k) => k.name === v.name))} sel={sel} setSel={setSel} mode={mode} height={240} ariaLabel="Variables" onTransfer={add} onDropNames={(_, ns) => remove(ns)} />
        </div>
        <div style={{ paddingTop: 22 }}>
          <button className="arrow-btn" disabled={!sel.names.length} aria-label="Move" onClick={() => (fromSource ? add(sel.names) : remove(sel.names))}>
            {fromSource || !sel.names.length ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
          </button>
        </div>
        <div className="col" style={{ flex: 1, minWidth: 0 }}>
          <span className="lbl-small">Sort by:</span>
          <VarListBox
            id="keys"
            vars={keys.map((k) => byName.get(k.name)).filter((v): v is Variable => !!v)}
            sel={sel}
            setSel={(s) => {
              setSel(s)
              const k = keys.find((x) => x.name === s.names[0])
              if (k) setOrder(k.desc ? 'D' : 'A')
            }}
            mode={mode}
            height={160}
            ariaLabel="Sort by"
            onTransfer={remove}
            onDropNames={(_, ns) => add(ns)}
            extraFor={(v) => (keys.find((k) => k.name === v.name)?.desc ? '(D)' : '(A)')}
          />
          <GroupBox title="Sort Order">
            {(['A', 'D'] as const).map((o) => (
              <Radio
                key={o}
                name="so"
                value={o}
                current={order}
                label={o === 'A' ? 'Ascending' : 'Descending'}
                onChange={(x) => {
                  setOrder(x)
                  if (sel.list === 'keys') setKeys(keys.map((k) => (sel.names.includes(k.name) ? { ...k, desc: x === 'D' } : k)))
                }}
              />
            ))}
          </GroupBox>
        </div>
      </div>
    </DialogShell>
  )
}

export function WeightCasesDialog() {
  const ds = useApp((s) => s.ds)
  const mode = useApp((s) => s.options.dialogLabels)
  const { close, run, paste } = useDialogActions()
  const currentName = ds.weightVarId ? ds.variables.find((v) => v.id === ds.weightVarId)?.name : undefined
  const [on, setOn] = useState(!!currentName)
  const [w, setW] = useState<string[]>(currentName ? [currentName] : [])
  const [sel, setSel] = useState<Sel>(noSel)
  const specs = (): CommandSpec[] => [{ proc: 'weight', variable: on ? w[0] : null }]
  const error = on && !w.length ? 'Choose a frequency variable.' : null
  return (
    <DialogShell title="Weight Cases" width={520} onClose={close} footer={<Footer error={error} onOk={() => run(specs())} onPaste={() => paste(specs())} onCancel={close} />}>
      <div className="row" style={{ alignItems: 'stretch', flexWrap: 'nowrap' }}>
        <div className="col" style={{ width: 210 }}>
          <span className="lbl-small">Variables:</span>
          <VarListBox
            id="source"
            vars={ds.variables.filter((v) => v.type === 'numeric' && !w.includes(v.name))}
            sel={sel}
            setSel={setSel}
            mode={mode}
            height={200}
            ariaLabel="Variables"
            onTransfer={(ns) => (setW([ns[0]]), setOn(true))}
            onDropNames={() => setW([])}
          />
        </div>
        <div className="col" style={{ flex: 1, gap: 6 }}>
          <Radio name="w" value="off" current={on ? 'on' : 'off'} label="Do not weight cases" onChange={() => setOn(false)} />
          <Radio name="w" value="on" current={on ? 'on' : 'off'} label="Weight cases by" onChange={() => setOn(true)} />
          <span className="lbl-small" style={{ marginLeft: 22 }}>
            Frequency Variable:
          </span>
          <div className="row" style={{ marginLeft: 22, flexWrap: 'nowrap' }}>
            <button className="arrow-btn" aria-label="Set frequency variable" disabled={!(sel.list === 'source' && sel.names.length)} onClick={() => (setW([sel.names[0]]), setOn(true))}>
              <ArrowRight size={16} />
            </button>
            <div className="varlist" style={{ height: 30, flex: 1 }}>
              {w.map((n) => {
                const v = getVar(ds, n)
                return v ? (
                  <div key={n} className="vitem" onDoubleClick={() => setW([])}>
                    <MeasureIcon v={v} />
                    {varDisplay(v, mode)}
                  </div>
                ) : null
              })}
            </div>
          </div>
          <div className="small muted">Current Status: {currentName ? `Weight cases by ${currentName}` : 'Do not weight cases'}</div>
        </div>
      </div>
    </DialogShell>
  )
}

export function AutoRecodeDialog() {
  const ds = useApp((s) => s.ds)
  const mode = useApp((s) => s.options.dialogLabels)
  const { close, run, paste } = useDialogActions()
  const [vars, setVars] = useState<string[]>([])
  const [into, setInto] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [desc, setDesc] = useState(false)
  const [sel, setSel] = useState<Sel>(noSel)
  const byName = useMemo(() => new Map(ds.variables.map((v) => [v.name, v])), [ds.variables])
  const cur = sel.list === 'vars' && sel.names.length === 1 ? sel.names[0] : null
  const error = !vars.length ? 'Select a variable.' : vars.some((v) => !into[v]) ? 'Give each variable a new name (Add New Name).' : null
  const specs = (): CommandSpec[] => [{ proc: 'autorecode', variables: vars, into: vars.map((v) => into[v]), descending: desc }, { proc: 'execute' }]
  return (
    <DialogShell title="Automatic Recode" width={620} onClose={close} footer={<Footer error={error} onOk={() => run(specs())} onPaste={() => paste(specs())} onCancel={close} />}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Converts string or numeric values into consecutive integers (1, 2, 3, …) and keeps the original values as value labels — handy after importing text data.
      </p>
      <div className="row" style={{ alignItems: 'stretch', flexWrap: 'nowrap' }}>
        <div className="col" style={{ width: 210 }}>
          <span className="lbl-small">Variables:</span>
          <VarListBox
            id="source"
            vars={ds.variables.filter((v) => !vars.includes(v.name))}
            sel={sel}
            setSel={setSel}
            mode={mode}
            height={220}
            ariaLabel="Variables"
            onTransfer={(ns) => setVars([...vars, ...ns])}
            onDropNames={(_, ns) => setVars(vars.filter((v) => !ns.includes(v)))}
          />
        </div>
        <div style={{ paddingTop: 22 }}>
          <button
            className="arrow-btn"
            aria-label="Move"
            disabled={!sel.names.length}
            onClick={() => (sel.list === 'source' ? setVars([...vars, ...sel.names]) : setVars(vars.filter((v) => !sel.names.includes(v))))}
          >
            {sel.list === 'vars' ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
          </button>
        </div>
        <div className="col" style={{ flex: 1, minWidth: 0 }}>
          <span className="lbl-small">Variable --&gt; New Name:</span>
          <VarListBox
            id="vars"
            vars={vars.map((n) => byName.get(n)).filter((v): v is Variable => !!v)}
            sel={sel}
            setSel={(s) => {
              setSel(s)
              if (s.names.length === 1) setNewName(into[s.names[0]] ?? '')
            }}
            mode={mode}
            height={140}
            ariaLabel="Variables to recode"
            onTransfer={(ns) => setVars(vars.filter((v) => !ns.includes(v)))}
            onDropNames={(_, ns) => setVars([...vars, ...ns])}
            extraFor={(v) => `--> ${into[v.name] ?? '????'}`}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <input className="input" placeholder="New name" value={newName} onChange={(e) => setNewName(e.target.value.trim())} disabled={!cur} style={{ width: 150 }} />
            <button
              className="btn small"
              disabled={!cur || !newName || !!validateVarName(newName, ds)}
              title={newName ? (validateVarName(newName, ds) ?? undefined) : undefined}
              onClick={() => cur && setInto({ ...into, [cur]: newName })}
            >
              Add New Name
            </button>
          </div>
          <GroupBox title="Recode Starting from">
            <Radio name="ar" value="lo" current={desc ? 'hi' : 'lo'} label="Lowest value" onChange={() => setDesc(false)} />
            <Radio name="ar" value="hi" current={desc ? 'hi' : 'lo'} label="Highest value" onChange={() => setDesc(true)} />
          </GroupBox>
        </div>
      </div>
    </DialogShell>
  )
}

export function RankDialog() {
  const ds = useApp((s) => s.ds)
  const mode = useApp((s) => s.options.dialogLabels)
  const { close, run, paste } = useDialogActions()
  const [vars, setVars] = useState<string[]>([])
  const [desc, setDesc] = useState(false)
  const [sel, setSel] = useState<Sel>(noSel)
  const byName = useMemo(() => new Map(ds.variables.map((v) => [v.name, v])), [ds.variables])
  const specs = (): CommandSpec[] => {
    const used = new Set(ds.variables.map((v) => v.name.toLowerCase()))
    const into = vars.map((v) => {
      let n = `R${v}`.slice(0, 60)
      let k = 1
      while (used.has(n.toLowerCase())) n = `R${v}_${k++}`
      used.add(n.toLowerCase())
      return n
    })
    return [{ proc: 'rank', variables: vars, into, descending: desc }]
  }
  return (
    <DialogShell title="Rank Cases" width={560} onClose={close} footer={<Footer error={vars.length ? null : 'Select a variable.'} onOk={() => run(specs())} onPaste={() => paste(specs())} onCancel={close} />}>
      <div className="row" style={{ alignItems: 'stretch', flexWrap: 'nowrap' }}>
        <div className="col" style={{ width: 210 }}>
          <span className="lbl-small">Variables:</span>
          <VarListBox
            id="source"
            vars={ds.variables.filter((v) => v.type === 'numeric' && !vars.includes(v.name))}
            sel={sel}
            setSel={setSel}
            mode={mode}
            height={200}
            ariaLabel="Variables"
            onTransfer={(ns) => setVars([...vars, ...ns])}
            onDropNames={(_, ns) => setVars(vars.filter((v) => !ns.includes(v)))}
          />
        </div>
        <div style={{ paddingTop: 22 }}>
          <button
            className="arrow-btn"
            aria-label="Move"
            disabled={!sel.names.length}
            onClick={() => (sel.list === 'source' ? setVars([...vars, ...sel.names]) : setVars(vars.filter((v) => !sel.names.includes(v))))}
          >
            {sel.list === 'vars' ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
          </button>
        </div>
        <div className="col" style={{ flex: 1 }}>
          <span className="lbl-small">Variable(s):</span>
          <VarListBox
            id="vars"
            vars={vars.map((n) => byName.get(n)).filter((v): v is Variable => !!v)}
            sel={sel}
            setSel={setSel}
            mode={mode}
            height={120}
            ariaLabel="Variables to rank"
            onTransfer={(ns) => setVars(vars.filter((v) => !ns.includes(v)))}
            onDropNames={(_, ns) => setVars([...vars, ...ns])}
          />
          <GroupBox title="Assign Rank 1 to">
            <Radio name="rk" value="s" current={desc ? 'l' : 's'} label="Smallest value" onChange={() => setDesc(false)} />
            <Radio name="rk" value="l" current={desc ? 'l' : 's'} label="Largest value" onChange={() => setDesc(true)} />
          </GroupBox>
          <p className="small muted">Ties receive the mean rank. New variables are named R + the variable name.</p>
        </div>
      </div>
    </DialogShell>
  )
}

// ------------------------------------------------------------------------- variable property editors

function useVariable(varId: unknown): Variable | undefined {
  return useApp((s) => s.ds.variables.find((v) => v.id === varId))
}

export function VarTypeDialog({ varId }: { varId: string }) {
  const v = useVariable(varId)
  const ds = useApp((s) => s.ds)
  const commit = useApp((s) => s.commit)
  const close = useApp((s) => s.closeDialog)
  const [type, setType] = useState(v?.type ?? 'numeric')
  const [width, setWidth] = useState(v?.width ?? 8)
  const [dec, setDec] = useState(v?.decimals ?? 2)
  if (!v) return null
  const lossy =
    type === 'numeric' && v.type === 'string' && ds.data[v.id].some((x) => String(x ?? '').trim() !== '' && Number.isNaN(Number(String(x).replace(',', '.'))))
  return (
    <DialogShell
      title="Variable Type"
      width={420}
      onClose={close}
      footer={
        <Footer
          onOk={() => {
            commit(updateVariable(ds, v.id, type === 'numeric' ? { type, width, decimals: dec } : { type, width }))
            close()
          }}
          onCancel={close}
        />
      }
    >
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="col">
          <Radio name="vt" value="numeric" current={type} label="Numeric" onChange={setType} />
          <Radio name="vt" value="string" current={type} label="String" onChange={setType} />
        </div>
        <div className="col" style={{ gap: 8 }}>
          <label className="row">
            <span style={{ width: 110 }}>{type === 'string' ? 'Characters:' : 'Width:'}</span>
            <input className="input" type="number" min={1} max={type === 'string' ? 32767 : 40} value={width} onChange={(e) => setWidth(Math.max(1, Number(e.target.value) || 1))} style={{ width: 80 }} />
          </label>
          {type === 'numeric' && (
            <label className="row">
              <span style={{ width: 110 }}>Decimal Places:</span>
              <input className="input" type="number" min={0} max={16} value={dec} onChange={(e) => setDec(Math.max(0, Math.min(16, Number(e.target.value) || 0)))} style={{ width: 80 }} />
            </label>
          )}
        </div>
      </div>
      {lossy && <p className="err-text">Some values are not numeric and will become system-missing.</p>}
    </DialogShell>
  )
}

export function ValueLabelsDialog({ varId }: { varId: string }) {
  const v = useVariable(varId)
  const ds = useApp((s) => s.ds)
  const commit = useApp((s) => s.commit)
  const close = useApp((s) => s.closeDialog)
  const [labels, setLabels] = useState<ValueLabel[]>(v?.valueLabels ?? [])
  const [val, setVal] = useState('')
  const [lab, setLab] = useState('')
  const [selIdx, setSelIdx] = useState<number | null>(null)
  if (!v) return null
  const parsed: number | string | null = v.type === 'numeric' ? (val.trim() === '' || Number.isNaN(Number(val)) ? null : Number(val)) : val
  const exists = labels.findIndex((l) => l.value === parsed)
  const sorted = (ls: ValueLabel[]) =>
    [...ls].sort((a, b) => (typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : String(a.value).localeCompare(String(b.value))))
  return (
    <DialogShell
      title={`Value Labels — ${v.name}`}
      width={480}
      onClose={close}
      footer={
        <Footer
          onOk={() => {
            commit(updateVariable(ds, v.id, { valueLabels: labels }))
            close()
          }}
          onCancel={close}
        />
      }
    >
      <GroupBox title="Value Labels">
        <div className="col" style={{ gap: 6 }}>
          <label className="row">
            <span style={{ width: 50 }}>Value:</span>
            <input className="input" value={val} onChange={(e) => setVal(e.target.value)} style={{ width: 120 }} data-autofocus />
          </label>
          <label className="row">
            <span style={{ width: 50 }}>Label:</span>
            <input
              className="input"
              value={lab}
              onChange={(e) => setLab(e.target.value)}
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && parsed !== null && lab && exists < 0) {
                  setLabels(sorted([...labels, { value: parsed, label: lab }]))
                  setVal('')
                  setLab('')
                }
              }}
            />
          </label>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <div className="col">
              <button
                className="btn small"
                disabled={parsed === null || !lab || exists >= 0}
                onClick={() => {
                  setLabels(sorted([...labels, { value: parsed!, label: lab }]))
                  setVal('')
                  setLab('')
                }}
              >
                Add
              </button>
              <button
                className="btn small"
                disabled={selIdx === null || parsed === null || !lab}
                onClick={() => setLabels(sorted(labels.map((l, i) => (i === selIdx ? { value: parsed!, label: lab } : l))))}
              >
                Change
              </button>
              <button
                className="btn small"
                disabled={selIdx === null}
                onClick={() => {
                  setLabels(labels.filter((_, i) => i !== selIdx))
                  setSelIdx(null)
                }}
              >
                Remove
              </button>
            </div>
            <div className="list-simple" style={{ height: 170, flex: 1 }} role="listbox" aria-label="Value labels">
              {labels.map((l, i) => (
                <div
                  key={i}
                  className={`li ${selIdx === i ? 'sel' : ''}`}
                  onMouseDown={() => {
                    setSelIdx(i)
                    setVal(String(l.value))
                    setLab(l.label)
                  }}
                >
                  {typeof l.value === 'number' ? formatValue(v, l.value) : `"${l.value}"`} = "{l.label}"
                </div>
              ))}
            </div>
          </div>
        </div>
      </GroupBox>
    </DialogShell>
  )
}

export function MissingValuesDialog({ varId }: { varId: string }) {
  const v = useVariable(varId)
  const ds = useApp((s) => s.ds)
  const commit = useApp((s) => s.commit)
  const close = useApp((s) => s.closeDialog)
  const m = v?.missing ?? { kind: 'none' as const }
  const [kind, setKind] = useState<MissingSpec['kind']>(m.kind)
  const [d, setD] = useState<string[]>(m.kind === 'discrete' ? [...m.values.map(String), '', '', ''].slice(0, 3) : ['', '', ''])
  const [lo, setLo] = useState(m.kind === 'range' && Number.isFinite(m.low) ? String(m.low) : '')
  const [hi, setHi] = useState(m.kind === 'range' && Number.isFinite(m.high) ? String(m.high) : '')
  const [rv, setRv] = useState(m.kind === 'range' && m.value !== undefined ? String(m.value) : '')
  if (!v) return null
  const isStr = v.type === 'string'
  let spec: MissingSpec | string
  if (kind === 'none') spec = { kind: 'none' }
  else if (kind === 'discrete') {
    const vals = d.filter((x) => x.trim() !== '')
    if (!vals.length) spec = 'Enter at least one discrete missing value.'
    else if (!isStr && vals.some((x) => Number.isNaN(Number(x)))) spec = 'Missing values must be numbers.'
    else spec = { kind: 'discrete', values: isStr ? vals : vals.map(Number) }
  } else {
    if (lo === '' || hi === '' || Number.isNaN(Number(lo)) || Number.isNaN(Number(hi)) || Number(lo) > Number(hi)) spec = 'Enter a valid range (Low ≤ High).'
    else if (rv !== '' && Number.isNaN(Number(rv))) spec = 'The discrete value must be a number.'
    else spec = { kind: 'range', low: Number(lo), high: Number(hi), value: rv === '' ? undefined : Number(rv) }
  }
  const affected = typeof spec === 'string' ? 0 : ds.data[v.id].filter((x) => isMissing({ ...v, missing: spec as MissingSpec }, x) && x !== null).length
  return (
    <DialogShell
      title={`Missing Values — ${v.name}`}
      width={440}
      onClose={close}
      footer={
        <Footer
          error={typeof spec === 'string' ? spec : null}
          onOk={() => {
            if (typeof spec === 'string') return
            commit(updateVariable(ds, v.id, { missing: spec }))
            close()
          }}
          onCancel={close}
        />
      }
    >
      <div className="col" style={{ gap: 6 }}>
        <Radio name="mv" value="none" current={kind} label="No missing values" onChange={setKind} />
        <Radio name="mv" value="discrete" current={kind} label="Discrete missing values" onChange={setKind} />
        <div className="row" style={{ marginLeft: 22 }}>
          {d.map((x, i) => (
            <input key={i} className="input" style={{ width: 80 }} disabled={kind !== 'discrete'} value={x} aria-label={`Discrete value ${i + 1}`} onChange={(e) => setD(d.map((y, j) => (j === i ? e.target.value : y)))} />
          ))}
        </div>
        <Radio name="mv" value="range" current={kind} label="Range plus one optional discrete missing value" onChange={setKind} disabled={isStr} />
        <div className="row" style={{ marginLeft: 22 }}>
          <span>Low:</span>
          <input className="input" style={{ width: 70 }} disabled={kind !== 'range'} value={lo} onChange={(e) => setLo(e.target.value)} />
          <span>High:</span>
          <input className="input" style={{ width: 70 }} disabled={kind !== 'range'} value={hi} onChange={(e) => setHi(e.target.value)} />
        </div>
        <div className="row" style={{ marginLeft: 22 }}>
          <span>Discrete value:</span>
          <input className="input" style={{ width: 70 }} disabled={kind !== 'range'} value={rv} onChange={(e) => setRv(e.target.value)} />
        </div>
        <p className="small muted">
          Currently: {missingText(v)}. {typeof spec !== 'string' && kind !== 'none' ? `${affected} case(s) will be treated as missing.` : ''}
        </p>
      </div>
    </DialogShell>
  )
}

// ------------------------------------------------------------------------- navigation & utilities

export function GoToCaseDialog() {
  const close = useApp((s) => s.closeDialog)
  const goToCase = useApp((s) => s.goToCase)
  const n = useApp((s) => s.ds.nCases)
  const [v, setV] = useState('1')
  const ok = Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= Math.max(1, n)
  return (
    <DialogShell
      title="Go To Case"
      width={320}
      onClose={close}
      footer={
        <Footer
          okLabel="Go"
          error={ok ? null : `Enter a case number from 1 to ${Math.max(1, n)}.`}
          onOk={() => {
            close()
            goToCase(Number(v) - 1)
          }}
          onCancel={close}
        />
      }
    >
      <label className="row">
        <span>Go to case number:</span>
        <input className="input" type="number" min={1} max={n} value={v} onChange={(e) => setV(e.target.value)} style={{ width: 100 }} data-autofocus />
      </label>
    </DialogShell>
  )
}

export function GoToVariableDialog() {
  const ds = useApp((s) => s.ds)
  const close = useApp((s) => s.closeDialog)
  const mode = useApp((s) => s.options.dialogLabels)
  const [sel, setSel] = useState<Sel>(noSel)
  const go = (name?: string) => {
    const v = getVar(ds, name ?? sel.names[0] ?? '')
    if (!v) return
    close()
    useApp.setState({ focusVarId: v.id })
    const st = useApp.getState()
    if (st.win !== 'data') st.setWin('data')
  }
  return (
    <DialogShell title="Go To Variable" width={360} onClose={close} footer={<Footer okLabel="Go" error={sel.names.length ? null : 'Select a variable.'} onOk={() => go()} onCancel={close} />}>
      <VarListBox id="v" vars={ds.variables} sel={sel} setSel={setSel} mode={mode} height={260} ariaLabel="Variables" onTransfer={(ns) => go(ns[0])} onDropNames={() => {}} />
    </DialogShell>
  )
}

export function VariablesInfoDialog({ varId }: { varId?: string }) {
  const ds = useApp((s) => s.ds)
  const close = useApp((s) => s.closeDialog)
  const mode = useApp((s) => s.options.dialogLabels)
  const first = ds.variables.find((v) => v.id === varId) ?? ds.variables[0]
  const [sel, setSel] = useState<Sel>({ list: 'v', names: first ? [first.name] : [], anchor: null })
  const v = getVar(ds, sel.names[0] ?? '')
  const valid = v ? ds.data[v.id].filter((x) => !isMissing(v, x)).length : 0
  const rows: [string, ReactNode][] = v
    ? [
        ['Name', v.name],
        ['Label', v.label || <span key="l" className="muted">none</span>],
        ['Type', v.type === 'numeric' ? `Numeric (F${v.width}.${v.decimals})` : `String (A${v.width})`],
        ['Missing Values', missingText(v)],
        ['Measurement Level', v.measure.charAt(0).toUpperCase() + v.measure.slice(1)],
        ['Valid / Missing', `${valid} / ${ds.nCases - valid}`],
        [
          'Value Labels',
          v.valueLabels.length ? (
            <div key="vl">
              {v.valueLabels.map((l) => (
                <div key={String(l.value)}>
                  {typeof l.value === 'number' ? formatValue(v, l.value) : `"${l.value}"`} = {l.label}
                </div>
              ))}
            </div>
          ) : (
            <span key="vl" className="muted">none</span>
          ),
        ],
      ]
    : []
  return (
    <DialogShell title="Variables" width={620} onClose={close} footer={<button className="btn primary" onClick={close}>Close</button>}>
      <div className="row" style={{ alignItems: 'stretch', flexWrap: 'nowrap' }}>
        <div style={{ width: 220 }}>
          <VarListBox id="v" vars={ds.variables} sel={sel} setSel={setSel} mode={mode} height={300} ariaLabel="Variables" onTransfer={() => {}} onDropNames={() => {}} />
        </div>
        <div className="help-doc" style={{ flex: 1 }}>
          <span className="lbl-small">Variable Information:</span>
          <table>
            <tbody>
              {rows.map(([k, val]) => (
                <tr key={k}>
                  <td style={{ width: 130, color: 'var(--text-2)' }}>{k}</td>
                  <td>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DialogShell>
  )
}

export function OptionsDialog() {
  const options = useApp((s) => s.options)
  const setOptions = useApp((s) => s.setOptions)
  const close = useApp((s) => s.closeDialog)
  const [o, setO] = useState(options)
  return (
    <DialogShell
      title="Options"
      width={460}
      onClose={close}
      footer={
        <Footer
          onOk={() => {
            setOptions(o)
            close()
          }}
          onCancel={close}
        />
      }
    >
      <GroupBox title="Variable Lists">
        <Radio name="dl" value="labels" current={o.dialogLabels} label="Display labels" onChange={(x) => setO({ ...o, dialogLabels: x })} />
        <Radio name="dl" value="names" current={o.dialogLabels} label="Display names" onChange={(x) => setO({ ...o, dialogLabels: x })} />
        <div style={{ height: 6 }} />
        <Radio name="ds" value="file" current={o.dialogSort} label="File order" onChange={(x) => setO({ ...o, dialogSort: x })} />
        <Radio name="ds" value="alpha" current={o.dialogSort} label="Alphabetical" onChange={(x) => setO({ ...o, dialogSort: x })} />
      </GroupBox>
      <GroupBox title="Output">
        <Check label="Display a leading zero for decimal values (0.123 instead of .123)" checked={o.leadingZero} onChange={(x) => setO({ ...o, leadingZero: x })} />
        <p className="small muted">Applies to output produced after the change.</p>
      </GroupBox>
    </DialogShell>
  )
}

// ------------------------------------------------------------------------- file import

export function ImportCsvDialog({ text, fileName }: { text: string; fileName: string }) {
  const close = useApp((s) => s.closeDialog)
  const replace = useApp((s) => s.replaceDataset)
  const notify = useApp((s) => s.notify)
  const [delim, setDelim] = useState<'auto' | ',' | ';' | '\t' | '|'>('auto')
  const [header, setHeader] = useState(true)
  const [decimal, setDecimal] = useState<'auto' | '.' | ','>('auto')
  const d = delim === 'auto' ? detectDelimiter(text) : delim
  const preview = useMemo(() => parseDelimited(text.split(/\r?\n/).slice(0, 8).join('\n'), d), [text, d])
  const dsPreview = useMemo(() => {
    try {
      return datasetFromCSV(text.split(/\r?\n/).slice(0, 300).join('\n'), { delimiter: d, header, decimal })
    } catch {
      return null
    }
  }, [text, d, header, decimal])
  return (
    <DialogShell
      title={`Text Import — ${fileName}`}
      width={760}
      onClose={close}
      footer={
        <Footer
          okLabel="Import"
          onOk={() => {
            try {
              const ds = datasetFromCSV(text, { delimiter: d, header, decimal }, fileName)
              replace(ds)
              close()
              notify(`Imported ${ds.nCases} cases and ${ds.variables.length} variables.`)
            } catch (e) {
              notify((e as Error).message, 'error')
            }
          }}
          onCancel={close}
        />
      }
    >
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="row">
          Delimiter:
          <select className="input" value={delim} onChange={(e) => setDelim(e.target.value as typeof delim)}>
            <option value="auto">Detect ({d === '\t' ? 'tab' : d})</option>
            <option value=",">Comma</option>
            <option value=";">Semicolon</option>
            <option value={'\t'}>Tab</option>
            <option value="|">Pipe</option>
          </select>
        </label>
        <label className="row">
          Decimal symbol:
          <select className="input" value={decimal} onChange={(e) => setDecimal(e.target.value as typeof decimal)}>
            <option value="auto">Detect</option>
            <option value=".">Period (1.5)</option>
            <option value=",">Comma (1,5)</option>
          </select>
        </label>
        <Check label="First row contains variable names" checked={header} onChange={setHeader} />
      </div>
      <div style={{ overflow: 'auto', maxHeight: 220, border: '1px solid var(--line)', background: '#fff' }}>
        <table className="chart-data" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {preview.map((r, i) => (
              <tr key={i} style={i === 0 && header ? { fontWeight: 700, background: 'var(--header)' } : undefined}>
                {r.map((c, j) => (
                  <td key={j} style={{ border: '1px solid var(--line-2)', padding: '2px 6px', whiteSpace: 'nowrap' }}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dsPreview && (
        <p className="small muted">
          Detected variables:{' '}
          {dsPreview.variables
            .slice(0, 12)
            .map((v) => `${v.name} (${v.type === 'numeric' ? 'numeric' : 'string'})`)
            .join(', ')}
          {dsPreview.variables.length > 12 ? '…' : ''}
        </p>
      )}
    </DialogShell>
  )
}

// ------------------------------------------------------------------------- welcome / about / help

export function WelcomeDialog({ onOpenFile }: { onOpenFile: () => void }) {
  const close = useApp((s) => s.closeDialog)
  const replace = useApp((s) => s.replaceDataset)
  return (
    <DialogShell title="Welcome to VennStat" width={720} onClose={close} footer={<button className="btn" onClick={close}>Start with an empty dataset</button>}>
      <div className="row" style={{ alignItems: 'center', marginBottom: 10, flexWrap: 'nowrap' }}>
        <Logo size={44} />
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>VennStat</div>
          <div className="muted">A statistics package in your browser — Data &amp; Variable View, SPSS-style dialogs, pivot-table output and command syntax. Your data never leaves this tab.</div>
        </div>
      </div>
      <h3 style={{ fontSize: 13, margin: '12px 0 6px' }}>Open a sample dataset</h3>
      <div className="welcome-grid">
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            className="card-btn"
            onClick={() => {
              replace(s.load())
              close()
            }}
          >
            <strong>{s.name}</strong>
            <span className="small muted">{s.description}</span>
          </button>
        ))}
      </div>
      <h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Or bring your own data</h3>
      <div className="row">
        <button
          className="btn primary"
          onClick={() => {
            close()
            onOpenFile()
          }}
        >
          Open a data file…
        </button>
        <span className="small muted">SPSS .sav, CSV / TSV text, or a VennStat project (.vstat). You can also type data straight into the Data View.</span>
      </div>
    </DialogShell>
  )
}

export function AboutDialog() {
  const close = useApp((s) => s.closeDialog)
  return (
    <DialogShell title="About VennStat" width={480} onClose={close} footer={<button className="btn primary" onClick={close}>OK</button>}>
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <Logo size={48} />
        <div className="help-doc">
          <p style={{ marginTop: 0 }}>
            <b>VennStat</b> 0.1 — an open-source statistics package that runs entirely in the browser, modelled on the workflow of IBM SPSS
            Statistics. It is an independent project and is not affiliated with or endorsed by IBM.
          </p>
          <p>
            The numerical routines (t, F, χ², studentized range, Shapiro-Wilk, Lilliefors, regression, reliability) are tested against
            SciPy, statsmodels and pingouin reference values.
          </p>
        </div>
      </div>
    </DialogShell>
  )
}

const SYNTAX_REF: [string, string][] = [
  ['FREQUENCIES', 'FREQUENCIES VARIABLES=v1 v2 /FORMAT=NOTABLE /STATISTICS=MEAN MEDIAN MODE STDDEV ... /PERCENTILES=10 90 /NTILES=4 /BARCHART FREQ | /PIECHART | /HISTOGRAM NORMAL'],
  ['DESCRIPTIVES', 'DESCRIPTIVES VARIABLES=v1 v2 /STATISTICS=MEAN STDDEV MIN MAX SEMEAN VARIANCE RANGE SUM SKEWNESS KURTOSIS /SAVE /SORT=MEAN (A|D)'],
  ['EXAMINE', 'EXAMINE VARIABLES=dep BY factor /PLOT BOXPLOT STEMLEAF HISTOGRAM NPPLOT /COMPARE GROUPS|VARIABLES /STATISTICS DESCRIPTIVES EXTREME /PERCENTILES /CINTERVAL 95 /NOTOTAL'],
  ['CROSSTABS', 'CROSSTABS /TABLES=r BY c /STATISTICS=CHISQ PHI CC RISK /CELLS=COUNT EXPECTED ROW COLUMN TOTAL RESID SRESID ASRESID /BARCHART'],
  ['MEANS', 'MEANS TABLES=dep BY indep /CELLS=MEAN COUNT STDDEV MEDIAN ... /STATISTICS ANOVA'],
  ['T-TEST', 'T-TEST /TESTVAL=0 /VARIABLES=v · T-TEST GROUPS=g(1 2) /VARIABLES=v · T-TEST PAIRS=a WITH b (PAIRED) · /CRITERIA=CI(.95)'],
  ['ONEWAY', 'ONEWAY dep BY factor /STATISTICS DESCRIPTIVES HOMOGENEITY WELCH BROWNFORSYTHE /PLOT MEANS /POSTHOC=TUKEY BONFERRONI SCHEFFE LSD SIDAK GH ALPHA(0.05)'],
  ['CORRELATIONS', 'CORRELATIONS /VARIABLES=a b c /PRINT=TWOTAIL|ONETAIL NOSIG|SIG /STATISTICS DESCRIPTIVES /MISSING=PAIRWISE|LISTWISE'],
  ['NONPAR CORR', 'NONPAR CORR /VARIABLES=a b /PRINT=SPEARMAN|KENDALL|BOTH TWOTAIL NOSIG'],
  ['REGRESSION', 'REGRESSION /STATISTICS COEFF OUTS CI(95) R ANOVA COLLIN TOL CHANGE ZPP /DEPENDENT y /METHOD=ENTER|STEPWISE|FORWARD|BACKWARD x1 x2 /RESIDUALS DURBIN HISTOGRAM(ZRESID) NORMPROB(ZRESID) /SCATTERPLOT=(*ZRESID,*ZPRED) /SAVE PRED ZPRED RESID ZRESID'],
  ['RELIABILITY', "RELIABILITY /VARIABLES=i1 TO i5 /SCALE('name') ALL /MODEL=ALPHA|SPLIT /STATISTICS=DESCRIPTIVE SCALE CORR /SUMMARY=TOTAL"],
  ['NPAR TESTS', 'NPAR TESTS /CHISQUARE=v (1,4) /EXPECTED=EQUAL|values /M-W=v BY g(1 2) /K-W=v BY g(1 3) /WILCOXON=a WITH b (PAIRED) /FRIEDMAN=a b c /K-S(NORMAL)=v'],
  ['GRAPH', 'GRAPH /BAR(SIMPLE)=COUNT|PCT|MEAN(v) BY cat · /BAR(GROUPED)=COUNT BY cat BY cluster · /LINE(SIMPLE)=MEAN(v) BY cat · /PIE=COUNT BY cat · /HISTOGRAM(NORMAL)=v · /SCATTERPLOT(BIVAR)=x WITH y BY g /FITLINE TOTAL'],
  ['COMPUTE / IF', 'COMPUTE target = expression. · IF (condition) target = expression. Functions: MEAN, SUM, SD, MIN, MAX, ABS, SQRT, LN, EXP, RND, TRUNC, MOD, MISSING, SYSMIS, VALUE, ANY, RANGE, CDF.NORMAL, IDF.NORMAL, CONCAT, UPCASE, CHAR.SUBSTR, NUMBER, STRING, RV.NORMAL, UNIFORM …'],
  ['RECODE', 'RECODE v (1 THRU 3=1) (4,5=2) (LO THRU 0=SYSMIS) (MISSING=9) (ELSE=COPY) [INTO newvar].'],
  ['Data management', 'SORT CASES BY v (A|D) · SELECT IF (cond) · FILTER BY v / FILTER OFF · USE ALL · WEIGHT BY v / WEIGHT OFF · SAMPLE .1 / SAMPLE 50 FROM 200 · AUTORECODE VARIABLES=s /INTO n · RANK VARIABLES=v (A) /RANK INTO r · DELETE VARIABLES · RENAME VARIABLES (a=b) · EXECUTE'],
  ['Dictionary', "VARIABLE LABELS v 'label' · VALUE LABELS v 1 'a' 2 'b' · ADD VALUE LABELS · MISSING VALUES v (9, 99) / (LO THRU 0) · VARIABLE LEVEL v (SCALE|ORDINAL|NOMINAL) · FORMATS v (F8.2) · STRING s (A10) · NUMERIC n (F8.2)"],
]

export function HelpDialog({ topic }: { topic?: string }) {
  const close = useApp((s) => s.closeDialog)
  const pasteText = (t: string) => {
    const st = useApp.getState()
    st.setSyntax(st.syntax ? `${st.syntax.replace(/\s*$/, '')}\n${t}\n` : `${t}\n`)
    st.setWin('syntax')
    close()
  }
  if (topic === 'syntax')
    return (
      <DialogShell title="Command Syntax Reference" width={820} onClose={close} footer={<button className="btn primary" onClick={close}>Close</button>}>
        <div className="help-doc" style={{ maxWidth: 'none' }}>
          <p style={{ marginTop: 0 }}>
            Commands end with a period. Keywords can be abbreviated to their first three letters, are case-insensitive, and variable lists accept <code>TO</code> and <code>ALL</code>.
            Comments start with <code>*</code> or <code>/* … */</code>. Run commands with <span className="kbd">Ctrl</span>+<span className="kbd">R</span> in the Syntax Editor.
          </p>
          <table>
            <tbody>
              {SYNTAX_REF.map(([k, v]) => (
                <tr key={k}>
                  <td style={{ width: 130, fontWeight: 600 }}>{k}</td>
                  <td>
                    <code>{v}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Example</h3>
          <pre>{`GET FILE='survey.sav'.   * GET is ignored in the browser — open files from the File menu.
COMPUTE satisfaction = MEAN(sat1 TO sat5).
RELIABILITY /VARIABLES=sat1 TO sat5 /MODEL=ALPHA /SUMMARY=TOTAL.
REGRESSION /DEPENDENT gpa /METHOD=ENTER hours_study sleep_hours stress.`}</pre>
          <button className="btn small" onClick={() => pasteText('COMPUTE satisfaction = MEAN(sat1 TO sat5).\nEXECUTE.')}>
            Paste a COMPUTE example into the Syntax Editor
          </button>
        </div>
      </DialogShell>
    )
  if (topic === 'shortcuts')
    return (
      <DialogShell title="Keyboard Shortcuts" width={520} onClose={close} footer={<button className="btn primary" onClick={close}>Close</button>}>
        <div className="help-doc">
          <table>
            <tbody>
              {[
                ['Ctrl+O', 'Open data file'],
                ['Ctrl+S', 'Save data'],
                ['Ctrl+Z / Ctrl+Y', 'Undo / Redo data changes'],
                ['Ctrl+1 / 2 / 3', 'Data Editor / Output Viewer / Syntax Editor'],
                ['Ctrl+R', 'Run selection or current command (Syntax Editor)'],
                ['Ctrl+Shift+R', 'Run all syntax'],
                ['Arrow keys, Tab, Enter', 'Move between cells'],
                ['F2 or start typing', 'Edit the active cell'],
                ['Ctrl+C / Ctrl+V / Del', 'Copy / paste / clear cells (tab-separated, works with Excel)'],
                ['Shift+click, Shift+arrows', 'Select a range of cells'],
                ['Double-click a column header', 'Open the variable in Variable View'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ width: 200 }}>
                    <span className="kbd">{k}</span>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogShell>
    )
  return (
    <DialogShell title="Getting Started" width={680} onClose={close} footer={<button className="btn primary" onClick={close}>Close</button>}>
      <div className="help-doc">
        <h3 style={{ marginTop: 0 }}>1. Get data in</h3>
        <p>
          Use <b>File ▸ Open Data</b> for SPSS <code>.sav</code>, CSV/TSV text or VennStat projects, <b>File ▸ Open Sample Data</b> for ready-made
          datasets, or type and paste values into the <b>Data View</b> (paste works straight from Excel or Google Sheets).
        </p>
        <h3>2. Describe your variables</h3>
        <p>
          In <b>Variable View</b> set each variable's name, label, value labels (e.g. 1 = Male), missing values and measurement level. Labels
          appear in dialogs and output; toggle <b>View ▸ Value Labels</b> to see them in the grid.
        </p>
        <h3>3. Analyze</h3>
        <p>
          Pick a procedure from <b>Analyze</b> or <b>Graphs</b>, move variables into the target lists with the arrow buttons (or
          double-click), set options with the buttons on the right and click <b>OK</b>. Results appear in the <b>Output Viewer</b>; hover a
          table to copy it into Word or Google Docs.
        </p>
        <h3>4. Reproduce it with syntax</h3>
        <p>
          <b>Paste</b> in any dialog writes the equivalent command to the <b>Syntax Editor</b>. Save it as a <code>.sps</code> file and run it again later
          — on the same or a different dataset.
        </p>
        <h3>Common recipes</h3>
        <ul>
          <li>Normality test: Analyze ▸ Descriptive Statistics ▸ Explore ▸ Plots… ▸ Normality plots with tests.</li>
          <li>Questionnaire validity & reliability: Analyze ▸ Correlate ▸ Bivariate (item–total), and Analyze ▸ Scale ▸ Reliability Analysis ▸ Statistics… ▸ Scale if item deleted.</li>
          <li>Classical assumption tests for regression: Linear Regression ▸ Statistics… (Collinearity, Durbin-Watson), Plots… (Normal probability plot), Save… residuals then 1-Sample K-S.</li>
        </ul>
      </div>
    </DialogShell>
  )
}

