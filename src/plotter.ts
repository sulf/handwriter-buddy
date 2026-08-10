import { CAP_HEIGHT, type TextLayout } from './hershey'
import { localToMM, type SvgObject } from './svgobjects'

export interface PlotSettings {
  /** capital-letter height on paper, mm — the physical size control */
  letterHMM: number
  /** top-left corner of the text on the bed, mm (Y measured from the front) */
  originX: number
  originY: number
  /** Z height while drawing (calibrate to your pen) */
  drawZ: number
  /** Z height for travel moves between strokes */
  travelZ: number
  /** drawing feed rate, mm/min */
  feedDraw: number
  /** travel feed rate, mm/min */
  feedTravel: number
  /** home all axes before plotting */
  homeFirst: boolean
  /** keep the pen at travel height for a dry run */
  dryRun: boolean
  /** line height multiplier for the text layout */
  lineHeight: number
}

export const DEFAULT_PLOT: PlotSettings = {
  letterHMM: 5,
  originX: 30,
  originY: 140,
  drawZ: 0.5,
  travelZ: 4,
  feedDraw: 2400,
  feedTravel: 6000,
  // A1 homing presses the toolhead down to find the bed — with a pen mounted
  // that shoves the pen, so never home implicitly.
  homeFirst: false,
  dryRun: false,
  lineHeight: 1,
}

export type PrinterKind = 'a1mini' | 'ender3'

export interface PrinterProfile {
  kind: PrinterKind
  name: string
  /** square bed side, mm */
  bed: number
  /** how the printer is reached — decides which connection UI/driver to use */
  link: 'lan' | 'serial'
  defaults: Partial<PlotSettings>
}

export const PRINTERS: Record<PrinterKind, PrinterProfile> = {
  a1mini: { kind: 'a1mini', name: 'A1 Mini', bed: 180, link: 'lan', defaults: {} },
  ender3: {
    kind: 'ender3',
    name: 'Ender 3',
    bed: 220,
    link: 'serial',
    defaults: {
      originY: 180,
      // Marlin mis-places absolute moves before homing, and the Ender 3's
      // fixed Z endstop makes homing pen-safe — so home by default.
      homeFirst: true,
      feedDraw: 1800,
      feedTravel: 4800,
    },
  },
}

export const defaultSettings = (kind: PrinterKind): PlotSettings => ({ ...DEFAULT_PLOT, ...PRINTERS[kind].defaults })

export interface PlotterCreds {
  ip: string
  accessCode: string
  serial: string
}

export const LS_KEY = 'hwb-plotter'

export interface StoredState {
  printer: PrinterKind
  creds: PlotterCreds
  settings: Record<PrinterKind, PlotSettings>
}

/** Load persisted printer choice, credentials, and per-printer plot settings. */
export function loadStored(): StoredState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      // pre-Ender-3 versions stored a single settings object — it was the A1's
      const legacy = typeof p.settings?.letterHMM === 'number' ? p.settings : null
      return {
        printer: p.printer === 'ender3' ? 'ender3' : 'a1mini',
        creds: { ip: '', accessCode: '', serial: '', ...p.creds },
        settings: {
          a1mini: { ...defaultSettings('a1mini'), ...(legacy ?? p.settings?.a1mini) },
          ender3: { ...defaultSettings('ender3'), ...(legacy ? {} : p.settings?.ender3) },
        },
      }
    }
  } catch {
    // fall through to defaults
  }
  return {
    printer: 'a1mini',
    creds: { ip: '', accessCode: '', serial: '' },
    settings: { a1mini: defaultSettings('a1mini'), ender3: defaultSettings('ender3') },
  }
}

export function saveStored(s: StoredState) {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}

function strokePoints(d: string): [number, number][] {
  const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
  const pts: [number, number][] = []
  for (let i = 0; i < n.length - 1; i += 2) pts.push([n[i], n[i + 1]])
  return pts
}

/**
 * G-code to hover (pen raised) over the crosshair — the text's top-left
 * corner — so the paper can be aligned under it before plotting.
 */
export function gotoStartGcode(_layout: TextLayout, s: PlotSettings): { x: number; y: number; lines: string[] } {
  const x = s.originX
  const y = s.originY
  // hover a little above travel height: pen length isn't calibrated yet when
  // this is used, so leave room while still being close enough to aim by eye
  const hoverZ = s.travelZ + 6
  return {
    x,
    y,
    lines: ['G90', `G1 Z${hoverZ.toFixed(2)} F3000`, `G1 X${x.toFixed(2)} Y${y.toFixed(2)} F${s.feedTravel}`, 'M400'],
  }
}

export interface GcodeResult {
  lines: string[]
  /** plotted size on paper, mm */
  widthMM: number
  heightMM: number
  warnings: string[]
}

