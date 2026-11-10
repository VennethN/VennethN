// SPSS system files: read .sav/.zsav into a Dataset, and write a Dataset as .sav.
//
// The layout follows the "System File Format" appendix of the GNU PSPP developer documentation:
//
//   file header (176 bytes; "$FL2", or "$FL3" for ZSAV)
//   dictionary: type 2 variable records (plus continuation records for strings wider than 8 bytes),
//               type 3 + 4 value labels, type 6 documents, type 7 extension records
//   type 999 end of dictionary
//   case data: uncompressed, bytecode-compressed, or (ZSAV) zlib blocks of bytecode data
//
// Reader: either byte order; uncompressed, bytecode and ZSAV data; variable labels; numeric and
// string missing values, including LO/HI ranges and long-string missing values (subtype 22); print
// formats (width/decimals; date and time formats are read as plain numbers with 0 decimals); value
// labels (records 3/4 and subtype 21); extension subtypes 3 (character code), 4 (sysmis value),
// 11 (measure/columns/alignment), 13 (long names), 14 (very long strings), 16 (64-bit case count),
// 18 (variable role from the "$@Role" attribute) and 20 (encoding name). Other records (documents,
// multiple response sets, custom attributes, ...) are skipped using their length fields.
//
// Writer: "$FL2", little-endian, UTF-8 (subtypes 3 and 20), bytecode compression (bias 100) or
// uncompressed data. It stores everything the Dataset model holds except the filter variable, which
// system files do not record: names (8-byte short names plus the subtype 13 long-name map), labels,
// print/write formats (F w.d, A w), missing values, value labels, measure/columns/alignment
// (subtype 11), roles (subtype 18), the weight variable (header) and very long strings (subtype 14).
// Limits imposed by the format:
// - string widths are in bytes: a string column is widened when its UTF-8 text needs more bytes than
//   its width (up to 32767 bytes, longer text is truncated);
// - variable labels and value labels are truncated to 255 bytes;
// - missing values of strings wider than 8 bytes can only hold 8 bytes and are truncated;
// - names are adjusted to SPSS rules where needed (at most 64 bytes, valid characters, unique).

import {
  createVariable,
  emptyDataset,
  normalizeCell,
  parseNumber,
  type Align,
  type CellValue,
  type Dataset,
  type Measure,
  type MissingSpec,
  type Role,
  type ValueLabel,
  type Variable,
} from '../core/dataset'

export interface SavWriteOptions {
  /** 'bytecode' (default) is SPSS's standard compression; 'none' writes uncompressed case data. */
  compression?: 'bytecode' | 'none'
}

// ---------------------------------------------------------------------------------------------
// Format constants

/** Bytecode compression bias: codes 1..251 stand for the numbers code - bias. */
const BIAS = 100
const SYSMIS = -Number.MAX_VALUE
/** HIGHEST and LOWEST: the ends of open missing-value ranges (x THRU HI, LO THRU x). */
const HIGHEST = Number.MAX_VALUE
const LOWEST = float64FromBits(0xffefffff, 0xfffffffe)
const MAX_STRING_WIDTH = 32767
/** Data bytes stored in each segment of a very long string (a segment is a 255-byte string). */
const VLS_CHUNK = 255
/** A very long string of width w is split into ceil(w / 252) segments. */
const VLS_SEGMENT = 252
const FMT_A = 1
const FMT_F = 5
/** Date and time print formats (DATE, TIME, DATETIME, ADATE, ..., MTIME, YMDHMS). */
const DATE_FORMATS = new Set([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 38, 39, 40, 41])
/** Role codes of the "$@Role" variable attribute. */
const ROLES: Role[] = ['input', 'target', 'both', 'none', 'partition', 'split']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const RESERVED = new Set(['ALL', 'AND', 'BY', 'EQ', 'GE', 'GT', 'LE', 'LT', 'NE', 'NOT', 'OR', 'TO', 'WITH'])

/** Windows code page numbers (subtype 3 "character code") to WHATWG encoding labels. */
const CODE_PAGES: Record<number, string> = {
  2: 'windows-1252', // 7-bit ASCII
  3: 'windows-1252', // 8-bit ASCII
  866: 'ibm866',
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  10000: 'macintosh',
  10007: 'x-mac-cyrillic',
  20127: 'windows-1252',
  20866: 'koi8-r',
  20932: 'euc-jp',
  21866: 'koi8-u',
  28591: 'windows-1252',
  28599: 'windows-1254',
  28603: 'iso-8859-13',
  28605: 'iso-8859-15',
  51932: 'euc-jp',
  51936: 'gbk',
  51949: 'euc-kr',
  54936: 'gb18030',
  65001: 'utf-8',
}
for (let cp = 1250; cp <= 1258; cp++) CODE_PAGES[cp] = `windows-${cp}`
for (let cp = 28592; cp <= 28598; cp++) CODE_PAGES[cp] = `iso-8859-${cp - 28590}`

function float64FromBits(hi: number, lo: number): number {
  const view = new DataView(new ArrayBuffer(8))
  view.setUint32(0, hi)
  view.setUint32(4, lo)
  return view.getFloat64(0)
}

function fail(message: string): never {
  throw new Error(message)
}

const truncated = (what: string) => `The SPSS file is truncated or damaged: it ends unexpectedly while reading ${what}.`
const damaged = (detail: string) => `The SPSS file is damaged (${detail}).`

const pad4 = (n: number) => (4 - (n % 4)) % 4
const pad8 = (n: number) => (8 - (n % 8)) % 8
/** Number of 8-byte units used by a value of the given width (0 = numeric). */
const unitsOf = (width: number) => (width === 0 ? 1 : Math.ceil(width / 8))

// ---------------------------------------------------------------------------------------------
// Reading

class ByteReader {
  readonly bytes: Uint8Array
  readonly view: DataView
  le: boolean
  pos = 0

  constructor(bytes: Uint8Array, le = true) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.le = le
  }

  remaining(): number {
    return this.bytes.length - this.pos
  }

  need(n: number, what: string): void {
    if (!(n >= 0) || n > this.bytes.length - this.pos) fail(truncated(what))
  }

  u8(what = 'the dictionary'): number {
    this.need(1, what)
    return this.bytes[this.pos++]
  }

  int32(what = 'the dictionary'): number {
    this.need(4, what)
    const v = this.view.getInt32(this.pos, this.le)
    this.pos += 4
    return v
  }

  int64(what = 'the dictionary'): number {
    this.need(8, what)
    const v = Number(this.view.getBigInt64(this.pos, this.le))
    this.pos += 8
    return v
  }

  float64(what = 'the dictionary'): number {
    this.need(8, what)
    const v = this.view.getFloat64(this.pos, this.le)
    this.pos += 8
    return v
  }

  raw(n: number, what = 'the dictionary'): Uint8Array {
    this.need(n, what)
    const b = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return b
  }

  skip(n: number, what = 'the dictionary'): void {
    this.need(n, what)
    this.pos += n
  }
}

