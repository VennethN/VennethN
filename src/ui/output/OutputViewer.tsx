import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  FileText,
  Folder,
  Table2,
  Terminal,
  Trash2,
  TriangleAlert,
  Type,
} from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { itemLabel, layoutTable, tableToHTML, tableToTSV, type OutputBlock, type OutputItem, type PivotTable } from '../../core/output'
import { useApp } from '../../state/store'
import { download } from '../browser'
import { ChartView } from './Chart'
import { chartToSVGString } from './chartUtils'

export function PivotTableView({ table }: { table: PivotTable }) {
  const { head, body } = layoutTable(table)
  return (
    <div className="pt">
      <div className="pt-title">
        {table.title}
        {table.titleSup && <sup>{table.titleSup}</sup>}
      </div>
      {table.caption && <div className="pt-caption">{table.caption}</div>}
      <table>
        <thead>
          {head.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <th key={j} rowSpan={c.rowSpan} colSpan={c.colSpan} className={c.kind === 'corner' ? 'corner' : undefined} scope="col">
                  {c.text}
                  {c.sup && <sup>{c.sup}</sup>}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {body.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) =>
                c.kind === 'value' ? (
                  <td key={j} style={c.align !== 'right' ? { textAlign: c.align } : undefined}>
                    {c.text}
                    {c.sup && <sup>{c.sup}</sup>}
                  </td>
                ) : (
                  <th key={j} rowSpan={c.rowSpan} colSpan={c.colSpan} scope="row">
                    {c.text}
                    {c.sup && <sup>{c.sup}</sup>}
                  </th>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {table.footnotes && table.footnotes.length > 0 && (
        <div className="pt-foot">
          {table.footnotes.map((f, i) => (
            <div key={i}>
              {f.mark}. {f.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ItemIcon({ item }: { item: OutputItem }) {
  switch (item.kind) {
    case 'log':
      return <Terminal size={13} />
    case 'title':
      return <Type size={13} />
    case 'table':
      return <Table2 size={13} />
    case 'chart':
      return <BarChart3 size={13} />
    case 'text':
      return item.tone === 'error' || item.tone === 'warning' ? <TriangleAlert size={13} /> : <FileText size={13} />
  }
}

async function copyTable(t: PivotTable): Promise<boolean> {
  const html = tableToHTML(t)
  const text = tableToTSV(t)
  try {
    if ('ClipboardItem' in window && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      return true
    }
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

async function svgToPng(svg: SVGSVGElement): Promise<Blob | null> {
  const xml = chartToSVGString(svg)
  const img = new Image()
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('image'))
      img.src = url
    })
    const vb = svg.viewBox.baseVal
    const canvas = document.createElement('canvas')
    canvas.width = vb.width * 2
    canvas.height = vb.height * 2
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(2, 2)
    ctx.drawImage(img, 0, 0, vb.width, vb.height)
    return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'output'
}

function OutputItemView({ block, item }: { block: OutputBlock; item: OutputItem }) {
  const selected = useApp((s) => s.selectedItem === item.id)
  const select = useApp((s) => s.selectItem)
  const remove = useApp((s) => s.removeOutput)
  const notify = useApp((s) => s.notify)
  const [showData, setShowData] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])
  let content
  switch (item.kind) {
    case 'log':
      content = <pre className="out-log">{item.text}</pre>
      break
    case 'title':
      content = <div className="out-subtitle">{item.text}</div>
      break
    case 'table':
      content = <PivotTableView table={item.table} />
      break
    case 'chart':
      content = <ChartView chart={item.chart} showTable={showData} />
      break
    case 'text':
      content = (
        <div className={`out-text ${item.tone ?? 'note'} ${item.mono ? 'mono' : ''}`}>
          {item.title && item.tone !== 'note' && <span className="tt">{item.title}</span>}
          {item.text}
        </div>
      )
      break
  }
  return (
    <div
      ref={ref}
      className={`out-item ${selected ? 'sel' : ''}`}
      data-item-id={item.id}
      onMouseDown={() => select(item.id)}
      style={item.kind === 'log' || item.kind === 'title' ? { width: 'auto' } : undefined}
    >
      <div className="item-tools">
        {item.kind === 'table' && (
          <button
            title="Copy table (paste into Word, Excel or Google Docs)"
            aria-label="Copy table"
            onClick={async () => notify((await copyTable(item.table)) ? 'Table copied to the clipboard.' : 'The browser blocked clipboard access.', 'info')}
          >
            <ClipboardCopy size={14} />
          </button>
        )}
        {item.kind === 'chart' && (
          <>
            <button title={showData ? 'Hide data table' : 'Show data table'} aria-label="Toggle data table" onClick={() => setShowData((x) => !x)}>
              <Table2 size={14} />
            </button>
            <button
              title="Download PNG"
              aria-label="Download PNG"
              onClick={async () => {
                const svg = ref.current?.querySelector('svg')
                if (!svg) return
                const png = await svgToPng(svg)
                if (png) download(`${slug(item.chart.title)}.png`, png, 'image/png')
              }}
            >
              <Download size={14} />
            </button>
          </>
        )}
        <button title="Delete" aria-label="Delete item" onClick={() => remove(block.id, item.id)}>
          <Trash2 size={14} />
        </button>
      </div>
      {content}
    </div>
  )
}

export function OutputViewer() {
  const blocks = useApp((s) => s.blocks)
  const selected = useApp((s) => s.selectedItem)
  const select = useApp((s) => s.selectItem)
  const remove = useApp((s) => s.removeOutput)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const paneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // scroll to the newest block when output is appended
    const last = blocks[blocks.length - 1]
    if (!last) return
    const el = paneRef.current?.querySelector(`[data-block-id="${last.id}"]`)
    el?.scrollIntoView({ block: 'start' })
  }, [blocks.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Delete' || !selected) return
    const block = blocks.find((b) => b.id === selected || b.items.some((i) => i.id === selected))
    if (!block) return
    if (block.id === selected) remove(block.id)
    else remove(block.id, selected)
  }

  return (
    <div className="viewer" onKeyDown={onKeyDown} tabIndex={-1}>
      <nav className="outline" aria-label="Output outline">
        <button className="node" onClick={() => paneRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="twisty" />
          <span className="ic">
            <Folder size={13} />
          </span>
          <span className="lbl">Output</span>
        </button>
        {blocks.map((b) => (
          <Fragment key={b.id}>
            <button className={`node ${selected === b.id ? 'sel' : ''}`} style={{ paddingLeft: 16 }} onClick={() => select(b.id)}>
              <span
                className="twisty"
                onClick={(e) => {
                  e.stopPropagation()
                  setCollapsed((c) => ({ ...c, [b.id]: !c[b.id] }))
                }}
              >
                {collapsed[b.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </span>
              <span className="ic">
                <Folder size={13} />
              </span>
              <span className="lbl">{b.title}</span>
            </button>
            {!collapsed[b.id] &&
              b.items.map((it) => (
                <button
                  key={it.id}
                  className={`node ${selected === it.id ? 'sel' : ''}`}
                  style={{ paddingLeft: 40 }}
                  onClick={() => {
                    select(it.id)
                    paneRef.current?.querySelector(`[data-item-id="${it.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                  }}
                  title={itemLabel(it)}
                >
                  <span className="ic">
                    <ItemIcon item={it} />
                  </span>
                  <span className="lbl">{itemLabel(it)}</span>
                </button>
              ))}
          </Fragment>
        ))}
      </nav>
      <div className="out-pane" ref={paneRef}>
        {!blocks.length && (
          <div className="out-empty">
            <h2>The Output Viewer is empty</h2>
            <p>
              Run an analysis from the <b>Analyze</b> or <b>Graphs</b> menu, or run commands from the Syntax Editor. Tables and
              charts appear here.
            </p>
          </div>
        )}
        {blocks.map((b) => (
          <section key={b.id} className="out-block" data-block-id={b.id} onMouseDown={(e) => e.target === e.currentTarget && select(b.id)}>
            {b.title !== 'Log' && <h1>{b.title}</h1>}
            {b.items
              .filter((it, i) => !(it.kind === 'title' && it.text === b.title && b.items.slice(0, i).every((x) => x.kind === 'log')))
              .map((it) => (
                <OutputItemView key={it.id} block={b} item={it} />
              ))}
          </section>
        ))}
      </div>
    </div>
  )
}

