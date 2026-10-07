# Dungeon Radio: working rules

## Keep the Mac and iPad apps 1:1

`soundboard-mac/` (Electron) and `soundboard-ipad/Soundboard.swiftpm` (SwiftUI) are the same app on two platforms. **Every feature, fix or UI change goes into both apps in the same change**, unless it is one of the platform differences listed below. That includes:

- Behaviour and options (Live Session protocol and rules, sound settings, kits, bashes, ambience).
- Look: themes, their colours, drawings and fonts, tile styles, the listener's stage.
- Wording of labels, hints and messages (keep them the same where the platforms allow).
- Docs: `soundboard-mac/README.md`, `soundboard-ipad/README.md` and the root `README.md`.
- Tests for whatever can be tested on each side (the Mac has `npm test` and Playwright e2e; the iPad code can only be syntax-checked here).

When a request names only one app, still make the matching change in the other, and say so. If something truly can't be matched, say why in the reply and add it to the list below.

Where the code lives, side by side:

| Area | Mac | iPad / iPhone |
| --- | --- | --- |
| Themes, colours, fonts | `src/renderer/themes.js`, `styles.css` | `Views/Theme.swift` |
| Theme drawings | `src/renderer/theme-art.js` | `Views/Theme.swift`, `SpaceTheme.swift`, `SciFiTheme.swift`, `AcademiaTheme.swift`, `SoundViews.swift` (SynthWave) |
| Options | `#options-dialog` (themes.js) | `Views/OptionsView.swift` |
| Live networking | `src/live.js` | `Live/LiveNet.swift`, `Live/LiveEngines.swift` |
| Live session state and UI | `src/renderer/live.js` | `Live/LiveSession.swift`, `Views/LiveView.swift` |
| Listener stage | `src/renderer/live.js` (Stage), `styles.css` | `Views/ListenerStageView.swift` |
| Listener playback | `src/renderer/live.js` (Mirror) | `Live/MirrorPlayer.swift` |
| Recording | `src/renderer/recorder.js` | `Views/RecorderView.swift` |
| Dice tray | `src/renderer/dice.js` (three.js + cannon-es) | `Views/DiceView.swift` (SceneKit) |
| Dice shapes and rules | `src/renderer/dice-geometry.js` | `Model/DiceGeometry.swift` (keep in step) |
| Roll requests, initiative, who wins | `src/renderer/table.js` | `Views/TableView.swift` |
| Games: buzzer and quiz (rules) | `src/game.js` | `Live/LiveGame.swift` (keep in step) |
| Games: screens | `src/renderer/games.js`, `styles.css` | `Views/GamesView.swift` |
| Handouts | `src/renderer/handouts.js`, `src/live.js` | `Views/HandoutsView.swift`, `Live/LiveEngines.swift` |
| Listeners' pictures | `face()` in `src/renderer/live.js`, `cleanAvatar` in `src/live.js` | `Views/FaceView.swift`, `LiveNet.cleanAvatar` |
| Playlists and scene changes | `src/renderer/music.js` | `Audio/MusicDirector.swift` (keep in step) |
| Bookmarks | `src/bookmarks.js`, `src/renderer/bookmarks.js` | `Model/Bookmarks.swift`, `Views/BookmarksView.swift` |
| Ambience (loops, now-and-then layers) | `src/renderer/ambience.js` | `Audio/AmbienceMixer.swift` |
| Relay protocol | `live-relay/PROTOCOL.md` (shared) | |
| Android Live engine | `src/live.js`, `src/game.js` | `Live/LiveEngines.swift`, `LiveGame.swift` → Android: `soundboard-android/core/` |

## Design for iPhone first

Most people use Dungeon Radio on an iPhone, so every screen is designed for an
iPhone in portrait first (about 390×844 points, down to an iPhone SE at
375×667), then scaled up to iPad and the Mac.

- Everything fits without sideways scrolling or hidden controls: rows wrap
  rather than scroll out of sight, and long text (names, quiz answers, custom
  dice faces) wraps or shrinks instead of being cut off.
- Touch targets are at least 44×44 points; the main action on a screen is
  big and within thumb reach, near the bottom.
- Panels, cards and banners never cover the controls they sit next to, and
  stay clear of the notch, the home indicator and the navigation bar.
- Use `horizontalSizeClass == .compact` (SwiftUI) for the phone layout. The
  Mac window is at least 900 points wide, so the Mac board never needs a
  phone layout; but the web screens a future Android app would reuse (dice,
  table tools, games, the listener stage) get a `max-width: 560px` layout in
  the Mac CSS that matches the iPhone's.
