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
    /// Scene Kit sounds that play for everyone on a natural 20 or a natural 1 ("" for none).
    @Published var nat20Sound: String { didSet { save("live.nat20Sound", nat20Sound) } }
    @Published var nat1Sound: String { didSet { save("live.nat1Sound", nat1Sound) } }
    /// The buzzer or quiz running, as this device may see it (all of it for the
    /// broadcaster), or nil. While a listener has one, their screen is locked to it.
    @Published private(set) var game: GameState?
    /// Pictures shown this session (a listener's: received; the broadcaster's:
    /// sent), oldest first. Only kept until the session ends.
    @Published private(set) var handouts: [Handout] = []
    /// The handout filling a listener's screen, or nil.
    @Published private(set) var viewingHandout: Handout?
    /// This device's id in the session ("host" for the broadcaster).
    private(set) var myPeer = ""
    /// Buzzer rounds this device buzzed in, and its quiz answers (question → choice).
    @Published private(set) var buzzedRounds: Set<Int> = []
    @Published private(set) var myAnswers: [Int: Int] = [:]
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
    /// The dice tray; in a session everyone sees every roll.
    let dice = DiceTray()
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
        nat20Sound = defaults.string(forKey: "live.nat20Sound") ?? ""
        nat1Sound = defaults.string(forKey: "live.nat1Sound") ?? ""
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
        dice.myName = { [weak self] in self?.diceName ?? "You" }
        dice.onStart = { [weak self] start in self?.sendRoll(start.json) }
        dice.onResult = { [weak self] id, values in self?.sendRoll(["t": "rollResult", "id": id, "values": values]) }
        dice.volume = { [weak self] in self?.player?.masterVolume ?? 1 }
        dice.onClaim = { [weak self] color in self?.claimColor(color) }
        dice.hosting = { [weak self] in self?.role == .host }
        dice.onShareCustom = { [weak self] list in self?.host?.table(["t": "customDice", "list": list.map(\.json)]) }
        // A natural 20 or 1 plays the broadcaster's chosen sound for everyone.
        dice.addNaturalHook { [weak self] natural, _ in self?.playNatural(natural) }
        // Roll requests and the turn order go from the broadcaster's screen to listeners.
        dice.table.send = { [weak self] message in self?.host?.table(message) }
        dice.table.peers = { [weak self] in self?.peers ?? [] }
        dice.table.hosting = { [weak self] in self?.role == .host }
        dice.table.myName = { [weak self] in self?.diceName ?? "You" }
        dice.table.nudge = { [weak self] title, body in self?.nudge(title: title, body: body) }
        LiveFiles.pruneCache()
    }

    // MARK: Dice

    /// Your name on rolls the others see.
    private var diceName: String {
        let name = yourName.trimmingCharacters(in: .whitespaces)
        switch role {
        case .host: return name.isEmpty ? "Broadcaster" : name
        case .listener: return name.isEmpty ? "Someone" : name
        case .idle: return "You"
        }
    }

    /// Asks for a dice colour; the broadcaster's app makes sure no one else has it.
    private func claimColor(_ color: String) {
        switch role {
        case .host: host?.setHostColor(color, name: diceName)
        case .listener: listener?.sendRoll(["t": "diceColor", "color": color])
        case .idle: break
        }
    }

    /// A roll on this device, for everyone in the session.
    private func sendRoll(_ message: LiveJSON) {
        switch role {
        case .host:
            // The broadcaster can roll for someone else (an enemy's initiative).
            if LiveNet.string(message["t"]) == "roll" {
                let by = (LiveNet.string(message["by"]) ?? "").trimmingCharacters(in: .whitespaces)
                host?.roll(message, by: by.isEmpty ? diceName : by)
            } else {
                host?.rollResult(message)
            }
        case .listener:
            listener?.sendRoll(message)
        case .idle:
            break
        }
    }

    /// Someone else's roll, from the session.
    private func receiveRoll(_ message: LiveJSON) {
        switch LiveNet.string(message["t"]) {
        case "roll": dice.remoteStart(message)
        case "rollResult": dice.remoteResult(message)
        case "rolls": dice.setHistory((message["list"] as? [Any]) ?? [])
        case "diceColors": dice.setSessionColors((message["colors"] as? [Any]) ?? [], you: LiveNet.string(message["you"]) ?? "")
        case "customDice": dice.setSharedCustom((message["list"] as? [Any]) ?? [])
        // The buzzer or quiz (GamesView.swift).
        case "game": receiveGame(message)
        // Roll requests, results and the turn order (TableView.swift).
        case "ask", "askClosed", "askResult", "turns": dice.table.receive(message)
        default: break
        }
    }

    // MARK: Games

    /// The game from the host (a listener) or from this device's own engine (the broadcaster).
    private func receiveGame(_ message: LiveJSON) {
        if let you = LiveNet.string(message["you"]), !you.isEmpty { myPeer = you }
        if role == .host { myPeer = "host" }
        let next = GameState(message)
        if next == nil {
            buzzedRounds = []
            myAnswers = [:]
        }
        let starting = game == nil && next != nil
        game = next
        if starting && role == .listener {
            // The game takes over a listener's screen: the dice close.
            dice.close()
            nudge(title: next?.kind == "buzzer" ? "🔔 Buzzer" : "🧠 Quiz", body: "The broadcaster started a game.")
        }
        GameLock.shared.update(self)
    }

    /// The broadcaster's commands (see LiveGame).
    func gameControl(_ action: String, _ extra: LiveJSON = [:]) {
        guard role == .host else { return }
        var cmd = extra
        cmd["action"] = action
        host?.gameControl(cmd)
    }

    /// A listener buzzes: only once per round, and only while it's live.
    func buzz() {
        guard role == .listener, let game, game.kind == "buzzer", game.phase == "armed", !buzzedRounds.contains(game.round) else { return }
        buzzedRounds.insert(game.round)
        listener?.sendRoll(["t": "gameInput", "id": game.id, "buzz": true])
        haptics.impactOccurred(intensity: 1)
    }

    /// A listener answers the question: once.
    func answer(_ choice: Int) {
        guard role == .listener, let game, game.phase == "question", myAnswers[game.n] == nil else { return }
        myAnswers[game.n] = choice
        listener?.sendRoll(["t": "gameInput", "id": game.id, "q": game.n, "choice": choice])
        haptics.impactOccurred(intensity: 0.6)
    }

    var myPeerId: String { myPeer }

    /// Sounds to choose from for natural 20s and 1s: the open Scene Kit's first.
    var natSoundChoices: (kit: String?, inKit: [Sound], others: [Sound]) {
        let all = store?.sounds ?? []
        guard let id = currentKitId, let kit = kits?.kit(id) else { return (nil, [], all) }
        let ids = Set(kit.allItems.filter { $0.type == .sound }.map(\.id))
        return (kit.name, all.filter { ids.contains($0.id) }, all.filter { !ids.contains($0.id) })
    }

    private func playNatural(_ natural: Int) {
        let id = natural == 20 ? nat20Sound : nat1Sound
        guard role == .host, let uuid = UUID(uuidString: id), let store, let player, let sound = store.sound(uuid) else { return }
        try? player.play(sound, url: store.url(for: sound))
    }

    /// A nudge (a roll request, your turn): a buzz now, or a notification if
    /// the app is in the background.
    private func nudge(title: String, body: String) {
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        if UIApplication.shared.applicationState == .active {
            haptics.impactOccurred(intensity: 1)
            return
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "table-\(UUID().uuidString)", content: content, trigger: nil))
    }

    func attach(store: SoundStore, ambience: AmbienceMixer, kits: KitStore, bashes: BashStore, player: SoundPlayer) {
        self.store = store
        self.ambience = ambience
        // Now-and-then ambience layers reach listeners one play at a time.
        ambience.onCue = { [weak self] layer, name in self?.ambienceCue(layer, name: name) }
        ambience.onCueStop = { [weak self] id, fade in self?.groupStopped("a:\(id)", fade: fade) }
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
            // Someone in a "who wins" left: it may be complete now.
            self.dice.table.maybeFinishContest()
        }
        engine.onCue = { [weak self] peer, name, cue in self?.playPlayerSound(from: peer, name: name, cue: cue) }
        engine.onRoll = { [weak self] message in self?.receiveRoll(message) }
        engine.onGame = { [weak self] message in self?.receiveGame(message) }
        engine.onColors = { [weak self] message in
            self?.dice.setSessionColors((message["colors"] as? [Any]) ?? [], you: "host")
        }
        dice.resetLog()
        host = engine
        engine.setPlayerSounds(playerSounds)
        engine.setHostColor(dice.color, name: yourName.trimmingCharacters(in: .whitespaces).isEmpty ? "Broadcaster" : yourName)
        engine.table(["t": "customDice", "list": dice.customDice.map(\.json)])
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
        let was = host != nil
        host?.end()
        dice.setSessionColors(nil, you: "")
        dice.table.reset()
        game = nil
        GameLock.shared.update(self)
        handouts = []
        Handout.dropSent()
        // The end-of-session recap.
        if was { dice.recap() }
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

    /// A sound started on the board (tile, row, scene kit or playlist).
    /// group: what listeners stop it by; fadeIn: seconds it fades in over.
    func soundPlayed(_ sound: Sound, volume: Double, group: String? = nil, fadeIn: Double = 0) {
        guard role == .host, let host else { return }
        if sound.gmOnly == true {
            if !whisperTargets.isEmpty { notice = "Broadcaster-only sounds can't be whispered." }
            return
        }
        var event = LiveHostEngine.PlayEvent(
            pid: pid(), group: group ?? "s:\(sound.id.uuidString)", source: .library(sound.id), name: sound.name,
            at: LiveNet.now, volume: volume, cat: sound.isFull ? "music" : "sfx")
        event.fadeIn = fadeIn
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

    /// A playing sound stopped (fading out over `fade` seconds) or changed volume.
    func groupStopped(_ group: String, fade: Double = 0) {
        host?.stop(group: group, fade: fade)
    }

    func groupVolume(_ group: String, volume: Double) {
        host?.volume(group: group, volume: volume)
    }

    /// A now-and-then ambience layer played once: listeners play it too.
    func ambienceCue(_ layer: AmbienceLayer, name: String) {
        guard role == .host, let host else { return }
        if layer.kind == .sound, let id = UUID(uuidString: layer.ref), store?.sound(id)?.gmOnly == true { return }
        let source: LiveHostEngine.Source
        switch layer.kind {
        case .builtin: source = .builtin(layer.ref)
        case .sound:
            guard let id = UUID(uuidString: layer.ref) else { return }
            source = .library(id)
        }
        host.play(LiveHostEngine.PlayEvent(pid: pid(), group: "a:\(layer.id)", source: source, name: name,
                                           at: LiveNet.now, volume: layer.volume, cat: "ambience"))
    }

    /// A scene change: ambience sent in the next moment fades this long for listeners.
    private var sceneFade: (seconds: Double, until: Date)?

    func sceneChanged(fade: Double) {
        sceneFade = (fade, Date().addingTimeInterval(1.5))
        syncHostState()
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

    // MARK: Listeners' sounds (host)

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
            let fade = sceneFade.map { Date() < $0.until ? $0.seconds : 0 } ?? 0
            host.setAmbience(layers, names: names, fade: fade)
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
            error = "Enter the session code from the broadcaster."
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
        let name = yourName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else {
            error = "Enter your name to tune in."
            return
        }
        let engine = LiveListenerEngine(socket: socket, name: String(name.prefix(40)), device: deviceName)
        engine.builtinURL = { [weak self] file in self?.ambience?.builtins.first { $0.file == file }?.url }
        engine.onCommand = { [weak self] command in
            guard let self else { return }
            switch command {
            case .play(let play): self.mirror.play(play)
            case .stop(let group, let fade): self.mirror.stop(group: group, fade: fade)
            case .volume(let group, let volume): self.mirror.setVolume(volume, group: group)
            case .stopAll(let ambienceToo): self.mirror.stopAll(ambienceToo: ambienceToo)
            case .ambience(let layers, let fade): self.mirror.setAmbience(layers, fade: fade > 0 ? fade : AmbienceMixer.fade)
            }
        }
        engine.onScene = { [weak self] name in self?.scene = name }
        engine.onHandout = { [weak self] handout in self?.receiveHandout(handout) }
        engine.onRoll = { [weak self] message in self?.receiveRoll(message) }
        dice.resetLog()
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
        let was = listener != nil
        listener = nil
        dice.setSessionColors(nil, you: "")
        dice.table.reset()
        game = nil
        buzzedRounds = []
        myAnswers = [:]
        GameLock.shared.update(self)
        handouts = []
        viewingHandout = nil
        HandoutLock.shared.update(self)
        if was { dice.recap() }
        mirror.stopAll(ambienceToo: true)
        role = .idle
        connected = false
        showStage = false
        nowPlaying = []
        allowedPlayerSounds = .off
        BackgroundAudio.shared.keepAlive(false)
    }

    // MARK: Listeners' sounds (listener)

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

    // MARK: Handouts

    /// A handout arrived: a new one locks the screen to it.
    private func receiveHandout(_ handout: Handout) {
        guard role == .listener, handout.url != nil else { return }
        handouts.removeAll { $0.id == handout.id }
        handouts.append(handout)
        if handout.show {
            viewingHandout = handout
            HandoutLock.shared.update(self)
            nudge(title: "🗺️ New handout", body: handout.title.isEmpty ? "The broadcaster sent a picture." : handout.title)
        }
    }

    /// Opens one of the session's handouts (from the stage's list).
    func openHandout(_ handout: Handout) {
        viewingHandout = handout
        HandoutLock.shared.update(self)
    }

    func closeHandout() {
        viewingHandout = nil
        HandoutLock.shared.update(self)
    }

    /// The broadcaster sends a picture to every listener's screen.
    func sendHandout(_ image: UIImage, title: String) {
        guard role == .host, let host, let prepared = Handout.prepare(image) else {
            notice = "Couldn't send that picture."
            return
        }
        let id = "h-\(Int(Date().timeIntervalSince1970 * 1000))-\(prepared.hash.prefix(6))"
        let clean = Handout.cleanTitle(title)
        host.handout(id: id, url: prepared.url, hash: prepared.hash, title: clean)
        handouts.removeAll { $0.id == id }
        handouts.append(Handout(id: id, title: clean, url: prepared.url, show: false))
        let n = peers.count
        notice = "Sent “\(clean.isEmpty ? "Handout" : clean)” to \(n) listener\(n == 1 ? "" : "s")."
    }

    /// The broadcaster puts a handout back on everyone's screen.
    func showHandoutAgain(_ handout: Handout) {
        host?.showHandout(id: handout.id)
        notice = "Showing “\(handout.title.isEmpty ? "Handout" : handout.title)” again."
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
        content.title = "💥 \(hostName ?? "The broadcaster")"
        content.body = play.whisper ? "Something only you can feel…" : (play.name.isEmpty ? "Brace yourself!" : play.name)
        content.sound = .default
        let request = UNNotificationRequest(identifier: "buzz-\(play.pid)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
