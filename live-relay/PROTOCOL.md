# Dungeon Radio Live Session protocol (v1)

A Live Session lets one app (the **host**, usually the GM) play to any number of
other copies of the app (**listeners**). The host never streams audio. It sends
small commands ("play this sound at this time"), and each listener plays the
sound itself from a local copy. Files are sent once, on request, and cached by
their SHA-256 hash.

Everything is JSON text over a WebSocket. Every message has a `t` (type) field.

## Two ways to connect

**At the table (local network).** The host runs a WebSocket server on the local
network and advertises it with Bonjour as `_dungeonradio._tcp`, with a TXT
record `name=<session name>`. Listeners browse for that service and connect
straight to it. Messages go directly between host and listener, unwrapped.

**Online (relay).** Both sides connect to the relay server (`live-relay/`):

- Host: `wss://<relay>/live?role=host` → the relay answers `{"t":"room","code":"K7QX2","key":"…"}`.
  To resume after a dropped connection (within 60 s): `?role=host&code=K7QX2&key=…`.
- Listener: `wss://<relay>/live?role=listen&code=K7QX2`.

The relay wraps traffic for the host only:

| Relay → host | Meaning |
| --- | --- |
| `{"t":"room","code","key"}` | Room created (or resumed) |
| `{"t":"join","peer"}` | A listener connected |
| `{"t":"leave","peer"}` | A listener left |
| `{"t":"msg","peer","msg":{…}}` | A message from that listener |

| Host → relay | Meaning |
| --- | --- |
| `{"t":"send","msg":{…}}` | To every listener |
| `{"t":"send","to":"<peer>","msg":{…}}` | To one listener |

Listeners send and receive bare messages. The relay sends a listener
`{"t":"no-room"}` if the code is unknown and `{"t":"ended"}` when the host
leaves for good. Messages are limited to 1 MB.

On the local network the host assigns peer ids itself.

## Messages

### Listener → host

| Message | Meaning |
| --- | --- |
| `hello {name, device, v: 1}` | First message after connecting |
| `ping {id, t0}` | Clock sync; `t0` is the listener's clock in ms |
| `need {hash, i}` | Request chunk `i` of a file |

### Host → listener

| Message | Meaning |
| --- | --- |
| `welcome {peer, host, v: 1}` | Reply to `hello`; `host` is the session name |
| `pong {id, t0, t1}` | Reply to `ping`; `t1` is the host's clock in ms |
| `chunk {hash, i, n, ext, data}` | Chunk `i` of `n` (base64, up to 256 KB of file each) |
| `missing {hash}` | The host doesn't have that file any more |
| `scene {name}` | The scene kit the host has open (`null` for the library) |
| `prefetch {files: [{hash, ext}]}` | Files the listener should fetch ahead of time |
| `play {…}` | Play a sound (below) |
| `stop {group}` | Stop everything in a group |
| `volume {group, volume}` | Change the volume of a group |
| `stopAll {}` | Stop all sounds (not ambience) |
| `ambience {layers: […]}` | The full ambience state (below) |
| `bye {}` | The host ended the session |

The listener estimates the clock offset from a few `ping`/`pong` round trips
(`offset = t1 − (t0 + t2) / 2`, keeping the sample with the shortest round trip)
and converts host times to its own clock.

### `play`

```json
{
  "t": "play",
  "pid": "p42",            // unique per play
  "group": "s:<sound id>", // stop/volume target: "s:<sound id>" or "b:<bash run id>"
  "hash": "<sha256>", "ext": "mp3", "name": "Dragon Roar",
  "at": 1767000000000,     // host clock (ms) when the sound's start plays
  "volume": 0.8,           // 0…1, already including the host's master volume
  "cat": "sfx",            // "sfx", "music" or "ambience": the listener's volume sliders
  "loop": false,           // repeat with no gap
  "gap": 3,                // optional: repeat after this many seconds
  "buzz": false,           // vibrate phones when it starts
  "whisper": false         // sent only to this listener
}
```

If `at` is in the past (a late joiner, or a file that arrived late), the
listener starts part-way through. If the file isn't cached, it requests it and
plays once it arrives, still in sync with `at`.

### `ambience`

```json
{ "t": "ambience", "layers": [
  { "key": "strip:rain", "builtin": "rain.wav", "name": "Rain", "volume": 0.6 },
  { "key": "kit:3f…", "hash": "<sha256>", "ext": "wav", "name": "Cave Drips", "volume": 0.4 }
] }
```

The listener fades in layers it isn't playing, fades out layers that are gone,
and adjusts volumes. Built-in loops ship with every copy of the app, so they
need no transfer.

## Host-only features

- **GM-only sounds** are never sent to listeners.
- **Whispers** are `play` messages sent to a single listener, with `whisper: true`.
- **Buzz** marks a sound as a big impact; phones vibrate when it starts.
