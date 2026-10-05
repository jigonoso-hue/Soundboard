# Dungeon Radio for iPad and iPhone

The iPad version of the soundboard: a native SwiftUI app with the same features as the Mac app.

- **Sidebar.** Scene Kits at the top. Under them, the library views (**All**, **Clips**, **Full Sounds**, **Bashes**) with counts, and collapsible **Tags** filters.
- **Record.** **Add Sounds → Record…** records a sound with the microphone (up to 10 minutes). Listen back, name it, and save it to your library.
- **Dice.** Tap **Dice** in the toolbar (or on the stage, while tuned in). The tray fills the screen: real 3D dice tumble with physics and bounce off its edges. Tap a die to add it (touch and hold to remove), set a modifier, then tap **Roll** (hold to throw harder). **A** (green) is a d20 with advantage, **DA** (red) with disadvantage. On iPhone, turn on **Shake to roll**: the dice follow the phone as you tilt and shake it, and the roll counts once it's still and they've settled. A natural 1 on a d20 brings up a skull and crossbones; a natural 20, fireworks. **Log** lists who rolled what. In a Live Session everyone rolls in their own colour (no two people share one; pick a free one before your first roll), everyone's dice roll on their own without knocking into each other's, everyone sees every roll on their own screen, and the log is shared.
  - **Coin** flips a 3D coin. **Custom dice** has your own dice (a name, a shape and a word or number per face, like "Pizza / Tacos / Sushi"), the broadcaster's (shared in a session) and ready-made ones: Fate, Oracle, Direction, Weather, Hit location, Dinner and Genesys-style Boost, Setback, Ability, Difficulty, Proficiency and Challenge.
  - **Stats** shows everyone's rolls, d20 average, natural 20s and 1s, and the luckiest and unluckiest; when a session ends everyone gets a recap card.
  - While broadcasting: **🙈 Hidden** makes your next roll secret (listeners see blank dice and no result; it turns itself off after one roll). **Ask a roll** sends listeners a card to roll a save or check (with a DC, shown or not, to everyone or chosen listeners), with pass or fail as results come in. **Initiative** has every listener roll a d20 plus their initiative modifier while you roll for the enemies (first roll counts); **Start** runs the turn order on every screen, with "Your turn!" and a buzz for whoever's up. **Who wins?** ("Who goes first?", "Who pays?") has everyone roll, highest (or lowest) wins, with a roll-off on a tie. In the Live screen, pick a **Natural 20 sound** and **Natural 1 sound** from your Scene Kit to play for everyone.
- **Keeping dice in view, and dice effects.** When a result shows, dice hidden under the banner, the controls or the stage's buttons slide into open space (without turning, so the result is the same). On iPhone the table zooms out so the dice are a comfortable size. Rolling from a request card tumbles your dice over the screen rather than opening the tray. **Options → Performance → Dice effects:** Automatic (picks for the device, and steps down if the dice stutter or the phone gets hot), Full, Reduced (no shadows, fewer sparks) or Lite (for older iPhones: your roll as flat tiles, other people's rolls as just their result, a still stage).
- **On iPhone.** While broadcasting, Whisper, Emphasis, Games and Dice sit in a bar at the bottom of the screen; Scene Kit sections stack full width; the Bash editor's clip settings stack down the screen.
- **Games: buzzer and quiz.** While broadcasting, **Games** in the toolbar starts a buzzer or a quiz. Every listener's screen locks to it (it covers everything, sheets included, and can't be closed) until you tap **End game**; **Done** keeps it running while you use the soundboard. The buzzer says **Wait…** until you arm it; only a touch that starts after it goes live counts, and the order is by when people pressed. The quiz has two to four coloured answers, an optional right answer (or a vote) and time limit, points for speed, a leaderboard and a final podium.
- **Clips vs Full Sounds.** Short effects show as tiles, and songs and long tracks show as rows with a timer. Sounds a minute or longer count as full sounds automatically. You can change the type in a sound's editor.
- **Tags.** Premade tags (surprise, comedy, horror, shock, suspense, combat, magic and more) plus your own. After you add sounds, the app asks you to name and tag them. Filter by tags in the sidebar (**Match any** or **Match all**). Search matches names and tags. Sort by your order, name, newest or longest.
- **Bashes.** Several sounds fired together with one tap. The full-screen editor has a timeline: drag sounds left or right to set when they start, and up or down to layer them on lanes. Tap a sound to set its volume or make it repeat (with a gap, and a number of plays or until stopped). Give it a name and a cover: an icon or a photo.
- **Scene Kits.** A board for one scene, such as "Tavern Brawl". It's made of sections:
  - A new kit starts with Bashes, Sound Effects, Music and Ambience sections.
  - **Customize Layout** lets you move sections by their title bar and resize them from the corner, on a 12-column grid.
  - **Add** opens a library panel with search, type and tag filters. Tap to add or remove, or drag onto any section.
  - Drag items between sections, or long-press an item → **Move to Section**.
  - **Ambience sections** hold looping layers (built-in loops or your own sounds), each with its own on/off and volume.
  - **+ Section** asks for a name and type. It can also add a **volume slider** for the section, which adjusts everything played from it, and a **shuffle button**, which plays a random sound or bash from it. You can turn both on or off later in the section's **⋯** menu.
  - While a kit is open, the toolbar only has the master volume and **Stop All**.
