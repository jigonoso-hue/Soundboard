# Dungeon Radio Live Session protocol (v1)

A Live Session lets one app (the **host**, the broadcaster) play to any number of
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
| `{"t":"kick","peer":"<peer>"}` | Remove a listener: the relay sends it `{"t":"kicked"}` and disconnects it |

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
| `cue {id}` or `cue {hash}` | Play one of the listener's chosen sounds for everyone (see Listeners' sounds) |
| `offer {sounds: [{hash, ext, name}]}` | The listener's own chosen sounds, at most five |
| `chunk {…}` / `missing {hash}` | Answers to the host's `need` for an offered sound |
| `roll {…}` / `rollResult {id, values}` | A dice roll on this listener's device (see Dice) |

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
| `kicked {}` | The host removed this listener; it disconnects and doesn't reconnect |
| `roll {…}` / `rollResult {id, values}` | Someone's dice roll, for everyone to see (see Dice) |
| `rolls {list: […]}` | Rolls made before this listener joined, for the roll log |
| `rules {playerSounds, limit}` | Whether listeners may play sounds: `"off"`, `"own"` or `"gm"`; `limit` is 5 |
| `catalog {sounds: [{id, name, color}]}` | The broadcaster's sounds listeners may choose from (when `playerSounds` is `"gm"`) |
| `need {hash, i}` | Request chunk `i` of a sound the listener offered |

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
  "whisper": false,        // sent only to some listeners
  "by": "Sam"              // optional: the listener who played it
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

## Listeners' sounds

The broadcaster decides whether listeners may play sounds for everyone, and can change it
during the session (`rules`):

- `"gm"`: each listener picks up to five of the broadcaster's sounds from the `catalog`
  and sends `cue {id}` to play one.
- `"own"`: each listener picks up to five sounds from their own library and
  `offer`s them. The host fetches them from the listener with `need` (the same
  chunk transfer as the other direction), then the listener sends `cue {hash}`.

The host checks every cue (the right mode, at most five different sounds per
player, at most one cue every 300 ms), then plays it on its own device and
sends `play` to everyone, a quarter of a second ahead with `by` set to the
listener's name, so all devices start together.

## Dice

Everyone in a session sees every roll. The roller's device sends `roll` as
the dice leave its hand and `rollResult` once they stop; the host checks
both, names the roller itself (`by`, from the listener's `hello`) and sends
them to everyone. Each device throws the same dice in its own screen-sized
tray and, as they slow down, renumbers their faces so they land on the
result.

```jsonc
{
  "t": "roll",
  "id": "lq2x9a-1-k3f8",          // unique per roll
  "by": "Sam",                    // set by the host
  "kinds": ["d20", "d20"],        // the dice on the table: d4 d6 d8 d10 d10t d12 d20
  "groups": [{"type": "d20", "dice": [0]}, {"type": "d20", "dice": [1]}],
                                  // what was chosen (d100 = a d10t and a d10)
  "mode": "adv",                  // "normal", "adv" (keep the higher d20) or "dis" (the lower)
  "modifier": 2,
  "color": "#b3261e",
  "dice": [{"p": [x, z], "h": 3, "v": [vx, vz], "w": [wx, wy, wz], "q": [x, y, z, w]}]
                                  // the throw: position and velocity as fractions of the
                                  // tray's half-size, height, spin, starting rotation
}
{ "t": "rollResult", "id": "lq2x9a-1-k3f8", "values": [17, 4] }
                                  // what each die shows (d10 0–9, d10t 0–9 for 00–90)
```

At most 40 dice per roll. Only the device that started a roll can finish it,
and values outside a die's range are refused.

## Host-only features

- **Broadcaster-only sounds** are never sent to listeners, nor offered in the catalog.
- **Whispers** are `play` messages sent to one or more chosen listeners, with
  `whisper: true`.
- **Kick** removes a listener. The host sends `kicked` and closes the
  connection (on the relay, with the `kick` command, so the relay enforces it
  even if the listener's app ignores the message).
- **Buzz** marks a sound as a big impact; phones vibrate when it starts (a
  notification while the app is in the background). **Emphasis** sets `buzz`
  on the broadcaster's next sound.
