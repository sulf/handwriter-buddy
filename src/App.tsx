import { useEffect, useMemo, useRef, useState } from 'react'

declare global {
  interface Window {
    hwb?: {
      onUpdateReady: (cb: (version: string) => void) => void
      restartToUpdate: () => void
    }
  }
}
import { CAP_HEIGHT, FONTS, layoutText, type FontKey } from './hershey'
import { PlotterPanel } from './PlotterPanel'
import { BED, loadStored, type PlotSettings } from './plotter'
import './App.css'

// preview = the A1 Mini bed at true scale: 180 mm → 720 px (4 px/mm)
const K = 4
const BED_PX = BED * K
const INK = '#223a70'
const PEN_WIDTH = 2

const DEFAULT_TEXT = `Dear friend,
wish you were here! The weather
is lovely and entirely made
of vectors.
Yours, truly`

export default function App() {
  const [text, setText] = useState(DEFAULT_TEXT)
  const [fontKey, setFontKey] = useState<FontKey>('cursive')
  const [plotSettings, setPlotSettings] = useState<PlotSettings>(() => loadStored().settings)
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    window.hwb?.onUpdateReady((v) => setUpdateVersion(v))
  }, [])

  // physical mapping, identical to the G-code: origin = text top-left, mm on the bed
  const sMM = plotSettings.letterHMM / CAP_HEIGHT
  const scale = sMM * K

  // wrap where the writing would run within 10 mm of the bed's right edge
  const wrapMM = Math.max(10, BED - plotSettings.originX - 10)
  const layout = useMemo(
    () => layoutText(text, FONTS[fontKey], wrapMM / sMM, plotSettings.lineHeight),
    [text, fontKey, sMM, wrapMM, plotSettings.lineHeight],
  )
  const textPx = {
    x: plotSettings.originX * K,
    y: (BED - plotSettings.originY) * K,
  }

  const placeOrigin = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mmX = ((e.clientX - rect.left) / rect.width) * BED
    const mmY = BED - ((e.clientY - rect.top) / rect.height) * BED
    const snap = (v: number) => Math.min(BED, Math.max(0, Math.round(v * 2) / 2))
    setPlotSettings({ ...plotSettings, originX: snap(mmX), originY: snap(mmY) })
  }

  const gridLines = useMemo(() => {
    const lines = []
    for (let mm = 20; mm < BED; mm += 20) {
      lines.push(<line key={`v${mm}`} x1={mm * K} y1="0" x2={mm * K} y2={BED_PX} />)
      lines.push(<line key={`h${mm}`} x1="0" y1={mm * K} x2={BED_PX} y2={mm * K} />)
    }
    return lines
  }, [])

  return (
    <div className="app">
      <div className="drag-strip" />
      <main className="stage">
        <div className="card-wrap">
          <svg
            className="card card--aim"
            viewBox={`0 0 ${BED_PX} ${BED_PX}`}
            role="img"
            aria-label="A1 Mini bed preview — click to place the text's top-left corner"
            onPointerDown={(e) => {
              dragging.current = true
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                // synthetic pointers can't be captured; dragging still works
              }
              placeOrigin(e)
            }}
            onPointerMove={(e) => {
              if (dragging.current) placeOrigin(e)
            }}
            onPointerUp={() => {
              dragging.current = false
            }}
          >
            <rect width={BED_PX} height={BED_PX} rx="8" className="card-paper" />
            <g className="bed-grid">{gridLines}</g>
            <g className="bed-origin" transform={`translate(${textPx.x}, ${textPx.y})`}>
              <line x1="-10" y1="0" x2="10" y2="0" />
              <line x1="0" y1="-10" x2="0" y2="10" />
            </g>
            <g transform={`translate(${textPx.x}, ${textPx.y})`}>
              <g
                className="writer"
                transform={`scale(${scale})`}
                fill="none"
                stroke={INK}
                strokeWidth={PEN_WIDTH / scale}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {layout.glyphs.map((g, i) => (
                  <g key={i} data-glyph="" transform={`translate(${g.x}, ${g.y})`}>
                    {g.strokes.map((s, j) => (
                      <path key={j} d={s.d} />
                    ))}
                  </g>
                ))}
              </g>
            </g>
          </svg>
        </div>
        <div className="status-slot" ref={setStatusSlot} />
      </main>

      <aside className="side">
        <label className="field message-field">
          <span>message</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Write your message…"
            spellCheck={false}
          />
        </label>

        <div className="compose">
          <label className="field">
            <span>hand</span>
            <select value={fontKey} onChange={(e) => setFontKey(e.target.value as FontKey)}>
              {Object.entries(FONTS).map(([k, f]) => (
                <option key={k} value={k}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>size · {plotSettings.letterHMM.toFixed(1)} mm caps</span>
            <input
              type="range"
              min="1.5"
              max="14"
              step="0.5"
              value={plotSettings.letterHMM}
              onChange={(e) => setPlotSettings({ ...plotSettings, letterHMM: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>line height</span>
            <input
              type="range"
              min="0.7"
              max="2"
              step="0.05"
              value={plotSettings.lineHeight}
              onChange={(e) => setPlotSettings({ ...plotSettings, lineHeight: Number(e.target.value) })}
            />
          </label>
        </div>

        <PlotterPanel layout={layout} settings={plotSettings} onSettings={setPlotSettings} statusSlot={statusSlot} />
      </aside>

      {updateVersion && (
        <button className="update-toast" onClick={() => window.hwb?.restartToUpdate()}>
          <span className="update-dot" />
          v{updateVersion} is ready — restart to update
        </button>
      )}
    </div>
  )
}
