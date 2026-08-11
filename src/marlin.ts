// Web Serial driver for Marlin printers (Ender 3): plain G-code at 115200
// with ok-based flow control — the firmware answers every accepted line with
// "ok", so unlike the Bambu MQTT bridge no motion-time estimation is needed.

// --- minimal Web Serial typings (not in TS lib.dom yet) ---
interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}
interface SerialPort {
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
}
interface Serial {
  requestPort(options?: { filters: SerialPortInfo[] }): Promise<SerialPort>
}
declare global {
  interface Navigator {
    serial?: Serial
  }
}

export interface SerialState {
  supported: boolean
  connected: boolean
  port: string | null
  firmware: string | null
  error: string | null
  plot: { total: number; sent: number; aborted: boolean } | null
}

const BAUD = 115200
/**
 * Un-acked lines allowed in flight. Strictly one-at-a-time starves Marlin's
 * planner on the many short Hershey segments (visible as jerky strokes); a
 * few lines ahead keeps it fed while STOP still takes effect within ~4 moves.
 */
const WINDOW = 4
// G28 and M400 hold their "ok" until motion finishes, so be generous
const ACK_TIMEOUT = 90_000

interface Ack {
  resolve: () => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
  line: string
  timeout: number
}

const stripComment = (l: string) => l.replace(/;.*$/, '').trim()

// set localStorage['hwb-serial-debug'] = '1' to trace the wire in the console
const debugOn = () => {
  try {
    return !!localStorage.getItem('hwb-serial-debug')
  } catch {
    return false
  }
}

class MarlinSerial {
  state: SerialState = {
    supported: typeof navigator !== 'undefined' && !!navigator.serial,
    connected: false,
    port: null,
    firmware: null,
    error: null,
    plot: null,
  }

