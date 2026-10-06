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
| `diceColor {color}` | Asks for a dice colour (see Dice) |
| `gameInput {id, buzz: true, at}` / `gameInput {id, q, choice, at}` | A buzz or a quiz answer (see Games) |

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
| `stop {group, fade?}` | Stop everything in a group; `fade` (seconds, up to 10) fades it out instead |
| `volume {group, volume}` | Change the volume of a group |
| `stopAll {}` | Stop all sounds (not ambience) |
| `ambience {layers: […], fade?}` | The full ambience state (below) |
| `bye {}` | The host ended the session |
| `kicked {}` | The host removed this listener; it disconnects and doesn't reconnect |
| `roll {…}` / `rollResult {id, values}` | Someone's dice roll, for everyone to see (see Dice) |
| `rolls {list: […]}` | Rolls made before this listener joined, for the roll log |
| `diceColors {colors: [{peer, name, color}]}` | Who has which dice colour (`peer` `"host"` is the broadcaster) |
| `customDice {list: [{id, name, sides, faces}]}` | The broadcaster's custom dice, for listeners to roll too (see The table) |
| `ask {id, kind, label, counts, dc?, lowest?, to?}` | A roll request: a card to roll from (see The table) |
| `askClosed {id}` / `askResult {id, kind, label, …}` | A request ended; its results for everyone |
| `turns {phase, round, current, order}` | The initiative order (`phase` `"off"` clears it) |
| `game {…}` | The buzzer or quiz running; `phase` `"off"` when none (see Games) |
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
  "group": "s:<sound id>", // stop/volume target (see Groups below)
  "hash": "<sha256>", "ext": "mp3", "name": "Dragon Roar",
  "at": 1767000000000,     // host clock (ms) when the sound's start plays
  "volume": 0.8,           // 0…1, already including the host's master volume
  "cat": "sfx",            // "sfx", "music" or "ambience": the listener's volume sliders
  "loop": false,           // repeat with no gap
  "gap": 3,                // optional: repeat after this many seconds
  "buzz": false,           // vibrate phones when it starts
  "whisper": false,        // sent only to some listeners
  "by": "Sam",             // optional: the listener who played it
  "fadeIn": 4              // optional: seconds to fade in over (up to 10)
}
```

Instead of `hash` and `ext`, a play can name a built-in sound with
`"builtin": "thunderstorm.wav"` (a file name of lowercase letters, digits and
dashes, ending `.wav`). Every copy of the app has those, so nothing is fetched.

**Groups.** `s:<sound id>` is a sound tile or row; `b:<bash run id>` a bash;
`pl:<section id>:<n>` one song of a playlist (each song has its own group, so the
next can fade in while this one fades out); `a:<layer id>` a now-and-then
ambience layer (each time it plays is a `play` with `cat: "ambience"`); and
`p:<peer>:<pid>` a listener's own sound.

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
and adjusts volumes. Fades take 1.5 s, or `fade` seconds when the message has
one: a scene change sends `"fade": 3` so the old scene's ambience fades out as
the new one's fades in. Late joiners get the layers without a fade.

Now-and-then layers (thunder every few minutes) aren't in `layers`: each time
one plays, the host sends a `play` for it (group `a:<layer id>`), and a `stop`
when it's switched off. Built-in loops ship with every copy of the app, so they
need no transfer.

## Scene music

The host's app runs playlists and scene changes; listeners only see plays,
stops and ambience:

- **Playlists.** A few seconds before a song ends, the host sends the next
  song's `play` with `fadeIn` and a `stop` with `fade` for the one ending, so
  they crossfade (4 s, or a third of a short song).
- **Scene changes.** Opening a kit set to start its music and ambience sends
  `stop` with `fade: 3` for the songs playing, `play` with `fadeIn: 3` for the
  kit's playlist and `ambience` with `fade: 3`.

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
  "peer": "p3",                   // set by the host: who rolled ("host" for the broadcaster)
  "kinds": ["d20", "d20"],        // the dice on the table: d4 d6 d8 d10 d10t d12 d20 coin
  "groups": [{"type": "d20", "dice": [0]}, {"type": "d20", "dice": [1]}],
                                  // what was chosen (d100 = a d10t and a d10; a custom
                                  // die is {"type": "custom", "die": id, "dice": [i]})
  "mode": "adv",                  // "normal", "adv" (keep the higher d20) or "dis" (the lower)
  "modifier": 2,
  "color": "#b3261e",
  "dice": [{"p": [x, z], "h": 3, "v": [vx, vz], "w": [wx, wy, wz], "q": [x, y, z, w]}],
                                  // the throw: position and velocity as fractions of the
                                  // tray's half-size, height, spin, starting rotation
  "custom": [{"id": "loot", "name": "Loot", "sides": 6, "faces": ["Gold", "Gem", …]}],
                                  // optional: the custom dice in the roll, with their words
  "ask": "ask-lq2x9b-3k1",        // optional: the request this roll answers
  "hidden": true                  // optional, broadcaster only: a hidden roll
}
{ "t": "rollResult", "id": "lq2x9a-1-k3f8", "values": [17, 4] }
                                  // what each die shows (d10 0–9, d10t 0–9 for 00–90)
```

At most 40 dice per roll. Only the device that started a roll can finish it,
and values outside a die's range are refused.

