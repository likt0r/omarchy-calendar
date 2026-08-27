#!/usr/bin/env python3
"""Tests for the thunderbird exporter, above all its RRULE engine.

The engine is hand-written (no python-dateutil dependency), so it is the
part most likely to drift. Every recurrence case here is checked against an
independently computed expectation rather than against a recorded output,
so a wrong answer cannot be blessed by re-recording it.

Run: python3 -B tests/exporter-test.py

-B matters: inside a real plugin folder a __pycache__ directory makes the
Omarchy shell's file watcher reload the plugin on every test run.
"""

import importlib.machinery
import importlib.util
import os
import sys
from datetime import date, datetime, timedelta, timezone

# Pin the zone before import: the module resolves the local timezone once,
# at import time, and half these assertions are about local rendering.
os.environ["TZ"] = "Europe/Berlin"

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORTER = os.path.join(os.path.dirname(HERE), "exporters", "thunderbird")

# The exporter has no .py suffix, so importlib cannot infer a loader for it
# and needs one named explicitly.
_loader = importlib.machinery.SourceFileLoader("tb_exporter", EXPORTER)
_spec = importlib.util.spec_from_loader("tb_exporter", _loader)
tb = importlib.util.module_from_spec(_spec)
_loader.exec_module(tb)

FAILURES = []
CHECKS = [0]


def check(label, got, want):
    CHECKS[0] += 1
    if got != want:
        FAILURES.append("%s\n     got:  %r\n     want: %r" % (label, got, want))


def check_true(label, value):
    check(label, bool(value), True)


US = tb.US


def rule(body):
    return tb.parse_rrule(body)


def occurrences(dtstart, body, until_date, from_date=None):
    """Wall-clock dates a rule produces up to until_date."""
    r = rule(body)
    start = from_date or (dtstart.date() - timedelta(days=1))
    out = list(tb.iter_rule_dates(dtstart, r, start, until_date))
    # iter_rule_dates counts from DTSTART on purpose -- COUNT depends on it --
    # so trimming to the window is the caller's job, as it is in expand_event.
    out = [d for d in out if d >= start]
    # UNTIL is enforced by expand_event against full instants. Only the date
    # part is available here; the instant-level check lives further down.
    if r["until"]:
        limit = r["until"][0].date()
        out = [d for d in out if d <= limit]
    return out


# --------------------------------------------------------------- parse_rrule

r = rule("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20260527T102959Z")
check("parse: freq", r["freq"], "WEEKLY")
check("parse: interval", r["interval"], 2)
check("parse: byday", r["byday"], [(None, 2)])
check("parse: until date", r["until"][0].date(), date(2026, 5, 27))
check("parse: until is utc", r["until"][1], True)
check("parse: count absent", r["count"], None)

r = rule("FREQ=MONTHLY;BYDAY=1WE")
check("parse: ordinal byday", r["byday"], [(1, 2)])
r = rule("FREQ=MONTHLY;BYDAY=-1FR")
check("parse: negative ordinal", r["byday"], [(-1, 4)])
r = rule("FREQ=MONTHLY;BYSETPOS=1,-1;BYDAY=MO,TU")
check("parse: bysetpos", r["bysetpos"], [1, -1])
check("parse: multi byday", r["byday"], [(None, 0), (None, 1)])
r = rule("FREQ=WEEKLY;WKST=SU")
check("parse: wkst", r["wkst"], 6)
r = rule("FREQ=DAILY;COUNT=3")
check("parse: count", r["count"], 3)
# Defaults must not leak from a previous parse.
r = rule("FREQ=YEARLY")
check("parse: default interval", r["interval"], 1)
check("parse: default wkst", r["wkst"], 0)
check("parse: empty byday", r["byday"], [])


# ------------------------------------------------------------- helpers

