import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileVideo2, LoaderCircle, X } from 'lucide-react'
import type { ExportSettings } from '../types'
import { formatTime } from '../utils'
import ActionDialog, { type ActionNotice } from './ActionDialog'

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
  validationError: string | null
  previewError: boolean
  onRetryPreview: () => void
  onRecheck: () => void
  onFix: (error: string) => void
  onSettings: (settings: ExportSettings) => void
  onPreviewTime: (time: number) => void
  onExport: () => void
  onClose: () => void
}) {
  const { settings, previewUrl, previewTime, duration, validation, job, busy, validationError, previewError, onRetryPreview, onRecheck, onFix, onSettings, onPreviewTime, onExport, onClose } = props
  const standardZooms = [1, 0.9, 1.1, 1.2]
  const [customZoom, setCustomZoom] = useState(() => !standardZooms.includes(settings.scoreZoom))
  const [notice, setNotice] = useState<ActionNotice | null>(null)
  const settingsError = ![settings.width, settings.height].every(n => Number.isInteger(n) && n >= 320 && n <= 3840 && n % 2 === 0)
    ? '画面宽度和高度需要是 320 到 3840 之间的偶数。' : !Number.isFinite(settings.scoreZoom) || settings.scoreZoom < .5 || settings.scoreZoom > 1.5 ? '乐谱缩放比例需要在 0.5 到 1.5 之间。' : null
  const fixLabel = (error: string) => error.includes('音频') ? '重新选择音频' : error.includes('导入乐谱') ? '选择歌谱' : error.includes('至少添加') ? '去划分歌词' : '去修改这条乐句'
  const generate = () => {
    if (settingsError) { setNotice({ title: '先调整画面设置', description: settingsError, primary: { label: '使用推荐画面设置', onClick: () => { onSettings({ ...settings, preset: 'landscape', width: 1920, height: 1080, scoreZoom: 1 }); setCustomZoom(false) } } }); return }
    if (validationError) { setNotice({ title: '先重新检查，再生成视频', description: '上次检查或启动生成没有成功，可以重试检查。', tone: 'error', details: validationError, primary: { label: '重新检查', onClick: onRecheck } }); return }
    if (!validation) { setNotice({ title: '正在检查生成视频所需的内容', description: '正在检查歌谱、音频和乐句时间。请等待检查完成；长时间没有结果时可以重新检查。', tone: 'info', primary: { label: '重新检查', onClick: onRecheck } }); return }
    if (!validation.valid) { const error = validation.errors[0] || '请检查乐句标注'; setNotice({ title: '先解决这个问题，才能生成视频', description: error, primary: { label: fixLabel(error), onClick: () => onFix(error) } }); return }
    onExport()
  }
  const setPreset = (preset: ExportSettings['preset']) => {
    const item = presets.find(candidate => candidate.id === preset)!
    onSettings({ ...settings, preset, width: item.width, height: item.height })
  }
  return <div className="modal-backdrop">
    <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <header className="export-dialog-header"><div className="export-title-icon"><FileVideo2 size={18}/></div><div><h2 id="export-title">导出歌谱视频</h2><p>预览当前乐句在所选画幅中的效果</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18}/></button></header>
      <div className="export-dialog-body">
        <div className="export-preview-column"><div className="export-preview-label"><span>导出预览</span><span>{settings.width} × {settings.height} · 30 FPS</span></div><div className="export-preview-stage"><div className="export-preview-frame" style={{ aspectRatio: `${settings.width}/${settings.height}` }}>{previewError ? <div className="feedback-panel feedback-error"><strong>画面预览没有生成成功</strong><p>可以重试预览，已有标注会保留。</p><button className="button button-secondary" onClick={onRetryPreview}>重试画面预览</button></div> : previewUrl ? <img src={previewUrl} alt="导出画面预览"/> : <div className="preview-loading"><LoaderCircle size={18}/>正在生成画面预览</div>}</div></div><div className="preview-time-row"><span>预览时间</span><strong>{formatTime(previewTime)}</strong></div><input className="preview-time-slider" aria-label="预览时间" type="range" min="0" max={Math.max(.01, duration)} step="0.01" value={Math.min(previewTime, duration || 0)} onChange={event => onPreviewTime(Number(event.target.value))}/></div>
        <div className="export-options-column"><label className="export-field"><span>画面比例</span><select value={settings.preset} onChange={event => setPreset(event.target.value as ExportSettings['preset'])}>{presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{settings.preset === 'custom' && <div className="export-dimensions"><label><span>宽度</span><input type="number" min="320" max="3840" step="2" value={settings.width} onChange={event => onSettings({ ...settings, width: Number(event.target.value) })}/></label><span>×</span><label><span>高度</span><input type="number" min="320" max="3840" step="2" value={settings.height} onChange={event => onSettings({ ...settings, height: Number(event.target.value) })}/></label></div>}<label className="export-field"><span>乐谱缩放</span><select value={customZoom ? 'custom' : String(settings.scoreZoom)} onChange={event => { if (event.target.value === 'custom') setCustomZoom(true); else { setCustomZoom(false); onSettings({ ...settings, scoreZoom: Number(event.target.value) }) } }}><option value="1">适合宽度 · 100%</option><option value="0.9">90%</option><option value="1.1">110%</option><option value="1.2">120%</option><option value="custom">自定义</option></select></label>{customZoom && <label className="export-field custom-zoom-field"><span>缩放比例 · {Math.round(settings.scoreZoom * 100)}%</span><input type="number" min="0.5" max="1.5" step="0.05" value={settings.scoreZoom} onChange={event => onSettings({ ...settings, scoreZoom: Number(event.target.value) })}/></label>}<div className="export-field"><span>编码与音频</span><div className="export-fixed-value feedback-inline">原音频直接保留 · 视频 30 帧/秒</div></div>
          {settingsError && <div className="feedback-panel feedback-error" role="alert"><strong>需要调整画面设置</strong><p>{settingsError}</p><button className="button button-secondary" onClick={() => { onSettings({ ...settings, preset: 'landscape', width: 1920, height: 1080, scoreZoom: 1 }); setCustomZoom(false) }}>使用推荐画面设置</button></div>}
          {validationError && <div className="feedback-panel feedback-error" role="alert"><strong>暂时无法生成视频</strong><p>上次检查或启动生成没有成功。</p><details><summary>查看详细原因</summary><p>{validationError}</p></details><button className="button button-primary" onClick={onRecheck}>重新检查</button></div>}
          {!validation && !validationError && !busy && <div className="feedback-panel" role="status"><strong>正在检查歌谱、音频和乐句时间…</strong><button className="button button-secondary" onClick={onRecheck}>重新检查</button></div>}
          {validation && <>
            {!validation.valid && <div className="feedback-panel feedback-error" role="alert"><strong>需要先解决 {validation.errors.length} 个问题</strong>{validation.errors.map((item, i) => <div key={i}><p>{item}</p><button className="button button-primary" onClick={() => onFix(item)}>{fixLabel(item)}</button></div>)}</div>}
            {validation.warnings.length > 0 && <div className="feedback-panel"><strong>建议检查，可以继续生成</strong><p>以下时间间隔可能是歌曲本身的安排，不会阻止生成视频。</p>{validation.warnings.map((item, i) => <p key={i}>{item}</p>)}</div>}
            {validation.valid && !validation.warnings.length && <div className="validation-card validation-ok"><div className="validation-title"><CheckCircle2 size={20}/><strong>已检查，可以生成视频</strong></div></div>}
          </>}
          {job && <div className={`job-card ${job.status === 'failed' ? 'job-failed' : ''}`}><div className="job-card-heading"><span>{job.status === 'completed' ? '导出完成' : job.status === 'failed' ? '导出失败' : '正在渲染帧并编码'}</span><strong>{Math.round(job.progress * 100)}%</strong></div><div className="job-progress"><i style={{ width: `${Math.round(job.progress * 100)}%` }}/></div>{job.error && <div className="feedback-panel feedback-error" role="alert"><strong>视频没有生成成功</strong><p>已有标注会保留。可以点击下方“重新生成视频”重试。</p><details><summary>查看详细原因</summary><p>{job.error}</p></details></div>}</div>}
        </div>
      </div>
      <footer className="export-dialog-footer"><span className="export-duration">成片时长约 {formatTime(duration)}</span><div><button className="button button-quiet" onClick={onClose}>{busy ? '返回编辑，继续生成' : '返回编辑'}</button>{job?.status === 'completed' ? <a className="button button-primary export-download" href={job.downloadUrl || '#'}><Download size={15}/>保存 MP4 视频</a> : <button className="button button-primary" disabled={busy} onClick={generate}>{busy && <LoaderCircle className="spin" size={15}/>} {busy ? '正在生成视频' : job?.status === 'failed' ? '重新生成视频' : '生成 MP4 视频'}</button>}</div></footer>
      {notice && <ActionDialog notice={notice} onClose={() => setNotice(null)}/>}
    </section>
  </div>
}
