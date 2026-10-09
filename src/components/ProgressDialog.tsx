import { useEffect, useState } from 'react'
import { LoaderCircle, WandSparkles } from 'lucide-react'

interface Props {
  kind: 'boxes' | 'align'
  percent: number
  stage: string
}

export default function ProgressDialog({ kind, percent, stage }: Props) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  const title = kind === 'boxes' ? '正在自动框选' : '正在自动对齐'

  return <div className="modal-backdrop">
    <div className="analysis-progress-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <div className="analysis-progress-icon"><WandSparkles size={21}/></div>
      <h2>{title}</h2>
      <strong className="analysis-progress-value">{value}%</strong>
      <div className="analysis-progress-track" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <span style={{ width: `${value}%` }}/>
      </div>
      <p aria-live="polite">{stage}</p>
      <small><LoaderCircle className="spin" size={12}/> 已运行 {elapsed} 秒</small>
    </div>
  </div>
}
