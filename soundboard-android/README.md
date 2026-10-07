# Dungeon Radio for Android

The full Dungeon Radio app for Android phones and tablets. It has the same
screens as the Mac app (the library, Scene Kits, bashes, ambience, playlists,
bookmarks, recording, dice, games and handouts). It also shares Live Sessions
with the Mac and iPhone/iPad apps, at the table or online, as broadcaster or
listener.

**Status:** the app builds (`gradle :app:assembleDebug`) and passes lint with
no errors. It hasn't been tried on a real phone yet.

## How it's built

The app is a WebView running the Mac app's own web screens
(`soundboard-mac/src/renderer`), unchanged. A thin Android layer sits around
them, and a native Kotlin side does what Electron's main process does on the
Mac.

- **`web/`**: the Android layer for the web screens.
  - `node-shim.js`: just enough of Node (`fs`, `path`, `Buffer`, `require`)
    for the Mac's store modules (`src/library.js`, `bashes.js`, `kits.js`,
    `bookmarks.js`) to run unchanged. Files go through the native bridge
    (`DRNative`).
  - `android-main.js`: the `window.soundboard` API the screens expect, as the
    Mac's `main.js` and `preload.js` give it.
  - `android-ui.js` and `android.css`: phone-first layout.
    - The sidebar becomes a drawer, touch targets are 44 px and nothing
      scrolls sideways.
    - Scene Kit sections stack, and the bash editor is laid out for a phone.
    - The Back button closes what's open.
  - `android-editor.js`: the bash editor, as a layer over the board.
- **`scripts/assemble-web.js`**: puts the Mac's screens and the Android layer
  together into the app's assets. The Gradle build runs it. It needs Node,
  plus `npm install` in `soundboard-mac/` for the dice's 3D libraries.
- **`core/`** (plain Kotlin; builds and tests on any JVM):
  - `live/`: the Live Session engine, a port of the Mac's `src/live.js` and
    `src/game.js`.
    - Hosting at the table (a WebSocket server) or online (the relay).
    - Listening: clock sync, the file cache, handouts and pictures.
    - Rolls, dice colours, the buzzer and quiz, and players' sounds.
  - `bridge/`: the native side of the web screens.
    - `AppFiles`: the page's files, kept inside the app's folder.
    - `SoundServer`: sounds over `127.0.0.1` with byte ranges and a secret
      path. It plays the role of the Mac's `sound://` protocol.
    - `NativeBridge`: answers `DRNative.call` and `callAsync`.
    - `LiveBridge`: the engine behind the same calls and events as the Mac's
      `main.js`, so the Mac's `live.js` screen runs unchanged.
    - `Platform`: what the phone itself provides.
- **`app/`** (Android, framework APIs only, no AndroidX):
  - `MainActivity`: the WebView and the app's assets on an https origin
    (`AppAssets`).
    - The system file picker and "Save as…".
    - The microphone for recording.
    - Edge-to-edge insets, and Back.
  - `AndroidPlatform`: buzzes (a vibration, plus a notification while the app
    is in the background).
  - `Lan`: finds and announces sessions at the table with DNS-SD
    (`_dungeonradio._tcp`, the same Bonjour service the Mac and iPhone use).
  - `SessionService`: a foreground service with wake and Wi-Fi locks. A Live
    Session keeps playing with the screen off or the app in the background.
  - With nothing open, Back sends the app to the background rather than
    closing it, so sounds keep going.

## Tests

```bash
cd soundboard-android
gradle :core:test                 # engine rules, Mac interop, the bridge
node web-test/smoke.js            # the web layer in Chromium at phone size
node web-test/phone-tour.js       # every screen: screenshots + layout audit
node web-test/live-e2e.js         # two phones in a Live Session, real native side
node web-test/premium.js         # free limits, locked features, buying
gradle :app:assembleDebug :app:lintDebug   # the app (needs the Android SDK)
```

Needs Node, plus `npm install` in `soundboard-mac/` and `live-relay/`.

- `InteropTest` runs the Mac app's real engine and the real relay
  (`core/src/test/node/harness.js`):
  - an Android listener with a Mac broadcaster, at the table;
  - a Mac listener with an Android broadcaster, online;
  - Android to Android.
- `BridgeTest` checks the native side:
  - files stay in the app's folder;
  - the sound server handles byte ranges and refuses paths without the
    secret or outside its folders;
  - the calls answer like the Mac;
  - two bridges hold a Live Session: a sound, ambience, a secret handout and
    a picture.
- `live-e2e.js` runs the web screens in Chromium. Each page sits on the real
  Kotlin bridge (`DevServer.kt`, which serves `DRNative` over HTTP), and the
  pages are joined through the real relay. It checks:
  - adding a sound through the picker;
  - broadcasting online and tuning in with the code;
  - the listener playing the sound from its own sound server;
  - a built-in ambience loop;
  - leaving the session.
- `web-test/fake-native.js` is a lighter stand-in for the native side, used
  by the smoke test and the phone tour.

## Building the app

1. Open `soundboard-android/` in Android Studio. It writes `local.properties`
   with the SDK's location, which turns on the `app` module.
2. Run `npm install` in `soundboard-mac/` (Node is needed for the web screens).
3. Run the `app` configuration, or `gradle :app:assembleDebug`.

The application ID is `com.dungeonradio.app`. Choose the permanent one before
the first Play Store upload, and turn on Play App Signing (see `CLAUDE.md`).
Until there's a release key, release builds are signed with the debug key so
you can install them by hand.

## Not on Android yet

- YouTube clipping (the Mac's built-in browser).
- Global hotkeys.