check("nth_weekday: 1st Wed Aug 2026", tb.nth_weekday(2026, 8, 2, 1), 5)
check("nth_weekday: last Fri Aug 2026", tb.nth_weekday(2026, 8, 4, -1), 28)
# August 2026 starts on a Saturday, so it really does have five Mondays.
check("nth_weekday: 5th Mon Aug 2026", tb.nth_weekday(2026, 8, 0, 5), 31)
check("nth_weekday: 6th Mon Aug 2026 absent", tb.nth_weekday(2026, 8, 0, 6), None)
check("month_len: Feb 2024 leap", tb.month_len(2024, 2), 29)
check("month_len: Feb 2026", tb.month_len(2026, 2), 28)
check("month_len: Dec", tb.month_len(2026, 12), 31)
check("apply_setpos: first", tb.apply_setpos([3, 10, 17, 24], [1]), [3])
check("apply_setpos: last", tb.apply_setpos([3, 10, 17, 24], [-1]), [24])
check("apply_setpos: out of range dropped", tb.apply_setpos([3], [2]), [])
check("apply_setpos: empty passes through", tb.apply_setpos([3, 10], []), [3, 10])
# BYMONTHDAY=-1 must mean the last day, in a short month too.
check("month_candidates: -1 in Feb",
      tb.month_candidates(2026, 2, rule("FREQ=MONTHLY;BYMONTHDAY=-1"), 1), [28])
# A day-of-month that does not exist is skipped, not clamped.
check("month_candidates: 31 skipped in Feb",
      tb.month_candidates(2026, 2, rule("FREQ=MONTHLY;BYMONTHDAY=31"), 1), [])


# ------------------------------------------------------------- DAILY / WEEKLY

got = occurrences(datetime(2026, 8, 3, 9, 0), "FREQ=DAILY;COUNT=4", date(2026, 9, 1))
check("daily: count caps the run",
      got, [date(2026, 8, 3), date(2026, 8, 4), date(2026, 8, 5), date(2026, 8, 6)])

got = occurrences(datetime(2026, 8, 3, 9, 0), "FREQ=DAILY;INTERVAL=3", date(2026, 8, 13))
check("daily: interval 3",
      got, [date(2026, 8, 3), date(2026, 8, 6), date(2026, 8, 9), date(2026, 8, 12)])

# Biweekly Wednesday, the shape most real meetings have.
got = occurrences(datetime(2026, 5, 6, 11, 0), "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE",
                  date(2026, 7, 1))
check("weekly: interval 2 stays on Wednesdays",
      got, [date(2026, 5, 6), date(2026, 5, 20), date(2026, 6, 3),
            date(2026, 6, 17), date(2026, 7, 1)])
check_true("weekly: every occurrence is a Wednesday",
           all(d.weekday() == 2 for d in got))
check_true("weekly: gaps are exactly 14 days",
           {(b - a).days for a, b in zip(got, got[1:])} == {14})

# Several weekdays in one week, emitted in week order.
got = occurrences(datetime(2026, 8, 3, 9, 0), "FREQ=WEEKLY;BYDAY=MO,WE,FR",
                  date(2026, 8, 12))
check("weekly: multiple weekdays",
      got, [date(2026, 8, 3), date(2026, 8, 5), date(2026, 8, 7),
            date(2026, 8, 10), date(2026, 8, 12)])

# No BYDAY: the weekday is taken from DTSTART.
got = occurrences(datetime(2026, 8, 4, 9, 0), "FREQ=WEEKLY", date(2026, 8, 25))
check("weekly: weekday from dtstart",
      got, [date(2026, 8, 4), date(2026, 8, 11), date(2026, 8, 18), date(2026, 8, 25)])
check_true("weekly: dtstart weekday preserved", all(d.weekday() == 1 for d in got))

# UNTIL in the past yields nothing at all in a later window.
got = occurrences(datetime(2025, 9, 13, 15, 0),
                  "FREQ=MONTHLY;BYDAY=WE;BYSETPOS=2;UNTIL=20251008T125959Z",
                  date(2027, 1, 1), from_date=date(2026, 7, 13))
check("until: expired series is silent in a later window", got, [])


# ------------------------------------------------------------------ MONTHLY

# First Thursday of the month, cross-checked by independent arithmetic.
got = occurrences(datetime(2026, 2, 5, 15, 0), "FREQ=MONTHLY;BYSETPOS=1;BYDAY=TH",
                  date(2027, 3, 31))
for d in got:
    first_th = min(x for x in range(1, 8) if date(d.year, d.month, x).weekday() == 3)
    check("monthly bysetpos: %s is the 1st Thursday" % d, (d.day, d.weekday()),
          (first_th, 3))
check("monthly bysetpos: no month skipped", len(got), 14)

# Ordinal BYDAY without BYSETPOS must agree with BYSETPOS on the same day.
a = occurrences(datetime(2026, 1, 7, 9, 0), "FREQ=MONTHLY;BYDAY=1WE", date(2026, 12, 31))
b = occurrences(datetime(2026, 1, 7, 9, 0), "FREQ=MONTHLY;BYDAY=WE;BYSETPOS=1",
                date(2026, 12, 31))
