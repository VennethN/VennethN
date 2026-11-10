// Session autosave in IndexedDB so a page reload restores the data, syntax and output.

import type { OutputBlock } from '../core/output'
import { datasetToProject, projectToDataset } from '../io/project'
import { useApp, type AppOptions } from './store'

const DB = 'vennstat'
const STORE = 'session'
const KEY = 'current'

interface Saved {
  project: string
  fileName: string | null
  blocks: OutputBlock[]
  syntax: string
  options: AppOptions
  showValueLabels: boolean
  untitledIndex: number
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function put(value: Saved): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function get(): Promise<Saved | null> {
  const db = await openDb()
  const v = await new Promise<Saved | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve((req.result as Saved) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return v
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
    db.close()
  } catch {
    /* storage unavailable */
  }
}

/** Restore the previous session; returns true when something was restored. */
export async function restoreSession(): Promise<boolean> {
  try {
    const s = await get()
    if (!s) return false
    const { dataset } = projectToDataset(s.project, s.fileName ?? undefined)
    dataset.fileName = s.fileName
    useApp.setState({
      ds: dataset,
      blocks: s.blocks ?? [],
      syntax: s.syntax ?? '',
      showValueLabels: !!s.showValueLabels,
      untitledIndex: s.untitledIndex ?? 1,
    })
    if (s.options) useApp.getState().setOptions(s.options)
    return dataset.variables.length > 0 || (s.blocks ?? []).length > 0 || !!s.syntax
  } catch {
    return false
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

/** Debounced autosave on every relevant state change. */
export function startAutosave(): () => void {
  return useApp.subscribe((s, prev) => {
    if (
      s.ds === prev.ds &&
      s.blocks === prev.blocks &&
      s.syntax === prev.syntax &&
      s.options === prev.options &&
      s.showValueLabels === prev.showValueLabels
    )
      return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const st = useApp.getState()
      put({
        project: datasetToProject(st.ds),
        fileName: st.ds.fileName,
        blocks: st.blocks,
        syntax: st.syntax,
        options: st.options,
        showValueLabels: st.showValueLabels,
        untitledIndex: st.untitledIndex,
        savedAt: Date.now(),
      }).catch(() => {
        /* private mode or quota: autosave is best effort */
      })
    }, 700)
  })
}
