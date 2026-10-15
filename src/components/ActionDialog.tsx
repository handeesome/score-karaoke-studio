import { useEffect, useId, useRef } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'

export type DialogAction = { label: string; onClick: () => void; danger?: boolean }
export type ActionNotice = {
  title: string
  description: string
  tone?: 'info' | 'warning' | 'error'
  details?: string
  primary?: DialogAction
  secondary?: DialogAction
  closeLabel?: string
}

/** Keep the explanation, consequence and next action together. Opening this dialog never changes the project. */
export default function ActionDialog({ notice, onClose }: { notice: ActionNotice; onClose: () => void }) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = panel.current!
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [href], input:not(:disabled), [tabindex="0"]')]
    // Start with the safe option so Enter cannot accidentally clear existing work.
    const focus = window.setTimeout(() => dialog.querySelector<HTMLElement>('[data-safe-action]')?.focus(), 0)
    const key = (event: KeyboardEvent) => {
      if ([...document.querySelectorAll('.action-dialog')].pop() !== dialog) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return }
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault(); first?.focus()
        }
      }
    }
    document.addEventListener('keydown', key, true)
    return () => {
      clearTimeout(focus)
      document.removeEventListener('keydown', key, true)
      if (previous?.isConnected) {
        const closedMenu = previous.closest('details:not([open])')
        if (closedMenu) closedMenu.querySelector('summary')?.focus()
        else previous.focus()
      }
    }
  }, [notice.title])
  const run = (action: DialogAction) => { onClose(); action.onClick() }
  return <div className="modal-backdrop action-backdrop">
    <div ref={panel} className={`action-dialog action-${notice.tone || 'warning'}`} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
      <div className="action-heading"><span className="action-symbol">{notice.tone === 'info' ? <Info size={26}/> : <AlertTriangle size={26}/>}</span><span>{notice.tone === 'error' ? '操作未完成' : notice.primary?.danger ? '请确认影响' : notice.tone === 'info' ? '下一步' : '需要先处理'}</span><button className="action-close" aria-label="关闭提示" onClick={onClose}><X size={24}/></button></div>
      <h2 id={`${id}-title`}>{notice.title}</h2>
      <p id={`${id}-description`}>{notice.description}</p>
      {notice.details && <details className="action-details"><summary>查看详细原因</summary><p>{notice.details}</p></details>}
      <div className="action-buttons">
        <button data-safe-action className="button button-secondary" onClick={onClose}>{notice.closeLabel || (notice.primary ? '暂不处理' : '返回继续操作')}</button>
        {notice.secondary && <button className="button button-secondary" onClick={() => run(notice.secondary!)}>{notice.secondary.label}</button>}
        {notice.primary && <button className={`button ${notice.primary.danger ? 'action-danger' : 'button-primary'}`} onClick={() => run(notice.primary!)}>{notice.primary.label}</button>}
      </div>
    </div>
  </div>
}
