// Tests for Events.js, the panel's lookup layer.
//
// Everything here is about what the QML then paints, so the cases are the
// ones that would show up as a wrong calendar: a malformed file taking the
// panel down, dots that miscount calendars, a time label that lies.
//
// Run: node tests/events-test.js

const path = require('path')
const Events = require(path.join(__dirname, '..', 'Events.js'))

const failures = []
let checks = 0

function check(label, got, want) {
  checks++
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) failures.push(`${label}\n     got:  ${g}\n     want: ${w}`)
}

function checkTrue(label, value) { check(label, !!value, true) }

// ------------------------------------------------------------------- parse

check('parse: empty string yields empty data', Events.parse('').eventCount, 0)
check('parse: whitespace only', Events.parse('   \n ').eventCount, 0)
check('parse: null', Events.parse(null).eventCount, 0)
check('parse: undefined', Events.parse(undefined).eventCount, 0)
check('parse: truncated json', Events.parse('{"days":{').eventCount, 0)
check('parse: json without days', Events.parse('{"eventCount":5}').eventCount, 0)
check('parse: a bare array', Events.parse('[1,2,3]').eventCount, 0)
check('parse: json null', Events.parse('null').eventCount, 0)
check('parse: empty days object is valid', Events.parse('{"days":{}}').days, {})

const raw = JSON.stringify({
  generated: '2026-08-27T12:03:00+02:00',
  eventCount: 4,
  calendars: [{ name: 'Work', color: '#111' }],
  days: {
    '2026-08-27': [
      { title: 'Away', allDay: true, color: '#aaa', calendars: ['Personal'],
        spanDays: 3, dayIndex: 1 },
      { title: 'Standup', allDay: false, color: '#111', calendars: ['Work'],
        time: '09:30', endTime: '09:45', spanDays: 1, dayIndex: 0 },
      { title: 'Review', allDay: false, color: '#111', calendars: ['Work', 'Team'],
        time: '11:00', endTime: '11:00', spanDays: 1, dayIndex: 0,
        location: 'Room 2' },
      { title: 'Retro', allDay: false, color: '#222', calendars: ['Team'],
        time: '15:00', endTime: '16:00', spanDays: 1, dayIndex: 0 }
    ]
  },
  warnings: []
})
const data = Events.parse(raw)
check('parse: eventCount read', data.eventCount, 4)
check('parse: generated read', data.generated, '2026-08-27T12:03:00+02:00')
check('parse: calendars read', data.calendars.length, 1)

// ------------------------------------------------------------------ lookup

check('forDay: known day', Events.forDay(data, '2026-08-27').length, 4)
check('forDay: unknown day', Events.forDay(data, '2026-01-01'), [])
check('forDay: empty data', Events.forDay(Events.emptyData(), '2026-08-27'), [])
check('forDay: null data', Events.forDay(null, '2026-08-27'), [])
check('countForDay: known', Events.countForDay(data, '2026-08-27'), 4)
check('countForDay: unknown', Events.countForDay(data, '2026-01-01'), 0)

// --------------------------------------------------------------------- dots

// Distinct colors, in first-seen order: three meetings in one calendar are
// one calendar, not a crowd.
check('dotColors: distinct colors in order',
  Events.dotColors(Events.forDay(data, '2026-08-27')), ['#aaa', '#111', '#222'])
check('dotColors: unknown day',
  Events.dotColors(Events.forDay(data, '2026-01-01')), [])
check('dotColors: empty list', Events.dotColors([]), [])
check('dotColors: null list', Events.dotColors(null), [])
check('dotColors: capped at MAX_DOTS', Events.MAX_DOTS, 3)

const many = Events.parse(JSON.stringify({
  days: { d: [1, 2, 3, 4, 5].map(n => ({ title: 't' + n, color: '#' + n + n + n })) }
}))
check('dotColors: five calendars capped to three',
  Events.dotColors(Events.forDay(many, 'd')).length, 3)
checkTrue('hasMoreThanDots: true beyond the cap',
  Events.hasMoreThanDots(Events.forDay(many, 'd')))
checkTrue('hasMoreThanDots: false at exactly three',
  !Events.hasMoreThanDots(Events.forDay(data, '2026-08-27')))
checkTrue('hasMoreThanDots: false on an empty list',
  !Events.hasMoreThanDots([]))

