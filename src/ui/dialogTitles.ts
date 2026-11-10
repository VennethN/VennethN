import { ANALYSIS_DIALOGS } from './dialogs/defs'

const GENERIC = new Map(ANALYSIS_DIALOGS.map((d) => [d.id, d]))

/** Human-readable names for the "recall recent dialogs" toolbar menu. */
export function dialogTitle(id: string): string {
  const def = GENERIC.get(id)
  if (def) return def.title
  const names: Record<string, string> = {
    compute: 'Compute Variable',
    'recode-same': 'Recode into Same Variables',
    'recode-diff': 'Recode into Different Variables',
    autorecode: 'Automatic Recode',
    rank: 'Rank Cases',
    'select-cases': 'Select Cases',
    'sort-cases': 'Sort Cases',
    'weight-cases': 'Weight Cases',
  }
  return names[id] ?? ''
}
