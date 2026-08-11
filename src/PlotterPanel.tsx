import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SerialPortChoice } from './App'
import { SetupGuide } from './SetupGuide'
import type { TextLayout } from './hershey'
import { marlin } from './marlin'
import type { SvgObject } from './svgobjects'
import {
  bridge,
  gotoStartGcode,
  layoutToGcode,
  PRINTERS,
  type BridgeState,
  type PlotSettings,
  type PlotterCreds,
  type PlotterDriver,
  type PrinterKind,
} from './plotter'

interface PlotterPanelProps {
  layout: TextLayout
  settings: PlotSettings
  onSettings: (s: PlotSettings) => void
  /** element in the stage that hosts the floating status pills */
  statusSlot: HTMLDivElement | null
  /** imported SVG drawings to plot after the text */
  objects: SvgObject[]
  printer: PrinterKind
  onPrinter: (k: PrinterKind) => void
  creds: PlotterCreds
  onCreds: (c: PlotterCreds) => void
  /** square bed side of the selected printer, mm */
  bed: number
}

export function PlotterPanel({ layout, settings, onSettings, statusSlot, objects, printer, onPrinter, creds, onCreds, bed }: PlotterPanelProps) {
  const setCreds = onCreds
  const setSettings = onSettings
  const [state, setState] = useState<BridgeState | null>(null)
  const [bridgeUp, setBridgeUp] = useState(false)
  const [serial, setSerial] = useState(marlin.state)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [step, setStep] = useState(1)
  const [guideOpen, setGuideOpen] = useState(false)
  /** tracked absolute Z; null until "Z → 10" establishes a known height */
  const [zPos, setZPos] = useState<number | null>(null)
  /** two-click Home confirmation (window.confirm is unreliable in Electron) */
  const [homeArmed, setHomeArmed] = useState(false)
  const homeArmTimer = useRef(0)

  const isSerial = PRINTERS[printer].link === 'serial'
  /** ports offered by the Electron main process while requestPort is pending */
  const [portChoices, setPortChoices] = useState<SerialPortChoice[] | null>(null)

  useEffect(() => marlin.subscribe(() => setSerial(marlin.state)), [])

  useEffect(() => {
    window.hwb?.onSerialPorts?.((ports) => {
      // USB adapters first, Bluetooth/debug consoles last
      const score = (p: SerialPortChoice) => (/usbserial|usbmodem/i.test(p.portName) ? 0 : 1)
      setPortChoices([...ports].sort((a, b) => score(a) - score(b)))
    })
  }, [])

  const pickPort = (portId: string) => {
    window.hwb?.chooseSerialPort?.(portId)
    setPortChoices(null)
  }

  useEffect(() => {
    if (isSerial) return // the bridge only serves the LAN printer
    let alive = true
    const poll = async () => {
      try {
        const s = await bridge.status()
        if (alive) {
          setState(s)
          setBridgeUp(true)
        }
      } catch {
        if (alive) {
          setBridgeUp(false)
          setState(null)
        }
      }
    }
    poll()
    const id = setInterval(poll, 1000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [isSerial])

  const noteTimer = useRef(0)
  const flashNote = (msg: string) => {
    setNote(msg)
    clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setNote(''), 4000)
  }

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    setNote('')
    try {
      await fn()
      flashNote(`${label} ✓`)
    } catch (e) {
      flashNote(`${label} failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const driver: PlotterDriver = isSerial ? marlin : bridge
  const gcode = () => layoutToGcode(layout, settings, bed, objects)

  const jogXY = (dx: number, dy: number) => {
    const move = ['G91', `G1 ${dx ? `X${dx}` : ''}${dx && dy ? ' ' : ''}${dy ? `Y${dy}` : ''} F3000`, 'G90', 'M400']
    run(`Jog ${dx ? `X${dx > 0 ? '+' : ''}${dx}` : `Y${dy > 0 ? '+' : ''}${dy}`}`, () => driver.gcode(move))
  }

  const zTo = (z: number) => {
    const nz = Math.max(0, Math.round(z * 100) / 100)
    setZPos(nz)
    run(`Z → ${nz.toFixed(2)}`, () => driver.gcode(['G90', `G1 Z${nz.toFixed(2)} F1200`, 'M400']))
  }

  const g = layoutToGcode(layout, settings, bed, objects)
  const plotting = (isSerial ? serial.plot : state?.plot) ?? null
  const connected = isSerial ? serial.connected : (state?.connected ?? false)
  const lastError = isSerial ? serial.error : state?.error

  const num = (key: keyof PlotSettings, label: string, step = 1) => (
    <label className="field field--num">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={settings[key] as number}
        onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
      />
    </label>
  )

  const hudState = plotting
    ? { cls: 'hud-state--busy', icon: '⚡', label: `plotting ${plotting.sent}/${plotting.total}` }
    : connected
      ? { cls: 'hud-state--ok', icon: '●', label: 'ready' }
      : isSerial
        ? serial.supported
          ? { cls: 'hud-state--warn', icon: '◌', label: 'not connected' }
          : { cls: 'hud-state--err', icon: '○', label: 'Web Serial unavailable' }
        : bridgeUp
          ? { cls: 'hud-state--warn', icon: '◌', label: 'not connected' }
          : { cls: 'hud-state--err', icon: '○', label: 'bridge offline' }

  return (
    <div className="plotter">
      <div className="pl-sec">
        <div className="pl-main-actions">
          <button className="btn" disabled={busy || !connected || !!plotting} onClick={() => run('Move to crosshair', () => driver.gcode(gotoStartGcode(layout, settings).lines))}>
            Move to crosshair
          </button>
          {plotting ? (
            <button className="btn btn--stop" onClick={() => run('Stop', () => driver.stop())}>
              STOP
            </button>
          ) : (
            <button
              className="btn btn--primary"
              disabled={busy || !connected || (layout.glyphs.length === 0 && objects.length === 0)}
              onClick={() => run('Plot', () => driver.plot(gcode().lines))}
            >
              {settings.dryRun ? 'Plot (dry)' : 'Plot'}
            </button>
          )}
        </div>
        <div className="pl-statusline">
          <span className={`hud-state ${hudState.cls}`}>
            <span>{hudState.icon}</span>
            {PRINTERS[printer].name} · {hudState.label}
          </span>
          {connected && (isSerial ? serial.firmware || serial.port : state?.ip) ? (
            <span className="pl-status-ip">{isSerial ? serial.firmware ?? serial.port : state?.ip}</span>
          ) : (
            <button className="guide-link" onClick={() => setGuideOpen(true)}>
              setup guide
            </button>
          )}
        </div>
        <SetupGuide
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          creds={creds}
          onCreds={setCreds}
          connect={() => bridge.connect(creds.ip.trim(), creds.accessCode.trim(), creds.serial.trim())}
          connected={connected}
          bridgeUp={bridgeUp}
          printer={printer}
          onConnectUsb={() => run('Connect', () => marlin.connect())}
        />
        {plotting && (
          <div className="hud-bar">
            <i style={{ width: `${Math.round((plotting.sent / Math.max(1, plotting.total)) * 100)}%` }} />
          </div>
        )}
        {statusSlot &&
          createPortal(
            <>
              {plotting && <div className="pill">plotting… {plotting.sent}/{plotting.total}</div>}
              {!plotting && note && <div className="pill">{note}</div>}
              {g.warnings.map((w) => (
                <div key={w} className="pill pill--warn">{w}</div>
              ))}
              {lastError && !connected && <div className="pill pill--warn">{lastError}</div>}
            </>,
            statusSlot,
          )}
      </div>

      <details className="pl-conn">
        <summary>printer &amp; calibration</summary>
        <div className="pl-conn-body">
          <div className="pl-group">
            <span className="sec-title">printer</span>
            <div className="jog-steps">
              {(Object.keys(PRINTERS) as PrinterKind[]).map((k) => (
                <button key={k} className={`chip ${printer === k ? 'chip--on' : ''}`} onClick={() => onPrinter(k)}>
                  {PRINTERS[k].name}
                </button>
              ))}
            </div>
          </div>

          {isSerial ? (
            <div className="pl-group">
              <div className="pl-group-head">
                <span className="sec-title">connection · USB</span>
                <button className="guide-link" onClick={() => setGuideOpen(true)}>
                  setup guide
                </button>
              </div>
              <button
                className="btn"
                disabled={busy || !serial.supported}
                onClick={() => run('Connect', () => marlin.connect())}
              >
                {connected ? 'Reconnect USB' : 'Connect USB'}
              </button>
              {portChoices && (
                <div className="pl-portpick">
                  <span className="sec-title">choose the printer's port</span>
                  {portChoices.map((p) => (
                    <button key={p.portId} className="btn btn--small" onClick={() => pickPort(p.portId)}>
                      {p.portName}
                      {p.displayName ? ` · ${p.displayName}` : ''}
                    </button>
                  ))}
                  <button className="guide-link" onClick={() => pickPort('')}>
                    cancel
                  </button>
                </div>
              )}
              {!serial.supported && <p className="pl-hint">Web Serial needs Chrome, Edge, or the desktop app.</p>}
              {connected && serial.firmware && <p className="pl-hint">{serial.firmware}</p>}
              {connected && <p className="pl-hint">Home the printhead once after power-on so the printer knows where it is.</p>}
            </div>
          ) : (
          <div className="pl-group">
            <div className="pl-group-head">
              <span className="sec-title">connection</span>
              <button className="guide-link" onClick={() => setGuideOpen(true)}>
                setup guide
              </button>
            </div>
            <label className="field">
              <span>printer IP</span>
              <input value={creds.ip} onChange={(e) => setCreds({ ...creds, ip: e.target.value })} placeholder="192.168.1.xx" />
            </label>
            <label className="field">
              <span>access code</span>
              <input
                type="password"
                value={creds.accessCode}
                onChange={(e) => setCreds({ ...creds, accessCode: e.target.value })}
              />
            </label>
            <label className="field">
              <span>serial</span>
              <input value={creds.serial} onChange={(e) => setCreds({ ...creds, serial: e.target.value })} placeholder="0309…" />
            </label>
            <button
              className="btn"
              disabled={busy || !bridgeUp || !creds.ip || !creds.accessCode || !creds.serial}
              onClick={() => run('Connect', () => bridge.connect(creds.ip, creds.accessCode, creds.serial))}
            >
              {connected ? 'Reconnect' : 'Connect'}
            </button>
          </div>
          )}

          <div className="pl-group">
            <span className="sec-title">placement · {g.widthMM.toFixed(0)} × {g.heightMM.toFixed(0)} mm</span>
            <div className="pl-grid2">
              {num('originX', 'top-left x')}
              {num('originY', 'top-left y')}
            </div>
            <label className="field field--check">
              <input
                type="checkbox"
                checked={settings.dryRun}
                onChange={(e) => setSettings({ ...settings, dryRun: e.target.checked })}
              />
              <span>dry run (pen stays up)</span>
            </label>
          </div>

          <div className="pl-group">
            <span className="sec-title">pen height</span>
            <div className="pl-grid2">
              {num('drawZ', 'pen-down z', 0.1)}
              {num('travelZ', 'pen-up z', 0.5)}
            </div>
            <button
              className={`btn ${homeArmed ? 'btn--stop' : ''}`}
              disabled={busy || !connected}
              title={
                isSerial
                  ? 'Homes X/Y/Z to the endstop switches — required once after power-on'
                  : 'Homing presses the toolhead toward the bed — remove the pen first!'
              }
              onClick={() => {
                clearTimeout(homeArmTimer.current)
                if (!homeArmed) {
                  setHomeArmed(true)
                  homeArmTimer.current = window.setTimeout(() => setHomeArmed(false), 6000)
                  return
                }
                setHomeArmed(false)
                run('Home', () => driver.gcode(['G28']))
              }}
            >
              {homeArmed ? (isSerial ? 'Pen clear of the bed? Click again' : 'Pen removed? Click again') : 'Home Printhead'}
            </button>
          </div>

          <div className="pl-group">
            <span className="sec-title">jog</span>
            <div className="jog-steps">
              <span className="jog-step-label">step</span>
              {[0.1, 0.5, 1, 5, 10].map((s) => (
                <button key={s} className={`chip ${step === s ? 'chip--on' : ''}`} onClick={() => setStep(s)}>
                  {s}
                </button>
              ))}
            </div>
            <div className="jog-row">
              <div className="jog-pad">
                <span />
                <button className="btn jog-btn" disabled={busy || !connected} onClick={() => jogXY(0, step)} aria-label="Y plus">↑</button>
                <span />
                <button className="btn jog-btn" disabled={busy || !connected} onClick={() => jogXY(-step, 0)} aria-label="X minus">←</button>
                <span className="jog-center">xy</span>
                <button className="btn jog-btn" disabled={busy || !connected} onClick={() => jogXY(step, 0)} aria-label="X plus">→</button>
                <span />
                <button className="btn jog-btn" disabled={busy || !connected} onClick={() => jogXY(0, -step)} aria-label="Y minus">↓</button>
                <span />
              </div>
              <div className="jog-zcol">
                <span className="sec-title">z {zPos !== null ? zPos.toFixed(2) : '·'}</span>
                {zPos === null ? (
                  <button className="btn" title="Establish a known height first" disabled={busy || !connected} onClick={() => zTo(10)}>
                    Z → 10
                  </button>
                ) : (
                  <div className="jog-zbtns">
                    <button className="btn jog-btn" disabled={busy || !connected} onClick={() => zTo(zPos + step)} aria-label="Z up">Z ↑</button>
                    <button className="btn jog-btn" disabled={busy || !connected} onClick={() => zTo(zPos - step)} aria-label="Z down">Z ↓</button>
                  </div>
                )}
              </div>
            </div>
            <div className="jog-caps">
              <button
                className="btn btn--small"
                disabled={zPos === null}
                onClick={() => {
                  setSettings({ ...settings, drawZ: zPos! })
                  flashNote(`pen-down z = ${zPos!.toFixed(2)}`)
                }}
              >
                → pen-down z
              </button>
              <button
                className="btn btn--small"
                disabled={zPos === null}
                onClick={() => {
                  setSettings({ ...settings, travelZ: zPos! })
                  flashNote(`pen-up z = ${zPos!.toFixed(2)}`)
                }}
              >
                → pen-up z
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>
  )
}
