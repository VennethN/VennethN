import { create } from 'zustand'
import { emptyDataset, type Dataset } from '../core/dataset'
import { setFormatOptions } from '../core/format'
import type { OutputBlock } from '../core/output'
import { executeSpecs, isAnalysis, runSyntax as runSyntaxProgram } from '../procedures/engine'
import type { CommandSpec } from '../procedures/types'
import { generateProgram } from '../syntax/generate'

export type WindowId = 'data' | 'output' | 'syntax'

export interface AppOptions {
  leadingZero: boolean
  dialogLabels: 'labels' | 'names'
  dialogSort: 'file' | 'alpha'
}

export interface OpenDialog {
  id: string
  props?: Record<string, unknown>
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

interface State {
  ds: Dataset
  past: Dataset[]
  future: Dataset[]
  dirty: boolean
  untitledIndex: number
  blocks: OutputBlock[]
  selectedItem: string | null
  syntax: string
  syntaxFileName: string | null
  win: WindowId
  dataTab: 'data' | 'variables'
  showValueLabels: boolean
  dialog: OpenDialog | null
  recentDialogs: string[]
  dialogMemory: Record<string, unknown>
  options: AppOptions
  toasts: Toast[]
  focusVarId: string | null
  focusCase: number | null

  commit: (ds: Dataset) => void
  replaceDataset: (ds: Dataset, opts?: { dirty?: boolean }) => void
  markSaved: (fileName: string) => void
  undo: () => void
  redo: () => void
  setWin: (w: WindowId) => void
  setDataTab: (t: 'data' | 'variables') => void
  toggleValueLabels: () => void
  runSpecs: (specs: CommandSpec[]) => void
  runSyntax: (text: string) => void
  pasteSyntax: (specs: CommandSpec[]) => void
  setSyntax: (text: string, fileName?: string | null) => void
  openDialog: (id: string, props?: Record<string, unknown>) => void
  closeDialog: () => void
  rememberDialog: (id: string, state: unknown) => void
  setOptions: (p: Partial<AppOptions>) => void
  removeOutput: (blockId: string, itemId?: string) => void
  clearOutput: () => void
  selectItem: (id: string | null) => void
  notify: (text: string, tone?: 'info' | 'error') => void
  dismissToast: (id: number) => void
  focusVariable: (id: string | null) => void
  goToCase: (row: number | null) => void
}

const HISTORY = 60
let toastId = 0

export const useApp = create<State>((set, get) => ({
  ds: emptyDataset(),
  past: [],
  future: [],
  dirty: false,
  untitledIndex: 1,
  blocks: [],
  selectedItem: null,
  syntax: '',
  syntaxFileName: null,
  win: 'data',
  dataTab: 'data',
  showValueLabels: false,
  dialog: null,
  recentDialogs: [],
  dialogMemory: {},
  options: { leadingZero: false, dialogLabels: 'labels', dialogSort: 'file' },
  toasts: [],
  focusVarId: null,
  focusCase: null,

  commit: (ds) => {
    const { ds: prev, past } = get()
    if (ds === prev) return
    set({ ds, past: [...past, prev].slice(-HISTORY), future: [], dirty: true })
  },
  replaceDataset: (ds, opts) =>
    set((s) => ({
      ds,
      past: [],
      future: [],
      dirty: opts?.dirty ?? false,
      untitledIndex: ds.fileName ? s.untitledIndex : s.untitledIndex + (s.ds.nCases || s.ds.variables.length ? 1 : 0),
    })),
  markSaved: (fileName) => set((s) => ({ dirty: false, ds: { ...s.ds, fileName } })),
  undo: () => {
    const { past, ds, future } = get()
    if (!past.length) return
    set({ ds: past[past.length - 1], past: past.slice(0, -1), future: [ds, ...future].slice(0, HISTORY), dirty: true })
  },
  redo: () => {
    const { past, ds, future } = get()
    if (!future.length) return
    set({ ds: future[0], future: future.slice(1), past: [...past, ds].slice(-HISTORY), dirty: true })
  },
  setWin: (win) => set({ win }),
  setDataTab: (dataTab) => set({ dataTab, win: 'data' }),
  toggleValueLabels: () => set((s) => ({ showValueLabels: !s.showValueLabels })),
  runSpecs: (specs) => {
    const { ds } = get()
    const r = executeSpecs(ds, specs)
    if (r.dataset !== ds) get().commit(r.dataset)
    const analysis = specs.some(isAnalysis)
    set((s) => ({
      blocks: [...s.blocks, ...r.blocks],
      selectedItem: r.blocks.length ? r.blocks[r.blocks.length - 1].id : s.selectedItem,
      win: analysis || r.errors ? 'output' : s.win,
    }))
    if (!analysis && !r.errors) get().notify('Transformation complete.')
  },
  runSyntax: (text) => {
    const { ds } = get()
    const r = runSyntaxProgram(ds, text)
    if (r.dataset !== ds) get().commit(r.dataset)
    set((s) => ({
      blocks: [...s.blocks, ...r.blocks],
      selectedItem: r.blocks.length ? r.blocks[r.blocks.length - 1].id : s.selectedItem,
      win: 'output',
    }))
    if (r.errors) get().notify(`${r.errors} command${r.errors > 1 ? 's' : ''} reported errors — see the Output Viewer.`, 'error')
  },
  pasteSyntax: (specs) => {
    const text = generateProgram(specs)
    set((s) => ({ syntax: s.syntax ? `${s.syntax.replace(/\s*$/, '')}\n${text}\n` : `${text}\n`, win: 'syntax' }))
  },
  setSyntax: (syntax, fileName) => set((s) => ({ syntax, syntaxFileName: fileName === undefined ? s.syntaxFileName : fileName })),
  openDialog: (id, props) =>
    set((s) => ({ dialog: { id, props }, recentDialogs: [id, ...s.recentDialogs.filter((x) => x !== id)].slice(0, 10) })),
  closeDialog: () => set({ dialog: null }),
  rememberDialog: (id, state) => set((s) => ({ dialogMemory: { ...s.dialogMemory, [id]: state } })),
  setOptions: (p) => {
    const options = { ...get().options, ...p }
    setFormatOptions({ leadingZero: options.leadingZero })
    set({ options })
  },
  removeOutput: (blockId, itemId) =>
    set((s) => ({
      blocks: itemId
        ? s.blocks.map((b) => (b.id === blockId ? { ...b, items: b.items.filter((i) => i.id !== itemId) } : b)).filter((b) => b.items.length)
        : s.blocks.filter((b) => b.id !== blockId),
      selectedItem: null,
    })),
  clearOutput: () => set({ blocks: [], selectedItem: null }),
  selectItem: (selectedItem) => set({ selectedItem }),
  notify: (text, tone = 'info') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 6000 : 3000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  focusVariable: (focusVarId) => set({ focusVarId }),
  goToCase: (focusCase) => set({ focusCase, win: 'data', dataTab: 'data' }),
}))

export function datasetTitle(ds: Dataset, untitledIndex: number): string {
  const file = ds.fileName ?? `Untitled${untitledIndex}`
  return `${file} [${ds.name || 'DataSet1'}]`
}
