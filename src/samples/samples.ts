// Synthetic sample datasets, generated deterministically from a seed so every user sees the same data.

import { createVariable, datasetFromColumns, type CellValue, type Dataset, type ValueLabel, type Variable } from '../core/dataset'
import { mulberry32 } from '../stats/basic'

function rng(seed: number) {
  const u = mulberry32(seed)
  const normal = () => {
    const a = Math.max(u(), 1e-12)
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u())
  }
  const pick = <T,>(items: T[], weights?: number[]): T => {
    const w = weights ?? items.map(() => 1)
    const tot = w.reduce((s, x) => s + x, 0)
    let r = u() * tot
    for (let i = 0; i < items.length; i++) {
      r -= w[i]
      if (r <= 0) return items[i]
    }
    return items[items.length - 1]
  }
  return { u, normal, pick }
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const round = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d
const labels = (pairs: [number | string, string][]): ValueLabel[] => pairs.map(([value, label]) => ({ value, label }))

interface ColDef {
  v: Variable
  values: CellValue[]
}

function build(name: string, cols: ColDef[]): Dataset {
  const ds = datasetFromColumns(
    cols.map((c) => c.v),
    cols.map((c) => c.values),
    'DataSet1',
  )
  ds.fileName = `${name.toLowerCase().replace(/\s+/g, '_')}.sav`
  return ds
}

const LIKERT = labels([
  [1, 'Strongly disagree'],
  [2, 'Disagree'],
  [3, 'Neutral'],
  [4, 'Agree'],
  [5, 'Strongly agree'],
  [9, 'No answer'],
])

export function studentSurvey(): Dataset {
  const { u, normal, pick } = rng(20261110)
  const n = 200
  const c: Record<string, CellValue[]> = {}
  const push = (k: string, v: CellValue) => (c[k] ??= []).push(v)
  for (let i = 0; i < n; i++) {
    const gender = u() < 0.52 ? 2 : 1
    const faculty = pick([1, 2, 3, 4], [0.32, 0.28, 0.22, 0.18])
    const year = pick([1, 2, 3, 4], [0.3, 0.27, 0.23, 0.2])
    const age = clamp(Math.round(17 + year + Math.abs(normal()) * 1.6 + u() * 1.5), 17, 30)
    const hours = clamp(round(11 + (faculty === 1 ? 3 : 0) + (gender === 2 ? 1.5 : 0) + normal() * 4.5, 1), 0, 40)
    const sleep = clamp(round(7.1 - 0.06 * hours + normal() * 0.9, 1), 3.5, 10)
    const job = u() < 0.25 + 0.05 * year ? 1 : 0
    const stress = clamp(Math.round(42 + 1.1 * hours - 4.5 * (sleep - 7) + 6 * job + normal() * 9), 0, 100)
    const gpa = clamp(round(2.55 + 0.035 * hours + 0.06 * (sleep - 7) - 0.004 * stress - 0.06 * job + normal() * 0.22, 2), 1.8, 4)
    const sat = normal()
    const pre = clamp(Math.round(61 + 0.4 * hours + normal() * 9), 20, 100)
    const post = clamp(Math.round(pre + 4 + 0.25 * hours - 0.05 * stress + normal() * 6), 20, 100)
    push('id', i + 1)
    push('gender', gender)
    push('age', age)
    push('faculty', faculty)
    push('year', year)
    push('city', pick(['Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta', 'Medan'], [0.35, 0.2, 0.18, 0.15, 0.12]))
    push('hours_study', i % 97 === 13 ? null : hours)
    push('sleep_hours', sleep)
    push('part_time', job)
    push('stress', stress)
    push('gpa', i % 71 === 5 ? null : gpa)
    for (let k = 1; k <= 5; k++) {
      let s = clamp(Math.round(3.1 + 0.95 * sat + normal() * 0.75 + (k === 4 ? -0.3 : 0)), 1, 5)
      if (k === 3 && i % 53 === 7) s = 9
      push(`sat${k}`, s)
    }
    push('exam_pre', pre)
    push('exam_post', post)
  }
  const genderL = labels([
    [1, 'Male'],
    [2, 'Female'],
  ])
  const cols: ColDef[] = [
    { v: createVariable('id', { decimals: 0, label: 'Respondent ID', measure: 'nominal', role: 'none' }), values: c.id },
    { v: createVariable('gender', { decimals: 0, label: 'Gender', valueLabels: genderL, measure: 'nominal' }), values: c.gender },
    { v: createVariable('age', { decimals: 0, label: 'Age (years)', measure: 'scale' }), values: c.age },
    {
      v: createVariable('faculty', {
        decimals: 0,
        label: 'Faculty',
        measure: 'nominal',
        valueLabels: labels([
          [1, 'Computer Science'],
          [2, 'Business'],
          [3, 'Psychology'],
          [4, 'Design'],
        ]),
        columns: 10,
      }),
      values: c.faculty,
    },
    {
      v: createVariable('year', {
        decimals: 0,
        label: 'Year of study',
        measure: 'ordinal',
        valueLabels: labels([
          [1, 'First year'],
          [2, 'Second year'],
          [3, 'Third year'],
          [4, 'Fourth year'],
        ]),
      }),
      values: c.year,
    },
    { v: createVariable('city', { type: 'string', width: 12, label: 'Home city', measure: 'nominal' }), values: c.city },
    { v: createVariable('hours_study', { decimals: 1, label: 'Study hours per week', measure: 'scale', columns: 11 }), values: c.hours_study },
    { v: createVariable('sleep_hours', { decimals: 1, label: 'Sleep hours per night', measure: 'scale', columns: 11 }), values: c.sleep_hours },
    {
      v: createVariable('part_time', {
        decimals: 0,
        label: 'Has a part-time job',
        measure: 'nominal',
        valueLabels: labels([
          [0, 'No'],
          [1, 'Yes'],
        ]),
      }),
      values: c.part_time,
    },
    { v: createVariable('stress', { decimals: 0, label: 'Perceived stress (0-100)', measure: 'scale' }), values: c.stress },
    { v: createVariable('gpa', { decimals: 2, label: 'Grade point average', measure: 'scale' }), values: c.gpa },
    ...[
      'The lectures are engaging',
      'Course materials are useful',
      'Lecturers are approachable',
      'Assessment is fair',
      'I would recommend my program',
    ].map((label, k) => ({
      v: createVariable(`sat${k + 1}`, {
        decimals: 0,
        label,
        measure: 'ordinal' as const,
        valueLabels: LIKERT,
        missing: { kind: 'discrete' as const, values: [9] },
      }),
      values: c[`sat${k + 1}`],
    })),
    { v: createVariable('exam_pre', { decimals: 0, label: 'Exam score before the course', measure: 'scale', columns: 9 }), values: c.exam_pre },
    { v: createVariable('exam_post', { decimals: 0, label: 'Exam score after the course', measure: 'scale', columns: 9 }), values: c.exam_post },
  ]
  return build('Student Survey', cols)
}

