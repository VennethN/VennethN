import { FolderOpen, Play, PlayCircle, Save, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { splitCommands } from '../../syntax/parser'
import { useApp } from '../../state/store'
import { download, pickFile } from '../browser'

const TWO_WORD = new Set(['NPAR', 'NONPAR', 'SORT', 'SELECT', 'VALUE', 'VARIABLE', 'MISSING', 'DELETE', 'RENAME', 'ADD', 'USE'])
const KEYWORDS = new Set([
  'BY',
  'WITH',
  'TO',
  'ALL',
  'INTO',
  'AND',
  'OR',
  'NOT',
  'THRU',
  'LO',
  'HI',
  'LOWEST',
  'HIGHEST',
  'ELSE',
  'SYSMIS',
  'MISSING',
  'COPY',
  'PAIRED',
  'EQ',
  'NE',
  'LT',
  'LE',
  'GT',
  'GE',
  'OFF',
])

const TOKEN = /('(?:[^']|'')*'?|"(?:[^"]|"")*"?|\/\*.*?\*\/|\/[A-Za-z][\w-]*|[A-Za-z@#$][\w.@#$-]*|\d*\.?\d+(?:[eE][+-]?\d+)?|\s+|.)/g

function highlight(text: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let atStart = true
  let inComment = false
  lines.forEach((line, li) => {
    const parts: ReactNode[] = []
    const trimmed = line.trim()
    if (atStart && trimmed === '') {
      // blank lines keep the "start of command" state
    } else if (inComment || (atStart && (/^\*/.test(trimmed) || /^COMMENT\b/i.test(trimmed)))) {
      inComment = true
      parts.push(
        <span key="c" className="hl-com">
          {line}
        </span>,
      )
      if (trimmed.endsWith('.')) inComment = false
      atStart = trimmed.endsWith('.')
      out.push(<Fragment2 key={li}>{parts}</Fragment2>)
      out.push('\n')
      return
    } else {
      let wordIdx = 0
      let first = ''
      let m: RegExpExecArray | null
      TOKEN.lastIndex = 0
      let k = 0
      while ((m = TOKEN.exec(line))) {
        const t = m[0]
        let cls: string | undefined
        if (/^\s+$/.test(t)) cls = undefined
        else if (t.startsWith("'") || t.startsWith('"')) cls = 'hl-str'
        else if (t.startsWith('/*')) cls = 'hl-com'
        else if (t.startsWith('/') && t.length > 1) cls = 'hl-sub'
        else if (/^[A-Za-z@#$]/.test(t)) {
          const up = t.toUpperCase()
          if (atStart && wordIdx === 0) {
            cls = 'hl-cmd'
            first = up
          } else if (atStart && wordIdx === 1 && TWO_WORD.has(first)) cls = 'hl-cmd'
          else if (KEYWORDS.has(up)) cls = 'hl-kw'
          wordIdx++
        } else if (/^\d|^\.\d/.test(t)) cls = 'hl-num'
        parts.push(
          cls ? (
            <span key={k++} className={cls}>
              {t}
            </span>
          ) : (
            t
          ),
        )
      }
      atStart = trimmed.endsWith('.')
    }
    out.push(<Fragment2 key={li}>{parts}</Fragment2>)
    out.push('\n')
  })
  return out
}

function Fragment2({ children }: { children: ReactNode }) {
  return <>{children}</>
}

const TEMPLATES: { label: string; text: string }[] = [
  { label: 'FREQUENCIES', text: 'FREQUENCIES VARIABLES=var1\n  /STATISTICS=MEAN MEDIAN MODE STDDEV\n  /BARCHART FREQ\n  /ORDER=ANALYSIS.' },
  { label: 'DESCRIPTIVES', text: 'DESCRIPTIVES VARIABLES=var1 var2\n  /STATISTICS=MEAN STDDEV MIN MAX.' },
  { label: 'EXAMINE', text: 'EXAMINE VARIABLES=score BY group\n  /PLOT BOXPLOT NPPLOT\n  /STATISTICS DESCRIPTIVES\n  /NOTOTAL.' },
  { label: 'CROSSTABS', text: 'CROSSTABS\n  /TABLES=row BY col\n  /STATISTICS=CHISQ PHI\n  /CELLS=COUNT EXPECTED ROW.' },
  { label: 'T-TEST (independent)', text: 'T-TEST GROUPS=group(1 2)\n  /VARIABLES=score\n  /CRITERIA=CI(.95).' },
  { label: 'T-TEST (paired)', text: 'T-TEST PAIRS=pre WITH post (PAIRED)\n  /CRITERIA=CI(.95).' },
  { label: 'ONEWAY', text: 'ONEWAY score BY group\n  /STATISTICS DESCRIPTIVES HOMOGENEITY WELCH\n  /POSTHOC=TUKEY ALPHA(0.05).' },
  { label: 'CORRELATIONS', text: 'CORRELATIONS\n  /VARIABLES=x y z\n  /PRINT=TWOTAIL NOSIG.' },
  {
    label: 'REGRESSION',
    text: 'REGRESSION\n  /STATISTICS COEFF OUTS R ANOVA COLLIN TOL\n  /DEPENDENT y\n  /METHOD=ENTER x1 x2\n  /RESIDUALS DURBIN HISTOGRAM(ZRESID) NORMPROB(ZRESID).',
  },
  { label: 'RELIABILITY', text: "RELIABILITY\n  /VARIABLES=item1 TO item5\n  /SCALE('ALL VARIABLES') ALL\n  /MODEL=ALPHA\n  /SUMMARY=TOTAL." },
  { label: 'NPAR TESTS', text: 'NPAR TESTS\n  /M-W= score BY group(1 2)\n  /MISSING ANALYSIS.' },
  { label: 'COMPUTE', text: 'COMPUTE total = SUM(item1 TO item5).\nEXECUTE.' },
  { label: 'RECODE', text: 'RECODE age (LO THRU 29=1) (30 THRU 49=2) (50 THRU HI=3) INTO agegroup.\nEXECUTE.' },
  { label: 'SELECT IF', text: 'SELECT IF (age >= 18).\nEXECUTE.' },
  { label: 'GRAPH', text: 'GRAPH\n  /SCATTERPLOT(BIVAR)=x WITH y\n  /FITLINE TOTAL.' },
]

export function SyntaxEditor() {
  const text = useApp((s) => s.syntax)
  const setSyntax = useApp((s) => s.setSyntax)
  const run = useApp((s) => s.runSyntax)
  const notify = useApp((s) => s.notify)
  const fileName = useApp((s) => s.syntaxFileName)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const [cursorLine, setCursorLine] = useState(1)
  const highlighted = useMemo(() => highlight(text), [text])
  const lineCount = text.split('\n').length

  const sync = () => {
    const ta = taRef.current
    if (!ta) return
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop
      preRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop
  }

  const updateCursor = () => {
    const ta = taRef.current
    if (!ta) return
    setCursorLine(ta.value.slice(0, ta.selectionStart).split('\n').length)
  }

  const runSelection = () => {
    const ta = taRef.current
    if (!ta) return
    const { selectionStart: a, selectionEnd: b, value } = ta
    if (b > a) return run(value.slice(a, b))
    // current command at the cursor
    const line = value.slice(0, a).split('\n').length
    const cmds = splitCommands(value)
    const cmd = cmds.find((c) => line >= c.line && line <= c.line + c.text.split('\n').length - 1 + 1) ?? cmds.filter((c) => c.line <= line).pop()
    if (!cmd) return notify('There is no command at the cursor.', 'error')
    run(cmd.text + '.')
  }

  const runAll = () => {
    if (!text.trim()) return notify('The Syntax Editor is empty.', 'error')
    run(text)
  }

  const insert = (snippet: string) => {
    const ta = taRef.current
    const pos = ta ? ta.selectionEnd : text.length
    const before = text.slice(0, pos)
    const sep = before && !before.endsWith('\n') ? '\n' : ''
    const next = before + sep + snippet + '\n' + text.slice(pos)
    setSyntax(next)
    setTimeout(() => {
      if (!ta) return
      const p = (before + sep + snippet + '\n').length
      ta.focus()
      ta.setSelectionRange(p, p)
    }, 0)
  }

  return (
    <div className="syntax">
      <div className="syn-bar">
        <button className="btn small primary" onClick={runSelection} title="Run the selection, or the command at the cursor (Ctrl+R)">
          <Play size={14} /> Run Selection
        </button>
        <button className="btn small" onClick={runAll} title="Run all commands (Ctrl+Shift+R)">
          <PlayCircle size={14} /> Run All
        </button>
        <span className="tb-sep" />
        <button
          className="btn small"
          onClick={async () => {
            const f = await pickFile('.sps,.txt')
            if (f) setSyntax(await f.text(), f.name)
          }}
        >
          <FolderOpen size={14} /> Open…
        </button>
        <button className="btn small" onClick={() => download(fileName ?? 'syntax.sps', text, 'text/plain')}>
          <Save size={14} /> Save…
        </button>
        <button className="btn small" onClick={() => setSyntax('')} disabled={!text}>
          <Trash2 size={14} /> Clear
        </button>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          {fileName ?? 'Syntax1'} · Ln {cursorLine} · Ctrl+R runs the current command
        </span>
      </div>
      <div className="syn-body">
        <div className="syn-gutter" ref={gutterRef} aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className={i + 1 === cursorLine ? 'cur' : undefined}>
              {i + 1}
            </div>
          ))}
          <div style={{ height: 40 }} />
        </div>
        <div className="syn-editor">
          <pre ref={preRef} aria-hidden>
            {highlighted}
            {'\n'}
          </pre>
          <textarea
            ref={taRef}
            value={text}
            spellCheck={false}
            aria-label="Syntax editor"
            placeholder={'Type command syntax here, e.g.\n\nFREQUENCIES VARIABLES=gender.\n\nor use Paste in any dialog.'}
            onChange={(e) => {
              setSyntax(e.target.value)
              updateCursor()
            }}
            onScroll={sync}
            onKeyUp={updateCursor}
            onClick={updateCursor}
            onKeyDown={(e) => {
              const mod = e.ctrlKey || e.metaKey
              if (mod && (e.key === 'r' || e.key === 'R' || e.key === 'Enter')) {
                e.preventDefault()
                if (e.shiftKey) runAll()
                else runSelection()
              } else if (e.key === 'Tab') {
                e.preventDefault()
                const ta = e.currentTarget
                const { selectionStart: a, selectionEnd: b } = ta
                const next = text.slice(0, a) + '  ' + text.slice(b)
                setSyntax(next)
                setTimeout(() => ta.setSelectionRange(a + 2, a + 2), 0)
              }
            }}
          />
        </div>
        <aside className="syn-help" aria-label="Command templates">
          <h3>Insert command</h3>
          {TEMPLATES.map((t) => (
            <button key={t.label} onClick={() => insert(t.text)} title={t.text}>
              {t.label}
            </button>
          ))}
          <p className="muted" style={{ marginTop: 10 }}>
            Every dialog has a <b>Paste</b> button that writes its syntax here. See Help ▸ Command Syntax Reference for the full list.
          </p>
        </aside>
      </div>
    </div>
  )
}
