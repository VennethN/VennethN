// Output Viewer model: blocks of items (log, titles, pivot tables, charts, text) produced by procedures.

export interface CellObj {
  text: string
  /** Footnote marker(s) shown as superscript, e.g. "a" or "**". */
  sup?: string
  align?: 'left' | 'right' | 'center'
}
export type Cell = string | CellObj

export interface ColumnNode {
  label: string
  sup?: string
  children?: ColumnNode[]
}

export interface RowNode {
  label: string
  sup?: string
  children?: RowNode[]
  /** Value cells (only on leaf rows). */
  cells?: Cell[]
}

export interface Footnote {
  mark: string
  text: string
}

export interface PivotTable {
  title: string
  titleSup?: string
  /** Caption shown above the table body, left aligned (e.g. "Dependent Variable: score"). */
  caption?: string
  /** Labels for the stub (row-header) columns, shown in the top-left corner. */
  corner?: string[]
  columns: ColumnNode[]
  rows: RowNode[]
  footnotes?: Footnote[]
}

// ------------------------------------------------------------------------- charts

export interface BarSeries {
  name: string
  values: number[]
}

export type ChartSpec =
  | {
      type: 'bar'
      title: string
      xLabel: string
      yLabel: string
      categories: string[]
      series: BarSeries[]
      /** Show percentage axis formatting. */
      percent?: boolean
    }
  | { type: 'pie'; title: string; categories: string[]; values: number[]; legendTitle?: string }
  | {
      type: 'histogram'
      title: string
      xLabel: string
      bins: { x0: number; x1: number; count: number }[]
      normal?: { mean: number; sd: number; n: number }
      stats?: { mean: number; sd: number; n: number }
    }
  | {
      type: 'scatter'
      title: string
      xLabel: string
      yLabel: string
      groups: { name: string; points: [number, number][] }[]
      /** Reference/fit lines drawn across the plot as y = intercept + slope * x. */
      lines?: { slope: number; intercept: number; label?: string }[]
      /** Fix axis range, e.g. [0, 1] for P-P plots. */
      xDomain?: [number, number]
      yDomain?: [number, number]
    }
  | {
      type: 'box'
      title: string
      xLabel?: string
      yLabel: string
      boxes: BoxSummary[]
    }
  | { type: 'line'; title: string; xLabel: string; yLabel: string; categories: string[]; values: (number | null)[] }

export interface BoxSummary {
  label: string
  n: number
  q1: number
  median: number
  q3: number
  whiskerLow: number
  whiskerHigh: number
  /** Outliers (1.5–3 box lengths) and extremes (> 3 box lengths) with their case numbers. */
  outliers: { value: number; caseNo: number }[]
  extremes: { value: number; caseNo: number }[]
}

// ------------------------------------------------------------------------- items & blocks

export type OutputItem =
  | { id: string; kind: 'log'; text: string }
  | { id: string; kind: 'title'; text: string }
  | { id: string; kind: 'table'; table: PivotTable }
  | { id: string; kind: 'chart'; chart: ChartSpec }
  | { id: string; kind: 'text'; title?: string; text: string; tone?: 'note' | 'warning' | 'error'; mono?: boolean }

export interface OutputBlock {
  id: string
  /** Procedure heading shown in the outline, e.g. "Frequencies". */
  title: string
  items: OutputItem[]
  createdAt: number
}

let outputCounter = 0
export function outId(prefix = 'o'): string {
  outputCounter += 1
  return `${prefix}${Date.now().toString(36)}_${outputCounter}`
}

export const out = {
  title: (text: string): OutputItem => ({ id: outId(), kind: 'title', text }),
  log: (text: string): OutputItem => ({ id: outId(), kind: 'log', text }),
  table: (table: PivotTable): OutputItem => ({ id: outId(), kind: 'table', table }),
  chart: (chart: ChartSpec): OutputItem => ({ id: outId(), kind: 'chart', chart }),
  text: (text: string, tone: 'note' | 'warning' | 'error' = 'note', title?: string, mono = false): OutputItem => ({
    id: outId(),
    kind: 'text',
    text,
    tone,
    title,
    mono,
  }),
}