**Colours.** In a session everyone rolls in their own colour, one of sixteen
(`#b3261e #2a5bd7 #1f8a5b #7b3fbf #c47a12 #1d1d24 #e8e2d0 #0f8a8a #d6457a
#7cb518 #e3611c #4fb3e8 #d4a017 #5b2a6e #9aa3ad #8a5a2b`). A listener asks with
`diceColor`; the host gives it to them unless someone else has it, and sends
everyone the new `diceColors` list (a refused listener just gets the list). A
colour is freed when its owner leaves. The host refuses rolls from anyone
without a colour and sets each roll's `color` to the roller's.

Each person's dice collide only with their own dice and the tray, so rolls
made at the same time never knock into each other.

**Natural 1 and 20.** When a d20 that counts (all of them, or the kept one with
advantage or disadvantage) lands on 1, a skull and crossbones pops up over it;
on 20, fireworks. Every device shows this for every roll. The broadcaster can
pick a sound for each when starting the session; the broadcaster's app plays it
(and so sends it to everyone like any sound).

**Coins and custom dice.** A `coin` lands on 1 (heads) or 2 (tails). A custom
die is the dN with its number of sides (4, 6, 8, 10, 12 or 20) and one word or
number per face (at most 24 characters): the face printed with number k shows
`faces[k − 1]` (on a d10, `faces[k]`). Faces that all read as numbers (`+` is 1,
`−` is −1, blank is 0, like Fate dice) add up; otherwise the result is the
words. The roll carries the custom dice it uses (at most 10).

**Hidden rolls.** The broadcaster can mark a roll `hidden` (listeners' are
refused that). Listeners see the dice tumble with blank faces; the host never
sends its `rollResult`, and it isn't in anyone's log but the broadcaster's.

## The table

The broadcaster runs roll requests, initiative and "who goes first" from its
own screen; the host sends the messages on and remembers the custom dice, the
open requests sent to everyone, and the turn order for listeners who join later.

```jsonc
{ "t": "ask", "id": "ask-lq2x9b-3k1",
  "kind": "check",                // "check" (a save or check), "initiative" or "contest"
  "label": "Dexterity save",
  "counts": {"d20": 1},           // what to roll
  "dc": 14,                       // optional: only when the broadcaster shows the DC
  "lowest": false,                // contest: the lowest roll wins
  "to": ["p3", "p5"] }            // optional: only these listeners (sent only to them)
```

A listener answers with an ordinary `roll` carrying `ask`; the broadcaster
counts each person's first roll only. When it closes a request it sends
`askClosed {id}` (to the request's listeners), and for a check with a shown DC
or a contest, `askResult`:

```jsonc
{ "t": "askResult", "id": "ask-…", "kind": "check", "label": "Dexterity save", "dc": 14,
  "results": [{"name": "Sam", "total": 18, "pass": true}] }
{ "t": "askResult", "id": "who-…", "kind": "contest", "label": "Who pays?", "lowest": true,
  "ranking": [{"name": "Ana", "total": 4}, {"name": "Sam", "total": 12}], "winners": ["Ana"] }
```

Initiative is an `ask` of kind `"initiative"` (d20 plus each listener's own
modifier); the broadcaster rolls for enemies itself. As results come in, and
again when the fight starts and on each turn, it sends:

```jsonc
{ "t": "turns", "phase": "running",   // "rolling" (still collecting), "running" or "off"
  "round": 2, "current": 1,           // whose turn: an index into order
  "order": [{"name": "Sam", "peer": "p3", "total": 20, "modifier": 3, "enemy": false},
            {"name": "Goblin 1", "peer": null, "total": 12, "modifier": 2, "enemy": true}] }
```

Each listener knows its own peer id (from `welcome`), so it knows when it's
its turn: that device buzzes and shows "Your turn!"; the others show whose turn
it is and who's next.

## Games

The broadcaster can start a **buzzer** or a **quiz**. Only the host's own app
starts, runs and ends a game; while one runs, every listener's app locks its
screen to it (nothing else can be reached) until the host sends
`game {phase: "off"}`. The host keeps the game and decides everything, and
sends the whole state to everyone after every change; a listener who joins
mid-game gets it after `welcome`.

```jsonc
// Buzzer: "waiting", then "armed" (round counts each arming)
{ "t": "game", "id": "game-…", "kind": "buzzer", "phase": "armed", "round": 2,
  "buzzes": [{"peer": "p3", "name": "Ana", "ms": 2310}, {"peer": "p5", "name": "Sam", "ms": 2520}] }
// Quiz: "lobby", "question", "reveal" or "final"
{ "t": "game", "id": "game-…", "kind": "quiz", "phase": "question", "round": 0, "n": 3, "answered": 2,
  "question": {"text": "…", "answers": ["…", "…"], "timer": 20, "left": 14200, "vote": false} }
// after the reveal, also:
  "correct": 0, "counts": [3, 1], "results": [{"peer": "p3", "choice": 0, "points": 930}],
  "leaderboard": [{"peer": "p3", "name": "Ana", "score": 1850, "right": 2}]
```

A listener's app sends `gameInput {id, buzz: true}` (once per round, only for
a press that started after the buzzer went live) or `gameInput {id, q, choice}`
(once per question), adding `at`: when it happened in the host's clock, from
its clock sync. The host keeps `at` between the start (arming, or the
question) and the moment the message arrived, so the buzz order is by when
people pressed rather than by network speed. Right answers score
`1000 × (1 − ½ × time / limit)`, or with no time limit `1000 − ms / 20` (at
least 500); a question with no right answer (`correct: null`) is a vote.
Before the reveal nobody but the host sees the right answer or who chose
what. A question ends when its time runs out or everyone has answered.

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