check("monthly: ordinal BYDAY == BYSETPOS equivalent", a, b)
check("monthly: 12 first-Wednesdays in 2026", len(a), 12)

# Last Friday, including a month where that is the 5th Friday.
got = occurrences(datetime(2026, 1, 30, 9, 0), "FREQ=MONTHLY;BYDAY=-1FR",
                  date(2026, 6, 30))
for d in got:
    last_fr = max(x for x in range(1, tb.month_len(d.year, d.month) + 1)
                  if date(d.year, d.month, x).weekday() == 4)
    check("monthly: %s is the last Friday" % d, d.day, last_fr)

# INTERVAL on months, and the year rolling over correctly.
got = occurrences(datetime(2026, 11, 10, 9, 0), "FREQ=MONTHLY;INTERVAL=3",
                  date(2027, 9, 1))
check("monthly: interval 3 rolls the year",
      got, [date(2026, 11, 10), date(2027, 2, 10), date(2027, 5, 10),
            date(2027, 8, 10)])


# ------------------------------------------------------------------- YEARLY

got = occurrences(datetime(2020, 3, 14, 0, 0), "FREQ=YEARLY", date(2027, 12, 31),
                  from_date=date(2025, 1, 1))
check("yearly: same day each year",
      got, [date(2025, 3, 14), date(2026, 3, 14), date(2027, 3, 14)])

got = occurrences(datetime(2026, 5, 1, 9, 0), "FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=1",
                  date(2028, 12, 31))
check("yearly: bymonth + bymonthday",
      got, [date(2026, 5, 1), date(2027, 5, 1), date(2028, 5, 1)])


# ------------------------------------------------------ EXDATE / RDATE parsing

tz_berlin = tb.resolve_tz("Europe/Berlin")

ex = tb.collect_exception_dates(
    ["EXDATE;TZID=Europe/Berlin:20260729T110000"], "EXDATE", tz_berlin, False)
want = int(datetime(2026, 7, 29, 11, 0, tzinfo=tz_berlin).timestamp() * US)
check("exdate: TZID form resolves to the right instant", ex, {want})

ex = tb.collect_exception_dates(
    ["EXDATE:20231128T120000Z"], "EXDATE", tz_berlin, False)
want = int(datetime(2023, 11, 28, 12, 0, tzinfo=timezone.utc).timestamp() * US)
check("exdate: Z form is UTC", ex, {want})

ex = tb.collect_exception_dates(
    ["EXDATE;VALUE=DATE:20260101"], "EXDATE", tz_berlin, False)
want = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * US)
check("exdate: VALUE=DATE is UTC midnight", ex, {want})

ex = tb.collect_exception_dates(
    ["EXDATE;TZID=Europe/Berlin:20260729T110000,20260805T110000"],
    "EXDATE", tz_berlin, False)
check("exdate: comma-separated values", len(ex), 2)

ex = tb.collect_exception_dates(["RDATE:20231114T120000Z"], "EXDATE",
                                tz_berlin, False)
check("exdate: RDATE line ignored when asking for EXDATE", ex, set())

ex = tb.collect_exception_dates(["EXDATE:nonsense"], "EXDATE", tz_berlin, False)
check("exdate: unparsable value dropped, no crash", ex, set())


# ------------------------------------------------------------------ timezones

check("tz: windows id mapped",
      str(tb.resolve_tz("W. Europe Standard Time")), "Europe/Berlin")
check("tz: GMT offset form",
      tb.resolve_tz("GMT+0200").utcoffset(None), timedelta(hours=2))
check("tz: floating has no zone", tb.resolve_tz("floating"), None)
check("tz: unknown id falls back to local", tb.resolve_tz("Mars/Olympus"),
      tb.LOCAL_TZ)
check_true("tz: unknown id recorded as a warning",
           "Mars/Olympus" in tb._tz_unknown)

# Regression: the local zone must be a real zone, not the offset that
# happened to be in force at import. A fixed offset would render winter
# appointments an hour wrong.
summer = datetime(2026, 8, 27, 12, 0, tzinfo=tb.LOCAL_TZ).utcoffset()
winter = datetime(2026, 12, 16, 12, 0, tzinfo=tb.LOCAL_TZ).utcoffset()
check("local tz: summer offset", summer, timedelta(hours=2))
check("local tz: winter offset differs from summer", winter, timedelta(hours=1))


# ------------------------------------------------------------------ prefs.js

