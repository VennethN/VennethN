import { tableToHTML, type OutputBlock } from '../../core/output'
import { chartTable, chartToSVGString } from './chartUtils'

/** Build a standalone HTML document of the whole output (charts are taken from the rendered DOM). */
export function exportOutputHTML(blocks: OutputBlock[], title: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const parts: string[] = []
  for (const b of blocks) {
    parts.push(`<h1>${esc(b.title)}</h1>`)
    for (const it of b.items) {
      if (it.kind === 'log') parts.push(`<pre class="log">${esc(it.text)}</pre>`)
      else if (it.kind === 'title') parts.push(`<h2>${esc(it.text)}</h2>`)
      else if (it.kind === 'table') parts.push(`<div class="tbl">${tableToHTML(it.table)}</div>`)
      else if (it.kind === 'text') parts.push(`<div class="txt ${it.tone ?? ''}">${esc(it.text)}</div>`)
      else if (it.kind === 'chart') {
        const svg = document.querySelector(`[data-item-id="${it.id}"] svg`) as SVGSVGElement | null
        if (svg) parts.push(`<div class="chart">${chartToSVGString(svg)}</div>`)
        else {
          const t = chartTable(it.chart)
          parts.push(
            `<table class="cdata"><caption>${esc(it.chart.title)}</caption><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${t.rows
              .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
              .join('')}</table>`,
          )
        }
      }
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font:13px Arial,sans-serif;margin:24px;color:#111;background:#fff}h1{font-size:19px;margin:24px 0 8px}h2{font-size:15px}
pre.log{background:#f6f8fb;border-left:3px solid #c3cfdf;padding:6px 10px;font:12px Consolas,monospace;white-space:pre-wrap}
.tbl{margin:12px 0 18px}.txt{padding:8px 12px;background:#f3f6fa;margin:8px 0;white-space:pre-wrap}.txt.error{background:#fdecea;color:#b42318}
.txt.warning{background:#fff6e0;color:#8a5a00}.chart{margin:12px 0}.chart svg{max-width:100%;height:auto}
table.cdata{border-collapse:collapse}table.cdata td,table.cdata th{border:1px solid #ccc;padding:2px 6px}</style></head><body>${parts.join('\n')}</body></html>`
}
