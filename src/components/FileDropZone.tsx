import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'

export default function FileDropZone({ children, disabled, onFiles }: {
  children: ReactNode
  disabled: boolean
  onFiles: (files: File[]) => void
}) {
  const [dragging, setDragging] = useState(false)
  const latest = useRef({ disabled, onFiles })
  latest.current = { disabled, onFiles }
  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files')
    const blocked = () => latest.current.disabled || Boolean(document.querySelector('[aria-modal="true"]'))
    const reset = () => { depth = 0; setDragging(false) }
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth++
      if (!blocked()) setDragging(true)
    }
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = blocked() ? 'none' : 'copy'
    }
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      reset()
      if (!blocked()) latest.current.onFiles(Array.from(event.dataTransfer?.files || []))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('blur', reset)
    }
  }, [])
  return <>{children}{dragging && !disabled && <div className="file-drop-overlay" role="status">
    <div><Upload size={36}/><strong>松开鼠标，添加文件</strong><span>支持 PDF、歌谱图片和一份音频</span><span>拖入歌谱开始新项目，沿用原音频；追加请用“更多歌谱”</span></div>
  </div>}</>
}