# Regression: prefs.js is read as UTF-8; decoding it as unicode_escape
# turned "Persoenlich" into mojibake.
check("prefs: utf-8 survives", tb.unescape_pref("Zürich Büro – Persönlich"),
      "Zürich Büro – Persönlich")
check("prefs: \\uXXXX decoded", tb.unescape_pref("Caf\\u00e9"), "Café")
check("prefs: escaped quote", tb.unescape_pref('a \\" b'), 'a " b')
check("prefs: escaped backslash", tb.unescape_pref("a \\\\ b"), "a \\ b")
check("prefs: value parser strips quotes",
      tb.parse_pref_value('"Team Digital"'), "Team Digital")
check("prefs: booleans", (tb.parse_pref_value("true"),
                          tb.parse_pref_value("false")), (True, False))
check("prefs: integers", tb.parse_pref_value("42"), 42)


# --------------------------------------------------------------- expand_event

def row(**kw):
    base = {
        "id": "evt-1", "cal_id": "cal-1", "title": "Meeting",
        "event_start": 0, "event_end": 0, "flags": tb.FLAG_HAS_RECURRENCE,
        "event_start_tz": "Europe/Berlin", "event_end_tz": "Europe/Berlin",
        "ical_status": None, "recurrence_id": None,
    }
    base.update(kw)
    return base


def us_at(y, m, d, hh=0, mm=0, tz=None):
    return int(datetime(y, m, d, hh, mm, tzinfo=tz or tz_berlin).timestamp() * US)


win_start = us_at(2026, 8, 1)
# End of the window, not midnight starting the last day: an 11:00 event on
# 30 September must fall inside it.
win_end = us_at(2026, 10, 1)
warnings = []

# A weekly series with one instance excluded by EXDATE.
occ = tb.expand_event(
    row(event_start=us_at(2026, 8, 5, 11), event_end=us_at(2026, 8, 5, 12)),
    ["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE;TZID=Europe/Berlin:20260819T110000"],
    {}, win_start, win_end, warnings)
starts = [datetime.fromtimestamp(o["start_us"] / US, tz_berlin).date() for o in occ]
check("expand: exdate removed from the series",
      date(2026, 8, 19) in starts, False)
check("expand: the other Wednesdays survive",
      starts, [date(2026, 8, 5), date(2026, 8, 12), date(2026, 8, 26),
               date(2026, 9, 2), date(2026, 9, 9), date(2026, 9, 16),
               date(2026, 9, 23), date(2026, 9, 30)])

# A moved instance: the override replaces that occurrence.
master = row(event_start=us_at(2026, 8, 5, 11), event_end=us_at(2026, 8, 5, 12))
moved_from = us_at(2026, 8, 12, 11)
override = row(id="evt-1", title="Meeting (moved)",
               event_start=us_at(2026, 8, 13, 15),
               event_end=us_at(2026, 8, 13, 16),
               flags=0, recurrence_id=moved_from)
occ = tb.expand_event(master, ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
                      {moved_from: override}, win_start, win_end, warnings)
by_title = {o["title"] for o in occ}
check_true("expand: override title used", "Meeting (moved)" in by_title)
moved = [o for o in occ if o["title"] == "Meeting (moved)"]
check("expand: exactly one moved instance", len(moved), 1)
check("expand: moved to its new date",
      datetime.fromtimestamp(moved[0]["start_us"] / US, tz_berlin).date(),
      date(2026, 8, 13))
check_true("expand: original slot vacated",
           moved_from not in [o["start_us"] for o in occ])

# A cancelled instance disappears entirely.
cancelled = row(id="evt-1", flags=0, recurrence_id=moved_from,
                event_start=moved_from, event_end=moved_from,
                ical_status="CANCELLED")
occ = tb.expand_event(master, ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
                      {moved_from: cancelled}, win_start, win_end, warnings)
check_true("expand: cancelled instance dropped",
           moved_from not in [o["start_us"] for o in occ])

# RDATE adds a one-off instance to the series.
occ = tb.expand_event(
    row(event_start=us_at(2026, 8, 5, 11), event_end=us_at(2026, 8, 5, 12)),
    ["RRULE:FREQ=WEEKLY;BYDAY=WE", "RDATE;TZID=Europe/Berlin:20260807T110000"],
    {}, win_start, win_end, warnings)
starts = [datetime.fromtimestamp(o["start_us"] / US, tz_berlin).date() for o in occ]
check_true("expand: rdate added", date(2026, 8, 7) in starts)