function latin1(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}

function createDecoder(label: string | null): TextDecoder {
  const candidates: string[] = []
  if (label) {
    candidates.push(label)
    const cp = /^(?:cp|ibm|ms|windows-?)(\d+)$/i.exec(label.trim())
    if (cp && CODE_PAGES[Number(cp[1])]) candidates.push(CODE_PAGES[Number(cp[1])])
  }
  candidates.push('windows-1252', 'utf-8')
  for (const c of candidates) {
    try {
      return new TextDecoder(c)
    } catch {
      // Unknown or unsupported label: try the next candidate.
    }
  }
  return new TextDecoder()
}

/** Decodes file text in the file's character encoding. */
class TextReader {
  private readonly decoder: TextDecoder
  /** Whether bytes below 0x80 are always plain ASCII characters in this encoding. */
  private readonly asciiCompatible: boolean

  constructor(encoding: string | null) {
    this.decoder = createDecoder(encoding)
    this.asciiCompatible = !/^(?:utf-16|iso-2022-jp|replacement)/.test(this.decoder.encoding)
  }

  /** Text of bytes [start, end) with trailing blanks (spaces and NULs) removed. */
  text(b: Uint8Array, start = 0, end = b.length): string {
    while (end > start && (b[end - 1] === 0x20 || b[end - 1] === 0)) end--
    if (end <= start) return ''
    if (this.asciiCompatible && end - start <= 64) {
      let s = ''
      for (let i = start; i < end; i++) {
        const c = b[i]
        if (c >= 0x80) return this.decoder.decode(b.subarray(start, end))
        s += String.fromCharCode(c)
      }
      return s
    }
    return this.decoder.decode(b.subarray(start, end))
  }

  /** Full text of a text record, untrimmed. */
  record(b: Uint8Array): string {
    return this.decoder.decode(b)
  }
}

interface RawVar {
  /** Index of the variable's first 8-byte unit within a case (its dictionary index minus 1). */
  unit: number
  /** 0 = numeric, 1..255 = string width in bytes. */
  width: number
  name: Uint8Array
  label: Uint8Array | null
  /** Missing-value code: 0, 1..3 discrete values, -2 a range, -3 a range plus one discrete value. */
  nMissing: number
  missing: Uint8Array
  print: number
}

interface LabelSet {
  values: Uint8Array[]
  labels: Uint8Array[]
  /** 0-based unit indexes of the variables the labels apply to. */
  units: number[]
}

interface ExtRecord {
  size: number
  count: number
  data: Uint8Array
}

interface Dictionary {
  le: boolean
  compression: number
  /** 1-based unit index of the weight variable, or 0. */
  weightIndex: number
  ncases: number
  bias: number
  /** Variable records, without continuation records. */
  vars: RawVar[]
  /** 8-byte units per case (all variable records, continuation records included). */
  caseUnits: number
  labelSets: LabelSet[]
  ext: Map<number, ExtRecord[]>
}

function checkSignature(bytes: Uint8Array): void {
  const sig = latin1(bytes.subarray(0, 4))
  if (sig === '$FL2' || sig === '$FL3') return
  const head = latin1(bytes.subarray(0, 512))
  if (head.includes('ENCRYPTEDSAV'))
    fail('This SPSS file is password-protected (encrypted). Save it in SPSS without a password and try again.')
  if (head.includes('SPSS PORT FILE') || head.includes('SPSSPORT'))
    fail('SPSS portable files (.por) are not supported. Save the data as a .sav file in SPSS or PSPP and try again.')
  fail('This is not an SPSS data file (.sav): it does not start with the "$FL2" signature.')
}

function readDictionary(r: ByteReader): Dictionary {
  checkSignature(r.bytes)
  if (r.bytes.length < 176) fail(truncated('the file header'))
  // The layout code (2 or 3) tells the byte order.
  const layout = r.view.getInt32(64, true)
  if (layout !== 2 && layout !== 3) {
    const swapped = r.view.getInt32(64, false)
    if (swapped !== 2 && swapped !== 3) fail(damaged(`unknown layout code ${layout}`))
    r.le = false
  }
  r.pos = 72 // after the layout code and the nominal case size, which is recomputed below
  const compression = r.int32()
  const weightIndex = r.int32()
  const ncases = r.int32()
  const bias = r.float64()
  r.pos = 176
  if (compression < 0 || compression > 2) fail(`Unsupported SPSS compression type ${compression}.`)

  const vars: RawVar[] = []
  const labelSets: LabelSet[] = []
  const ext = new Map<number, ExtRecord[]>()
  let unit = 0
  for (;;) {
    const recType = r.int32()
    if (recType === 2) {
      const width = r.int32()
      const hasLabel = r.int32()
      const nMissing = r.int32()
      const print = r.int32()
      r.int32() // write format
      const name = r.raw(8)
      let label: Uint8Array | null = null
      if (hasLabel === 1) {
        const len = r.int32()
        label = r.raw(len, 'a variable label')
        r.skip(pad4(len), 'a variable label')
      } else if (hasLabel !== 0) fail(damaged(`bad variable label flag ${hasLabel}`))
      if (nMissing < -3 || nMissing > 3 || nMissing === -1) fail(damaged(`bad missing-value code ${nMissing}`))
      const missing = r.raw(8 * Math.abs(nMissing), 'missing values')
      if (width !== -1) {
        if (width < 0 || width > 255) fail(damaged(`bad variable width ${width}`))
        vars.push({ unit, width, name, label, nMissing, missing, print })
      }
      unit++ // a continuation record (width -1) holds 8 more bytes of the previous string
    } else if (recType === 3) {
      const n = r.int32()
      if (n < 0 || n > r.remaining() / 9) fail(damaged(`bad value label count ${n}`))
      const values: Uint8Array[] = []
      const labels: Uint8Array[] = []
      for (let i = 0; i < n; i++) {
        values.push(r.raw(8, 'value labels'))
        const len = r.u8('value labels')
        labels.push(r.raw(len, 'value labels'))
        r.skip(pad8(len + 1), 'value labels')
      }
      if (r.int32() !== 4) fail(damaged('a value label record is not followed by its variable list'))
      const nv = r.int32()
      if (nv < 0 || nv > r.remaining() / 4) fail(damaged(`bad value label variable count ${nv}`))
      const units: number[] = []
      for (let i = 0; i < nv; i++) units.push(r.int32() - 1)
      labelSets.push({ values, labels, units })
    } else if (recType === 6) {
      const lines = r.int32()
      r.skip(lines * 80, 'the document record')
    } else if (recType === 7) {
      const subtype = r.int32()
      const size = r.int32()
      const count = r.int32()
      if (size < 0 || count < 0) fail(damaged(`bad length in extension record ${subtype}`))
      const rec: ExtRecord = { size, count, data: r.raw(size * count, `extension record ${subtype}`) }
      const list = ext.get(subtype)
      if (list) list.push(rec)
      else ext.set(subtype, [rec])
    } else if (recType === 999) {
      r.int32() // filler
      break
    } else {
      fail(damaged(`unknown record type ${recType} at byte ${r.pos - 4}`))
    }
  }
  return { le: r.le, compression, weightIndex, ncases, bias, vars, caseUnits: unit, labelSets, ext }
}