export function clinicalTrial(): Dataset {
  const { u, normal } = rng(7781)
  const n = 90
  const c: Record<string, CellValue[]> = {}
  const push = (k: string, v: CellValue) => (c[k] ??= []).push(v)
  const eff4 = [2, 9, 13]
  const eff8 = [3, 13, 19]
  const ae = [0.1, 0.2, 0.37]
  for (let i = 0; i < n; i++) {
    const t = (i % 3) + 1
    const sex = u() < 0.5 ? 1 : 2
    const age = clamp(Math.round(56 + normal() * 9), 35, 80)
    const base = round(148 + 0.3 * (age - 56) + normal() * 11, 0)
    const w4 = round(base - eff4[t - 1] + normal() * 7, 0)
    const w8 = round(base - eff8[t - 1] + normal() * 8, 0)
    push('patient', `P${String(i + 1).padStart(3, '0')}`)
    push('treatment', t)
    push('sex', sex)
    push('age', age)
    push('weight', round(78 + (sex === 1 ? 7 : -6) + normal() * 11, 1))
    push('bp_base', base)
    push('bp_week4', i === 41 ? null : w4)
    push('bp_week8', i === 41 || i === 77 ? null : w8)
    push('adverse', u() < ae[t - 1] ? 1 : 0)
    push('improved', w8 !== null && base - w8 >= 10 ? 1 : 0)
  }
  const cols: ColDef[] = [
    { v: createVariable('patient', { type: 'string', width: 6, label: 'Patient code', role: 'none' }), values: c.patient },
    {
      v: createVariable('treatment', {
        decimals: 0,
        label: 'Treatment arm',
        measure: 'nominal',
        valueLabels: labels([
          [1, 'Placebo'],
          [2, 'Drug A'],
          [3, 'Drug B'],
        ]),
      }),
      values: c.treatment,
    },
    {
      v: createVariable('sex', {
        decimals: 0,
        label: 'Sex',
        measure: 'nominal',
        valueLabels: labels([
          [1, 'Male'],
          [2, 'Female'],
        ]),
      }),
      values: c.sex,
    },
    { v: createVariable('age', { decimals: 0, label: 'Age at enrolment', measure: 'scale' }), values: c.age },
    { v: createVariable('weight', { decimals: 1, label: 'Body weight (kg)', measure: 'scale' }), values: c.weight },
    { v: createVariable('bp_base', { decimals: 0, label: 'Systolic BP at baseline (mmHg)', measure: 'scale' }), values: c.bp_base },
    { v: createVariable('bp_week4', { decimals: 0, label: 'Systolic BP at week 4 (mmHg)', measure: 'scale' }), values: c.bp_week4 },
    { v: createVariable('bp_week8', { decimals: 0, label: 'Systolic BP at week 8 (mmHg)', measure: 'scale' }), values: c.bp_week8 },
    {
      v: createVariable('adverse', {
        decimals: 0,
        label: 'Adverse event reported',
        measure: 'nominal',
        valueLabels: labels([
          [0, 'No'],
          [1, 'Yes'],
        ]),
      }),
      values: c.adverse,
    },
    {
      v: createVariable('improved', {
        decimals: 0,
        label: 'BP reduced by 10+ mmHg at week 8',
        measure: 'nominal',
        valueLabels: labels([
          [0, 'No'],
          [1, 'Yes'],
        ]),
      }),
      values: c.improved,
    },
  ]
  return build('Clinical Trial', cols)
}

