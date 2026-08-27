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