function extInts(rec: ExtRecord, le: boolean): number[] {
  const r = new ByteReader(rec.data, le)
  const out: number[] = []
  while (r.remaining() >= 4) out.push(r.int32())
  return out
}

function extFloats(rec: ExtRecord, le: boolean): number[] {
  const r = new ByteReader(rec.data, le)
  const out: number[] = []
  while (r.remaining() >= 8) out.push(r.float64())
  return out
}

/** Parses "KEY=VALUE" items separated by tabs (subtypes 13 and 14). */
function keyValues(text: string): [string, string][] {
  const out: [string, string][] = []
  for (const item of text.split('\t')) {
    const clean = item.replaceAll('\0', '')
    const eq = clean.indexOf('=')
    if (eq > 0) out.push([clean.slice(0, eq).trim(), clean.slice(eq + 1).trim()])
  }
  return out
}

/** Parses the variable attributes record: `name:attr('value'\n...)attr2(...)/name2:...`. */
function parseAttributes(text: string): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>()
  let i = 0
  while (i < text.length) {
    const colon = text.indexOf(':', i)
    if (colon < 0) break
    const attrs = new Map<string, string[]>()
    out.set(text.slice(i, colon), attrs)
    i = colon + 1
    while (i < text.length && text[i] !== '/') {
      const open = text.indexOf('(', i)
      if (open < 0) return out
      const key = text.slice(i, open)
      const values: string[] = []
      i = open + 1
      while (i < text.length && text[i] !== ')') {
        const nl = text.indexOf('\n', i)
        if (nl < 0) return out
        const v = text.slice(i, nl)
        values.push(v.length >= 2 && v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1) : v)
        i = nl + 1
      }
      attrs.set(key, values)
      i++ // ')'
    }
    i++ // '/'
  }
  return out
}

interface LongStringMissing {
  name: Uint8Array
  values: Uint8Array[]
}

/**
 * Parses the long string missing values record (subtype 22). SPSS writes one value length followed
 * by the values; some writers put a length before every value, so both layouts are accepted.
 */
function parseLongStringMissing(data: Uint8Array, le: boolean, lengthPerValue: boolean): LongStringMissing[] {
  const r = new ByteReader(data, le)
  const out: LongStringMissing[] = []
  while (r.remaining() > 0) {
    const name = r.raw(r.int32())
    const n = r.u8()
    if (n < 1 || n > 3) fail(damaged('bad long string missing value count'))
    const values: Uint8Array[] = []
    if (lengthPerValue) for (let i = 0; i < n; i++) values.push(r.raw(r.int32()))
    else {
      const len = r.int32()
      for (let i = 0; i < n; i++) values.push(r.raw(len))
    }
    out.push({ name, values })
  }
  return out
}

interface LogicalVar {
  raw: RawVar
  /** Index of the first segment in Dictionary.vars. */
  rawIndex: number
  /** 0 = numeric, else the string width in bytes (the full width for very long strings). */
  width: number
  /** The variable records holding the value: one, or several for a very long string. */
  segments: RawVar[]
  shortName: string
  name: string
}

/** Where a column's values live within a case and where they are collected. */
interface ColumnPlan {
  numeric: boolean
  /** Byte offset within a case (numeric values and strings of at most 255 bytes). */
  offset: number
  /** String width in bytes. */
  width: number
  /** Very long strings: byte offset and number of data bytes of each segment. */
  segments: { offset: number; take: number }[] | null
  scratch: Uint8Array | null
  values: CellValue[]
}

interface DecodedDictionary {
  variables: Variable[]
  columns: ColumnPlan[]
  weightVarId: string | null
  sysmis: number
  txt: TextReader
}

function measureFromCode(code: number): Measure | undefined {
  return code === 1 ? 'nominal' : code === 2 ? 'ordinal' : code === 3 ? 'scale' : undefined
}

function alignFromCode(code: number): Align | undefined {
  return code === 0 ? 'left' : code === 1 ? 'right' : code === 2 ? 'center' : undefined
}

