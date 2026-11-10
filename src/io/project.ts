// Native project file (.vstat): JSON with the dictionary, data and optional syntax.

import { createVariable, datasetFromColumns, type CellValue, type Dataset, type Variable } from '../core/dataset'

export interface ProjectFile {
  format: 'vennstat'
  version: 1
  name: string
  variables: Omit<Variable, 'id'>[]
  data: CellValue[][]
  filter: string | null
  weight: string | null
  syntax?: string
}

export function datasetToProject(ds: Dataset, syntax?: string): string {
  const name = (id: string | null) => (id ? (ds.variables.find((v) => v.id === id)?.name ?? null) : null)
  const file: ProjectFile = {
    format: 'vennstat',
    version: 1,
    name: ds.name,
    variables: ds.variables.map(({ id: _id, ...rest }) => {
      void _id
      return {
        ...rest,
        // JSON cannot hold Infinity; encode open-ended missing ranges as null
        missing:
          rest.missing.kind === 'range'
            ? ({
                ...rest.missing,
                low: Number.isFinite(rest.missing.low) ? rest.missing.low : (null as unknown as number),
                high: Number.isFinite(rest.missing.high) ? rest.missing.high : (null as unknown as number),
              } as Variable['missing'])
            : rest.missing,
      }
    }),
    data: ds.variables.map((v) => ds.data[v.id]),
    filter: name(ds.filterVarId),
    weight: name(ds.weightVarId),
    syntax,
  }
  return JSON.stringify(file)
}

export function projectToDataset(text: string, fileName?: string): { dataset: Dataset; syntax?: string } {
  let file: ProjectFile
  try {
    file = JSON.parse(text)
  } catch {
    throw new Error('The project file is not valid JSON.')
  }
  if (file.format !== 'vennstat' || !Array.isArray(file.variables) || !Array.isArray(file.data))
    throw new Error('This is not a VennStat project file.')
  const vars = file.variables.map((v) => {
    const m = v.missing
    const missing =
      m && m.kind === 'range'
        ? { ...m, low: m.low ?? -Infinity, high: m.high ?? Infinity }
        : (m ?? { kind: 'none' as const })
    return createVariable(v.name, { ...v, missing })
  })
  const ds = datasetFromColumns(vars, file.data)
  ds.name = file.name || 'DataSet1'
  ds.fileName = fileName ?? null
  const byName = (n: string | null) => (n ? (vars.find((v) => v.name === n)?.id ?? null) : null)
  ds.filterVarId = byName(file.filter)
  ds.weightVarId = byName(file.weight)
  return { dataset: ds, syntax: file.syntax }
}
