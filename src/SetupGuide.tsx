import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PlotterCreds } from './plotter'

/** Small vector: laptop ↔ router ↔ printer on one Wi-Fi. */
function NetworkArt() {
  return (
    <svg viewBox="0 0 340 110" className="guide-art" aria-hidden>
      {/* laptop */}
      <g stroke="var(--text-light)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect x="18" y="48" width="56" height="34" rx="3" />
        <path d="M10 88 h72 l-6 8 h-60 z" fill="var(--tray-line)" />
      </g>
      {/* router */}
      <g stroke="var(--text-light)" strokeWidth="2" fill="none" strokeLinecap="round">
        <rect x="146" y="66" width="48" height="18" rx="4" />
        <line x1="156" y1="66" x2="150" y2="44" />
        <line x1="184" y1="66" x2="190" y2="44" />
        <circle cx="158" cy="75" r="1.6" fill="#6fae7c" stroke="none" />
        <circle cx="166" cy="75" r="1.6" fill="#6fae7c" stroke="none" />
      </g>
      {/* printer (A1-ish gantry) */}
      <g stroke="var(--text-light)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect x="256" y="76" width="64" height="14" rx="3" />
        <line x1="266" y1="76" x2="266" y2="42" />
        <line x1="310" y1="76" x2="310" y2="42" />
        <line x1="260" y1="42" x2="316" y2="42" />
        <rect x="280" y="46" width="16" height="12" rx="2" />
        <line x1="288" y1="58" x2="288" y2="64" />
      </g>
      {/* laptop → router: cable (any link works) */}
      <g stroke="#6fae7c" strokeWidth="2.2" fill="none" strokeLinecap="round">
        <path d="M82 84 q32 14 64 -4" strokeDasharray="1 6" />
      </g>
      {/* router → printer: wifi */}
      <g stroke="#6fae7c" strokeWidth="2.2" fill="none" strokeLinecap="round">
        <path d="M216 74 q12 -12 24 0" />
        <path d="M222 82 q6 -6 12 0" />
      </g>
    </svg>
  )
}

/** Vector recreation of the printer's “LAN Only” screen. */
function LanScreenArt({ highlight }: { highlight: 'lan' | 'dev' | 'codes' }) {
  const hl = 'var(--postal)'
  const dim = 'var(--tray-line)'
  return (
    <svg viewBox="0 0 340 150" className="guide-art" aria-hidden>
      <rect x="30" y="6" width="280" height="138" rx="10" fill="#10181a" stroke={dim} strokeWidth="2" />
      <text x="48" y="30" className="ga-t ga-strong">‹ LAN Only</text>
      {/* LAN Only Mode row */}
      <rect x="40" y="40" width="260" height="24" rx="5" fill="none" stroke={highlight === 'lan' ? hl : 'none'} strokeWidth="2" />
      <text x="48" y="56" className="ga-t">LAN Only Mode</text>
      <rect x="262" y="44" width="30" height="16" rx="8" fill="#57a05e" />
      <circle cx="284" cy="52" r="7" fill="#f2efe6" />
      {/* access code / ip */}
      <rect x="40" y="68" width="260" height="40" rx="5" fill="none" stroke={highlight === 'codes' ? hl : 'none'} strokeWidth="2" />
      <text x="48" y="82" className="ga-t ga-dim">Access Code</text>
      <text x="292" y="82" className="ga-t" textAnchor="end">12345678</text>
      <text x="48" y="100" className="ga-t ga-dim">IP</text>
      <text x="292" y="100" className="ga-t" textAnchor="end">192.168.1.42</text>
      {/* developer mode row */}
      <rect x="40" y="112" width="260" height="24" rx="5" fill="none" stroke={highlight === 'dev' ? hl : 'none'} strokeWidth="2" />
      <text x="48" y="128" className="ga-t">Developer Mode</text>
      <rect x="262" y="116" width="30" height="16" rx="8" fill="#57a05e" />
      <circle cx="284" cy="124" r="7" fill="#f2efe6" />
    </svg>
  )
}

/** Vector recreation of the printer's “Device” screen with the serial. */
function DeviceScreenArt() {
  return (
    <svg viewBox="0 0 340 120" className="guide-art" aria-hidden>
      <rect x="30" y="6" width="280" height="108" rx="10" fill="#10181a" stroke="var(--tray-line)" strokeWidth="2" />
      <text x="48" y="30" className="ga-t ga-strong">‹ Device</text>
      <text x="48" y="54" className="ga-t ga-dim">Model</text>
      <text x="292" y="54" className="ga-t" textAnchor="end">A1 mini</text>
      <rect x="40" y="64" width="260" height="26" rx="5" fill="none" stroke="var(--postal)" strokeWidth="2" />
      <text x="48" y="81" className="ga-t ga-dim">Printer SN</text>
      <text x="292" y="81" className="ga-t" textAnchor="end">0300XXXXXXXXXX</text>
    </svg>
  )
}

interface SetupGuideProps {
  open: boolean
  onClose: () => void
  creds: PlotterCreds
  onCreds: (c: PlotterCreds) => void
  connect: () => Promise<unknown>
  connected: boolean
  bridgeUp: boolean
}