function decodeDictionary(d: Dictionary): DecodedDictionary {
  const le = d.le
  const ext = (subtype: number): ExtRecord[] => d.ext.get(subtype) ?? []
  const f64 = (b: Uint8Array, offset = 0) => new DataView(b.buffer, b.byteOffset + offset, 8).getFloat64(0, le)

  // Character encoding: subtype 20 names it, otherwise subtype 3 gives a Windows code page.
  let encoding: string | null = null
  const encRec = ext(20)[0]
  if (encRec) encoding = latin1(encRec.data).replaceAll('\0', '').trim() || null
  if (!encoding) {
    const info = ext(3)[0]
    if (info && info.size === 4 && info.count >= 8) encoding = CODE_PAGES[extInts(info, le)[7]] ?? null
  }
  const txt = new TextReader(encoding)

  let sysmis = SYSMIS
  let highest = HIGHEST
  let lowest = LOWEST
  const fp = ext(4)[0]
  if (fp && fp.size === 8 && fp.count >= 3) [sysmis, highest, lowest] = extFloats(fp, le)
  const lowEnd = (x: number) => (x === -Infinity || x <= LOWEST || x === lowest ? -Infinity : x)
  const highEnd = (x: number) => (x === Infinity || x >= HIGHEST || x === highest ? Infinity : x)

  // Very long strings (subtype 14): short name of the first segment -> full width.
  const vlsWidths = new Map<string, number>()
  for (const rec of ext(14))
    for (const [key, value] of keyValues(txt.record(rec.data))) {
      const width = Number.parseInt(value, 10)
      if (width > 255 && width <= MAX_STRING_WIDTH) vlsWidths.set(key.toUpperCase(), width)
    }

  // Logical variables: merge the segments of very long strings.
  const logical: LogicalVar[] = []
  for (let i = 0; i < d.vars.length; i++) {
    const raw = d.vars[i]
    const shortName = txt.text(raw.name)
    const vls = raw.width > 0 ? vlsWidths.get(shortName.toUpperCase()) : undefined
    if (vls !== undefined) {
      const expected = segmentWidths(vls)
      const segments = d.vars.slice(i, i + expected.length)
      const n = expected.length
      if (segments.length === n && segments.every((s, k) => s.width > 0 && unitsOf(s.width) === unitsOf(expected[k]))) {
        logical.push({ raw, rawIndex: i, width: vls, segments, shortName, name: shortName })
        i += n - 1
        continue
      }
    }
    logical.push({ raw, rawIndex: i, width: raw.width, segments: [raw], shortName, name: shortName })
  }

  // Long variable names (subtype 13), made unique (names are case-insensitive).
  const longNames = new Map<string, string>()
  for (const rec of ext(13)) for (const [key, value] of keyValues(txt.record(rec.data))) longNames.set(key.toUpperCase(), value)
  const usedNames = new Set<string>()
  logical.forEach((lv, k) => {
    const base = longNames.get(lv.shortName.toUpperCase()) || lv.shortName || `VAR${String(k + 1).padStart(5, '0')}`
    let name = base
    for (let n = 1; usedNames.has(name.toLowerCase()); n++) name = `${base}_${n}`
    usedNames.add(name.toLowerCase())
    lv.name = name
  })
  const byName = new Map<string, number>()
  logical.forEach((lv, k) => byName.set(lv.name.toLowerCase(), k))
  logical.forEach((lv, k) => {
    if (!byName.has(lv.shortName.toLowerCase())) byName.set(lv.shortName.toLowerCase(), k)
  })
  const findVar = (name: string) => byName.get(name.toLowerCase())
  const byUnit = new Map<number, number>()
  logical.forEach((lv, k) => byUnit.set(lv.raw.unit, k))

  // Display parameters (subtype 11): one entry per variable record (SPSS, PSPP, ReadStat), or one
  // per logical variable; 3 values (measure, columns, alignment) or 2 (no columns) per entry.
  const display: ({ measure: number; columns: number; align: number } | undefined)[] = []
  const disp = ext(11)[0]
  if (disp && disp.size === 4) {
    const v = extInts(disp, le)
    const layouts: [number, boolean][] = [
      [3, true],
      [2, true],
      [3, false],
      [2, false],
    ]
    const found = layouts.find(([stride, perRecord]) => v.length === stride * (perRecord ? d.vars.length : logical.length))
    if (found) {
      const [stride, perRecord] = found
      logical.forEach((lv, k) => {
        const o = (perRecord ? lv.rawIndex : k) * stride
        display[k] = stride === 3 ? { measure: v[o], columns: v[o + 1], align: v[o + 2] } : { measure: v[o], columns: 0, align: v[o + 1] }
      })
    }
  }

  // Value labels: records 3/4 (numeric and short string variables), subtype 21 (long strings).
  const labelMaps = logical.map(() => new Map<number | string, string>())
  for (const set of d.labelSets)
    for (const unit of set.units) {
      const k = byUnit.get(unit)
      if (k === undefined) continue
      const lv = logical[k]
      set.values.forEach((value, j) => {
        const label = txt.text(set.labels[j])
        if (lv.width === 0) {
          const x = f64(value)
          if (!Number.isNaN(x) && x !== sysmis) labelMaps[k].set(x, label)
        } else labelMaps[k].set(txt.text(value, 0, Math.min(8, lv.width)), label)
      })
    }
  for (const rec of ext(21)) {
    try {
      const r = new ByteReader(rec.data, le)
      while (r.remaining() > 0) {
        const k = findVar(txt.text(r.raw(r.int32())))
        r.int32() // variable width
        const n = r.int32()
        for (let j = 0; j < n; j++) {
          const value = r.raw(r.int32())
          const label = r.raw(r.int32())
          if (k !== undefined && logical[k].width > 0) labelMaps[k].set(txt.text(value), txt.text(label))
        }
      }
    } catch {
      // A damaged label record loses its remaining labels but not the data.
    }
  }

  // Missing values of long strings (subtype 22).
  const longMissing = new Map<number, string[]>()
  for (const rec of ext(22)) {
    const attempt = (lengthPerValue: boolean) => {
      try {
        const entries = parseLongStringMissing(rec.data, le, lengthPerValue)
        return entries.every((e) => findVar(txt.text(e.name)) !== undefined) ? entries : null
      } catch {
        return null
      }
    }
    for (const e of attempt(false) ?? attempt(true) ?? []) {
      const k = findVar(txt.text(e.name))
      if (k !== undefined && logical[k].width > 0) longMissing.set(k, e.values.map((v) => txt.text(v)))
    }
  }

  // Variable roles from the "$@Role" attribute (subtype 18).
  const roles = new Map<number, Role>()
  for (const rec of ext(18))
    for (const [name, attrs] of parseAttributes(txt.record(rec.data))) {
      const k = findVar(name)
      const code = Number.parseInt(attrs.get('$@Role')?.[0] ?? '', 10)
      if (k !== undefined && code >= 0 && code < ROLES.length) roles.set(k, ROLES[code])
    }

  const variables: Variable[] = []
  const columns: ColumnPlan[] = []
  logical.forEach((lv, k) => {
    const raw = lv.raw
    const isString = lv.width > 0
    const fmtType = (raw.print >>> 16) & 0xff
    const fmtWidth = (raw.print >>> 8) & 0xff
    const fmtDecimals = raw.print & 0xff
    let width = lv.width
    let decimals = 0
    if (!isString) {
      width = fmtWidth > 0 ? fmtWidth : 8
      decimals = fmtWidth === 0 ? 2 : DATE_FORMATS.has(fmtType) ? 0 : Math.min(fmtDecimals, 16)
    }

    let missing: MissingSpec = { kind: 'none' }
    if (!isString && raw.nMissing !== 0) {
      const values = Array.from({ length: Math.abs(raw.nMissing) }, (_, j) => f64(raw.missing, 8 * j))
      if (raw.nMissing > 0) missing = { kind: 'discrete', values }
      else {
        missing = { kind: 'range', low: lowEnd(values[0]), high: highEnd(values[1]) }
        if (raw.nMissing === -3) missing.value = values[2]
      }
    } else if (isString && raw.nMissing > 0) {
      const values = Array.from({ length: raw.nMissing }, (_, j) => txt.text(raw.missing, 8 * j, 8 * j + Math.min(8, lv.width)))
      missing = { kind: 'discrete', values }
    } else if (isString && longMissing.has(k)) {
      missing = { kind: 'discrete', values: longMissing.get(k) ?? [] }
    }

    const valueLabels: ValueLabel[] = [...labelMaps[k]].map(([value, label]) => ({ value, label }))
    const disp = display[k]
    const v = createVariable(lv.name, {
      type: isString ? 'string' : 'numeric',
      width,
      decimals,
      label: raw.label ? txt.text(raw.label) : '',
      valueLabels,
      missing,
      columns: disp && disp.columns > 0 ? disp.columns : undefined,
      align: disp ? alignFromCode(disp.align) : undefined,
      measure: disp ? measureFromCode(disp.measure) : undefined,
      role: roles.get(k),
    })
    variables.push(v)
    columns.push({
      numeric: !isString,
      offset: raw.unit * 8,
      width: lv.width,
      segments: lv.segments.length > 1 ? lv.segments.map((s) => ({ offset: s.unit * 8, take: Math.min(VLS_CHUNK, s.width) })) : null,
      scratch: lv.segments.length > 1 ? new Uint8Array(lv.segments.reduce((n, s) => n + Math.min(VLS_CHUNK, s.width), 0)) : null,
      values: [],
    })
  })

  const weight = d.weightIndex > 0 ? byUnit.get(d.weightIndex - 1) : undefined
  const weightVarId = weight !== undefined && variables[weight].type === 'numeric' ? variables[weight].id : null
  return { variables, columns, weightVarId, sysmis, txt }
}

