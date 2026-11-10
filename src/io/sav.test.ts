// Fixtures in __fixtures__/ were written by pyreadstat 1.3.7 (ReadStat) from one pandas DataFrame with
// column_labels, variable_value_labels, missing_ranges, variable_measure, variable_display_width and
// variable_format: sample_bytecode.sav = write_sav(df, path, row_compress=True), sample_uncompressed.sav =
// write_sav(df, path), sample.zsav = write_sav(df, path, compress=True); ranges.sav holds a "1000 THRU HI"
// range and a range plus a discrete missing value. The expected values below are those pyreadstat reports.
import { describe, expect, it } from 'vitest'
import { createVariable, datasetFromColumns, type CellValue, type Dataset, type Variable } from '../core/dataset'
import { readSav, writeSav } from './sav'

// The app tsconfig is browser-only (no Node type definitions), so node:fs is loaded through a computed
// specifier and typed locally instead of adding Node's globals to the whole program.
const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(path: URL): Uint8Array }
const fixture = (name: string) => new Uint8Array(fs.readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)))

/** SPSS date values count seconds from 14 October 1582. */
const spssDate = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1582, 9, 14)) / 1000

/** The 600-byte string in the fixture: every position is identifiable across segment boundaries. */
const LONG_TEXT = 'Start:' + Array.from({ length: 600 }, (_, i) => i % 10).join('').slice(6)

function column(ds: Dataset, name: string): CellValue[] {
  const v = ds.variables.find((x) => x.name === name)
  if (!v) throw new Error(`variable ${name} not found`)
  return ds.data[v.id]
}

function pick<K extends keyof Variable>(ds: Dataset, key: K): Variable[K][] {
  return ds.variables.map((v) => v[key])
}

/** Everything a dataset holds except the generated variable ids. */
function snapshot(ds: Dataset) {
  return {
    nCases: ds.nCases,
    weight: ds.variables.find((v) => v.id === ds.weightVarId)?.name ?? null,
    variables: ds.variables.map((v) => ({ ...v, id: '' })),
    data: ds.variables.map((v) => ds.data[v.id]),
  }
}