# A weekly 11:00 meeting must still be 11:00 after the DST change.
occ = tb.expand_event(
    row(event_start=us_at(2026, 10, 21, 11), event_end=us_at(2026, 10, 21, 12)),
    ["RRULE:FREQ=WEEKLY;BYDAY=WE"], {},
    us_at(2026, 10, 1), us_at(2026, 11, 30), warnings)
times = {datetime.fromtimestamp(o["start_us"] / US, tz_berlin).strftime("%H:%M")
         for o in occ}
check("expand: wall-clock time held across the DST boundary", times, {"11:00"})
offsets = {datetime.fromtimestamp(o["start_us"] / US, tz_berlin).utcoffset()
           for o in occ}
check_true("expand: and the utc offset really did change",
           offsets == {timedelta(hours=2), timedelta(hours=1)})

# An event with no RRULE at all yields exactly itself.
occ = tb.expand_event(
    row(flags=0, event_start=us_at(2026, 8, 10, 9), event_end=us_at(2026, 8, 10, 10)),
    [], {}, win_start, win_end, warnings)
check("expand: non-recurring event yields one occurrence", len(occ), 1)

# A rule with no UNTIL/COUNT must stay bounded by the window, not run away.
occ = tb.expand_event(
    row(event_start=us_at(2020, 1, 1, 9), event_end=us_at(2020, 1, 1, 10)),
    ["RRULE:FREQ=DAILY"], {}, win_start, win_end, warnings)
# 31 August days + 30 September days; 1 October 09:00 is past the window end.
check("expand: unbounded daily rule clipped to the window", len(occ), 61)
# Regression: a long-running series must still reach the window. Counting
# from DTSTART exhausted the MAX_OCCURRENCES guard years before today and
# dropped the series from the calendar altogether.
check("expand: daily series running since 2014 still reaches today",
      len(tb.expand_event(
          row(event_start=us_at(2014, 1, 1, 9), event_end=us_at(2014, 1, 1, 10)),
          ["RRULE:FREQ=DAILY"], {}, win_start, win_end, warnings)), 61)
check_true("expand: weekly series since 2014 still reaches today",
           len(tb.expand_event(
               row(event_start=us_at(2014, 1, 1, 9), event_end=us_at(2014, 1, 1, 10)),
               ["RRULE:FREQ=WEEKLY;BYDAY=WE"], {}, win_start, win_end,
               warnings)) == 9)
# UNTIL is compared as an instant: the 15:00 local occurrence on the UNTIL
# date is past a 12:59:59Z cutoff and must be dropped.
occ = tb.expand_event(
    row(event_start=us_at(2025, 10, 8, 15), event_end=us_at(2025, 10, 8, 16)),
    ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20251008T125959Z"], {},
    us_at(2025, 10, 1), us_at(2025, 11, 1), warnings)
check("expand: until compares instants, not dates", len(occ), 0)


# ------------------------------------------------------- Meeting-Link

check("host_of: plain", tb.host_of("https://zoom.us/j/123"), "zoom.us")
check("host_of: subdomain and port",
      tb.host_of("https://correctiv.zoom.us:443/j/1"), "correctiv.zoom.us")
check("host_of: userinfo stripped",
      tb.host_of("https://user@meet.google.com/abc"), "meet.google.com")
check("host_of: uppercase folded", tb.host_of("HTTPS://ZOOM.US/j"), "zoom.us")
check("host_of: not a url", tb.host_of("Room 3"), "")
check("host_of: empty", tb.host_of(""), "")

check_true("meeting host: zoom subdomain",
           tb.is_meeting_host("https://correctiv.zoom.us/j/1"))
check_true("meeting host: bare zoom.us", tb.is_meeting_host("https://zoom.us/j/1"))
check_true("meeting host: teams", tb.is_meeting_host("https://teams.microsoft.com/l/x"))
check_true("meeting host: google meet",
           tb.is_meeting_host("https://meet.google.com/abc-defg-hij"))
check_true("meeting host: self-hosted bbb prefix",
           tb.is_meeting_host("https://bbb.correctiv.org/rooms/x/join"))
# The noise that made an allow-list necessary in the first place.
check_true("meeting host: google support is not a meeting",
           not tb.is_meeting_host("https://support.google.com/meet/answer/1"))
check_true("meeting host: a doc is not a meeting",
           not tb.is_meeting_host("https://docs.google.com/document/d/1"))
# tel.meet is the phone dial-in, and must not match on "meet" alone.
check_true("meeting host: dial-in is not a meeting",
           not tb.is_meeting_host("https://tel.meet/abc-defg"))