// A colorless event must not become a phantom dot.
const noColor = Events.parse(JSON.stringify({
  days: { d: [{ title: 'x' }, { title: 'y', color: '#123' }] }
}))
check('dotColors: missing color skipped',
  Events.dotColors(Events.forDay(noColor, 'd')), ['#123'])

// --------------------------------------------------------------- visibility

// Hiding a calendar
const shared = { title: 'Shared', calendars: ['Work', 'Team'], color: '#111' }
const workOnly = { title: 'Work only', calendars: ['Work'], color: '#111' }
const noCal = { title: 'Orphan', calendars: [], color: '#111' }

checkTrue('isHidden: nothing hidden', !Events.isHidden(workOnly, []))
checkTrue('isHidden: undefined list', !Events.isHidden(workOnly, undefined))
checkTrue('isHidden: its only calendar hidden',
  Events.isHidden(workOnly, ['Work']))
// A meeting shared into a hidden calendar and a visible one is still yours.
checkTrue('isHidden: one of two calendars hidden keeps it visible',
  !Events.isHidden(shared, ['Team']))
checkTrue('isHidden: both calendars hidden hides it',
  Events.isHidden(shared, ['Work', 'Team']))
checkTrue('isHidden: an event with no calendar is never hidden',
  !Events.isHidden(noCal, ['Work']))
checkTrue('isHidden: unrelated hidden name', !Events.isHidden(workOnly, ['Other']))

// Past detection, against today = 2026-08-27 at 12:00
const T = '2026-08-27', NOW = '12:00'
const ended = { title: 'a', allDay: false, time: '09:00', endTime: '10:00' }
const running = { title: 'b', allDay: false, time: '11:30', endTime: '12:30' }
const later = { title: 'c', allDay: false, time: '15:00', endTime: '16:00' }
const allDay = { title: 'd', allDay: true }

checkTrue('isPast: an earlier day is past', Events.isPast(ended, '2026-08-26', T, NOW))
checkTrue('isPast: a later day is not', !Events.isPast(ended, '2026-08-28', T, NOW))
checkTrue('isPast: finished earlier today', Events.isPast(ended, T, T, NOW))
// Running right now is current, not past -- that is the whole point.
checkTrue('isPast: still running is not past', !Events.isPast(running, T, T, NOW))
checkTrue('isPast: later today is not past', !Events.isPast(later, T, T, NOW))
checkTrue('isPast: all-day today is not past', !Events.isPast(allDay, T, T, NOW))
checkTrue('isPast: all-day yesterday is past',
  Events.isPast(allDay, '2026-08-26', T, NOW))
// Exactly at the end minute counts as over.
checkTrue('isPast: ends exactly now',
  Events.isPast({ time: '11:00', endTime: '12:00' }, T, T, NOW))
// A middle day of a multi-day run carries neither time and is still running.
checkTrue('isPast: continuation day without times is not past',
  !Events.isPast({ time: '', endTime: '' }, T, T, NOW))
// Only an end is known (final day of a run).
checkTrue('isPast: end only, already over',
  Events.isPast({ time: '', endTime: '09:00' }, T, T, NOW))
// Only a start is known: past once the start has gone by.
checkTrue('isPast: start only, already begun',
  Events.isPast({ time: '09:00', endTime: '' }, T, T, NOW))
checkTrue('isPast: start only, not yet begun',
  !Events.isPast({ time: '15:00', endTime: '' }, T, T, NOW))
checkTrue('isPast: null event', !Events.isPast(null, T, T, NOW))
checkTrue('isPast: missing todayKey', !Events.isPast(ended, T, '', NOW))

// Ongoing: begun, not yet over, today. The state the row lights up for.
checkTrue('isOngoing: running right now', Events.isOngoing(running, T, T, NOW))
checkTrue('isOngoing: finished is not', !Events.isOngoing(ended, T, T, NOW))
checkTrue('isOngoing: still ahead is not', !Events.isOngoing(later, T, T, NOW))
// All day is true all day, which is exactly why it must not light up.
checkTrue('isOngoing: all-day today is not', !Events.isOngoing(allDay, T, T, NOW))
checkTrue('isOngoing: running, but on another day',
  !Events.isOngoing(running, '2026-08-28', T, NOW))