export function SetupGuide({ open, onClose, creds, onCreds, connect, connected, bridgeUp }: SetupGuideProps) {
  const [page, setPage] = useState<'steps' | 'connect'>('steps')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [justConnected, setJustConnected] = useState(false)

  useEffect(() => {
    if (open) {
      setPage('steps')
      setError('')
      setJustConnected(false)
    }
  }, [open])

  if (!open) return null

  const tryConnect = async () => {
    setBusy(true)
    setError('')
    try {
      await connect()
      setJustConnected(true)
      setTimeout(onClose, 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const connectPage = (
    <>
      <p className="guide-intro">
        Type in the three things from the printer's screens. They're saved on this computer, so you only do
        this once.
      </p>
      <div className="guide-form">
        <label className="field">
          <span>printer IP</span>
          <input
            value={creds.ip}
            onChange={(e) => onCreds({ ...creds, ip: e.target.value })}
            placeholder="192.168.1.42"
            autoFocus
          />
        </label>
        <label className="field">
          <span>access code</span>
          <input
            value={creds.accessCode}
            onChange={(e) => onCreds({ ...creds, accessCode: e.target.value })}
            placeholder="12345678"
          />
        </label>
        <label className="field">
          <span>serial (Printer SN)</span>
          <input
            value={creds.serial}
            onChange={(e) => onCreds({ ...creds, serial: e.target.value })}
            placeholder="0300XXXXXXXXXX"
          />
        </label>
        <button
          className="btn btn--primary guide-connect-btn"
          disabled={busy || !bridgeUp || !creds.ip || !creds.accessCode || !creds.serial}
          onClick={tryConnect}
        >
          {busy ? 'Connecting…' : justConnected || connected ? 'Connected ✓' : 'Connect'}
        </button>
        {justConnected && <p className="guide-ok">The printer answered — you're all set.</p>}
        {error && <p className="guide-err">Couldn't connect: {error}. Check the three values and the network.</p>}
        {!bridgeUp && <p className="guide-err">The printer bridge isn't running — restart the app.</p>}
      </div>
      <div className="guide-cta">
        <button className="btn" onClick={() => setPage('steps')}>‹ Steps</button>
        <button className="btn" onClick={onClose}>Later</button>
      </div>
    </>
  )

  return createPortal(
    <div className="guide-scrim" onClick={onClose}>
      <div className="guide" role="dialog" aria-label="Printer setup guide" onClick={(e) => e.stopPropagation()}>
        <div className="guide-head">
          <span className="guide-title">Connect your A1 Mini</span>
          <button className="btn btn--small" onClick={onClose}>close</button>
        </div>
        {page === 'connect' ? (
          connectPage
        ) : (
          <>{stepsPage()}
        <div className="guide-cta">
          <button className="btn" onClick={onClose}>Later</button>
          <button className="btn btn--primary" onClick={() => setPage('connect')}>
            Connect →
          </button>
        </div>
        </>
        )}
      </div>
    </div>,
    document.body,
  )
}

function stepsPage() {
  return (
    <>
        <div className="guide-banner">
          <NetworkArt />
          <p>
            <strong>One network for everything.</strong> Your computer and your printer must be on the
            <strong> same network</strong> — Wi-Fi or cable, it doesn't matter, as long as both reach the
            same router. If they can't see each other, nothing below will work.
          </p>
        </div>

        <ol className="guide-steps">
          <li>
            <div className="guide-step-text">
              <strong>Open the LAN settings on the printer.</strong>
              <p>On the printer's little screen, tap the gear (Settings), then tap <em>LAN Only</em>.</p>
            </div>
          </li>
          <li>
            <div className="guide-step-text">
              <strong>Turn on LAN Only Mode.</strong>
              <p>Flip the top switch. The printer leaves the Bambu cloud and talks only to your network. You can switch back anytime.</p>
            </div>
            <LanScreenArt highlight="lan" />
          </li>
          <li>
            <div className="guide-step-text">
              <strong>Turn on Developer Mode — required.</strong>
              <p>
                Flip the bottom switch too. This is the one that lets Handwriter Buddy move the printhead.
                Without it the app still connects and shows a green dot, but the printer
                <strong> silently ignores every move command</strong> — Bambu only allows outside control
                while this switch is on.
              </p>
            </div>
            <LanScreenArt highlight="dev" />
          </li>
          <li>
            <div className="guide-step-text">
              <strong>Copy the Access Code and IP.</strong>
              <p>Both are on this same screen. The app needs them exactly as shown.</p>
            </div>
            <LanScreenArt highlight="codes" />
          </li>
          <li>
            <div className="guide-step-text">
              <strong>Copy the serial number.</strong>
              <p>Go back, then tap <em>Device</em>. The long number next to <em>Printer SN</em> is the serial.</p>
            </div>
            <DeviceScreenArt />
          </li>
        </ol>

        <p className="guide-foot">
          Not connecting? Check the network first — computer and printer reaching the same router is the fix
          nine times out of ten. Connected but nothing moves? That's the Developer Mode switch.
        </p>
    </>
  )
}
