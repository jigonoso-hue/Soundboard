/* global sounds, playing, isFull, play, release, stop, Ambience, Live */
// Music for scenes: playlists (a scene kit section whose songs play one after
// another, crossfading) and scene changes (opening a kit set to start its
// music and ambience fades out what was playing and fades its own in).
const Music = (() => {
  // Seconds one song takes to fade into the next (less for very short songs).
  const CROSSFADE = 4;
  // Seconds a scene change takes to fade out the old and fade in the new.
  const SCENE_FADE = 3;

  // section id -> { kitId, sectionId, order: [sound ids], index, id, audio, n, failures }
  const lists = new Map();
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) fn(); };

  const songsIn = (section) => section.items
    .filter((i) => i.type === 'sound')
    .map((i) => sounds.find((s) => s.id === i.id))
    .filter((s) => s && isFull(s))
    .map((s) => s.id);

  function shuffled(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // How long a song's crossfade into the next is.
  function fadeFor(id) {
    const length = sounds.find((s) => s.id === id)?.duration || 0;
    return length > 0 ? Math.min(CROSSFADE, length / 3) : CROSSFADE;
  }

  function startTrack(list, index, fadeIn) {
    list.index = index;
    const id = list.order[index];
    list.id = id;
    const fade = fadeFor(id);
    const audio = play(id, {
      fresh: true,
      fadeIn,
      group: `pl:${list.sectionId}:${list.n++}`,
      nearEnd: { seconds: fade, fn: () => { if (list.audio === audio) advance(list, fade); } },
      onEnded: () => { if (list.audio === audio) advance(list, 0); },
    });
    list.audio = audio;
    if (!audio) { list.failures += 1; advance(list, 0); return; }
    audio.addEventListener('playing', () => { list.failures = 0; }, { once: true });
    // Stopped from elsewhere (Stop All, or its row clicked outside the playlist): the playlist ends.
    audio.onRelease = () => { if (list.audio === audio) end(list.sectionId); };
    notify();
  }

  function advance(list, fade) {
    if (lists.get(list.sectionId) !== list) return;
    // Songs that won't play: give up once every one has failed in a row.
    if (fade === 0 && list.audio && list.audio.error) list.failures += 1;
    if (list.failures >= list.order.length) { end(list.sectionId); return; }
    const old = { id: list.id, audio: list.audio };
    let next = list.index + 1;
    if (next >= list.order.length) {
      next = 0;
      if (list.shuffle && list.order.length > 2) {
        // A new order each time round, not starting with the song that just played.
        const last = list.order[list.order.length - 1];
        list.order = shuffled(list.order);
        if (list.order[0] === last) list.order.push(list.order.shift());
      }
    }
    startTrack(list, next, fade);
    if (old.audio && playing.get(old.id)?.has(old.audio)) release(old.id, old.audio, fade);
  }

  function end(sectionId) {
    const list = lists.get(sectionId);
    if (!list) return;
    lists.delete(sectionId);
    notify();
  }

  // Starts a playlist section (from one of its songs, if given), fading in
  // over `fade` seconds and fading out what it was playing.
  function start(kit, section, fromId = null, fade = 0) {
    const songs = songsIn(section);
    if (!songs.length) return;
    const current = lists.get(section.id);
    if (current) stopList(section.id, Math.min(2, fade || 2));
    let order = section.playlistShuffle ? shuffled(songs) : songs;
    let index = 0;
    if (fromId && order.includes(fromId)) {
      if (section.playlistShuffle) order = [fromId, ...order.filter((id) => id !== fromId)];
      else index = order.indexOf(fromId);
    }
    const list = { kitId: kit.id, sectionId: section.id, order, index, id: null, audio: null, n: 1, failures: 0, shuffle: !!section.playlistShuffle };
    lists.set(section.id, list);
    startTrack(list, index, fade || (current ? 2 : 0));
  }

  function stopList(sectionId, fade = 0) {
    const list = lists.get(sectionId);
    if (!list) return;
    lists.delete(sectionId);
    if (list.audio && playing.get(list.id)?.has(list.audio)) release(list.id, list.audio, fade);
    notify();
  }

  // A scene change into `kit` (one set to start its music and ambience).
  // `voiceId(section, layer)` names a kit layer's ambience voice.
  function sceneOpened(kit, voiceId) {
    const ambience = kit.sections.filter((s) => s.kind === 'ambience');
    // The layers you had on when you last left it; the first time, all of them.
    const anyRemembered = ambience.some((s) => s.layers.some((l) => l.on));
    const keep = new Set();
    const toStart = [];
    for (const section of ambience) {
      for (const layer of section.layers) {
        if (anyRemembered && !layer.on) continue;
        const id = voiceId(section, layer);
        keep.add(id);
        toStart.push({ id, layer });
      }
    }
    // Its first playlist, from the top of the board.
    const playlist = kit.sections
      .filter((s) => s.kind !== 'ambience' && s.playlist && songsIn(s).length)
      .sort((a, b) => a.y - b.y || a.x - b.x)[0];

    // Listeners fade their ambience over the same time.
    if (typeof Live !== 'undefined') Live.sceneChanged(SCENE_FADE);
    // Fade out what's playing: other playlists, songs, and ambience not in this scene.
    for (const sectionId of [...lists.keys()]) {
      if (playlist && sectionId === playlist.id) continue;
      stopList(sectionId, SCENE_FADE);
    }
    const ours = playlist ? lists.get(playlist.id) : null;
    for (const [id, set] of [...playing]) {
      const sound = sounds.find((s) => s.id === id);
      if (!sound || !isFull(sound)) continue;
      for (const audio of [...set]) if (!ours || audio !== ours.audio) release(id, audio, SCENE_FADE);
    }
    Ambience.fadeOutAll(keep, SCENE_FADE);

    // Fade in this scene's.
    for (const { id, layer } of toStart) {
      Ambience.start(id, { kind: layer.kind, ref: layer.ref, volume: layer.volume, every: layer.every }, { fade: SCENE_FADE });
    }
    if (playlist && !ours) start(kit, playlist, null, SCENE_FADE);
    if (typeof Live !== 'undefined') Live.sceneChanged(SCENE_FADE);
  }

  return {
    CROSSFADE,
    SCENE_FADE,
    start,
    stop: stopList,
    sceneOpened,
    songsIn,
    isPlaying: (sectionId) => lists.has(sectionId),
    current: (sectionId) => lists.get(sectionId)?.id || null,
    onChange(fn) { listeners.add(fn); },
  };
})();
