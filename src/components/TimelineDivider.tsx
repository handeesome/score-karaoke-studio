import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

const MIN_HEIGHT = 110

export default function TimelineDivider({ height, onChange }: { height: number; onChange: (height: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null)
  const [maximum, setMaximum] = useState(320)
  const [dragging, setDragging] = useState(false)

  useLayoutEffect(() => {
    const layout = ref.current?.closest<HTMLElement>('.main-layout')
    if (!layout) return
    const timeline = layout.querySelector<HTMLElement>('.timeline-panel')
    const elements = ['.segmentation-toolbar']
      .map(selector => layout.querySelector<HTMLElement>(selector)).filter((element): element is HTMLElement => Boolean(element))
    const measure = () => {
      const fixed = elements.reduce((sum, element) => sum + element.getBoundingClientRect().height, 0)
      const limit = Math.max(MIN_HEIGHT, Math.floor(Math.min(layout.clientHeight * .55, layout.clientHeight - fixed - 172)))
      layout.style.setProperty('--timeline-max-height', `${limit}px`)
      if (timeline) layout.closest<HTMLElement>('.app-shell')?.style.setProperty('--timeline-toast-bottom', `${timeline.getBoundingClientRect().height + 12}px`)
      setMaximum(limit)
    }
    const observer = new ResizeObserver(measure)
    ;[layout, ...elements].forEach(element => observer.observe(element))
    if (timeline) observer.observe(timeline)
    measure()
    return () => observer.disconnect()
  }, [])

  const clamp = (value: number) => Math.round(Math.max(MIN_HEIGHT, Math.min(maximum, value)))
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <div ref={ref} className="timeline-divider" role="separator" tabIndex={0}
    aria-label="调整时间轴高度" aria-orientation="horizontal" aria-valuemin={MIN_HEIGHT}
    aria-valuemax={maximum} aria-valuenow={clamp(height)} title="调整时间轴高度" data-dragging={dragging}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault()
      const panel = event.currentTarget.parentElement?.querySelector('.timeline-panel')
      drag.current = { pointerId: event.pointerId, y: event.clientY, height: panel?.getBoundingClientRect().height || clamp(height) }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus()
      setDragging(true)
    }} onPointerMove={event => {
      const start = drag.current
      if (start?.pointerId === event.pointerId) onChange(clamp(start.height + start.y - event.clientY))
    }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; setDragging(false) }}
    onKeyDown={event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      onChange(event.key === 'Home' ? MIN_HEIGHT : event.key === 'End' ? maximum : clamp(clamp(height) + (event.key === 'ArrowUp' ? 20 : -20)))
    }}><span aria-hidden="true"/></div>
}
