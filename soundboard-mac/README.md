# Dungeon Radio (macOS)

A desktop soundboard for your Mac. You can:

- **Add your own sounds.** Click **+ Add Sounds** or drag audio files (mp3, wav, m4a, aac, ogg, opus, flac, aiff, caf, webm) onto the board. You're asked to tag them as they're added.
- **Clips and Full Sounds.** Short effects are *Clips*, shown as tiles. Songs and long tracks are *Full Sounds*, shown as rows with a play button, a timer and a progress bar.
- **Tags and filters.** Premade tags (surprise, comedy, horror, shock, suspense, combat, magic, creature, weather, nature, tavern, music, victory, sad, mystery) plus your own. A sound can have several. Filter from the sidebar by one or more tags, search names and tags, and sort.
- **Scene Kits.** Collect clips, full songs and Bashes from your whole library into a kit for a scene, such as "Tavern Brawl" or "Dragon's Lair", and open it from the sidebar.
- **Bashes.** Named groups of sounds that play together with one click, each with a cover image or icon. Every Bash opens in its own editor window, with a timeline for choosing when each sound starts and layering sounds.
- **Ambience layers.** Loop background sounds under the soundboard, such as rain, campfire, wind, ocean, a forest stream, cave drips, night forest, a dark dungeon drone, a thunderstorm with lightning, howling wind or a stormy sea. Each layer has its own volume and fades in and out. Any sound in your library can also be a layer, such as a song you saved from YouTube.
- **Save full audio from YouTube.** Save a whole video's audio track, such as a song or a one-hour tavern mix, to your library.
- **Clip sounds from YouTube.** A built-in YouTube browser lets you search for a video, mark a start and end, and save that piece of audio as a new sound.
- **Play sounds** by clicking a tile, or with a **global hotkey** (such as ⌥⌘1) that works even when the app is in the background.
- **Choose an output device**, for example a virtual cable like BlackHole, so others hear your sounds on Discord or Zoom.
- Set per-sound **volume**, **color** and **name**, and drag tiles to reorder them. You can also filter sounds, use a master volume, and press **Stop All** (or Esc).

## Run it

