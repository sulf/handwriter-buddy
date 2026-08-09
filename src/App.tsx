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
import { importSvg, type SvgObject } from './svgobjects'
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
  const [objects, setObjects] = useState<SvgObject[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ mode: 'text' | 'move' | 'scale' | 'rotate'; id?: string; dx?: number; dy?: number } | null>(null)

  useEffect(() => {
    window.hwb?.onUpdateReady((v) => setUpdateVersion(v))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
        setObjects((os) => os.filter((o) => o.id !== selectedId))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

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

  const toMM = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect()
    return [
      ((e.clientX - rect.left) / rect.width) * BED,
      BED - ((e.clientY - rect.top) / rect.height) * BED,
    ]
  }

  const placeOrigin = (e: React.PointerEvent<SVGSVGElement>) => {
    const [mmX, mmY] = toMM(e)
    const snap = (v: number) => Math.min(BED, Math.max(0, Math.round(v * 2) / 2))
    setPlotSettings({ ...plotSettings, originX: snap(mmX), originY: snap(mmY) })
  }

  const updateObj = (id: string, patch: Partial<SvgObject>) =>
    setObjects((os) => os.map((o) => (o.id === id ? { ...o, ...patch } : o)))

  const onBedDown = (e: React.PointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // synthetic pointers can't be captured
    }
    const t = (e.target as Element).closest?.('[data-obj], [data-handle]')
    if (t) {
      const id = t.getAttribute('data-obj') ?? t.getAttribute('data-handle-for')!
      const obj = objects.find((o) => o.id === id)
      if (!obj) return
      setSelectedId(id)
      const handle = t.getAttribute('data-handle')
      const [mmX, mmY] = toMM(e)
      if (handle === 'scale') drag.current = { mode: 'scale', id }
      else if (handle === 'rotate') drag.current = { mode: 'rotate', id }
      else drag.current = { mode: 'move', id, dx: obj.cx - mmX, dy: obj.cy - mmY }
      return
    }
    setSelectedId(null)
    drag.current = { mode: 'text' }
    placeOrigin(e)
  }

  const onBedMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    if (d.mode === 'text') {
      placeOrigin(e)
      return
    }
    const obj = objects.find((o) => o.id === d.id)
    if (!obj) return
    const [mmX, mmY] = toMM(e)
    if (d.mode === 'move') {
      updateObj(obj.id, { cx: mmX + (d.dx ?? 0), cy: mmY + (d.dy ?? 0) })
    } else if (d.mode === 'scale') {
      const dist = Math.hypot(mmX - obj.cx, mmY - obj.cy)
      const cornerLen = Math.hypot(0.5, obj.aspect / 2)
      updateObj(obj.id, { wMM: Math.max(4, Math.min(BED * 1.5, dist / cornerLen)) })
    } else if (d.mode === 'rotate') {
      // handle sits above the drawing; pointer angle relative to center
      const ang = (Math.atan2(mmX - obj.cx, mmY - obj.cy) * 180) / Math.PI
      updateObj(obj.id, { rot: Math.round(ang) })
    }
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
            onPointerDown={onBedDown}
            onPointerMove={onBedMove}
            onPointerUp={() => {
              drag.current = null
            }}
          >
            <rect width={BED_PX} height={BED_PX} rx="8" className="card-paper" />
            <g className="bed-grid">{gridLines}</g>
            <g className="bed-origin" transform={`translate(${textPx.x}, ${textPx.y})`}>
              <line x1="-10" y1="0" x2="10" y2="0" />
              <line x1="0" y1="-10" x2="0" y2="10" />
            </g>
            {objects.map((o) => {
              const sel = o.id === selectedId
              return (
                <g
                  key={o.id}
                  data-obj={o.id}
                  className={`bed-obj ${sel ? 'bed-obj--sel' : ''}`}
                  transform={`translate(${o.cx * K}, ${(BED - o.cy) * K}) rotate(${o.rot}) scale(${o.wMM * K})`}
                >
                  <rect
                    x={-0.5}
                    y={-o.aspect / 2}
                    width={1}
                    height={o.aspect}
                    className="bed-obj-hit"
                  />
                  {o.polylines.map((line, i) => (
                    <path
                      key={i}
                      d={`M${line.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(' L')}`}
                      fill="none"
                      stroke={INK}
                      strokeWidth={PEN_WIDTH / (o.wMM * K)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {sel && (
                    <rect
                      x={-0.5}
                      y={-o.aspect / 2}
                      width={1}
                      height={o.aspect}
                      className="bed-obj-box"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </g>
              )
            })}
            {(() => {
              const o = objects.find((x) => x.id === selectedId)
              if (!o) return null
              const rad = (o.rot * Math.PI) / 180
              const c = Math.cos(rad)
              const s = Math.sin(rad)
              const px = (lx: number, ly: number) => ({
                x: (o.cx + (lx * c - ly * s) * o.wMM) * K,
                y: (BED - o.cy + (lx * s + ly * c) * o.wMM) * K,
              })
              const corner = px(0.5, o.aspect / 2)
              const top = px(0, -o.aspect / 2)
              const center = { x: o.cx * K, y: (BED - o.cy) * K }
              const dl = Math.hypot(top.x - center.x, top.y - center.y) || 1
              const rotp = {
                x: top.x + ((top.x - center.x) / dl) * 22,
                y: top.y + ((top.y - center.y) / dl) * 22,
              }
              return (
                <g className="bed-handles">
                  <line x1={top.x} y1={top.y} x2={rotp.x} y2={rotp.y} />
                  <circle data-handle="rotate" data-handle-for={o.id} cx={rotp.x} cy={rotp.y} r="7" />
                  <rect data-handle="scale" data-handle-for={o.id} x={corner.x - 6} y={corner.y - 6} width="12" height="12" />
                </g>
              )
            })()}
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

        <div className="drawings">
          <div className="pl-group-head">
            <span className="field-title">drawings</span>
            <button className="guide-link" onClick={() => fileRef.current?.click()}>
              + add SVG
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".svg,image/svg+xml"
            multiple
            hidden
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              for (const f of files) {
                try {
                  const obj = await importSvg(f)
                  setObjects((os) => [...os, obj])
                  setSelectedId(obj.id)
                } catch (err) {
                  alert(`Couldn't import ${f.name}: ${err instanceof Error ? err.message : err}`)
                }
              }
            }}
          />
          {objects.length > 0 && (
            <ul className="obj-list">
              {objects.map((o) => (
                <li key={o.id} className={o.id === selectedId ? 'obj-row obj-row--sel' : 'obj-row'}>
                  <button className="obj-name" onClick={() => setSelectedId(o.id)} title={o.name}>
                    {o.name}
                  </button>
                  <span className="obj-dims">{o.wMM.toFixed(0)}×{(o.wMM * o.aspect).toFixed(0)}mm</span>
                  <button
                    className="obj-del"
                    aria-label={`remove ${o.name}`}
                    onClick={() => {
                      setObjects((os) => os.filter((x) => x.id !== o.id))
                      if (selectedId === o.id) setSelectedId(null)
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <PlotterPanel
          layout={layout}
          settings={plotSettings}
          onSettings={setPlotSettings}
          statusSlot={statusSlot}
          objects={objects}
        />
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
