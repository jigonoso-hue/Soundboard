import Foundation

/// Music for scenes: playlists (a scene kit section whose songs play one after
/// another, crossfading) and scene changes (opening a kit set to start its
/// music and ambience fades out what was playing and fades its own in).
/// A copy of the Mac app's music.js; keep the two the same.
@MainActor
final class MusicDirector: ObservableObject {
    /// Seconds one song takes to fade into the next (less for very short songs).
    static let crossfade: Double = 4
    /// Seconds a scene change takes to fade out the old and fade in the new.
    static let sceneFade: Double = 3

    private final class Playlist {
        let kitId: UUID
        let sectionId: UUID
        var order: [UUID]
        var index = 0
        var current: UUID?
        var token: UUID?
        var n = 1
        var failures = 0
        let shuffle: Bool

        init(kitId: UUID, sectionId: UUID, order: [UUID], shuffle: Bool) {
            self.kitId = kitId
            self.sectionId = sectionId
            self.order = order
            self.shuffle = shuffle
        }
    }

    /// The song each playing playlist is on, by section.
    @Published private(set) var current: [UUID: UUID] = [:]

    private var lists: [UUID: Playlist] = [:]
    private weak var store: SoundStore?
    private weak var player: SoundPlayer?
    private weak var ambience: AmbienceMixer?
    private weak var live: LiveSession?

    func attach(store: SoundStore, player: SoundPlayer, ambience: AmbienceMixer, live: LiveSession) {
        self.store = store
        self.player = player
        self.ambience = ambience
        self.live = live
    }

    func isPlaying(_ sectionId: UUID) -> Bool { lists[sectionId] != nil }

    /// The full sounds in a section, in its order.
    func songs(in section: KitSection) -> [UUID] {
        guard let store else { return [] }
        return section.items.compactMap { item in
            guard item.type == .sound, let sound = store.sound(item.id), sound.isFull else { return nil }
            return sound.id
        }
    }

    /// How long a song's crossfade into the next is.
    private func crossfadeLength(for id: UUID) -> Double {
        let length = store?.sound(id)?.duration ?? 0
        return length > 0 ? min(Self.crossfade, length / 3) : Self.crossfade
    }

    private func publish() {
        var next: [UUID: UUID] = [:]
        for (id, list) in lists { if let song = list.current { next[id] = song } }
        current = next
    }

    private func startTrack(_ list: Playlist, at index: Int, fadeIn: Double) {
        list.index = index
        let id = list.order[index]
        list.current = id
        guard let store, let player, let sound = store.sound(id) else {
            list.failures += 1
            advance(list, fade: 0)
            return
        }
        let fade = crossfadeLength(for: id)
        var options = SoundPlayer.PlayOptions()
        options.fresh = true
        options.fadeIn = fadeIn
        options.group = "pl:\(list.sectionId.uuidString):\(list.n)"
        list.n += 1
        var token: UUID?
        let nearAction: () -> Void = { [weak self, weak list] in
            guard let self, let list, list.token == token else { return }
            self.advance(list, fade: fade)
        }
        options.nearEnd = (seconds: fade, action: nearAction)
        options.onEnded = { [weak self, weak list] in
            guard let self, let list, list.token == token else { return }
            list.failures = 0
            self.advance(list, fade: 0)
        }
        // Stopped from elsewhere (Stop All, or its row tapped outside the playlist): the playlist ends.
        options.onRelease = { [weak self, weak list] in
            guard let self, let list, list.token == token else { return }
            self.end(list.sectionId)
        }
        token = try? player.play(sound, url: store.url(for: sound), options: options)
        list.token = token
        if token == nil {
            list.failures += 1
            advance(list, fade: 0)
            return
        }
        list.failures = 0
        publish()
    }