  private listeners = new Set<() => void>()
  private port: SerialPort | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private acks: Ack[] = []
  private rxRest = ''
  private enc = new TextEncoder()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.state = { ...this.state }
    for (const fn of this.listeners) fn()
  }

  /** Pick a port (must be called from a user gesture) and handshake. */
  async connect(): Promise<void> {
    if (!navigator.serial) throw new Error('Web Serial is unavailable — use Chrome or the desktop app')
    const port = await navigator.serial.requestPort().catch(() => {
      throw new Error('No port chosen')
    })
    await this.disconnect()
    await port.open({ baudRate: BAUD })
    this.port = port
    this.writer = port.writable!.getWriter()
    void this.readLoop(port.readable!)
    const info = port.getInfo()
    const hex = (n?: number) => (n ?? 0).toString(16).padStart(4, '0')
    this.state.port = info.usbVendorId ? `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}` : 'serial port'
    this.state.error = null
    this.emit()
    // opening the port toggles DTR, which resets the board; boot takes ~4-6 s
    // and swallows anything sent meanwhile — poll M115 until it answers
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    let answered = false
    for (let i = 0; i < 8 && !answered && this.port === port; i++) {
      await sleep(i === 0 ? 2500 : 1000)
      try {
        await this.writeLine('M115', 4000)
        answered = true
      } catch {
        // still booting — try again
      }
    }
    if (!answered) {
      await this.disconnect()
      throw new Error('No response from the printer — is it powered on?')
    }
    if (!this.state.firmware || !this.state.firmware.includes('·')) {
      // first reply was clipped — the link is warm now, ask again
      try {
        await this.writeLine('M115', 4000)
      } catch {
        // keep whatever we have
      }
    }
    this.state.connected = true
    this.emit()
  }

  async disconnect(): Promise<void> {
    const port = this.port
    this.port = null
    this.state.connected = false
    this.state.port = null
    this.state.firmware = null
    this.state.plot = null
    for (const a of this.acks.splice(0)) {
      clearTimeout(a.timer)
      a.reject(new Error('disconnected'))
    }
    try {
      await this.reader?.cancel()
    } catch {
      // reader may already be done
    }
    try {
      this.writer?.releaseLock()
    } catch {
      // writer may already be released
    }
    this.writer = null
    try {
      await port?.close()
    } catch {
      // port may already be gone (unplugged)
    }
    this.emit()
  }

  /** Send a handful of immediate commands (jog etc.), one ok at a time. */
  async gcode(lines: string[]): Promise<void> {
    if (!this.state.connected) throw new Error('Printer not connected')
    for (const raw of lines) {
      const line = stripComment(raw)
      if (line) await this.writeLine(line)
    }
  }

  /** Stream a long job; returns once started (progress lives in state.plot). */
  async plot(lines: string[]): Promise<void> {
    if (!this.state.connected) throw new Error('Printer not connected')
    if (this.state.plot) throw new Error('a plot is already running')
    const send = lines.map(stripComment).filter(Boolean)
    const plot = { total: send.length, sent: 0, aborted: false }
    this.state.plot = plot
    this.emit()
    void this.runPlot(send, plot)
  }

  async stop(): Promise<void> {
    if (this.state.plot) this.state.plot.aborted = true
    if (!this.state.connected) return
    // lift the pen; this queues right behind the ≤WINDOW lines still in flight
    await this.gcode(['G91', 'G1 Z10 F3000', 'G90'])
  }

  private async runPlot(lines: string[], plot: NonNullable<SerialState['plot']>): Promise<void> {
    try {
      const inflight = new Set<Promise<void>>()
      for (const line of lines) {
        if (plot.aborted || !this.state.connected) break
        while (inflight.size >= WINDOW) await Promise.race(inflight)
        const p: Promise<void> = this.writeLine(line)
          .then(() => {
            plot.sent++
            this.emit()
          })
          .finally(() => inflight.delete(p))
        inflight.add(p)
      }
      await Promise.allSettled([...inflight])
    } catch (e) {
      this.state.error = e instanceof Error ? e.message : String(e)
    } finally {
      this.state.plot = null
      this.emit()
    }
  }

  /** Write one line; resolves when the firmware acknowledges it with "ok". */
  private writeLine(line: string, timeout = ACK_TIMEOUT): Promise<void> {
    const writer = this.writer
    if (!writer) return Promise.reject(new Error('Printer not connected'))
    const ack = new Promise<void>((resolve, reject) => {
      const entry: Ack = { resolve, reject, line, timeout, timer: 0 as unknown as ReturnType<typeof setTimeout> }
      entry.timer = setTimeout(() => {
        this.acks = this.acks.filter((a) => a !== entry)
        reject(new Error(`printer did not answer "${line}"`))
      }, timeout)
      this.acks.push(entry)
    })
    if (debugOn()) console.log('[serial] >>>', line)
    writer.write(this.enc.encode(line + '\n')).catch((e) => {
      this.fail(`serial write failed: ${e instanceof Error ? e.message : e}`)
    })
    return ack
  }

  private async readLoop(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader()
    this.reader = reader
    const dec = new TextDecoder()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        this.rxRest += dec.decode(value, { stream: true })
        let i
        while ((i = this.rxRest.indexOf('\n')) >= 0) {
          const line = this.rxRest.slice(0, i).trim()
          this.rxRest = this.rxRest.slice(i + 1)
          if (line) this.onLine(line)
        }
      }
    } catch (e) {
      if (this.state.connected) this.fail(`serial read failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      reader.releaseLock()
      if (this.reader === reader) this.reader = null
    }
  }

  private onLine(line: string) {
    if (debugOn()) console.log('[serial] <<<', line)
    if (line.startsWith('ok')) {
      const a = this.acks.shift()
      if (a) {
        clearTimeout(a.timer)
        a.resolve()
      }
      return
    }
    if (line.includes('FIRMWARE_NAME:') || line.includes('MACHINE_TYPE:')) {
      // the first reply after open can arrive with its head clipped, so
      // accept either field on its own
      const fw = line.match(/FIRMWARE_NAME:(.+?)(?:\s+SOURCE_CODE_URL:|$)/)?.[1]
      const machine = line.match(/MACHINE_TYPE:(.+?)(?:\s+EXTRUDER_COUNT:|$)/)?.[1]
      const label = [machine, fw].filter(Boolean).join(' · ')
      if (label) {
        this.state.firmware = label
        this.emit()
      }
      return
    }
    if (line.startsWith('echo:busy')) {
      // the firmware is alive but grinding (long move, homing) — push every
      // pending deadline out instead of timing out mid-move
      for (const a of this.acks) {
        clearTimeout(a.timer)
        a.timer = setTimeout(() => {
          this.acks = this.acks.filter((x) => x !== a)
          a.reject(new Error(`printer did not answer "${a.line}"`))
        }, a.timeout)
      }
      return
    }
    if (line.startsWith('Error:')) {
      this.state.error = line
      this.emit()
    }
    // everything else (boot banner, echo:, M115 capability lines) is noise
  }

  private fail(msg: string) {
    this.state.error = msg
    this.emit()
    void this.disconnect()
  }
}

export const marlin = new MarlinSerial()