/** Display name of an item in the outline tree. */
export function itemLabel(item: OutputItem): string {
  switch (item.kind) {
    case 'log':
      return 'Log'
    case 'title':
      return 'Title'
    case 'table':
      return item.table.title
    case 'chart':
      return item.chart.title || chartTypeName(item.chart.type)
    case 'text':
      return item.title ?? (item.tone === 'error' ? 'Error' : item.tone === 'warning' ? 'Warnings' : 'Text')
  }
}

function chartTypeName(t: ChartSpec['type']): string {
  return { bar: 'Bar Chart', pie: 'Pie Chart', histogram: 'Histogram', scatter: 'Scatterplot', box: 'Boxplot', line: 'Line Chart' }[t]
}

// ------------------------------------------------------------------------- table layout

export interface LayoutCell {
  text: string
  sup?: string
  rowSpan: number
  colSpan: number
  kind: 'corner' | 'colhead' | 'rowhead' | 'value'
  align: 'left' | 'right' | 'center'
  /** True for the last header row / last row of a row group (for borders). */
  groupEnd?: boolean
}

export interface TableLayout {
  head: LayoutCell[][]
  body: LayoutCell[][]
  stubCols: number
  valueCols: number
}

function colDepth(nodes: ColumnNode[]): number {
  let d = 0
  for (const n of nodes) d = Math.max(d, 1 + (n.children?.length ? colDepth(n.children) : 0))
  return d
}

function colLeaves(n: ColumnNode): number {
  return n.children?.length ? n.children.reduce((s, c) => s + colLeaves(c), 0) : 1
}

function rowDepth(nodes: RowNode[]): number {
  let d = 0
  for (const n of nodes) d = Math.max(d, 1 + (n.children?.length ? rowDepth(n.children) : 0))
  return d
}

function rowLeaves(n: RowNode): number {
  return n.children?.length ? n.children.reduce((s, c) => s + rowLeaves(c), 0) : 1
}

function toCellObj(c: Cell | undefined): CellObj {
  if (c === undefined) return { text: '' }
  return typeof c === 'string' ? { text: c } : c
}

/** Turn a nested pivot table into header/body grids with row/col spans (used for rendering & export). */
export function layoutTable(t: PivotTable): TableLayout {
  const hDepth = Math.max(1, colDepth(t.columns))
  const stubCols = Math.max(1, rowDepth(t.rows))
  const valueCols = t.columns.reduce((s, c) => s + colLeaves(c), 0)
  const head: LayoutCell[][] = Array.from({ length: hDepth }, () => [])
  // corner
  head[0].push({
    text: (t.corner ?? []).filter(Boolean).join(' '),
    rowSpan: hDepth,
    colSpan: stubCols,
    kind: 'corner',
    align: 'left',
  })
  const walkCols = (nodes: ColumnNode[], level: number) => {
    for (const n of nodes) {
      const hasKids = !!n.children?.length
      head[level].push({
        text: n.label,
        sup: n.sup,
        colSpan: colLeaves(n),
        rowSpan: hasKids ? 1 : hDepth - level,
        kind: 'colhead',
        align: 'center',
        groupEnd: !hasKids,
      })
      if (hasKids) walkCols(n.children!, level + 1)
    }
  }
  walkCols(t.columns, 0)

  const body: LayoutCell[][] = []
  const walkRows = (nodes: RowNode[], level: number, prefix: LayoutCell[]) => {
    nodes.forEach((n, idx) => {
      const isLast = idx === nodes.length - 1
      const hasKids = !!n.children?.length
      const label: LayoutCell = {
        text: n.label,
        sup: n.sup,
        rowSpan: rowLeaves(n),
        colSpan: hasKids ? 1 : stubCols - level,
        kind: 'rowhead',
        align: 'left',
        groupEnd: isLast,
      }
      if (hasKids) {
        walkRows(n.children!, level + 1, [...prefix, label])
      } else {
        const cells = Array.from({ length: valueCols }, (_, j) => {
          const c = toCellObj(n.cells?.[j])
          return {
            text: c.text,
            sup: c.sup,
            rowSpan: 1,
            colSpan: 1,
            kind: 'value' as const,
            align: c.align ?? 'right',
          }
        })
        body.push([...prefix, label, ...cells])
      }
      prefix = []
    })
  }
  walkRows(t.rows, 0, [])
  return { head, body, stubCols, valueCols }
}

