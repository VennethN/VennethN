import { createVariable, datasetFromColumns, type Dataset, type ValueLabel } from '../core/dataset'
import type { OutputBlock, PivotTable } from '../core/output'
import { layoutTable } from '../core/output'

/** Build a numeric dataset from a column map (null = system-missing). */
export function datasetFrom(
  cols: Record<string, (number | null)[]>,
  labels: Record<string, ValueLabel[]> = {},
): Dataset {
  const names = Object.keys(cols)
  const vars = names.map((n) => createVariable(n, { decimals: 2, valueLabels: labels[n] ?? [] }))
  return datasetFromColumns(vars, names.map((n) => cols[n]))
}

export function tables(blocks: OutputBlock[]): PivotTable[] {
  return blocks.flatMap((b) => b.items).flatMap((i) => (i.kind === 'table' ? [i.table] : []))
}

export function findTable(blocks: OutputBlock[], title: string): PivotTable {
  const t = tables(blocks).find((x) => x.title === title)
  if (!t) throw new Error(`table "${title}" not found; have: ${tables(blocks).map((x) => x.title).join(', ')}`)
  return t
}

/** Body rows of a table as arrays of cell texts (stub labels included). */
export function grid(t: PivotTable): string[][] {
  return layoutTable(t).body.map((r) => r.map((c) => c.text))
}

/** Row whose stub labels contain all given labels (in order); returns its value cells. */
export function rowValues(t: PivotTable, ...labels: string[]): string[] {
  const { body, stubCols } = layoutTable(t)
  // reconstruct full stub paths (row spans)
  const paths: string[][] = []
  const carry: string[] = []
  const spanLeft: number[] = []
  for (const row of body) {
    const stub: string[] = []
    let c = 0
    let idx = 0
    while (c < stubCols) {
      if (spanLeft[c] > 0) {
        stub.push(carry[c])
        spanLeft[c]--
        c++
        continue
      }
      const cell = row[idx++]
      for (let k = 0; k < cell.colSpan; k++) {
        stub.push(cell.text)
        carry[c + k] = cell.text
        spanLeft[c + k] = cell.rowSpan - 1
      }
      c += cell.colSpan
    }
    paths.push(stub)
    void idx
  }
  for (let r = 0; r < body.length; r++) {
    const p = paths[r]
    let pi = 0
    for (const l of p) if (pi < labels.length && l === labels[pi]) pi++
    if (pi === labels.length) return body[r].filter((c) => c.kind === 'value').map((c) => c.text)
  }
  throw new Error(`row ${labels.join(' > ')} not found in "${t.title}"`)
}

export function errorsIn(blocks: OutputBlock[]): string[] {
  return blocks.flatMap((b) => b.items).flatMap((i) => (i.kind === 'text' && i.tone === 'error' ? [i.text] : []))
}
