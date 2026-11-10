import { useApp } from '../state/store'
import {
  AboutDialog,
  AutoRecodeDialog,
  ComputeDialog,
  GoToCaseDialog,
  GoToVariableDialog,
  HelpDialog,
  ImportCsvDialog,
  MissingValuesDialog,
  OptionsDialog,
  RankDialog,
  RecodeDialog,
  SelectCasesDialog,
  SortCasesDialog,
  ValueLabelsDialog,
  VariablesInfoDialog,
  VarTypeDialog,
  WeightCasesDialog,
  WelcomeDialog,
} from './dialogs/custom'
import { ANALYSIS_DIALOGS } from './dialogs/defs'
import { GenericDialog } from './dialogs/framework'
import { openDataFile } from './fileOps'

const GENERIC = new Map(ANALYSIS_DIALOGS.map((d) => [d.id, d]))

export function DialogHost() {
  const dialog = useApp((s) => s.dialog)
  if (!dialog) return null
  const p = dialog.props ?? {}
  const def = GENERIC.get(dialog.id)
  if (def) return <GenericDialog key={dialog.id} def={def} />
  switch (dialog.id) {
    case 'compute':
      return <ComputeDialog />
    case 'recode-same':
      return <RecodeDialog key="same" different={false} />
    case 'recode-diff':
      return <RecodeDialog key="diff" different />
    case 'autorecode':
      return <AutoRecodeDialog />
    case 'rank':
      return <RankDialog />
    case 'select-cases':
      return <SelectCasesDialog />
    case 'sort-cases':
      return <SortCasesDialog />
    case 'weight-cases':
      return <WeightCasesDialog />
    case 'var-type':
      return <VarTypeDialog varId={String(p.varId)} />
    case 'value-labels':
      return <ValueLabelsDialog varId={String(p.varId)} />
    case 'missing-values':
      return <MissingValuesDialog varId={String(p.varId)} />
    case 'goto-case':
      return <GoToCaseDialog />
    case 'goto-variable':
      return <GoToVariableDialog />
    case 'variables-info':
      return <VariablesInfoDialog varId={p.varId as string | undefined} />
    case 'options':
      return <OptionsDialog />
    case 'import-csv':
      return <ImportCsvDialog text={String(p.text)} fileName={String(p.fileName)} />
    case 'welcome':
      return <WelcomeDialog onOpenFile={() => openDataFile()} />
    case 'about':
      return <AboutDialog />
    case 'help':
      return <HelpDialog topic={p.topic as string | undefined} />
    default:
      return null
  }
}

