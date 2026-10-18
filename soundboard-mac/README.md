# Dungeon Radio (macOS)

A desktop soundboard for your Mac. You can:

- **Add your own sounds.** Click **+ Add → Audio or video files…** or drag audio files (mp3, wav, m4a, aac, ogg, opus, flac, aiff, caf, webm) onto the board. You're asked to tag them as they're added.
- **Clips and Full Sounds.** Short effects are *Clips*, shown as tiles. Songs and long tracks are *Full Sounds*, shown as rows with a play button, a timer and a progress bar.
- **Tags and filters.** Premade tags (surprise, comedy, horror, shock, suspense, combat, magic, creature, weather, nature, tavern, music, victory, sad, mystery) plus your own. A sound can have several, and tiles and rows show as many as fit on one line, then "+N". Filter from the sidebar by one or more tags (with **Find a tag** to search the list), search names and tags, and sort.
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

Click **+ Add → Record…**, then the red button, and record with your microphone (up to 10 minutes). Click it again to stop. **Listen** plays it back; name it and click **Save** to add it to your library. macOS asks for microphone access the first time.

## Making a sound from YouTube

1. Click **+ Add → YouTube** to open the browser panel.
2. Search, or paste a video link, and open a video.
3. Play the video. Click **Set Start** and **Set End** at the moments you want, or type times such as `1:23.5`.
4. Click **Preview** to hear your selection. Then give the sound a name (optional) and click **✂ Create Sound**.

The app plays the selected range once and records the video's audio while it plays, so a 5-second clip takes about 5 seconds. It then trims the recording to the exact range and saves it as a WAV. Clips can be up to 5 minutes long. If an ad starts playing, the capture stops so you can retry after the ad.

## Layout

- **Sidebar (left):** the button at the start of the top bar (or **⌘\\**) hides and shows it. While it's hidden, the **Master volume** slider moves into the top bar.
  - **Scene Kits**, with an item count for each.
  - **Library** views: **All**, **Clips**, **Full Sounds**, **Bashes**.
  - **Tags**, a dropdown: click **Tags** to show or hide the tag filters. **Find a tag** narrows the list as you type (Enter turns on the first match). When it's collapsed with filters on, it shows how many are active (for example "Tags · 2 active").
  - **Master volume**, **Output** device and **Restart instead of overlap**.