/** Expands bytecode-compressed case data one case at a time. */
class BytecodeDecoder {
  private readonly src: Uint8Array
  private readonly bias: number
  private readonly le: boolean
  private readonly sysmis: number
  private pos: number
  /** Offset of the current 8-code command block, and the next code within it. */
  private block = 0
  private next = 8
  private ended = false

  constructor(src: Uint8Array, start: number, bias: number, le: boolean, sysmis: number) {
    this.src = src
    this.pos = start
    this.bias = bias
    this.le = le
    this.sysmis = sysmis
  }

  /** Expands one case into `out`. Returns false when the data ends cleanly before the case. */
  read(out: Uint8Array, view: DataView, units: number, caseNumber: number): boolean {
    const src = this.src
    let u = 0
    while (u < units) {
      if (this.next === 8) {
        if (this.ended || this.pos + 8 > src.length) {
          if (u === 0) return false
          fail(truncated(`case ${caseNumber}`))
        }
        this.block = this.pos
        this.pos += 8
        this.next = 0
      }
      const code = src[this.block + this.next++]
      const offset = u * 8
      if (code === 0) continue // padding
      if (code === 253) {
        if (this.pos + 8 > src.length) fail(truncated(`case ${caseNumber}`))
        out.set(src.subarray(this.pos, this.pos + 8), offset)
        this.pos += 8
      } else if (code === 254) out.fill(0x20, offset, offset + 8)
      else if (code === 255) view.setFloat64(offset, this.sysmis, this.le)
      else if (code === 252) {
        this.ended = true
        this.next = 8
        if (u === 0) return false
        fail(truncated(`case ${caseNumber}`))
      } else view.setFloat64(offset, code - this.bias, this.le)
      u++
    }
    return true
  }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

/** Inflates one zlib stream with the platform's DecompressionStream. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined')
    fail('Reading compressed .zsav files needs a browser that supports DecompressionStream.')
  const stream = new DecompressionStream('deflate')
  const writer = stream.writable.getWriter()
  // Failures surface through the reader below; the writer's promises would only repeat them.
  writer.write(data.slice()).catch(() => undefined)
  writer.close().catch(() => undefined)
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } catch (e) {
    fail(`The compressed data of this .zsav file is damaged (${e instanceof Error ? e.message : String(e)}).`)
  }
  return concatBytes(chunks)
}

/** Reads the ZSAV header and trailer at `r.pos` and returns the inflated bytecode data. */
async function readZlibData(r: ByteReader): Promise<Uint8Array> {
  const headerOffset = r.pos
  const zheader = r.int64('the ZSAV header')
  const ztrailer = r.int64('the ZSAV header')
  const ztrailerLength = r.int64('the ZSAV header')
  if (zheader !== headerOffset || ztrailer < r.pos || ztrailer + ztrailerLength > r.bytes.length)
    fail(damaged('bad ZSAV header'))
  const t = new ByteReader(r.bytes, r.le)
  t.pos = ztrailer
  t.int64('the ZSAV trailer') // bias
  t.int64('the ZSAV trailer') // zero
  t.int32('the ZSAV trailer') // block size
  const nBlocks = t.int32('the ZSAV trailer')
  if (nBlocks < 0 || 24 + 24 * nBlocks > ztrailerLength) fail(damaged('bad ZSAV trailer'))
  const blocks: { offset: number; size: number; inflatedSize: number }[] = []
  for (let i = 0; i < nBlocks; i++) {
    t.int64('the ZSAV trailer') // uncompressed offset
    const offset = t.int64('the ZSAV trailer')
    const inflatedSize = t.int32('the ZSAV trailer')
    const size = t.int32('the ZSAV trailer')
    if (offset < r.pos || size < 0 || offset + size > ztrailer) fail(damaged('bad ZSAV block'))
    blocks.push({ offset, size, inflatedSize })
  }
  const parts = await Promise.all(blocks.map((b) => inflate(r.bytes.subarray(b.offset, b.offset + b.size))))
  parts.forEach((p, i) => {
    if (p.length !== blocks[i].inflatedSize) fail(damaged('a ZSAV block has the wrong size'))
  })
  return concatBytes(parts)
}

/** Reads cases into the column plans; returns the number of cases read. */
function readCases(src: Uint8Array, start: number, bytecode: boolean, d: Dictionary, decoded: DecodedDictionary): number {
  const { columns, sysmis, txt } = decoded
  const caseBytes = d.caseUnits * 8
  const le = d.le
  const maxCases = d.ncases >= 0 ? d.ncases : Infinity
  const extract = (buf: Uint8Array, view: DataView, base: number) => {
    for (const c of columns) {
      if (c.numeric) {
        const x = view.getFloat64(base + c.offset, le)
        c.values.push(x === sysmis || Number.isNaN(x) ? null : x)
      } else if (c.segments === null || c.scratch === null) {
        c.values.push(txt.text(buf, base + c.offset, base + c.offset + c.width))
      } else {
        let n = 0
        for (const s of c.segments) {
          c.scratch.set(buf.subarray(base + s.offset, base + s.offset + s.take), n)
          n += s.take
        }
        c.values.push(txt.text(c.scratch, 0, Math.min(n, c.width)))
      }
    }
  }

  let n = 0
  if (!bytecode) {
    const view = new DataView(src.buffer, src.byteOffset, src.byteLength)
    for (let pos = start; n < maxCases && pos < src.length; pos += caseBytes) {
      if (src.length - pos < caseBytes) fail(truncated(`case ${n + 1}`))
      extract(src, view, pos)
      n++
    }
    return n
  }
  const buf = new Uint8Array(caseBytes)
  const view = new DataView(buf.buffer)
  const decoder = new BytecodeDecoder(src, start, d.bias, le, sysmis)
  while (n < maxCases && decoder.read(buf, view, d.caseUnits, n + 1)) {
    extract(buf, view, 0)
    n++
  }
  return n
}

/**
 * Reads an SPSS system file (.sav, or .zsav) into a Dataset.
 * Throws an Error with a user-facing message when the file is not a readable system file.
 */
export async function readSav(data: ArrayBuffer | Uint8Array, fileName?: string): Promise<Dataset> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const r = new ByteReader(bytes)
  const dict = readDictionary(r)
  if (dict.vars.length === 0) fail('The SPSS file does not define any variables.')
  if (dict.ncases < 0) {
    // Header count unknown: use the 64-bit count of subtype 16 when present.
    const big = dict.ext.get(16)?.[0]
    if (big && big.size === 8 && big.count === 2) {
      const count = new ByteReader(big.data, dict.le)
      count.int64()
      const n = count.int64()
      if (n >= 0) dict.ncases = n
    }
  }

