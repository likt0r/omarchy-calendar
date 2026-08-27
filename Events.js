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

// ---- Visibility. Hiding a calendar and hiding past entries both have to
//      reach the markers under the dates as well as the agenda, or the grid
//      would promise events the agenda then refuses to show. Both take a
//      list of already-filtered events for exactly that reason.

// An event is hidden only when *every* calendar it appears in is hidden: a
// meeting shared into a hidden team calendar and your own is still yours.
function isHidden(event, hiddenNames) {
  if (!hiddenNames || hiddenNames.length === 0) return false
  var cals = (event && event.calendars) || []
  if (cals.length === 0) return false
  for (var i = 0; i < cals.length; i++)
    if (hiddenNames.indexOf(String(cals[i])) === -1) return false
  return true
}

// Past means "already over", not "earlier today": a meeting running right
// now is still current. Comparison is on the pre-rendered local "HH:MM"
// strings the contract guarantees, so no timezone maths happens here.
function isPast(event, dayKey, todayKey, nowHM) {
  if (!event || !dayKey || !todayKey) return false
  var day = String(dayKey), today = String(todayKey)
  if (day < today) return true
  if (day > today) return false
  // An all-day entry belongs to the whole day, so it is never past on it.
  if (event.allDay) return false
  var end = String(event.endTime || "")
  if (end === "") {
    // A middle day of a multi-day run has neither time; it is still running.
    var start = String(event.time || "")
    if (start === "") return false
    return start < String(nowHM || "")
  }
  return end <= String(nowHM || "")
}

// opts: { hidden: [calendar names], hidePast: bool, todayKey, nowHM }
function visibleForDay(data, key, opts) {
  var events = forDay(data, key)
  var o = opts || {}
  var hidden = o.hidden || []
  if (hidden.length === 0 && !o.hidePast) return events
  var out = []
  for (var i = 0; i < events.length; i++) {
    if (isHidden(events[i], hidden)) continue
    if (o.hidePast && isPast(events[i], key, o.todayKey, o.nowHM)) continue
    out.push(events[i])
  }
  return out
}

// Distinct calendar colors, capped: the marker under a date is a hint that
// something is there, not a legend. Distinct rather than per-event, so three
// meetings in one calendar read as one calendar.
function dotColors(events) {
  var list = events || []
  var out = []
  for (var i = 0; i < list.length && out.length < MAX_DOTS; i++) {
    var color = String(list[i].color || "")
    if (color !== "" && out.indexOf(color) === -1) out.push(color)
  }
  return out
}

// True when the day holds more calendars than the dots can show, so the cell
// can mark the overflow instead of silently dropping it.
function hasMoreThanDots(events) {
  var list = events || []
  var seen = []
  for (var i = 0; i < list.length; i++) {
    var color = String(list[i].color || "")
    if (color !== "" && seen.indexOf(color) === -1) seen.push(color)
  }
  return seen.length > MAX_DOTS
}

// ---- The calendar list behind the settings screen.

// Every calendar the exporter reported, with its hidden state resolved, in
// the order the file lists them (the exporter sorts by name).
function calendarRows(data, hiddenNames) {
  var cals = (data && data.calendars) || []
  var hidden = hiddenNames || []
  var out = []
  for (var i = 0; i < cals.length; i++) {
    var name = String(cals[i].name || "")
    if (name === "") continue
    out.push({
      name: name,
      color: String(cals[i].color || "#888888"),
      hidden: hidden.indexOf(name) !== -1
    })
  }
  return out
}

// Returns a new list rather than mutating: the caller persists whatever comes
// back, and an in-place splice would not register as a changed property.
function toggleHidden(hiddenNames, name) {
  var out = []
  var text = String(name)
  var found = false
  var list = hiddenNames || []
  for (var i = 0; i < list.length; i++) {
    if (String(list[i]) === text) { found = true; continue }
    out.push(String(list[i]))
  }
  if (!found) out.push(text)
  out.sort()
  return out
}

// Names that no longer exist in the file are dropped: a calendar removed in
// Thunderbird should not keep a stale entry alive in shell.json forever.
function pruneHidden(hiddenNames, data) {
  var cals = (data && data.calendars) || []
  if (cals.length === 0) return (hiddenNames || []).slice()
  var known = []
  for (var i = 0; i < cals.length; i++) known.push(String(cals[i].name || ""))
  var out = []
  var list = hiddenNames || []
  for (var j = 0; j < list.length; j++)
    if (known.indexOf(String(list[j])) !== -1) out.push(String(list[j]))
  return out
}

// shell.json is hand-editable, so the stored value may be anything.
function normalizeHidden(value) {
  // A string has a length too, and would come apart into single letters.
  if (!value || typeof value === "string" || typeof value.length !== "number")
    return []
  var out = []
  for (var i = 0; i < value.length; i++) {
    var name = String(value[i] === undefined || value[i] === null ? "" : value[i])
    if (name !== "" && out.indexOf(name) === -1) out.push(name)
  }
  return out
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
    isHidden: isHidden,
    isPast: isPast,
    visibleForDay: visibleForDay,
    dotColors: dotColors,
    hasMoreThanDots: hasMoreThanDots,
    calendarRows: calendarRows,
    toggleHidden: toggleHidden,
    pruneHidden: pruneHidden,
    normalizeHidden: normalizeHidden,
    timeLabel: timeLabel,
    spanLabel: spanLabel,
    calendarLabel: calendarLabel
  }
}