- **Full sounds** show a volume slider while they play, like ambience layers. The level you set is kept for next time.
- **Options** (in the sidebar):
  - **Themes:** System, Light, Dark, plus four themed looks:
    - **Tavern:** every page is a sheet of worn parchment (torn and nicked edges, creases, mug rings and stains) on a wooden table, with book-style lettering.
    - **Space Age:** a starship window onto deep space (nebulae, stars, a ringed planet and a flying saucer) framed by riveted hull plating, with dark 50s atomic panels: cream outlines, offset colour shadows, sparkles, boomerangs and atoms.
    - **Sci-Fi:** a glowing holographic starship HUD: a blue grid with radar rings, an edge ruler and corner brackets, and cyan panels with cut corners, header tabs, hatching and status dots, in monospaced lettering.
    - **Dark Academia:** deep indigo pages in gilded frames (inward-curved corners, a double gold line, thorned corner stars, filigree curls, crest ornaments and moon phases) on a starry night with blue glows, an arcane sigil in an astrolabe ring, a crescent moon, constellations, an hourglass and a key. Sounds are leather-bound book covers that glow with magic while they play. Book-style lettering.
  - **Highlight colour:** pick one of the presets or any colour.
  - **Settings:** volumes, sorting, tag options, whether to ask for tags after adding sounds, and signing out of YouTube.
  - **Storage:** shows how much space your sounds use.
- **Icons.** The same 100 tabletop-game icons as the Mac app, for bash covers and scene kits. Search them, browse by group, and pick any background colour and icon colour.
- **Your own sounds.** Tap **+** to add audio from the Files app, or pick a video from Files or Photos and trim out the part you want.
- **Ambience layers.** Loop background sounds under the soundboard, such as rain, campfire, wind, ocean, a forest stream, cave drips, night forest, a dark dungeon drone, a thunderstorm with lightning, howling wind or a stormy sea. Each layer has its own volume and fades in and out. Any sound in your library can also be a layer.
- **Save full audio from YouTube.** Save a whole video's audio, such as a song or a tavern mix, to your library.
- **Clip sounds from YouTube.** A built-in YouTube browser opens beside the board. Mark a start and end, then tap **Create Sound**.
- While a sound plays, its tile shows a **Stop** button, which stops just that sound.
- Tap a tile to play it. Long-press a tile to edit, stop or delete it, or drag it onto another tile to reorder.
- **Repeat:** any sound can keep replaying when it finishes, after a wait you choose (0 = immediately). Tap it again to stop.
- Also includes per-sound volume and color, master volume, *restart instead of overlap*, a filter, and **Stop All**.
- Sounds play alongside other audio, such as music or a call.

It also runs on iPhone. There, the YouTube browser opens full screen.

## Install it on your iPad

You need a free Apple ID. A paid developer account isn't required.

### Option A: Swift Playgrounds on the iPad (no Mac needed)

1. Install **Swift Playgrounds** from the App Store on your iPad.
2. Copy the `Soundboard.swiftpm` folder to the iPad, for example with AirDrop, iCloud Drive or the Files app.
3. Tap it in Files to open it in Swift Playgrounds, then tap **▶ Run**.

The app runs inside Swift Playgrounds. To install it as a normal home-screen app, use Option B, or upload it to TestFlight from Swift Playgrounds (**App Settings → App Store Connect**, which needs a paid developer account).

### Option B: Xcode on your Mac

