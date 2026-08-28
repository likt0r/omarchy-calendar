// Lookup over the events.json that omarchy-calendar-sync writes from the
// Thunderbird calendar caches. Pure JS and Qt-free, the same way Model.js
// next door is: the QML owns rendering and locale, this owns the data.
//
// The file is a day-keyed map ("2026-08-27" -> [event, ...]) already sorted
// by the exporter, so the panel never has to sort or expand anything at
// paint time.

var MAX_DOTS = 3

function emptyData() {
  return { days: {}, details: {}, generated: "", eventCount: 0, calendars: [] }
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
      details: parseDetails(parsed),
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

// Ongoing is the other end of isPast: begun and not yet over, today. It is
// the one state the agenda lights up rather than dims, because it answers
// "where am I supposed to be right now". An all-day entry is deliberately
// never ongoing -- a birthday or a week of leave is true all day and would
// leave the mark burning from midnight to midnight, saying nothing.
function isOngoing(event, dayKey, todayKey, nowHM) {
  if (!event || !dayKey || !todayKey) return false
  if (String(dayKey) !== String(todayKey)) return false
  if (event.allDay) return false
  if (isPast(event, dayKey, todayKey, nowHM)) return false
  var start = String(event.time || "")
  // A middle day of a multi-day run carries neither time and is running by
  // definition -- the same reading isPast takes of it.
  if (start === "") return true
  return start <= String(nowHM || "")
}

// Where the "now" line belongs in a day's agenda: the number of entries that
// sort above it. -1 means "do not draw it at all" -- on any day but today, on
// an empty list, and while something is running, since the lit row already
// says where now is and a second mark for the same fact only crowds it.
function nowMarkerIndex(events, dayKey, todayKey, nowHM) {
  if (!events || events.length === 0) return -1
  if (!dayKey || !todayKey || String(dayKey) !== String(todayKey)) return -1
  var i
  for (i = 0; i < events.length; i++)
    if (isOngoing(events[i], dayKey, todayKey, nowHM)) return -1
  // The exporter sorts all-day entries first and the rest by start, so the
  // line falls after everything that has already begun. All-day entries have
  // no place on the clock and stay above it whatever the hour.
  var now = String(nowHM || "")
  for (i = 0; i < events.length; i++) {
    var e = events[i] || {}
    if (e.allDay) continue
    var start = String(e.time || "")
    if (start !== "" && start > now) break
  }
  return i
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

// ---- Details behind the side panel. The events file keeps them in a shared
//      map so a recurring series stores its invitation text once instead of
//      once per occurrence; an event points at its record by key.

function parseDetails(parsed) {
  var table = parsed && parsed.details
  return (table && typeof table === "object") ? table : {}
}

function detailFor(data, event) {
  if (!data || !event) return {}
  var key = String(event.detail || "")
  if (key === "") return {}
  var record = data.details ? data.details[key] : null
  return record ? record : {}
}

function hasDetail(data, event) {
  var record = detailFor(data, event)
  for (var k in record) return true
  return false
}

// A click on this opens it, so the scheme is checked here as well as in the
// exporter: whatever writes the file is not necessarily the exporter shipped
// alongside, and a file: or javascript: URL must never reach the opener.
function meetingUrl(data, event) {
  var url = String(detailFor(data, event).meetingUrl || "")
  if (/^https?:\/\/[^\s]+$/.test(url)) return url
  return ""
}

// Conferencing boilerplate that gets pasted into the location field next to
// the link. Once the join icon carries the link, what is left of a line like
// this is not a place, and the code it names is already in the link's own
// query string. Extend the list rather than the logic.
var ACCESS_MARKERS = ["meeting-id", "meeting id", "meetingid",
                      "konferenz-id", "conference id",
                      "kenncode", "kenncode", "passcode", "password",
                      "access code", "zugangscode", "pin:"]

function collapseSpace(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/\s+/g, " ").replace(/^ +| +$/g, "")
}

// Separators that only earned their place while the link was still there.
function trimSeparators(text) {
  return String(text || "")
    .replace(/^[\s/,;:·|\u2014\u2013-]+/, "")
    .replace(/[\s/,;:·|\u2014\u2013-]+$/, "")
}

function isAccessDetail(text) {
  var lower = String(text || "").toLowerCase()
  for (var i = 0; i < ACCESS_MARKERS.length; i++)
    if (lower.indexOf(ACCESS_MARKERS[i]) === 0) return true
  return false
}

// The location with the join link taken out of it. Very often the location
// *is* the link, and then this is empty and nothing should be printed: the
// camera icon already offers it. A room name sharing the field with a link
// survives; the link's own access details do not.
function locationLabel(event, url) {
  var text = String((event && event.location) || "")
  var link = String(url || "")
  if (text === "" || link === "") return collapseSpace(text)
  var at = text.indexOf(link)
  if (at === -1) return collapseSpace(text)

  var out = []
  var sides = [text.slice(0, at), text.slice(at + link.length)]
  for (var i = 0; i < sides.length; i++) {
    var piece = trimSeparators(collapseSpace(sides[i]))
    if (piece === "" || isAccessDetail(piece)) continue
    out.push(piece)
  }
  return out.join("  \u00b7  ")
}

// Host and first path segment: enough to recognise the service without
// pasting a hundred characters of meeting token into the panel.
function shortUrl(url) {
  var text = String(url || "")
  var m = /^https?:\/\/([^\/?#]+)([^?#]*)/.exec(text)
  if (!m) return text
  var host = m[1].replace(/^www\./, "")
  var path = String(m[2] || "").replace(/\/+$/, "")
  if (path === "" || path === "/") return host
  var parts = path.split("/").filter(function(p) { return p !== "" })
  return host + "/" + parts[0] + (parts.length > 1 ? "/\u2026" : "")
}

// ACCEPTED / DECLINED / TENTATIVE / NEEDS-ACTION as one glyph, so a list of
// thirty people stays scannable.
function attendeeMark(status) {
  switch (String(status || "").toUpperCase()) {
    case "ACCEPTED": return "\u2713"
    case "DECLINED": return "\u2715"
    case "TENTATIVE": return "?"
    default: return "\u00b7"
  }
}

function attendeeOverflow(detail) {
  var listed = (detail && detail.attendees) ? detail.attendees.length : 0
  var total = Number((detail && detail.attendeeCount) || listed)
  return total > listed ? total - listed : 0
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
    isOngoing: isOngoing,
    nowMarkerIndex: nowMarkerIndex,
    visibleForDay: visibleForDay,
    dotColors: dotColors,
    hasMoreThanDots: hasMoreThanDots,
    detailFor: detailFor,
    hasDetail: hasDetail,
    meetingUrl: meetingUrl,
    shortUrl: shortUrl,
    collapseSpace: collapseSpace,
    isAccessDetail: isAccessDetail,
    locationLabel: locationLabel,
    attendeeMark: attendeeMark,
    attendeeOverflow: attendeeOverflow,
    calendarRows: calendarRows,
    toggleHidden: toggleHidden,
    pruneHidden: pruneHidden,
    normalizeHidden: normalizeHidden,
    timeLabel: timeLabel,
    spanLabel: spanLabel,
    calendarLabel: calendarLabel
  }
}
