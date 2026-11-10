import { insertCases, insertVariable } from '../core/dataset'
import { SAMPLES } from '../samples/samples'
import { useApp } from '../state/store'
import { clearSession } from '../state/persist'
import { exportOutput, newDataset, openDataFile, saveData } from './fileOps'
import type { MenuNode, TopMenu } from './MenuBar'

const st = () => useApp.getState()
const dlg = (id: string, props?: Record<string, unknown>) => () => st().openDialog(id, props)
const noData = () => st().ds.variables.length === 0
const item = (label: string, action: () => void, extra: Partial<Exclude<MenuNode, 'sep'>> = {}): MenuNode => ({ label, action, ...extra })
const analysis = (label: string, id: string): MenuNode => item(label, dlg(id), { disabled: noData })

export function buildMenus(): TopMenu[] {
  return [
    {
      label: 'File',
      items: [
        {
          label: 'New',
          children: [
            item('Data', newDataset),
            item('Syntax', () => {
              st().setWin('syntax')
            }),
          ],
        },
        {
          label: 'Open',
          children: [item('Data…', () => openDataFile(), { shortcut: 'Ctrl+O' }), item('Syntax…', () => openDataFile())],
        },
        {
          label: 'Open Sample Data',
          children: SAMPLES.map((s) =>
            item(s.name, () => {
              if (st().dirty && !window.confirm('Discard unsaved changes to the current dataset?')) return
              st().replaceDataset(s.load())
              st().setDataTab('data')
            }),
          ),
        },
        'sep',
        item('Save', () => saveData(), { shortcut: 'Ctrl+S', disabled: noData }),
        {
          label: 'Save As',
          children: [
            item('SPSS Statistics (*.sav)…', () => saveData('sav', true), { disabled: noData }),
            item('Comma-separated values (*.csv)…', () => saveData('csv', true), { disabled: noData }),
            item('VennStat project (*.vstat)…', () => saveData('vstat', true), { disabled: noData }),
          ],
        },
        'sep',
        item('Export Output (HTML)…', exportOutput, { disabled: () => !st().blocks.length }),
        item('Print Output…', () => {
          st().setWin('output')
          setTimeout(() => window.print(), 150)
        }),
        'sep',
        item('Clear Saved Session', async () => {
          if (!window.confirm('Remove the autosaved session from this browser? The current window is not affected until reload.')) return
          await clearSession()
          st().notify('Saved session cleared.')
        }),
      ],
    },
    {
      label: 'Edit',
      items: [
        item('Undo', () => st().undo(), { shortcut: 'Ctrl+Z', disabled: () => !st().past.length }),
        item('Redo', () => st().redo(), { shortcut: 'Ctrl+Y', disabled: () => !st().future.length }),
        'sep',
        item('Insert Variable', () => st().commit(insertVariable(st().ds, st().ds.variables.length)), {}),
        item('Insert Cases', () => st().commit(insertCases(st().ds, st().ds.nCases, 1)), { disabled: noData }),
        'sep',
        item('Go to Case…', dlg('goto-case'), { disabled: noData }),
        item('Go to Variable…', dlg('goto-variable'), { disabled: noData }),
        'sep',
        item('Options…', dlg('options')),
      ],
    },
    {
      label: 'View',
      items: [
        item('Value Labels', () => st().toggleValueLabels(), { checked: () => st().showValueLabels }),
        'sep',
        item('Data View', () => st().setDataTab('data'), { checked: () => st().win === 'data' && st().dataTab === 'data' }),
        item('Variable View', () => st().setDataTab('variables'), { checked: () => st().win === 'data' && st().dataTab === 'variables' }),
      ],
    },
    {
      label: 'Data',
      items: [
        item('Sort Cases…', dlg('sort-cases'), { disabled: noData }),
        item('Select Cases…', dlg('select-cases'), { disabled: noData }),
        item('Weight Cases…', dlg('weight-cases'), { disabled: noData }),
        'sep',
        item('Insert Variable', () => st().commit(insertVariable(st().ds, st().ds.variables.length))),
        item('Insert Cases', () => st().commit(insertCases(st().ds, st().ds.nCases, 1)), { disabled: noData }),
        item('Go to Case…', dlg('goto-case'), { disabled: noData }),
        item('Go to Variable…', dlg('goto-variable'), { disabled: noData }),
      ],
    },
    {
      label: 'Transform',
      items: [
        analysis('Compute Variable…', 'compute'),
        'sep',
        analysis('Recode into Same Variables…', 'recode-same'),
        analysis('Recode into Different Variables…', 'recode-diff'),
        analysis('Automatic Recode…', 'autorecode'),
        'sep',
        analysis('Rank Cases…', 'rank'),
      ],
    },
    {
      label: 'Analyze',
      items: [
        {
          label: 'Descriptive Statistics',
          children: [analysis('Frequencies…', 'frequencies'), analysis('Descriptives…', 'descriptives'), analysis('Explore…', 'explore'), analysis('Crosstabs…', 'crosstabs')],
        },
        {
          label: 'Compare Means',
          children: [
            analysis('Means…', 'means'),
            analysis('One-Sample T Test…', 'ttest-one'),
            analysis('Independent-Samples T Test…', 'ttest-ind'),
            analysis('Paired-Samples T Test…', 'ttest-paired'),
            analysis('One-Way ANOVA…', 'oneway'),
          ],
        },
        { label: 'Correlate', children: [analysis('Bivariate…', 'correlations')] },
        { label: 'Regression', children: [analysis('Linear…', 'regression')] },
        { label: 'Scale', children: [analysis('Reliability Analysis…', 'reliability')] },
        {
          label: 'Nonparametric Tests',
          children: [
            {
              label: 'Legacy Dialogs',
              children: [
                analysis('Chi-square…', 'npar-chisquare'),
                analysis('1-Sample K-S…', 'npar-ks'),
                analysis('2 Independent Samples…', 'npar-mw'),
                analysis('K Independent Samples…', 'npar-kw'),
                analysis('2 Related Samples…', 'npar-wilcoxon'),
                analysis('K Related Samples…', 'npar-friedman'),
              ],
            },
          ],
        },
      ],
    },
    {
      label: 'Graphs',
      items: [
        {
          label: 'Legacy Dialogs',
          children: [
            analysis('Bar…', 'graph-bar'),
            analysis('Line…', 'graph-line'),
            analysis('Pie…', 'graph-pie'),
            analysis('Boxplot…', 'graph-box'),
            analysis('Scatter/Dot…', 'graph-scatter'),
            analysis('Histogram…', 'graph-histogram'),
          ],
        },
      ],
    },
    {
      label: 'Utilities',
      items: [item('Variables…', dlg('variables-info'), { disabled: noData })],
    },
    {
      label: 'Window',
      items: [
        item('Data Editor', () => st().setWin('data'), { shortcut: 'Ctrl+1', checked: () => st().win === 'data' }),
        item('Output Viewer', () => st().setWin('output'), { shortcut: 'Ctrl+2', checked: () => st().win === 'output' }),
        item('Syntax Editor', () => st().setWin('syntax'), { shortcut: 'Ctrl+3', checked: () => st().win === 'syntax' }),
      ],
    },
    {
      label: 'Help',
      items: [
        item('Getting Started', dlg('help')),
        item('Command Syntax Reference', dlg('help', { topic: 'syntax' })),
        item('Keyboard Shortcuts', dlg('help', { topic: 'shortcuts' })),
        item('Welcome Screen', dlg('welcome')),
        'sep',
        item('About VennStat', dlg('about')),
      ],
    },
  ]
}
