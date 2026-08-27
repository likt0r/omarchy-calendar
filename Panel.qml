import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "Events.js" as Events

// The clock's calendar popup: a month grid with ISO week numbers, built to
// sit beside the weather panel — same hero-over-detail composition, same
// spacing scale, same small-caps labels.
//
// Upstream's grid was a read-out. This one is a picker, because it has
// something to show per day: a dot for every calendar with an event on
// that date, and an agenda for whichever day is selected. Chevrons, the
// scroll wheel and the arrow keys still step the month; clicking a day
// moves the agenda.
//
// The appointments arrive as a JSON file written by an exporter (see
// exporters/README.md for the contract). The panel never talks to a
// calendar itself, which is what keeps the data source swappable.
//
// BarWidget.qml owns the bar label and hands this panel the button to
// anchor against.
Panel {
  id: root
  moduleName: "likt0r.calendar"
  ipcTarget: "likt0r.calendar"
  manageIpc: false

  property var anchorItem: null

  // The bar tracks the widget mounted in its slot — BarWidget.qml — not this
  // nested panel. Everything the bar identifies a panel by has to be that
  // widget: the popout coordinator (and with it the open-panel dot under the
  // pill) compares against `slot.activeItem`, and switchPanelFrom looks the
  // slot up the same way.
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  // ---- Today. SystemClock keeps this honest across midnight so the
  //      highlight rolls over without the panel being reopened.
  property date today: new Date()
  readonly property string todayKey: Model.keyForDate(today)

  // The month on screen. Stepping moves this and nothing else: the grid is
  // a read-out, not a picker, so there is no per-day cursor to keep in sync.
  property int viewYear: today.getFullYear()
  property int viewMonth: today.getMonth()

  readonly property date viewDate: new Date(viewYear, viewMonth, 1)
  readonly property bool viewingCurrentMonth: viewYear === today.getFullYear() && viewMonth === today.getMonth()

  // Pinned to today, not to the month being browsed — stepping through the
  // calendar does not change how much of the year is gone.
  readonly property real yearDone: Model.yearProgress(today.getFullYear(), today.getMonth(), today.getDate())
  readonly property int yearDonePercent: Model.yearProgressPercent(today.getFullYear(), today.getMonth(), today.getDate())

  // Memento mori, for anyone who goes looking: double-tapping the year bar
  // asks for a birth year and a life expectancy, and a second bar tracks one
  // against the other. A birth year rather than an age, so it keeps counting
  // on its own. Without one the bar stays hidden.
  readonly property int birthYear: Model.parseBirthYear(setting("birthYear", 0), today.getFullYear())
  readonly property int age: Model.ageFromBirthYear(birthYear, today.getFullYear())
  readonly property int lifeExpectancy: Model.parseLifeExpectancy(setting("lifeExpectancy", 0))
  readonly property real lifeDone: Model.lifeProgress(age, lifeExpectancy)
  readonly property int lifeDonePercent: Model.lifeProgressPercent(age, lifeExpectancy)
  property bool editingLife: false

  // Unset falls through to the locale's own first day, so a fresh install
  // starts out matching the rest of the desktop rather than a hardcoded
  // convention. Clicking the grid's "W" heading writes the choice back to
  // shell.json.
  readonly property int weekStart: Model.normalizedWeekStart(setting("weekStartDay", null), Qt.locale().firstDayOfWeek)
  // The interface is English throughout, so day names are not taken from the
  // system locale. Where the week starts still is: that is a regional
  // convention rather than a translation, and it stays overridable above.
  readonly property var labelLocale: Qt.locale("en_US")
  readonly property string nextWeekStartLabel: labelLocale.dayName(Model.toggledWeekStart(weekStart), Locale.LongFormat)
  readonly property var weekdays: Model.weekdayOrder(weekStart)
  readonly property var weeks: Model.monthGrid(viewYear, viewMonth, weekStart, todayKey)

  // ---- Appointments, exported from the Thunderbird calendar caches by
  //      omarchy-calendar-sync into a day-keyed JSON file. The grid stays
  //      readable with none of it: an absent or unparsable file leaves the
  //      panel exactly as it was before events existed.
  property var eventData: Events.emptyData()

  // Where the exporter leaves its output, and which exporter to run.
  // `eventSource` names a file under exporters/; setting it to "none"
  // leaves the file to whatever writes it (a cron job, a different tool)
  // and the panel only reads.
  readonly property string eventsPath: setting("eventsPath",
    Quickshell.env("HOME") + "/.cache/omarchy-calendar/events.json")
  readonly property string eventSource: setting("eventSource", "thunderbird")

  // Resolved against this file's own directory, so the exporter ships with
  // the plugin and needs no install step. Run through python3 explicitly
  // rather than relying on the executable bit surviving the clone.
  readonly property string exporterPath: {
    var name = String(root.eventSource || "")
    if (name === "" || name === "none") return ""
    // Nothing but a bare file name: this builds a path that gets executed.
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") return ""
    return String(Qt.resolvedUrl("exporters/" + name)).replace(/^file:\/\//, "")
  }

  // ---- Visibility, both settings stored on the widget's shell.json entry.
  //      Calendars are keyed by name because that is the only identity the
  //      events file carries; a name that no longer exists is pruned rather
  //      than kept alive forever.
  readonly property var hiddenCalendars: Events.pruneHidden(
    Events.normalizeHidden(setting("hiddenCalendars", [])), eventData)
  readonly property bool hidePastEvents: setting("hidePastEvents", false) === true

  // Re-read every minute off the same clock the bar label uses, so an entry
  // dims the moment it ends rather than whenever the panel next opens.
  readonly property string nowHM: Qt.formatDateTime(clock.date, "HH:mm")

  readonly property var visibilityOptions: ({
    hidden: root.hiddenCalendars,
    hidePast: root.hidePastEvents,
    todayKey: root.todayKey,
    nowHM: root.nowHM
  })

  // Reading root properties inside the call keeps the bindings that use it
  // reactive: QML tracks the reads, not the call.
  function visibleFor(key) {
    return Events.visibleForDay(root.eventData, key, root.visibilityOptions)
  }

  function eventIsPast(event, dayKey) {
    return Events.isPast(event, dayKey, root.todayKey, root.nowHM)
  }

  property bool showSettings: false

  // ---- The side panel. Holding the event itself rather than an index: the
  //      agenda it came from is rebuilt whenever a filter or the clock
  //      changes, and an index would then point at something else.
  property var detailEvent: null
  readonly property bool detailOpen: detailEvent !== null
  readonly property var detailRecord: Events.detailFor(eventData, detailEvent)
  readonly property int detailPaneWidth: Style.space(330)
  readonly property var detailGuests: {
    var list = root.detailRecord.attendees
    return (list && list.length) ? list : []
  }

  function showDetail(event) {
    // Clicking the open row again closes it, which is what a second click on
    // the same thing is expected to do.
    if (root.detailEvent === event) root.detailEvent = null
    else root.detailEvent = event
  }

  function closeDetail() {
    root.detailEvent = null
  }

  // Only ever an http(s) URL, checked here as well as in Events.js and in
  // the exporter: this hands a string to a process that opens it.
  function joinMeeting(url) {
    var text = String(url || "")
    if (!/^https?:\/\/[^\s]+$/.test(text)) return
    if (openerProc.running) return
    openerProc.command = ["xdg-open", text]
    openerProc.running = true
  }

  readonly property var calendarRows: Events.calendarRows(eventData, hiddenCalendars)

  function toggleCalendar(name) {
    persistSettings({
      hiddenCalendars: Events.toggleHidden(root.hiddenCalendars, name)
    })
  }

  function setHidePastEvents(value) {
    persistSettings({ hidePastEvents: value === true })
  }

  function showAllCalendars() {
    if (root.hiddenCalendars.length === 0) return
    persistSettings({ hiddenCalendars: [] })
  }

  // The grid was a read-out; the agenda makes it a picker, so one day is
  // always selected. It follows the month rather than staying behind on a
  // date no longer on screen.
  property string selectedKey: todayKey
  readonly property var selectedEvents: root.visibleFor(selectedKey)
  // How much of the day the filters are keeping back, so a partial day can
  // say so instead of passing itself off as the whole thing.
  readonly property int hiddenCount:
    Events.forDay(eventData, selectedKey).length - selectedEvents.length
  readonly property date selectedDate: root.dateFromKey(selectedKey)

  function dateFromKey(key) {
    var parts = String(key || "").split("-")
    if (parts.length !== 3) return new Date(root.today)
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  }

  // Selecting the day the month lands on keeps the agenda about what is
  // visible: today when today is in view, the first of the month otherwise.
  function syncSelectionToView() {
    if (root.viewingCurrentMonth) {
      root.selectedKey = root.todayKey
      return
    }
    root.selectedKey = Model.dateKey(root.viewYear, root.viewMonth, 1)
  }

  function selectDay(key) {
    if (String(key) !== root.selectedKey) root.closeDetail()
    root.selectedKey = String(key)
  }

  function loadEvents(raw) {
    root.eventData = Events.parse(raw)
  }

  // Guarded so the widget renders before the bar is injected (the bar-widget
  // contract instantiates it bare).
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property int cellWidth: Style.space(52)
  readonly property int cellHeight: Style.space(34)
  readonly property int cellSpacing: Style.space(2)
  readonly property int weekColumnWidth: Style.space(32)
  readonly property int gutterWidth: Style.space(14)

  function open() {
    refresh()
    root.controller.show()
    // Set after showing, not before: showing hands the popout coordinator
    // over, which closes whichever panel was open, and that close clears the
    // shared flag. Deferring means the panel taking over always wins, while
    // a handoff to a panel that does not manage the flag still leaves it
    // cleared rather than stuck on.
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    // Reopening should land on the calendar, not on whatever screen the
    // panel happened to be left on.
    root.showSettings = false
    root.closeDetail()
    // Dismissing the panel mid-edit would otherwise leave the inputs up,
    // waiting behind a closed popup for the next time it opens.
    if (root.editingLife) root.cancelEditingLife()
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  // Summoning by hotkey moves no pointer, so a hover the bar was still
  // holding must not keep the center indicators revealed behind the panel.
  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && "centerHoverRevealSuppressed" in root.bar)
      root.bar.centerHoverRevealSuppressed = value
  }

  function refresh() {
    root.today = new Date()
    root.goToToday()
    // Re-export on open so the agenda reflects whatever Thunderbird has
    // synced since last time. The exporter writes atomically and the
    // FileView below is watching, so the panel updates on its own once the
    // process finishes -- nothing here waits on it.
    if (root.exporterPath !== "" && !syncProc.running) syncProc.running = true
  }

  function goToToday() {
    root.viewYear = today.getFullYear()
    root.viewMonth = today.getMonth()
    root.selectedKey = root.todayKey
  }

  function moveMonth(delta) {
    var next = Model.stepMonth(viewYear, viewMonth, delta)
    root.viewYear = next.year
    root.viewMonth = next.month
    root.syncSelectionToView()
  }

  function moveYear(delta) {
    moveMonth(delta * 12)
  }

  // Applied locally first so the panel redraws on the click itself; the
  // shell.json write comes back through the bar as the same value. With no
  // writable entry (the widget is not in the layout) it stays a session-only
  // preference rather than doing nothing. The host widget builds its own
  // entry when the label format is cycled, so it has to be kept in step or
  // it would write this key straight back out from a stale copy.
  function persistSettings(values) {
    var entry = { id: root.moduleName }
    for (var existing in root.settings) if (existing !== "id") entry[existing] = root.settings[existing]
    for (var key in values) entry[key] = values[key]

    root.settings = entry
    if (root.hostWidget && "settings" in root.hostWidget) root.hostWidget.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  function setWeekStart(day) {
    var next = Model.normalizedWeekStart(day, root.weekStart)
    if (next === root.weekStart) return
    persistSettings({ weekStartDay: Model.weekStartSettingName(next) })
  }

  function startEditingLife() {
    root.editingLife = true
    Qt.callLater(function() {
      bornField.text = root.birthYear > 0 ? String(root.birthYear) : ""
      expectancyField.text = String(root.lifeExpectancy)
      bornField.selectAll()
      bornField.forceActiveFocus()
    })
  }

  function cancelEditingLife() {
    root.editingLife = false
    Qt.callLater(function() { if (keyCatcher) keyCatcher.forceActiveFocus() })
  }

  // Shared by both fields: Tab hops to the other one, Enter commits the pair,
  // Escape drops the lot.
  function handleLifeKey(event, other) {
    if (event.key === Qt.Key_Escape) {
      root.cancelEditingLife()
      event.accepted = true
    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      root.commitLife()
      event.accepted = true
    } else if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
      other.selectAll()
      other.forceActiveFocus()
      event.accepted = true
    }
  }

  // Double-tapping the life bar puts it away again. The expectancy stays in
  // the config so setting a birth year again brings your own number back
  // rather than the default.
  function clearLife() {
    if (root.birthYear <= 0) return
    persistSettings({ birthYear: 0 })
  }

  function commitLife() {
    var born = Model.parseBirthYear(bornField.text, today.getFullYear())
    var span = Model.parseLifeExpectancy(expectancyField.text)
    if (born !== root.birthYear || span !== root.lifeExpectancy)
      persistSettings({ birthYear: born, lifeExpectancy: span })
    cancelEditingLife()
  }

  function toggleWeekStart() {
    setWeekStart(Model.toggledWeekStart(root.weekStart))
  }

  // English short day names, matching the rest of the interface.
  function weekdayLabel(weekday) {
    return String(labelLocale.dayName(weekday, Locale.ShortFormat)).toUpperCase()
  }

  // ---- The mark that a list goes on past its edge: a chevron over a short
  //      fade, so it never sits on top of a half-clipped line. Shown only at
  //      an edge that can actually be moved towards, and only while there is
  //      something to reach — a permanent arrow would say nothing.
  component ScrollHint: Item {
    id: hint

    required property Flickable view
    // false marks the top edge (content above), true the bottom.
    property bool downwards: true

    readonly property bool available: hint.view
      && hint.view.contentHeight > hint.view.height + 1
      && (hint.downwards
            ? hint.view.contentY < hint.view.contentHeight - hint.view.height - 1
            : hint.view.contentY > 1)

    height: Style.space(20)
    opacity: available ? 1 : 0
    visible: opacity > 0
    Behavior on opacity { NumberAnimation { duration: 120 } }

    Rectangle {
      anchors.fill: parent
      gradient: Gradient {
        GradientStop {
          position: 0.0
          color: hint.downwards ? "transparent" : Color.popups.background
        }
        GradientStop {
          position: 1.0
          color: hint.downwards ? Color.popups.background : "transparent"
        }
      }
    }

    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: hint.downwards ? parent.bottom : undefined
      anchors.top: hint.downwards ? undefined : parent.top
      text: hint.downwards ? "󰅀" : "󰅃"
      color: Qt.darker(root.contentForeground, 1.8)
      font.family: root.contentFontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  SystemClock {
    id: clock
    precision: SystemClock.Minutes
    onDateChanged: {
      if (Model.keyForDate(clock.date) === String(root.todayKey)) return
      var followToday = root.viewingCurrentMonth
      root.today = clock.date
      if (followToday) root.goToToday()
    }
  }

  // Watched rather than polled: the exporter replaces the file atomically
  // (write-then-rename), so the panel either sees the old content or the
  // whole new content, never a partial write. text() is stale inside the
  // change signal itself, so both paths route through reload -> onLoaded.
  FileView {
    id: eventsFile
    path: root.eventsPath
    watchChanges: true
    printErrors: false
    onLoaded: root.loadEvents(text())
    onFileChanged: reload()
    onLoadFailed: root.loadEvents("")
  }

  // Hands the link to the desktop rather than guessing a browser.
  Process {
    id: openerProc
    command: []
  }

  Process {
    id: syncProc
    command: root.exporterPath === ""
      ? []
      : ["python3", root.exporterPath, "--out", root.eventsPath]

    // FileView cannot watch a path that does not exist yet. On a fresh
    // install there is no events file until this process writes one, and
    // without this the first export would go unseen until the panel was
    // closed and opened again.
    onExited: function(exitCode, exitStatus) { eventsFile.reload() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(
      root.detailOpen ? Style.space(560) + root.detailPaneWidth : Style.space(560))
    // Both panes want as much height as their content needs; the taller one
    // decides, and the screen caps the result. Past that cap the sticky
    // parts hold and only the lists scroll.
    contentHeight: panel.fittedContentHeight(Math.max(
      headColumn.implicitHeight + Style.space(8) + listColumn.implicitHeight,
      root.detailOpen
        ? detailHeadColumn.implicitHeight + Style.space(8) + detailBodyColumn.implicitHeight
        : 0))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.editingLife
      onMoveRequested: function(dx, dy) {
        if (dx !== 0) root.moveMonth(dx)
        if (dy !== 0) root.moveYear(dy)
      }
      onActivateRequested: root.goToToday()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "[") root.moveMonth(-1)
        else if (t === "]") root.moveMonth(1)
        else if (t === "{") root.moveYear(-1)
        else if (t === "}") root.moveYear(1)
        else if (t === "t" || t === "T") root.goToToday()
        else if (t === "w" || t === "W") root.toggleWeekStart()
      }

      // ---- Details, beside the calendar rather than below it: the agenda
      //      row it belongs to stays visible and marked, so the two read as
      //      one thing. Its own Flickable, so a long invitation text scrolls
      //      without dragging the calendar with it.
      Rectangle {
        visible: root.detailOpen
        anchors.left: calendarPane.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: Style.spacing.hairline
        color: root.contentForeground
        opacity: 0.12
      }

      Item {
        id: detailPane
        visible: root.detailOpen
        anchors.left: calendarPane.right
        anchors.leftMargin: Style.space(14)
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom

        // Stays put while the invitation text scrolls underneath: the way
        // out of a pane must not be something you have to scroll back up to
        // find.
        // Everything that identifies the event, and the one action on
        // it, stays put: scrolling to the guest list should not cost you
        // sight of which event you are reading, or the way into its call.
        Column {
          id: detailHeadColumn
          anchors.top: parent.top
          width: detailPane.width - Style.space(8)
          spacing: Style.space(8)

          Item {
            id: detailHeader
            width: parent.width
            height: Math.max(detailTitleLabel.height, detailCloseButton.size)

            Text {
              id: detailTitleLabel
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              text: "EVENT"
              color: Qt.darker(root.contentForeground, 1.4)
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.caption
              font.letterSpacing: 1
              font.bold: true
            }

            PanelActionButton {
              id: detailCloseButton
              anchors.right: parent.right
              anchors.rightMargin: -Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              iconText: "󰅖"
              tooltipText: "Close details"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              onClicked: root.closeDetail()
            }
          }

          Text {
            width: parent.width
            text: root.detailEvent ? String(root.detailEvent.title) : ""
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
            wrapMode: Text.WordWrap
          }

          // Cancelled or tentative changes what the entry means, so it is
          // stated rather than left to the reader to notice.
          Text {
            readonly property string state:
              String(root.detailRecord.status || "").toUpperCase()
            visible: state !== ""
            text: state === "CANCELLED" ? "Cancelled" : "Tentative"
            color: Color.accent
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          Text {
            width: parent.width
            text: {
              if (!root.detailEvent) return ""
              var when = Qt.formatDate(root.selectedDate, "dddd d MMMM")
              if (root.detailEvent.allDay) return when + "  ·  all day"
              var span = Events.timeLabel(root.detailEvent)
              return span === "" ? when : when + "  ·  " + span
            }
            color: Qt.darker(root.contentForeground, 1.5)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Text {
            readonly property string runs: root.detailEvent
              ? Events.spanLabel(root.detailEvent) : ""
            visible: runs !== ""
            text: runs
            color: Qt.darker(root.contentForeground, 2.0)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
          }

          Text {
            visible: String(root.detailRecord.recurrence || "") !== ""
            width: parent.width
            text: "󰑖  " + String(root.detailRecord.recurrence || "")
            color: Qt.darker(root.contentForeground, 2.0)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }

          // The one action in the pane, so it gets a button rather than a
          // line of text that happens to be clickable.
          Rectangle {
            readonly property string url: root.detailEvent
              ? Events.meetingUrl(root.eventData, root.detailEvent) : ""
            visible: url !== ""
            width: parent.width
            height: Style.space(30)
            radius: Style.cornerRadius
            color: joinBigMouse.containsMouse
              ? Style.hoverFillFor(root.contentForeground, Color.accent)
              : Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                        root.contentForeground.b, 0.05)
            border.width: Style.spacing.hairline
            border.color: Style.normalBorderFor(root.contentForeground, Color.accent)

            Row {
              anchors.centerIn: parent
              spacing: Style.space(6)

              Text {
                anchors.verticalCenter: parent.verticalCenter
                text: "󰕧"
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
              }

              Text {
                anchors.verticalCenter: parent.verticalCenter
                text: "Join meeting"
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: true
              }
            }

            MouseArea {
              id: joinBigMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: root.joinMeeting(parent.url)
            }

            PanelToolTip {
              visible: joinBigMouse.containsMouse
              text: Events.shortUrl(parent.url)
              fontFamily: root.contentFontFamily
            }
          }

        }

        Flickable {
          id: detailBodyScroll
          anchors.top: detailHeadColumn.bottom
          anchors.topMargin: Style.space(8)
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.bottom: parent.bottom
          contentWidth: width
          contentHeight: detailBodyColumn.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          interactive: contentHeight > height

          Column {
            id: detailBodyColumn
            width: detailPane.width - Style.space(8)
            spacing: Style.space(8)

            PanelSectionHeader {
              visible: detailWhere.text !== ""
              text: "WHERE"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
            }

            Text {
              id: detailWhere
              width: parent.width
              visible: text !== ""
              text: root.detailEvent ? String(root.detailEvent.location || "") : ""
              color: Qt.darker(root.contentForeground, 1.6)
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.WrapAnywhere
            }

            PanelSectionHeader {
              text: "CALENDAR"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
            }

            Repeater {
              model: root.detailEvent ? root.detailEvent.calendars : []

              Row {
                required property var modelData
                spacing: Style.space(6)

                Rectangle {
                  anchors.verticalCenter: parent.verticalCenter
                  width: Style.space(6)
                  height: width
                  radius: width / 2
                  color: root.detailEvent ? root.detailEvent.color : root.contentForeground
                }

                Text {
                  text: modelData
                  color: Qt.darker(root.contentForeground, 1.6)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                }
              }
            }

            PanelSectionHeader {
              visible: detailOrganizer.text !== ""
              text: "ORGANISER"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
            }

            Text {
              id: detailOrganizer
              width: parent.width
              visible: text !== ""
              text: {
                var who = root.detailRecord.organizer
                return who ? String(who.name || who.email || "") : ""
              }
              color: Qt.darker(root.contentForeground, 1.6)
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
            }

            PanelSectionHeader {
              visible: root.detailGuests.length > 0
              text: root.detailRecord.attendeeCount
                ? "GUESTS (" + root.detailRecord.attendeeCount + ")"
                : "GUESTS"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
            }

            Repeater {
              model: root.detailGuests

              Row {
                required property var modelData
                width: detailBodyColumn.width
                spacing: Style.space(6)

                Text {
                  width: Style.space(10)
                  text: Events.attendeeMark(modelData.status)
                  color: Qt.darker(root.contentForeground, 1.7)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.caption
                }

                Text {
                  width: parent.width - Style.space(16)
                  text: String(modelData.name || modelData.email || "")
                  color: Qt.darker(root.contentForeground,
                                   String(modelData.status).toUpperCase() === "DECLINED" ? 2.3 : 1.6)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.strikeout: String(modelData.status).toUpperCase() === "DECLINED"
                  elide: Text.ElideRight
                }
              }
            }

            Text {
              readonly property int more: Events.attendeeOverflow(root.detailRecord)
              visible: more > 0
              text: "and " + more + " more"
              color: Qt.darker(root.contentForeground, 2.2)
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.caption
              font.italic: true
            }

            PanelSectionHeader {
              visible: detailNotes.text !== ""
              text: "NOTES"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
            }

            // Selectable rather than a plain label: this is where the dial-in
            // number and the meeting id live, and copying them is the point.
            TextEdit {
              id: detailNotes
              width: parent.width
              visible: text !== ""
              readOnly: true
              selectByMouse: true
              text: String(root.detailRecord.description || "")
              color: Qt.darker(root.contentForeground, 1.7)
              selectionColor: Color.accent
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.caption
              wrapMode: TextEdit.Wrap
            }

            Item { width: 1; height: Style.space(8) }
          }
        }

        ScrollHint {
          view: detailBodyScroll
          downwards: false
          anchors.left: detailBodyScroll.left
          anchors.right: detailBodyScroll.right
          anchors.top: detailBodyScroll.top
        }

        ScrollHint {
          view: detailBodyScroll
          downwards: true
          anchors.left: detailBodyScroll.left
          anchors.right: detailBodyScroll.right
          anchors.bottom: detailBodyScroll.bottom
        }
      }

      // The calendar itself does not scroll. With a dozen entries on one
      // day, or a settings screen taller than the popup, only the list
      // below moves — the date, the grid and the month rail stay where the
      // reader left them.
      Item {
        id: calendarPane
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        // Gives up its right-hand side to the detail pane rather than being
        // overlapped by it, so both panes scroll on their own.
        width: root.detailOpen
          ? Math.max(Style.space(200), parent.width - root.detailPaneWidth)
          : parent.width
        // On a screen too narrow for seven day columns the grid is cut off
        // rather than allowed to bleed into the detail pane beside it.
        clip: true

        Column {
          id: headColumn
          anchors.top: parent.top
          // Never narrower than the grid: the popup width is capped to what
          // the screen allows, and a fixed seven-column grid would otherwise
          // lose its last days off the edge.
          width: Math.max(calendarPane.width, gridColumn.width)
          spacing: Style.space(8)

          // ---- Hero: today, centered. Once the view has stepped back
          //      it is also the way home — clicking the date you are
          //      looking for beats hunting for a reset button.
          Item {
            width: parent.width
            height: heroRow.height

            Row {
              id: heroRow
              anchors.horizontalCenter: parent.horizontalCenter
              // Scaled with the two sizes below, so the pair keeps its
              // proportions rather than drifting apart.
              spacing: Style.space(15)

              Text {
                // Baseline-aligned, not center-aligned: "July 26" carries a
                // descender, so centering the two boxes leaves the icon
                // sitting visibly low against the digits.
                anchors.baseline: heroDate.baseline
                text: "󰃭"
                color: heroMouse.containsMouse
                  ? Style.hoverStateColor(root.contentForeground, Color.accent)
                  : root.contentForeground
                font.family: root.contentFontFamily
                // Decorative, and deliberately outside the Style.font.*
                // scale. Sized so the glyph reads at the cap height of the
                // date beside it rather than towering over it -- two thirds
                // of what upstream used, which left the date shouting over
                // the grid it introduces.
                font.pixelSize: 32
              }

              Text {
                id: heroDate
                anchors.verticalCenter: parent.verticalCenter
                text: Qt.formatDate(root.today, "MMMM d")
                color: heroMouse.containsMouse
                  ? Style.hoverStateColor(root.contentForeground, Color.accent)
                  : root.contentForeground
                font.family: root.contentFontFamily
                // Two thirds of upstream's 52; kept in step with the glyph
                // and the row spacing above.
                font.pixelSize: 35
                font.bold: true
              }
            }

            MouseArea {
              id: heroMouse
              x: heroRow.x
              y: heroRow.y
              width: heroRow.width
              height: heroRow.height
              enabled: !root.viewingCurrentMonth
              hoverEnabled: enabled
              cursorShape: Qt.PointingHandCursor
              onClicked: root.goToToday()

              PanelToolTip {
                visible: heroMouse.containsMouse
                text: "Back to today"
                fontFamily: root.contentFontFamily
              }
            }
          }

          // ---- Year progress, doubling as the rule under the hero:
          //      a plain hairline said nothing, and whole days done
          //      over days in the year says the same thing louder.
          Item {
            width: parent.width
            height: yearBlock.y + yearBlock.height

            Item {
              id: yearBlock
              y: Style.space(6)
              anchors.horizontalCenter: parent.horizontalCenter
              width: gridColumn.width
              height: Math.max(yearLabel.implicitHeight, Style.space(10))

              TapHandler {
                enabled: !root.editingLife
                onDoubleTapped: root.startEditingLife()
              }

              Row {
                visible: root.editingLife
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(10)

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: "BORN"
                  color: Qt.darker(root.contentForeground, 1.5)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.letterSpacing: 1
                }

                TextField {
                  id: bornField
                  width: Style.space(70)
                  anchors.verticalCenter: parent.verticalCenter
                  placeholderText: "year"
                  foreground: root.contentForeground
                  font.family: root.contentFontFamily
                  inputMethodHints: Qt.ImhDigitsOnly

                  Keys.onPressed: function(event) { root.handleLifeKey(event, expectancyField) }
                }

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.verticalCenterOffset: 0
                  leftPadding: Style.space(6)
                  text: "LIVE TO"
                  color: Qt.darker(root.contentForeground, 1.5)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.letterSpacing: 1
                }

                TextField {
                  id: expectancyField
                  width: Style.space(60)
                  anchors.verticalCenter: parent.verticalCenter
                  placeholderText: "90"
                  foreground: root.contentForeground
                  font.family: root.contentFontFamily
                  inputMethodHints: Qt.ImhDigitsOnly

                  Keys.onPressed: function(event) { root.handleLifeKey(event, bornField) }
                }
              }

              Text {
                id: yearLabel
                visible: !root.editingLife
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                text: root.today.getFullYear()
                color: Qt.darker(root.contentForeground, 1.5)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.letterSpacing: 1
              }

              Text {
                id: yearPercent
                visible: !root.editingLife
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: root.yearDonePercent + "%"
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
              }

              Rectangle {
                id: yearTrack
                visible: !root.editingLife
                anchors.left: yearLabel.right
                anchors.right: yearPercent.left
                anchors.leftMargin: Style.space(12)
                anchors.rightMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                height: Style.space(6)
                radius: Style.cornerRadius > 0 ? height / 2 : 0
                color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.12)

                Rectangle {
                  width: Math.round(parent.width * root.yearDone)
                  height: parent.height
                  radius: parent.radius
                  color: Style.selectedStateColor(root.contentForeground, Color.accent)

                  Behavior on width { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }
                }
              }
            }
          }

          // ---- Memento mori. Only here once someone has gone looking and
          //      given an age; the same rail as the year above it, measured
          //      against a nominal lifetime.
          Item {
            visible: root.birthYear > 0
            width: parent.width
            height: visible ? lifeBlock.height : 0

            Item {
              id: lifeBlock
              anchors.horizontalCenter: parent.horizontalCenter
              width: gridColumn.width
              height: Math.max(lifeLabel.implicitHeight, Style.space(10))

              Text {
                id: lifeLabel
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                text: "LIFE"
                color: Qt.darker(root.contentForeground, 1.5)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.letterSpacing: 1
              }

              Text {
                id: lifePercent
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: root.lifeDonePercent + "%"
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
              }

              Rectangle {
                anchors.left: lifeLabel.right
                anchors.right: lifePercent.left
                anchors.leftMargin: Style.space(12)
                anchors.rightMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                height: Style.space(6)
                radius: Style.cornerRadius > 0 ? height / 2 : 0
                color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.12)

                Rectangle {
                  width: Math.round(parent.width * root.lifeDone)
                  height: parent.height
                  radius: parent.radius
                  color: Style.selectedStateColor(root.contentForeground, Color.accent)

                  Behavior on width { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }
                }
              }

              TapHandler {
                onDoubleTapped: root.clearLife()
              }

              MouseArea {
                id: lifeMouse
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.NoButton

                PanelToolTip {
                  visible: lifeMouse.containsMouse
                  text: "Memento Mori"
                  fontFamily: root.contentFontFamily
                }
              }
            }
          }

          // ---- Month grid: week numbers down a gutter on the left, then
          //      the seven day columns. Always six rows, so the popup is
          //      exactly as tall in February as it is in August.
          Item {
            width: parent.width
            visible: !root.showSettings
            height: gridColumn.y + gridColumn.height

            WheelHandler {
              onWheel: function(event) {
                // Horizontal wheels and touchpad side-scrolls report y === 0;
                // without this they would every one read as "next month".
                if (event.angleDelta.y === 0) return
                root.moveMonth(event.angleDelta.y > 0 ? -1 : 1)
              }
            }

            Column {
              id: gridColumn
              // The meter above is a solid rule; the grid needs room to
              // read as its own block rather than hanging off it.
              y: Style.space(18)
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(3)

              Row {
                id: headerRow
                spacing: root.cellSpacing

                // The week-number heading doubles as the week-start toggle.
                // It is the one control in the panel whose meaning is not
                // self-evident, so it carries a tooltip naming the day the
                // click will switch to.
                Rectangle {
                  width: root.weekColumnWidth
                  height: Style.space(16)
                  radius: Style.cornerRadius
                  color: weekStartMouse.containsMouse
                    ? Style.hoverFillFor(root.contentForeground, Color.accent)
                    : "transparent"

                  Text {
                    anchors.centerIn: parent
                    text: "W"
                    color: weekStartMouse.containsMouse
                      ? Style.hoverStateColor(root.contentForeground, Color.accent)
                      : Qt.darker(root.contentForeground, 1.9)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    font.letterSpacing: 1
                    font.bold: true
                  }

                  MouseArea {
                    id: weekStartMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.toggleWeekStart()
                  }

                  PanelToolTip {
                    visible: weekStartMouse.containsMouse
                    text: "Start weeks on " + root.nextWeekStartLabel
                    fontFamily: root.contentFontFamily
                  }
                }

                Item {
                  width: root.gutterWidth
                  height: Style.space(16)
                }

                Repeater {
                  model: root.weekdays

                  Text {
                    required property var modelData
                    width: root.cellWidth
                    height: Style.space(16)
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                    text: root.weekdayLabel(modelData)
                    color: Qt.darker(root.contentForeground, 1.5)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    font.letterSpacing: 1
                    font.bold: true
                  }
                }
              }

              Repeater {
                model: root.weeks

                Row {
                  required property var modelData
                  spacing: root.cellSpacing

                  Text {
                    width: root.weekColumnWidth
                    height: root.cellHeight
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                    text: modelData.week
                    color: Qt.darker(root.contentForeground, 1.9)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                  }

                  Item {
                    width: root.gutterWidth
                    height: root.cellHeight
                  }

                  Repeater {
                    model: modelData.days

                    Rectangle {
                      id: dayCell
                      required property var modelData

                      readonly property bool selected: root.selectedKey === modelData.key
                      readonly property var dayEvents: root.visibleFor(modelData.key)
                      readonly property var dots: Events.dotColors(dayEvents)
                      readonly property bool overflow: Events.hasMoreThanDots(dayEvents)
                      // Days already behind us read quieter, the same way
                      // days from the neighbouring month do.
                      readonly property bool past: String(modelData.key) < String(root.todayKey)

                      width: root.cellWidth
                      height: root.cellHeight
                      radius: Style.cornerRadius
                      // Today is outlined, not filled: a lit-up block shouts
                      // over a grid this quiet. The selected day is the one
                      // thing allowed a fill, and only a faint one -- on the
                      // day that is both, the outline still reads through.
                      color: selected
                        ? Style.hoverFillFor(root.contentForeground, Color.accent)
                        : (dayMouse.containsMouse
                            ? Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                                      root.contentForeground.b, 0.05)
                            : "transparent")
                      border.width: modelData.today ? Style.spacing.hairline : 0
                      border.color: Style.normalBorderFor(root.contentForeground, Color.accent)

                      Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        // Lifted off center to leave the marker row its own
                        // band, so a day with events and one without still
                        // sit on the same baseline.
                        y: Math.round((parent.height - height) / 2) - Style.space(3)
                        text: dayCell.modelData.day
                        color: dayCell.modelData.inMonth
                          ? (dayCell.modelData.weekend ? Qt.darker(root.contentForeground, 1.45) : root.contentForeground)
                          : Qt.darker(root.contentForeground, 2.2)
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.body
                        font.bold: dayCell.modelData.today
                      }

                      // One dot per calendar with something on that day, so
                      // three meetings in one calendar read as one calendar
                      // rather than a crowd.
                      Row {
                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.bottom: parent.bottom
                        anchors.bottomMargin: Style.space(5)
                        // Pinned height: the row is anchored to the bottom
                        // edge, so anything taller than a dot would grow it
                        // upward and into the date above.
                        height: Style.space(4)
                        spacing: Style.space(2)

                        Repeater {
                          model: dayCell.dots

                          Rectangle {
                            required property var modelData
                            width: Style.space(4)
                            height: width
                            radius: width / 2
                            color: modelData
                            // Days spilling in from the neighbouring month
                            // keep their markers, but muted along with the
                            // date they belong to. Past days are muted too,
                            // just less far.
                            opacity: !dayCell.modelData.inMonth
                              ? 0.35
                              : (dayCell.past ? 0.4 : 0.95)
                          }
                        }

                        // More calendars than the dots can show. A glyph
                        // here would be taller than the dots and, in a row
                        // anchored to the cell's bottom edge, would lift the
                        // whole marker band up over the date. So the
                        // overflow is a fourth dot, drawn in the foreground
                        // rather than a calendar color to read as "and
                        // more" instead of as another calendar.
                        Rectangle {
                          visible: dayCell.overflow
                          width: Style.space(4)
                          height: width
                          radius: width / 2
                          color: root.contentForeground
                          opacity: !dayCell.modelData.inMonth
                            ? 0.2
                            : (dayCell.past ? 0.22 : 0.35)
                        }
                      }

                      MouseArea {
                        id: dayMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.selectDay(dayCell.modelData.key)
                      }
                    }
                  }
                }
              }
            }

            // Hairline down the week-number gutter, drawn only beside the
            // day rows so it does not cut through the header band.
            Rectangle {
              x: gridColumn.x + root.weekColumnWidth + root.cellSpacing + Math.round((root.gutterWidth - width) / 2)
              y: gridColumn.y + headerRow.height + gridColumn.spacing
              width: Style.spacing.hairline
              height: gridColumn.height - headerRow.height - gridColumn.spacing
              color: root.contentForeground
              opacity: 0.1
            }
          }

          // ---- Month stepping, spanning the grid it drives. The chevrons
          //      sit on the grid's outer bounds, the same edges the year
          //      rail above uses, so the row reads as the panel's other
          //      full-width rail instead of a cluster floating in space.
          //      The label is centered and fixed-width, so it holds still
          //      from "MAY" to "SEPTEMBER".
          Item {
            width: parent.width
            visible: !root.showSettings
            height: monthNav.height

            Item {
              id: monthNav
              anchors.horizontalCenter: parent.horizontalCenter
              width: gridColumn.width
              height: monthLabel.implicitHeight + Style.space(10)

              Text {
                id: monthLabel
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                // Fixed width so the chevrons hold still between a
                // "MAY 2026" and a "SEPTEMBER 2026".
                width: Style.space(130)
                horizontalAlignment: Text.AlignHCenter
                text: Qt.formatDate(root.viewDate, "MMMM yyyy").toUpperCase()
                color: Qt.darker(root.contentForeground, 1.4)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                font.letterSpacing: 1
              }

              PanelActionButton {
                // Pulled out by the button's own padding so the glyph, not
                // its hit box, lines up with the "2026" on the year rail.
                anchors.left: parent.left
                anchors.leftMargin: -Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                iconText: "󰅁"
                tooltipText: "Previous month"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                onClicked: root.moveMonth(-1)
              }

              PanelActionButton {
                anchors.right: parent.right
                anchors.rightMargin: -Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                iconText: "󰅂"
                tooltipText: "Next month"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                onClicked: root.moveMonth(1)
              }
            }
          }

          // ---- The agenda heading, held in place with the grid: the date it
          //      names and the gear that filters the list below are no use
          //      once they have scrolled off the top.
          Item {
            width: parent.width
            visible: !root.showSettings
            height: agendaHeadBox.y + agendaHeadBox.height

            Rectangle {
              width: gridColumn.width
              anchors.horizontalCenter: parent.horizontalCenter
              height: Style.spacing.hairline
              color: root.contentForeground
              opacity: 0.1
            }

          Item {
            id: agendaHeadBox
            y: Style.space(14)
            width: gridColumn.width
            anchors.horizontalCenter: parent.horizontalCenter
            height: Math.max(agendaHeadRow.height, settingsOpenButton.size)

            Row {
              id: agendaHeadRow
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(8)

              Text {
                id: agendaDateLabel
                text: Qt.formatDate(root.selectedDate, "dddd d MMMM")
                color: Qt.darker(root.contentForeground, 1.4)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                font.letterSpacing: 1
              }

              Text {
                // The count earns its place only once there is more than
                // the list already shows at a glance.
                visible: root.selectedEvents.length > 3
                anchors.baseline: agendaDateLabel.baseline
                text: root.selectedEvents.length + " events"
                color: Qt.darker(root.contentForeground, 2.0)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
              }

              Text {
                // Say so when the list is shorter than the day really
                // is, rather than quietly showing a partial day.
                visible: root.hiddenCount > 0
                anchors.baseline: agendaDateLabel.baseline
                text: root.hiddenCount + " hidden"
                color: Qt.darker(root.contentForeground, 2.2)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                font.italic: true
              }
            }

            PanelActionButton {
              id: settingsOpenButton
              // Pulled out by its own padding, so the glyph lines up
              // with the grid edge rather than its hit box.
              anchors.right: parent.right
              anchors.rightMargin: -Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              iconText: "󰒓"
              tooltipText: "Calendars and agenda settings"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              onClicked: { root.closeDetail(); root.showSettings = true }
            }
          }
          }

          // ---- The settings heading, sticky for the same reason: the way back
          //      to the calendar must not scroll away under a long list of
          //      calendars.
          Item {
            width: parent.width
            visible: root.showSettings
            height: settingsHeadBox.y + settingsHeadBox.height

            Rectangle {
              width: gridColumn.width
              anchors.horizontalCenter: parent.horizontalCenter
              height: Style.spacing.hairline
              color: root.contentForeground
              opacity: 0.1
            }

          Item {
            id: settingsHeadBox
            y: Style.space(14)
            width: gridColumn.width
            anchors.horizontalCenter: parent.horizontalCenter
            height: Math.max(settingsTitle.height, settingsCloseButton.size)

            Text {
              id: settingsTitle
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              text: "SETTINGS"
              color: Qt.darker(root.contentForeground, 1.4)
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.body
              font.letterSpacing: 1
            }

            PanelActionButton {
              id: settingsCloseButton
              anchors.right: parent.right
              anchors.rightMargin: -Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              iconText: "󰅖"
              tooltipText: "Back to the calendar"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              onClicked: root.showSettings = false
            }
          }
          }
        }

        Flickable {
          id: listScroll
          anchors.top: headColumn.bottom
          anchors.topMargin: Style.space(8)
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.bottom: parent.bottom
          contentWidth: width
          contentHeight: listColumn.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          interactive: contentHeight > height

          Column {
            id: listColumn
            width: Math.max(listScroll.width, gridColumn.width)
            spacing: Style.space(8)
            // ---- The selected day itself. Its rule and heading sit in the
            //      sticky part above; what is left here is the list, which is
            //      the only thing that should move. The exporter has already
            //      sorted it and put all-day entries first, so this only
            //      paints.
            Item {
              width: parent.width
              visible: !root.showSettings
              height: agendaColumn.height

              Column {
                id: agendaColumn
                width: gridColumn.width
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: Style.space(6)

                // A quiet line rather than an empty gap: a blank block below
                // the rule would read as something failing to load.
                Text {
                  visible: root.selectedEvents.length === 0
                  text: "Nothing scheduled"
                  color: Qt.darker(root.contentForeground, 2.2)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.italic: true
                }

                Repeater {
                  model: root.selectedEvents

                  Item {
                    id: eventRow
                    required property var modelData

                    readonly property bool past: root.eventIsPast(modelData, root.selectedKey)

                    readonly property bool current: root.detailEvent === modelData
                    readonly property string joinUrl:
                      Events.meetingUrl(root.eventData, modelData)

                    width: agendaColumn.width
                    height: eventBody.height + Style.space(6)
                    // Over and done with, so it recedes rather than competing
                    // with what is still ahead — the same move the grid makes
                    // for days outside the month on show. The row whose details
                    // are open is the exception: it is what the reader is
                    // looking at, past or not.
                    opacity: (past && !current) ? 0.45 : 1.0

                    // Whole-row hit area, drawn behind everything. The open
                    // row stays marked so the side panel is visibly about it.
                    Rectangle {
                      anchors.fill: parent
                      anchors.leftMargin: -Style.space(4)
                      anchors.rightMargin: -Style.space(4)
                      radius: Style.cornerRadius
                      color: eventRow.current
                        ? Style.hoverFillFor(root.contentForeground, Color.accent)
                        : (rowMouse.containsMouse
                            ? Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                                      root.contentForeground.b, 0.05)
                            : "transparent")
                    }

                    MouseArea {
                      id: rowMouse
                      anchors.fill: parent
                      hoverEnabled: true
                      cursorShape: Qt.PointingHandCursor
                      onClicked: root.showDetail(eventRow.modelData)
                    }

                    // Calendar color as a spine rather than as text color:
                    // the title has to stay readable at whatever the theme
                    // makes of a pale calendar.
                    Rectangle {
                      x: 0
                      y: Style.space(1)
                      width: Style.space(2)
                      height: eventBody.height
                      radius: width / 2
                      color: eventRow.modelData.color || root.contentForeground
                      opacity: 0.85
                    }

                    Column {
                      id: eventBody
                      x: Style.space(10)
                      width: parent.width - x
                      spacing: Style.space(1)

                      Row {
                        width: parent.width
                        spacing: Style.space(8)

                        Text {
                          id: timeText
                          // Fixed width so every title in the list starts on
                          // the same column, whether its neighbour is an
                          // all-day entry or a 09:00 - 12:00 range.
                          width: Style.space(86)
                          text: eventRow.modelData.allDay
                            ? "all day"
                            : (Events.timeLabel(eventRow.modelData) || "—")
                          color: Qt.darker(root.contentForeground, 1.6)
                          font.family: root.contentFontFamily
                          font.pixelSize: Style.font.bodySmall
                          font.italic: eventRow.modelData.allDay
                        }

                        Text {
                          width: parent.width - timeText.width - Style.space(8)
                            - (eventRow.joinUrl !== "" ? Style.space(22) : 0)
                          text: eventRow.modelData.title
                          color: root.contentForeground
                          font.family: root.contentFontFamily
                          font.pixelSize: Style.font.bodySmall
                          elide: Text.ElideRight
                        }
                      }

                      // Second line only when there is something to say:
                      // where it is, which calendar it came from, or which
                      // day of a run this is.
                      Text {
                        readonly property string detail: {
                          var parts = []
                          var span = Events.spanLabel(eventRow.modelData)
                          if (span !== "") parts.push(span)
                          if (eventRow.modelData.location)
                            parts.push(String(eventRow.modelData.location))
                          var cals = Events.calendarLabel(eventRow.modelData)
                          if (cals !== "") parts.push(cals)
                          return parts.join("  ·  ")
                        }
                        visible: detail !== ""
                        x: timeText.width + Style.space(8)
                        width: parent.width - x
                        text: detail
                        color: Qt.darker(root.contentForeground, 2.1)
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                        elide: Text.ElideRight
                        maximumLineCount: 1
                      }
                    }

                    // Its own target, declared last so it sits above the row's
                    // hit area: a click here joins the call, a click anywhere
                    // else opens the details. Only shown when there is a link,
                    // which also makes it the sign that there is one.
                    Item {
                      id: joinButton
                      visible: eventRow.joinUrl !== ""
                      width: Style.space(20)
                      height: Style.space(20)
                      anchors.right: parent.right
                      anchors.top: parent.top

                      Text {
                        anchors.centerIn: parent
                        text: "󰕧"
                        color: joinMouse.containsMouse
                          ? Color.accent
                          : Qt.darker(root.contentForeground, 1.9)
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.bodySmall
                      }

                      MouseArea {
                        id: joinMouse
                        anchors.fill: parent
                        anchors.margins: -Style.space(3)
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.joinMeeting(eventRow.joinUrl)
                      }

                      PanelToolTip {
                        visible: joinMouse.containsMouse
                        text: "Join " + Events.shortUrl(eventRow.joinUrl)
                        fontFamily: root.contentFontFamily
                      }
                    }
                  }
                }
              }
            }

            // ---- Settings, in place of the calendar rather than below it: the
            //      agenda can run to a dozen rows, and a settings block hanging
            //      off the end of that is a block nobody finds. Omarchy 4.x has
            //      no host-rendered settings form for plugin widgets (the
            //      manifest's settingsForm/schema fields are carried but not
            //      consumed), so the screen lives here, in the panel it
            //      configures.
            Item {
              width: parent.width
              visible: root.showSettings
              height: settingsColumn.height

              Column {
                id: settingsColumn
                width: gridColumn.width
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: Style.space(10)

                PanelSectionHeader {
                  text: "AGENDA"
                  foreground: root.contentForeground
                  fontFamily: root.contentFontFamily
                }

                Toggle {
                  width: parent.width
                  label: "Hide past events"
                  description: root.hidePastEvents
                    ? "Entries that have ended are left out of the agenda."
                    : "Entries that have ended stay, dimmed."
                  checked: root.hidePastEvents
                  foreground: root.contentForeground
                  accent: Color.accent
                  fontFamily: root.contentFontFamily
                  onClicked: root.setHidePastEvents(!root.hidePastEvents)
                }

                Item {
                  width: parent.width
                  height: calendarsHeader.height

                  PanelSectionHeader {
                    id: calendarsHeader
                    anchors.left: parent.left
                    text: "CALENDARS"
                    foreground: root.contentForeground
                    fontFamily: root.contentFontFamily
                  }

                  // Only offered when it would do something: with nothing
                  // hidden it is a button that cannot act.
                  Text {
                    id: showAllLink
                    visible: root.hiddenCalendars.length > 0
                    anchors.right: parent.right
                    anchors.baseline: calendarsHeader.baseline
                    text: "show all"
                    color: showAllMouse.containsMouse
                      ? Color.accent
                      : Qt.darker(root.contentForeground, 1.8)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    font.underline: showAllMouse.containsMouse

                    MouseArea {
                      id: showAllMouse
                      anchors.fill: parent
                      anchors.margins: -Style.space(4)
                      hoverEnabled: true
                      cursorShape: Qt.PointingHandCursor
                      onClicked: root.showAllCalendars()
                    }
                  }
                }

                // The list comes from the events file, so it names exactly the
                // calendars the exporter actually delivers.
                Text {
                  visible: root.calendarRows.length === 0
                  width: parent.width
                  text: "No calendars loaded yet."
                  color: Qt.darker(root.contentForeground, 2.2)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.italic: true
                  wrapMode: Text.WordWrap
                }

                Repeater {
                  model: root.calendarRows

                  Item {
                    id: calendarRow
                    required property var modelData

                    width: settingsColumn.width
                    height: Math.max(calendarSwitch.height, calendarName.height)
                          + Style.space(2)

                    // Same swatch as the agenda's spine and the grid's dots,
                    // so a colour means one calendar everywhere in the panel.
                    Rectangle {
                      id: calendarSwatch
                      anchors.left: parent.left
                      anchors.verticalCenter: parent.verticalCenter
                      width: Style.space(6)
                      height: width
                      radius: width / 2
                      color: calendarRow.modelData.color
                      opacity: calendarRow.modelData.hidden ? 0.3 : 0.95
                    }

                    Text {
                      id: calendarName
                      anchors.left: calendarSwatch.right
                      anchors.leftMargin: Style.space(8)
                      anchors.right: calendarSwitch.left
                      anchors.rightMargin: Style.space(8)
                      anchors.verticalCenter: parent.verticalCenter
                      text: calendarRow.modelData.name
                      // A hidden calendar reads like a past entry: still
                      // legible, clearly not in play.
                      color: calendarRow.modelData.hidden
                        ? Qt.darker(root.contentForeground, 2.1)
                        : root.contentForeground
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.bodySmall
                      elide: Text.ElideRight
                    }

                    // Checked means shown, not hidden: the switch answers the
                    // question the row asks, which is "is this calendar on?"
                    ToggleSwitch {
                      id: calendarSwitch
                      anchors.right: parent.right
                      anchors.verticalCenter: parent.verticalCenter
                      checked: !calendarRow.modelData.hidden
                      foreground: root.contentForeground
                      accent: Color.accent
                      onToggled: root.toggleCalendar(calendarRow.modelData.name)
                    }
                  }
                }
              }
            }
          }
        }

        ScrollHint {
          view: listScroll
          downwards: false
          anchors.left: listScroll.left
          anchors.right: listScroll.right
          anchors.top: listScroll.top
        }

        ScrollHint {
          view: listScroll
          downwards: true
          anchors.left: listScroll.left
          anchors.right: listScroll.right
          anchors.bottom: listScroll.bottom
        }
      }
    }
  }
}
