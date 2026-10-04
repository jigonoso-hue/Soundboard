import Foundation
import UIKit

/// Live Session: play to other players' devices (host), or play what a host
/// sends (listener). Holds the state the Live sheet shows, forwards what the
/// board plays while hosting, and runs the MirrorPlayer while tuned in.
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
    /// While set, the next sound played goes only to this listener.
    @Published var whisperTo: LiveHostEngine.Peer?

    // Listening
    @Published private(set) var connected = false
    @Published private(set) var hostName: String?
    @Published private(set) var scene: String?
    @Published private(set) var nowPlaying: [String] = []
    @Published private(set) var found: [FoundSession] = []
    /// A short message to show, such as an incoming whisper.
    @Published var notice: String?

    // Settings, kept between launches
    @Published var sessionName: String { didSet { save("live.sessionName", sessionName) } }
    @Published var yourName: String { didSet { save("live.yourName", yourName) } }
    @Published var mode: Mode { didSet { save("live.mode", mode.rawValue) } }
    @Published var relay: String { didSet { save("live.relay", relay) } }
    @Published var codeInput: String { didSet { save("live.code", codeInput) } }
    /// Listener levels: "master", "music", "sfx", "ambience".
    @Published var levels: [String: Double] {
        didSet {
            UserDefaults.standard.set(levels, forKey: "live.levels")
            mirror.applyLevels()
        }
    }

    private weak var store: SoundStore?
    private weak var ambience: AmbienceMixer?
    private weak var kits: KitStore?
    private weak var bashes: BashStore?
    private var host: LiveHostEngine?
    /// The relay connection while it waits for a room code.
    private var connectingRelay: RelayHost?
    private var listener: LiveListenerEngine?
    private let mirror: MirrorPlayer
    private let browser: LanBrowser
    private var syncTimer: Timer?
    private var nextPid = 1
    /// The scene kit open on the board, if any.
    var currentKitId: UUID? {
        didSet { if currentKitId != oldValue { syncHostState() } }
    }

    init() {
        mirror = MirrorPlayer()
        browser = LanBrowser()
        let defaults = UserDefaults.standard
        sessionName = defaults.string(forKey: "live.sessionName") ?? ""
        yourName = defaults.string(forKey: "live.yourName") ?? ""
        mode = Mode(rawValue: defaults.string(forKey: "live.mode") ?? "") ?? .local
        relay = defaults.string(forKey: "live.relay") ?? ""
        codeInput = defaults.string(forKey: "live.code") ?? ""
        let saved = (defaults.dictionary(forKey: "live.levels") as? [String: Double]) ?? [:]
        levels = ["master": 1, "music": 1, "sfx": 1, "ambience": 1].merging(saved) { _, new in new }

        mirror.level = { [weak self] category in
            guard let self else { return 1 }
            return (self.levels["master"] ?? 1) * (self.levels[category] ?? 1)
        }
        mirror.onChange = { [weak self] in
            guard let self else { return }
            self.nowPlaying = self.mirror.nowPlaying
        }
        mirror.onWhisper = { [weak self] in self?.notice = "A whisper only you can hear…" }
        browser.onChange = { [weak self] list in self?.found = list }
        LiveListenerEngine.pruneCache()
    }

    func attach(store: SoundStore, ambience: AmbienceMixer, kits: KitStore, bashes: BashStore) {
        self.store = store
        self.ambience = ambience
        self.kits = kits
        self.bashes = bashes
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
            guard let base = LiveNet.relayURL(relay) else {
                error = "Set a relay server address first."
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
        engine.onPeers = { [weak self] list in
            guard let self else { return }
            self.peers = list
            if let target = self.whisperTo, !list.contains(where: { $0.id == target.id }) { self.whisperTo = nil }
        }
        host = engine
        hostingName = name
        hostingMode = mode
        if mode == .local { code = nil }
        peers = []
        role = .host
        lastAmbience = nil
        lastScene = nil
        lastPrefetch = nil
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
        whisperTo = nil
        peers = []
        code = nil
        reconnecting = false
        role = .idle
        error = message
    }

    private func pid() -> String {
        nextPid += 1
        return "\(Int(Date().timeIntervalSince1970 * 1000))-\(nextPid)"
    }

    /// A sound started on the board (tile, row or scene kit).
    func soundPlayed(_ sound: Sound, volume: Double) {
        guard role == .host, let host else { return }
        if sound.gmOnly == true {
            if whisperTo != nil { notice = "GM-only sounds can't be whispered." }
            return
        }
        var event = LiveHostEngine.PlayEvent(
            pid: pid(), group: "s:\(sound.id.uuidString)", soundId: sound.id, name: sound.name,
            at: LiveNet.now, volume: volume, cat: sound.isFull ? "music" : "sfx")
        event.loop = sound.repeatGap == 0
        event.gap = sound.repeatGap ?? 0
        event.buzz = sound.buzz == true
        event.duration = sound.duration ?? 0
        if let target = whisperTo {
            event.to = target.id
            notice = "Whispered “\(sound.name)” to \(target.name)."
            whisperTo = nil
        }
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
        if role == .listener { mirror.stopAll(ambienceToo: false) }
    }

    /// One clip of a bash. `at` is the wall-clock time (ms) of the clip's start.
    func bashClip(runId: String, soundId: UUID, at: Double, volume: Double, duration: Double) {
        guard role == .host, let host, let sound = store?.sound(soundId), sound.gmOnly != true else { return }
        var event = LiveHostEngine.PlayEvent(
            pid: pid(), group: "b:\(runId)", soundId: soundId, name: sound.name,
            at: at, volume: volume, cat: "sfx")
        event.buzz = sound.buzz == true
        event.duration = duration
        host.play(event)
    }

    func bashStopped(runId: String) {
        host?.stop(group: "b:\(runId)")
    }

    private var lastAmbience: [AmbienceLayer]?
    private var lastScene: String??
    private var lastPrefetch: [UUID]?

    /// Ambience, the open kit and what listeners should fetch ahead, sent when they change.
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
        guard let base = LiveNet.relayURL(relay) else {
            error = "Set a relay server address first."
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
            }
        }
        listener = engine
        role = .listener
        connected = false
        hostName = nil
        scene = nil
        browser.stop()
        // Keep the screen on so the sounds keep playing.
        UIApplication.shared.isIdleTimerDisabled = true
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
        nowPlaying = []
        UIApplication.shared.isIdleTimerDisabled = false
    }
}