1. Open `Soundboard.swiftpm` in Xcode 15 or later.
2. Plug in your iPad and pick it as the run destination.
3. Under **Signing & Capabilities**, choose your Apple ID as the Team.
4. Press **⌘R**.

Apps installed with a free Apple ID stop opening after 7 days. Run it from Xcode again to refresh it.

## Making a sound from YouTube

1. Tap **+** in the toolbar, then **Online**.
2. Search, or paste a video link, and play the video.
3. Tap **Set Start** and **Set End** at the moments you want, or type times such as `1:23.5`.
4. Tap ▶ to preview. Then enter a name (optional) and tap **✂ Create Sound**.

The app plays the selected range once and records the audio as it plays, so a 5-second clip takes about 5 seconds. Clips can be up to 2 minutes long.

The app saves the audio that YouTube's player downloads, so nothing needs to play out loud: the video plays muted and sped up until the selected part has downloaded, and a part you've already watched saves almost instantly. If a page doesn't allow that, the app falls back to recording its own audio, which asks for permission to record the screen the first time.

**If a capture gives an error or silence**, use the fallback, which always works:

1. Start iPad **Screen Recording** from Control Center.
2. Play the part of the video you want, in this app or in Safari, then stop the recording.
3. In the app, tap **+ → Video from Photos**, pick the recording, trim it, and save.

## Ad blocker

The online (YouTube) browser always blocks ads, using the same blocker as the Mac app. It removes ad breaks from the video information, skips any ad that still plays, and hides banner ads.

## Ambience

The **Ambience** strip at the top of the board lists the built-in loops. Tap a layer to fade it in or out, and use its slider to set its volume. The slider next to the title sets all layers at once. **Stop All** stops only soundboard effects, while **Stop Ambience** fades out the background. To add a layer, tap **Add Layer**, or long-press any sound and choose **Add to Ambience**. Long-press a layer to remove it.

## Live Session

Play to your listeners' own devices, or tune in to your broadcaster's. Tap the **Live** button (the radio waves) in the toolbar.

**Broadcast.** Name the session and choose **At the table** (listeners on the same Wi-Fi find it) or **Online** (listeners join with a 5-character code through a relay server; see [`live-relay/`](../live-relay/README.md)). Everything you play goes to listeners: sounds, bashes, ambience and the open scene kit's name.

While broadcasting, two buttons join the toolbar:

- **Whisper:** a drop-down of everyone tuned in. Tick one or more listeners, and the next sound (or bash) you play goes only to them. Then it switches off again.
- **Emphasis:** the next sound (or bash) makes listeners' phones vibrate. Then it switches off again.

In the Live sheet, **Remove** next to a listener takes them out of the session.

A banner shows what's armed, with Cancel.

- **Broadcaster only:** turn it on in a sound's Edit screen and it plays only on your device. Tiles show an **Only me** badge.
- **Buzz:** turn it on in a sound's Edit screen for big hits. Listeners' iPhones vibrate whenever it plays. With the app open the phone vibrates and the stage shakes; in the background or locked, a notification vibrates the phone.
- **Listeners' sounds:** in the Live sheet (before or during the session), choose **Off**, **Their own sounds** or **My soundboard**. Each listener picks up to 5 sounds (from their own library, or from yours, minus broadcaster-only ones); when they tap one, everyone hears it, you included. You can still use all your sounds.

