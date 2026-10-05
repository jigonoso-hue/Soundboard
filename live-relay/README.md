# Dungeon Radio relay server

Online Live Sessions need a small relay server. It routes messages between the
GM's app and the players' apps; no audio passes through it, only the sound
files each player fetches once and short "play this now" commands.

The apps use Dungeon Radio's own relay (`soundboard-r1zt.onrender.com`, hosted
on Render from this folder) unless someone sets a different one under
**Live → Advanced**. Everyone in a session must use the same relay.

## Run it on your own computer (testing)

```bash
cd live-relay
npm install
npm start          # listens on port 8787
```

In the app, set the relay server to `ws://<your computer's IP>:8787`. This only
works on your own network. The iPhone/iPad app needs a secure (`wss://`) address
for anything else, so use one of the hosted options below to play online.

## Host it online

Any service that runs a Node.js or Docker app and gives it an HTTPS address
works, because HTTPS hosts also accept secure WebSockets (`wss://`). The
server listens on the `PORT` environment variable.

- **Fly.io:** `fly launch` from this folder (it picks up the Dockerfile), then
  `fly deploy`. Your relay is `your-app.fly.dev`.
- **Render:** create a Web Service from this folder, with build command
  `npm install` and start command `npm start`.
- **Railway** or any VPS: run `npm start`, or the Docker image, behind HTTPS.

Then enter the address (for example `your-app.fly.dev`) as the relay server in
the app. The app adds `wss://` and `/live` itself.

Free tiers that put the app to sleep when idle are fine; the first person to
connect wakes it up.

## What it does

- A GM's app connects and gets a 5-character room code.
- Players connect with that code. Up to 32 per room.
- Messages from players go to the GM; the GM's go to every player or to one
  (whispers).
- If the GM's connection drops, the room stays open for a minute so the app can
  reconnect.
- Messages are limited to 1 MB. Nothing is stored.

`GET /health` returns `ok` and the number of open rooms.

See [PROTOCOL.md](PROTOCOL.md) for the messages.

## Test

```bash
npm test
```