checkTrue('isOngoing: starts exactly now',
  Events.isOngoing({ time: '12:00', endTime: '13:00' }, T, T, NOW))
checkTrue('isOngoing: ends exactly now is over',
  !Events.isOngoing({ time: '11:00', endTime: '12:00' }, T, T, NOW))
// A middle day of a run carries neither time and is running by definition.
checkTrue('isOngoing: continuation day without times',
  Events.isOngoing({ time: '', endTime: '' }, T, T, NOW))
checkTrue('isOngoing: last day of a run, still to end',
  Events.isOngoing({ time: '', endTime: '14:00' }, T, T, NOW))
checkTrue('isOngoing: last day of a run, already ended',
  !Events.isOngoing({ time: '', endTime: '09:00' }, T, T, NOW))
checkTrue('isOngoing: null event', !Events.isOngoing(null, T, T, NOW))

// The now-line: where it falls, and when it stays away
const nowIndex = (list, day) => Events.nowMarkerIndex(list, day || T, T, NOW)
check('nowMarkerIndex: between what is over and what is ahead',
  nowIndex([ended, later]), 1)
check('nowMarkerIndex: all-day entries always sort above it',
  nowIndex([allDay, ended, later]), 2)
check('nowMarkerIndex: a day still entirely ahead', nowIndex([allDay, later]), 1)
check('nowMarkerIndex: a day that is over ends with it', nowIndex([ended]), 1)
// A running row already says where now is; a second mark would repeat it.
check('nowMarkerIndex: nothing while something runs',
  nowIndex([ended, running, later]), -1)
check('nowMarkerIndex: not on another day', nowIndex([ended, later], '2026-08-28'), -1)
check('nowMarkerIndex: not on an empty day', nowIndex([]), -1)
check('nowMarkerIndex: no list at all', nowIndex(null), -1)
check('nowMarkerIndex: no today', Events.nowMarkerIndex([ended], T, '', NOW), -1)


// visibleForDay ties both filters together
const vis = Events.parse(JSON.stringify({
  days: {
    '2026-08-27': [
      { title: 'Work morning', allDay: false, time: '09:00', endTime: '10:00',
        color: '#111', calendars: ['Work'] },
      { title: 'Team later', allDay: false, time: '15:00', endTime: '16:00',
        color: '#222', calendars: ['Team'] },
      { title: 'Shared later', allDay: false, time: '16:00', endTime: '17:00',
        color: '#333', calendars: ['Work', 'Team'] }
    ]
  }
}))
const titles = o => Events.visibleForDay(vis, '2026-08-27', o).map(e => e.title)

check('visibleForDay: no options shows everything',
  titles({}), ['Work morning', 'Team later', 'Shared later'])
check('visibleForDay: undefined options shows everything',
  Events.visibleForDay(vis, '2026-08-27', undefined).length, 3)
check('visibleForDay: hiding a calendar',
  titles({ hidden: ['Work'] }), ['Team later', 'Shared later'])
check('visibleForDay: hiding both calendars of the shared entry',
  titles({ hidden: ['Work', 'Team'] }), [])
check('visibleForDay: hiding past entries',
  titles({ hidePast: true, todayKey: T, nowHM: NOW }),
  ['Team later', 'Shared later'])
check('visibleForDay: both filters at once',
  titles({ hidden: ['Team'], hidePast: true, todayKey: T, nowHM: NOW }),
  ['Shared later'])
check('visibleForDay: unknown day', titles({ hidden: ['Work'] }).length, 2)
// The filtered list is what feeds the dots, so the markers cannot promise
// events the agenda then refuses to show.
check('visibleForDay: dots follow the filter',
  Events.dotColors(Events.visibleForDay(vis, '2026-08-27', { hidden: ['Work'] })),
  ['#222', '#333'])

// ------------------------------------------------------------------ details

