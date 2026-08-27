// Tests for the date patterns Model.js derives from a locale.
//
// A hardcoded "MMMM d" reads "August 27" in German where the language wants
// "27. August", so the order comes out of the locale's own long format. The
// long formats below are what Qt actually reports (verified against
// Qt.locale(...).dateFormat(Locale.LongFormat)); the expectations are written
// out rather than recorded, so a wrong answer cannot be blessed.
//
// Run: node tests/model-test.js

const path = require('path')
const Model = require(path.join(__dirname, '..', 'Model.js'))

const failures = []
let checks = 0

function check(label, got, want) {
  checks++
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) failures.push(`${label}\n     got:  ${g}\n     want: ${w}`)
}

// ---------------------------------------------------------------- tidyFormat

check('tidy: whitespace collapsed', Model.tidyFormat('d.   MMMM'), 'd. MMMM')
check('tidy: leading comma dropped', Model.tidyFormat(', MMMM d'), 'MMMM d')
check('tidy: trailing comma dropped', Model.tidyFormat('MMMM d, '), 'MMMM d')
check('tidy: doubled commas collapsed', Model.tidyFormat('a, , b'), 'a, b')
// The period in "d. MMMM" belongs to the day and must survive.
check('tidy: inner period kept', Model.tidyFormat('dddd, d. MMMM'), 'dddd, d. MMMM')
// A trailing one belongs to the day too, in Hungarian as in German.
check('tidy: trailing period kept', Model.tidyFormat('MMMM d.'), 'MMMM d.')
// A leading one cannot belong to anything: no date format opens with a period.
check('tidy: leading period dropped', Model.tidyFormat('. MMMM d.'), 'MMMM d.')
check('tidy: empty', Model.tidyFormat(''), '')
check('tidy: null', Model.tidyFormat(null), '')

// --------------------------------------------------------- stripFormatTokens

check('strip: single token',
  Model.stripFormatTokens('dddd, MMMM d, yyyy', ['yyyy']), 'dddd, MMMM d')
check('strip: several tokens',
  Model.stripFormatTokens('dddd, MMMM d, yyyy', ['dddd', 'yyyy']), 'MMMM d')
check('strip: token absent', Model.stripFormatTokens('MMMM d', ['yyyy']), 'MMMM d')
check('strip: nothing left', Model.stripFormatTokens('yyyy', ['yyyy']), '')

// ------------------------------------------------------- real locale formats

const LONG = {
  de_DE: 'dddd, d. MMMM yyyy',
  en_US: 'dddd, MMMM d, yyyy',
  en_GB: 'dddd, d MMMM yyyy',
  fr_FR: 'dddd d MMMM yyyy',
  sv_SE: 'dddd d MMMM yyyy',
  hu_HU: 'yyyy. MMMM d., dddd'
}

// The hero: day and month, no weekday, no year.
check('day+month: german puts the day first',
  Model.dayMonthFormat(LONG.de_DE), 'd. MMMM')
check('day+month: american puts the month first',
  Model.dayMonthFormat(LONG.en_US), 'MMMM d')
check('day+month: british', Model.dayMonthFormat(LONG.en_GB), 'd MMMM')
check('day+month: french', Model.dayMonthFormat(LONG.fr_FR), 'd MMMM')
check('day+month: hungarian keeps its own order',
  Model.dayMonthFormat(LONG.hu_HU), 'MMMM d.')

// The agenda heading and the detail pane: weekday too, still no year.
check('weekday+day+month: german',
  Model.weekdayDayMonthFormat(LONG.de_DE), 'dddd, d. MMMM')
check('weekday+day+month: american',
  Model.weekdayDayMonthFormat(LONG.en_US), 'dddd, MMMM d')
check('weekday+day+month: british',
  Model.weekdayDayMonthFormat(LONG.en_GB), 'dddd, d MMMM')
check('weekday+day+month: french has no comma',
  Model.weekdayDayMonthFormat(LONG.fr_FR), 'dddd d MMMM')

// A locale Qt cannot describe must not leave the panel with a blank date.
check('day+month: falls back', Model.dayMonthFormat(''), 'MMMM d')
check('day+month: falls back from junk', Model.dayMonthFormat('yyyy'), 'MMMM d')
check('weekday+day+month: falls back',
  Model.weekdayDayMonthFormat(''), 'dddd, MMMM d')
check('day+month: null', Model.dayMonthFormat(null), 'MMMM d')

if (failures.length) {
  console.log(`FAIL  ${failures.length} of ${checks} checks`)
  failures.forEach(f => console.log(`  x  ${f}`))
  process.exit(1)
}
console.log(`ok    ${checks} checks passed`)
