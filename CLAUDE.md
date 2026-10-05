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
| Relay protocol | `live-relay/PROTOCOL.md` (shared) | |

## Platform differences (allowed)

- Mac only: global hotkeys, audio output device picker, the Mac's own window chrome. A Live buzz shakes the stage and shows a notification with a Dock bounce, since a Mac can't vibrate.
- iPad / iPhone only: background audio while locked, vibration, the Photos video importer, the split Add menu (Record / audio from Files / video from Files / Photos). The Mac's Add Sounds opens one file picker for audio and video files, with Record as its own toolbar button.
- iPhone only: Shake to roll (the motion sensors). Everywhere else, tap or hold Roll.
- Recordings are saved as M4A on the iPad and WAV on the Mac (Chromium can't record AAC); both play everywhere.
- Options: the iPad keeps playback and library settings on its Options screen; the Mac keeps them in the sidebar and the toolbar.

## Other rules

- Don't download or run external binaries automatically; don't loosen the Mac app's Content Security Policy.
- Mac app data stays in `~/Library/Application Support/Soundboard`, and the iOS bundle ID stays the same, so existing libraries carry over.
