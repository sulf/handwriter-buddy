import fontData from './hershey-fonts.json'

export interface HersheyChar {
  d: string
  o: number
}

export interface HersheyFont {
  name: string
  chars: (HersheyChar | null)[]
}

export type FontKey = 'cursive' | 'scriptc' | 'futural' | 'casual'

/** How much a hand deviates from the ideal glyphs, in font units / degrees. */
export interface Humanize {
  /** smooth per-point wobble along each stroke */
  jitter: number
  /** max per-glyph tilt, degrees */
  rotate: number
  /** max per-glyph size variation, fraction */
  scaleVar: number
  /** max per-glyph baseline drift */
  baselineVar: number
}

export interface FontDef {
  label: string
  font: HersheyFont
  advanceMult: number
  /** Connect letters at their entry/exit tails (cursive hands only). */
  join: boolean
  humanize?: Humanize
}

// Script glyphs need wider advances than hersheytext's 1.68 default —
// at 1.68 the exit stroke of one letter collides with the next letter's
// entry loop (e.g. "ma" reads as a double bubble). 1.8 keeps letters
// distinct while their connecting tails still meet.
const fonts = fontData as Record<string, HersheyFont>
export const FONTS: Record<FontKey, FontDef> = {
  cursive: { label: 'Cursive', font: fonts.cursive, advanceMult: 1.8, join: true },
  scriptc: { label: 'Formal script', font: fonts.scriptc, advanceMult: 1.8, join: true },
  casual: {
    label: 'Casual print',
    font: fonts.futural,
    advanceMult: 1.72,
    join: false,
    humanize: { jitter: 0.5, rotate: 1.6, scaleVar: 0.04, baselineVar: 1.0 },
  },
  futural: { label: 'Neat print', font: fonts.futural, advanceMult: 1.68, join: false },
}

// Hershey font metrics (font units): baseline sits at y=22, caps start at ~1,
// descenders reach ~34. The `o` field times 1.68 gives the advance width.
export const BASELINE = 22
export const CAP_HEIGHT = 21
export const LINE_HEIGHT = 42
export const ADVANCE_MULT = 1.68
export const SPACE_WIDTH = 14

/** One continuous pen stroke, in glyph-local font units. */
export interface Stroke {
  d: string
}

/** A positioned glyph: translate by (x, y) in font units before drawing strokes. */
export interface PlacedGlyph {
  char: string
  x: number
  y: number
  strokes: Stroke[]
  /** True when a word gap (space / line break) precedes this glyph. */
  afterGap: boolean
}

export interface TextLayout {
  glyphs: PlacedGlyph[]
  /** Total laid-out size in font units. */
  width: number
  height: number
  lineCount: number
}

function glyphFor(font: HersheyFont, ch: string): HersheyChar | null {
  const idx = ch.charCodeAt(0) - 33
  if (idx < 0 || idx >= font.chars.length) return null
  return font.chars[idx] ?? null
}

/** Split a Hershey path into individual pen strokes (one per `M` command). */
function splitStrokes(d: string): Stroke[] {
  return d
    .split('M')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ d: `M${s}` }))
}

// Cursive strokes join along a connector band just above the baseline.
const JOIN_Y_LO = 15
const JOIN_Y_HI = 21

/**
 * Hershey glyphs encode pen retraces as separate subpaths (a cursive 'w' pauses
 * before each upstroke). A real hand doesn't lift there — it retraces. Merge
 * subpaths whose gap is small, drawing the connecting upstroke; big gaps (i-dots,
 * t-crossbars, ≥ ~9.5 units) are genuine pen lifts and stay separate.
 */
