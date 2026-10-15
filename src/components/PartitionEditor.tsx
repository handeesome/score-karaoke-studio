import { useRef, useState } from 'react'
import type { PagePartition, Segment } from '../types'
import { addCellCut, addGuide, containsPoint, moveGuide, partitionCells, type PartitionTool } from '../partitions'

type Props = { partition: PagePartition; tool: PartitionTool; blocked?: boolean; selectedLine: string | null; segments: Segment[];
  onChange: (partition: PagePartition) => void; onLine: (id: string | null) => void;
  onSegment: (id: string | null) => void; onMessage: (text: string) => void;
  onLegacyCut: (segment: Segment, event: React.PointerEvent<SVGGElement>) => void }

export default function PartitionEditor({ partition, tool, blocked, selectedLine, segments, onChange, onLine, onSegment, onMessage, onLegacyCut }: Props) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<PagePartition | null>(null)
  const drag = useRef<{ id: string; base: PagePartition; next: PagePartition; horizontal: boolean } | null>(null)
  const shown = draft || partition
  const cells = partitionCells(shown)
  const point = (event: React.PointerEvent<SVGGElement>) => {
    const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }
  }
  const begin = (event: React.PointerEvent<SVGGElement>, id?: string, horizontal = false) => {
    event.stopPropagation(); event.preventDefault()
    if (event.button !== 0) return
    const p = point(event)
    if (id) {
      onSegment(null); onLine(id)
      drag.current = { id, base: partition, next: partition, horizontal }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    const idNew = `line-${crypto.randomUUID()}`
    if (tool === 'line-h' || tool === 'line-v') {
      if (blocked) { onMessage('当前页已有标注，请先点击“重新分区”再画线'); return }
      const next = addGuide(partition, tool === 'line-h' ? 'horizontal' : 'vertical', tool === 'line-h' ? p.y : p.x, idNew)
      if (next !== partition) { onChange(next); onSegment(null); onLine(idNew) }
    } else if (tool === 'cell-cut') {
      const next = addCellCut(partition, p.x, p.y, idNew)
      if (next === partition) {
        const old = segments.find(segment => !segment.partitionKey && containsPoint(segment.region, p.x, p.y))
        if (old) onLegacyCut(old, event)
        else onMessage('请在四边闭合的分区内竖切，并避开左右边线')
      } else { onChange(next); onSegment(null); onLine(idNew) }
    } else {
      onLine(null)
      const cell = cells.find(cell => containsPoint(cell.region, p.x, p.y))
      if (cell && partition.excluded.includes(cell.key)) {
        onChange({ ...partition, excluded: partition.excluded.filter(key => key !== cell.key) })
        onMessage('该分区已恢复，可继续打点')
      } else onSegment(segments.find(segment => containsPoint(segment.region, p.x, p.y))?.id || null)
    }
  }
  const lines = [
    ...shown.horizontal.map(line => ({ ...line, horizontal: true, x1: 0, x2: 1, y1: line.position, y2: line.position })),
    ...shown.vertical.map(line => ({ ...line, horizontal: false, x1: line.position, x2: line.position, y1: 0, y2: 1 })),
    ...shown.cuts.flatMap(cut => {
      const top = shown.horizontal.find(line => line.id === cut.top), bottom = shown.horizontal.find(line => line.id === cut.bottom)
      return top && bottom ? [{ ...cut, horizontal: false, x1: cut.position, x2: cut.position, y1: top.position, y2: bottom.position }] : []
    }),
  ]
  const previewCell = hover && cells.find(cell => containsPoint(cell.region, hover.x, hover.y))
  return <g className={`partition-editor tool-${tool}`} data-testid="partition-editor" onPointerDown={event => begin(event)}
    onPointerMove={event => {
      const p = point(event); setHover(p)
      if (drag.current) {
        const next = moveGuide(drag.current.base, drag.current.id, drag.current.horizontal ? p.y : p.x)
        drag.current.next = next; setDraft(next)
      }
    }} onPointerLeave={() => setHover(null)} onPointerUp={event => {
      event.stopPropagation()
      if (drag.current) { onChange(drag.current.next); drag.current = null; setDraft(null) }
    }} onPointerCancel={event => { event.stopPropagation(); drag.current = null; setDraft(null) }}>
    <rect width="1000" height="1414" fill="transparent" className="partition-surface"/>
    {cells.filter(cell => shown.excluded.includes(cell.key)).map(cell => <g key={cell.key} className="partition-skipped" pointerEvents="none">
      <rect x={cell.region.x * 1000} y={cell.region.y * 1414} width={cell.region.width * 1000} height={cell.region.height * 1414}/>
      <text x={(cell.region.x + cell.region.width / 2) * 1000} y={(cell.region.y + cell.region.height / 2) * 1414}>已跳过</text>
    </g>)}
    {lines.map(line => <g key={line.id} data-line-id={line.id} className={`partition-guide ${selectedLine === line.id ? 'is-selected' : ''} ${line.horizontal ? 'horizontal' : 'vertical'}`}
      onPointerDown={event => begin(event, line.id, line.horizontal)}>
      <line className="partition-line" x1={line.x1 * 1000} x2={line.x2 * 1000} y1={line.y1 * 1414} y2={line.y2 * 1414}/>
      <line className="partition-hit" x1={line.x1 * 1000} x2={line.x2 * 1000} y1={line.y1 * 1414} y2={line.y2 * 1414}/>
    </g>)}
    {hover && !drag.current && tool !== 'line-edit' && <g className="partition-preview" pointerEvents="none">
      {tool === 'line-h' && <line x1="0" x2="1000" y1={hover.y * 1414} y2={hover.y * 1414}/>}
      {tool === 'line-v' && <line y1="0" y2="1414" x1={hover.x * 1000} x2={hover.x * 1000}/>}
      {tool === 'cell-cut' && previewCell && <line x1={hover.x * 1000} x2={hover.x * 1000} y1={previewCell.region.y * 1414} y2={(previewCell.region.y + previewCell.region.height) * 1414}/>}
    </g>}
  </g>
}