  const decoded = decodeDictionary(dict)

  let src = bytes
  let start = r.pos
  if (dict.compression === 2) {
    src = await readZlibData(r)
    start = 0
  }
  const nCases = readCases(src, start, dict.compression !== 0, dict, decoded)

  const ds = emptyDataset('DataSet1')
  ds.fileName = fileName ?? null
  ds.variables = decoded.variables
  decoded.variables.forEach((v, i) => {
    ds.data[v.id] = decoded.columns[i].values
  })
  ds.nCases = nCases
  ds.weightVarId = decoded.weightVarId
  return ds
}

// ---------------------------------------------------------------------------------------------
// Writing

const encoder = new TextEncoder()

/** Number of bytes `s` takes in UTF-8. */
function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

/** The longest prefix of `s` that fits in `max` UTF-8 bytes without splitting a character. */
function truncateUtf8(s: string, max: number): string {
  if (utf8Length(s) <= max) return s
  let bytes = 0
  let end = 0
  for (const ch of s) {
    const n = utf8Length(ch)
    if (bytes + n > max) break
    bytes += n
    end += ch.length
  }
  return s.slice(0, end)
}

/** UTF-8 bytes of `s`, cut at a character boundary to at most `max` bytes. */
function encodeMax(s: string, max: number): Uint8Array {
  const buf = new Uint8Array(Math.min(max, s.length * 3))
  return buf.subarray(0, encoder.encodeInto(s, buf).written)
}

/** `s` in UTF-8 within the first `width` bytes of a `size`-byte block padded with spaces. */
function encodePadded(s: string, width: number, size: number): Uint8Array {
  const buf = new Uint8Array(size).fill(0x20)
  encoder.encodeInto(s, buf.subarray(0, Math.min(width, size)))
  return buf
}

class ByteWriter {
  private buf: Uint8Array
  private view: DataView
  length = 0

  constructor(capacity = 4096) {
    this.buf = new Uint8Array(Math.max(16, capacity))
    this.view = new DataView(this.buf.buffer)
  }

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return
    let capacity = this.buf.length * 2
    while (capacity < this.length + n) capacity *= 2
    const next = new Uint8Array(capacity)
    next.set(this.buf.subarray(0, this.length))
    this.buf = next
    this.view = new DataView(next.buffer)
  }

  int32(v: number): void {
    this.ensure(4)
    this.view.setInt32(this.length, v, true)
    this.length += 4
  }

  float64(v: number): void {
    this.ensure(8)
    this.view.setFloat64(this.length, v, true)
    this.length += 8
  }

  u8(v: number): void {
    this.ensure(1)
    this.buf[this.length++] = v
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length)
    this.buf.set(b, this.length)
    this.length += b.length
  }

  fill(byte: number, n: number): void {
    this.ensure(n)
    this.buf.fill(byte, this.length, this.length + n)
    this.length += n
  }

  /** ASCII text padded with spaces (or cut) to exactly `size` bytes. */
  ascii(s: string, size: number): void {
    const b = new Uint8Array(size).fill(0x20)
    for (let i = 0; i < Math.min(size, s.length); i++) b[i] = s.charCodeAt(i) & 0x7f
    this.bytes(b)
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length)
  }
}

/** Packs bytecode-compressed data: blocks of 8 command codes, each followed by its raw values. */
class BytecodeWriter {
  private readonly out: ByteWriter
  private readonly codes = new Uint8Array(8)
  private n = 0
  private readonly data = new Uint8Array(64)
  private dataLength = 0

  constructor(out: ByteWriter) {
    this.out = out
  }

  code(c: number): void {
    this.codes[this.n++] = c
    if (this.n === 8) this.flush()
  }

  /** An uncompressible value: code 253 plus the 8 raw bytes. */
  raw(src: Uint8Array, offset: number): void {
    this.data.set(src.subarray(offset, offset + 8), this.dataLength)
    this.dataLength += 8
    this.code(253)
  }

  flush(): void {
    if (this.n === 0) return
    this.codes.fill(0, this.n) // code 0 = padding
    this.out.bytes(this.codes)
    this.out.bytes(this.data.subarray(0, this.dataLength))
    this.n = 0
    this.dataLength = 0
  }
}