check_true("meeting host: lookalike domain rejected",
           not tb.is_meeting_host("https://notzoom.us.evil.example/j/1"))

check("urls_in: trailing period dropped",
      tb.urls_in("Join at https://zoom.us/j/123."), ["https://zoom.us/j/123"])
check("urls_in: trailing bracket dropped",
      tb.urls_in("(https://zoom.us/j/1)"), ["https://zoom.us/j/1"])
check("urls_in: several", len(tb.urls_in("a https://a.example b https://b.example")), 2)
check("urls_in: none", tb.urls_in("Room 3"), [])
check("urls_in: no text", tb.urls_in(None), [])

# Teams announces itself; that beats everything else.
check("meeting url: teams extension wins",
      tb.pick_meeting_url({
          "X-MICROSOFT-SKYPETEAMSMEETINGURL": "https://teams.microsoft.com/l/win",
          "LOCATION": "https://zoom.us/j/loser"}),
      "https://teams.microsoft.com/l/win")
# The location field is where a join link is put deliberately.
check("meeting url: location before description",
      tb.pick_meeting_url({"LOCATION": "https://zoom.us/j/win",
                           "DESCRIPTION": "https://meet.google.com/lose"}),
      "https://zoom.us/j/win")
check("meeting url: from the description when nowhere else",
      tb.pick_meeting_url({"DESCRIPTION":
                           "Zoom-Meeting\nhttps://correctiv.zoom.us/j/9\nID: 1"}),
      "https://correctiv.zoom.us/j/9")
# A known host anywhere beats an unknown host in the location.
check("meeting url: known host beats unknown location",
      tb.pick_meeting_url({"LOCATION": "https://intranet.example/room/3",
                           "DESCRIPTION": "https://zoom.us/j/real"}),
      "https://zoom.us/j/real")
# With no known host at all, only the location counts as intent.
check("meeting url: unknown host in location still used",
      tb.pick_meeting_url({"LOCATION": "https://intranet.example/room/3"}),
      "https://intranet.example/room/3")
check("meeting url: unknown host in description refused",
      tb.pick_meeting_url({"DESCRIPTION": "Slides: https://docs.google.com/d/1"}), "")
check("meeting url: URL property refused when not a meeting",
      tb.pick_meeting_url({"URL": "https://www.eventbrite.de/e/123"}), "")
check("meeting url: URL property used when it is a meeting",
      tb.pick_meeting_url({"URL": "https://meet.google.com/abc"}),
      "https://meet.google.com/abc")
check("meeting url: plain room name yields nothing",
      tb.pick_meeting_url({"LOCATION": "Meeting room 2"}), "")
check("meeting url: nothing at all", tb.pick_meeting_url({}), "")
# Never hand a non-http scheme to whatever opens the link.
check("meeting url: non-http scheme ignored",
      tb.pick_meeting_url({"LOCATION": "file:///etc/passwd"}), "")
check("meeting url: javascript scheme ignored",
      tb.pick_meeting_url({"DESCRIPTION": "javascript:alert(1)"}), "")

# ------------------------------------------------------------ Personen

p = tb.parse_ical_person(
    "ATTENDEE;CN=Max Mustermann;PARTSTAT=ACCEPTED;CUTYPE=INDIVIDUAL;"
    "EMAIL=max@example.org:mailto:max@example.org")
check("person: name", p["name"], "Max Mustermann")
check("person: email", p["email"], "max@example.org")
check("person: status", p["status"], "ACCEPTED")

p = tb.parse_ical_person("ORGANIZER;CN=Ada:mailto:ada@example.org")
check("person: organizer name", p["name"], "Ada")
check("person: email from mailto", p["email"], "ada@example.org")
check("person: no partstat", p["status"], "")

p = tb.parse_ical_person("ATTENDEE:mailto:nobody@example.org")
check("person: falls back to the address as the name",
      p["name"], "nobody@example.org")
p = tb.parse_ical_person('ATTENDEE;CN="Quoted, Name":mailto:q@example.org')
check("person: quoted CN unwrapped", p["name"], "Quoted, Name")
check("person: garbage", tb.parse_ical_person("ATTENDEE"), None)
check("person: empty", tb.parse_ical_person(""), None)
check("person: nameless and addressless", tb.parse_ical_person("ATTENDEE;ROLE=CHAIR:"), None)

# --------------------------------------------------- Serienbeschreibung

