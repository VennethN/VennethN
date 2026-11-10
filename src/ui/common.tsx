// Shared small UI pieces: measurement-level icons, dialog shell, form controls, context menu.

import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Variable } from '../core/dataset'

export function MeasureIcon({ v, size = 14 }: { v: Pick<Variable, 'measure' | 'type'>; size?: number }) {
  const s = size
  if (v.type === 'string')
    return (
      <svg className="mi" width={s} height={s} viewBox="0 0 16 16" aria-hidden>
        <circle cx="5" cy="5" r="3.2" fill="#e05d5d" />
        <circle cx="11" cy="5" r="3.2" fill="#3d8bfd" />
        <circle cx="8" cy="11" r="3.2" fill="#f1b300" />
        <text x="8" y="12.4" fontSize="6.5" textAnchor="middle" fill="#1d2430" fontWeight="700">
          a
        </text>
      </svg>
    )
  if (v.measure === 'scale')
    return (
      <svg className="mi" width={s} height={s} viewBox="0 0 16 16" aria-hidden>
        <rect x="1" y="5" width="14" height="6" rx="1" fill="#f5c84c" stroke="#a37a0b" strokeWidth=".8" />
        {[3, 5, 7, 9, 11, 13].map((x, i) => (
          <line key={x} x1={x} y1="5" x2={x} y2={i % 2 ? 7 : 8.5} stroke="#7a5a05" strokeWidth=".8" />
        ))}
      </svg>
    )
  if (v.measure === 'ordinal')
    return (
      <svg className="mi" width={s} height={s} viewBox="0 0 16 16" aria-hidden>
        <rect x="2" y="9" width="3" height="5" fill="#3d8bfd" />
        <rect x="6.5" y="6" width="3" height="8" fill="#e05d5d" />
        <rect x="11" y="3" width="3" height="11" fill="#2bb673" />
      </svg>
    )
  return (
    <svg className="mi" width={s} height={s} viewBox="0 0 16 16" aria-hidden>
      <circle cx="5" cy="5" r="3.2" fill="#e05d5d" />
      <circle cx="11" cy="5" r="3.2" fill="#3d8bfd" />
      <circle cx="8" cy="11" r="3.2" fill="#f1b300" />
    </svg>
  )
}

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="12" fill="#2f6fc5" />
      <circle cx="25" cy="30" r="15" fill="#8cc0ff" fillOpacity=".8" />
      <circle cx="39" cy="30" r="15" fill="#ffc46b" fillOpacity=".8" />
      <rect x="14" y="48" width="8" height="8" fill="#fff" />
      <rect x="28" y="44" width="8" height="12" fill="#fff" />
      <rect x="42" y="40" width="8" height="16" fill="#fff" />
    </svg>
  )
}

/** A draggable modal dialog window. */
export function DialogShell({
  title,
  width = 560,
  onClose,
  children,
  footer,
  layer = 0,
}: {
  title: string
  width?: number
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  layer?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.max(8, (window.innerWidth - r.width) / 2 + layer * 24),
      y: Math.max(8, Math.min(90 + layer * 24, (window.innerHeight - r.height) / 2)),
    })
  }, [layer])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const el = ref.current
    el?.addEventListener('keydown', onKey)
    return () => el?.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    // focus first focusable element
    const el = ref.current
    const f = el?.querySelector<HTMLElement>('[data-autofocus], .varlist, input, select, textarea, button.btn')
    f?.focus()
  }, [])
  const drag = (e: React.PointerEvent) => {
    if (!pos || (e.target as HTMLElement).closest('button')) return
    const sx = e.clientX - pos.x
    const sy = e.clientY - pos.y
    const move = (ev: PointerEvent) =>
      setPos({
        x: Math.min(window.innerWidth - 60, Math.max(-200, ev.clientX - sx)),
        y: Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - sy)),
      })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="modal-layer" style={{ zIndex: 500 + layer * 10, background: layer ? 'transparent' : undefined }}>
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width,
          left: pos?.x ?? -9999,
          top: pos?.y ?? -9999,
        }}
      >
        <div className="dialog-title" onPointerDown={drag}>
          <span className="t">{title}</span>
          <button className="x" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`check ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Radio<T extends string>({
  name,
  value,
  current,
  label,
  onChange,
  disabled,
}: {
  name: string
  value: T
  current: T
  label: ReactNode
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <label className={`radio ${disabled ? 'disabled' : ''}`}>
      <input type="radio" name={name} value={value} checked={current === value} disabled={disabled} onChange={() => onChange(value)} />
      <span>{label}</span>
    </label>
  )
}

export function GroupBox({ title, children, style }: { title: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="group-box" style={style}>
      <span className="gb-title">{title}</span>
      {children}
    </div>
  )
}

export interface MenuEntry {
  label: string
  onClick?: () => void
  disabled?: boolean
  shortcut?: string
}

/** Floating context menu at a screen position. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: (MenuEntry | 'sep')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [p, setP] = useState({ x, y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setP({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) })
  }, [x, y])
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  return (
    <div className="menu-pop ctx" ref={ref} style={{ left: p.x, top: p.y }} role="menu">
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className="menu-item"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onClick?.()
            }}
          >
            <span className="check" />
            <span className="label">{it.label}</span>
            {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  )
}

