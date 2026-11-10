// Virtualized spreadsheet frame: sticky column headers and row headers synced to a scrolling body.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

export interface GridHandle {
  ensureVisible: (row: number, col: number) => void
  focus: () => void
  cellRect: (row: number, col: number) => { left: number; top: number; width: number; height: number }
  pageRows: () => number
}

export interface GridFrameProps {
  /** Logical rows (the frame adds filler rows to fill the viewport). */
  rowCount: number
  /** Widths of real columns. */
  colWidths: number[]
  /** Width of filler columns appended after the real ones. */
  fillerWidth?: number
  rowHeight?: number
  headerHeight?: number
  rowHeaderWidth?: number
  renderHeader: (col: number, style: CSSProperties) => ReactNode
  renderRowHeader: (row: number, style: CSSProperties) => ReactNode
  renderCell: (row: number, col: number, style: CSSProperties) => ReactNode
  /** Editors etc. positioned in content coordinates; receives the cell geometry helper. */
  overlay?: (cellRect: (row: number, col: number) => { left: number; top: number; width: number; height: number }) => ReactNode
  onKeyDown?: (e: React.KeyboardEvent) => void
  onCopy?: (e: React.ClipboardEvent) => void
  onPaste?: (e: React.ClipboardEvent) => void
  onCut?: (e: React.ClipboardEvent) => void
  ariaLabel: string
}

export const GridFrame = forwardRef<GridHandle, GridFrameProps>(function GridFrame(props, ref) {
  const {
    rowCount,
    colWidths,
    fillerWidth = 72,
    rowHeight = 22,
    headerHeight = 24,
    rowHeaderWidth = 56,
    renderHeader,
    renderRowHeader,
    renderCell,
    overlay,
  } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [size, setSize] = useState({ w: 800, h: 500 })

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const viewRows = Math.ceil(size.h / rowHeight) + 1
  const totalRows = Math.max(rowCount, viewRows + Math.floor(scroll.top / rowHeight))
  const realW = colWidths.reduce((s, w) => s + w, 0)
  const fillerCount = Math.max(3, Math.ceil(Math.max(0, size.w + scroll.left - realW) / fillerWidth) + 1)
  const widths = useMemo(() => [...colWidths, ...new Array(fillerCount).fill(fillerWidth)], [colWidths, fillerCount, fillerWidth])
  const offsets = useMemo(() => {
    const o = new Array<number>(widths.length + 1)
    o[0] = 0
    for (let i = 0; i < widths.length; i++) o[i + 1] = o[i] + widths[i]
    return o
  }, [widths])
  const totalW = offsets[widths.length]
  const totalH = totalRows * rowHeight

  const r0 = Math.max(0, Math.floor(scroll.top / rowHeight) - 2)
  const r1 = Math.min(totalRows - 1, Math.ceil((scroll.top + size.h) / rowHeight) + 2)
  // binary search first visible column
  let lo = 0
  let hi = widths.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1] <= scroll.left) lo = mid + 1
    else hi = mid
  }
  const c0 = Math.max(0, lo - 1)
  let c1 = c0
  while (c1 < widths.length - 1 && offsets[c1 + 1] < scroll.left + size.w + 40) c1++

  const cellRect = useCallback(
    (row: number, col: number) => {
      const w = col < widths.length ? widths[col] : fillerWidth
      const left = col < offsets.length - 1 ? offsets[col] : offsets[offsets.length - 1] + (col - widths.length) * fillerWidth
      return { left, top: row * rowHeight, width: w, height: rowHeight }
    },
    [widths, offsets, rowHeight, fillerWidth],
  )

  useImperativeHandle(
    ref,
    () => ({
      ensureVisible: (row, col) => {
        const el = bodyRef.current
        if (!el) return
        const r = cellRect(row, col)
        if (r.top < el.scrollTop) el.scrollTop = r.top
        else if (r.top + r.height > el.scrollTop + el.clientHeight) el.scrollTop = r.top + r.height - el.clientHeight
        if (r.left < el.scrollLeft) el.scrollLeft = r.left
        else if (r.left + r.width > el.scrollLeft + el.clientWidth) el.scrollLeft = r.left + r.width - el.clientWidth
      },
      focus: () => wrapRef.current?.focus({ preventScroll: true }),
      cellRect,
      pageRows: () => Math.max(1, Math.floor(size.h / rowHeight) - 1),
    }),
    [cellRect, size.h, rowHeight],
  )

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onScroll = () => setScroll({ top: el.scrollTop, left: el.scrollLeft })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const cells: ReactNode[] = []
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      cells.push(
        renderCell(r, c, { left: offsets[c], top: r * rowHeight, width: widths[c], height: rowHeight, lineHeight: `${rowHeight - 1}px` }),
      )
  const heads: ReactNode[] = []
  for (let c = c0; c <= c1; c++) heads.push(renderHeader(c, { left: offsets[c], top: 0, width: widths[c], height: headerHeight }))
  const rows: ReactNode[] = []
  for (let r = r0; r <= r1; r++)
    rows.push(renderRowHeader(r, { left: 0, top: r * rowHeight, width: rowHeaderWidth, height: rowHeight, lineHeight: `${rowHeight - 1}px` }))

  return (
    <div
      className="grid-wrap"
      ref={wrapRef}
      tabIndex={0}
      role="grid"
      aria-label={props.ariaLabel}
      onKeyDown={props.onKeyDown}
      onCopy={props.onCopy}
      onPaste={props.onPaste}
      onCut={props.onCut}
    >
      <div className="grid-corner" style={{ width: rowHeaderWidth, height: headerHeight }} />
      <div className="grid-colhead" style={{ left: rowHeaderWidth, height: headerHeight }}>
        <div style={{ position: 'relative', width: totalW, height: headerHeight, transform: `translateX(${-scroll.left}px)` }}>{heads}</div>
      </div>
      <div className="grid-rowhead" style={{ top: headerHeight, width: rowHeaderWidth }}>
        <div style={{ position: 'relative', height: totalH, transform: `translateY(${-scroll.top}px)` }}>{rows}</div>
      </div>
      <div className="grid-body" ref={bodyRef} style={{ left: rowHeaderWidth, top: headerHeight }}>
        <div style={{ position: 'relative', width: totalW, height: totalH }}>
          {cells}
          {overlay?.(cellRect)}
        </div>
      </div>
    </div>
  )
})