function mergeStrokes(strokes: Stroke[], maxGap: number): Stroke[] {
  if (maxGap <= 0) return strokes
  const out: Stroke[] = []
  for (const s of strokes) {
    const prev = out[out.length - 1]
    if (prev) {
      const a = strokePoints(prev.d)
      const b = strokePoints(s.d)
      if (a.length >= 2 && b.length >= 2) {
        const gap = Math.hypot(b[0] - a[a.length - 2], b[1] - a[a.length - 1])
        if (gap <= maxGap) {
          // continue the polyline through the retrace: "M…L…" + points
          prev.d = `${prev.d} ${s.d.slice(1).replace(' L', ' ')}`
          continue
        }
      }
    }
    out.push({ d: s.d })
  }
  return out
}

interface GlyphMetrics {
  strokes: Stroke[]
  o: number
  /** Rightmost stroke endpoint inside the connector band — the exit tail tip. */
  exitX: number | null
  /** Leftmost path point inside the connector band — where a join can land. */
  connectX: number | null
  /** Rightmost point of the whole glyph. */
  maxX: number
}

const metricsCache = new WeakMap<HersheyFont, Map<string, GlyphMetrics | null>>()

function metricsFor(font: HersheyFont, ch: string, mergeGap: number): GlyphMetrics | null {
  let cache = metricsCache.get(font)
  if (!cache) {
    cache = new Map()
    metricsCache.set(font, cache)
  }
  const key = `${mergeGap}:${ch}`
  if (cache.has(key)) return cache.get(key)!

  const g = glyphFor(font, ch)
  let m: GlyphMetrics | null = null
  if (g && g.d) {
    const strokes = mergeStrokes(splitStrokes(g.d), mergeGap)
    let exitX: number | null = null
    let connectX: number | null = null
    let maxX = -Infinity
    for (const s of strokes) {
      const nums = (s.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
      for (let i = 0; i < nums.length - 1; i += 2) {
        const x = nums[i]
        const y = nums[i + 1]
        if (x > maxX) maxX = x
        if (y < JOIN_Y_LO || y > JOIN_Y_HI) continue
        if (connectX === null || x < connectX) connectX = x
        const isEndpoint = i === 0 || i === nums.length - 2
        if (isEndpoint && (exitX === null || x > exitX)) exitX = x
      }
    }
    m = { strokes, o: g.o, exitX, connectX, maxX }
  }
  cache.set(key, m)
  return m
}

/** Small deterministic PRNG so a glyph always wobbles the same way at the same spot. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function strokePoints(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
}

/**
 * Make ideal plotter glyphs look hand-printed: tilt/scale/drift the whole
 * glyph a little, subdivide long straight segments, and add smooth wobble
 * along the pen path. Seeded per glyph position, so layouts are stable.
 */
function humanizeStrokes(strokes: Stroke[], seed: number, h: Humanize): Stroke[] {
  const rnd = mulberry32(seed)
  const rot = ((rnd() * 2 - 1) * h.rotate * Math.PI) / 180
  const scale = 1 + (rnd() * 2 - 1) * h.scaleVar
  const dy0 = (rnd() * 2 - 1) * h.baselineVar
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)

  // glyph bbox center, so tilt/scale pivot around the letter itself
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const s of strokes) {
    const n = strokePoints(s.d)
    for (let i = 0; i < n.length - 1; i += 2) {
      minX = Math.min(minX, n[i]); maxX = Math.max(maxX, n[i])
      minY = Math.min(minY, n[i + 1]); maxY = Math.max(maxY, n[i + 1])
    }
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  let jx = 0, jy = 0
  return strokes.map((s) => {
    const n = strokePoints(s.d)
    // subdivide segments longer than ~4 units so straight stems can bow
    const pts: number[][] = []
    for (let i = 0; i < n.length - 1; i += 2) {
      const p: number[] = [n[i], n[i + 1]]
      if (pts.length > 0) {
        const q = pts[pts.length - 1]
        const steps = Math.floor(Math.hypot(p[0] - q[0], p[1] - q[1]) / 4)
        for (let k = 1; k <= steps; k++) {
          const t = k / (steps + 1)
          pts.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t])
        }
      }
      pts.push(p)
    }
    if (pts.length === 1) pts.push([pts[0][0] + 0.01, pts[0][1]])
    const out = pts.map(([x, y]) => {
      jx = jx * 0.6 + (rnd() * 2 - 1) * h.jitter * 0.7
      jy = jy * 0.6 + (rnd() * 2 - 1) * h.jitter * 0.7
      const dx = (x - cx) * scale
      const dy = (y - cy) * scale
      const rx = cx + dx * cos - dy * sin + jx
      const ry = cy + dy0 + dx * sin + dy * cos + jy
      return `${rx.toFixed(2)},${ry.toFixed(2)}`
    })
    return { d: `M${out[0]} L${out.slice(1).join(' ')}` }
  })
}

