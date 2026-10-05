import AudioToolbox
import Foundation
import UIKit
import UserNotifications

/// Live Session: play to other players' devices (host), or play what a host
/// sends (listener). Holds the state the Live screens show, forwards what the
/// board plays while hosting, plays players' sounds for everyone, and runs the
/// MirrorPlayer while tuned in.
@MainActor
final class LiveSession: ObservableObject {
    enum Role: Equatable { case idle, host, listener }
    enum Mode: String { case local, online }

    @Published private(set) var role: Role = .idle
    @Published private(set) var busy = false
    @Published var error: String?

    // Hosting
    @Published private(set) var hostingMode: Mode = .local
    @Published private(set) var hostingName = ""
    @Published private(set) var code: String?
    @Published private(set) var peers: [LiveHostEngine.Peer] = []
    @Published private(set) var reconnecting = false
    /// Listeners the next sound goes to (a whisper). Empty: everyone.
    @Published var whisperTargets: Set<String> = []
    /// The next sound makes listeners' phones vibrate.
    @Published var emphasis = false
    /// Which sounds players may play for everyone; can change during a session.
    @Published var playerSounds: PlayerSounds {
        didSet {
            UserDefaults.standard.set(playerSounds.rawValue, forKey: "live.playerSounds")
            host?.setPlayerSounds(playerSounds)
        }
    }

    // Listening
    @Published private(set) var connected = false
    @Published private(set) var hostName: String?
    @Published private(set) var scene: String?
    @Published private(set) var nowPlaying: [NowPlayingItem] = []
    @Published private(set) var found: [FoundSession] = []
    /// Shows the full-screen listening stage.
    @Published var showStage = false
    /// What the GM lets players do, and the GM's sounds to choose from.
    @Published private(set) var allowedPlayerSounds: PlayerSounds = .off
    @Published private(set) var catalog: [CatalogItem] = []
    /// Bumped when a whisper or a buzz arrives, for the stage's effects.
    @Published private(set) var whisperPulse = 0
    @Published private(set) var buzzPulse = 0
    /// A short message to show, such as a whisper sent.
    @Published var notice: String?

    // Settings, kept between launches
    @Published var sessionName: String { didSet { save("live.sessionName", sessionName) } }
    @Published var yourName: String { didSet { save("live.yourName", yourName) } }
    @Published var mode: Mode { didSet { save("live.mode", mode.rawValue) } }
    /// Online sessions go through Dungeon Radio's own relay server.
    private var relayAddress: String { LiveNet.defaultRelay }
    @Published var codeInput: String { didSet { save("live.code", codeInput) } }
    /// Listener levels: "master", "music", "sfx", "ambience".
    @Published var levels: [String: Double] {
        didSet {
            UserDefaults.standard.set(levels, forKey: "live.levels")
            mirror.applyLevels()
        }
    }
    /// A player's chosen sounds: the GM's (catalog ids) and their own (library ids).
    @Published var picksFromGM: [String] {
        didSet { UserDefaults.standard.set(picksFromGM, forKey: "live.picksGM") }
    }
    @Published var picksOwn: [String] {
        didSet {
            UserDefaults.standard.set(picksOwn, forKey: "live.picksOwn")
            offerOwnSounds()
        }
    }

    private weak var store: SoundStore?
    private weak var ambience: AmbienceMixer?
    private weak var kits: KitStore?
    private weak var bashes: BashStore?
    private weak var player: SoundPlayer?
    private var host: LiveHostEngine?
    /// The relay connection while it waits for a room code.
    private var connectingRelay: RelayHost?
    private var listener: LiveListenerEngine?
    /// Plays what the host sends (listener), or players' sounds on the GM's device (host).
    private let mirror: MirrorPlayer
    private let hostMirror: MirrorPlayer
    private let browser: LanBrowser
    private let hasher: FileHasher
    private let haptics: UIImpactFeedbackGenerator
    private var syncTimer: Timer?
    private var nextPid = 1
    /// The bash run a whisper or emphasis applies to, and runs already seen.
    private var armedRun: (id: String, targets: Set<String>, emphasis: Bool)?
    private var seenRuns: Set<String> = []
    /// The scene kit open on the board, if any.
    var currentKitId: UUID? {
        didSet { if currentKitId != oldValue { syncHostState() } }
    }

