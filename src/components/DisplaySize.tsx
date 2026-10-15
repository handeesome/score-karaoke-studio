export type TextSize = 'large' | 'extra'

export default function DisplaySize({ value, onChange }: { value: TextSize; onChange: (value: TextSize) => void }) {
  return <div className="display-size-control" role="group" aria-label="界面字号">
    <button type="button" aria-pressed={value === 'large'} onClick={() => onChange('large')}>大字</button>
    <button type="button" aria-pressed={value === 'extra'} onClick={() => onChange('extra')}>更大</button>
  </div>
}