check("describe: weekly", tb.describe_rule("FREQ=WEEKLY;BYDAY=WE"),
      "Weekly on Wednesday")
check("describe: biweekly", tb.describe_rule("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"),
      "Every 2 weeks on Wednesday")
check("describe: several weekdays",
      tb.describe_rule("FREQ=WEEKLY;BYDAY=MO,WE"), "Weekly on Monday, Wednesday")
check("describe: daily", tb.describe_rule("FREQ=DAILY"), "Daily")
check("describe: every third day", tb.describe_rule("FREQ=DAILY;INTERVAL=3"),
      "Every 3 days")
check("describe: monthly by setpos",
      tb.describe_rule("FREQ=MONTHLY;BYSETPOS=1;BYDAY=TH"),
      "Monthly on the first Thursday")
check("describe: monthly by ordinal byday",
      tb.describe_rule("FREQ=MONTHLY;BYDAY=2WE"),
      "Monthly on the second Wednesday")
check("describe: monthly by day number",
      tb.describe_rule("FREQ=MONTHLY;BYMONTHDAY=1"), "Monthly on day 1")
check("describe: yearly", tb.describe_rule("FREQ=YEARLY"), "Yearly")
check("describe: count", tb.describe_rule("FREQ=DAILY;COUNT=5"), "Daily, 5 times")
check("describe: until",
      tb.describe_rule("FREQ=WEEKLY;BYDAY=TU;UNTIL=20260428T092959Z"),
      "Weekly on Tuesday, until 2026-04-28")
check("describe: unknown freq", tb.describe_rule("FREQ=FORTNIGHTLY"), "")
check("describe: nonsense", tb.describe_rule(""), "")

# --------------------------------------------------------------- build_payload

registry = {
    "cal-a": {"name": "Work", "color": "#111111", "enabled": True},
    "cal-b": {"name": "Team", "color": "#222222", "enabled": True},
}


def ev(cal_id="cal-a", title="Standup", allday=False,
       start=None, end=None, location=""):
    return {
        "id": "x", "cal_id": cal_id, "title": title, "allday": allday,
        "start_us": start, "end_us": end, "tz": "Europe/Berlin",
        "location": location,
    }


w0, w1 = date(2026, 8, 1), date(2026, 8, 31)

# The same appointment shared into two calendars is one row naming both.
payload = tb.build_payload([
    ev(cal_id="cal-a", start=us_at(2026, 8, 5, 9), end=us_at(2026, 8, 5, 10)),
    ev(cal_id="cal-b", start=us_at(2026, 8, 5, 9), end=us_at(2026, 8, 5, 10)),
], registry, w0, w1, [])
day = payload["days"]["2026-08-05"]
check("payload: duplicate across calendars merged", len(day), 1)
check("payload: both calendars named", sorted(day[0]["calendars"]), ["Team", "Work"])
check("payload: local start time", day[0]["time"], "09:00")
check("payload: local end time", day[0]["endTime"], "10:00")
check("payload: count reflects merged rows", payload["eventCount"], 1)

# Titles that differ only by surrounding whitespace are still one event.
payload = tb.build_payload([
    ev(cal_id="cal-a", title="Standup",
       start=us_at(2026, 8, 6, 9), end=us_at(2026, 8, 6, 10)),
    ev(cal_id="cal-b", title="Standup ",
       start=us_at(2026, 8, 6, 9), end=us_at(2026, 8, 6, 10)),
], registry, w0, w1, [])
check("payload: whitespace-only title difference merged",
      len(payload["days"]["2026-08-06"]), 1)

# All-day events: exclusive end date, one entry per covered day, sorted first.
payload = tb.build_payload([
    ev(title="Away", allday=True,
       start=int(datetime(2026, 8, 10, tzinfo=timezone.utc).timestamp() * US),
       end=int(datetime(2026, 8, 13, tzinfo=timezone.utc).timestamp() * US)),
    ev(title="Standup", start=us_at(2026, 8, 10, 9), end=us_at(2026, 8, 10, 10)),
], registry, w0, w1, [])
check("payload: all-day run covers 3 days, end exclusive",
      sorted(k for k, v in payload["days"].items()
             if any(e["title"] == "Away" for e in v)),
      ["2026-08-10", "2026-08-11", "2026-08-12"])
check("payload: all-day sorts before timed",
      [e["title"] for e in payload["days"]["2026-08-10"]], ["Away", "Standup"])