- On iPhone, a broadcaster's Whisper, Emphasis, Games and Dice sit in a bar at
  the bottom (BroadcastBar), Scene Kit sections stack full width, and
  editors stack their controls instead of scrolling sideways.
- On the listener's stage on iPhone, Roll Dice is a big button at the bottom
  (Volumes stays at the top), player pads are a 3-column grid, and the middle
  scrolls when a lot is playing. In the dice tray the dice buttons wrap with
  Roll on its own row at the bottom, and an open panel (custom dice, stats,
  log) hides the roll controls instead of sitting on them.
- Wrapping rows of chips (tags, icon categories, themes, accent colours,
  colour swatches) use FlowLayout on iPhone (`AnyLayout.wrappedInScroll`)
  rather than a sideways ScrollView.
- Before calling UI work done, check it at phone size: run the Mac app at
  390×844 and check for overflow, overlaps and cramped rows, as well as at
  its usual size.

## Platform differences (allowed)

- Mac only: global hotkeys, audio output device picker, the Mac's own window chrome. A Live buzz shakes the stage and shows a notification with a Dock bounce, since a Mac can't vibrate.
- iPad / iPhone only: background audio while locked, vibration, the Photos video importer, the split Add menu (Record / audio from Files / video from Files / Photos). The Mac's Add Sounds opens one file picker for audio and video files, with Record as its own toolbar button.
- iPhone only: Shake to roll (the motion sensors). Everywhere else, tap or hold Roll.
- Recordings are saved as M4A on the iPad and WAV on the Mac (Chromium can't record AAC); both play everywhere.
- Options: the iPad keeps playback and library settings on its Options screen; the Mac keeps them in the sidebar and the toolbar.

## Other rules

- Don't download or run external binaries automatically; don't loosen the Mac app's Content Security Policy.
- Mac app data stays in `~/Library/Application Support/Soundboard`, and the iOS bundle ID stays the same, so existing libraries carry over.

## Android (in progress)

`soundboard-android/` (see its README). The app builds and is tested; it
hasn't been tried on a real phone yet. To build it in the cloud sandbox, the
environment must allow `dl.google.com`.

- **How it works:** a WebView runs the Mac's `src/renderer` unchanged.
  - `web/node-shim.js` runs the Mac's store modules unchanged.
  - `web/android-main.js` is the `window.soundboard` API.
  - `core/.../bridge/` is the native side (files, the sound server, and Live
    through the Kotlin engine).
  - `app/` is the Android shell (framework APIs only).
- **Protocol or rule changes:** these now go into `src/live.js`,
  `Live/LiveEngines.swift` **and** `core/src/main/kotlin/com/dungeonradio/live/`,
  with `InteropTest` kept passing.
- **New `window.soundboard` calls or events in `main.js`/`preload.js`:** also
  go into `web/android-main.js` (and `LiveBridge` for Live ones).
- **Layout:** phone layouts for Android go in `web/android.css`.
- **Before pushing Android changes:** run `gradle :core:test` and the
  `web-test/` scripts (`smoke.js`, `phone-tour.js`, `live-e2e.js`).

The original plan, for reference:

- **Capacitor around the Mac app's web code** (src/renderer): most screens,
  the dice and the games carry over. Rebuild natively, as Capacitor plugins,
  what Electron's main process does: the sound library and files, recording,
  background audio (a foreground service, so a locked phone keeps playing),
  the Live host and listener engines, local Wi-Fi discovery, YouTube capture.
- **Possibly a web listener first**: tune in from a browser with a code (online
  sessions only), served by the relay.
- **Choose the permanent package ID up front and turn on Play App Signing**,
  so a later native rewrite ships as an ordinary update.
- **Keep the sound library as plain files with a simple index** (not inside
  web storage), so a later native app can migrate it.
- **Performance levels, picked automatically**: test the device at first
  launch, watch the frame rate while running, and step down before it
  stutters.
  - **Full:** 3D dice everywhere.
  - **Reduced:** simpler shadows; one other person's roll on screen at a time.
  - **Lite:** your own roll is a flat animation with random numbers; other
    people's rolls show no dice, just the result when they land; banner-only
    nat 20/1; a still stage background.
  - A manual "Dice effects" setting overrides it.
  - Already built into the Mac (dice.js) and iPhone (DiceView.swift) apps;
    the Android app reuses the Mac's.
- Android joins the 1:1 rule like the others, iPhone-first layouts included.