**Tune In (a listener).** Enter your name (required; it's shown on your sounds, rolls and everywhere else), then pick a nearby session or enter the broadcaster's code. The app switches to a full-screen stage until you leave, drawn in your theme: a radio night by default, a candlelit parchment page in Tavern, deep space with an orbiting atom in Space Age, a radar sweep in Sci-Fi, a turning gold sigil in Dark Academia. Rings pulse while sounds play; it shows the broadcaster's session and scene and what's playing (sounds, then full sounds, then ambience, with a listener's name on sounds they added); whispers glow purple and buzzes shake the screen. **Volumes** has your sliders for overall volume, music, effects and ambience. When the broadcaster allows listeners' sounds, your pads sit at the bottom (**Choose** picks up to 5). Sounds keep playing with the screen locked or while you use another app. Allow notifications when asked, so Buzz can vibrate a locked phone.

The first time you broadcast or look for sessions, iOS asks to use the local network: tap **Allow**. Online sessions go through Dungeon Radio's own relay server, built into the app, so there's nothing to set up.

The broadcaster's app sends commands, not audio: each listener fetches every sound file once, caches it, syncs its clock with the broadcaster's and plays each sound itself, in time. A Mac and an iPhone or iPad can share a session.

## Playing with the screen locked

Sounds keep playing when you lock the screen or switch to another app: music, ambience and anything already started carry on. During a Live Session (hosting or tuned in) the app also stays connected in the background, so new cues still arrive. Force-quitting the app (swiping it away) or turning the device off stops everything.

## Saving a whole video's audio

Open a video and tap **Save Full Audio**. The app saves the audio YouTube's player downloads: the video plays muted at double speed until all of it has downloaded, so a 4-minute song takes about 2 minutes.

- Ads that play before or during the video are skipped automatically.
- Keep the app open while it saves. The screen stays awake on its own, but switching apps or locking the iPad pauses it.
- Saves can be up to 3 hours long, and are stored as compressed `.m4a` files (about 1.4 MB per minute).

For faster full downloads, use the Mac app. It downloads at full speed using yt-dlp, a free YouTube downloader you install yourself.

## Where sounds are stored

Sounds are stored in the app's Documents/Sounds folder. Deleting the app deletes your sounds.

## Files

| File | Purpose |
| --- | --- |
| `Model/SoundStore.swift` | Sound storage (files + `library.json`) and tags (`tags.json`) |
| `Model/Sound.swift` | Sound, kinds, tag colours |
| `Model/Bash.swift` | Bashes and their storage (`bashes.json` + `covers/`) |
| `Model/SceneKit.swift` | Scene kits, sections and layout (`kits.json`) |
| `Model/Icons.swift`, `Model/IconData.swift` | The icon set. `IconData.swift` is generated from the Mac app's icons by `tools/generate-ios-icons.py` |
| `Audio/BashPlayer.swift` | Bash playback, timed on the audio clock |
| `Audio/SoundPlayer.swift` | Playback, volumes, progress |
| `Audio/AudioFiles.swift` | Streaming .m4a encoding of captures and trimming audio out of videos |
| `Audio/AmbienceMixer.swift` | Ambience layers |
| `Audio/BackgroundAudio.swift` | Audio session, interruptions, and staying alive in the background during Live Sessions |
| `BackgroundAudio.plist` | Declares background audio (merged into the app's Info.plist) |
| `Resources/Ambience/` | Built-in loops (made by `tools/generate-ambience.py`) |
| `Live/LiveNet.swift` | Live Session networking: WebSockets, the local server and Bonjour browser, the relay connection |
| `Live/LiveEngines.swift` | Live Session host and listener logic (files, clock sync, commands) |
| `Live/MirrorPlayer.swift` | Plays what a Live Session host sends, with the listener's volumes and haptics |
| `Live/LiveSession.swift` | Live Session state, forwarding what the board plays while hosting, whispers, emphasis, listeners' sounds and buzz |
| `Views/LiveView.swift` | The Live sheet (with Remove) and the toolbar's Live, Whisper and Emphasis controls |
| `Views/DiceView.swift` | The dice tray: 3D dice and coins (SceneKit) with physics, shake to roll, results, the roll log, stats and the recap, custom dice, hidden rolls, showing others' rolls |
| `Live/LiveGame.swift` | The buzzer and quiz rules: who buzzed first, scoring, what each person may see (a copy of the Mac's game.js) |
| `Views/GamesView.swift` | The games' screens: a listener's locked screen (its own window, above everything) and the broadcaster's Games sheet |
| `Views/TableView.swift` | The broadcaster's table: roll requests, initiative and the turn order, who goes first; listeners' request cards |
| `Model/DiceGeometry.swift` | The dice's shapes, numbering, reading a die, advantage and totals, custom and ready-made dice, stats, who won, initiative order (a copy of the Mac's dice-geometry.js) |
| `Views/RecorderView.swift` | Record a Sound: microphone recording, level meter, listen back and save |
| `Views/ListenerStageView.swift` | The full-screen stage listeners see while tuned in, their sound pads and volumes |
| `YouTube/YouTubeController.swift` | The embedded YouTube view and capture bridge |
| `YouTube/SegmentScript.swift` | Saves the audio YouTube's player downloads |
| `YouTube/AdBlockScript.swift` | YouTube ad blocker (generated from the Mac app by `tools/sync-adblock.py`) |
| `YouTube/CaptureScript.swift` | JavaScript injected into YouTube that records the video's audio |
| `Views/` | Sidebar, library board, scene kit board and library panel, bash editor, icon picker, ambience strip, YouTube panel, trim and edit screens |