- **Top bar:** the sidebar button, search, sort, **+ Add** (a menu: **Audio or video files…**, **Record…** and **YouTube**), **Dice** (in green, so it's easy to find), **Live** and **■ Stop All**.
- **Main area:** Bashes, then Clips (tiles), then Full Sounds (rows).
- **Ambience:** a mixer docked at the bottom. Click its title to collapse it.

### Icons

Bash covers and Scene Kits use 399 picture icons for tabletop games from [game-icons.net](https://game-icons.net), by Lorc, Delapouite and other artists (Creative Commons BY 3.0; credited under the icon picker and on the Licenses page). They come in these groups:
- **Combat:** swords, axes, bows, shields, armour, cannons and bombs.
- **Magic:** wands, potions, spellbooks, runes, portals, spells.
- **Creatures:** dragons, wolves, owls, hydras, krakens, orcs, goblins, skeletons, vampires.
- **People:** the party, kings, rogues, pirates, elves, dwarves, masks and moods.
- **Places:** castles, taverns, villages, caves, lighthouses, windmills, ruins, ships.
- **Nature and weather:** storms, wind, waves, campfires, volcanoes, night skies.
- **Treasure:** chests, coins, gems, rings, food and drink, d20 and d6 dice.
- **Music:** lutes, drums, harps, horns, bagpipes.
- **Sci-fi:** UFOs, rockets, starfighters, astronauts, aliens, planets, galaxies, satellites, ray guns and lasers, robots and mechs.

The interface uses the app's own line icons.

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

**Player.** In a sound section's **⋯** menu, choose **Player**. Its title bar gets a player (in a narrow section, on its own row): **Play** plays its songs (full sounds) in order and **Shuffle** in a random order, a new one each time round. Each song crossfades into the next a few seconds before it ends, and after the last it starts again. While it plays, **Back** (the start of the song, or the one before), **Stop** and **Next** work. The loop button goes round **Loop album** (the default: after the last song, start again), **Loop current sound** (a "1" on the button) and **No loop** (stop after the last song). Clicking a song starts the player from it. In a section with no songs, **Shuffle** plays a random sound or bash, never the same one twice in a row. **Stop All** stops the player too.

**Sound effects.** **Effects** in the kit's header puts an effect on the next sound you play from the kit (a tile, a row, **Shuffle**, or a player's songs): **Distant room** (muffled, as if through a wall), **Empty echo** (a big empty hall), **Old radio** (thin and crackly) or **Underwater** (deep and murky). The button glows and says which one is waiting; it's used up by the sound it goes on. Tick **Keep it on** to put it on every sound you play from the kit until you turn it off. Bashes play as they are. Listeners in a Live Session hear the effect too.

**Scene changes.** In **Edit**, tick **Start its music and ambience when opened**. Opening the kit is then a scene change: the music and ambience that are playing fade out over 3 seconds while the kit's first playlist and its ambience layers fade in: the layers you had on when you last left the kit (the first time, all of them). Listeners hear the same fades.

**Bookmarks.** **+ Save** under **Bookmarks** in the sidebar saves the moment's sound: the scene kit that's open, the playlists playing (which song and how far in), other songs playing, the ambience layers (the strip's and the kit's, with their volumes and now-and-then settings) and the master and ambience volumes. Click a bookmark to bring it all back, next session or after a detour: it's a scene change, so what isn't in the bookmark fades out over 3 seconds while each song fades back in from where it was, and listeners hear the same. Right-click a bookmark to **Update to what's playing now**, **Rename** or **Delete** it. Deleting a scene kit leaves its bookmarks (they forget the kit).

**Share your library.** In **Options**, **Export Library…** saves every sound, bash (with its cover picture), scene kit and custom tag as one `.zip` file; **Import Library…** opens one, from this Mac or from the iPhone/iPad or Android app (they all make the same file: see [`LIBRARY-FORMAT.md`](../LIBRARY-FORMAT.md)). Importing adds to your library and never replaces anything: things you already have (and sounds whose audio is exactly one you have) aren't added twice, so importing the same file again adds nothing. To keep the file small, compressed audio is stored as it is and only the list and wav or aiff audio are squeezed.

**Section options (⋯).**
- **Rename** it (double-clicking the title also works).
- **Item size:** Small, Medium or Large.
- **Meant for:** sets which items the add panel shows first (clips, full sounds, Bashes or anything).
- **Volume slider:** a slider under the title that adjusts everything played from the section, including what's already playing.
- **Remove section.**

**Kit options:** **Edit** (name, icon, icon colour, background colour), **Duplicate** and **Delete** are at the top of the kit, and on its right-click menu in the sidebar. You can also add a single sound with **Add to Scene Kit…** in its editor, or a Bash from its **⋯** menu. These go into the section that suits them.

### Clips vs Full Sounds

Every sound has a type, which you can change in its editor or when adding it:

- **Clips** are short effects. Tapping a clip again layers another copy (unless *Restart instead of overlap* is on).
- **Full Sounds** are songs and long tracks. Clicking one again stops it, and the row shows elapsed time against the total length.
- While a full sound plays, its row shows a volume slider, like an ambience layer's. The level you set is kept for next time.

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

**Now and then.** Right-click a layer (in the strip or in a scene kit) and pick **Now and then: every 20 s–1 min**, **1–3 min** or **3–8 min**: instead of looping, it plays once at a random moment in that range, again and again, until you switch it off. Use it for thunder, a wolf howling or a distant bell. The card shows the range; **Always (loops)** turns it back into a loop. Listeners hear each one as it plays.

The built-in loops are generated by `tools/generate-ambience.py` in this repo. You can regenerate or change them there.

## Live Session

Play to your listeners' own devices. Click **Live** in the toolbar.

**Broadcast.** Name the session and choose:

- **At the table:** listeners on the same Wi-Fi find it under **Tune In**. No server needed.
- **Online:** listeners anywhere join with a 5-character code, through Dungeon Radio's own relay server (see [`live-relay/`](../live-relay/README.md)). While broadcasting, **Copy Code** and **Copy Invite** copy the code (or a ready-to-send invite) for players who aren't at the table. **End Session** asks first, since it disconnects everyone.

Everything you play is sent to listeners: sounds, full sounds, bashes, ambience (strip and scene kit layers) and the name of the open scene kit. Listeners who join late pick up looping and still-playing sounds part-way through.

- **Whisper:** while broadcasting, click **Whisper** in the toolbar and tick one or more listeners. The next sound (or bash) you play goes only to them, then whispering switches off. (Or click **Whisper…** next to a listener in the Live window.)
- **Emphasis:** click **Emphasis** in the toolbar and the next sound (or bash) makes listeners' phones vibrate.
- **Broadcaster only:** tick it in a sound's Edit window, and it plays only on your device. Tiles show an **Only me** badge.
- **Buzz:** tick it in a sound's Edit window for big hits. Listeners' phones vibrate when it plays (a Mac shakes its window instead).

- **Listeners' sounds:** choose who else may play sounds for everyone, when you start broadcasting or any time after in the Live window. **Off**: only you. **Their own sounds**: each listener picks up to 5 sounds from their own library. **My soundboard**: each listener picks up to 5 of your sounds (broadcaster-only sounds are never offered). When a listener plays one, it plays for everyone, you included, and you see who played it. You can still use all your sounds.
- **Remove:** in the Live window, **Remove** next to a listener takes them out of the session.
- **Handout:** click **Handout** in the toolbar, choose a picture (a map, a wanted poster, a monster) and give it a title if you like, then **Send to everyone**. It fills every listener's screen, fitted to it, until they close it. The dialog lists what you've sent this session: click one to show it again. **Send to** picks who sees it: **Everyone**, or click listeners to make it a **secret handout** that only they get (marked 🔒 on their screen; no one else is told, and it shows again only to them).
- In the **+ Add** menu, **Audio or video files…** and **Record…** hide while you broadcast.

**Tune In (a listener).** Enter your name (you can't tune in without one; it's shown on your sounds, rolls and everywhere else), then pick a session on this Wi-Fi or enter the broadcaster's code. **Your picture** (optional) is shown beside your name to everyone: in the broadcaster's listener list, Whisper and handouts, and in games and dice rolls. **Choose…** picks one (it's cropped square); click your picture at the top of the stage to change it mid-session. The window turns into a full-window stage in your theme's style, until you click **Leave**: rings ripple out while sounds play, whispers glow purple, buzz sounds shake the stage (with a notification and a bouncing Dock icon if Dungeon Radio isn't in front), and what's playing is grouped into sounds, full sounds and, last, ambience. A sound a listener played shows their name. **Volumes** sets your own levels for music, effects and ambience. A **handout** from the broadcaster fills the window (with a notification if Dungeon Radio isn't in front): pinch or scroll to zoom, drag to look around, double-click to zoom in or out, **Save** to keep a copy, **Close** at the bottom to go back. **Handouts** at the top of the stage lists the session's handouts; they're deleted from your Mac when you leave. When the broadcaster allows listeners' sounds, your pads sit at the bottom: **Choose** up to 5, then click one to play it for everyone.

How it works: the broadcaster's app sends commands, not audio. Each listener's app fetches every sound file once (cached by its SHA-256 hash, cleared after 30 days unused), syncs its clock with the broadcaster's and plays each sound itself, in time. The first time a sound plays it may start a moment late while the file arrives; sounds in the open scene kit (or your clips, when no kit is open) are fetched ahead of time.

macOS asks for permission to use the local network the first time you broadcast or browse. Listeners on the same Wi-Fi also need the Mac's firewall to allow incoming connections for Dungeon Radio.

## Dice

Click **Dice** in the toolbar (or on the stage, while tuned in). The tray fills the window: real 3D dice tumble with physics and bounce off its edges.

- Click a die (d4, d6, d8, d10, d12, d20, d100, Coin) to add one; right-click to remove one. **−** / **+** set a modifier.
- **Roll** throws them. Hold it down to throw harder (the button fills up over a second and a half). The controls step aside while the dice roll, and once they land the dice you picked are cleared, ready for the next roll (the modifier stays).
- **A** (green) rolls a d20 with advantage: two d20s, keep the higher. **DA** (red) is disadvantage: keep the lower. The die that doesn't count is dimmed.
- A natural 1 on a d20 brings up a skull and crossbones over the die; a natural 20 sets off fireworks.
- Your dice colour is the swatch at the top: click it to choose another. **Log** lists every roll: who rolled what.

**Coins and custom dice.** **Coin** flips a 3D coin (heads or tails), shared like any roll. **Custom dice** (top of the tray) lists your own dice, the broadcaster's in a session, and ready-made ones from popular games: Fate (+ + − − blank blank, which add up), an Oracle (Yes / Yes, and… / No, but… …), Direction, Weather, Hit location, Dinner, and Genesys-style Boost, Setback, Ability, Difficulty, Proficiency and Challenge dice. **＋** adds one to your roll. **＋ New custom die** makes your own: a name, a shape (d4 to d20) and a word or number per face, such as "Pizza / Tacos / Sushi" or "Yes / No / Ask again". The broadcaster's own custom dice are shared with listeners so they can roll them too.

**Keeping dice in view.** When a result shows, any die hidden under the result banner, the controls or (over the stage) the stage's buttons and cards slides to the nearest open spot. It slides without turning, so the face on top and the result stay the same.

**Dice effects (Options → Performance).** Automatic picks a level for the computer and steps down for good if the dice stutter while rolling; or pick one. **Full:** 3D dice with shadows. **Reduced:** no shadows, fewer sparks, one other person's 3D roll at a time. **Lite:** no 3D at all: your roll is flat tiles with fairly drawn numbers (everyone else still sees 3D dice land on them), other people's rolls show "Sam is rolling…" then the result, a natural 20 or 1 is a line on the result, and the listener stage holds still.

**Stats.** Everyone's rolls in the session: how many, the d20 average, natural 20s and 1s, and the luckiest and unluckiest (highest and lowest d20 average, at least three d20s each). When the session ends, everyone gets a recap card with the same numbers.

**For the broadcaster** (while broadcasting):

- **🙈 Hidden** rolls your next roll in secret: listeners see the dice tumble with blank faces and no result, and it stays out of their log. Like Whisper and Emphasis, it turns itself off after one roll.
- **Ask a roll** asks for a save or check: what to roll ("Dexterity save"), the dice, a DC (shown to listeners or not), and everyone or chosen listeners. Each listener gets a card to roll from, with their modifier and A / DA; their dice tumble over whatever they're looking at (the dice tray doesn't open). Results come in beside the request with pass or fail; **Close and show results** shows everyone who passed.
- **Initiative**: add the enemies (name and modifier) and press **Roll initiative**. Every listener gets a card to roll a d20 plus their initiative modifier (remembered for next time); you roll for the enemies. Only each person's first roll counts. The order builds on everyone's screen as rolls come in; **Start** begins the fight. Whoever's turn it is gets a "Your turn!" card and a buzz; everyone else sees whose turn it is and who's next. **Next turn** / **Back** move along (a new round after the last), **End initiative** clears it.
- **Who wins?** — "Who goes first?", "Who pays?" or your own question: everyone rolls a d20 (you too, if you like) and the highest (or lowest) wins, shown with names on every screen. A tie offers a roll-off between the tied people.
- **Natural 20 sound** and **Natural 1 sound** (in the Live dialog, when starting a session or while broadcasting): a sound from your Scene Kit that plays for everyone when anyone rolls a natural 20 or 1.

In a Live Session everyone rolls in their own colour, and no two people can have the same one: pick a free colour before your first roll (colours others have are crossed out, with their name). Everyone's dice roll on their own, so dice thrown at the same time never knock into each other. Everyone sees every roll: the dice tumble across everyone's screen (over whatever they're looking at), with who rolled them and the result, and the roll log is shared. Late joiners get the rolls made before they arrived.

## Games: buzzer and quiz

While broadcasting, **Games** in the toolbar starts a game for everyone. Starting one locks every listener's window to it (no closing it, no other screens) until you click **End game**. Your own window isn't locked: **Hide** tucks the panel away (a red pill brings it back) so you can keep playing sounds.

- **Buzzer:** listeners see a big button that says **Wait…** until you click **Arm buzzer**; then it turns red. The order is by when each person pressed, measured in your app's clock, so a slow connection doesn't cost anyone. A press only counts if it starts after the buzzer goes live: pressing early does nothing, and a finger (or the Space key) held down from before doesn't count. **Arm again** starts a new round.
- **Quiz:** write a question with two to four answers, tick the right one (or make it a vote), pick a time limit, and **Ask everyone**. Listeners get big coloured answer tiles; you see the answers come in. The question ends when time runs out, everyone has answered, or you click **Show answer**: everyone sees the right answer, how many chose each, their points (up to 1000, more for answering fast) and the leaderboard. **Final scores** shows a podium on every screen.

## Themes

Click **Options** at the bottom of the sidebar to pick a theme and a highlight colour. The themes are the same as on the iPhone/iPad:

- **System**, **Dark** and **Light**. Synth waves ripple through sounds while they play.
- **Tavern**: every page on worn parchment on a wooden table, under a plank toolbar. Tiles are scraps of paper pinned up with brass tacks, a little crooked, and embers rise off them while they play. Full sounds, bashes and ambience layers are cream cards, and play buttons are wax seals.
- **Space Age**: a chrome-rimmed starship window onto deep space: nebulae, spiked bright stars, a spiral galaxy, a 70s gas station on an asteroid, a ringed gas giant with a cratered moon and a chrome flying saucer with its beam on, with 50s atomic panels. Cards have a gunmetal trim with corner rivets, and a planet with circling moons appears on sounds while they play.
- **Sci-Fi**: a glowing holographic HUD. Tiles are see-through glass with a glowing edge, and synth waves ripple through them while they play.
- **Dark Academia**: full sounds are the spines of leather books in their colours (gilt bands and a title label); a starry night in a dark hardwood frame, a bookcase for the sidebar, and deep indigo pages in gilded frames. Tiles are leather-bound book covers that throw off glitter and stars while they play. The toolbar and bashes are hardwood with gold trim.

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
| `src/renderer/live.js` | Live window, forwarding what the board plays, listeners' sounds, and the listener's player and stage |
| `src/renderer/recorder.js` | Record a Sound: microphone recording, level meter, listen back and save as WAV |
| `src/renderer/dice.js` | The dice tray: 3D dice and coins (three.js) with physics (cannon-es), throwing, results, the roll log, stats and the recap, custom dice, hidden rolls, showing others' rolls |
| `src/game.js` | The buzzer and quiz rules: who buzzed first, scoring, what each person may see (shared with the tests; the iPad has a copy) |
| `src/renderer/games.js` | The games' screens: a listener's locked screen and the broadcaster's panel |
| `src/renderer/table.js` | The broadcaster's table: roll requests, initiative and the turn order, who goes first; listeners' request cards |
| `src/renderer/dice-geometry.js` | The dice's shapes, numbering, reading a die, advantage and totals, custom and ready-made dice, stats, who won, initiative order (shared with the tests; the iPad has a copy) |
| `src/renderer/themes.js` | Themes and the Options window: colours, fonts, where backdrops and panels go, book-cover tiles and playing effects |
| `src/renderer/theme-art.js` | The themes' drawings (parchment, wood, space, HUD, gilded frames, book covers, scrap paper, hardwood and bookshelves, and the playing effects: synth waves, planets, glitter and embers; the stage) |
| `src/renderer/kits.js` | Scene Kits sidebar, kit page (including ambience sections) and dialogs |
| `src/renderer/icons.js` | The app's icons: line icons for the interface, picture icons for covers |
| `src/renderer/game-icons.js` | The picture icons from game-icons.net (generated by `tools/import-game-icons.py` from `tools/game-icons.json`) |
| `src/renderer/icon-picker.*` | Icon picker with icon and background colours |
| `src/icon-ids.js` | Validates stored icon choices and converts old emoji |
| `src/renderer/bashes-board.js` | Bash cards on the main board |
| `src/renderer/bash-editor.*` | Bash editor window (timeline) |
| `src/renderer/bash-common.js` | Bash playback engine, covers, waveforms |
| `src/renderer/tags.js` | Tag colours, chips, picker and the new-sound tagging dialog |
| `src/renderer/ambience.js` | Ambience mixer |
| `src/renderer/handouts.js` | Handouts: the listener's locked, zoomable viewer and list, the broadcaster's send dialog |
| `src/renderer/fx.js` | Sound effects for scene kits (Distant room, Empty echo, Old radio, Underwater), with Web Audio |
| `src/library-share.js`, `src/zip.js` | Sharing the whole library as one zip (export, import), the same file as the other apps |
| `src/renderer/music.js` | Playlists (songs one after another, crossfading) and scene changes (a kit that starts its music and ambience when opened) |
| `src/renderer/bookmarks.js`, `src/bookmarks.js` | Bookmarks: saving the moment's sound and bringing it back |
| `src/ambience/` | Built-in ambience loops |
| `src/youtube-preload.js` | Injected into the YouTube view; records the video's audio |
| `src/renderer/` | The UI, plus WAV encoding and trimming |