const withDetails = Events.parse(JSON.stringify({
  days: {
    '2026-08-27': [
      { title: 'Standup', allDay: false, color: '#111', calendars: ['Work'],
        time: '09:30', endTime: '09:45', spanDays: 1, dayIndex: 0,
        detail: 'k1' },
      { title: 'Plain', allDay: false, color: '#111', calendars: ['Work'],
        time: '11:00', endTime: '12:00', spanDays: 1, dayIndex: 0 },
      { title: 'Dangling', allDay: false, color: '#111', calendars: ['Work'],
        time: '13:00', endTime: '14:00', spanDays: 1, dayIndex: 0,
        detail: 'gone' }
    ]
  },
  details: {
    k1: {
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      recurrence: 'Weekly on Thursday',
      organizer: { name: 'Ada', email: 'ada@example.org' },
      attendees: [{ name: 'Ada', status: 'ACCEPTED' },
                  { name: 'Bob', status: 'DECLINED' }],
      attendeeCount: 12
    }
  }
}))
const withDay = Events.forDay(withDetails, '2026-08-27')
const [ev1, ev2, ev3] = withDay

check('parse: details map read', Object.keys(withDetails.details), ['k1'])
check('parse: missing details map is empty',
  Events.parse('{"days":{}}').details, {})
check('emptyData: has a details map', Events.emptyData().details, {})

check('detailFor: resolved by key',
  Events.detailFor(withDetails, ev1).recurrence, 'Weekly on Thursday')
check('detailFor: event without a key', Events.detailFor(withDetails, ev2), {})
// A key pointing nowhere must not throw or invent a record.
check('detailFor: dangling key', Events.detailFor(withDetails, ev3), {})
check('detailFor: null data', Events.detailFor(null, ev1), {})
check('detailFor: null event', Events.detailFor(withDetails, null), {})
checkTrue('hasDetail: true for a real record', Events.hasDetail(withDetails, ev1))
checkTrue('hasDetail: false without a key', !Events.hasDetail(withDetails, ev2))
checkTrue('hasDetail: false for a dangling key', !Events.hasDetail(withDetails, ev3))

// The panel opens this, so it is validated here too and not only upstream.
check('meetingUrl: https passes',
  Events.meetingUrl(withDetails, ev1), 'https://meet.google.com/abc-defg-hij')
check('meetingUrl: absent', Events.meetingUrl(withDetails, ev2), '')
const evil = k => Events.meetingUrl(
  Events.parse(JSON.stringify({ days: {}, details: { x: { meetingUrl: k } } })),
  { detail: 'x' })
check('meetingUrl: file scheme refused', evil('file:///etc/passwd'), '')
check('meetingUrl: javascript scheme refused', evil('javascript:alert(1)'), '')
check('meetingUrl: relative path refused', evil('/etc/passwd'), '')
check('meetingUrl: empty refused', evil(''), '')
check('meetingUrl: whitespace refused', evil('https://a.example /x'), '')
check('meetingUrl: http passes', evil('http://a.example/x'), 'http://a.example/x')

check('shortUrl: host and first segment',
  Events.shortUrl('https://meet.google.com/abc-defg-hij'), 'meet.google.com/abc-defg-hij')
check('shortUrl: deeper path elided',
  Events.shortUrl('https://bbb.correctiv.org/rooms/x/join'), 'bbb.correctiv.org/rooms/…')
// Query and deeper segments both go, which also keeps the meeting id and
// its password out of the panel.
check('shortUrl: query and deeper path dropped',
  Events.shortUrl('https://zoom.us/j/123?pwd=secret'), 'zoom.us/j/\u2026')
check('shortUrl: www stripped', Events.shortUrl('https://www.a.example/'), 'a.example')
check('shortUrl: host only', Events.shortUrl('https://a.example'), 'a.example')
check('shortUrl: not a url', Events.shortUrl('Room 3'), 'Room 3')
check('shortUrl: empty', Events.shortUrl(''), '')

check('attendeeMark: accepted', Events.attendeeMark('ACCEPTED'), '\u2713')
check('attendeeMark: declined', Events.attendeeMark('DECLINED'), '\u2715')
check('attendeeMark: tentative', Events.attendeeMark('tentative'), '?')
check('attendeeMark: needs action', Events.attendeeMark('NEEDS-ACTION'), '\u00b7')
check('attendeeMark: unknown', Events.attendeeMark(''), '\u00b7')

check('attendeeOverflow: truncated list reports the remainder',
  Events.attendeeOverflow(Events.detailFor(withDetails, ev1)), 10)
check('attendeeOverflow: complete list',
  Events.attendeeOverflow({ attendees: [1, 2], attendeeCount: 2 }), 0)
