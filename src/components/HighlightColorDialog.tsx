import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

const colors = [['橙红', '#de4b2d'], ['红色', '#e53935'], ['蓝色', '#1967d2'], ['绿色', '#00875a'], ['紫色', '#8e24aa'], ['金色', '#b87900']]

export default function HighlightColorDialog({ value, onClose, onApply }: { value: string; onClose: () => void; onApply: (color: string) => void }) {
  const [color, setColor] = useState(value)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose() }
      if (event.key === 'Tab') {
        const items = [...(panel.current?.querySelectorAll<HTMLElement>('button,input') || [])]
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); previous?.focus() }
  }, [])
  return <div className="modal-backdrop"><div className="highlight-color-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby="highlight-color-title">
    <header><h2 id="highlight-color-title">高亮颜色</h2><button className="icon-button" aria-label="关闭高亮颜色" onClick={onClose}><X/></button></header>
    <div className="highlight-color-presets">{colors.map(([name, hex]) => <button className="button" key={hex} aria-pressed={color === hex} onClick={() => setColor(hex)}><i style={{ background: hex }}/>{name}</button>)}</div>
    <label className="highlight-color-custom">自定义颜色<input type="color" aria-label="自定义高亮颜色" value={color} onChange={event => setColor(event.target.value)}/><span>{color.toUpperCase()}</span></label>
    <p className="highlight-color-sample" style={{ color }}>歌词高亮预览</p>
    <footer><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" onClick={() => onApply(color)}>应用颜色</button></footer>
  </div></div>
}
