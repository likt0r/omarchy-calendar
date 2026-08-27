#!/usr/bin/env python3
"""Checks the demo exporter against the contract in exporters/README.md.

Doubling as an executable form of that contract: the rules asserted here are
exactly the ones the panel relies on, so a new exporter can be pointed at
this file to find out what "writes the contract" actually means.

Run: python3 -B tests/contract-test.py
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

FAILURES = []
CHECKS = [0]


def check(label, got, want):
    CHECKS[0] += 1
    if got != want:
        FAILURES.append("%s\n     got:  %r\n     want: %r" % (label, got, want))


def check_true(label, value):
    check(label, bool(value), True)


with tempfile.TemporaryDirectory(prefix="contract-") as tmp:
    out = os.path.join(tmp, "nested", "events.json")
    proc = subprocess.run(
        [sys.executable, "-B", os.path.join(ROOT, "exporters", "demo"),
         "--out", out],
        capture_output=True, text=True)
    check("demo: exits cleanly", proc.returncode, 0)
    check_true("demo: creates missing directories", os.path.exists(out))
    # Nothing may be left behind by the atomic write.
    check("demo: no temp file left behind", os.path.exists(out + ".tmp"), False)

    with open(out, encoding="utf-8") as fh:
        payload = json.load(fh)

# ------------------------------------------------------------- top level

for field in ("generated", "windowStart", "windowEnd", "timezone",
              "eventCount", "calendars", "days", "warnings"):
    check_true("top level: %s present" % field, field in payload)

check("top level: eventCount matches the days",
      payload["eventCount"],
      sum(len(v) for v in payload["days"].values()))
check_true("top level: calendars is a list of name+color",
           all(set(c) >= {"name", "color"} for c in payload["calendars"]))
check_true("top level: warnings is a list", isinstance(payload["warnings"], list))
check_true("top level: window covers the day keys",
           payload["windowStart"] <= min(payload["days"])
           and max(payload["days"]) <= payload["windowEnd"])

# ------------------------------------------------------------- each event

for key, events in payload["days"].items():
    check("day key is ISO: %s" % key, len(key), 10)
    check_true("day %s: not empty" % key, len(events) > 0)

    # Pre-sorted: all-day first, then by start time.
    order = [(0 if e["allDay"] else 1, e.get("time", "")) for e in events]
    check("day %s: pre-sorted, all-day first" % key, order, sorted(order))

    for e in events:
        for field in ("title", "allDay", "color", "calendars",
                      "spanDays", "dayIndex"):
            check_true("day %s / %s: %s present" % (key, e["title"], field),
                       field in e)
        check_true("day %s / %s: title not empty" % (key, e["title"]),
                   str(e["title"]).strip() != "")
        check_true("day %s / %s: calendars non-empty" % (key, e["title"]),
                   len(e["calendars"]) > 0)
        check_true("day %s / %s: dayIndex within span" % (key, e["title"]),
                   0 <= e["dayIndex"] < e["spanDays"])
        if e["allDay"]:
            check_true("day %s / %s: all-day carries no time" % (key, e["title"]),
                       "time" not in e and "endTime" not in e)
        else:
            check_true("day %s / %s: timed carries time keys" % (key, e["title"]),
                       "time" in e and "endTime" in e)
            check_true("day %s / %s: iso start is local, not UTC" % (key, e["title"]),
                       not str(e.get("start", "")).endswith("Z"))
        if "location" in e:
            check_true("day %s / %s: location not empty when present"
                       % (key, e["title"]), str(e["location"]).strip() != "")

# A multi-day event must appear on every day it covers, exactly once each.
runs = {}
for key, events in payload["days"].items():
    for e in events:
        if e["spanDays"] > 1:
            runs.setdefault((e["title"], e["spanDays"]), []).append(e["dayIndex"])
check_true("multi-day events cover every day of the run exactly once",
           all(sorted(idx) == list(range(span))
               for (title, span), idx in runs.items()))
check_true("the demo actually exercises a multi-day event", len(runs) > 0)
check_true("the demo actually exercises an all-day event",
           any(e["allDay"] for v in payload["days"].values() for e in v))
check_true("the demo actually exercises a location",
           any("location" in e for v in payload["days"].values() for e in v))

if FAILURES:
    print("FAIL  %d of %d checks" % (len(FAILURES), CHECKS[0]))
    for f in FAILURES:
        print("  x  %s" % f)
    sys.exit(1)
print("ok    %d checks passed" % CHECKS[0])
