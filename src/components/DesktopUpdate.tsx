import { useEffect, useState } from 'react'
import { Download, LoaderCircle } from 'lucide-react'

type UpdateState = { status: string; version?: string; progress?: number; error?: string }
type UpdateApi = { check_update: () => Promise<UpdateState>; update_status: () => Promise<UpdateState>; install_update: () => Promise<UpdateState> }
declare global { interface Window { pywebview?: { api: UpdateApi } } }

export default function DesktopUpdate({ busy = false, save }: { busy?: boolean; save: () => void }) {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    let closed = false
    const check = () => { void window.pywebview?.api?.check_update?.().catch(() => undefined) }
    const poll = async () => {
      try { const next = await window.pywebview?.api?.update_status?.(); if (next && !closed) setState(next) } catch { /* Desktop may be shutting down. */ }
    }
    window.addEventListener('pywebviewready', check)
    check()
    const timer = window.setInterval(() => { void poll() }, 1000)
    const checks = window.setInterval(check, 6 * 60 * 60 * 1000)
    return () => { closed = true; window.removeEventListener('pywebviewready', check); window.clearInterval(timer); window.clearInterval(checks) }
  }, [])
  if (!['available', 'downloading', 'installing', 'error'].includes(state.status)) return null
  const working = ['downloading', 'installing'].includes(state.status)
  const install = async () => {
    try { save(); const next = await window.pywebview?.api?.install_update?.(); if (next) setState(next) }
    catch { setState(previous => ({ ...previous, status: 'error', error: '无法启动更新，请重试。' })) }
  }
  return <div className="desktop-update">
    <button className="button button-secondary compact" disabled={working || busy} onClick={() => void install()}
      title={busy ? '请等待当前处理完成后再更新' : `更新到 v${state.version}，完成后自动重新打开软件`}>
      {working ? <LoaderCircle size={14} className="spin"/> : <Download size={14}/>}
      {state.status === 'downloading' ? `下载更新 ${state.progress || 0}%` : state.status === 'installing' ? '正在重启' : state.status === 'error' ? '重试更新' : `更新 v${state.version}`}
    </button>
    {state.error && <span className="desktop-update-error" role="alert">{state.error}</span>}
    {working && <div className="modal-backdrop"><div className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <LoaderCircle className="spin" size={24}/><h2 id="update-title">{state.status === 'installing' ? '正在安装更新' : `正在下载更新 ${state.progress || 0}%`}</h2>
      <p>完成后会自动重新打开软件。模型和当前标注会保留。</p>
    </div></div>}
  </div>
}