away = [e for e in payload["days"]["2026-08-11"] if e["title"] == "Away"][0]
check("payload: span recorded", away["spanDays"], 3)
check("payload: dayIndex on the middle day", away["dayIndex"], 1)
check_true("payload: all-day carries no time keys", "time" not in away)

# An event ending exactly at midnight must not appear on the next day.
payload = tb.build_payload([
    ev(title="Late", start=us_at(2026, 8, 20, 22), end=us_at(2026, 8, 21, 0)),
], registry, w0, w1, [])
check("payload: midnight end does not spill into the next day",
      sorted(payload["days"].keys()), ["2026-08-20"])

# One minute past midnight does spill, and only the first day shows a time.
payload = tb.build_payload([
    ev(title="Later", start=us_at(2026, 8, 20, 22), end=us_at(2026, 8, 21, 0, 30)),
], registry, w0, w1, [])
check("payload: real overnight event covers both days",
      sorted(payload["days"].keys()), ["2026-08-20", "2026-08-21"])
check("payload: continuation day has no start time",
      payload["days"]["2026-08-21"][0]["time"], "")
check("payload: first day has no end time",
      payload["days"]["2026-08-20"][0]["endTime"], "")

# Events outside the window are not emitted.
payload = tb.build_payload([
    ev(title="Old", start=us_at(2026, 7, 1, 9), end=us_at(2026, 7, 1, 10)),
], registry, w0, w1, [])
check("payload: out-of-window event dropped", payload["days"], {})

# Disabled calendars contribute no entry to the calendar list.
reg2 = dict(registry)
reg2["cal-c"] = {"name": "Hidden", "color": "#333", "enabled": False}
payload = tb.build_payload([], reg2, w0, w1, [])
check("payload: disabled calendar not listed",
      [c["name"] for c in payload["calendars"]], ["Team", "Work"])

# Location is carried, and omitted rather than empty when unknown.
payload = tb.build_payload([
    ev(title="With", start=us_at(2026, 8, 7, 9), end=us_at(2026, 8, 7, 10),
       location="Room 1"),
    ev(title="Without", start=us_at(2026, 8, 7, 11), end=us_at(2026, 8, 7, 12)),
], registry, w0, w1, [])
rows = {e["title"]: e for e in payload["days"]["2026-08-07"]}
check("payload: location kept", rows["With"]["location"], "Room 1")
check_true("payload: absent location omitted", "location" not in rows["Without"])

# A merged event keeps whichever location was known.
payload = tb.build_payload([
    ev(cal_id="cal-a", title="Shared",
       start=us_at(2026, 8, 8, 9), end=us_at(2026, 8, 8, 10)),
    ev(cal_id="cal-b", title="Shared", location="Room 2",
       start=us_at(2026, 8, 8, 9), end=us_at(2026, 8, 8, 10)),
], registry, w0, w1, [])
check("payload: location recovered from the duplicate",
      payload["days"]["2026-08-08"][0]["location"], "Room 2")

# An untitled event still renders as something.
payload = tb.build_payload([
    ev(title="", start=us_at(2026, 8, 9, 9), end=us_at(2026, 8, 9, 10)),
], registry, w0, w1, [])
check("payload: empty title gets a placeholder",
      payload["days"]["2026-08-09"][0]["title"], "(no title)")
# Whitespace-only is as empty as empty.
payload = tb.build_payload([
    ev(title="   ", start=us_at(2026, 8, 9, 11), end=us_at(2026, 8, 9, 12)),
], registry, w0, w1, [])
check("payload: whitespace-only title gets the placeholder too",
      payload["days"]["2026-08-09"][0]["title"], "(no title)")

# Contract-level shape: no sortKey leaks into the output.
payload = tb.build_payload([
    ev(start=us_at(2026, 8, 5, 9), end=us_at(2026, 8, 5, 10)),
], registry, w0, w1, ["a warning"])
check_true("payload: internal sortKey stripped",
           all("sortKey" not in e for evs in payload["days"].values() for e in evs))
check("payload: timezone reported", payload["timezone"], "Europe/Berlin")
check("payload: warnings passed through", payload["warnings"], ["a warning"])
check("payload: window echoed",
      (payload["windowStart"], payload["windowEnd"]), ("2026-08-01", "2026-08-31"))


# ------------------------------------------------------------------- report

if FAILURES:
    print("FAIL  %d of %d checks" % (len(FAILURES), CHECKS[0]))
    for f in FAILURES:
        print("  x  %s" % f)
    sys.exit(1)
print("ok    %d checks passed" % CHECKS[0])
