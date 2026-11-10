import {
  BarChart3,
  Columns3,
  Download,
  FileCode2,
  FolderOpen,
  History,
  ListOrdered,
  Printer,
  Redo2,
  Rows3,
  Save,
  Scale,
  Search,
  Table2,
  Tags,
  Trash2,
  Undo2,
  Filter,
  Info,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { activeCases, insertCases, insertVariable } from './core/dataset'
import { datasetTitle, useApp, type WindowId } from './state/store'
import { restoreSession, startAutosave } from './state/persist'
import { ContextMenu, Logo, type MenuEntry } from './ui/common'
import { DataView } from './ui/data/DataView'
import { VariableView } from './ui/data/VariableView'
import { DialogHost } from './ui/DialogHost'
import { dialogTitle } from './ui/dialogTitles'
import { exportOutput, openDataFile, saveData } from './ui/fileOps'
import { MenuBar } from './ui/MenuBar'
import { buildMenus } from './ui/menus'
import { OutputViewer } from './ui/output/OutputViewer'
import { SyntaxEditor } from './ui/syntax/SyntaxEditor'

const WIN_NAMES: Record<WindowId, string> = { data: 'Data Editor', output: 'Viewer', syntax: 'Syntax Editor' }

function Toolbar() {
  const s = useApp()
  const [recent, setRecent] = useState<{ x: number; y: number } | null>(null)
  const hasData = s.ds.variables.length > 0
  const recentItems: MenuEntry[] = s.recentDialogs
    .map((id) => ({ id, title: dialogTitle(id) }))
    .filter((d) => d.title)
    .map((d) => ({ label: d.title, onClick: () => s.openDialog(d.id) }))
  return (
    <div className="toolbar" role="toolbar" aria-label="Toolbar">
      <button className="tb-btn" title="Open data (Ctrl+O)" aria-label="Open data" onClick={() => openDataFile()}>
        <FolderOpen size={17} />
      </button>
      <button className="tb-btn" title="Save data (Ctrl+S)" aria-label="Save data" disabled={!hasData} onClick={() => saveData()}>
        <Save size={17} />
      </button>
      <button
        className="tb-btn"
        title="Print output"
        aria-label="Print output"
        onClick={() => {
          s.setWin('output')
          setTimeout(() => window.print(), 150)
        }}
      >
        <Printer size={17} />
      </button>
      <button
        className="tb-btn"
        title="Recall recently used dialogs"
        aria-label="Recall recently used dialogs"
        disabled={!recentItems.length}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setRecent({ x: r.left, y: r.bottom })
        }}
      >
        <History size={17} />
      </button>
      <span className="tb-sep" />
      <button className="tb-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!s.past.length} onClick={s.undo}>
        <Undo2 size={17} />
      </button>
      <button className="tb-btn" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!s.future.length} onClick={s.redo}>
        <Redo2 size={17} />
      </button>
      <span className="tb-sep" />
      <button className="tb-btn" title="Go to case" aria-label="Go to case" disabled={!hasData} onClick={() => s.openDialog('goto-case')}>
        <ListOrdered size={17} />
      </button>
      <button className="tb-btn" title="Go to variable" aria-label="Go to variable" disabled={!hasData} onClick={() => s.openDialog('goto-variable')}>
        <Search size={17} />
      </button>
      <button className="tb-btn" title="Variables (dictionary information)" aria-label="Variables" disabled={!hasData} onClick={() => s.openDialog('variables-info')}>
        <Info size={17} />
      </button>
      <span className="tb-sep" />
      <button className="tb-btn" title="Insert cases" aria-label="Insert cases" disabled={!hasData} onClick={() => s.commit(insertCases(s.ds, s.ds.nCases, 1))}>
        <Rows3 size={17} />
      </button>
      <button className="tb-btn" title="Insert variable" aria-label="Insert variable" onClick={() => s.commit(insertVariable(s.ds, s.ds.variables.length))}>
        <Columns3 size={17} />
      </button>
      <button className={`tb-btn ${s.ds.weightVarId ? 'on' : ''}`} title="Weight cases" aria-label="Weight cases" disabled={!hasData} onClick={() => s.openDialog('weight-cases')}>
        <Scale size={17} />
      </button>
      <button className={`tb-btn ${s.ds.filterVarId ? 'on' : ''}`} title="Select cases" aria-label="Select cases" disabled={!hasData} onClick={() => s.openDialog('select-cases')}>
        <Filter size={17} />
      </button>
      <button className={`tb-btn ${s.showValueLabels ? 'on' : ''}`} title="Value labels" aria-label="Value labels" aria-pressed={s.showValueLabels} onClick={s.toggleValueLabels}>
        <Tags size={17} />
      </button>
      {s.win === 'output' && (
        <>
          <span className="tb-sep" />
          <button className="tb-btn" title="Export output as HTML" aria-label="Export output" disabled={!s.blocks.length} onClick={exportOutput}>
            <Download size={17} />
            <span className="txt">Export</span>
          </button>
          <button
            className="tb-btn"
            title="Delete all output"
            aria-label="Delete all output"
            disabled={!s.blocks.length}
            onClick={() => window.confirm('Delete all output?') && s.clearOutput()}
          >
            <Trash2 size={17} />
            <span className="txt">Clear</span>
          </button>
        </>
      )}
      {recent && <ContextMenu x={recent.x} y={recent.y} items={recentItems} onClose={() => setRecent(null)} />}
    </div>
  )
}

