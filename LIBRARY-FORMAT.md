# Shared library files

**Options → Share your library** saves a whole Dungeon Radio library as one
`.zip` file, and opens one. Every app (Mac, iPhone/iPad, Android) writes the
same file and reads it back, so a library made on any of them opens on the
others.

Code: `soundboard-mac/src/library-share.js` (the rules, also run on Android),
`soundboard-mac/src/zip.js` (the Mac's zip), `soundboard-android/core/…/bridge/LibraryZip.kt`
(Android's zip) and `soundboard-ipad/Soundboard.swiftpm/Model/LibraryShare.swift`
(iPhone/iPad: both). Keep them in step.

## The file

A standard zip:

| Name | What |
| --- | --- |
| `dungeon-radio-library.json` | The list (below) |
| `sounds/<id>.<ext>` | Each sound's audio, as it is in the library |
| `covers/<id>.<ext>` | A bash's cover picture (`<id>` is the bash's) |

To keep the file small, audio that's already compressed (mp3, m4a, ogg,
opus, flac…) and pictures are stored as they are; the list and wav or aiff
audio are deflated when that makes them smaller. No zip64, so a library file
is under 4 GB. Readers use the central directory (so zips with data
descriptors read too), only stored and deflated entries, and only the names
above: `<id>` is a lower-case UUID and `<ext>` 1–5 letters or digits.

## The list

```json
{
  "format": "dungeon-radio-library",
  "version": 1,
  "app": "Mac",                      // who made it: "Mac", "iPhone/iPad" or "Android"
  "exportedAt": "2026-10-18T12:00:00.000Z",
  "tags": ["boss fight"],            // the user's own tags
  "sounds": [{
    "id": "0f3a9c1e-…",              // lower-case UUID
    "name": "Dragon Roar",
    "file": "sounds/0f3a9c1e-….mp3",
    "color": "#5ec8ff",
    "volume": 0.6,
    "tags": ["creature"],
    "kind": "clip",                  // "clip", "full" or null (not measured yet)
    "duration": 3.2,                 // seconds, or null
    "repeat": { "gap": 2 },          // or null: play once
    "gmOnly": true, "buzz": true,    // only when true
    "source": { "title": "…", "url": "https://…", "start": 12, "end": 15, "full": true },  // or null
    "createdAt": "2026-…"
  }],
  "bashes": [{
    "id": "…", "name": "Ambush!", "createdAt": "…",
    "cover": { "type": "icon", "icon": "crossed-swords", "color": "#7c6cff", "iconColor": "#ffffff" },
            // or { "type": "image", "file": "covers/<bash id>.png" }
    "clips": [{ "id": "…", "soundId": "…", "offset": 0.5, "volume": 1, "lane": 0, "repeat": { "gap": 0, "times": 3 } }]
  }],
  "kits": [{
    "id": "…", "name": "Tavern Brawl", "icon": "mug", "color": "#f5a742", "iconColor": "#ffffff",
    "autoplay": true, "createdAt": "…",
    "sections": [{
      "id": "…", "title": "Music", "kind": "full", "x": 7, "y": 4, "w": 5, "h": 8, "size": "m",
      "items": [{ "type": "sound", "id": "…" }, { "type": "bash", "id": "…" }],
      "layers": [{ "id": "…", "kind": "builtin", "ref": "rain.wav", "volume": 0.5, "every": [60, 180], "on": true }],
      "volume": 0.8, "playlist": true, "playlistShuffle": true, "playlistLoop": "one"
    }]
  }]
}
```

Sections are the Mac's `kits.json` sections (see `soundboard-mac/src/kits.js`);
a layer's `ref` is a built-in loop's file name or a sound's id. Kits and bashes
only point at sounds and bashes that are in the file.

## Importing

Importing adds to the library and never replaces anything:

- Something with the same id already here is kept as it is, and the import
  points at it. So importing the same file twice adds nothing.
- A sound whose audio is byte-for-byte one already here (added separately on
  each device) isn't added again; the import's bashes and kits use the one
  that's here.
- Everything else keeps its id (unless that id is taken) so a library passed
  back and forth stays one library.
- On the phone apps' free version, everything new has to fit the limits
  together (`soundboard-mac/src/premium.js`), checked before anything is added;
  otherwise the Premium screen opens and nothing changes.
- Every field is checked as it's read: names are cleaned, numbers clamped,
  links must be https, and a newer `version` asks for an app update.

## Sending online with a code

**Options → Send online with a code** sends the same file through the Live
Session relay (`live-relay/`), so it reaches someone anywhere without being
stored online. Code: `soundboard-mac/src/library-send.js` (Mac and Android) and
`soundboard-ipad/Soundboard.swiftpm/Model/LibrarySend.swift`.

The sender connects as a relay host (`?role=host`) and shows the room's code;
each receiver connects with it (`?role=listen&code=…`). Any number can receive
while the sender keeps it open. Pieces are 256 KB of the zip, base64 in JSON.

| Receiver → sender | |
| --- | --- |
| `{ t: "lib-hello", v: 1, name }` | Joined: please describe the library |
| `{ t: "lib-need", i }` | Send piece `i` (a receiver asks for up to 4 at a time) |
| `{ t: "lib-done", message }` | All there and imported ("Added 12 sounds…") |
| `{ t: "lib-fail", error }` | Couldn't import it (shown to the sender) |

| Sender → receiver | |
| --- | --- |
| `{ t: "lib-offer", v: 1, name, bytes, n, chunk: 262144, sounds, bashes, kits }` | What's coming: `n` pieces |
| `{ t: "lib-chunk", i, data }` | Piece `i` (base64) |
| `{ t: "lib-error", error }` | The sender couldn't read the file |
| `{ t: "lib-stopped" }` | The sender stopped; then it sends the relay `{ t: "end" }` to close the room |

A receiver writes pieces in order, checks the total size, then imports the
file exactly as **Import Library** does (same rules, same limits). If no offer
comes within 20 seconds (a wrong code, or a Live Session's code), it gives up.
