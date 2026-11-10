// Declarative SPSS-style dialogs: a source variable list, target lists with arrow buttons,
// option controls, sub-dialogs ("Statistics…", "Options…") and the OK / Paste / Reset / Cancel / Help row.

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Dataset, Variable } from '../../core/dataset'
import type { CommandSpec } from '../../procedures/types'
import { useApp } from '../../state/store'
import { Check, DialogShell, GroupBox, MeasureIcon, Radio } from '../common'
import { varDisplay } from './util'

export type Values = Record<string, unknown>

export interface DState {
  lists: Record<string, string[]>
  v: Values
}

export interface DialogCtx {
  ds: Dataset
  st: DState
  set: (patch: Partial<Values>) => void
  setLists: (patch: Record<string, string[]>) => void
  openSub: (key: string) => void
}

export interface TargetDef {
  key: string
  label: string
  /** Maximum number of variables (1 = single variable box). */
  max?: number
  rows?: number
  accept?: (v: Variable) => boolean
  kind?: 'vars' | 'pairs'
  /** Extra UI under the list (e.g. "Define Groups…" button or a test value). */
  after?: (ctx: DialogCtx) => ReactNode
}

export type Control =
  | { type: 'check'; key: string; label: string; disabled?: (st: DState) => boolean }
  | {
      type: 'radio'
      key: string
      label?: string
      options: { value: string; label: string }[]
      disabled?: (st: DState) => boolean
      inline?: boolean
    }
  | { type: 'number'; key: string; label: string; min?: number; max?: number; step?: number; width?: number; disabled?: (st: DState) => boolean }
  | { type: 'text'; key: string; label: string; width?: number; placeholder?: string; disabled?: (st: DState) => boolean }
  | { type: 'select'; key: string; label: string; options: { value: string; label: string }[]; disabled?: (st: DState) => boolean }
  | { type: 'group'; label: string; children: Control[]; columns?: number }
  | { type: 'row'; children: Control[] }
  | { type: 'note'; text: string }
  | { type: 'custom'; render: (ctx: DialogCtx) => ReactNode }

export interface SubDialogDef {
  key: string
  label: string
  /** false = opened from a custom button (e.g. "Define Groups…") instead of the side column. */
  side?: boolean
  title: string
  width?: number
  controls: Control[]
  enabled?: (st: DState) => boolean
  validate?: (st: DState) => string | null
}

export interface DialogDef {
  id: string
  title: string
  width?: number
  sourceFilter?: (v: Variable) => boolean
  targets: TargetDef[]
  /** Controls shown below the target lists (right column). */
  controls?: Control[]
  /** Controls spanning the full width below the picker. */
  bottom?: Control[]
  subs?: SubDialogDef[]
  defaults: () => DState
  validate?: (st: DState, ds: Dataset) => string | null
  build: (st: DState, ds: Dataset) => CommandSpec[]
  help: string
}

// ------------------------------------------------------------------------- variable list item

function VarItem({
  v,
  selected,
  mode,
  onMouseDown,
  onDoubleClick,
  onDragStart,
  extra,
}: {
  v: Variable
  selected: boolean
  mode: 'labels' | 'names'
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onDragStart: (e: React.DragEvent) => void
  extra?: string
}) {
  return (
    <div
      className={`vitem ${selected ? 'sel' : ''}`}
      role="option"
      aria-selected={selected}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      draggable
      onDragStart={onDragStart}
      title={v.label ? `${v.label} [${v.name}]` : v.name}
    >
      <MeasureIcon v={v} />
      <span className="nm">{varDisplay(v, mode)}</span>
      {extra && <span className="extra">{extra}</span>}
    </div>
  )
}

interface Sel {
  list: string
  names: string[]
  anchor: string | null
}

