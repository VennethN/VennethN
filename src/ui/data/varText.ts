// Text summaries of variable properties (Variable View cells, dialogs).

import type { Variable } from '../../core/dataset'
import { formatValue } from '../../core/format'

export function missingText(v: Variable): string {
  const m = v.missing
  if (m.kind === 'none') return 'None'
  if (m.kind === 'discrete') return m.values.map((x) => (typeof x === 'number' ? formatValue(v, x) : `"${x}"`)).join(', ')
  const lo = Number.isFinite(m.low) ? formatValue(v, m.low) : 'LO'
  const hi = Number.isFinite(m.high) ? formatValue(v, m.high) : 'HI'
  return `${lo} - ${hi}${m.value !== undefined ? `, ${formatValue(v, m.value)}` : ''}`
}

export function valuesText(v: Variable): string {
  if (!v.valueLabels.length) return 'None'
  const f = v.valueLabels[0]
  const val = typeof f.value === 'number' ? formatValue(v, f.value) : `"${f.value}"`
  return `{${val}, ${f.label}}${v.valueLabels.length > 1 ? '…' : ''}`
}