/** Letters chain into a following lowercase letter; anything else breaks the join. */
function chains(prev: string, cur: string): boolean {
  return /[a-zA-Z]/.test(prev) && /[a-z]/.test(cur)
}

interface WordLayout {
  glyphs: { char: string; relX: number; strokes: Stroke[] }[]
  width: number
}

/**
 * Lay out one word with connected cursive joins: each letter is placed so the
 * previous letter's exit tail meets its leftmost connector-band point. Pairs
 * that can't join (capitals without tails, digits, punctuation) fall back to
 * the font's advance width.
 */
function layoutWord(font: HersheyFont, word: string, mult: number, join: boolean): WordLayout {
  const glyphs: WordLayout['glyphs'] = []
  let x = 0
  let prev: { char: string; relX: number; m: GlyphMetrics } | null = null
  // script hands retrace instead of lifting; print hands keep their real lifts
  const mergeGap = join ? 8 : 0

  for (const ch of word) {
    const m = metricsFor(font, ch, mergeGap)
    if (!m) {
      x += SPACE_WIDTH
      prev = null
      continue
    }
    // Join only when the previous glyph's exit endpoint really is its right
    // edge — capitals like T or S have crossbars/flourishes overhanging a
    // left-of-center stem bottom, and joining there would mash the letters.
    let relX = x
    if (
      join &&
      prev &&
      chains(prev.char, ch) &&
      prev.m.exitX !== null &&
      prev.m.exitX >= prev.m.maxX - 3 &&
      m.connectX !== null
    ) {
      relX = Math.max(prev.relX + 4, prev.relX + prev.m.exitX - m.connectX)
    }
    glyphs.push({ char: ch, relX, strokes: m.strokes })
    x = relX + m.o * mult
    prev = { char: ch, relX, m }
  }
  return { glyphs, width: x }
}

/**
 * Lay text out into positioned glyphs, word-wrapping to `maxWidth` (font units).
 * Explicit newlines are honored.
 */
export function layoutText(
  text: string,
  def: FontDef,
  maxWidth: number,
  lineHeightMult = 1,
): TextLayout {
  const { font, advanceMult, humanize, join } = def
  const lineH = LINE_HEIGHT * lineHeightMult
  const glyphs: PlacedGlyph[] = []
  let y = 0
  let widest = 0
  let lineCount = 0

  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    let x = 0
    lineCount++

    // Spaces are explicit tokens so leading spaces and space runs indent
    // instead of collapsing.
    for (const token of rawLine.match(/ +|[^ ]+/g) ?? []) {
      if (token[0] === ' ') {
        x += token.length * SPACE_WIDTH
        continue
      }
      const w = layoutWord(font, token, advanceMult, join)
      if (x > 0 && x + w.width > maxWidth) {
        x = 0
        y += lineH
        lineCount++
      }
      w.glyphs.forEach((g, i) => {
        const seed = glyphs.length * 7919 + g.char.charCodeAt(0) * 131
        glyphs.push({
          char: g.char,
          x: x + g.relX,
          y,
          strokes: humanize ? humanizeStrokes(g.strokes, seed, humanize) : g.strokes,
          afterGap: i === 0,
        })
      })
      x += w.width
      widest = Math.max(widest, x)
    }
    y += lineH
  }

  return { glyphs, width: widest, height: lineCount * lineH, lineCount }
}