function expectSample(ds: Dataset) {
  expect(ds.name).toBe('DataSet1')
  expect(ds.nCases).toBe(8)
  expect(ds.weightVarId).toBeNull()
  expect(pick(ds, 'name')).toEqual(['id', 'gender', 'satisfaction_score', 'income', 'code', 'city', 'comment', 'birth'])
  expect(pick(ds, 'type')).toEqual(['numeric', 'numeric', 'numeric', 'numeric', 'string', 'string', 'string', 'numeric'])
  // Numeric widths/decimals come from the print formats F4.0, F8.2, F6.2, F12.3 and DATE11.
  expect(pick(ds, 'width')).toEqual([4, 8, 6, 12, 1, 17, 600, 11])
  expect(pick(ds, 'decimals')).toEqual([0, 2, 2, 3, 0, 0, 0, 0])
  expect(pick(ds, 'label')).toEqual([
    'Respondent ID',
    'Gender',
    'Overall satisfaction',
    'Annual income (€)',
    'Code letter',
    'City – ville',
    'Free-text comment',
    'Date of birth',
  ])
  // "birth" has measure "unknown" (0) in the file, which falls back to the numeric default.
  expect(pick(ds, 'measure')).toEqual(['scale', 'nominal', 'ordinal', 'scale', 'nominal', 'nominal', 'nominal', 'scale'])
  expect(pick(ds, 'columns')).toEqual([6, 8, 8, 14, 8, 20, 8, 8])
  expect(pick(ds, 'align')).toEqual(['right', 'right', 'right', 'right', 'left', 'left', 'left', 'right'])
  expect(pick(ds, 'role')).toEqual(Array(8).fill('input'))
  expect(pick(ds, 'valueLabels')).toEqual([
    [],
    [
      { value: 1, label: 'Male' },
      { value: 2, label: 'Female' },
      { value: 9, label: 'No answer' },
    ],
    [
      { value: 1, label: 'Very low' },
      { value: 5, label: 'Very high' },
      { value: -1, label: 'Refused' },
    ],
    [],
    [
      { value: 'A', label: 'Alpha' },
      { value: 'B', label: 'Beta' },
      { value: 'X', label: 'Excluded' },
    ],
    // Labels of a string wider than 8 bytes come from the subtype 21 record.
    [
      { value: 'Bandung', label: 'West Java capital' },
      { value: 'Jakarta – café', label: 'Capital – café' },
    ],
    [],
    [],
  ])
  expect(pick(ds, 'missing')).toEqual([
    { kind: 'none' },
    { kind: 'discrete', values: [9] },
    { kind: 'range', low: 90, high: 99, value: -1 },
    { kind: 'range', low: -Infinity, high: -1 },
    { kind: 'discrete', values: ['X'] },
    { kind: 'discrete', values: ['Unknown'] }, // subtype 22
    { kind: 'none' },
    { kind: 'none' },
  ])

  expect(column(ds, 'id')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  expect(column(ds, 'gender')).toEqual([1, 2, 2, 1, 9, 1, null, 2])
  expect(column(ds, 'satisfaction_score')).toEqual([3.5, 4.25, -1, 95, 2, null, 5, 1])
  expect(column(ds, 'income')).toEqual([52000.5, null, 31000, -5, 47000.75, 0, 1e9, 12.125])
  expect(column(ds, 'code')).toEqual(['A', 'B', 'X', '', 'A', 'B', 'A', 'C'])
  expect(column(ds, 'city')).toEqual([
    'Jakarta – café',
    'Bandung',
    'Surabaya',
    'Unknown',
    'Bandung',
    'Medan',
    '',
    'Jakarta – café',
  ])
  expect(column(ds, 'comment')).toEqual([LONG_TEXT, 'short', '', 'x'.repeat(300), 'ü'.repeat(150), 'end', 'y'.repeat(255), 'z'.repeat(256)])
  expect(column(ds, 'birth')).toEqual([
    spssDate(1990, 1, 15),
    spssDate(1985, 6, 30),
    null,
    spssDate(2000, 2, 29),
    spssDate(1970, 1, 1),
    spssDate(1999, 12, 31),
    spssDate(1582, 10, 15),
    spssDate(2024, 7, 4),
  ])
}

describe('readSav: files written by pyreadstat', () => {
  it.each(['sample_bytecode.sav', 'sample_uncompressed.sav', 'sample.zsav'])('reads %s', async (file) => {
    const ds = await readSav(fixture(file), file)
    expect(ds.fileName).toBe(file)
    expectSample(ds)
  })

  it('accepts an ArrayBuffer and leaves fileName empty when not given', async () => {
    const bytes = fixture('sample_bytecode.sav')
    const ds = await readSav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    expect(ds.fileName).toBeNull()
    expect(ds.nCases).toBe(8)
  })

  it('reads open-ended ranges and range-plus-value missing values', async () => {
    const ds = await readSav(fixture('ranges.sav'))
    expect(pick(ds, 'name')).toEqual(['score', 'flag'])
    expect(pick(ds, 'missing')).toEqual([
      { kind: 'range', low: 1000, high: Infinity },
      { kind: 'range', low: 5, high: 7, value: 8 },
    ])
    expect(pick(ds, 'valueLabels')).toEqual([
      [],
      [
        { value: 0, label: 'No' },
        { value: 1, label: 'Yes' },
      ],
    ])
    expect(column(ds, 'score')).toEqual([1, 500, 1500, null])
    expect(column(ds, 'flag')).toEqual([0, 1, 1, 0])
  })
})

// ---------------------------------------------------------------------------------------------
// A hand-built big-endian, windows-1252 file (independent of the writer under test).

const CP1252: Record<string, number> = { '€': 0x80, '–': 0x96 }

class BigEndianFile {
  private readonly parts: number[] = []

  i32(...xs: number[]): this {
    for (const x of xs) {
      const b = new DataView(new ArrayBuffer(4))
      b.setInt32(0, x)
      for (let i = 0; i < 4; i++) this.parts.push(b.getUint8(i))
    }
    return this
  }

  f64(...xs: number[]): this {
    for (const x of xs) {
      const b = new DataView(new ArrayBuffer(8))
      b.setFloat64(0, x)
      for (let i = 0; i < 8; i++) this.parts.push(b.getUint8(i))
    }
    return this
  }

  bytes(...xs: number[]): this {
    this.parts.push(...xs)
    return this
  }

  /** windows-1252 text padded with spaces to `size` bytes. */
  text(s: string, size = s.length): this {
    for (let i = 0; i < size; i++) this.parts.push(i < s.length ? (CP1252[s[i]] ?? s.charCodeAt(i)) : 0x20)
    return this
  }

  result(): Uint8Array {
    return Uint8Array.from(this.parts)
  }
}

const LOWEST = -1.7976931348623155e308
/** A non-default system-missing value, declared in the file's subtype 4 record. */
const CUSTOM_SYSMIS = -1e300

/** Cases as 8-byte units (X, NAME, NAME, W, LS, LS): numbers (null = sysmis) and 8-character strings. */
const BE_CASES: (number | null | string)[][] = [
  [1.5, 'Café    ', '        ', 2, 'n/a     ', '        '],
  [null, '        ', '        ', 1, 'abcdefgh', 'i       '],
  [99, 'Brücke –', ' 1      ', 3, '        ', '        '],
]

function buildBigEndian(compressed: boolean): Uint8Array {
  const f = new BigEndianFile()
  // Header: layout 2, 6 units per case, weight = unit 4; the case count is left unknown (-1).
  f.text('$FL2').text('@(#) SPSS DATA FILE hand-built test', 60)
  f.i32(2, 6, compressed ? 1 : 0, 4, -1).f64(100).text('01 Jan 26').text('00:00:00').text('', 64).bytes(0, 0, 0)
  // X: F5.1 with a label and missing values LO THRU 0 plus 99.
  f.i32(2, 0, 1, -3, 0x050501, 0x050501).text('X', 8).i32(7).text('Größe €', 8).f64(LOWEST, 0, 99)
  // NAME: A10 (one continuation record) with one missing value stored in the variable record.
  f.i32(2, 10, 0, 1, 0x010a00, 0x010a00).text('NAME', 8).text('none', 8)
  f.i32(2, -1, 0, 0, 0, 0).text('', 8)
  // W: F8.0, the weight variable.
  f.i32(2, 0, 0, 0, 0x050800, 0x050800).text('W', 8)
  // LS: A9; its labels and missing values are in subtypes 21 and 22 below.
  f.i32(2, 9, 0, 0, 0x010900, 0x010900).text('LS', 8)
  f.i32(2, -1, 0, 0, 0, 0).text('', 8)
  // Value labels for X (dictionary index 1).
  f.i32(3, 2).f64(1).bytes(4).text('Eins', 7).f64(2).bytes(10).text('Zwei – zwo', 15).i32(4, 1, 1)
  // A document record and an unknown extension record: both skipped.
  f.i32(6, 1).text('A document line', 80)
  f.i32(7, 99, 1, 5).text('junk!')
  // Machine integer info: big-endian (1), code page 1252.
  f.i32(7, 3, 4, 8, 1, 0, 0, -1, 1, 1, 1, 1252)
  // Machine floating-point info: SYSMIS, HIGHEST, LOWEST.
  f.i32(7, 4, 8, 3).f64(CUSTOM_SYSMIS, Number.MAX_VALUE, LOWEST)
  // Display parameters per variable record: measure, columns, alignment.
  f.i32(7, 11, 4, 12, 2, 10, 2, 1, 12, 0, 3, 8, 1, 1, 9, 0)
  const names = 'X=Größe\tNAME=Name\tW=weight\tLS=long_str'
  f.i32(7, 13, 1, names.length).text(names)
  // Long string value labels (subtype 21): 'n/a' -> 'Not applicable'.
  f.i32(7, 21, 1, 51).i32(8).text('long_str').i32(9, 1, 9).text('n/a', 9).i32(14).text('Not applicable')
  // Long string missing values (subtype 22), in the variant with a length before every value.
  f.i32(7, 22, 1, 37).i32(8).text('long_str').bytes(2).i32(8).text('n/a', 8).i32(8).text('skip', 8)
  // 64-bit case count (subtype 16): 3.
  f.i32(7, 16, 8, 2, 0, 1, 0, 3)
  f.i32(999, 0)

  if (!compressed) {
    for (const unit of BE_CASES.flat()) {
      if (typeof unit === 'string') f.text(unit, 8)
      else f.f64(unit ?? CUSTOM_SYSMIS)
    }
    return f.result()
  }
  let codes: number[] = []
  let raw: (() => void)[] = []
  const flush = () => {
    f.bytes(...codes, ...Array(8 - codes.length).fill(0))
    raw.forEach((write) => write())
    codes = []
    raw = []
  }
  const push = (code: number, write?: () => void) => {
    codes.push(code)
    if (write) raw.push(write)
    if (codes.length === 8) flush()
  }
  for (const unit of BE_CASES.flat()) {
    if (unit === null) push(255)
    else if (typeof unit === 'number') {
      if (Number.isInteger(unit) && unit >= -99 && unit <= 151) push(unit + 100)
      else push(253, () => f.f64(unit))
    } else if (unit.trim() === '') push(254)
    else push(253, () => f.text(unit, 8))
  }
  push(252)
  if (codes.length > 0) flush()
  return f.result()
}

describe('readSav: big-endian windows-1252 file', () => {
  it.each([true, false])('reads it (bytecode: %s)', async (compressed) => {
    const ds = await readSav(buildBigEndian(compressed))
    expect(ds.nCases).toBe(3)
    expect(pick(ds, 'name')).toEqual(['Größe', 'Name', 'weight', 'long_str'])
    expect(pick(ds, 'type')).toEqual(['numeric', 'string', 'numeric', 'string'])
    expect(pick(ds, 'width')).toEqual([5, 10, 8, 9])
    expect(pick(ds, 'decimals')).toEqual([1, 0, 0, 0])
    expect(pick(ds, 'label')).toEqual(['Größe €', '', '', ''])
    expect(pick(ds, 'measure')).toEqual(['ordinal', 'nominal', 'scale', 'nominal'])
    expect(pick(ds, 'columns')).toEqual([10, 12, 8, 9])
    expect(pick(ds, 'align')).toEqual(['center', 'left', 'right', 'left'])
    expect(pick(ds, 'missing')).toEqual([
      { kind: 'range', low: -Infinity, high: 0, value: 99 },
      { kind: 'discrete', values: ['none'] },
      { kind: 'none' },
      { kind: 'discrete', values: ['n/a', 'skip'] },
    ])
    expect(pick(ds, 'valueLabels')).toEqual([
      [
        { value: 1, label: 'Eins' },
        { value: 2, label: 'Zwei – zwo' },
      ],
      [],
      [],
      [{ value: 'n/a', label: 'Not applicable' }],
    ])
    expect(column(ds, 'Größe')).toEqual([1.5, null, 99])
    expect(column(ds, 'Name')).toEqual(['Café', '', 'Brücke – 1'])
    expect(column(ds, 'weight')).toEqual([2, 1, 3])
    expect(column(ds, 'long_str')).toEqual(['n/a', 'abcdefghi', ''])
    expect(ds.weightVarId).toBe(ds.variables[2].id)
  })
})

describe('readSav: invalid files', () => {
  it('rejects data that is not a system file', async () => {
    await expect(readSav(new TextEncoder().encode('id,name\n1,a\n'))).rejects.toThrow(/not an SPSS data file/)
    await expect(readSav(new Uint8Array(0))).rejects.toThrow(/not an SPSS data file/)
  })

  it('explains unsupported portable and encrypted files', async () => {
    const por = new TextEncoder().encode(`${' '.repeat(40)}ASCII SPSS PORT FILE${' '.repeat(200)}`)
    await expect(readSav(por)).rejects.toThrow(/portable files \(\.por\) are not supported/)
    const encrypted = new TextEncoder().encode(`\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008ENCRYPTEDSAV${'\u0000'.repeat(64)}`)
    await expect(readSav(encrypted)).rejects.toThrow(/password-protected/)
  })

  it('reports truncated files', async () => {
    const compressed = fixture('sample_bytecode.sav')
    await expect(readSav(compressed.subarray(0, 100))).rejects.toThrow(/truncated/)
    await expect(readSav(compressed.subarray(0, 1500))).rejects.toThrow(/truncated/)
    await expect(readSav(compressed.subarray(0, compressed.length - 300))).rejects.toThrow(/truncated or damaged: .*case/)
    const plain = fixture('sample_uncompressed.sav')
    await expect(readSav(plain.subarray(0, plain.length - 100))).rejects.toThrow(/truncated or damaged: .*case 8/)
  })

  it('reports damaged ZSAV data', async () => {
    const zsav = fixture('sample.zsav').slice()
    // The single zlib block starts at byte 3966 (see the ZSAV trailer); scramble its middle.
    for (let i = 4100; i < 4140; i++) zsav[i] ^= 0x5a
    await expect(readSav(zsav)).rejects.toThrow(/damaged/)
  })
})

// ---------------------------------------------------------------------------------------------
// Writing

/** A dataset exercising every property the model holds, including very long strings. */
function richDataset(): Dataset {
  const vars = [
    createVariable('respondent_identifier', {
      width: 10,
      decimals: 0,
      label: 'Respondent – ID',
      measure: 'nominal',
      columns: 12,
      align: 'left',
      role: 'none',
    }),
    createVariable('score', {
      decimals: 2,
      label: 'Score (0–100)',
      valueLabels: [
        { value: 1, label: 'Low' },
        { value: 2.5, label: 'Mid – café' },
        { value: -1, label: 'Refused' },
      ],
      missing: { kind: 'range', low: 90, high: Infinity, value: -1 },
      measure: 'ordinal',
    }),
    createVariable('values', { width: 12, decimals: 3, missing: { kind: 'range', low: -Infinity, high: -1000 } }),
    createVariable('weight_var', { decimals: 1, label: 'Case weight' }),
    createVariable('group', {
      decimals: 0,
      valueLabels: [
        { value: 1, label: 'One' },
        { value: 8, label: 'Eight' },
      ],
      missing: { kind: 'discrete', values: [8, 9] },
      measure: 'ordinal',
      role: 'target',
    }),
    createVariable('code', {
      type: 'string',
      width: 3,
      valueLabels: [
        { value: 'A', label: 'Alpha' },
        { value: 'B', label: 'Beta' },
      ],
      missing: { kind: 'discrete', values: ['Z'] },
      role: 'both',
    }),
    createVariable('city_name', {
      type: 'string',
      width: 20,
      label: 'City – ville',
      valueLabels: [{ value: 'Zürich', label: 'Swiss city' }],
      missing: { kind: 'discrete', values: ['n/a', 'none'] },
      align: 'center',
      role: 'partition',
    }),
    createVariable('notes', {
      type: 'string',
      width: 300,
      valueLabels: [{ value: 'short', label: 'A short note' }],
      missing: { kind: 'discrete', values: ['none'] },
      measure: 'ordinal',
      role: 'split',
    }),
    createVariable('text_1000', { type: 'string', width: 1000, columns: 40 }),
    createVariable('w255', { type: 'string', width: 255 }),
    createVariable('w256', { type: 'string', width: 256 }),
    createVariable('w504', { type: 'string', width: 504 }),
    createVariable('w510', { type: 'string', width: 510 }),
  ]
  const digits = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(48 + (i % 75))).join('')
  const ds = datasetFromColumns(vars, [
    [1, 2, 3, 4, 5, 6],
    [1, 2.5, null, -1, 95, 0.125],
    // 151/-99 are the limits of bytecode's compressed integers; the rest need raw values.
    [151, 152, -99, -100, 3.14159, -1.5e300],
    [1, 2, 0.5, 1, 3, null],
    [1, 8, 9, 1, null, 2],
    ['A', 'B', 'Z', '', 'A', 'C'],
    ['Jakarta – café', 'Zürich', '東京', '', 'São Paulo', 'n/a'],
    ['α'.repeat(150), 'x'.repeat(300), '', 'short', '€'.repeat(100), 'y'.repeat(299) + 'z'],
    [digits(1000), '', 'end', digits(998) + 'ü', 'q'.repeat(1000), 'ä'.repeat(500)],
    ['a'.repeat(255), '', 'b', 'c'.repeat(254), 'é'.repeat(127), 'z'],
    ['b'.repeat(256), 'a'.repeat(255) + 'Z', '', 'x', 'é'.repeat(128), 'k'],
    [digits(504), '', 'q', 'd'.repeat(503), 'é'.repeat(252), 'e'],
    [digits(510), 'f'.repeat(509), '', 'g', 'é'.repeat(255), 'h'],
  ])
  ds.weightVarId = vars[3].id
  return ds
}