/**
 * Convert laid-out strokes to pen-plotter G-code, in writing order.
 * Font-unit y grows downward from the text's top edge; bed Y grows away from
 * the front, so the origin is the text's top-left and lines advance toward
 * the front of the bed.
 */
export function layoutToGcode(layout: TextLayout, s: PlotSettings, bed: number, objects: SvgObject[] = []): GcodeResult {
  const warnings: string[] = []
  const scale = s.letterHMM / CAP_HEIGHT
  const heightMM = layout.height * scale
  const drawZ = s.dryRun ? s.travelZ : s.drawZ

  const mapX = (x: number) => s.originX + x * scale
  const mapY = (y: number) => s.originY - y * scale

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const fmt = (v: number) => v.toFixed(2)

  const lines: string[] = []
  lines.push('; handwriter-buddy pen plot')
  lines.push('G90')
  if (s.homeFirst) lines.push('G28')
  lines.push(`G1 Z${fmt(s.travelZ)} F3000`)

  for (const g of layout.glyphs) {
    for (const st of g.strokes) {
      const pts = strokePoints(st.d).map(([px, py]) => {
        const X = mapX(g.x + px)
        const Y = mapY(g.y + py)
        minX = Math.min(minX, X); maxX = Math.max(maxX, X)
        minY = Math.min(minY, Y); maxY = Math.max(maxY, Y)
        return [X, Y] as [number, number]
      })
      if (pts.length === 0) continue
      lines.push(`G1 X${fmt(pts[0][0])} Y${fmt(pts[0][1])} F${s.feedTravel}`)
      lines.push(`G1 Z${fmt(drawZ)} F1200`)
      for (let i = 1; i < pts.length; i++) {
        lines.push(`G1 X${fmt(pts[i][0])} Y${fmt(pts[i][1])} F${s.feedDraw}`)
      }
      if (pts.length === 1) lines.push(`G1 X${fmt(pts[0][0] + 0.1)} Y${fmt(pts[0][1])} F${s.feedDraw}`)
      lines.push(`G1 Z${fmt(s.travelZ)} F1200`)
    }
  }

  // imported drawings, after the text, in list order
  for (const obj of objects) {
    for (const line of obj.polylines) {
      const pts = line.map((p) => {
        const [X, Y] = localToMM(obj, p)
        minX = Math.min(minX, X); maxX = Math.max(maxX, X)
        minY = Math.min(minY, Y); maxY = Math.max(maxY, Y)
        return [X, Y] as [number, number]
      })
      if (pts.length < 2) continue
      lines.push(`G1 X${fmt(pts[0][0])} Y${fmt(pts[0][1])} F${s.feedTravel}`)
      lines.push(`G1 Z${fmt(drawZ)} F1200`)
      for (let i = 1; i < pts.length; i++) {
        lines.push(`G1 X${fmt(pts[i][0])} Y${fmt(pts[i][1])} F${s.feedDraw}`)
      }
      lines.push(`G1 Z${fmt(s.travelZ)} F1200`)
    }
  }

  // finish: lift the pen well clear and center the head over the bed
  lines.push(`G1 Z${fmt(Math.min(s.travelZ + 40, 120))} F3000`)
  lines.push(`G1 X${bed / 2} Y${bed / 2} F${s.feedTravel}`)
  lines.push('M400')

  const textWidthMM = layout.width * scale
  if (layout.glyphs.length === 0 && objects.length === 0)
    warnings.push('Nothing to plot — the message is empty.')
  if (minX < 0 || minY < 0 || maxX > bed || maxY > bed) {
    warnings.push(
      `Plot exceeds the ${bed}×${bed} mm bed (X ${fmt(minX)}–${fmt(maxX)}, Y ${fmt(minY)}–${fmt(maxY)}). ` +
        'Reduce width or move the origin.',
    )
  }
  return { lines, widthMM: textWidthMM, heightMM, warnings }
}

/** What the panel needs from a printer backend — the LAN bridge and the
 *  WebSerial Marlin driver both satisfy this shape. */
export interface PlotterDriver {
  gcode(lines: string[]): Promise<unknown>
  plot(lines: string[]): Promise<unknown>
  stop(): Promise<unknown>
}

const BRIDGE = 'http://localhost:8931'

export interface BridgeState {
  connected: boolean
  ip: string | null
  serial: string | null
  error: string | null
  plot: { total: number; sent: number; aborted: boolean } | null
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BRIDGE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(String(data.error ?? `bridge error ${res.status}`))
  return data
}

export const bridge = {
  status: async (): Promise<BridgeState> => {
    const res = await fetch(`${BRIDGE}/api/status`)
    return (await res.json()) as BridgeState
  },
  connect: (ip: string, accessCode: string, serial: string) => post('/api/connect', { ip, accessCode, serial }),
  gcode: (lines: string[]) => post('/api/gcode', { lines }),
  plot: (lines: string[]) => post('/api/plot', { lines }),
  stop: () => post('/api/stop', {}),
}
