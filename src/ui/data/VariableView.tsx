import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  createVariable,
  deleteVariables,
  insertVariable,
  moveVariable,
  nextDefaultVarName,
  updateVariable,
  validateVarName,
  type Align,
  type Dataset,
  type Measure,
  type Role,
  type Variable,
} from '../../core/dataset'
import { useApp } from '../../state/store'
import { ContextMenu, MeasureIcon, type MenuEntry } from '../common'
import { GridFrame, type GridHandle } from './GridFrame'
import { missingText, valuesText } from './varText'

type ColKey = 'name' | 'type' | 'width' | 'decimals' | 'label' | 'values' | 'missing' | 'columns' | 'align' | 'measure' | 'role'

const COLS: { key: ColKey; label: string; width: number; kind: 'text' | 'int' | 'select' | 'dialog' }[] = [
  { key: 'name', label: 'Name', width: 120, kind: 'text' },
  { key: 'type', label: 'Type', width: 92, kind: 'dialog' },
  { key: 'width', label: 'Width', width: 58, kind: 'int' },
  { key: 'decimals', label: 'Decimals', width: 68, kind: 'int' },
  { key: 'label', label: 'Label', width: 230, kind: 'text' },
  { key: 'values', label: 'Values', width: 170, kind: 'dialog' },
  { key: 'missing', label: 'Missing', width: 120, kind: 'dialog' },
  { key: 'columns', label: 'Columns', width: 66, kind: 'int' },
  { key: 'align', label: 'Align', width: 76, kind: 'select' },
  { key: 'measure', label: 'Measure', width: 104, kind: 'select' },
  { key: 'role', label: 'Role', width: 84, kind: 'select' },
]

const ALIGN: Align[] = ['left', 'right', 'center']
const MEASURE: Measure[] = ['scale', 'ordinal', 'nominal']
const ROLE: Role[] = ['input', 'target', 'both', 'none', 'partition', 'split']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function display(v: Variable, key: ColKey): string {
  switch (key) {
    case 'name':
      return v.name
    case 'type':
      return v.type === 'numeric' ? 'Numeric' : 'String'
    case 'width':
      return String(v.width)
    case 'decimals':
      return String(v.decimals)
    case 'label':
      return v.label
    case 'values':
      return valuesText(v)
    case 'missing':
      return missingText(v)
    case 'columns':
      return String(v.columns)
    case 'align':
      return cap(v.align)
    case 'measure':
      return cap(v.measure)
    case 'role':
      return cap(v.role)
  }
}