check('attendeeOverflow: no attendees', Events.attendeeOverflow({}), 0)
check('attendeeOverflow: count missing', 
  Events.attendeeOverflow({ attendees: [1, 2] }), 0)

// ----------------------------------------------------------- location label

const loc = (l, u) => Events.locationLabel({ location: l }, u)

// The common case by far: the location field is the join link, and the
// camera icon already offers it.
check('location: nothing but the link disappears',
  loc('https://zoom.us/j/1', 'https://zoom.us/j/1'), '')
// A room name sharing the field with the link is the reason not to just
// hide any location that contains a URL.
check('location: room name survives the link',
  loc('Woodstein / https://bbb.x/rooms/a/join', 'https://bbb.x/rooms/a/join'),
  'Woodstein')
check('location: room name after the link',
  loc('https://bbb.x/rooms/a/join / Woodstein', 'https://bbb.x/rooms/a/join'),
  'Woodstein')
check('location: text on both sides is joined',
  loc('Publix — https://zoom.us/j/1 — 3rd floor', 'https://zoom.us/j/1'),
  'Publix  \u00b7  3rd floor')
// Access details are not a place, and the code is in the link anyway.
check('location: meeting id boilerplate dropped',
  loc('https://zoom.us/j/9\nMeeting-ID: 908 743 6782', 'https://zoom.us/j/9'), '')
check('location: passcode boilerplate dropped',
  loc('https://zoom.us/j/9\nKenncode: 7U1KV', 'https://zoom.us/j/9'), '')
check('location: english passcode dropped',
  loc('https://zoom.us/j/9 Passcode: abc', 'https://zoom.us/j/9'), '')
// Untouched when there is no link to take out.
check('location: plain room kept', loc('Meeting room 2', ''), 'Meeting room 2')
check('location: link that is not the meeting link kept',
  loc('https://maps.example/x', 'https://zoom.us/j/1'), 'https://maps.example/x')
check('location: newlines collapsed',
  loc('Room 3\n  Building A', ''), 'Room 3 Building A')
check('location: empty', loc('', 'https://zoom.us/j/1'), '')
check('location: missing', Events.locationLabel({}, 'https://zoom.us/j/1'), '')
check('location: null event', Events.locationLabel(null, ''), '')

check('collapseSpace: runs and edges', Events.collapseSpace('  a \n b  '), 'a b')
check('collapseSpace: null', Events.collapseSpace(null), '')
checkTrue('isAccessDetail: german id', Events.isAccessDetail('Meeting-ID: 1'))
checkTrue('isAccessDetail: german code', Events.isAccessDetail('Kenncode: x'))
checkTrue('isAccessDetail: case folded', Events.isAccessDetail('PASSCODE: x'))
checkTrue('isAccessDetail: a room is not access data',
  !Events.isAccessDetail('Woodstein'))
// Only a leading marker counts, so a room named after a code word survives.
checkTrue('isAccessDetail: marker must lead',
  !Events.isAccessDetail('Room next to the passcode board'))

// ------------------------------------------------------- calendar settings

const withCals = Events.parse(JSON.stringify({
  days: {},
  calendars: [
    { name: 'Work', color: '#111' },
    { name: 'Team', color: '#222' },
    { name: 'Personal', color: '#333' }
  ]
}))

check('calendarRows: all rows, order preserved',
  Events.calendarRows(withCals, []).map(r => r.name), ['Work', 'Team', 'Personal'])
check('calendarRows: hidden state resolved',
  Events.calendarRows(withCals, ['Team']).map(r => r.hidden), [false, true, false])
check('calendarRows: color carried',
  Events.calendarRows(withCals, []).map(r => r.color), ['#111', '#222', '#333'])
check('calendarRows: no calendars', Events.calendarRows(Events.emptyData(), []), [])
check('calendarRows: null data', Events.calendarRows(null, []), [])
// A nameless calendar cannot be toggled, so it is not offered.
check('calendarRows: nameless entry skipped',
  Events.calendarRows(Events.parse(JSON.stringify({
    days: {}, calendars: [{ color: '#111' }, { name: 'Ok', color: '#222' }]
  })), []).map(r => r.name), ['Ok'])
check('calendarRows: missing color falls back',
  Events.calendarRows(Events.parse(JSON.stringify({
    days: {}, calendars: [{ name: 'X' }]
  })), [])[0].color, '#888888')

