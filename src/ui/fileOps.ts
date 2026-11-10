// Opening and saving files. Uses the File System Access API when the browser supports it
// (so "Save" can overwrite the same file), and falls back to downloads otherwise.

import { emptyDataset, type Dataset } from '../core/dataset'
import { datasetToCSV } from '../io/csv'
import { datasetToProject, projectToDataset } from '../io/project'
import { readSav, writeSav } from '../io/sav'
import { useApp } from '../state/store'
import { download, pickFile } from './browser'
import { exportOutputHTML } from './output/exportHtml'

export type DataFormat = 'sav' | 'csv' | 'vstat'

interface FileHandleLike {
  name: string
  createWritable: () => Promise<{ write: (d: BlobPart) => Promise<void>; close: () => Promise<void> }>
}

let currentHandle: FileHandleLike | null = null

const ACCEPT = '.sav,.zsav,.csv,.tsv,.txt,.dat,.vstat,.json,.sps'

export async function openDataFile(file?: File | null): Promise<void> {
  const st = useApp.getState()
  const f = file ?? (await pickFile(ACCEPT))
  if (!f) return
  const lower = f.name.toLowerCase()
  try {
    if (lower.endsWith('.sav') || lower.endsWith('.zsav')) {
      const ds = await readSav(await f.arrayBuffer(), f.name)
      st.replaceDataset(ds)
      currentHandle = null
      st.notify(`Opened ${f.name}: ${ds.nCases} cases, ${ds.variables.length} variables.`)
    } else if (lower.endsWith('.vstat') || lower.endsWith('.json')) {
      const { dataset, syntax } = projectToDataset(await f.text(), f.name)
      st.replaceDataset(dataset)
      currentHandle = null
      if (syntax) st.setSyntax(syntax)
      st.notify(`Opened ${f.name}.`)
    } else if (lower.endsWith('.sps')) {
      st.setSyntax(await f.text(), f.name)
      st.setWin('syntax')
    } else {
      st.openDialog('import-csv', { text: await f.text(), fileName: f.name })
    }
    if (!lower.endsWith('.sps')) st.setDataTab(st.dataTab)
  } catch (e) {
    st.notify(`Could not open ${f.name}: ${(e as Error).message}`, 'error')
  }
}

function formatOf(name: string | null): DataFormat {
  const lower = (name ?? '').toLowerCase()
  if (lower.endsWith('.sav')) return 'sav'
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return 'csv'
  return 'vstat'
}

function encode(ds: Dataset, format: DataFormat): { data: BlobPart; mime: string } {
  const st = useApp.getState()
  if (format === 'sav') return { data: writeSav(ds) as BlobPart, mime: 'application/x-spss-sav' }
  if (format === 'csv') return { data: datasetToCSV(ds), mime: 'text/csv' }
  return { data: datasetToProject(ds, st.syntax || undefined), mime: 'application/json' }
}

function baseName(ds: Dataset, untitled: number): string {
  const n = ds.fileName ?? `Untitled${untitled}`
  return n.replace(/\.(sav|zsav|csv|tsv|txt|dat|vstat|json)$/i, '')
}

const PICKER_TYPES: Record<DataFormat, { description: string; accept: Record<string, string[]> }> = {
  sav: { description: 'SPSS Statistics data', accept: { 'application/x-spss-sav': ['.sav'] } },
  csv: { description: 'Comma-separated values', accept: { 'text/csv': ['.csv'] } },
  vstat: { description: 'VennStat project', accept: { 'application/json': ['.vstat'] } },
}

export async function saveData(format?: DataFormat, forceDialog = false): Promise<void> {
  const st = useApp.getState()
  const ds = st.ds
  if (!ds.variables.length) return st.notify('There is no data to save.', 'error')
  const fmt = format ?? formatOf(ds.fileName)
  const name = `${baseName(ds, st.untitledIndex)}.${fmt}`
  const { data, mime } = encode(ds, fmt)
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileHandleLike> }
  try {
    if (currentHandle && !forceDialog && formatOf(currentHandle.name) === fmt) {
      const wr = await currentHandle.createWritable()
      await wr.write(data)
      await wr.close()
      st.markSaved(currentHandle.name)
      st.notify(`Saved ${currentHandle.name}.`)
      return
    }
    if (w.showSaveFilePicker) {
      const handle = await w.showSaveFilePicker({ suggestedName: name, types: [PICKER_TYPES[fmt]] })
      const wr = await handle.createWritable()
      await wr.write(data)
      await wr.close()
      currentHandle = handle
      st.markSaved(handle.name)
      st.notify(`Saved ${handle.name}.`)
      return
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    // fall back to download
  }
  download(name, data, mime)
  st.markSaved(name)
}

export function exportOutput(): void {
  const st = useApp.getState()
  if (!st.blocks.length) return st.notify('The Output Viewer is empty.', 'error')
  if (st.win !== 'output') st.setWin('output')
  // charts are serialized from the rendered DOM, so wait a frame for the viewer to mount
  requestAnimationFrame(() =>
    setTimeout(() => {
      const html = exportOutputHTML(useApp.getState().blocks, 'VennStat output')
      download('output.html', html, 'text/html')
    }, 50),
  )
}

export function newDataset(): void {
  const st = useApp.getState()
  if (st.dirty && !window.confirm('Discard unsaved changes to the current dataset?')) return
  st.replaceDataset(emptyDataset())
  currentHandle = null
  st.setDataTab('data')
}