    private func advance(_ list: Playlist, fade: Double) {
        guard lists[list.sectionId] === list else { return }
        // Songs that won't play: give up once every one has failed in a row.
        if list.failures >= list.order.count {
            end(list.sectionId)
            return
        }
        let old = (id: list.current, token: list.token)
        var next = list.index + 1
        if next >= list.order.count {
            next = 0
            if list.shuffle && list.order.count > 2 {
                // A new order each time round, not starting with the song that just played.
                let last = list.order.last
                list.order.shuffle()
                if list.order.first == last { list.order.append(list.order.removeFirst()) }
            }
        }
        list.token = nil
        startTrack(list, at: next, fadeIn: fade)
        if let id = old.id, let token = old.token, player?.isPlaying(id, token: token) == true {
            player?.release(id, token: token, fade: fade)
        }
    }

    private func end(_ sectionId: UUID) {
        guard lists.removeValue(forKey: sectionId) != nil else { return }
        publish()
    }

    /// Starts a playlist section (from one of its songs, if given), fading in
    /// over `fade` seconds and fading out what it was playing.
    func start(kit: SoundKit, section: KitSection, from songId: UUID? = nil, fade: Double = 0) {
        let available = songs(in: section)
        guard !available.isEmpty else { return }
        let wasPlaying = lists[section.id] != nil
        if wasPlaying { stop(section.id, fade: min(2, fade > 0 ? fade : 2)) }
        let shuffle = section.playlistShuffle == true
        var order = shuffle ? available.shuffled() : available
        var index = 0
        if let songId, order.contains(songId) {
            if shuffle { order = [songId] + order.filter { $0 != songId } } else { index = order.firstIndex(of: songId) ?? 0 }
        }
        let list = Playlist(kitId: kit.id, sectionId: section.id, order: order, shuffle: shuffle)
        lists[section.id] = list
        startTrack(list, at: index, fadeIn: fade > 0 ? fade : (wasPlaying ? 2 : 0))
    }

    func stop(_ sectionId: UUID, fade: Double = 0) {
        guard let list = lists.removeValue(forKey: sectionId) else { return }
        if let id = list.current, let token = list.token, player?.isPlaying(id, token: token) == true {
            player?.release(id, token: token, fade: fade)
        }
        publish()
    }

    /// A scene change into `kit` (one set to start its music and ambience).
    func sceneOpened(_ kit: SoundKit) {
        guard let ambience, let player, let store else { return }
        let ambienceSections = kit.sections.filter(\.isAmbience)
        // The layers you had on when you last left it; the first time, all of them.
        let anyRemembered = ambienceSections.contains { $0.layers.contains { $0.on == true } }
        var keep = Set<String>()
        var toStart: [(id: String, layer: KitLayer)] = []
        for section in ambienceSections {
            for layer in section.layers where !anyRemembered || layer.on == true {
                let id = section.voiceId(layer)
                keep.insert(id)
                toStart.append((id, layer))
            }
        }
        // Its first playlist, from the top of the board.
        let playlist = kit.sections
            .filter { $0.isPlaylist && !songs(in: $0).isEmpty }
            .sorted { ($0.y, $0.x) < ($1.y, $1.x) }
            .first

        // Listeners fade their ambience over the same time.
        live?.sceneChanged(fade: Self.sceneFade)
        // Fade out what's playing: other playlists, songs, and ambience not in this scene.
        for sectionId in Array(lists.keys) where sectionId != playlist?.id {
            stop(sectionId, fade: Self.sceneFade)
        }
        let ours = playlist.flatMap { lists[$0.id] }
        for id in player.playingIds {
            guard let sound = store.sound(id), sound.isFull else { continue }
            if let ours, ours.current == id { continue }
            player.stop(id, fade: Self.sceneFade)
        }
        ambience.fadeOutAll(keep: keep, fade: Self.sceneFade)

        // Fade in this scene's.
        for (id, layer) in toStart {
            ambience.startVoice(id, kind: layer.kind, ref: layer.ref, volume: layer.volume, every: layer.every, fade: Self.sceneFade)
        }
        if let playlist, ours == nil { start(kit: kit, section: playlist, fade: Self.sceneFade) }
        live?.sceneChanged(fade: Self.sceneFade)
    }
}