/** A name that SPSS accepts: letters, digits and _ . @ # $, starting with a letter or @, <= 64 bytes. */
function spssName(name: string): string {
  let s = name.trim().replace(/[^\p{L}\p{M}\p{N}_.@#$]/gu, '_')
  if (!/^[\p{L}@]/u.test(s)) s = `V${s}`
  s = truncateUtf8(s, 64).replace(/\.+$/, '')
  if (RESERVED.has(s.toUpperCase())) s = `${s}_1`
  return s
}

function uniqueSpssNames(vars: Variable[]): string[] {
  const used = new Set<string>()
  return vars.map((v) => {
    const base = spssName(v.name)
    let name = base
    for (let k = 2; used.has(name.toUpperCase()); k++) name = `${truncateUtf8(base, 63 - String(k).length)}_${k}`
    used.add(name.toUpperCase())
    return name
  })
}

/** Claims an unused short name (<= 8 bytes) derived from `base`. */
function claimShortName(base: string, used: Set<string>): string {
  const cut = (n: number) => truncateUtf8(base, n).replace(/[._]+$/, '')
  let name = cut(8)
  for (let k = 1; !name || used.has(name); k++) name = cut(8 - String(k).length) + String(k)
  used.add(name)
  return name
}

/**
 * Short (8-byte) names: one per variable record segment. Names that already fit keep their
 * upper-cased form; longer ones are truncated and numbered on conflicts (PSPP's approach).
 */
function assignShortNames(names: string[], segmentCounts: number[]): string[][] {
  const used = new Set<string>()
  const out: (string | undefined)[][] = names.map(() => [])
  names.forEach((name, i) => {
    const upper = name.toUpperCase()
    if (utf8Length(upper) <= 8 && !used.has(upper)) {
      out[i][0] = upper
      used.add(upper)
    }
  })
  names.forEach((name, i) => {
    if (out[i][0] === undefined) out[i][0] = claimShortName(name.toUpperCase(), used)
  })
  // Segments of very long strings, named like SPSS does: the first 5 bytes plus a number.
  segmentCounts.forEach((count, i) => {
    for (let k = 1; k < count; k++) out[i][k] = claimShortName(truncateUtf8(out[i][0] ?? 'V', 5) + String(k - 1), used)
  })
  return out.map((list) => list.map((s) => s ?? 'V'))
}

interface WritePlan {
  v: Variable
  column: CellValue[]
  name: string
  shortNames: string[]
  /** 0 = numeric, else the string width in bytes. */
  width: number
  /** Width of each variable record segment (0 for numeric). */
  segmentWidths: number[]
  /** First 8-byte unit of the variable within a case. */
  unit: number
  scratch: Uint8Array | null
}

function segmentWidths(width: number): number[] {
  if (width === 0) return [0]
  if (width <= 255) return [width]
  const n = Math.ceil(width / VLS_SEGMENT)
  return Array.from({ length: n }, (_, k) => (k < n - 1 ? 255 : width - (n - 1) * VLS_SEGMENT))
}

function stringWidth(v: Variable, column: CellValue[]): number {
  let width = Math.max(1, Math.floor(v.width) || 1)
  for (const x of column) {
    if (x === null || x === undefined || x === '') continue
    const s = String(x)
    // A string's UTF-8 length is at most 3 bytes per UTF-16 code unit.
    if (s.length * 3 > width) width = Math.max(width, utf8Length(s))
  }
  return Math.min(width, MAX_STRING_WIDTH)
}

function numericFormat(v: Variable): number {
  const decimals = Math.max(0, Math.min(16, Math.floor(v.decimals) || 0))
  const width = Math.max(1, Math.min(40, Math.max(Math.floor(v.width) || 8, decimals + 1)))
  return (FMT_F << 16) | (width << 8) | decimals
}

function numericMissing(m: MissingSpec): { code: number; values: number[] } {
  const num = (x: number | string | undefined) => (typeof x === 'number' ? x : typeof x === 'string' ? parseNumber(x) : null)
  if (m.kind === 'discrete') {
    const values = m.values.map(num).filter((x): x is number => x !== null && Number.isFinite(x)).slice(0, 3)
    return { code: values.length, values }
  }
  if (m.kind === 'range' && !Number.isNaN(m.low) && !Number.isNaN(m.high)) {
    let [low, high] = [m.low, m.high]
    if (low > high) [low, high] = [high, low]
    const ends = [low === -Infinity ? LOWEST : low, high === Infinity ? HIGHEST : high]
    const extra = num(m.value)
    return extra !== null && Number.isFinite(extra) ? { code: -3, values: [...ends, extra] } : { code: -2, values: ends }
  }
  return { code: 0, values: [] }
}

function stringMissing(m: MissingSpec): string[] {
  return m.kind === 'discrete' ? m.values.slice(0, 3).map((x) => String(x)) : []
}

function measureCode(m: Measure): number {
  return m === 'nominal' ? 1 : m === 'ordinal' ? 2 : 3
}

function alignCode(a: Align): number {
  return a === 'left' ? 0 : a === 'right' ? 1 : 2
}

/** Writes a type 7 extension record. */
function writeExtension(w: ByteWriter, subtype: number, size: number, payload: Uint8Array): void {
  w.int32(7)
  w.int32(subtype)
  w.int32(size)
  w.int32(payload.length / size)
  w.bytes(payload)
}

function textPayload(s: string): Uint8Array {
  return encoder.encode(s)
}

/** Value labels as (value, label) byte pairs; values are encoded for a variable of the given width. */
function labelPairs(p: WritePlan): { value: number | string; label: Uint8Array }[] {
  const seen = new Set<number | string>()
  const out: { value: number | string; label: Uint8Array }[] = []
  for (const l of p.v.valueLabels) {
    let value: number | string
    if (p.width === 0) {
      const x = typeof l.value === 'number' ? l.value : parseNumber(String(l.value))
      if (x === null || !Number.isFinite(x)) continue
      value = x
    } else value = truncateUtf8(String(l.value), p.width).trimEnd()
    if (seen.has(value)) continue
    seen.add(value)
    out.push({ value, label: encodeMax(l.label, 255) })
  }
  return out
}

/**
 * Writes a Dataset as an SPSS system file (.sav), bytecode-compressed by default.
 * The file is UTF-8 encoded and readable by SPSS, PSPP and ReadStat-based tools (R haven, pyreadstat).
 */
export function writeSav(ds: Dataset, opts: SavWriteOptions = {}): Uint8Array {
  const compress = (opts.compression ?? 'bytecode') === 'bytecode'
  if (ds.variables.length === 0) fail('There are no variables to save. Define at least one variable first.')

  // Plan the variable records.
  const names = uniqueSpssNames(ds.variables)
  const columns = ds.variables.map((v) => ds.data[v.id] ?? [])
  const widths = ds.variables.map((v, i) => (v.type === 'string' ? stringWidth(v, columns[i]) : 0))
  const segments = widths.map(segmentWidths)
  const shortNames = assignShortNames(
    names,
    segments.map((s) => s.length),
  )
  let unit = 0
  const plans: WritePlan[] = ds.variables.map((v, i) => {
    const plan: WritePlan = {
      v,
      column: columns[i],
      name: names[i],
      shortNames: shortNames[i],
      width: widths[i],
      segmentWidths: segments[i],
      unit,
      scratch: segments[i].length > 1 ? new Uint8Array(widths[i]) : null,
    }
    unit += segments[i].reduce((n, sw) => n + unitsOf(sw), 0)
    return plan
  })
  const caseUnits = unit
  const nCases = Math.max(0, ds.nCases)
  const weight = plans.find((p) => p.v.id === ds.weightVarId && p.width === 0)

  const w = new ByteWriter(8192 + nCases * caseUnits * (compress ? 9 : 8))

  // File header.
  const now = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  w.ascii('$FL2', 4)
  w.ascii('@(#) SPSS DATA FILE - VennStat', 60)
  w.int32(2) // layout code
  w.int32(caseUnits)
  w.int32(compress ? 1 : 0)
  w.int32(weight ? weight.unit + 1 : 0)
  w.int32(nCases)
  w.float64(BIAS)
  w.ascii(`${two(now.getDate())} ${MONTHS[now.getMonth()]} ${two(now.getFullYear() % 100)}`, 9)
  w.ascii(`${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`, 8)
  w.ascii('', 64) // file label
  w.fill(0, 3)

  // Variable records (type 2), with continuation records for strings wider than 8 bytes.
  for (const p of plans) {
    const label = encodeMax(p.v.label, 255)
    p.segmentWidths.forEach((sw, s) => {
      const first = s === 0
      const nm = first && p.width === 0 ? numericMissing(p.v.missing) : null
      const sm = first && p.width > 0 && p.width <= 8 ? stringMissing(p.v.missing) : []
      const format = sw === 0 ? numericFormat(p.v) : (FMT_A << 16) | (sw << 8)
      w.int32(2)
      w.int32(sw)
      w.int32(first && label.length > 0 ? 1 : 0)
      w.int32(nm ? nm.code : sm.length)
      w.int32(format) // print format
      w.int32(format) // write format
      w.bytes(encodePadded(p.shortNames[s], 8, 8))
      if (first && label.length > 0) {
        w.int32(label.length)
        w.bytes(label)
        w.fill(0x20, pad4(label.length))
      }
      if (nm) for (const x of nm.values) w.float64(x)
      for (const x of sm) w.bytes(encodePadded(x, p.width, 8))
      for (let c = 1; c < unitsOf(sw); c++) {
        w.int32(2)
        w.int32(-1)
        w.int32(0)
        w.int32(0)
        w.int32(0)
        w.int32(0)
        w.fill(0, 8)
      }
    })
  }

  // Value labels (types 3 and 4) for numeric variables and strings of at most 8 bytes.
  for (const p of plans) {
    if (p.width > 8) continue
    const pairs = labelPairs(p)
    if (pairs.length === 0) continue
    w.int32(3)
    w.int32(pairs.length)
    for (const { value, label } of pairs) {
      if (typeof value === 'number') w.float64(value)
      else w.bytes(encodePadded(value, p.width, 8))
      w.u8(label.length)
      w.bytes(label)
      w.fill(0x20, pad8(label.length + 1))
    }
    w.int32(4)
    w.int32(1)
    w.int32(p.unit + 1)
  }

  // Machine integer info (subtype 3): IEEE floats, little-endian, UTF-8 (code page 65001).
  const ints = new ByteWriter(32)
  for (const x of [1, 0, 0, -1, 1, 1, 2, 65001]) ints.int32(x)
  writeExtension(w, 3, 4, ints.result())

  // Machine floating-point info (subtype 4): SYSMIS, HIGHEST, LOWEST.
  const floats = new ByteWriter(24)
  for (const x of [SYSMIS, HIGHEST, LOWEST]) floats.float64(x)
  writeExtension(w, 4, 8, floats.result())

  // Variable display parameters (subtype 11): measure, columns, alignment per variable record.
  const display = new ByteWriter()
  for (const p of plans)
    p.segmentWidths.forEach((_, s) => {
      display.int32(measureCode(p.v.measure))
      display.int32(s === 0 ? Math.max(1, Math.min(MAX_STRING_WIDTH, Math.round(p.v.columns) || 8)) : 8)
      display.int32(alignCode(p.v.align))
    })
  writeExtension(w, 11, 4, display.result())

  // Long variable names (subtype 13).
  writeExtension(w, 13, 1, textPayload(plans.map((p) => `${p.shortNames[0]}=${p.name}`).join('\t')))

  // Very long string widths (subtype 14).
  const vls = plans.filter((p) => p.segmentWidths.length > 1)
  if (vls.length > 0)
    writeExtension(w, 14, 1, textPayload(vls.map((p) => `${p.shortNames[0]}=${String(p.width).padStart(5, '0')}\0\t`).join('')))

  // Value labels of strings wider than 8 bytes (subtype 21).
  const longLabels = new ByteWriter()
  for (const p of plans) {
    if (p.width <= 8) continue
    const pairs = labelPairs(p)
    if (pairs.length === 0) continue
    const name = encoder.encode(p.name)
    longLabels.int32(name.length)
    longLabels.bytes(name)
    longLabels.int32(p.width)
    longLabels.int32(pairs.length)
    for (const { value, label } of pairs) {
      longLabels.int32(p.width)
      longLabels.bytes(encodePadded(String(value), p.width, p.width))
      longLabels.int32(label.length)
      longLabels.bytes(label)
    }
  }
  if (longLabels.length > 0) writeExtension(w, 21, 1, longLabels.result())

  // Missing values of strings wider than 8 bytes (subtype 22); each value is limited to 8 bytes.
  const longMissing = new ByteWriter()
  for (const p of plans) {
    if (p.width <= 8) continue
    const values = stringMissing(p.v.missing)
    if (values.length === 0) continue
    const name = encoder.encode(p.name)
    longMissing.int32(name.length)
    longMissing.bytes(name)
    longMissing.u8(values.length)
    longMissing.int32(8)
    for (const x of values) longMissing.bytes(encodePadded(x, 8, 8))
  }
  if (longMissing.length > 0) writeExtension(w, 22, 1, longMissing.result())

  // Variable roles (subtype 18, attribute "$@Role"); "input" is the default and is not written.
  const roles = plans
    .filter((p) => p.v.role !== 'input' && ROLES.includes(p.v.role))
    .map((p) => `${p.name}:$@Role('${ROLES.indexOf(p.v.role)}'\n)`)
  if (roles.length > 0) writeExtension(w, 18, 1, textPayload(roles.join('/')))

  // Character encoding (subtype 20).
  writeExtension(w, 20, 1, textPayload('UTF-8'))

  // End of dictionary.
  w.int32(999)
  w.int32(0)

  // Case data.
  const caseBuf = new Uint8Array(caseUnits * 8)
  const caseView = new DataView(caseBuf.buffer)
  const isString = new Uint8Array(caseUnits)
  for (const p of plans) if (p.width > 0) isString.fill(1, p.unit, p.unit + p.segmentWidths.reduce((n, sw) => n + unitsOf(sw), 0))
  const bytecode = compress ? new BytecodeWriter(w) : null

  for (let row = 0; row < nCases; row++) {
    caseBuf.fill(0x20)
    for (const p of plans) {
      const offset = p.unit * 8
      const x = normalizeCell(p.v, p.column[row] ?? null)
      if (p.width === 0) {
        caseView.setFloat64(offset, typeof x === 'number' ? x : SYSMIS, true)
        continue
      }
      const s = typeof x === 'string' ? x : String(x ?? '')
      if (s === '') continue
      const scratch = p.scratch
      if (scratch === null) {
        encoder.encodeInto(s, caseBuf.subarray(offset, offset + p.width))
        continue
      }
      // Very long string: 255 data bytes in each segment's 256-byte slot.
      const written = encoder.encodeInto(s, scratch).written
      let slot = offset
      p.segmentWidths.forEach((sw, k) => {
        const from = k * VLS_CHUNK
        if (from < written) caseBuf.set(scratch.subarray(from, Math.min(written, from + VLS_CHUNK)), slot)
        slot += unitsOf(sw) * 8
      })
    }

    if (!bytecode) {
      w.bytes(caseBuf)
      continue
    }
    for (let u = 0; u < caseUnits; u++) {
      const offset = u * 8
      if (isString[u]) {
        let blank = true
        for (let i = offset; i < offset + 8; i++)
          if (caseBuf[i] !== 0x20) {
            blank = false
            break
          }
        if (blank) bytecode.code(254)
        else bytecode.raw(caseBuf, offset)
      } else {
        const x = caseView.getFloat64(offset, true)
        if (x === SYSMIS) bytecode.code(255)
        else if (Number.isInteger(x) && x >= 1 - BIAS && x <= 251 - BIAS && !Object.is(x, -0)) bytecode.code(x + BIAS)
        else bytecode.raw(caseBuf, offset)
      }
    }
  }
  if (bytecode) {
    bytecode.code(252) // end of data
    bytecode.flush()
  }
  return w.result()
}