/** A list box of variables with multi-selection, keyboard navigation and drag & drop. */
export function VarListBox({
  id,
  vars,
  sel,
  setSel,
  onTransfer,
  onDropNames,
  mode,
  height,
  ariaLabel,
  extraFor,
  emptyHint,
}: {
  id: string
  vars: Variable[]
  sel: Sel
  setSel: (s: Sel) => void
  onTransfer: (names: string[]) => void
  onDropNames: (from: string, names: string[]) => void
  mode: 'labels' | 'names'
  height: number
  ariaLabel: string
  extraFor?: (v: Variable) => string | undefined
  emptyHint?: string
}) {
  const [over, setOver] = useState(false)
  const mine = sel.list === id ? sel.names : []
  const click = (e: React.MouseEvent, v: Variable) => {
    if (e.button !== 0) return
    if (e.shiftKey && sel.list === id && sel.anchor) {
      const a = vars.findIndex((x) => x.name === sel.anchor)
      const b = vars.findIndex((x) => x.name === v.name)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      setSel({ list: id, names: vars.slice(lo, hi + 1).map((x) => x.name), anchor: sel.anchor })
    } else if ((e.ctrlKey || e.metaKey) && sel.list === id) {
      const has = mine.includes(v.name)
      setSel({ list: id, names: has ? mine.filter((n) => n !== v.name) : [...mine, v.name], anchor: v.name })
    } else setSel({ list: id, names: [v.name], anchor: v.name })
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!vars.length) return
    const cur = sel.list === id && sel.anchor ? vars.findIndex((x) => x.name === sel.anchor) : -1
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.max(0, Math.min(vars.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))
      const name = vars[next].name
      if (e.shiftKey && cur >= 0) {
        const a = vars.findIndex((x) => x.name === (sel.names[0] ?? name))
        const [lo, hi] = a < next ? [a, next] : [next, a]
        setSel({ list: id, names: vars.slice(lo, hi + 1).map((x) => x.name), anchor: name })
      } else setSel({ list: id, names: [name], anchor: name })
    } else if (e.key === 'Enter' && mine.length) {
      e.preventDefault()
      onTransfer(mine)
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault()
      setSel({ list: id, names: vars.map((x) => x.name), anchor: vars[0].name })
    }
  }
  return (
    <div
      className={`varlist ${over ? 'drop' : ''}`}
      style={{ height }}
      tabIndex={0}
      role="listbox"
      aria-multiselectable
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        try {
          const d = JSON.parse(e.dataTransfer.getData('text/plain')) as { from: string; names: string[] }
          if (d.from !== id) onDropNames(d.from, d.names)
        } catch {
          /* ignore foreign drops */
        }
      }}
    >
      {vars.map((v) => (
        <VarItem
          key={v.id}
          v={v}
          mode={mode}
          selected={mine.includes(v.name)}
          onMouseDown={(e) => click(e, v)}
          onDoubleClick={() => onTransfer([v.name])}
          onDragStart={(e) => {
            const names = mine.includes(v.name) ? mine : [v.name]
            if (!mine.includes(v.name)) setSel({ list: id, names, anchor: v.name })
            e.dataTransfer.setData('text/plain', JSON.stringify({ from: id, names }))
          }}
          extra={extraFor?.(v)}
        />
      ))}
      {!vars.length && emptyHint && <div className="empty-hint">{emptyHint}</div>}
    </div>
  )
}

// ------------------------------------------------------------------------- controls

export function Controls({ controls, ctx }: { controls: Control[]; ctx: DialogCtx }) {
  return (
    <>
      {controls.map((c, i) => (
        <ControlView key={i} c={c} ctx={ctx} />
      ))}
    </>
  )
}

