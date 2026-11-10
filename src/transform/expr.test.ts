import { describe, expect, it } from 'vitest'
import { createVariable, datasetFromColumns } from '../core/dataset'
import { applyAutoRecode, applyCompute, applyRecode, applySelectIf, applySort } from './transforms'
import { evaluateAll, parseExpr } from './expr'

const a = createVariable('a')
const b = createVariable('b', { missing: { kind: 'discrete', values: [99] } })
const s = createVariable('s', { type: 'string', width: 8 })
const ds = datasetFromColumns(
  [a, b, s],
  [
    [1, 2, null, 4, 5],
    [10, 99, 30, null, 50],
    ['x', 'yy', 'x', '', 'zz'],
  ],
)

describe('expressions', () => {
  it('arithmetic with SPSS precedence and missing propagation', () => {
    expect(evaluateAll(ds, 'a + b * 2')).toEqual([21, null, null, null, 105])
    expect(evaluateAll(ds, '-2**2')).toEqual(new Array(5).fill(-4))
    expect(evaluateAll(ds, 'a / 0')).toEqual(new Array(5).fill(null))
  })
  it('statistical functions skip missing values', () => {
    expect(evaluateAll(ds, 'MEAN(a, b)')).toEqual([5.5, 2, 30, 4, 27.5])
    expect(evaluateAll(ds, 'MEAN.2(a, b)')).toEqual([5.5, null, null, null, 27.5])
    expect(evaluateAll(ds, 'SUM(a, b)')).toEqual([11, 2, 30, 4, 55])
    expect(evaluateAll(ds, 'NMISS(a, b)')).toEqual([0, 1, 1, 1, 0])
  })
  it('three-valued logic', () => {
    expect(evaluateAll(ds, 'a > 1 AND b > 20')).toEqual([0, null, null, null, 1])
    expect(evaluateAll(ds, 'a > 1 OR b > 20')).toEqual([0, 1, 1, 1, 1])
    expect(evaluateAll(ds, 'a > 3 OR b > 20')).toEqual([0, null, 1, 1, 1])
    expect(evaluateAll(ds, 'MISSING(b)')).toEqual([0, 1, 0, 1, 0])
    expect(evaluateAll(ds, 'SYSMIS(b)')).toEqual([0, 0, 0, 1, 0])
    expect(evaluateAll(ds, 'VALUE(b)')).toEqual([10, 99, 30, null, 50])
  })
  it('strings and comparisons', () => {
    expect(evaluateAll(ds, "s = 'x'")).toEqual([1, 0, 1, 0, 0])
    expect(evaluateAll(ds, "CONCAT(UPCASE(s), '-', LTRIM(STRING(a, F4.1)))")).toEqual(['X-1.0', 'YY-2.0', 'X-', '-4.0', 'ZZ-5.0'])
    expect(evaluateAll(ds, 'LENGTH(s)')).toEqual([1, 2, 1, 0, 2])
    expect(evaluateAll(ds, 'ANY(a, 2, 4)')).toEqual([0, 1, null, 1, 0])
    expect(evaluateAll(ds, 'RANGE(b, 0, 40)')).toEqual([1, null, 1, null, 0])
  })
  it('distribution functions', () => {
    const [p] = evaluateAll(ds, 'CDF.NORMAL(1.96, 0, 1)') as number[]
    expect(p).toBeCloseTo(0.9750021, 6)
    const [q] = evaluateAll(ds, 'IDF.T(0.975, 10)') as number[]
    expect(q).toBeCloseTo(2.228139, 5)
  })
  it('rejects bad expressions', () => {
    expect(() => parseExpr('a +')).toThrow()
    expect(() => parseExpr('FOO(a)')).toThrow(/Unknown function/)
    expect(() => evaluateAll(ds, 'nothere + 1')).toThrow(/does not exist/)
  })
})

describe('transformations', () => {
  it('COMPUTE creates variables and honors IF conditions', () => {
    let d = applyCompute(ds, { proc: 'compute', target: 'c', expression: 'a * 10', condition: null, stringWidth: null })
    d = applyCompute(d, { proc: 'compute', target: 'c', expression: '0', condition: 'a >= 4', stringWidth: null })
    expect(d.data[d.variables[3].id]).toEqual([10, 20, null, 0, 0])
  })
  it('RECODE into a new variable with ranges, ELSE and COPY', () => {
    const d = applyRecode(ds, {
      proc: 'recode',
      variables: ['a'],
      into: ['r'],
      rules: [
        { old: [{ kind: 'lowest', high: 2 }], to: { kind: 'value', value: 1 } },
        { old: [{ kind: 'sysmis' }], to: { kind: 'value', value: -1 } },
        { old: [{ kind: 'else' }], to: { kind: 'copy' } },
      ],
      intoString: null,
    })
    expect(d.data[d.variables[3].id]).toEqual([1, 1, -1, 4, 5])
  })
  it('SORT CASES (missing first, stable)', () => {
    const d = applySort(ds, { proc: 'sort', keys: [{ variable: 'b', descending: false }] })
    expect(d.data[b.id]).toEqual([null, 10, 30, 50, 99])
    expect(d.data[s.id]).toEqual(['', 'x', 'x', 'zz', 'yy'])
  })
  it('SELECT IF drops false and missing results', () => {
    const d = applySelectIf(ds, { proc: 'select-if', condition: 'a > 1' })
    expect(d.nCases).toBe(3)
  })
  it('AUTORECODE strings into labeled codes', () => {
    const d = applyAutoRecode(ds, { proc: 'autorecode', variables: ['s'], into: ['s_n'], descending: false })
    const v = d.variables[3]
    expect(d.data[v.id]).toEqual([1, 2, 1, null, 3])
    expect(v.valueLabels).toEqual([
      { value: 1, label: 'x' },
      { value: 2, label: 'yy' },
      { value: 3, label: 'zz' },
    ])
  })
})

describe('variable ranges in functions', () => {
  it('MEAN(a TO b) expands in dataset order', () => {
    const d = datasetFromColumns(
      [createVariable('q1'), createVariable('q2'), createVariable('q3'), createVariable('z')],
      [
        [1, 2],
        [3, null],
        [5, 6],
        [100, 100],
      ],
    )
    expect(evaluateAll(d, 'MEAN(q1 TO q3)')).toEqual([3, 4])
    expect(evaluateAll(d, 'SUM(q1 TO q2, z)')).toEqual([104, 102])
    expect(() => evaluateAll(d, 'MEAN(q3 TO q1)')).toThrow(/first variable/)
  })
})
