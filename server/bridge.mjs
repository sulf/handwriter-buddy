// Local bridge between the browser app and a Bambu A1 Mini in LAN dev mode.
// Browsers can't speak MQTT-over-TLS, so this small server does:
//   browser --HTTP--> bridge --MQTT (port 8883, user bblp)--> printer
// Run with: npm run bridge   (listens on http://localhost:8931)
import http from 'node:http'
import mqtt from 'mqtt'

const PORT = 8931

let client = null
let seq = 1000
const state = {
  connected: false,
  ip: null,
  serial: null,
  error: null,
  plot: null, // { total, sent, aborted }
  lastReport: null,
  lastReportAt: null,
}

function connectPrinter({ ip, accessCode, serial }) {
  return new Promise((resolve, reject) => {
    if (client) {
      client.end(true)
      client = null
      state.connected = false
    }
    const c = mqtt.connect(`mqtts://${ip}:8883`, {
      username: 'bblp',
      password: accessCode,
      rejectUnauthorized: false, // printer uses a self-signed certificate
      connectTimeout: 6000,
      reconnectPeriod: 0,
    })
    let settled = false
    c.on('connect', () => {
      client = c
      state.connected = true
      state.ip = ip
      state.serial = serial
      state.error = null
      c.subscribe(`device/${serial}/report`)
      // ask the printer to push its full status once
      c.publish(
        `device/${serial}/request`,
        JSON.stringify({ pushing: { command: 'pushall', sequence_id: String(seq++) } }),
      )
      settled = true
      resolve()
    })
    c.on('message', (_topic, payload) => {
      try {
        state.lastReport = JSON.parse(payload.toString())
        state.lastReportAt = new Date().toISOString()
      } catch {
        // ignore non-JSON payloads
      }
    })
    c.on('error', (err) => {
      state.error = String(err?.message ?? err)
      if (!settled) {
        settled = true
        c.end(true)
        reject(new Error(state.error))
      }
    })
    c.on('close', () => {
      state.connected = false
    })
  })
}

function sendGcode(lines) {
  if (!client || !state.connected) throw new Error('Printer not connected')
  const payload = {
    print: {
      command: 'gcode_line',
      sequence_id: String(seq++),
      param: lines.join('\n') + '\n',
    },
  }
  client.publish(`device/${state.serial}/request`, JSON.stringify(payload))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Estimate how long the printer needs to execute these lines, tracking modal
 * position/feed across calls. Sending faster than execution overflows the
 * printer's command buffer and it silently DROPS lines (symptom: pen-up moves
 * vanish and travels get drawn as straight lines across the page).
 */
function estimateMs(lines, pos) {
  let t = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('G28')) {
      t += 25000
      pos.x = 0
      pos.y = 0
      pos.z = null
      continue
    }
    if (!line.startsWith('G0') && !line.startsWith('G1')) continue
    const val = (axis) => {
      const m = line.match(new RegExp(`${axis}(-?\\d+(\\.\\d+)?)`))
      return m ? Number(m[1]) : null
    }
    const f = val('F')
    if (f) pos.f = f
    const nx = val('X')
    const ny = val('Y')
    const nz = val('Z')
    let dist = 0
    if (nx !== null || ny !== null) {
      if (pos.x === null || pos.y === null) dist = 150 // unknown start: assume a long travel
      else dist = Math.hypot((nx ?? pos.x) - pos.x, (ny ?? pos.y) - pos.y)
      if (nx !== null) pos.x = nx
      if (ny !== null) pos.y = ny
    }
    if (nz !== null) {
      dist = Math.max(dist, pos.z === null ? 10 : Math.abs(nz - pos.z))
      pos.z = nz
    }
    t += (dist * 60000) / (pos.f || 3000) // mm at F mm/min → ms
  }
  return t
}

// Stream a long job in small MQTT messages, pacing each chunk to the motion
// time it actually needs so the printer's buffer never overflows.
async function runPlot(lines, chunkSize = 16) {
  state.plot = { total: lines.length, sent: 0, aborted: false }
  const pos = { x: null, y: null, z: null, f: 3000 }
  for (let i = 0; i < lines.length; i += chunkSize) {
    if (state.plot.aborted) break
    if (!state.connected) {
      state.error = 'Connection lost during plot'
      break
    }
    const chunk = lines.slice(i, i + chunkSize)
    const est = estimateMs(chunk, pos)
    chunk.push('M400')
    sendGcode(chunk)
    state.plot.sent = Math.min(lines.length, i + chunkSize)
    // 15% margin + a floor: better to trickle slowly than to drop strokes
    await sleep(Math.max(est * 1.15 + 80, 120))
  }
  const finished = state.plot
  state.plot = null
  return finished
}

function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 10_000_000) reject(new Error('body too large'))
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(e)
      }
    })
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  const url = new URL(req.url, 'http://localhost')
  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, state)
    }
    if (req.method === 'POST' && url.pathname === '/api/connect') {
      const { ip, accessCode, serial } = await readBody(req)
      if (!ip || !accessCode || !serial) return json(res, 400, { error: 'ip, accessCode, serial required' })
      await connectPrinter({ ip, accessCode, serial })
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/gcode') {
      const { lines } = await readBody(req)
      if (!Array.isArray(lines) || lines.length === 0) return json(res, 400, { error: 'lines[] required' })
      sendGcode(lines)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/plot') {
      const { lines, chunkSize } = await readBody(req)
      if (!Array.isArray(lines) || lines.length === 0) return json(res, 400, { error: 'lines[] required' })
      if (state.plot) return json(res, 409, { error: 'a plot is already running' })
      if (!state.connected) return json(res, 409, { error: 'Printer not connected' })
      runPlot(lines, chunkSize).catch((e) => {
        state.error = String(e?.message ?? e)
        state.plot = null
      })
      return json(res, 200, { ok: true, total: lines.length })
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      if (state.plot) state.plot.aborted = true
      // lift the pen so an aborted plot doesn't drag ink across the page
      if (state.connected) sendGcode(['G91', 'G1 Z10 F3000', 'G90'])
      return json(res, 200, { ok: true })
    }
    return json(res, 404, { error: 'not found' })
  } catch (e) {
    return json(res, 500, { error: String(e?.message ?? e) })
  }
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // another bridge instance is already serving :8931 — reuse it
    console.log(`plotter bridge already running on :${PORT}, reusing it`)
  } else {
    throw e
  }
})
server.listen(PORT, () => {
  console.log(`plotter bridge listening on http://localhost:${PORT}`)
})