function ControlView({ c, ctx }: { c: Control; ctx: DialogCtx }) {
  const { st, set } = ctx
  switch (c.type) {
    case 'check':
      return <Check label={c.label} checked={!!st.v[c.key]} disabled={c.disabled?.(st)} onChange={(x) => set({ [c.key]: x })} />
    case 'radio':
      return (
        <div className={c.inline ? 'row' : 'col'} role="radiogroup" aria-label={c.label}>
          {c.label && <span className="lbl-small">{c.label}</span>}
          {c.options.map((o) => (
            <Radio
              key={o.value}
              name={`${c.key}`}
              value={o.value}
              current={String(st.v[c.key])}
              label={o.label}
              disabled={c.disabled?.(st)}
              onChange={(x) => set({ [c.key]: x })}
            />
          ))}
        </div>
      )
    case 'number':
      return (
        <label className="row" style={{ gap: 6 }}>
          <span>{c.label}</span>
          <input
            className="input"
            type="number"
            style={{ width: c.width ?? 80 }}
            min={c.min}
            max={c.max}
            step={c.step ?? 'any'}
            disabled={c.disabled?.(st)}
            value={String(st.v[c.key] ?? '')}
            onChange={(e) => set({ [c.key]: e.target.value === '' ? '' : Number(e.target.value) })}
          />
        </label>
      )
    case 'text':
      return (
        <label className="row" style={{ gap: 6 }}>
          <span>{c.label}</span>
          <input
            className="input"
            style={{ width: c.width ?? 160 }}
            placeholder={c.placeholder}
            disabled={c.disabled?.(st)}
            value={String(st.v[c.key] ?? '')}
            onChange={(e) => set({ [c.key]: e.target.value })}
          />
        </label>
      )
    case 'select':
      return (
        <label className="row" style={{ gap: 6 }}>
          <span>{c.label}</span>
          <select className="input" disabled={c.disabled?.(st)} value={String(st.v[c.key])} onChange={(e) => set({ [c.key]: e.target.value })}>
            {c.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )
    case 'group':
      return (
        <GroupBox title={c.label}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${c.columns ?? 1}, minmax(0, 1fr))`, gap: '2px 14px' }}>
            <Controls controls={c.children} ctx={ctx} />
          </div>
        </GroupBox>
      )
    case 'row':
      return (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Controls controls={c.children} ctx={ctx} />
        </div>
      )
    case 'note':
      return <div className="muted small">{c.text}</div>
    case 'custom':
      return <>{c.render(ctx)}</>
  }
}

// ------------------------------------------------------------------------- generic dialog

function cleanState(def: DialogDef, saved: DState | undefined, ds: Dataset): DState {
  const base = def.defaults()
  if (!saved) return base
  const names = new Set(ds.variables.map((v) => v.name))
  const lists: Record<string, string[]> = {}
  for (const t of def.targets) {
    const items = saved.lists[t.key] ?? []
    lists[t.key] =
      t.kind === 'pairs'
        ? items.filter((p) => p.split('|').every((n) => !n || names.has(n)))
        : items.filter((n) => names.has(n))
  }
  return { lists, v: { ...base.v, ...saved.v } }
}

export function GenericDialog({ def }: { def: DialogDef }) {
  const ds = useApp((s) => s.ds)
  const memory = useApp((s) => s.dialogMemory[def.id]) as DState | undefined
  const options = useApp((s) => s.options)
  const close = useApp((s) => s.closeDialog)
  const runSpecs = useApp((s) => s.runSpecs)
  const pasteSyntax = useApp((s) => s.pasteSyntax)
  const remember = useApp((s) => s.rememberDialog)
  const notify = useApp((s) => s.notify)
  const [st, setSt] = useState<DState>(() => cleanState(def, memory, ds))
  const [sel, setSel] = useState<Sel>({ list: 'source', names: [], anchor: null })
  const [sub, setSub] = useState<string | null>(null)
  const [subState, setSubState] = useState<DState | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  const set = useCallback((patch: Partial<Values>) => setSt((s) => ({ ...s, v: { ...s.v, ...patch } })), [])
  const setLists = useCallback((patch: Record<string, string[]>) => setSt((s) => ({ ...s, lists: { ...s.lists, ...patch } })), [])
  const openSub = useCallback(
    (key: string) => {
      setSub(key)
      setSubState(st)
    },
    [st],
  )
  const ctx: DialogCtx = { ds, st, set, setLists, openSub }

  const byName = useMemo(() => new Map(ds.variables.map((v) => [v.name, v])), [ds.variables])
  const hasPairs = def.targets.some((t) => t.kind === 'pairs')
  const used = new Set(def.targets.filter((t) => t.kind !== 'pairs').flatMap((t) => st.lists[t.key] ?? []))
  let sourceVars = ds.variables.filter((v) => (hasPairs || !used.has(v.name)) && (!def.sourceFilter || def.sourceFilter(v)))
  if (options.dialogSort === 'alpha') sourceVars = [...sourceVars].sort((a, b) => a.name.localeCompare(b.name))

  const moveTo = (target: TargetDef, names: string[]) => {
    const accepted = names.filter((n) => {
      const v = byName.get(n)
      return v && (!target.accept || target.accept(v))
    })
    if (accepted.length < names.length)
      notify(`${names.length - accepted.length} variable(s) cannot be used in "${target.label.replace(/:$/, '')}".`, 'error')
    if (!accepted.length) return
    if (target.kind === 'pairs') {
      const pairs = [...(st.lists[target.key] ?? [])]
      const queue = [...accepted]
      // fill an incomplete last pair first
      if (pairs.length && pairs[pairs.length - 1].endsWith('|') && queue.length) {
        pairs[pairs.length - 1] = pairs[pairs.length - 1] + queue.shift()
      }
      while (queue.length) {
        const a = queue.shift()!
        const b = queue.shift() ?? ''
        pairs.push(`${a}|${b}`)
      }
      setLists({ [target.key]: pairs })
      setSel({ list: 'source', names: [], anchor: null })
      return
    }
    const cur = st.lists[target.key] ?? []
    let next: string[]
    if (target.max === 1) {
      next = [accepted[0]]
      // the replaced variable returns to the source list automatically
    } else next = [...cur, ...accepted.filter((n) => !cur.includes(n))]
    if (target.max && target.max > 1) next = next.slice(0, target.max)
    // remove from other targets
    const patch: Record<string, string[]> = { [target.key]: next }
    for (const t of def.targets) if (t.key !== target.key && t.kind !== 'pairs') patch[t.key] = (st.lists[t.key] ?? []).filter((n) => !accepted.includes(n))
    setLists(patch)
    setSel({ list: target.key, names: [], anchor: null })
  }

  const moveBack = (target: TargetDef, names: string[]) => {
    if (target.kind === 'pairs') {
      const idx = new Set(names.map(Number))
      setLists({ [target.key]: (st.lists[target.key] ?? []).filter((_, i) => !idx.has(i)) })
    } else setLists({ [target.key]: (st.lists[target.key] ?? []).filter((n) => !names.includes(n)) })
    setSel({ list: 'source', names: target.kind === 'pairs' ? [] : names, anchor: names[0] ?? null })
  }

  const firstAvailable = (names: string[]): TargetDef | undefined =>
    def.targets.find((t) => {
      if (t.kind === 'pairs') return true
      const v = byName.get(names[0])
      if (!v || (t.accept && !t.accept(v))) return false
      return !t.max || (st.lists[t.key] ?? []).length < t.max
    })

  const error = def.validate?.(st, ds) ?? null

  const finish = (mode: 'ok' | 'paste') => {
    if (error) return
    let specs: CommandSpec[]
    try {
      specs = def.build(st, ds)
    } catch (e) {
      notify((e as Error).message, 'error')
      return
    }
    remember(def.id, st)
    close()
    if (mode === 'ok') runSpecs(specs)
    else pasteSyntax(specs)
  }

  const listHeight = (t: TargetDef) => (t.max === 1 ? 30 : (t.rows ?? 5) * 21 + 6)
  const totalTargetHeight = def.targets.reduce((s, t) => s + listHeight(t) + 26 + (t.after ? 34 : 0), 0)
  const subDef = def.subs?.find((s) => s.key === sub)

  return (
    <>
      <DialogShell
        title={def.title}
        width={def.width ?? 640}
        onClose={close}
        footer={
          <>
            <button className="btn primary" disabled={!!error} onClick={() => finish('ok')} title={error ?? undefined}>
              OK
            </button>
            <button className="btn" disabled={!!error} onClick={() => finish('paste')} title="Write the command syntax to the Syntax Editor">
              Paste
            </button>
            <button
              className="btn"
              onClick={() => {
                setSt(def.defaults())
                setSel({ list: 'source', names: [], anchor: null })
              }}
            >
              Reset
            </button>
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button className="btn" onClick={() => setShowHelp((x) => !x)} aria-expanded={showHelp}>
              Help
            </button>
            {error && <div className="msg">{error}</div>}
          </>
        }
      >
        <div className="dlg-main">
          <div className="picker">
            <div className="source">
              <span className="lbl-small" style={{ marginBottom: 3 }}>
                Variables:
              </span>
              <VarListBox
                id="source"
                vars={sourceVars}
                sel={sel}
                setSel={setSel}
                mode={options.dialogLabels}
                height={Math.max(220, totalTargetHeight)}
                ariaLabel="Source variables"
                onTransfer={(names) => {
                  const t = firstAvailable(names)
                  if (t) moveTo(t, names)
                }}
                onDropNames={(from, names) => {
                  const t = def.targets.find((x) => x.key === from)
                  if (t) moveBack(t, names)
                }}
                emptyHint={ds.variables.length ? undefined : 'The dataset has no variables. Open or enter data first.'}
              />
            </div>
            {def.targets.map((t, i) => {
              const fromSource = sel.list === 'source' && sel.names.length > 0
              const fromThis = sel.list === t.key && sel.names.length > 0
              const items = st.lists[t.key] ?? []
              return (
                <TargetRow
                  key={t.key}
                  t={t}
                  row={i + 1}
                  height={listHeight(t)}
                  items={items}
                  byName={byName}
                  sel={sel}
                  setSel={setSel}
                  mode={options.dialogLabels}
                  arrowRight={!fromThis}
                  arrowDisabled={!fromSource && !fromThis}
                  onArrow={() => (fromThis ? moveBack(t, sel.names) : moveTo(t, sel.names))}
                  onTransferBack={(names) => moveBack(t, names)}
                  onDropFrom={(from, names) => {
                    if (from === 'source') moveTo(t, names)
                    else {
                      const ft = def.targets.find((x) => x.key === from)
                      if (ft && ft.kind !== 'pairs') {
                        // move between targets
                        moveTo(t, names)
                      }
                    }
                  }}
                  ctx={ctx}
                />
              )
            })}
            {def.controls && (
              <div className="target" style={{ gridRow: def.targets.length + 1 }}>
                <Controls controls={def.controls} ctx={ctx} />
              </div>
            )}
          </div>
          {def.subs && def.subs.some((s) => s.side !== false) && (
            <div className="dlg-side">
              {def.subs.filter((s) => s.side !== false).map((s) => (
                <button key={s.key} className="btn" disabled={s.enabled ? !s.enabled(st) : false} onClick={() => openSub(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {def.bottom && (
          <div style={{ marginTop: 10 }}>
            <Controls controls={def.bottom} ctx={ctx} />
          </div>
        )}
        {showHelp && (
          <div className="out-text note" style={{ marginTop: 10, maxWidth: 'none' }} role="note">
            {def.help}
          </div>
        )}
      </DialogShell>
      {subDef && subState && (
        <SubDialog
          def={subDef}
          initial={subState}
          ds={ds}
          onCancel={() => setSub(null)}
          onContinue={(s) => {
            setSt(s)
            setSub(null)
          }}
        />
      )}
    </>
  )
}

function TargetRow({
  t,
  row,
  height,
  items,
  byName,
  sel,
  setSel,
  mode,
  arrowRight,
  arrowDisabled,
  onArrow,
  onTransferBack,
  onDropFrom,
  ctx,
}: {
  t: TargetDef
  row: number
  height: number
  items: string[]
  byName: Map<string, Variable>
  sel: Sel
  setSel: (s: Sel) => void
  mode: 'labels' | 'names'
  arrowRight: boolean
  arrowDisabled: boolean
  onArrow: () => void
  onTransferBack: (names: string[]) => void
  onDropFrom: (from: string, names: string[]) => void
  ctx: DialogCtx
}) {
  const labelId = `lbl-${t.key}`
  return (
    <>
      <div className="arrow-cell" style={{ gridRow: row }}>
        <button
          className="arrow-btn"
          onClick={onArrow}
          disabled={arrowDisabled}
          aria-label={arrowRight ? `Move selected variables to ${t.label}` : `Remove selected from ${t.label}`}
          title={arrowRight ? 'Move into this list' : 'Move back to the variable list'}
        >
          {arrowRight ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
        </button>
      </div>
      <div className="target" style={{ gridRow: row }}>
        <span className="lbl-small" id={labelId}>
          {t.label}
        </span>
        {t.kind === 'pairs' ? (
          <PairsBox t={t} items={items} byName={byName} sel={sel} setSel={setSel} height={height} onTransferBack={onTransferBack} />
        ) : (
          <VarListBox
            id={t.key}
            vars={items.map((n) => byName.get(n)).filter((v): v is Variable => !!v)}
            sel={sel}
            setSel={setSel}
            mode={mode}
            height={height}
            ariaLabel={t.label}
            onTransfer={onTransferBack}
            onDropNames={onDropFrom}
          />
        )}
        {t.after?.(ctx)}
      </div>
    </>
  )
}

function PairsBox({
  t,
  items,
  byName,
  sel,
  setSel,
  height,
  onTransferBack,
}: {
  t: TargetDef
  items: string[]
  byName: Map<string, Variable>
  sel: Sel
  setSel: (s: Sel) => void
  height: number
  onTransferBack: (names: string[]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mine = sel.list === t.key ? sel.names : []
  return (
    <div className="varlist" ref={ref} style={{ height }} tabIndex={0} role="listbox" aria-label={t.label}>
      <div className="vitem" style={{ fontWeight: 600, color: 'var(--text-2)', fontSize: 12 }}>
        <span style={{ width: 38 }}>Pair</span>
        <span style={{ flex: 1 }}>Variable1</span>
        <span style={{ flex: 1 }}>Variable2</span>
      </div>
      {items.map((p, i) => {
        const [a, b] = p.split('|')
        const isSel = mine.includes(String(i))
        return (
          <div
            key={i}
            className={`vitem ${isSel ? 'sel' : ''}`}
            onMouseDown={() => setSel({ list: t.key, names: [String(i)], anchor: String(i) })}
            onDoubleClick={() => onTransferBack([String(i)])}
          >
            <span style={{ width: 38 }}>{i + 1}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a ? (byName.get(a)?.name ?? a) : ''}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b ? (byName.get(b)?.name ?? b) : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function SubDialog({
  def,
  initial,
  ds,
  onCancel,
  onContinue,
}: {
  def: SubDialogDef
  initial: DState
  ds: Dataset
  onCancel: () => void
  onContinue: (s: DState) => void
}) {
  const [st, setSt] = useState(initial)
  const set = (patch: Partial<Values>) => setSt((s) => ({ ...s, v: { ...s.v, ...patch } }))
  const ctx: DialogCtx = { ds, st, set, setLists: (p) => setSt((s) => ({ ...s, lists: { ...s.lists, ...p } })), openSub: () => {} }
  const err = def.validate?.(st) ?? null
  return (
    <DialogShell
      title={def.title}
      width={def.width ?? 420}
      onClose={onCancel}
      layer={1}
      footer={
        <>
          <button className="btn primary" disabled={!!err} onClick={() => onContinue(st)}>
            Continue
          </button>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          {err && <div className="msg">{err}</div>}
        </>
      }
    >
      <div className="col" style={{ gap: 6 }}>
        <Controls controls={def.controls} ctx={ctx} />
      </div>
    </DialogShell>
  )
}


/** Small button used under single-variable targets (e.g. "Define Groups…"). */
export function DefineButton({ ctx, sub, text }: { ctx: DialogCtx; sub: string; text: string }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <button className="btn small" onClick={() => ctx.openSub(sub)}>
        {text}
      </button>
    </div>
  )
}