export function companySalaries(): Dataset {
  const { u, normal, pick } = rng(4242)
  const n = 150
  const c: Record<string, CellValue[]> = {}
  const push = (k: string, v: CellValue) => (c[k] ??= []).push(v)
  for (let i = 0; i < n; i++) {
    const gender = u() < 0.45 ? 2 : 1
    const educ = pick([12, 14, 15, 16, 17, 18, 19, 21], [0.28, 0.1, 0.12, 0.25, 0.08, 0.1, 0.04, 0.03])
    const jobcat = educ >= 17 && u() < 0.55 ? 3 : u() < 0.12 ? 2 : 1
    const exp = Math.max(0, Math.round(Math.abs(normal()) * 70 + u() * 30))
    const tenure = Math.round(63 + u() * 35)
    const start = Math.round((9000 + 1100 * (educ - 12) + (jobcat === 3 ? 9000 : jobcat === 2 ? 1500 : 0) + 18 * exp + normal() * 2200) / 50) * 50
    const salary =
      Math.round((start * (1.55 + 0.004 * (tenure - 60)) - (gender === 2 ? 1200 : 0) + normal() * 3500) / 50) * 50
    push('id', i + 1)
    push('gender', gender)
    push('educ', educ)
    push('jobcat', jobcat)
    push('salary', salary)
    push('salbegin', start)
    push('jobtime', tenure)
    push('prevexp', exp)
    push('remote', pick([1, 2, 3], [0.5, 0.35, 0.15]))
  }
  const cols: ColDef[] = [
    { v: createVariable('id', { decimals: 0, label: 'Employee code', measure: 'nominal', role: 'none' }), values: c.id },
    {
      v: createVariable('gender', {
        decimals: 0,
        label: 'Gender',
        measure: 'nominal',
        valueLabels: labels([
          [1, 'Male'],
          [2, 'Female'],
        ]),
      }),
      values: c.gender,
    },
    { v: createVariable('educ', { decimals: 0, label: 'Educational level (years)', measure: 'ordinal' }), values: c.educ },
    {
      v: createVariable('jobcat', {
        decimals: 0,
        label: 'Employment category',
        measure: 'nominal',
        valueLabels: labels([
          [1, 'Clerical'],
          [2, 'Custodial'],
          [3, 'Manager'],
        ]),
      }),
      values: c.jobcat,
    },
    { v: createVariable('salary', { decimals: 0, label: 'Current salary', measure: 'scale', columns: 9 }), values: c.salary },
    { v: createVariable('salbegin', { decimals: 0, label: 'Beginning salary', measure: 'scale', columns: 9 }), values: c.salbegin },
    { v: createVariable('jobtime', { decimals: 0, label: 'Months since hire', measure: 'scale' }), values: c.jobtime },
    { v: createVariable('prevexp', { decimals: 0, label: 'Previous experience (months)', measure: 'scale' }), values: c.prevexp },
    {
      v: createVariable('remote', {
        decimals: 0,
        label: 'Work arrangement',
        measure: 'nominal',
        valueLabels: labels([
          [1, 'On-site'],
          [2, 'Hybrid'],
          [3, 'Remote'],
        ]),
      }),
      values: c.remote,
    },
  ]
  return build('Company Salaries', cols)
}

export interface SampleInfo {
  id: string
  name: string
  description: string
  load: () => Dataset
}

export const SAMPLES: SampleInfo[] = [
  {
    id: 'survey',
    name: 'Student Survey',
    description: '200 students: demographics, study habits, GPA, a 5-item satisfaction scale and pre/post exam scores.',
    load: studentSurvey,
  },
  {
    id: 'trial',
    name: 'Clinical Trial',
    description: '90 patients in three treatment arms with blood pressure measured at baseline, week 4 and week 8.',
    load: clinicalTrial,
  },
  {
    id: 'salaries',
    name: 'Company Salaries',
    description: '150 employees: salary, starting salary, education, job category and experience — good for regression.',
    load: companySalaries,
  },
]