function StatusBar() {
  const ds = useApp((s) => s.ds)
  const win = useApp((s) => s.win)
  const blocks = useApp((s) => s.blocks.length)
  const filterName = ds.filterVarId ? ds.variables.find((v) => v.id === ds.filterVarId)?.name : null
  const weightName = ds.weightVarId ? ds.variables.find((v) => v.id === ds.weightVarId)?.name : null
  const selected = useMemo(() => (ds.filterVarId ? activeCases(ds).length : ds.nCases), [ds])
  return (
    <footer className="statusbar">
      <span>VennStat processor is ready{win === 'output' ? ` · ${blocks} output block${blocks === 1 ? '' : 's'}` : ''}</span>
      <span>
        Cases: {ds.nCases}
        {filterName ? ` (${selected} selected)` : ''}
      </span>
      <span>Variables: {ds.variables.length}</span>
      <span className={filterName ? 'on' : ''}>{filterName ? `Filter On (${filterName})` : 'Filter Off'}</span>
      <span className={weightName ? 'on' : ''}>{weightName ? `Weight On (${weightName})` : 'Weight Off'}</span>
      <span>Unicode: ON</span>
    </footer>
  )
}

export default function App() {
  const win = useApp((s) => s.win)
  const dataTab = useApp((s) => s.dataTab)
  const ds = useApp((s) => s.ds)
  const dirty = useApp((s) => s.dirty)
  const untitled = useApp((s) => s.untitledIndex)
  const blocks = useApp((s) => s.blocks.length)
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  const setWin = useApp((s) => s.setWin)
  const menus = useMemo(() => buildMenus(), [])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stop: (() => void) | undefined
    restoreSession().then((restored) => {
      setReady(true)
      stop = startAutosave()
      if (!restored) useApp.getState().openDialog('welcome')
    })
    return () => stop?.()
  }, [])

  useEffect(() => {
    document.title = `${datasetTitle(ds, untitled)}${dirty ? ' *' : ''} — VennStat`
  }, [ds, untitled, dirty])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const target = e.target as HTMLElement
      const inField = target.closest('input, textarea, select, [contenteditable]')
      const k = e.key.toLowerCase()
      if (k === 'o') {
        e.preventDefault()
        openDataFile()
      } else if (k === 's') {
        e.preventDefault()
        saveData()
      } else if ((k === 'z' || k === 'y') && !inField && !useApp.getState().dialog) {
        e.preventDefault()
        if (k === 'y' || e.shiftKey) useApp.getState().redo()
        else useApp.getState().undo()
      } else if (k === '1' || k === '2' || k === '3') {
        e.preventDefault()
        setWin(k === '1' ? 'data' : k === '2' ? 'output' : 'syntax')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setWin])

  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      openDataFile(e.dataTransfer.files[0])
    }
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useApp.getState().dirty) e.preventDefault()
    }
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onOver)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [])

  return (
    <div className="app">
      <header className="titlebar">
        <Logo />
        <div className="title">
          {datasetTitle(ds, untitled)}
          {dirty ? ' *' : ''} <span className="dim">— VennStat {WIN_NAMES[win]}</span>
        </div>
        <div className="wintabs" role="tablist" aria-label="Windows">
          <button role="tab" aria-selected={win === 'data'} className={win === 'data' ? 'active' : ''} onClick={() => setWin('data')} title="Data Editor (Ctrl+1)">
            <Table2 size={14} />
            <span className="wt-label">Data</span>
          </button>
          <button role="tab" aria-selected={win === 'output'} className={win === 'output' ? 'active' : ''} onClick={() => setWin('output')} title="Output Viewer (Ctrl+2)">
            <BarChart3 size={14} />
            <span className="wt-label">Output</span>
            {blocks > 0 && <span className="badge">{blocks}</span>}
          </button>
          <button role="tab" aria-selected={win === 'syntax'} className={win === 'syntax' ? 'active' : ''} onClick={() => setWin('syntax')} title="Syntax Editor (Ctrl+3)">
            <FileCode2 size={14} />
            <span className="wt-label">Syntax</span>
          </button>
        </div>
      </header>
      <MenuBar menus={menus} />
      <Toolbar />
      <main className="workspace">
        {!ready ? null : win === 'data' ? (
          <>
            {dataTab === 'data' ? <DataView /> : <VariableView />}
            <div className="tabs-bottom" role="tablist" aria-label="Data Editor views">
              <button role="tab" aria-selected={dataTab === 'data'} className={dataTab === 'data' ? 'active' : ''} onClick={() => useApp.getState().setDataTab('data')}>
                Data View
              </button>
              <button role="tab" aria-selected={dataTab === 'variables'} className={dataTab === 'variables' ? 'active' : ''} onClick={() => useApp.getState().setDataTab('variables')}>
                Variable View
              </button>
            </div>
          </>
        ) : win === 'output' ? (
          <OutputViewer />
        ) : (
          <SyntaxEditor />
        )}
      </main>
      <StatusBar />
      <DialogHost />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
