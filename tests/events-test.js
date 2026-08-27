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
  Events.dotColors(data, '2026-08-27'), ['#aaa', '#111', '#222'])
check('dotColors: unknown day', Events.dotColors(data, '2026-01-01'), [])
check('dotColors: capped at MAX_DOTS', Events.MAX_DOTS, 3)

const many = Events.parse(JSON.stringify({
  days: { d: [1, 2, 3, 4, 5].map(n => ({ title: 't' + n, color: '#' + n + n + n })) }
}))
check('dotColors: five calendars capped to three',
  Events.dotColors(many, 'd').length, 3)
checkTrue('hasMoreThanDots: true beyond the cap', Events.hasMoreThanDots(many, 'd'))
checkTrue('hasMoreThanDots: false at exactly three',
  !Events.hasMoreThanDots(data, '2026-08-27'))
checkTrue('hasMoreThanDots: false on an unknown day',
  !Events.hasMoreThanDots(data, '2026-01-01'))

// A colorless event must not become a phantom dot.
const noColor = Events.parse(JSON.stringify({
  days: { d: [{ title: 'x' }, { title: 'y', color: '#123' }] }
}))
check('dotColors: missing color skipped', Events.dotColors(noColor, 'd'), ['#123'])

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
