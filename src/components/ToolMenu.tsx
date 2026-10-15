import { useEffect, useRef, type ReactNode } from 'react'

export default function ToolMenu({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) menu.current?.removeAttribute('open') }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) { event.preventDefault(); event.stopImmediatePropagation(); menu.current.open = false; menu.current.querySelector('summary')?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [])
  return <details className="tool-menu" ref={menu}><summary>更多工具</summary><div className="tool-menu-items" onClick={event => {
    if ((event.target as Element).closest('button') && !(event.target as Element).closest('button:disabled')) event.currentTarget.parentElement?.removeAttribute('open')
  }}>{children}</div></details>
}