function latin1(b: Uint8Array): string {
  return Array.from(b, (c) => String.fromCharCode(c)).join('')
}

describe('writeSav', () => {
  it.each(['bytecode', 'none'] as const)('round-trips every property the model holds (%s)', async (compression) => {
    const ds = richDataset()
    const back = await readSav(writeSav(ds, { compression }), 'rich.sav')
    expect(back.fileName).toBe('rich.sav')
    expect(back.name).toBe('DataSet1')
    expect(snapshot(back)).toEqual(snapshot(ds))
  })

  it.each(['bytecode', 'none'] as const)('round-trips the pyreadstat fixture (%s)', async (compression) => {
    const original = await readSav(fixture('sample_bytecode.sav'))
    const again = await readSav(writeSav(original, { compression }))
    expect(snapshot(again)).toEqual(snapshot(original))
  })

  it('writes a little-endian $FL2 header and UTF-8 encoding records', () => {
    const ds = richDataset()
    for (const compression of ['bytecode', 'none'] as const) {
      const bytes = writeSav(ds, { compression })
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      expect(latin1(bytes.subarray(0, 4))).toBe('$FL2')
      expect(latin1(bytes.subarray(4, 23))).toBe('@(#) SPSS DATA FILE')
      expect(view.getInt32(64, true)).toBe(2) // layout code
      expect(view.getInt32(72, true)).toBe(compression === 'bytecode' ? 1 : 0)
      expect(view.getInt32(80, true)).toBe(6) // cases
      expect(view.getFloat64(84, true)).toBe(100) // bias
      const text = latin1(bytes)
      // Subtype 20 names the encoding; subtype 3 carries code page 65001 as its last integer.
      expect(text).toContain(latin1(new Uint8Array([7, 0, 0, 0, 20, 0, 0, 0, 1, 0, 0, 0, 5, 0, 0, 0])) + 'UTF-8')
      const info = text.indexOf(latin1(new Uint8Array([7, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 8, 0, 0, 0])))
      expect(info).toBeGreaterThan(0)
      expect(view.getInt32(info + 16 + 28, true)).toBe(65001)
    }
  })

  it('compresses: bytecode output is smaller than uncompressed output', () => {
    const vars = [createVariable('n', { decimals: 0 }), createVariable('s', { type: 'string', width: 24 })]
    const ds = datasetFromColumns(vars, [
      Array.from({ length: 500 }, (_, i) => i % 50),
      Array.from({ length: 500 }, (_, i) => (i % 2 ? 'x' : '')),
    ])
    expect(writeSav(ds).length).toBeLessThan(writeSav(ds, { compression: 'none' }).length / 3)
  })

  it('keeps distinct long names whose first 8 characters collide', async () => {
    const vars = ['satisfaction_a', 'satisfaction_b', 'SATISFAC', 'satisfac1', 'x'].map((n) => createVariable(n))
    const ds = datasetFromColumns(vars, [[1], [2], [3], [4], [5]])
    const back = await readSav(writeSav(ds))
    expect(pick(back, 'name')).toEqual(['satisfaction_a', 'satisfaction_b', 'SATISFAC', 'satisfac1', 'x'])
    expect(back.variables.map((v) => back.data[v.id][0])).toEqual([1, 2, 3, 4, 5])
  })

  it('adjusts names that SPSS would reject', async () => {
    const vars = ['my var', 'BY', '1st', 'naïve.', 'my_var'].map((n) => createVariable(n))
    const back = await readSav(writeSav(datasetFromColumns(vars, [[1], [2], [3], [4], [5]])))
    expect(pick(back, 'name')).toEqual(['my_var', 'BY_1', 'V1st', 'naïve', 'my_var_2'])
  })

  it('widens string widths to the UTF-8 byte length and applies the format limits', async () => {
    const vars = [
      createVariable('s', {
        type: 'string',
        width: 4,
        label: 'é'.repeat(200),
        missing: { kind: 'discrete', values: ['unknown value'] },
        valueLabels: [{ value: 'café', label: 'L'.repeat(300) }],
      }),
      createVariable('t', { type: 'string', width: 30, missing: { kind: 'discrete', values: ['unknown value'] } }),
    ]
    const back = await readSav(writeSav(datasetFromColumns(vars, [['café', 'tea'], ['x', 'y']])))
    const [s, t] = back.variables
    expect(s.width).toBe(5) // 'café' takes 5 bytes
    expect(back.data[s.id]).toEqual(['café', 'tea'])
    expect(s.label).toBe('é'.repeat(127)) // 255 bytes, cut at a character boundary
    expect(s.valueLabels).toEqual([{ value: 'café', label: 'L'.repeat(255) }])
    expect(s.missing).toEqual({ kind: 'discrete', values: ['unkno'] }) // cut to the 5-byte width
    expect(t.missing).toEqual({ kind: 'discrete', values: ['unknown'] }) // long strings: 8 bytes
  })

  it('writes datasets without cases', async () => {
    const vars = [createVariable('a'), createVariable('b', { type: 'string', width: 400 })]
    const back = await readSav(writeSav(datasetFromColumns(vars, [[], []])))
    expect(back.nCases).toBe(0)
    expect(pick(back, 'name')).toEqual(['a', 'b'])
    expect(pick(back, 'width')).toEqual([8, 400])
  })

  it('refuses a dataset without variables', () => {
    expect(() => writeSav(datasetFromColumns([], []))).toThrow(/no variables/)
  })
})
