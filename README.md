# Calendar for Omarchy

The Omarchy clock, with a calendar popup that knows what you have on.

Days carrying appointments get a dot for each calendar involved. Click a day
and its agenda appears under the grid — times, titles, locations, and which
calendar each entry came from. Everything else about the clock is unchanged:
the same label formats, week numbers, week-start toggle, year and life bars,
and the same keyboard and scroll-wheel month stepping.

![The calendar popup with a day's agenda](preview.png)

Appointments come from a **pluggable exporter** that writes a documented JSON
file. A Thunderbird exporter ships with the plugin; anything else that can
write that file works too, so the plugin is not tied to Thunderbird — see
[`exporters/README.md`](exporters/README.md).

## Install

```bash
omarchy plugin add https://github.com/likt0r/omarchy-calendar --enable
omarchy plugin disable omarchy.clock   # this replaces the built-in clock
omarchy restart shell
```

Then open the popup by clicking the clock. The first open runs the exporter,
so appointments appear a moment later.

To see what it looks like before wiring up a calendar, set
`"eventSource": "demo"` on the widget's entry for a synthetic week of
appointments — that is what the screenshot above shows.

Requirements: Omarchy 4.x, Python 3.9+ (`zoneinfo`), and for the bundled
exporter a Thunderbird profile with calendars. No system packages, no root,
no network access, nothing to install into `~/.local/bin`.

## Configuration

Settings live on the widget's entry in `~/.config/omarchy/shell.json` and
hot-reload on save:

```json
{
  "id": "likt0r.calendar",
  "format": "dddd HH:mm",
  "eventSource": "thunderbird",
  "eventsPath": "~/.cache/omarchy-calendar/events.json"
}
```

| Setting | Default | Meaning |
|---|---|---|
| `eventSource` | `thunderbird` | Exporter to run, by file name under `exporters/`. `demo` for synthetic data, `none` when something else writes the file and the panel only reads. |
| `eventsPath` | `~/.cache/omarchy-calendar/events.json` | Where the events file lives. |

Everything the built-in clock understands still applies — `format`,
`formatAlt`, `verticalFormat`, `weekStartDay`, `birthYear`,
`lifeExpectancy`.

## Where the appointments come from

The panel reads one JSON file and renders it. It never talks to a calendar
server, a database, or Thunderbird. On every open it runs the configured
exporter, which rewrites that file atomically; the panel watches the path
and repaints when it changes.

That split is the point: writing an exporter for `khal`, `vdirsyncer`, an ICS
URL, or anything else means writing one program that emits the documented
shape, with no QML involved. The contract, the settings, and what the
bundled Thunderbird exporter does are all in
[`exporters/README.md`](exporters/README.md).

The Thunderbird exporter reads the calendar caches **strictly read-only**,
through a copy, so a running Thunderbird is never disturbed. It expands
recurring series itself — `RRULE` with intervals, ordinals and `BYSETPOS`,
plus `EXDATE`, `RDATE`, moved and cancelled occurrences — using only the
standard library.

Freshness is bounded by Thunderbird: its caches advance when Thunderbird
syncs. If you need appointments independent of Thunderbird running, that is
a good reason to write a second exporter.

## Development

The plugin folder is the repository, so a clone of this repo dropped into
`~/.config/omarchy/plugins/likt0r.calendar` is a working install you can edit
in place.

```bash
./tests/run-tests.sh          # exporter, Events.js, manifest, qml syntax
python3 exporters/thunderbird --print | head -40
omarchy plugin validate .
```

Two things worth knowing:

- **Hot reload covers edits, not new files.** Saving a change to an existing
  file reloads the plugin. Adding a *new* file needs
  `omarchy restart shell` before the shell sees it.
- **The exporter is where the risk lives.** Its recurrence engine is
  hand-written, so `tests/exporter-test.py` checks every recurrence case
  against independently computed dates rather than against recorded output.
  Add a case there before changing that engine.

Layout:

```
manifest.json          plugin metadata; its id decides the install folder
BarWidget.qml          bar label, hosts the popup          (from Omarchy)
Panel.qml              popup: month grid + agenda          (extended)
Model.js               date and format maths               (from Omarchy)
Events.js              lookup over the events file          (new)
exporters/thunderbird  Thunderbird -> events.json           (new)
exporters/demo         synthetic data, and the preview      (new)
exporters/README.md    the JSON contract                    (new)
tests/                 run-tests.sh + one file per unit
```

## License

MIT — see [`LICENSE`](LICENSE).

This plugin is a derivative of Omarchy's built-in clock plugin; `BarWidget.qml`,
`Model.js` and parts of `Panel.qml` originate there. See [`NOTICE`](NOTICE) for
the attribution.
