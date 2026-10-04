# Soundboard for iPad

The iPad version of the soundboard: a native SwiftUI app with the same features as the Mac app.

- **Sidebar.** Scene Kits at the top. Under them, the library views (**All**, **Clips**, **Full Sounds**, **Bashes**) with counts, and collapsible **Tags** filters.
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
  - **Themes:** System, Light, Dark, plus three themed looks:
    - **Tavern:** every page is a sheet of worn parchment (torn and nicked edges, creases, mug rings and stains) on a wooden table, with book-style lettering.
    - **Space Age:** a starship window onto deep space (nebulae, stars, a ringed planet and a flying saucer) framed by riveted hull plating, with dark 50s atomic panels: cream outlines, offset colour shadows, sparkles, boomerangs and atoms.
    - **Sci-Fi:** a glowing holographic starship HUD: a blue grid with radar rings, an edge ruler and corner brackets, and cyan panels with cut corners, header tabs, hatching and status dots, in monospaced lettering.
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
| `Resources/Ambience/` | Built-in loops (made by `tools/generate-ambience.py`) |
| `YouTube/YouTubeController.swift` | The embedded YouTube view and capture bridge |
| `YouTube/SegmentScript.swift` | Saves the audio YouTube's player downloads |
| `YouTube/AdBlockScript.swift` | YouTube ad blocker (generated from the Mac app by `tools/sync-adblock.py`) |
| `YouTube/CaptureScript.swift` | JavaScript injected into YouTube that records the video's audio |
| `Views/` | Sidebar, library board, scene kit board and library panel, bash editor, icon picker, ambience strip, YouTube panel, trim and edit screens |
