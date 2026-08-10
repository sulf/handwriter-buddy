# Handwriter Buddy

Turn a Bambu Lab **A1 Mini** or a Creality **Ender 3** with a pen attachment
into a handwriting machine. Type a message, aim it on a true-scale preview of
the print bed, press **Plot** — and a real pen writes it in connected cursive.

![Handwriter Buddy — bed preview with handwriting and controls](docs/screenshot.png)

## Features

- **Single-stroke handwriting** — glyphs are [Hershey fonts](https://en.wikipedia.org/wiki/Hershey_fonts)
  (real pen paths, not filled outlines), with geometric letter joins so cursive
  flows like an actual hand, plus a humanized print hand with per-letter wobble.
- **True-scale bed preview** — a 180×180 mm canvas; click or drag to place the
  text's top-left corner, size in real millimeters of cap height, automatic
  wrapping at the bed edge, adjustable line height.
- **Direct printer control** — connects to the A1 Mini over LAN (MQTT) or to
  an Ender 3 over USB (Web Serial), streams G-code paced so nothing is
  dropped, with jog controls, guided pen-height calibration, dry-run mode,
  and one-click stop that lifts the pen.
- **Built-in setup guide** — an illustrated walkthrough for putting the printer
  into LAN-Only + Developer Mode and connecting.

## Run it

```bash
npm install
npm run app        # build and launch the desktop app
```

or for development:

```bash
npm run dev        # vite dev server
npm run bridge     # printer bridge (embedded in the desktop app automatically)
npm run app:dev    # electron shell pointed at the dev server
```

`npm run dist` builds the distributable dmg/zip into `release/`.

## Printer setup

### A1 Mini (LAN)

The app includes a step-by-step guide (the "setup guide" link), in short:

1. Computer and printer must be on the **same network**.
2. On the printer: Settings → LAN Only → enable **LAN Only Mode** and
   **Developer Mode** (required — without it the printer ignores motion
   commands).
3. Enter the IP, access code, and serial (Settings → Device → Printer SN).

### Ender 3 (USB)

Pick **Ender 3** under printer & calibration, plug the printer in over USB,
and click **Connect USB** (115200 baud, plain Marlin G-code over Web Serial —
works in Chrome/Edge and in the desktop app; stock Creality firmware is fine).
Home the printhead once after power-on so the printer knows where it is, then
calibrate pen height as usual.

Mount a pen, calibrate pen-down/pen-up Z with the jog pad, and plot.
**Never home the printer with the pen mounted** — homing presses the toolhead
into the bed.

## Pen attachment hardware

The [`hardware/`](docs/hardware) folder contains printable STEP models for the A1
Mini pen attachment:

| Part | File |
|---|---|
| Pen tube (mounts on the toolhead) | [`A1 Plotter Tube.step`](docs/hardware/A1%20Plotter%20Tube.step) |
| Pen adapter, small bore | [`A1 Plotter Adapter S.step`](docs/hardware/A1%20Plotter%20Adapter%20S.step) |
| Pen adapter, medium bore | [`A1 Plotter Adapter M.step`](docs/hardware/A1%20Plotter%20Adapter%20M.step) |
| Pen adapter, large bore | [`A1 Plotter Adapter L.step`](docs/hardware/A1%20Plotter%20Adapter%20L.step) |
| Cap | [`A1 Plotter Cap.step`](docs/hardware/A1%20Plotter%20Cap.step) |
| Printed spring | [`A1 Plotter Spring.step`](docs/hardware/A1%20Plotter%20Spring.step) |

Pick the adapter that matches your pen's diameter. The STEP files are
mesh-derived (converted from STL), so curved faces are finely faceted —
dimensionally accurate for printing and measuring, but not parametric.

**Never home the printer with the pen mounted** — homing presses the toolhead
into the bed.

## How it talks to the printer

The renderer can't speak MQTT-over-TLS, so a small Node bridge
(`server/bridge.mjs`, embedded in the Electron main process) relays HTTP from
the UI to `mqtts://<printer>:8883` and streams `gcode_line` commands in
chunks paced to their estimated execution time.

## Credits

Handwriting glyphs are derived from the public-domain
[Hershey fonts](https://en.wikipedia.org/wiki/Hershey_fonts) (Allen V. Hershey,
US NBS, 1967), via the [hersheytext](https://github.com/techninja/hersheytext)
JSON conversion (MIT).

## License

[MIT](LICENSE) © 2026 Ulf Schwekendiek <sulf@me.com>