export function VariableView() {
  const ds = useApp((s) => s.ds)
  const commit = useApp((s) => s.commit)
  const notify = useApp((s) => s.notify)
  const openDialog = useApp((s) => s.openDialog)
  const focusVarId = useApp((s) => s.focusVarId)
  const gridRef = useRef<GridHandle>(null)
  const [active, setActive] = useState({ row: 0, col: 0 })
  const [editing, setEditing] = useState<{ row: number; col: number; text: string } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuEntry | 'sep')[] } | null>(null)
  const editingRef = useRef<{ row: number; col: number; text: string } | null>(null)
  const setEdit = (e: { row: number; col: number; text: string } | null) => {
    editingRef.current = e
    setEditing(e)
  }
  /** Focus editors as soon as they mount so no keystroke is lost. */
  const focusOnMount = (el: HTMLInputElement | HTMLSelectElement | null) => {
    if (el && document.activeElement !== el) {
      el.focus()
      if (el instanceof HTMLInputElement) el.setSelectionRange(el.value.length, el.value.length)
    }
  }
  const nVars = ds.variables.length

  useEffect(() => gridRef.current?.ensureVisible(active.row, active.col), [active])
  useEffect(() => {
    if (!focusVarId) return
    const idx = ds.variables.findIndex((v) => v.id === focusVarId)
    if (idx >= 0) {
      setActive({ row: idx, col: 0 })
      useApp.setState({ focusVarId: null })
      gridRef.current?.focus()
    }
  }, [focusVarId, ds.variables])

  /** Make sure a variable exists at `row` (editing an empty row creates default variables). */
  const ensureVar = (d: Dataset, row: number, name?: string): { ds: Dataset; v: Variable } => {
    let next = d
    while (next.variables.length <= row) {
      const isTarget = next.variables.length === row
      const nm = isTarget && name ? name : nextDefaultVarName(next)
      next = insertVariable(next, next.variables.length, createVariable(nm))
    }
    return { ds: next, v: next.variables[row] }
  }

  const openCellDialog = (row: number, key: ColKey) => {
    let d = ds
    if (row >= nVars) {
      const r = ensureVar(ds, row)
      d = r.ds
      commit(d)
    }
    const v = d.variables[row]
    const id = key === 'type' ? 'var-type' : key === 'values' ? 'value-labels' : 'missing-values'
    openDialog(id, { varId: v.id })
  }

  const startEdit = (row: number, col: number, initial?: string) => {
    const c = COLS[col]
    if (c.kind === 'dialog') return openCellDialog(row, c.key)
    const v = ds.variables[row]
    let text = initial ?? (v ? (c.kind === 'select' ? (v[c.key as 'align'] as string) : display(v, c.key)) : '')
    if (c.kind === 'select' && !v) text = c.key === 'align' ? 'right' : c.key === 'measure' ? 'scale' : 'input'
    setEdit({ row, col, text })
  }

  const apply = (row: number, key: ColKey, text: string): boolean => {
    const exists = row < nVars
    if (!exists && key === 'name') {
      const err = validateVarName(text, ds)
      if (err) {
        notify(err, 'error')
        return false
      }
      commit(ensureVar(ds, row, text).ds)
      return true
    }
    const { ds: d, v } = exists ? { ds, v: ds.variables[row] } : ensureVar(ds, row)
    let patch: Partial<Variable> | null = null
    switch (key) {
      case 'name': {
        if (text === v.name) return true
        const err = validateVarName(text, d, v.id)
        if (err) {
          notify(err, 'error')
          return false
        }
        patch = { name: text }
        break
      }
      case 'label':
        patch = { label: text }
        break
      case 'width':
      case 'decimals':
      case 'columns': {
        const n = Number(text)
        const max = key === 'decimals' ? 16 : key === 'width' ? (v.type === 'string' ? 32767 : 40) : 255
        if (!Number.isInteger(n) || n < (key === 'decimals' ? 0 : 1) || n > max) {
          notify(`${cap(key)} must be a whole number between ${key === 'decimals' ? 0 : 1} and ${max}.`, 'error')
          return false
        }
        if (key === 'decimals' && v.type === 'string') return true
        patch = { [key]: n }
        break
      }
      case 'align':
        patch = { align: text as Align }
        break
      case 'measure':
        if (v.type === 'string' && text === 'scale') {
          notify('String variables cannot have a scale measurement level.', 'error')
          return false
        }
        patch = { measure: text as Measure }
        break
      case 'role':
        patch = { role: text as Role }
        break
      default:
        return true
    }
    commit(updateVariable(d, v.id, patch))
    return true
  }

  const commitEdit = (dr = 0, dc = 0, refocus = true) => {
    const cur = editingRef.current
    if (!cur) return true
    const ok = apply(cur.row, COLS[cur.col].key, cur.text)
    if (!ok) return false
    editingRef.current = null
    if (refocus) gridRef.current?.focus()
    setEditing(null)
    setActive({ row: Math.max(0, cur.row + dr), col: Math.min(COLS.length - 1, Math.max(0, cur.col + dc)) })
    return true
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingRef.current) return
    const mv = (dr: number, dc: number) => {
      e.preventDefault()
      setActive((p) => ({ row: Math.max(0, p.row + dr), col: Math.min(COLS.length - 1, Math.max(0, p.col + dc)) }))
    }
    switch (e.key) {
      case 'ArrowDown':
        return mv(1, 0)
      case 'ArrowUp':
        return mv(-1, 0)
      case 'ArrowRight':
        return mv(0, 1)
      case 'ArrowLeft':
        return mv(0, -1)
      case 'Tab':
        return mv(0, e.shiftKey ? -1 : 1)
      case 'Enter':
      case 'F2':
        e.preventDefault()
        return startEdit(active.row, active.col)
      case 'Delete':
        if (active.col === 0 && active.row < nVars) {
          e.preventDefault()
          commit(deleteVariables(ds, [ds.variables[active.row].id]))
        } else if (active.col === 4 && active.row < nVars) {
          e.preventDefault()
          commit(updateVariable(ds, ds.variables[active.row].id, { label: '' }))
        }
        return
    }
    const c = COLS[active.col]
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && (c.kind === 'text' || c.kind === 'int')) {
      e.preventDefault()
      startEdit(active.row, active.col, e.key)
    }
  }

  const rowMenu = (e: React.MouseEvent, row: number) => {
    e.preventDefault()
    const v = ds.variables[row]
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Insert Variable', onClick: () => commit(insertVariable(ds, Math.min(row, nVars))) },
        { label: 'Delete Variable', disabled: !v, onClick: () => commit(deleteVariables(ds, [v.id])) },
        'sep',
        { label: 'Move Up', disabled: !v || row === 0, onClick: () => (commit(moveVariable(ds, row, row - 1)), setActive({ row: row - 1, col: active.col })) },
        {
          label: 'Move Down',
          disabled: !v || row >= nVars - 1,
          onClick: () => (commit(moveVariable(ds, row, row + 1)), setActive({ row: row + 1, col: active.col })),
        },
        'sep',
        {
          label: 'Go to Data View',
          disabled: !v,
          onClick: () => {
            useApp.setState({ focusVarId: v.id })
            useApp.getState().setDataTab('data')
          },
        },
      ],
    })
  }

  const renderHeader = (col: number, style: CSSProperties) => (
    <div key={`h${col}`} className={`ghead ${col === active.col ? 'sel' : ''} ${col >= COLS.length ? 'empty' : ''}`} style={style}>
      {COLS[col]?.label ?? ''}
    </div>
  )

  const renderRowHeader = (row: number, style: CSSProperties) => (
    <div
      key={`r${row}`}
      className={`grow ${row === active.row ? 'sel' : ''}`}
      style={style}
      onMouseDown={() => setActive({ row, col: active.col })}
      onContextMenu={(e) => rowMenu(e, row)}
    >
      {row + 1}
    </div>
  )

  const renderCell = (row: number, col: number, style: CSSProperties) => {
    const c = COLS[col]
    const v = ds.variables[row]
    const isActive = row === active.row && col === active.col
    if (!c) return <div key={`${row}:${col}`} className="gcell extra" style={style} />
    const text = v ? display(v, c.key) : ''
    return (
      <div
        key={`${row}:${col}`}
        className={`gcell ${c.kind === 'int' ? 'al-right' : 'al-left'} ${!v ? 'extra' : ''} ${isActive ? 'active' : ''}`}
        style={{ ...style, paddingRight: isActive && c.kind === 'dialog' ? 26 : undefined }}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          if (editingRef.current && !commitEdit(0, 0, false)) return
          setActive({ row, col })
          gridRef.current?.focus()
        }}
        onDoubleClick={() => startEdit(row, col)}
        onContextMenu={(e) => rowMenu(e, row)}
        title={c.key === 'values' && v?.valueLabels.length ? v.valueLabels.map((l) => `${l.value} = ${l.label}`).join('\n') : undefined}
      >
        {c.key === 'measure' && v ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <MeasureIcon v={v} size={13} />
            {text}
          </span>
        ) : (
          text
        )}
        {isActive && c.kind === 'dialog' && (
          <button
            className="vv-dots"
            aria-label={`Edit ${c.label.toLowerCase()}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => openCellDialog(row, c.key)}
          >
            …
          </button>
        )}
      </div>
    )
  }

  const overlay = (cellRect: (row: number, col: number) => { left: number; top: number; width: number; height: number }) => {
    if (!editing) return null
    const r = cellRect(editing.row, editing.col)
    const c = COLS[editing.col]
    const v = ds.variables[editing.row]
    const style = { left: r.left, top: r.top, width: Math.max(r.width, c.kind === 'select' ? 110 : r.width), height: r.height }
    if (c.kind === 'select') {
      const opts = c.key === 'align' ? ALIGN : c.key === 'measure' ? (v?.type === 'string' ? MEASURE.slice(1) : MEASURE) : ROLE
      return (
        <select
          ref={focusOnMount}
          className="vv-select"
          aria-label={c.label}
          style={style}
          value={editing.text}
          onChange={(e) => {
            const val = e.target.value
            if (apply(editing.row, c.key, val)) {
              editingRef.current = null
              gridRef.current?.focus()
              setEditing(null)
            }
          }}
          onBlur={() => {
            if (editingRef.current) setEdit(null)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              editingRef.current = null
              gridRef.current?.focus()
              setEditing(null)
            }
          }}
        >
          {opts.map((o) => (
            <option key={o} value={o}>
              {cap(o)}
            </option>
          ))}
        </select>
      )
    }
    {
      return (
        <input
          ref={focusOnMount}
          className="vv-input"
          aria-label={c.label}
          style={style}
          value={editing.text}
          onChange={(e) => editing && setEdit({ ...editing, text: e.target.value })}
          onBlur={() => {
            if (editingRef.current && !commitEdit(0, 0, false)) setEdit(null)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              commitEdit(1, 0)
            } else if (e.key === 'Tab') {
              e.preventDefault()
              commitEdit(0, e.shiftKey ? -1 : 1)
            } else if (e.key === 'Escape') {
              editingRef.current = null
              gridRef.current?.focus()
              setEditing(null)
            }
          }}
        />
      )
    }
  }

  return (
    <>
      <div className="cellbar">
        <span className="ref">{ds.variables[active.row] ? `${ds.variables[active.row].name} : ${COLS[active.col].label}` : `${active.row + 1} : ${COLS[active.col].label}`}</span>
        <div className="val">{ds.variables[active.row] ? display(ds.variables[active.row], COLS[active.col].key) : 'Type a name to create a new variable'}</div>
        <span className="visible">{nVars} variables</span>
      </div>
      <GridFrame
        ref={gridRef}
        ariaLabel="Variable View"
        rowCount={nVars + 1}
        colWidths={COLS.map((c) => c.width)}
        fillerWidth={60}
        rowHeaderWidth={44}
        renderHeader={renderHeader}
        renderRowHeader={renderRowHeader}
        renderCell={renderCell}
        overlay={overlay}
        onKeyDown={onKeyDown}
      />
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </>
  )
}