/** Plain-text (tab separated) rendering of a pivot table for clipboard export. */
export function tableToTSV(t: PivotTable): string {
  const { head, body, stubCols, valueCols } = layoutTable(t)
  const width = stubCols + valueCols
  const grid = (rows: LayoutCell[][]): string[][] => {
    const out: string[][] = rows.map(() => new Array<string>(width).fill(''))
    const filled: boolean[][] = rows.map(() => new Array<boolean>(width).fill(false))
    rows.forEach((row, r) => {
      let c = 0
      for (const cell of row) {
        while (c < width && filled[r][c]) c++
        out[r][c] = cell.text + (cell.sup ? cell.sup : '')
        for (let dr = 0; dr < cell.rowSpan; dr++)
          for (let dc = 0; dc < cell.colSpan; dc++) if (r + dr < rows.length) filled[r + dr][c + dc] = true
        c += cell.colSpan
      }
    })
    return out
  }
  const lines = [t.title + (t.titleSup ? t.titleSup : '')]
  if (t.caption) lines.push(t.caption)
  for (const r of grid(head)) lines.push(r.join('\t'))
  for (const r of grid(body)) lines.push(r.join('\t'))
  for (const f of t.footnotes ?? []) lines.push(`${f.mark}. ${f.text}`)
  return lines.join('\n')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** HTML rendering of a pivot table (for clipboard and HTML export). */
export function tableToHTML(t: PivotTable): string {
  const { head, body } = layoutTable(t)
  const td = (c: LayoutCell, tag: 'th' | 'td') =>
    `<${tag}${c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : ''}${c.colSpan > 1 ? ` colspan="${c.colSpan}"` : ''} style="text-align:${c.align};padding:2px 6px;border:1px solid #c8c8c8;${tag === 'th' ? 'background:#f3f3f3;font-weight:normal;' : ''}">${esc(c.text)}${c.sup ? `<sup>${esc(c.sup)}</sup>` : ''}</${tag}>`
  const parts: string[] = []
  parts.push(`<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:9pt">`)
  parts.push(
    `<caption style="font-weight:bold;padding:4px">${esc(t.title)}${t.titleSup ? `<sup>${esc(t.titleSup)}</sup>` : ''}</caption>`,
  )
  parts.push('<thead>')
  if (t.caption)
    parts.push(`<tr><td colspan="99" style="text-align:left;padding:2px 6px">${esc(t.caption)}</td></tr>`)
  for (const row of head) parts.push(`<tr>${row.map((c) => td(c, 'th')).join('')}</tr>`)
  parts.push('</thead><tbody>')
  for (const row of body) parts.push(`<tr>${row.map((c) => td(c, c.kind === 'value' ? 'td' : 'th')).join('')}</tr>`)
  parts.push('</tbody>')
  if (t.footnotes?.length)
    parts.push(
      `<tfoot>${t.footnotes.map((f) => `<tr><td colspan="99" style="text-align:left;padding:2px 6px;font-size:8pt">${esc(f.mark)}. ${esc(f.text)}</td></tr>`).join('')}</tfoot>`,
    )
  parts.push('</table>')
  return parts.join('')
}
