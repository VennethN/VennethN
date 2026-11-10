import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { activeCases, deleteCases, deleteVariables, insertCases, insertVariable, isSysMissing, type Variable } from '../../core/dataset'
import { formatCell } from '../../core/format'
import { useApp } from '../../state/store'
import { ContextMenu, MeasureIcon, type MenuEntry } from '../common'
import { colWidthPx, parseCellInput, rawText, writeBlock, type Pos } from './dataOps'
import { GridFrame, type GridHandle } from './GridFrame'

export function DataView() {
  const ds = useApp((s) => s.ds)
  const showLabels = useApp((s) => s.showValueLabels)
  const commit = useApp((s) => s.commit)
  const notify = useApp((s) => s.notify)
  const openDialog = useApp((s) => s.openDialog)
  const runSpecs = useApp((s) => s.runSpecs)
  const focusCase = useApp((s) => s.focusCase)
  const focusVarId = useApp((s) => s.focusVarId)
  const gridRef = useRef<GridHandle>(null)
  const [active, setActive] = useState<Pos>({ row: 0, col: 0 })
  const [anchor, setAnchor] = useState<Pos | null>(null)
  const [editing, setEditing] = useState<{ pos: Pos; text: string } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuEntry | 'sep')[] } | null>(null)
  const editRef = useRef<HTMLInputElement>(null)

  const nVars = ds.variables.length
  const colWidths = useMemo(() => ds.variables.map(colWidthPx), [ds.variables])
  const filtered = useMemo(() => {
    if (!ds.filterVarId) return null
    const keep = new Set(activeCases(ds))
    return (r: number) => r < ds.nCases && !keep.has(r)
  }, [ds])

  const range = useMemo(() => {
    const a = anchor ?? active
    return {
      r0: Math.min(a.row, active.row),
      r1: Math.max(a.row, active.row),
      c0: Math.min(a.col, active.col),
      c1: Math.max(a.col, active.col),
    }
  }, [anchor, active])

  useEffect(() => {
    gridRef.current?.ensureVisible(active.row, active.col)
  }, [active])

  // External navigation requests (Go to Case / Go to Variable / Variable View double-click)
  useEffect(() => {
    if (focusCase !== null && focusCase !== undefined) {
      setActive((p) => ({ row: Math.max(0, focusCase), col: p.col }))
      setAnchor(null)
      useApp.setState({ focusCase: null })
      gridRef.current?.focus()
    }
  }, [focusCase])
  useEffect(() => {
    if (!focusVarId) return
    const idx = ds.variables.findIndex((v) => v.id === focusVarId)
    if (idx >= 0 && useApp.getState().dataTab === 'data') {
      setActive((p) => ({ row: p.row, col: idx }))
      setAnchor(null)
      gridRef.current?.focus()
      useApp.setState({ focusVarId: null })
    }
  }, [focusVarId, ds.variables])

  useEffect(() => {
    if (editing) editRef.current?.focus()
  }, [editing])

  const startEdit = useCallback(
    (pos: Pos, initial?: string) => {
      const v = ds.variables[pos.col]
      const text = initial ?? (v && pos.row < ds.nCases ? rawText(v, ds.data[v.id][pos.row]) : '')
      setEditing({ pos, text })
    },
    [ds],
  )

  const commitEdit = useCallback(
    (move: 'down' | 'right' | 'left' | 'up' | 'none') => {
      if (!editing) return true
      const { pos, text } = editing
      const v = ds.variables[pos.col]
      if (v && v.type === 'numeric') {
        const p = parseCellInput(v, text)
        if ('error' in p) {
          notify(p.error, 'error')
          return false
        }
      }
      const unchanged = v && pos.row < ds.nCases && rawText(v, ds.data[v.id][pos.row]) === text
      if (!unchanged && !(text === '' && (!v || pos.row >= ds.nCases))) {
        const r = writeBlock(ds, pos, [[text]])
        commit(r.ds)
      }
      setEditing(null)
      const d = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1], none: [0, 0] }[move]
      setActive({ row: Math.max(0, pos.row + d[0]), col: Math.max(0, pos.col + d[1]) })
      setAnchor(null)
      setTimeout(() => gridRef.current?.focus(), 0)
      return true
    },
    [editing, ds, commit, notify],
  )

  const selectionText = useCallback(() => {
    const lines: string[] = []
    for (let r = range.r0; r <= Math.min(range.r1, ds.nCases - 1); r++) {
      const vals: string[] = []
      for (let c = range.c0; c <= Math.min(range.c1, nVars - 1); c++) {
        const v = ds.variables[c]
        vals.push(showLabels ? formatCell(v, ds.data[v.id][r], true) : rawText(v, ds.data[v.id][r]))
      }
      lines.push(vals.join('\t'))
    }
    return lines.join('\n')
  }, [range, ds, nVars, showLabels])

  const clearSelection = useCallback(() => {
    let next = ds
    for (let c = range.c0; c <= Math.min(range.c1, nVars - 1); c++) {
      const v = next.variables[c]
      const col = next.data[v.id].slice()
      for (let r = range.r0; r <= Math.min(range.r1, ds.nCases - 1); r++) col[r] = v.type === 'string' ? '' : null
      next = { ...next, data: { ...next.data, [v.id]: col } }
    }
    commit(next)
  }, [ds, range, nVars, commit])

  const paste = useCallback(
    (text: string) => {
      const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
      const r = writeBlock(ds, { row: range.r0, col: range.c0 }, rows)
      commit(r.ds)
      if (r.errors) notify(`${r.errors} value(s) could not be pasted because they are not valid numbers.`, 'error')
    },
    [ds, range, commit, notify],
  )

  const move = (dr: number, dc: number, extend: boolean) => {
    if (extend && !anchor) setAnchor(active)
    if (!extend) setAnchor(null)
    setActive((p) => ({ row: Math.max(0, p.row + dr), col: Math.max(0, p.col + dc) }))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return
    const page = gridRef.current?.pageRows() ?? 20
    const mod = e.ctrlKey || e.metaKey
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        return mod ? setActive((p) => ({ ...p, row: Math.max(0, ds.nCases - 1) })) : move(1, 0, e.shiftKey)
      case 'ArrowUp':
        e.preventDefault()
        return mod ? setActive((p) => ({ ...p, row: 0 })) : move(-1, 0, e.shiftKey)
      case 'ArrowRight':
        e.preventDefault()
        return mod ? setActive((p) => ({ ...p, col: Math.max(0, nVars - 1) })) : move(0, 1, e.shiftKey)
      case 'ArrowLeft':
        e.preventDefault()
        return mod ? setActive((p) => ({ ...p, col: 0 })) : move(0, -1, e.shiftKey)
      case 'PageDown':
        e.preventDefault()
        return move(page, 0, e.shiftKey)
      case 'PageUp':
        e.preventDefault()
        return move(-page, 0, e.shiftKey)
      case 'Home':
        e.preventDefault()
        return setActive((p) => (mod ? { row: 0, col: 0 } : { ...p, col: 0 }))
      case 'End':
        e.preventDefault()
        return setActive((p) => (mod ? { row: Math.max(0, ds.nCases - 1), col: Math.max(0, nVars - 1) } : { ...p, col: Math.max(0, nVars - 1) }))
      case 'Tab':
        e.preventDefault()
        return move(0, e.shiftKey ? -1 : 1, false)
      case 'Enter':
        e.preventDefault()
        return move(e.shiftKey ? -1 : 1, 0, false)
      case 'F2':
        e.preventDefault()
        return startEdit(active)
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        return clearSelection()
      case 'Escape':
        return setAnchor(null)
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setAnchor({ row: 0, col: 0 })
      setActive({ row: Math.max(0, ds.nCases - 1), col: Math.max(0, nVars - 1) })
      return
    }
    if (!mod && !e.altKey && e.key.length === 1) {
      e.preventDefault()
      startEdit(active, e.key)
    }
  }

  const sortBy = (v: Variable, descending: boolean) => {
    runSpecs([{ proc: 'sort', keys: [{ variable: v.name, descending }] }])
  }

  const headerMenu = (e: React.MouseEvent, col: number) => {
    e.preventDefault()
    const v = ds.variables[col]
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Insert Variable', onClick: () => commit(insertVariable(ds, Math.min(col, nVars))) },
        {
          label: 'Delete Variable' + (range.c1 > range.c0 ? 's' : ''),
          disabled: !v,
          onClick: () => {
            const ids = ds.variables.slice(range.c0, Math.min(range.c1, nVars - 1) + 1).map((x) => x.id)
            commit(deleteVariables(ds, ids.length ? ids : [v.id]))
          },
        },
        'sep',
        { label: 'Sort Ascending', disabled: !v, onClick: () => sortBy(v, false) },
        { label: 'Sort Descending', disabled: !v, onClick: () => sortBy(v, true) },
        'sep',
        {
          label: 'Descriptive Statistics',
          disabled: !v,
          onClick: () =>
            v.type === 'numeric' && v.measure === 'scale'
              ? runSpecs([{ proc: 'descriptives', variables: [v.name], statistics: ['mean', 'stddev', 'min', 'max'], saveZ: false, sort: 'variable' }])
              : runSpecs([
                  {
                    proc: 'frequencies',
                    variables: [v.name],
                    showTables: true,
                    statistics: [],
                    quartiles: false,
                    percentiles: [],
                    chart: 'none',
                    chartValues: 'freq',
                    normalCurve: false,
                    order: 'avalue',
                  },
                ]),
        },
        {
          label: 'Variable Information…',
          disabled: !v,
          onClick: () => openDialog('variables-info', { varId: v.id }),
        },
      ],
    })
  }

  const rowMenu = (e: React.MouseEvent, row: number) => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Insert Cases', onClick: () => commit(insertCases(ds, Math.min(row, ds.nCases), 1)) },
        {
          label: 'Delete Case' + (range.r1 > range.r0 ? 's' : ''),
          disabled: row >= ds.nCases,
          onClick: () => {
            const rows: number[] = []
            const lo = range.r0 <= row && row <= range.r1 ? range.r0 : row
            const hi = range.r0 <= row && row <= range.r1 ? range.r1 : row
            for (let r = lo; r <= Math.min(hi, ds.nCases - 1); r++) rows.push(r)
            commit(deleteCases(ds, rows))
          },
        },
      ],
    })
  }

  const cellMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Copy',
          shortcut: 'Ctrl+C',
          onClick: () => navigator.clipboard?.writeText(selectionText()).catch(() => notify('Clipboard access was blocked by the browser.', 'error')),
        },
        {
          label: 'Paste',
          shortcut: 'Ctrl+V',
          onClick: () =>
            navigator.clipboard
              ?.readText()
              .then(paste)
              .catch(() => notify('Use Ctrl+V to paste — the browser blocked clipboard access from the menu.', 'error')),
        },
        { label: 'Clear', shortcut: 'Del', onClick: clearSelection },
        'sep',
        { label: 'Insert Variable', onClick: () => commit(insertVariable(ds, Math.min(active.col, nVars))) },
        { label: 'Insert Cases', onClick: () => commit(insertCases(ds, Math.min(active.row, ds.nCases), 1)) },
      ],
    })
  }

  const renderHeader = (col: number, style: CSSProperties) => {
    const v = ds.variables[col]
    const sel = col >= range.c0 && col <= range.c1
    if (!v)
      return (
        <div key={`h${col}`} className={`ghead empty ${sel ? 'sel' : ''}`} style={style}>
          var
        </div>
      )
    return (
      <div
        key={`h${col}`}
        className={`ghead ${sel ? 'sel' : ''}`}
        style={style}
        title={`${v.name}${v.label ? ` — ${v.label}` : ''}`}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          if (editing && !commitEdit('none')) return
          setAnchor({ row: 0, col: e.shiftKey && anchor ? anchor.col : col })
          setActive({ row: Math.max(0, ds.nCases - 1), col })
          gridRef.current?.focus()
        }}
        onDoubleClick={() => {
          useApp.setState({ focusVarId: v.id })
          useApp.getState().setDataTab('variables')
        }}
        onContextMenu={(e) => headerMenu(e, col)}
      >
        <MeasureIcon v={v} size={12} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</span>
      </div>
    )
  }

  const renderRowHeader = (row: number, style: CSSProperties) => {
    const sel = row >= range.r0 && row <= range.r1
    const isFiltered = filtered?.(row)
    return (
      <div
        key={`r${row}`}
        className={`grow ${sel ? 'sel' : ''} ${isFiltered ? 'filtered' : ''}`}
        style={style}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          if (editing && !commitEdit('none')) return
          setAnchor({ row: e.shiftKey && anchor ? anchor.row : row, col: 0 })
          setActive({ row, col: Math.max(0, nVars - 1) })
          gridRef.current?.focus()
        }}
        onContextMenu={(e) => rowMenu(e, row)}
        title={isFiltered ? 'Case is filtered out (not selected)' : undefined}
      >
        {row + 1}
      </div>
    )
  }

  const renderCell = (row: number, col: number, style: CSSProperties) => {
    const v = ds.variables[col]
    const inData = v && row < ds.nCases
    const x = inData ? ds.data[v.id][row] : null
    const text = inData ? formatCell(v, x, showLabels) : ''
    const isActive = row === active.row && col === active.col
    const inRange = !isActive && row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1 && (anchor !== null)
    const cls = [
      'gcell',
      v ? `al-${v.align}` : '',
      !v || row >= ds.nCases ? 'extra' : '',
      isActive ? 'active' : '',
      inRange ? 'inrange' : '',
      inData && isSysMissing(v, x) ? 'sysmis' : '',
    ].join(' ')
    return (
      <div
        key={`${row}:${col}`}
        className={cls}
        style={style}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          if (editing && !commitEdit('none')) return
          if (e.shiftKey) {
            if (!anchor) setAnchor(active)
          } else setAnchor(null)
          setActive({ row, col })
          gridRef.current?.focus()
        }}
        onMouseEnter={(e) => {
          if (e.buttons === 1 && !editing) {
            if (!anchor) setAnchor(active)
            setActive({ row, col })
          }
        }}
        onDoubleClick={() => startEdit({ row, col })}
        onContextMenu={(e) => {
          if (!(row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1)) {
            setAnchor(null)
            setActive({ row, col })
          }
          cellMenu(e)
        }}
      >
        {text}
      </div>
    )
  }

  const overlay = (cellRect: (row: number, col: number) => { left: number; top: number; width: number; height: number }) => {
    if (!editing) return null
    const r = cellRect(editing.pos.row, editing.pos.col)
    const v = ds.variables[editing.pos.col]
    const options = showLabels && v?.valueLabels.length ? v.valueLabels : null
    return (
      <>
        <input
          ref={editRef}
          className="gedit"
          aria-label="Cell editor"
          list={options ? 'cell-labels' : undefined}
          style={{ left: r.left, top: r.top, width: Math.max(r.width, 90), height: r.height, textAlign: v?.type === 'numeric' ? 'right' : 'left' }}
          value={editing.text}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onBlur={() => commitEdit('none')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitEdit(e.shiftKey ? 'up' : 'down')
            } else if (e.key === 'Tab') {
              e.preventDefault()
              commitEdit(e.shiftKey ? 'left' : 'right')
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(null)
              gridRef.current?.focus()
            } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !options) {
              e.preventDefault()
              commitEdit(e.key === 'ArrowDown' ? 'down' : 'up')
            }
          }}
        />
        {options && (
          <datalist id="cell-labels">
            {options.map((l) => (
              <option key={String(l.value)} value={l.label} />
            ))}
          </datalist>
        )}
      </>
    )
  }

  const av = ds.variables[active.col]
  const activeRaw = av && active.row < ds.nCases ? rawText(av, ds.data[av.id][active.row]) : ''
  const activeLabel = av && active.row < ds.nCases && showLabels ? formatCell(av, ds.data[av.id][active.row], true) : activeRaw

  return (
    <>
      <div className="cellbar">
        <span className="ref" title="Case : Variable">
          {active.row + 1} : {av ? av.name : ''}
        </span>
        <div className="val">{editing ? editing.text : activeLabel}</div>
        <span className="visible">
          Visible: {nVars} of {nVars} Variables
        </span>
      </div>
      <GridFrame
        ref={gridRef}
        ariaLabel="Data View"
        rowCount={ds.nCases + 1}
        colWidths={colWidths}
        renderHeader={renderHeader}
        renderRowHeader={renderRowHeader}
        renderCell={renderCell}
        overlay={overlay}
        onKeyDown={onKeyDown}
        onCopy={(e) => {
          if (editing) return
          e.preventDefault()
          e.clipboardData.setData('text/plain', selectionText())
        }}
        onCut={(e) => {
          if (editing) return
          e.preventDefault()
          e.clipboardData.setData('text/plain', selectionText())
          clearSelection()
        }}
        onPaste={(e) => {
          if (editing) return
          e.preventDefault()
          paste(e.clipboardData.getData('text/plain'))
        }}
      />
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </>
  )
}

