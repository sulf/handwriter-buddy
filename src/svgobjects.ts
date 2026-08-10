
/** An imported SVG drawing placed on the bed. */
export interface SvgObject {
  id: string
  name: string
  /** polylines in local coords: centered on origin, width 1, y-down (screen-like) */
  polylines: [number, number][][]
  /** height / width of the drawing */
  aspect: number
  /** center on the bed, mm (bed Y grows away from the front) */
  cx: number
  cy: number
  /** width on paper, mm */
  wMM: number
  /** rotation in degrees, clockwise on screen */
  rot: number
}

/** Map a local point to bed mm, applying the object's transform. */
export function localToMM(obj: SvgObject, p: [number, number]): [number, number] {
  const rad = (obj.rot * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const dx = (p[0] * c - p[1] * s) * obj.wMM
  const dy = (p[0] * s + p[1] * c) * obj.wMM
  return [obj.cx + dx, obj.cy - dy]
}

const POINT_BUDGET = 4000

/**
 * Parse an SVG file into monochrome pen polylines — every stroke and shape
 * outline becomes a line for the pen; fills and colors are discarded, which
 * is exactly what plotting it would look like.
 */
export async function importSvg(file: File, bed: number): Promise<SvgObject> {
  const text = await file.text()
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.nodeName !== 'svg') throw new Error('not an SVG file')

  // must be in the live DOM (hidden) for geometry APIs to work
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden'
  host.appendChild(svg)
  document.body.appendChild(host)

  try {
    const els = Array.from(
      svg.querySelectorAll<SVGGeometryElement>('path, line, polyline, polygon, rect, circle, ellipse'),
    )
    const lengths = els.map((el) => {
      try {
        return el.getTotalLength()
      } catch {
        return 0
      }
    })
    const totalLen = lengths.reduce((a, b) => a + b, 0)
    if (totalLen === 0) throw new Error('no drawable lines found in this SVG')

    const polylines: [number, number][][] = []
    els.forEach((el, i) => {
      const len = lengths[i]
      if (len <= 0) return
      const n = Math.max(8, Math.min(1500, Math.round((POINT_BUDGET * len) / totalLen)))
      const step = len / n
      const ctm = el.getCTM()
      let line: [number, number][] = []
      let prevLocal: [number, number] | null = null
      for (let k = 0; k <= n; k++) {
        const pt = el.getPointAtLength(Math.min(len, k * step))
        // jump detection must happen in the element's local units — the
        // sampling step is a local length, and CTM scaling would otherwise
        // make every segment of a scaled group look like a pen lift
        if (prevLocal && Math.hypot(pt.x - prevLocal[0], pt.y - prevLocal[1]) > Math.max(step * 4, 0.5)) {
          if (line.length > 1) polylines.push(line)
          line = []
        }
        prevLocal = [pt.x, pt.y]
        const t = ctm ? new DOMPoint(pt.x, pt.y).matrixTransform(ctm) : pt
        line.push([t.x, t.y])
      }
      if (line.length > 1) polylines.push(line)
    })

    // normalize: center on origin, width = 1
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const line of polylines)
      for (const [x, y] of line) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
    const w = Math.max(1e-6, maxX - minX)
    const h = Math.max(1e-6, maxY - minY)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const norm = polylines.map((line) =>
      line.map(([x, y]) => [(x - cx) / w, (y - cy) / w] as [number, number]),
    )

    return {
      id: `svg-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      name: file.name.replace(/\.svg$/i, ''),
      polylines: norm,
      aspect: h / w,
      cx: bed / 2,
      cy: bed / 2,
      wMM: 60,
      rot: 0,
    }
  } finally {
    host.remove()
  }
}
