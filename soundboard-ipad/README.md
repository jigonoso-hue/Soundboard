# Soundboard for iPad

The iPad version of the soundboard: a native SwiftUI app with the same features as the Mac app.

- **Your own sounds.** Tap **+** to add audio from the Files app, or pick a video from Files or Photos and trim out the part you want.
- **Ambience layers.** Loop background sounds under the soundboard, such as rain, campfire, wind, ocean, a forest stream, cave drips, night forest or a dark dungeon drone. Each layer has its own volume and fades in and out. Any sound in your library can also be a layer.
- **Save full audio from YouTube.** Save a whole video's audio, such as a song or a tavern mix, to your library.
- **Clip sounds from YouTube.** A built-in YouTube browser opens beside the board. Mark a start and end, then tap **Create Sound**.
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

1. Tap **YouTube** in the toolbar.
2. Search, or paste a video link, and play the video.
3. Tap **Set Start** and **Set End** at the moments you want, or type times such as `1:23.5`.
4. Tap ▶ to preview. Then enter a name (optional) and tap **✂ Create Sound**.

The app plays the selected range once and records the audio as it plays, so a 5-second clip takes about 5 seconds. Clips can be up to 2 minutes long.

**If a capture gives an error or silence**, use the fallback, which always works:

1. Start iPad **Screen Recording** from Control Center.
2. Play the part of the video you want, in this app or in Safari, then stop the recording.
3. In the app, tap **+ → Video from Photos**, pick the recording, trim it, and save.

## Ambience

The **Ambience** strip at the top of the board lists the built-in loops. Tap a layer to fade it in or out, and use its slider to set its volume. The slider next to the title sets all layers at once. **Stop All** stops only soundboard effects, while **Stop Ambience** fades out the background. To add a layer, tap **Add Layer**, or long-press any sound and choose **Add to Ambience**. Long-press a layer to remove it.

## Saving a whole video's audio

Open a video and tap **Save Full Audio**. iPadOS doesn't allow downloading YouTube files directly, so the app plays the video once from start to finish and records it. A 4-minute song takes about 4 minutes, and a one-hour mix takes an hour.

- By default it records silently. Turn on **Play out loud** to listen while it saves.
- Ads that play before or during the video are skipped automatically.
- Keep the app open while it records. The screen stays awake on its own, but switching apps or locking the iPad pauses the recording.
- Saves can be up to 3 hours long, and are stored as compressed `.m4a` files (about 1.4 MB per minute).

For faster full downloads, use the Mac app. It downloads at full speed using yt-dlp, a free YouTube downloader you install yourself.

## Where sounds are stored

Sounds are stored in the app's Documents/Sounds folder. Deleting the app deletes your sounds.

## Files

| File | Purpose |
| --- | --- |
| `Model/SoundStore.swift` | Sound storage (files + `library.json`) |
| `Audio/SoundPlayer.swift` | Playback, volumes, progress |
| `Audio/AudioFiles.swift` | Streaming .m4a encoding of captures and trimming audio out of videos |
| `Audio/AmbienceMixer.swift` | Ambience layers |
| `Resources/Ambience/` | Built-in loops (made by `tools/generate-ambience.py`) |
| `YouTube/YouTubeController.swift` | The embedded YouTube view and capture bridge |
| `YouTube/CaptureScript.swift` | JavaScript injected into YouTube that records the video's audio |
| `Views/` | Board, ambience strip, YouTube panel, trim and edit screens |