You need [Node.js](https://nodejs.org) 20 or newer (`brew install node`).

```bash
cd soundboard-mac
npm install
npm start
```

## Build a real .app / .dmg

```bash
npm run dist
```

The DMG is written to `dist/`. Open it and drag **Dungeon Radio** into Applications. The build isn't code-signed, so the first time you open the app, right-click it and choose **Open**.

The app icon comes from `build/icon.png` (1024×1024).

## Recording a sound

Click **Record** in the toolbar, then the red button, and record with your microphone (up to 10 minutes). Click it again to stop. **Listen** plays it back; name it and click **Save** to add it to your library. macOS asks for microphone access the first time.

## Making a sound from YouTube

1. Click **▶ YouTube** to open the browser panel.
2. Search, or paste a video link, and open a video.
3. Play the video. Click **Set Start** and **Set End** at the moments you want, or type times such as `1:23.5`.
4. Click **Preview** to hear your selection. Then give the sound a name (optional) and click **✂ Create Sound**.

The app plays the selected range once and records the video's audio while it plays, so a 5-second clip takes about 5 seconds. It then trims the recording to the exact range and saves it as a WAV. Clips can be up to 5 minutes long. If an ad starts playing, the capture stops so you can retry after the ad.

## Layout

- **Sidebar (left):**
  - **Scene Kits**, with an item count for each.
  - **Library** views: **All**, **Clips**, **Full Sounds**, **Bashes**.
  - **Tags**, a dropdown: click **Tags** to show or hide the tag filters. When it's collapsed with filters on, it shows how many are active (for example "Tags · 2 active").
  - **Master volume**, **Output** device and **Restart instead of overlap**.
- **Top bar:** search, sort, **+ Add Sounds**, **▶ YouTube** and **■ Stop All**.
- **Main area:** Bashes, then Clips (tiles), then Full Sounds (rows).
- **Ambience:** a mixer docked at the bottom. Click its title to collapse it.

### Icons

The app has its own set of 100 icons for tabletop games, so it doesn't use emoji. They come in these groups:
- **Combat:** swords, axes, bows, shields.
- **Magic:** wands, potions, spellbooks, runes.
- **Creatures:** dragons, skulls, ghosts, tentacles.
- **People:** party, rogue, masks, moods.
- **Places:** castles, taverns, caves, dungeon gates, ships.
- **Nature and weather:** storms, wind, waves, campfires.
- **Treasure:** chests, coins, d20 and d6 dice.
- **Music.**
- The interface icons.

When you choose an icon for a Bash cover or a Scene Kit, you can search the set or browse it by group. You can also pick any **background** colour and any **icon colour**, either from presets or with the custom colour wheel. Bashes and kits made in earlier versions keep their look: their emoji are switched to the matching icon.

### Scene Kits

A Scene Kit is a board for one scene, such as "Tavern Brawl" or "Dragon's Lair". It holds clips, full songs and Bashes from your whole library. Kits only point at your sounds: a sound can be in many kits, and removing it from a kit (or deleting the kit) never deletes the sound.

**Sections.** A kit is made of sections. A new kit starts with four, already laid out: **Bashes** across the top, **Sound Effects** (clips) on the left, **Music** (full sounds) on the right, and **Ambience** along the bottom. Inside a section, Bashes appear as cards, clips as tiles and songs as rows with a timer.

**Ambience sections.** An ambience section holds looping layers for the scene, such as the built-in rain, thunderstorm or campfire loops, or any sound from your library. Each layer is a card:
- Click it to fade it in or out.
- Its slider sets its volume.
- **Stop** in the section's title bar fades out all of the section's layers.
- **＋ Add** opens the library panel with the built-in loops and your sounds. You can also drag a sound from the panel onto the section.

While a kit with an ambience section is open, the ambience strip at the bottom of the window is hidden. It comes back when you leave the kit, and its **Stop Ambience** button also stops layers started from kits. Ambience sections can be moved and resized like any other, and a kit can have more than one.

**Adding sounds.** Click **＋ Add** on any section, or **＋ Add from Library** at the top of the kit. A library panel opens on the right, already filtered to what that section is for. It has:
- Search by name or tag.
- Filters for **All / Clips / Full / Bashes**, and for tags.
- **Click to add or remove:** click an item to add it to the section (it turns green), and click again to remove it. The **Adding to** menu at the top switches which section you're filling.
- **Dragging:** drag any item from the panel onto any section.

**Organizing items.**
- Drag a sound or Bash from one section to another to move it.
- Hover an item and click **×** to take it out of that section.

**Customizing the layout.** Click **Customize Layout**:
- **Move** a section by dragging its title bar.
- **Resize** it by dragging its bottom-right corner.
- Sections snap to a 12-column grid and slide up to fill gaps.
- **＋ Section** adds a new section: a **Sound section** or an **Ambience section**.

Click **Done** to lock the layout, so nothing moves by accident during a session.

**Section options (⋯).**
- **Rename** it (double-clicking the title also works).
- **Item size:** Small, Medium or Large.
- **Meant for:** sets which items the add panel shows first (clips, full sounds, Bashes or anything).
- **Remove section.**

**Kit options:** **Edit** (name, icon, icon colour, background colour), **Duplicate** and **Delete** are at the top of the kit, and on its right-click menu in the sidebar. You can also add a single sound with **Add to Scene Kit…** in its editor, or a Bash from its **⋯** menu. These go into the section that suits them.

### Clips vs Full Sounds

Every sound has a type, which you can change in its editor or when adding it:

- **Clips** are short effects. Tapping a clip again layers another copy (unless *Restart instead of overlap* is on).
- **Full Sounds** are songs and long tracks. Clicking one again stops it, and the row shows elapsed time against the total length.

The type is detected automatically. Anything a minute or longer, and anything saved with **Save Full Audio**, starts as a Full Sound. Everything else starts as a Clip.

### Tags

- **When adding:** whenever you add sounds (files, drag and drop, a YouTube clip or a full download), a dialog asks for tags and lets you confirm each sound's name and type. Tags you pick apply to every sound in that batch. **Skip** leaves them untagged.
- **Editing:** change a sound's tags later in its editor (right-click a tile or row, or click **⋯**). Click a tag to toggle it, or type a new tag and press Enter.
- **Filtering:** click tags in the sidebar to filter. With several selected, **Match any** shows sounds with at least one of them, and **Match all** shows only sounds that have every selected tag. **untagged** finds sounds with no tags. The search box matches tags too.
- **Managing tags:** create a tag with **+ New tag** at the bottom of the tag list. Hover a custom tag to delete it; this removes it from all sounds, but the sounds stay. Premade tags can't be deleted.

## Bashes

A Bash plays several sounds at once from one card, for example "Ambush!" with a war horn, a battle cry and clashing swords. Bashes appear in the **Bashes** row above your sounds:

- **Click a card** to play the Bash. Click it again, press **Stop All**, or press Esc to stop it.
- **Double-click a card**, or use **⋯ → Edit…**, to open its editor in a new window. The **⋯** menu also has **Duplicate** and **Delete**. Deleting a Bash never deletes its sounds.
- **+ New Bash** creates an empty Bash and opens its editor. You can also add a sound to a Bash from the sound's own editor, using **Add to Bash…**.

In the editor window:

- **Adding sounds:** click **+** next to a sound in the list on the left, or drag it onto the timeline. Sounds added with **+** start at 0:00, so by default everything plays at the same moment. Each sound gets its own layer (row).
- **Timing and layering:** drag a clip **left or right** to change when it starts, or **up and down** to move it between layers. Clips snap to 0.1 s and to the edges of other clips. Hold ⌥ while dragging, or turn off **Snap**, for free positioning. You can also select a clip and type an exact start time, or use ←/→ to nudge it by 0.1 s (⇧ for 1 s) and ↑/↓ to change its layer.
- **Per-clip controls:** each clip has its own **Volume**, plus **Duplicate** and **Remove** (Delete key).
- **Repeat:** select a clip and tick **Repeat**.
  - **wait** is the number of seconds between plays. 0 starts it again the instant it ends, with no gap.
  - **plays** is how many times it plays in total. Leave it empty to repeat until the Bash is stopped.
  - Repeats show as dashed copies on the timeline. A Bash with an endless repeat shows **∞** as its length, and its card pulses while it plays. Stop it by clicking the card again, pressing **Stop All**, or pressing Esc.
- **Playback:** Space or **▶ Play** plays from the playhead. Click the ruler to move the playhead.
- **Cover and name:** click the cover at the top left to pick an icon, an icon colour and a background colour, or **Upload image…** to use your own picture as album art. Edit the name next to the cover.
- **Zoom** changes the timeline scale.
- **Saving:** the editor opens as its own smaller window in front of the main app. Changes aren't saved until you click **Save** (or press ⌘S), which saves and closes the editor. Until then, **● Unsaved changes** shows at the top.
- **Closing:** **Close** (or ⌘W, or the window's red button) closes the editor. With unsaved changes it asks first: **Save**, **Don't Save** or **Keep Editing**. If you don't save a brand-new Bash, it's removed.

## YouTube ad blocker

The YouTube browser always blocks ads. It works in three ways:
- **Removes ad breaks:** it takes the list of ad breaks out of the video information YouTube sends its player, so most ads never start.
- **Skips ads that still play:** they're muted, jumped to the end, and their **Skip** button is pressed.
- **Hides banner and feed ads,** and blocks requests to ad and ad-tracking servers.

The iPad app uses the same blocker; `tools/sync-adblock.py` copies it across after changes.

## Ambience

The **Ambience** strip above the board lists the built-in loops. Click a layer's name to fade it in or out, and drag its slider to set its volume. **Volume** in the strip sets the level of all layers together, and **Stop Ambience** fades everything out. **Stop All** and Esc stop only soundboard effects, so you can fire off a spell effect without killing the rain.

To add more layers, use **+ Add layer…**, or open a sound's **⋯** menu and choose **Add to Ambience**. Library sounds stream from disk, so even hour-long tracks work.

The built-in loops are generated by `tools/generate-ambience.py` in this repo. You can regenerate or change them there.

## Live Session

Play to your players' own devices. Click **Live** in the toolbar.

**Broadcast (the GM).** Name the session and choose:

- **At the table:** players on the same Wi-Fi find it under **Tune In**. No server needed.
- **Online:** players anywhere join with a 5-character code, through Dungeon Radio's own relay server (see [`live-relay/`](../live-relay/README.md)).

Everything you play is sent to listeners: sounds, full sounds, bashes, ambience (strip and scene kit layers) and the name of the open scene kit. Players who join late pick up looping and still-playing sounds part-way through.

- **Whisper:** while broadcasting, click **Whisper** in the toolbar and tick one or more players. The next sound (or bash) you play goes only to them, then whispering switches off. (Or click **Whisper…** next to a player in the Live window.)
- **Emphasis:** click **Emphasis** in the toolbar and the next sound (or bash) makes players' phones vibrate.
- **GM only:** tick it in a sound's Edit window, and it plays only on your device. Tiles show a **GM** badge.
- **Buzz:** tick it in a sound's Edit window for big hits. Listeners' phones vibrate when it plays (a Mac shakes its window instead).

- **Players' sounds:** choose who else may play sounds for everyone, when you start broadcasting or any time after in the Live window. **Off**: only you. **Their own sounds**: each player picks up to 5 sounds from their own library. **My soundboard**: each player picks up to 5 of your sounds (GM-only sounds are never offered). When a player plays one, it plays for everyone, you included, and you see who played it. You can still use all your sounds.
- **Remove:** in the Live window, **Remove** next to a player takes them out of the session.
- **Add Sounds** and **Record** hide while you broadcast.

**Tune In (a player).** Enter your name, then pick a session on this Wi-Fi or enter the GM's code. The window turns into a full-window stage in your theme's style, until you click **Leave**: rings ripple out while sounds play, whispers glow purple, buzz sounds shake the stage (with a notification and a bouncing Dock icon if Dungeon Radio isn't in front), and what's playing is grouped into sounds, full sounds and, last, ambience. A sound a player played shows their name. **Volumes** sets your own levels for music, effects and ambience. When the GM allows players' sounds, your pads sit at the bottom: **Choose** up to 5, then click one to play it for everyone.

How it works: the GM's app sends commands, not audio. Each player's app fetches every sound file once (cached by its SHA-256 hash, cleared after 30 days unused), syncs its clock with the GM's and plays each sound itself, in time. The first time a sound plays it may start a moment late while the file arrives; sounds in the open scene kit (or your clips, when no kit is open) are fetched ahead of time.

macOS asks for permission to use the local network the first time you broadcast or browse. Players on the same Wi-Fi also need the Mac's firewall to allow incoming connections for Dungeon Radio.

## Themes

Click **Options** at the bottom of the sidebar to pick a theme and a highlight colour. The themes are the same as on the iPhone/iPad:

- **System**, **Dark** and **Light**.
- **Tavern**: every page on worn parchment on a wooden table.
- **Space Age**: a starship window onto deep space, with 50s atomic panels.
- **Sci-Fi**: a glowing holographic HUD. Tiles are see-through glass with a glowing edge, and synth waves ripple through them while they play.
- **Dark Academia**: deep indigo pages in gilded frames under a starry night. Tiles are leather-bound book covers that glow with magic while they play.

The listener's stage in a Live Session takes on the theme too.

## Saving a whole video's audio

Open a video in the YouTube panel and click **⬇ Save Full Audio**. This uses yt-dlp, a free command-line YouTube downloader, which you install once:

```bash
brew install yt-dlp
```

The download runs in the background at full speed, not in real time, and the audio is saved as `.m4a`, or `.webm` for a few videos. Some videos only download properly if Deno, a JavaScript runtime, is installed too (`brew install deno`). If downloads start failing, update the tools with `brew upgrade yt-dlp`, because YouTube changes often. Only save audio you have the right to use.

## Where sounds are stored

`~/Library/Application Support/Soundboard/sounds/`. The folder keeps the app's original name, so libraries from before the rename carry over. This folder holds the audio files and a `library.json` index. You can open it from any sound's **⋯ → Show in Finder**.

## Notes

- While a sound plays, its tile shows a **Stop** button, which stops just that sound. Right-click a tile, or click its **⋯** button, to edit or delete it.
- **Repeat:** in a sound's edit dialog, turn on **Repeat when finished** and set how many seconds to wait before it replays (0 = immediately). That's good for heartbeats, footsteps or a dripping tap. Click the tile again, or press Stop All, to stop it. Repeating tiles show ↻.
- A hotkey must include ⌘, ⌥ or ⌃, or be an F-key, so it doesn't block normal typing in other apps.
- Google sometimes blocks sign-in inside embedded browsers. YouTube works fine without signing in.
- Only clip audio you have the right to use.

## Development

```bash
npm test   # unit tests for the library (incl. tags), bashes, audio helpers and Live Sessions
```

| File | Purpose |
| --- | --- |
| `src/main.js` | Window, IPC, global hotkeys, `sound://` protocol |
| `src/library.js` | Sound storage (files + `library.json`) |
| `src/preload.js` | Safe API exposed to the UI |
| `src/ytdlp.js` | Runs your installed yt-dlp to save full audio |
| `src/bashes.js` | Bash storage (`bashes.json` + `covers/`) |
| `src/kits.js` | Scene Kit storage (`kits.json`) |
| `src/live.js` | Live Session networking: local server, Bonjour, relay client, host and listener logic |
| `src/renderer/live.js` | Live window, forwarding what the board plays, players' sounds, and the listener's player and stage |
| `src/renderer/recorder.js` | Record a Sound: microphone recording, level meter, listen back and save as WAV |
| `src/renderer/themes.js` | Themes and the Options window: colours, fonts, where backdrops and panels go, book-cover tiles and playing effects |
| `src/renderer/theme-art.js` | The themes' drawings (parchment, wood, space, HUD, gilded frames, book covers, synth waves, magic, the stage) |
| `src/renderer/kits.js` | Scene Kits sidebar, kit page (including ambience sections) and dialogs |
| `src/renderer/icons.js` | The app's 100-icon set |
| `src/renderer/icon-picker.*` | Icon picker with icon and background colours |
| `src/icon-ids.js` | Validates stored icon choices and converts old emoji |
| `src/renderer/bashes-board.js` | Bash cards on the main board |
| `src/renderer/bash-editor.*` | Bash editor window (timeline) |
| `src/renderer/bash-common.js` | Bash playback engine, covers, waveforms |
| `src/renderer/tags.js` | Tag colours, chips, picker and the new-sound tagging dialog |
| `src/renderer/ambience.js` | Ambience mixer |
| `src/ambience/` | Built-in ambience loops |
| `src/youtube-preload.js` | Injected into the YouTube view; records the video's audio |
| `src/renderer/` | The UI, plus WAV encoding and trimming |