    init() {
        mirror = MirrorPlayer()
        hostMirror = MirrorPlayer()
        browser = LanBrowser()
        hasher = FileHasher()
        haptics = UIImpactFeedbackGenerator(style: .heavy)
        let defaults = UserDefaults.standard
        sessionName = defaults.string(forKey: "live.sessionName") ?? ""
        yourName = defaults.string(forKey: "live.yourName") ?? ""
        mode = Mode(rawValue: defaults.string(forKey: "live.mode") ?? "") ?? .local
        // Custom relay addresses from older versions are no longer used.
        defaults.removeObject(forKey: "live.relay")
        codeInput = defaults.string(forKey: "live.code") ?? ""
        playerSounds = PlayerSounds(rawValue: defaults.string(forKey: "live.playerSounds") ?? "") ?? .off
        let saved = (defaults.dictionary(forKey: "live.levels") as? [String: Double]) ?? [:]
        levels = ["master": 1, "music": 1, "sfx": 1, "ambience": 1].merging(saved) { _, new in new }
        picksFromGM = defaults.stringArray(forKey: "live.picksGM") ?? []
        picksOwn = defaults.stringArray(forKey: "live.picksOwn") ?? []

        mirror.level = { [weak self] category in
            guard let self else { return 1 }
            return (self.levels["master"] ?? 1) * (self.levels[category] ?? 1)
        }
        mirror.onChange = { [weak self] in
            guard let self else { return }
            self.nowPlaying = self.mirror.nowPlaying
        }
        mirror.onWhisper = { [weak self] _ in self?.whisperPulse += 1 }
        mirror.onBuzz = { [weak self] play in self?.buzz(play) }
        hostMirror.level = { [weak self] _ in self?.player?.masterVolume ?? 1 }
        browser.onChange = { [weak self] list in self?.found = list }
        LiveFiles.pruneCache()
    }

    func attach(store: SoundStore, ambience: AmbienceMixer, kits: KitStore, bashes: BashStore, player: SoundPlayer) {
        self.store = store
        self.ambience = ambience
        self.kits = kits
        self.bashes = bashes
        self.player = player
    }

    private func save(_ key: String, _ value: String) {
        UserDefaults.standard.set(value, forKey: key)
    }

    private var deviceName: String {
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
    }

    // MARK: Hosting

    func startHosting() {
        guard role == .idle, !busy else { return }
        error = nil
        let name = sessionName.trimmingCharacters(in: .whitespaces).isEmpty
            ? "\(UIDevice.current.name)'s game" : String(sessionName.trimmingCharacters(in: .whitespaces).prefix(40))
        switch mode {
        case .local:
            let server = LanServer()
            do {
                try server.start(name: name)
            } catch {
                self.error = "Couldn't start a local session (\(error.localizedDescription))."
                return
            }
            server.onFailed = { [weak self] message in
                self?.endHosting(error: "The local session stopped (\(message)).")
            }
            beginHosting(name: name, transport: server, mode: .local)
        case .online:
            guard let base = LiveNet.relayURL(relayAddress) else {
                error = "That relay server address isn't valid."
                return
            }
            busy = true
            let relayHost = RelayHost(base: base)
            connectingRelay = relayHost
            relayHost.onCode = { [weak self, weak relayHost] code in
                guard let self, let relayHost else { return }
                self.code = code
                self.reconnecting = false
                if self.busy {
                    self.busy = false
                    self.connectingRelay = nil
                    self.beginHosting(name: name, transport: relayHost, mode: .online)
                }
            }
            relayHost.onReconnecting = { [weak self] in self?.reconnecting = true }
            relayHost.onFailed = { [weak self] message in
                guard let self else { return }
                if self.busy {
                    self.busy = false
                    self.connectingRelay = nil
                    self.error = message
                } else {
                    self.endHosting(error: message)
                }
            }
            relayHost.start()
        }
    }

