# Exporters — the JSON contract

The panel never talks to a calendar. It reads one file and renders it:

    ~/.cache/omarchy-calendar/events.json

Anything that writes that file in the shape below works as a data source.
The bundled `thunderbird` exporter is simply the first one.

## Which exporter runs

The panel runs `exporters/<eventSource>` through `python3` every time the
popup opens, passing `--out <eventsPath>`. Both are settings on the widget's
entry in `~/.config/omarchy/shell.json`:

```json
{ "id": "likt0r.calendar", "eventSource": "thunderbird" }
```

- `eventSource` — file name under `exporters/`. Default `thunderbird`.
  Set to `"none"` when something else writes the file (a systemd timer, a
  cron job, your own script); the panel then only reads and never spawns
  anything.
- `eventsPath` — where to read and write. Default
  `~/.cache/omarchy-calendar/events.json`.

An exporter is therefore any program that accepts `--out PATH` and writes
the contract to it. Language does not matter; only the `python3` invocation
does, so a non-Python exporter needs a shebang wrapper or `eventSource:
"none"` plus your own scheduling.

## The file

Top level:

| Field | Meaning |
|---|---|
| `generated` | ISO timestamp of the export. Informational. |
| `windowStart`, `windowEnd` | `YYYY-MM-DD` bounds actually covered. |
| `timezone` | IANA zone the local times were rendered in. |
| `eventCount` | Total events across all days. |
| `calendars` | `[{name, color}]` — every source calendar included. |
| `days` | The payload: `"YYYY-MM-DD"` → array of events. |
| `warnings` | Strings the exporter wants surfaced. May be empty. |

Each event in a day's array:

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Display title. |
| `allDay` | yes | `true` hides the time and sorts the event first. |
| `color` | yes | Any CSS color; drawn as the day's dot and the row's spine. |
| `calendars` | yes | `[String]` — every calendar this event came from. |
| `time` | timed only | `"HH:MM"` start. Empty on continuation days. |
| `endTime` | timed only | `"HH:MM"` end. Empty until the final day. |
| `start`, `end` | timed only | Full ISO local times, offset included. |
| `spanDays` | yes | `1` for a normal event, more for a run. |
| `dayIndex` | yes | 0-based position within that run. |
| `location` | optional | Omitted rather than empty when unknown. |

Rules the panel relies on:

- **Pre-sorted.** Each day's array is rendered in order, all-day first.
  The panel does not sort.
- **Pre-expanded.** Recurrences are already individual entries; a
  multi-day event is repeated under every date it covers, with `dayIndex`
  and `spanDays` saying where in the run each copy sits.
- **Local times.** `time`/`endTime` are wall-clock in `timezone`, ready to
  print. Do not hand over UTC and expect conversion.
- **Deduplicated.** One entry per real appointment, with every source
  calendar listed in `calendars`, rather than one entry per calendar.
- **Written atomically.** Write a temporary file and `rename` it. The panel
  watches the path and will read whatever is there the moment it changes;
  a partial write would flash as a broken calendar.

A minimal valid file:

```json
{
  "generated": "2026-08-27T12:03:00+02:00",
  "windowStart": "2026-08-27", "windowEnd": "2026-08-27",
  "timezone": "Europe/Berlin", "eventCount": 1,
  "calendars": [{"name": "Work", "color": "#3C6EBA"}],
  "days": {
    "2026-08-27": [
      {"title": "Standup", "allDay": false, "color": "#3C6EBA",
       "calendars": ["Work"], "time": "09:30", "endTime": "09:45",
       "start": "2026-08-27T09:30+02:00", "end": "2026-08-27T09:45+02:00",
       "spanDays": 1, "dayIndex": 0}
    ]
  },
  "warnings": []
}
```

A missing, empty or malformed file is not an error: the panel falls back to
"nothing scheduled" and keeps working as a plain month calendar.

## demo

Writes a synthetic week of appointments relative to today, so the plugin can
be tried before any calendar is wired up:

```json
{ "id": "likt0r.calendar", "eventSource": "demo" }
```

It is also what `preview.png` in the README is taken from. A screenshot of a
real calendar would publish whoever happens to be in it, meeting links and
passwords included, so the preview is built from invented data on purpose.

`tests/contract-test.py` runs this exporter and checks its output against
every rule above, which makes it the executable form of this document: point
it at a new exporter to find out whether "writes the contract" actually
holds.

## thunderbird

Reads every profile under `~/.thunderbird` that has calendar data, both
`cache.sqlite` (CalDAV/CardDAV caches) and `local.sqlite` (local calendars).

- **Read-only, always.** Each database is copied to a temp directory
  together with its `-wal`/`-shm` before being opened, so a running
  Thunderbird is untouched and the write-ahead log is replayed correctly.
- Calendar names and colors come from `prefs.js`. Calendars that are
  disabled or hidden from the main view are skipped, so the bar shows what
  Thunderbird shows.
- Recurrences are expanded in the event's own timezone, so a weekly meeting
  keeps its wall-clock time across a DST boundary. Windows TZIDs
  (`W. Europe Standard Time` and friends) are mapped to IANA zones.
- Freshness is bounded by Thunderbird: the caches only advance when
  Thunderbird syncs. If you need it independent of Thunderbird running,
  write a `vdirsyncer`/`khal` exporter instead — that is what the contract
  is for.

```
python3 exporters/thunderbird --print | head -40   # write, and echo the result
python3 exporters/thunderbird --forward-days 30    # narrower window
python3 exporters/thunderbird --back-days 0        # today onwards
```
