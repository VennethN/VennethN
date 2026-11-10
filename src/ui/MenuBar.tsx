import { Check as CheckIcon, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuNode =
  | {
      label: string
      shortcut?: string
      action?: () => void
      disabled?: () => boolean
      checked?: () => boolean
      children?: MenuNode[]
    }
  | 'sep'

export interface TopMenu {
  label: string
  items: MenuNode[]
}

function MenuList({ items, x, y, onDone, depth }: { items: MenuNode[]; x: number; y: number; onDone: () => void; depth: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [child, setChild] = useState<{ idx: number; x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    let nx = x
    let ny = y
    if (nx + r.width > window.innerWidth - 4) nx = depth ? Math.max(4, x - r.width - 236) : Math.max(4, window.innerWidth - r.width - 4)
    if (ny + r.height > window.innerHeight - 4) ny = Math.max(4, window.innerHeight - r.height - 4)
    setPos({ x: Math.max(4, nx), y: ny })
  }, [x, y, depth])
  return (
    <>
      <div className="menu-pop" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu" onMouseDown={(e) => e.stopPropagation()}>
        {items.map((it, i) => {
          if (it === 'sep') return <div key={i} className="menu-sep" role="separator" />
          const disabled = it.disabled?.() ?? false
          const hasKids = !!it.children?.length
          return (
            <button
              key={i}
              role="menuitem"
              className={`menu-item ${child?.idx === i ? 'active' : ''}`}
              disabled={disabled}
              aria-haspopup={hasKids || undefined}
              onMouseEnter={(e) => {
                if (hasKids) {
                  const r = e.currentTarget.getBoundingClientRect()
                  setChild({ idx: i, x: r.right - 2, y: r.top - 5 })
                } else setChild(null)
              }}
              onClick={(e) => {
                if (hasKids) {
                  const r = e.currentTarget.getBoundingClientRect()
                  setChild({ idx: i, x: r.right - 2, y: r.top - 5 })
                  return
                }
                onDone()
                it.action?.()
              }}
            >
              <span className="check">{it.checked?.() ? <CheckIcon size={13} /> : null}</span>
              <span className="label">{it.label}</span>
              {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
              {hasKids && <ChevronRight size={13} className="arrow" />}
            </button>
          )
        })}
      </div>
      {child && (() => {
        const node = items[child.idx]
        return node !== 'sep' && node.children ? <MenuList items={node.children} x={child.x} y={child.y} onDone={onDone} depth={depth + 1} /> : null
      })()}
    </>
  )
}

export function MenuBar({ menus }: { menus: TopMenu[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const [anchor, setAnchor] = useState({ x: 0, y: 0 })
  const btns = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    if (open === null) return
    const close = () => setOpen(null)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', close)
    }
  }, [open])
  const openAt = (i: number) => {
    const r = btns.current[i]?.getBoundingClientRect()
    if (r) setAnchor({ x: r.left, y: r.bottom })
    setOpen(i)
  }
  return (
    <nav className="menubar" role="menubar" aria-label="Main menu">
      {menus.map((m, i) => (
        <div key={m.label} className={`menu-root ${open === i ? 'open' : ''}`}>
          <button
            ref={(el) => {
              btns.current[i] = el
            }}
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === i}
            onMouseDown={(e) => {
              e.stopPropagation()
              if (open === i) setOpen(null)
              else openAt(i)
            }}
            onMouseEnter={() => open !== null && open !== i && openAt(i)}
          >
            {m.label}
          </button>
        </div>
      ))}
      {open !== null && <MenuList items={menus[open].items} x={anchor.x} y={anchor.y} onDone={() => setOpen(null)} depth={0} />}
    </nav>
  )
}
