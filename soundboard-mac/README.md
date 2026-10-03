# Soundboard (macOS)

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

The DMG is written to `dist/`. Open it and drag **Soundboard** into Applications. The build isn't code-signed, so the first time you open the app, right-click it and choose **Open**.

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

### Scene Kits

A Scene Kit is a board for one scene, such as "Tavern Brawl" or "Dragon's Lair". It holds clips, full songs and Bashes from your whole library. Kits only point at your sounds: a sound can be in many kits, and removing it from a kit (or deleting the kit) never deletes the sound.

**Sections.** A kit is made of sections. A new kit starts with three, already laid out: **Bashes** across the top, **Sound Effects** (clips) on the left, and **Music** (full sounds) on the right. Inside a section, Bashes appear as cards, clips as tiles and songs as rows with a timer.

**Adding sounds.** Click **＋ Add** on any section, or **＋ Add from Library** at the top of the kit. A library panel opens on the right, already filtered to what that section is for. It has:
- Search by name or tag.
- Filters for **All / Clips / Full / Bashes**, and for tags.
- **Click to add or remove:** click an item to add it to the section (it shows ✓), and click again to remove it. The **Adding to** menu at the top switches which section you're filling.
- **Dragging:** drag any item from the panel onto any section.

**Organizing items.**
- Drag a sound or Bash from one section to another to move it.
- Hover an item and click **−** to take it out of that section.

**Customizing the layout.** Click **✥ Customize Layout**:
- **Move** a section by dragging its title bar.
- **Resize** it by dragging its bottom-right corner.
- Sections snap to a 12-column grid and slide up to fill gaps.
- **＋ Section** adds a new section.

Click **✓ Done** to lock the layout, so nothing moves by accident during a session.

**Section options (⋯).**
- **Rename** it (double-clicking the title also works).
- **Item size:** Small, Medium or Large.
- **Meant for:** sets which items the add panel shows first (clips, full sounds, Bashes or anything).
- **Remove section.**

**Kit options:** **Edit** (name, icon, color), **Duplicate** and **Delete** are at the top of the kit, and on its right-click menu in the sidebar. You can also add a single sound with **Add to Scene Kit…** in its editor, or a Bash from its **⋯** menu. These go into the section that suits them.

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
- **Cover and name:** click the cover at the top left to pick an icon and color, or **Upload image…** to use your own picture as album art. Edit the name next to the cover.
- **Zoom** changes the timeline scale.
- **Saving:** the editor opens as its own smaller window in front of the main app. Changes aren't saved until you click **Save** (or press ⌘S), which saves and closes the editor. Until then, **● Unsaved changes** shows at the top.
- **Closing:** **Close** (or ⌘W, or the window's red button) closes the editor. With unsaved changes it asks first: **Save**, **Don't Save** or **Keep Editing**. If you don't save a brand-new Bash, it's removed.

## Ambience

The **Ambience** strip above the board lists the built-in loops. Click a layer's name to fade it in or out, and drag its slider to set its volume. **Volume** in the strip sets the level of all layers together, and **Stop Ambience** fades everything out. **Stop All** and Esc stop only soundboard effects, so you can fire off a spell effect without killing the rain.

To add more layers, use **+ Add layer…**, or open a sound's **⋯** menu and choose **Add to Ambience**. Library sounds stream from disk, so even hour-long tracks work.

The built-in loops are generated by `tools/generate-ambience.py` in this repo. You can regenerate or change them there.

## Saving a whole video's audio

Open a video in the YouTube panel and click **⬇ Save Full Audio**. This uses yt-dlp, a free command-line YouTube downloader, which you install once:

```bash
brew install yt-dlp
```

The download runs in the background at full speed, not in real time, and the audio is saved as `.m4a`, or `.webm` for a few videos. Some videos only download properly if Deno, a JavaScript runtime, is installed too (`brew install deno`). If downloads start failing, update the tools with `brew upgrade yt-dlp`, because YouTube changes often. Only save audio you have the right to use.

## Where sounds are stored

`~/Library/Application Support/Soundboard/sounds/`. This folder holds the audio files and a `library.json` index. You can open it from any sound's **⋯ → Show in Finder**.

## Notes

- While a sound plays, its tile shows **■ Stop**, which stops just that sound. Right-click a tile, or click its **⋯** button, to edit or delete it.
- **Repeat:** in a sound's edit dialog, turn on **Repeat when finished** and set how many seconds to wait before it replays (0 = immediately). That's good for heartbeats, footsteps or a dripping tap. Click the tile again, or press Stop All, to stop it. Repeating tiles show ↻.
- A hotkey must include ⌘, ⌥ or ⌃, or be an F-key, so it doesn't block normal typing in other apps.
- Google sometimes blocks sign-in inside embedded browsers. YouTube works fine without signing in.
- Only clip audio you have the right to use.

## Development

```bash
npm test   # unit tests for the library (incl. tags), bashes and audio helpers
```

| File | Purpose |
| --- | --- |
| `src/main.js` | Window, IPC, global hotkeys, `sound://` protocol |
| `src/library.js` | Sound storage (files + `library.json`) |
| `src/preload.js` | Safe API exposed to the UI |
| `src/ytdlp.js` | Runs your installed yt-dlp to save full audio |
| `src/bashes.js` | Bash storage (`bashes.json` + `covers/`) |
| `src/kits.js` | Scene Kit storage (`kits.json`) |
| `src/renderer/kits.js` | Scene Kits sidebar, kit page and dialogs |
| `src/renderer/bashes-board.js` | Bash cards on the main board |
| `src/renderer/bash-editor.*` | Bash editor window (timeline) |
| `src/renderer/bash-common.js` | Bash playback engine, covers, waveforms |
| `src/renderer/tags.js` | Tag colours, chips, picker and the new-sound tagging dialog |
| `src/renderer/ambience.js` | Ambience mixer |
| `src/ambience/` | Built-in ambience loops |
| `src/youtube-preload.js` | Injected into the YouTube view; records the video's audio |
| `src/renderer/` | The UI, plus WAV encoding and trimming |
