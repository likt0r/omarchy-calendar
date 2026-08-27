// Lookup over the events.json that omarchy-calendar-sync writes from the
// Thunderbird calendar caches. Pure JS and Qt-free, the same way Model.js
// next door is: the QML owns rendering and locale, this owns the data.
//
// The file is a day-keyed map ("2026-08-27" -> [event, ...]) already sorted
// by the exporter, so the panel never has to sort or expand anything at
// paint time.

var MAX_DOTS = 3

function emptyData() {
  return { days: {}, generated: "", eventCount: 0, calendars: [] }
}

// A malformed or half-written file must never take the calendar down with
// it -- the grid is useful with no events at all, so parse failures fall
// back to empty rather than throwing.
function parse(raw) {
  var text = String(raw === undefined || raw === null ? "" : raw)
  if (text.replace(/^\s+|\s+$/g, "") === "") return emptyData()
  try {
    var parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object" || !parsed.days) return emptyData()
    return {
      days: parsed.days,
      generated: String(parsed.generated || ""),
      eventCount: Number(parsed.eventCount || 0),
      calendars: parsed.calendars || []
    }
  } catch (e) {
    return emptyData()
  }
}

function forDay(data, key) {
  if (!data || !data.days) return []
  var list = data.days[String(key)]
  return list ? list : []
}

function countForDay(data, key) {
  return forDay(data, key).length
}

// Distinct calendar colors for the day, capped: the marker under a date is
// a hint that something is there, not a legend. Distinct rather than
// per-event, so three meetings in one calendar read as one calendar.
function dotColors(data, key) {
  var events = forDay(data, key)
  var out = []
  for (var i = 0; i < events.length && out.length < MAX_DOTS; i++) {
    var color = String(events[i].color || "")
    if (color !== "" && out.indexOf(color) === -1) out.push(color)
  }
  return out
}

// True when the day holds more than the dots can show, so the cell can
// mark the overflow instead of silently dropping it.
function hasMoreThanDots(data, key) {
  var events = forDay(data, key)
  var seen = []
  for (var i = 0; i < events.length; i++) {
    var color = String(events[i].color || "")
    if (color !== "" && seen.indexOf(color) === -1) seen.push(color)
  }
  return seen.length > MAX_DOTS
}

// "14:00", or "14:00 – 15:00" once the end is known and differs. All-day
// events carry no time at all and are labelled by the caller.
function timeLabel(event) {
  if (!event || event.allDay) return ""
  var start = String(event.time || "")
  var end = String(event.endTime || "")
  if (start === "") return end === "" ? "" : "– " + end
  if (end === "" || end === start) return start
  return start + " – " + end
}

// Multi-day events repeat on every day they cover; only the first day
// carries the real start time, so the others say where in the run they are.
function spanLabel(event) {
  if (!event || Number(event.spanDays || 1) <= 1) return ""
  return "day " + (Number(event.dayIndex || 0) + 1) + " of " + Number(event.spanDays)
}

function calendarLabel(event) {
  if (!event || !event.calendars || event.calendars.length === 0) return ""
  return event.calendars.join(" · ")
}

if (typeof module !== "undefined") {
  module.exports = {
    MAX_DOTS: MAX_DOTS,
    emptyData: emptyData,
    parse: parse,
    forDay: forDay,
    countForDay: countForDay,
    dotColors: dotColors,
    hasMoreThanDots: hasMoreThanDots,
    timeLabel: timeLabel,
    spanLabel: spanLabel,
    calendarLabel: calendarLabel
  }
}