check('toggleHidden: adds', Events.toggleHidden([], 'Work'), ['Work'])
check('toggleHidden: removes', Events.toggleHidden(['Work'], 'Work'), [])
check('toggleHidden: sorted result',
  Events.toggleHidden(['Work'], 'Team'), ['Team', 'Work'])
check('toggleHidden: removes only the named one',
  Events.toggleHidden(['Team', 'Work'], 'Team'), ['Work'])
check('toggleHidden: undefined list', Events.toggleHidden(undefined, 'A'), ['A'])
// Must not mutate: the caller persists the return value, and an in-place
// change would not register as a changed property.
const before = ['Work']
Events.toggleHidden(before, 'Team')
check('toggleHidden: input untouched', before, ['Work'])

check('pruneHidden: drops unknown names',
  Events.pruneHidden(['Work', 'Deleted'], withCals), ['Work'])
check('pruneHidden: keeps all known',
  Events.pruneHidden(['Work', 'Team'], withCals), ['Work', 'Team'])
// With no calendar list yet (file not loaded), keep the stored names rather
// than wiping the user's choices.
check('pruneHidden: empty calendar list keeps the list',
  Events.pruneHidden(['Work'], Events.emptyData()), ['Work'])
check('pruneHidden: nothing hidden', Events.pruneHidden([], withCals), [])

check('normalizeHidden: from json', Events.normalizeHidden(['A', 'B']), ['A', 'B'])
check('normalizeHidden: dedupes', Events.normalizeHidden(['A', 'A']), ['A'])
check('normalizeHidden: drops empties', Events.normalizeHidden(['', 'A', null]), ['A'])
// A bare string in a hand-edited shell.json must not come apart into
// single-letter calendar names.
check('normalizeHidden: a string is rejected, not split',
  Events.normalizeHidden('Work'), [])
check('normalizeHidden: undefined', Events.normalizeHidden(undefined), [])
check('normalizeHidden: a number', Events.normalizeHidden(7), [])
check('normalizeHidden: an object', Events.normalizeHidden({ a: 1 }), [])

// ------------------------------------------------------------- time labels

const day = Events.forDay(data, '2026-08-27')
check('timeLabel: all-day has none', Events.timeLabel(day[0]), '')
check('timeLabel: start and end', Events.timeLabel(day[1]), '09:30 – 09:45')
check('timeLabel: equal start and end collapses',
  Events.timeLabel(day[2]), '11:00')
check('timeLabel: start only',
  Events.timeLabel({ time: '09:00', endTime: '' }), '09:00')
check('timeLabel: end only',
  Events.timeLabel({ time: '', endTime: '10:00' }), '– 10:00')
check('timeLabel: neither', Events.timeLabel({ time: '', endTime: '' }), '')
check('timeLabel: null event', Events.timeLabel(null), '')
// A continuation day carries no start time; the label must not invent one.
check('timeLabel: continuation day',
  Events.timeLabel({ time: '', endTime: '12:00', allDay: false }), '– 12:00')

// -------------------------------------------------------------- span labels

check('spanLabel: single day has none', Events.spanLabel(day[1]), '')
check('spanLabel: middle of a run', Events.spanLabel(day[0]), 'day 2 of 3')
check('spanLabel: first of a run',
  Events.spanLabel({ spanDays: 2, dayIndex: 0 }), 'day 1 of 2')
check('spanLabel: missing fields', Events.spanLabel({}), '')
check('spanLabel: null', Events.spanLabel(null), '')

// ---------------------------------------------------------- calendar labels

check('calendarLabel: one', Events.calendarLabel(day[1]), 'Work')
check('calendarLabel: several joined', Events.calendarLabel(day[2]), 'Work · Team')
check('calendarLabel: empty list', Events.calendarLabel({ calendars: [] }), '')
check('calendarLabel: missing', Events.calendarLabel({}), '')
check('calendarLabel: null', Events.calendarLabel(null), '')

// ------------------------------------------------------------------ report

if (failures.length) {
  console.log(`FAIL  ${failures.length} of ${checks} checks`)
  failures.forEach(f => console.log(`  x  ${f}`))
  process.exit(1)
}
console.log(`ok    ${checks} checks passed`)
