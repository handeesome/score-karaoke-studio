import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileVideo2, LoaderCircle, X } from 'lucide-react'
import type { ExportSettings } from '../types'
import { formatTime } from '../utils'

type Report = { valid: boolean; errors: string[]; warnings: string[] } | null
type Job = { status: string; progress: number; error?: string; downloadUrl?: string | null } | null

const presets: { id: ExportSettings['preset']; name: string; width: number; height: number }[] = [
  { id: 'landscape', name: 'YouTube / 投影 · 16:9', width: 1920, height: 1080 },
  { id: 'portrait', name: '手机竖屏 · 9:16', width: 1080, height: 1920 },
  { id: 'social', name: '社交竖屏 · 4:5', width: 1080, height: 1350 },
  { id: 'square', name: '方形 · 1:1', width: 1080, height: 1080 },
  { id: 'custom', name: '自定义', width: 1280, height: 720 },
]

export default function ExportDialog(props: {
  settings: ExportSettings
  previewUrl: string | null
  previewTime: number
  duration: number
  validation: Report
  job: Job
  busy: boolean
  onSettings: (settings: ExportSettings) => void
  onPreviewTime: (time: number) => void
  onExport: () => void
  onClose: () => void
}) {
  const { settings, previewUrl, previewTime, duration, validation, job, busy, onSettings, onPreviewTime, onExport, onClose } = props
  const standardZooms = [1, 0.9, 1.1, 1.2]
  const [customZoom, setCustomZoom] = useState(() => !standardZooms.includes(settings.scoreZoom))
  const setPreset = (preset: ExportSettings['preset']) => {
    const item = presets.find(candidate => candidate.id === preset)!
    onSettings({ ...settings, preset, width: item.width, height: item.height })
  }
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <header className="export-dialog-header"><div className="export-title-icon"><FileVideo2 size={18}/></div><div><h2 id="export-title">导出歌谱视频</h2><p>预览当前乐句在所选画幅中的效果</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18}/></button></header>
      <div className="export-dialog-body">
        <div className="export-preview-column"><div className="export-preview-label"><span>导出预览</span><span>{settings.width} × {settings.height} · 30 FPS</span></div><div className="export-preview-stage"><div className="export-preview-frame" style={{ aspectRatio: `${settings.width}/${settings.height}` }}>{previewUrl ? <img src={previewUrl} alt="导出画面预览"/> : <div className="preview-loading"><LoaderCircle size={18}/>生成预览中</div>}</div></div><div className="preview-time-row"><span>预览时间</span><strong>{formatTime(previewTime)}</strong></div><input className="preview-time-slider" aria-label="预览时间" type="range" min="0" max={Math.max(.01, duration)} step="0.01" value={Math.min(previewTime, duration || 0)} onChange={event => onPreviewTime(Number(event.target.value))}/></div>
        <div className="export-options-column"><label className="export-field"><span>画面比例</span><select value={settings.preset} onChange={event => setPreset(event.target.value as ExportSettings['preset'])}>{presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{settings.preset === 'custom' && <div className="export-dimensions"><label><span>宽度</span><input type="number" min="320" max="3840" step="2" value={settings.width} onChange={event => onSettings({ ...settings, width: Number(event.target.value) })}/></label><span>×</span><label><span>高度</span><input type="number" min="320" max="3840" step="2" value={settings.height} onChange={event => onSettings({ ...settings, height: Number(event.target.value) })}/></label></div>}<label className="export-field"><span>乐谱缩放</span><select value={customZoom ? 'custom' : String(settings.scoreZoom)} onChange={event => { if (event.target.value === 'custom') setCustomZoom(true); else { setCustomZoom(false); onSettings({ ...settings, scoreZoom: Number(event.target.value) }) } }}><option value="1">适合宽度 · 100%</option><option value="0.9">90%</option><option value="1.1">110%</option><option value="1.2">120%</option><option value="custom">自定义</option></select></label>{customZoom && <label className="export-field custom-zoom-field"><span>缩放比例 · {Math.round(settings.scoreZoom * 100)}%</span><input type="number" min="0.5" max="1.5" step="0.05" value={settings.scoreZoom} onChange={event => onSettings({ ...settings, scoreZoom: Number(event.target.value) })}/></label>}<div className="export-field"><span>编码与音频</span><div className="export-fixed-value">H.264 / AAC · 30 FPS</div></div>
          {validation && <div className={`validation-card ${validation.valid ? 'validation-ok' : 'validation-error'}`}><div className="validation-title">{validation.valid ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>}<strong>{validation.valid ? '可以导出视频' : '请先修正标注'}</strong></div>{validation.errors.map((item, i) => <p key={`e${i}`} className="validation-error-text">{item}</p>)}{validation.warnings.map((item, i) => <p key={`w${i}`} className="validation-warning-text">{item}</p>)}{validation.valid && !validation.warnings.length && <p>乐谱、音频、时间范围与标注坐标均通过检查。</p>}</div>}
          {job && <div className={`job-card ${job.status === 'failed' ? 'job-failed' : ''}`}><div className="job-card-heading"><span>{job.status === 'completed' ? '导出完成' : job.status === 'failed' ? '导出失败' : '正在渲染帧并编码'}</span><strong>{Math.round(job.progress * 100)}%</strong></div><div className="job-progress"><i style={{ width: `${Math.round(job.progress * 100)}%` }}/></div>{job.error && <p>{job.error}</p>}</div>}
        </div>
      </div>
      <footer className="export-dialog-footer"><span className="export-duration">成片时长约 {formatTime(duration)}</span><div><button className="button button-quiet" onClick={onClose}>关闭</button>{job?.status === 'completed' ? <a className="button button-primary export-download" href={job.downloadUrl || '#'}><Download size={15}/>下载 MP4</a> : <button className="button button-primary" disabled={busy || !validation?.valid} onClick={onExport}>{busy && <LoaderCircle className="spin" size={15}/>}生成 MP4</button>}</div></footer>
    </section>
  </div>
}