    private func beginHosting(name: String, transport: LiveHostTransport, mode: Mode) {
        let engine = LiveHostEngine(name: name, transport: transport)
        engine.resolveSound = { [weak self] id in
            guard let store = self?.store, let sound = store.sound(id) else { return nil }
            return store.url(for: sound)
        }
        engine.catalog = { [weak self] in self?.catalogItems() ?? [] }
        engine.onPeers = { [weak self] list in
            guard let self else { return }
            self.peers = list
            let ids = Set(list.map(\.id))
            self.whisperTargets = self.whisperTargets.intersection(ids)
        }
        engine.onCue = { [weak self] peer, name, cue in self?.playPlayerSound(from: peer, name: name, cue: cue) }
        host = engine
        engine.setPlayerSounds(playerSounds)
        hostingName = name
        hostingMode = mode
        if mode == .local { code = nil }
        peers = []
        role = .host
        // Keep broadcasting with the screen locked or in another app.
        BackgroundAudio.shared.keepAlive(true)
        lastAmbience = nil
        lastScene = nil
        lastPrefetch = nil
        lastCatalog = nil
        syncHostState()
        syncTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.syncHostState() }
        }
    }

    func endHosting(error message: String? = nil) {
        host?.end()
        host = nil
        syncTimer?.invalidate()
        syncTimer = nil
        whisperTargets = []
        emphasis = false
        armedRun = nil
        hostMirror.stopAll(ambienceToo: true)
        peers = []
        code = nil
        reconnecting = false
        role = .idle
        BackgroundAudio.shared.keepAlive(false)
        error = message
    }

    private func pid() -> String {
        nextPid += 1
        return "\(Int(Date().timeIntervalSince1970 * 1000))-\(nextPid)"
    }

    /// Whisper targets' names, for the banner.
    var whisperNames: [String] {
        peers.filter { whisperTargets.contains($0.id) }.map(\.name)
    }

    /// Removes a player from the session.
    func kick(_ peer: String) {
        guard role == .host, let host else { return }
        whisperTargets.remove(peer)
        host.kick(peer)
    }

    /// Clears an armed whisper and emphasis.
    func disarm() {
        whisperTargets = []
        emphasis = false
    }

    /// A sound started on the board (tile, row or scene kit).
    func soundPlayed(_ sound: Sound, volume: Double) {
        guard role == .host, let host else { return }
        if sound.gmOnly == true {
            if !whisperTargets.isEmpty { notice = "GM-only sounds can't be whispered." }
            return
        }
        var event = LiveHostEngine.PlayEvent(
            pid: pid(), group: "s:\(sound.id.uuidString)", source: .library(sound.id), name: sound.name,
            at: LiveNet.now, volume: volume, cat: sound.isFull ? "music" : "sfx")
        event.loop = sound.repeatGap == 0
        event.gap = sound.repeatGap ?? 0
        event.buzz = sound.buzz == true || emphasis
        event.duration = sound.duration ?? 0
        if !whisperTargets.isEmpty {
            event.to = Array(whisperTargets)
            notice = "Whispered “\(sound.name)” to \(whisperNames.joined(separator: ", "))."
        } else if emphasis {
            notice = "“\(sound.name)” played with emphasis."
        }
        disarm()
        host.play(event)
    }

    func soundStopped(_ id: UUID) {
        host?.stop(group: "s:\(id.uuidString)")
    }

    func soundVolume(_ id: UUID, volume: Double) {
        host?.volume(group: "s:\(id.uuidString)", volume: volume)
    }

    func stoppedAll() {
        host?.stopAll()
        hostMirror.stopAll(ambienceToo: false)
        if role == .listener { mirror.stopAll(ambienceToo: false) }
    }

    /// One clip of a bash. `at` is the wall-clock time (ms) of the clip's start.
    /// An armed whisper or emphasis applies to every clip of the next bash.
    func bashClip(runId: String, soundId: UUID, at: Double, volume: Double, duration: Double) {
        guard role == .host, let host, let sound = store?.sound(soundId), sound.gmOnly != true else { return }
        if !seenRuns.contains(runId) {
            if seenRuns.count > 200 { seenRuns.removeAll() }
            seenRuns.insert(runId)
            if !whisperTargets.isEmpty || emphasis {
                armedRun = (runId, whisperTargets, emphasis)
                disarm()
            }
        }
        var event = LiveHostEngine.PlayEvent(
            pid: pid(), group: "b:\(runId)", source: .library(soundId), name: sound.name,
            at: at, volume: volume, cat: "sfx")
        event.buzz = sound.buzz == true
        event.duration = duration
        if let run = armedRun, run.id == runId {
            if !run.targets.isEmpty { event.to = Array(run.targets) }
            if run.emphasis { event.buzz = true }
        }
        host.play(event)
    }

    func bashStopped(runId: String) {
        host?.stop(group: "b:\(runId)")
    }

    // MARK: Players' sounds (host)

    /// The GM's sounds players may choose from: everything except GM-only sounds.
    private func catalogItems() -> [CatalogItem] {
        (store?.sounds ?? [])
            .filter { $0.gmOnly != true }
            .map { CatalogItem(id: $0.id.uuidString, name: $0.name, colorIndex: $0.colorIndex) }
    }

    /// A player played a sound: it plays for everyone, the GM included, in a
    /// quarter of a second so every device starts together.
    private func playPlayerSound(from peer: String, name playerName: String, cue: LiveHostEngine.Cue) {
        guard role == .host, let host else { return }
        let at = LiveNet.now + 250
        let source: LiveHostEngine.Source
        let soundName: String
        let url: URL
        var volume = 1.0
        var buzz = false
        switch cue {
        case .library(let id):
            guard let store, let sound = store.sound(id), sound.gmOnly != true else { return }
            source = .library(id)
            soundName = sound.name
            url = store.url(for: sound)
            volume = sound.volume
            buzz = sound.buzz == true
        case .file(let hash, let ext, let name, let fileURL):
            source = .file(hash: hash, ext: ext, url: fileURL)
            soundName = name
            url = fileURL
        }
        let playId = self.pid()
        let group = "p:\(peer):\(playId)"
        var event = LiveHostEngine.PlayEvent(pid: playId, group: group, source: source, name: soundName,
                                             at: at, volume: volume, cat: "sfx")
        event.buzz = buzz
        event.by = playerName
        host.play(event)
        hostMirror.play(MirrorPlay(pid: playId, group: group, url: url, name: soundName,
                                   at: Date(timeIntervalSince1970: at / 1000), volume: volume, category: "sfx",
                                   loop: false, gap: 0, buzz: false, whisper: false, by: playerName))
        notice = "\(playerName) played “\(soundName)”."
    }

    private var lastAmbience: [AmbienceLayer]?
    private var lastScene: String??
    private var lastPrefetch: [UUID]?
    private var lastCatalog: [CatalogItem]?

    /// Ambience, the open kit, what listeners should fetch ahead and the GM's
    /// sound list for players, sent when they change.
    private func syncHostState() {
        guard role == .host, let host, let store, let ambience else { return }
        let gmOnly = Set(store.sounds.filter { $0.gmOnly == true }.map(\.id.uuidString))
        let layers = ambience.liveSnapshot().filter { $0.kind == .builtin || !gmOnly.contains($0.ref) }
        if layers != lastAmbience {
            lastAmbience = layers
            var names: [String: String] = [:]
            for layer in layers { names[layer.id] = ambience.name(of: layer) }
            host.setAmbience(layers, names: names)
        }
        let kit = currentKitId.flatMap { kits?.kit($0) }
        let sceneName: String? = kit?.name
        if lastScene == nil || lastScene! != sceneName {
            lastScene = .some(sceneName)
            host.setScene(sceneName)
        }
        let prefetch = prefetchIds(kit: kit, gmOnly: gmOnly)
        if prefetch != lastPrefetch {
            lastPrefetch = prefetch
            host.setPrefetch(prefetch)
        }
        let catalog = catalogItems()
        if catalog != lastCatalog {
            lastCatalog = catalog
            host.refreshCatalog()
        }
    }

    /// The open kit's sounds (including inside its bashes and ambience), or the
    /// library's clips when no kit is open. Full sounds outside kits load on demand.
    private func prefetchIds(kit: SoundKit?, gmOnly: Set<String>) -> [UUID] {
        guard let store else { return [] }
        var ids: [UUID] = []
        if let kit {
            for section in kit.sections {
                for item in section.items {
                    switch item.type {
                    case .sound: ids.append(item.id)
                    case .bash: ids.append(contentsOf: bashes?.bash(item.id)?.clips.map(\.soundId) ?? [])
                    }
                }
                for layer in section.layers where layer.kind == .sound {
                    if let id = UUID(uuidString: layer.ref) { ids.append(id) }
                }
            }
        } else {
            ids = store.sounds.filter { !$0.isFull }.prefix(80).map(\.id)
        }
        var seen = Set<UUID>()
        return ids.filter { id in
            guard !gmOnly.contains(id.uuidString), store.sound(id) != nil, !seen.contains(id) else { return false }
            seen.insert(id)
            return true
        }
    }

    // MARK: Listening

    func browse(_ on: Bool) {
        if on { browser.start() } else { browser.stop() }
    }

    func tuneIn(to session: FoundSession) {
        guard role == .idle, !busy else { return }
        error = nil
        busy = true
        LanBrowser.resolve(session.endpoint) { [weak self] url in
            guard let self else { return }
            self.busy = false
            guard let url else {
                self.error = "Couldn't reach “\(session.name)”. Make sure you're on the same Wi-Fi."
                return
            }
            self.listen(socket: NWSocket(url: url))
        }
    }

    func tuneInOnline() {
        guard role == .idle, !busy else { return }
        error = nil
        guard let base = LiveNet.relayURL(relayAddress) else {
            error = "That relay server address isn't valid."
            return
        }
        let clean = codeInput.uppercased().filter { $0.isLetter || $0.isNumber }
        guard !clean.isEmpty else {
            error = "Enter the session code from your GM."
            return
        }
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "role", value: "listen"), URLQueryItem(name: "code", value: clean)]
        guard let url = components?.url else {
            error = "That relay server address isn't valid."
            return
        }
        listen(socket: URLSocket(url: url))
    }

    private func listen(socket: LiveSocket) {
        let name = yourName.trimmingCharacters(in: .whitespaces).isEmpty ? UIDevice.current.name : yourName
        let engine = LiveListenerEngine(socket: socket, name: String(name.prefix(40)), device: deviceName)
        engine.builtinURL = { [weak self] file in self?.ambience?.builtins.first { $0.file == file }?.url }
        engine.onCommand = { [weak self] command in
            guard let self else { return }
            switch command {
            case .play(let play): self.mirror.play(play)
            case .stop(let group): self.mirror.stop(group: group)
            case .volume(let group, let volume): self.mirror.setVolume(volume, group: group)
            case .stopAll(let ambienceToo): self.mirror.stopAll(ambienceToo: ambienceToo)
            case .ambience(let layers): self.mirror.setAmbience(layers)
            }
        }
        engine.onScene = { [weak self] name in self?.scene = name }
        engine.onRules = { [weak self] rules in
            guard let self else { return }
            self.allowedPlayerSounds = rules
            if rules == .own { self.offerOwnSounds() }
        }
        engine.onCatalog = { [weak self] items in
            guard let self else { return }
            self.catalog = items
            // Drop picks the GM no longer offers.
            let ids = Set(items.map(\.id))
            let kept = self.picksFromGM.filter { ids.contains($0) }
            if kept != self.picksFromGM { self.picksFromGM = kept }
        }
        engine.onState = { [weak self, weak engine] state in
            guard let self, let engine, self.listener === engine else { return }
            switch state {
            case .connecting:
                self.connected = false
            case .connected:
                self.connected = true
                self.hostName = engine.hostName
            case .ended(let message), .failed(let message):
                self.finishListening()
                self.error = message
                self.notice = message
            }
        }
        listener = engine
        role = .listener
        connected = false
        hostName = nil
        scene = nil
        allowedPlayerSounds = .off
        catalog = []
        browser.stop()
        // Stay connected and playing with the screen locked or in another app.
        BackgroundAudio.shared.keepAlive(true)
        // Buzz sounds arrive as notifications while the app is in the background.
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        engine.start()
    }

    func leave() {
        switch role {
        case .host: endHosting()
        case .listener:
            listener?.leave()
            finishListening()
        case .idle: break
        }
    }

    private func finishListening() {
        listener = nil
        mirror.stopAll(ambienceToo: true)
        role = .idle
        connected = false
        showStage = false
        nowPlaying = []
        allowedPlayerSounds = .off
        BackgroundAudio.shared.keepAlive(false)
    }

    // MARK: Players' sounds (listener)

    /// The player's chosen sounds for the current rules.
    var pickedSounds: [CatalogItem] {
        switch allowedPlayerSounds {
        case .gm:
            return picksFromGM.compactMap { id in catalog.first(where: { $0.id == id }) }
        case .own:
            return picksOwn.compactMap { id in
                guard let uuid = UUID(uuidString: id), let sound = store?.sound(uuid) else { return nil }
                return CatalogItem(id: id, name: sound.name, colorIndex: sound.colorIndex)
            }
        case .off:
            return []
        }
    }

    /// The player's own library, for choosing their sounds.
    var ownLibrary: [Sound] { store?.sounds ?? [] }

    func togglePick(_ id: String) {
        switch allowedPlayerSounds {
        case .gm:
            if let index = picksFromGM.firstIndex(of: id) { picksFromGM.remove(at: index) }
            else if picksFromGM.count < PlayerSounds.limit { picksFromGM.append(id) }
        case .own:
            if let index = picksOwn.firstIndex(of: id) { picksOwn.remove(at: index) }
            else if picksOwn.count < PlayerSounds.limit { picksOwn.append(id) }
        case .off:
            break
        }
    }

    func isPicked(_ id: String) -> Bool {
        allowedPlayerSounds == .gm ? picksFromGM.contains(id) : picksOwn.contains(id)
    }

    /// Plays one of the player's chosen sounds for everyone.
    func playPick(_ id: String) {
        guard role == .listener, let listener else { return }
        switch allowedPlayerSounds {
        case .gm:
            listener.cue(soundId: id)
        case .own:
            guard let uuid = UUID(uuidString: id), let store, let sound = store.sound(uuid) else { return }
            let url = store.url(for: sound)
            Task { @MainActor [weak self] in
                guard let self, let hash = await self.hasher.hash(url) else { return }
                self.listener?.cue(hash: hash)
            }
        case .off:
            break
        }
    }

    /// Sends the host the player's own chosen sounds, so it can fetch them ahead of time.
    private func offerOwnSounds() {
        guard role == .listener, allowedPlayerSounds == .own, let store else { return }
        let sounds = picksOwn.compactMap { id -> (URL, String)? in
            guard let uuid = UUID(uuidString: id), let sound = store.sound(uuid) else { return nil }
            return (store.url(for: sound), sound.name)
        }
        Task { @MainActor [weak self] in
            guard let self else { return }
            var offers: [(url: URL, hash: String, name: String)] = []
            for (url, name) in sounds {
                if let hash = await self.hasher.hash(url) { offers.append((url: url, hash: hash, name: name)) }
            }
            self.listener?.offer(offers)
        }
    }

    // MARK: Buzz

    /// A buzz sound: vibrate now if the app is open, or post a notification
    /// (which vibrates the phone) if it's in the background or locked.
    private func buzz(_ play: MirrorPlay) {
        buzzPulse += 1
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        if UIApplication.shared.applicationState == .active {
            haptics.impactOccurred(intensity: 1)
            return
        }
        let content = UNMutableNotificationContent()
        content.title = "💥 \(hostName ?? "Your GM")"
        content.body = play.whisper ? "Something only you can feel…" : (play.name.isEmpty ? "Brace yourself!" : play.name)
        content.sound = .default
        let request = UNNotificationRequest(identifier: "buzz-\(play.pid)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
