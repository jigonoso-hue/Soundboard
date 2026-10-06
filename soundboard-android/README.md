# Dungeon Radio for Android

The Android version of Dungeon Radio, made to share Live Sessions with the Mac
and iPhone/iPad apps: an Android phone can tune in to a Mac or iPhone
broadcast, at the table or online, and broadcast to them.

**Status: in progress.** Stage 1 (the Live Session engine) is done and
tested against the Mac app and the relay. The app itself (stage 2 on) needs
the Android SDK to build.

## How it's built

As planned in the repo's `CLAUDE.md`:

- **`core/`** (plain Kotlin, any JVM): the Live Session engine, a port of the
  Mac app's `src/live.js` and `src/game.js` (and the iPhone app's
  `Live/LiveEngines.swift`, `LiveGame.swift`).
  - `LiveNet.kt`: the protocol's constants and checks (relay URLs, fades,
    titles, listeners' pictures, file chunks).
  - `FileFetcher.kt`: fetches files in hash-checked 256 KB chunks.
  - `Transports.kt`: hosting at the table (a WebSocket server on the phone,
    advertised on the local network) and online (through the relay).
  - `LiveHost.kt`: the broadcaster: answers listeners, serves files, plays,
    ambience, scenes, roll checks and dice colours, roll requests and
    initiative, the buzzer and quiz, players' sounds, handouts (secret ones
    too) and pictures.
  - `LiveListener.kt`: the listener: clock sync, file cache, commands with
    local times and files, handouts in a temporary folder, its picture,
    rolls, games and its own sounds.
  - `Game.kt`, `Rolls.kt`: the buzzer and quiz rules; the checks on rolls.
- **`app/`** (stage 2, needs the Android SDK): Capacitor around the Mac app's
  web screens (`soundboard-mac/src/renderer`), so the board, Scene Kits,
  dice, games and the listener's stage carry over, with native code for what
  Electron's main process does on the Mac: the sound library and its files,
  the Live engine above, local-network discovery (NsdManager), background
  audio (a foreground service, so a locked phone keeps playing) and
  recording.

## Tests

```bash
cd soundboard-android
gradle :core:test
```

Besides the rules, `InteropTest` runs the Mac app's real engine and the real
relay (`core/src/test/node/harness.js`, needs Node and `npm install` in
`soundboard-mac/` and `live-relay/`) and checks, end to end:

- an Android listener tuning in to a Mac at the table: sounds fetched in
  chunks and played in sync, a secret handout, its picture on the Mac, its
  dice colour and roll (named by the host), the buzzer, the session ending;
- a Mac listener tuning in to an Android broadcast online through the relay:
  sounds, ambience, a secret handout, the listener's picture and roll, the
  buzzer;
- Android to Android at the table, including removing a listener.

## Build notes

- Gradle repositories use `maven.google.com` (not `google()`, which is
  `dl.google.com`); both serve the same artifacts.
- Package: `com.dungeonradio`. Choose the permanent application ID before the
  first Play Store upload and turn on Play App Signing (see `CLAUDE.md`).
