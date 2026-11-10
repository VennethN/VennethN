// Small helpers shared by dialog definitions.

import type { Variable } from '../../core/dataset'

export function varDisplay(v: Variable, mode: 'labels' | 'names'): string {
  return mode === 'labels' && v.label ? `${v.label} [${v.name}]` : v.name
}

/** Helpers for building option values. */
export const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
export const bool = (v: unknown): boolean => !!v
export const isNumeric = (v: Variable) => v.type === 'numeric'
