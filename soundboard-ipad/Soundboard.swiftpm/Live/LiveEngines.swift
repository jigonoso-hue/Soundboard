import CryptoKit
import Foundation

// The protocol logic of a Live Session, shared by both ways of connecting.
// LiveHostEngine answers listeners, serves files, forwards what the board
// plays and takes players' sound requests. LiveListenerEngine syncs its clock
// to the host, fetches and caches files, turns host commands into local ones
// for the MirrorPlayer, and sends the player's own sounds when asked.

/// SHA-256 of library files, remembered until the file changes.
@MainActor
final class FileHasher {
    private var cache: [String: (key: String, hash: String)] = [:]

    func hash(_ url: URL) async -> String? {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        let size = (attributes?[.size] as? NSNumber)?.int64Value ?? -1
        let modified = (attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        let key = "\(size):\(modified)"
        if let cached = cache[url.path], cached.key == key { return cached.hash }
        let hash = await Task.detached(priority: .userInitiated) { () -> String? in
            guard let data = try? Data(contentsOf: url, options: .alwaysMapped) else { return nil }
            return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }.value
        if let hash { cache[url.path] = (key, hash) }
        return hash
    }
}

/// Which sounds players may play for everyone.
enum PlayerSounds: String, CaseIterable {
    /// Only the GM plays sounds.
    case off
    /// Each listener picks up to five sounds from their own library.
    case own
    /// Each listener picks up to five sounds from the GM's library.
    case gm

    static let limit = 5

    var label: String {
        switch self {
        case .off: return "Off"
        case .own: return "Their own sounds"
        case .gm: return "My soundboard"
        }
    }
}

/// One of the GM's sounds that players may choose.
struct CatalogItem: Identifiable, Equatable {
    let id: String
    let name: String
    let colorIndex: Int
}

/// Cached files, and the chunk messages files travel in.
enum LiveFiles {
    static func isHash(_ text: String) -> Bool {
        text.count == 64 && text.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }

    static func isExt(_ text: String) -> Bool {
        (1...5).contains(text.count) && text.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) && !$0.isUppercase }
    }

    static var cacheDir: URL {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = caches.appendingPathComponent("LiveCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func cached(_ hash: String, _ ext: String) -> URL? {
        guard isHash(hash), isExt(ext) else { return nil }
        let url = cacheDir.appendingPathComponent("\(hash).\(ext)")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Chunk `index` of a file as a `chunk` message, or nil if there's no such chunk.
    static func chunk(of url: URL, hash: String, index: Int) -> LiveJSON? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()) ?? 0
        let total = max(1, Int((size + UInt64(LiveNet.chunkSize) - 1) / UInt64(LiveNet.chunkSize)))
        guard index >= 0, index < total else { return nil }
        try? handle.seek(toOffset: UInt64(index * LiveNet.chunkSize))
        let data = (try? handle.read(upToCount: LiveNet.chunkSize)) ?? Data()
        return [
            "t": "chunk", "hash": hash, "i": index, "n": total,
            "ext": url.pathExtension.lowercased(), "data": data.base64EncodedString(),
        ]
    }

    /// Deletes cached files not used for a month.
    static func pruneCache() {
        let cutoff = Date().addingTimeInterval(-30 * 86400)
        let files = (try? FileManager.default.contentsOfDirectory(at: cacheDir, includingPropertiesForKeys: [.contentAccessDateKey])) ?? []
        for file in files {
            let used = (try? file.resourceValues(forKeys: [.contentAccessDateKey]).contentAccessDate) ?? Date()
            if used < cutoff { try? FileManager.default.removeItem(at: file) }
        }
    }
}

func clamp01(_ value: Double?) -> Double {
    guard let value, value.isFinite else { return 1 }
    return min(1, max(0, value))
}

/// Fetches files from the other side of a connection, a few chunks at a time,
/// most urgent first, checks their hash and caches them.
@MainActor
final class FileFetcher {
    var onArrived: ((String, URL) -> Void)?
    var onFailed: ((String) -> Void)?
    private let send: (LiveJSON) -> Void

    private struct Job {
        var ext: String
        var total: Int?
        var next = 0
        var inFlight = 0
        var received = 0
        var chunks: [Int: Data] = [:]
    }
    private var jobs: [String: Job] = [:]
    private var queue: [String] = []

    init(send: @escaping (LiveJSON) -> Void) {
        self.send = send
    }

    func want(_ hash: String, ext: String, urgent: Bool) {
        guard LiveFiles.isHash(hash), LiveFiles.isExt(ext), LiveFiles.cached(hash, ext) == nil else { return }
        if jobs[hash] == nil { jobs[hash] = Job(ext: ext) }
        if let index = queue.firstIndex(of: hash) {
            guard urgent else { return }
            queue.remove(at: index)
        }
        if urgent { queue.insert(hash, at: 0) } else { queue.append(hash) }
        pump()
    }

    /// Keeps a few chunk requests in flight for the most urgent file.
    private func pump() {
        guard let hash = queue.first, var job = jobs[hash] else { return }
        while job.inFlight < 4 {
            if let total = job.total {
                guard job.next < total else { break }
            } else if job.next > 0 {
                break // learn the chunk count first
            }
            send(["t": "need", "hash": hash, "i": job.next])
            job.next += 1
            job.inFlight += 1
        }
        jobs[hash] = job
    }

    func handleChunk(_ message: LiveJSON) {
        guard let hash = LiveNet.string(message["hash"]), var job = jobs[hash],
              let index = LiveNet.number(message["i"]).map({ Int($0) }),
              let total = LiveNet.number(message["n"]).map({ Int($0) }),
              total >= 1, index >= 0, index < total, job.chunks[index] == nil else { return }
        job.total = total
        job.inFlight = max(0, job.inFlight - 1)
        job.chunks[index] = Data(base64Encoded: LiveNet.string(message["data"]) ?? "") ?? Data()
        job.received += 1
        jobs[hash] = job
        guard job.received >= total else {
            pump()
            return
        }
        var bytes = Data()
        for i in 0..<total { bytes.append(job.chunks[i] ?? Data()) }
        jobs[hash] = nil
        queue.removeAll { $0 == hash }
        let actual = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        if actual == hash {
            let url = LiveFiles.cacheDir.appendingPathComponent("\(hash).\(job.ext)")
            try? bytes.write(to: url, options: .atomic)
            onArrived?(hash, url)
        } else {
            onFailed?(hash)
        }
        pump()
    }

    func handleMissing(_ hash: String) {
        jobs[hash] = nil
        queue.removeAll { $0 == hash }
        onFailed?(hash)
        pump()
    }
}

// MARK: - Dice rolls

/// Dice rolls shared with everyone in a session (see PROTOCOL.md, Dice):
/// checking what listeners send.
enum LiveRolls {
    static let ranges: [String: ClosedRange<Int>] = [
        "d4": 1...4, "d6": 1...6, "d8": 1...8, "d10": 0...9, "d10t": 0...9, "d12": 1...12, "d20": 1...20, "coin": 1...2,
    ]
    static let types = ["d4", "d6", "d8", "d10", "d12", "d20", "d100", "coin", "custom"]
    static let maxDice = 40
    /// The dice colours. In a session each person claims one, and no two people
    /// share a colour, so it's always clear whose dice are whose.
    static let colors = [
        "#b3261e", "#2a5bd7", "#1f8a5b", "#7b3fbf", "#c47a12", "#1d1d24", "#e8e2d0", "#0f8a8a",
        "#d6457a", "#7cb518", "#e3611c", "#4fb3e8", "#d4a017", "#5b2a6e", "#9aa3ad", "#8a5a2b",
    ]

    private static func num(_ value: Any?, _ low: Double, _ high: Double) -> Double {
        guard let n = LiveNet.number(value), n.isFinite else { return 0 }
        return min(high, max(low, n))
    }

    private static func nums(_ value: Any?, count: Int, _ low: Double, _ high: Double) -> [Double] {
        let list = (value as? [Any]) ?? []
        return (0..<count).map { num($0 < list.count ? list[$0] : nil, low, high) }
    }

    /// An id: 1–60 letters, digits, - and _.
    static func isId(_ value: Any?) -> Bool {
        guard let id = LiveNet.string(value) else { return false }
        return (1...60).contains(id.count) && id.allSatisfy { ($0.isASCII && ($0.isLetter || $0.isNumber)) || $0 == "-" || $0 == "_" }
    }

    /// A roll's start, checked: the dice and how they're thrown.
    static func cleanStart(_ m: LiveJSON) -> LiveJSON? {
        let id = LiveNet.string(m["id"]) ?? ""
        guard isId(id) else { return nil }
        let kinds = ((m["kinds"] as? [Any]) ?? []).prefix(maxDice).compactMap { LiveNet.string($0) }
        guard !kinds.isEmpty, kinds.allSatisfy({ ranges[$0] != nil }) else { return nil }
        let rawDice = ((m["dice"] as? [Any]) ?? []).prefix(kinds.count).compactMap { $0 as? LiveJSON }
        guard rawDice.count == kinds.count else { return nil }
        let dice: [LiveJSON] = rawDice.map { d in
            [
                "p": nums(d["p"], count: 2, -1, 1),
                "h": num(d["h"], 0.5, 8),
                "v": nums(d["v"], count: 2, -10, 10),
                "w": nums(d["w"], count: 3, -80, 80),
                "q": nums(d["q"], count: 4, -1, 1),
            ]
        }
        // Custom dice used in the roll, with their words, so every device can draw them.
        let custom = ((m["custom"] as? [Any]) ?? []).prefix(10).compactMap(CustomDie.clean)
        var groups: [LiveJSON] = []
        for item in ((m["groups"] as? [Any]) ?? []).prefix(maxDice) {
            guard let g = item as? LiveJSON, let type = LiveNet.string(g["type"]), types.contains(type) else { return nil }
            let indices = ((g["dice"] as? [Any]) ?? []).prefix(2).map { Int(num($0, 0, Double(kinds.count - 1))) }
            guard !indices.isEmpty else { return nil }
            var group: LiveJSON = ["type": type, "dice": indices]
            if type == "custom" {
                let die = LiveNet.string(g["die"]) ?? ""
                guard custom.contains(where: { $0.id == die }) else { return nil }
                group["die"] = die
            }
            groups.append(group)
        }
        guard !groups.isEmpty else { return nil }
        let mode = LiveNet.string(m["mode"]) ?? "normal"
        let color = LiveNet.string(m["color"]) ?? ""
        let validColor = color.count == 7 && color.hasPrefix("#") && color.dropFirst().allSatisfy(\.isHexDigit)
        var start: LiveJSON = [
            "t": "roll", "id": id, "kinds": Array(kinds), "dice": dice, "groups": groups,
            "mode": ["normal", "adv", "dis"].contains(mode) ? mode : "normal",
            "modifier": Int(num(m["modifier"], -99, 99)),
            "color": validColor ? color : "#2a5bd7",
            "by": String((LiveNet.string(m["by"]) ?? "").prefix(40)),
        ]
        if !custom.isEmpty { start["custom"] = custom.map(\.json) }
        // A roll asked for by the broadcaster (a check, initiative, who goes first).
        if isId(m["ask"]) { start["ask"] = LiveNet.string(m["ask"]) }
        if (m["hidden"] as? Bool) == true { start["hidden"] = true }
        return start
    }

    /// What each die of a roll shows, checked against the dice.
    static func cleanValues(_ value: Any?, kinds: [String]) -> [Int]? {
        guard let list = value as? [Any], list.count == kinds.count else { return nil }
        var out: [Int] = []
        for (i, item) in list.enumerated() {
            guard let n = LiveNet.number(item), n == n.rounded(), let range = ranges[kinds[i]], range.contains(Int(n)) else { return nil }
            out.append(Int(n))
        }
        return out
    }
}

// MARK: - Host

@MainActor
final class LiveHostEngine {
    struct Peer: Identifiable, Equatable {
        let id: String
        var name: String
        var device: String
    }

    /// Where a play's file comes from.
    enum Source {
        case library(UUID)
        case file(hash: String, ext: String, url: URL)
        /// A built-in sound: every copy of the app has it, so nothing to send.
        case builtin(String)
    }

    /// A play for the host to send. `to` makes it a whisper to those listeners.
    struct PlayEvent {
        var pid: String
        var group: String
        var source: Source
        var name: String
        var at: Double
        var volume: Double
        var cat: String
        var loop = false
        var gap: Double = 0
        var buzz = false
        var duration: Double = 0
        var to: [String]? = nil
        /// The player who played it, for sounds players add.
        var by: String? = nil
        /// Seconds it fades in over (a playlist's next song, a scene change).
        var fadeIn: Double = 0
    }

    /// A sound a player asked to play for everyone.
    enum Cue {
        case library(UUID)
        case file(hash: String, ext: String, name: String, url: URL)
    }

    let name: String
    let transport: LiveHostTransport
    /// A library sound's file, or nil if it's gone.
    var resolveSound: (UUID) -> URL? = { _ in nil }
    /// The GM's sounds players may choose from, when players use the GM's soundboard.
    var catalog: () -> [CatalogItem] = { [] }
    var onPeers: (([Peer]) -> Void)?
    /// A player's sound request, already checked against the rules: (peer, player name, cue).
    var onCue: ((String, String, Cue) -> Void)?
    /// A listener's dice roll starting or finished, for the host's own screen.
    var onRoll: ((LiveJSON) -> Void)?
    private(set) var playerSounds: PlayerSounds = .off
    private var rollStarts: [String: (start: LiveJSON, peer: String?, done: Bool)] = [:]
    private var rollOrder: [String] = []
    /// Finished rolls, for listeners who join later.
    private var rollLog: [LiveJSON] = []
    /// Who has which dice colour: peer (or "host") → colour.
    private var diceColors: [String: String] = [:]
    /// The broadcaster's table, for listeners who join later: shared custom dice,
    /// open roll requests and the turn order.
    private var tableDice: LiveJSON?
    private var tableAsks: [String: LiveJSON] = [:]
    private var tableAskOrder: [String] = []
    private(set) var tableTurns: LiveJSON?
    private var hostDiceName = "Broadcaster"
    /// The colour list changed, for the host's own dice tray.
    var onColors: ((LiveJSON) -> Void)?
    /// The game as the broadcaster sees it (everything), for the host's own screen.
    var onGame: ((LiveJSON) -> Void)?
    /// The buzzer or quiz running (locks listeners' screens to it), or nil.
    private var game: LiveGame?
    private var gameTimer: Task<Void, Never>?

    private struct PeerInfo {
        var name = "Listener"
        var device = ""
        var ready = false
        var allowed: Set<String> = []
        /// Distinct sounds this player has played (at most five).
        var cued: Set<String> = []
        var lastCue: Double = 0
        /// The player's own sounds on offer: hash → (ext, name).
        var offers: [String: (ext: String, name: String)] = [:]
        var fetcher: FileFetcher?
        /// Own sounds requested before their file arrived.
        var waitingCues: Set<String> = []
    }

    private struct ActivePlay {
        var message: LiveJSON
        var group: String
        var until: Double
    }

    private var peers: [String: PeerInfo] = [:]
    private var files: [String: URL] = [:]
    private var active: [String: ActivePlay] = [:]
    private var ambience: LiveJSON = ["t": "ambience", "layers": [LiveJSON]()]
    private var scene: LiveJSON = ["t": "scene", "name": NSNull()]
    private var prefetchIds: [UUID] = []
    private let hasher: FileHasher
    /// Keeps operations in order (a play waiting on its file hash, then a stop).
    private var tail: Task<Void, Never>?

    init(name: String, transport: LiveHostTransport) {
        self.name = name
        self.transport = transport
        hasher = FileHasher()
        transport.onJoin = { [weak self] peer in self?.peers[peer] = PeerInfo() }
        transport.onLeave = { [weak self] peer in
            guard let self else { return }
            self.peers[peer] = nil
            self.emitPeers()
            // Their dice colour is free again.
            if self.diceColors.removeValue(forKey: peer) != nil { self.broadcastColors() }
        }
        transport.onMessage = { [weak self] peer, message in
            self?.enqueue { [weak self] in await self?.handle(peer, message) }
        }
    }

    var peerList: [Peer] {
        peers.filter { $0.value.ready }
            .map { Peer(id: $0.key, name: $0.value.name, device: $0.value.device) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func emitPeers() { onPeers?(peerList) }

    private func enqueue(_ operation: @escaping @MainActor () async -> Void) {
        let previous = tail
        tail = Task { @MainActor in
            await previous?.value
            await operation()
        }
    }

    private func handle(_ peer: String, _ message: LiveJSON) async {
        guard peers[peer] != nil else { return }
        switch LiveNet.string(message["t"]) {
        case "hello":
            peers[peer]?.name = String((LiveNet.string(message["name"]) ?? "Listener").prefix(40))
            peers[peer]?.device = String((LiveNet.string(message["device"]) ?? "").prefix(40))
            peers[peer]?.ready = true
            transport.send(["t": "welcome", "peer": peer, "host": name, "v": LiveNet.version], to: peer)
            transport.send(scene, to: peer)
            transport.send(rulesMessage, to: peer)
            if playerSounds == .gm { transport.send(catalogMessage, to: peer) }
            if !rollLog.isEmpty { transport.send(["t": "rolls", "list": Array(rollLog.suffix(30))], to: peer) }
            transport.send(colorsMessage, to: peer)
            if let tableDice { transport.send(tableDice, to: peer) }
            for id in tableAskOrder { if let ask = tableAsks[id], ask["to"] == nil { transport.send(ask, to: peer) } }
            if let tableTurns { transport.send(tableTurns, to: peer) }
            if game != nil { transport.send(LiveGame.publicView(game), to: peer) }
            send(ambience, to: peer)
            send(await prefetchMessage(), to: peer)
            let now = LiveNet.now
            active = active.filter { $0.value.until >= now }
            for play in active.values { send(play.message, to: peer) }
            emitPeers()
        case "ping":
            var pong: LiveJSON = ["t": "pong", "t1": LiveNet.now]
            pong["id"] = message["id"] ?? NSNull()
            pong["t0"] = message["t0"] ?? NSNull()
            transport.send(pong, to: peer)
        case "need":
            let hash = LiveNet.string(message["hash"]) ?? ""
            let index = Int(LiveNet.number(message["i"]) ?? 0)
            if LiveFiles.isHash(hash), peers[peer]?.allowed.contains(hash) == true, let url = files[hash],
               let chunk = LiveFiles.chunk(of: url, hash: hash, index: index) {
                transport.send(chunk, to: peer)
            } else {
                transport.send(["t": "missing", "hash": hash], to: peer)
            }
        case "roll":
            if let info = peers[peer], info.ready { startRoll(message, peer: peer, name: info.name) }
        case "rollResult":
            if peers[peer]?.ready == true { finishRoll(message, peer: peer) }
        case "diceColor":
            if peers[peer]?.ready == true { _ = claimColor(peer, LiveNet.string(message["color"]) ?? "") }
        case "gameInput":
            if let info = peers[peer], info.ready, let game,
               game.input(peer: peer, name: info.name, message, expected: peerList.count) {
                sendGame()
            }
        case "cue":
            handleCue(from: peer, message)
        case "offer":
            handleOffer(from: peer, message)
        case "chunk":
            peers[peer]?.fetcher?.handleChunk(message)
        case "missing":
            peers[peer]?.fetcher?.handleMissing(LiveNet.string(message["hash"]) ?? "")
        default:
            break
        }
    }

    // MARK: Dice

    /// A roll starting (from a listener, or the host's own with no peer): everyone
    /// sees the dice thrown. The host names who rolled, so no one can roll as someone else.
    private func startRoll(_ message: LiveJSON, peer: String?, name: String) {
        guard var start = LiveRolls.cleanStart(message), let id = LiveNet.string(start["id"]), rollStarts[id] == nil else { return }
        let fallback = LiveNet.string(start["by"]) ?? ""
        start["by"] = String((name.isEmpty ? (fallback.isEmpty ? "Someone" : fallback) : name).prefix(40))
        // Only the broadcaster can roll in secret.
        if peer != nil { start["hidden"] = nil }
        // Everyone rolls in their own colour; no colour, no roll.
        guard let color = diceColors[peer ?? "host"] else { return }
        start["color"] = color
        // Who rolled ("host" for the broadcaster): roll requests and initiative go by it.
        start["peer"] = peer ?? "host"
        rollStarts[id] = (start, peer, false)
        rollOrder.append(id)
        if rollOrder.count > 60 { rollStarts[rollOrder.removeFirst()] = nil }
        transport.send(start, to: nil)
        if peer != nil { onRoll?(start) }
    }

    /// A roll's result: the dice land on it everywhere, and it goes in the log.
    private func finishRoll(_ message: LiveJSON, peer: String?) {
        guard let id = LiveNet.string(message["id"]), let entry = rollStarts[id], entry.peer == peer, !entry.done,
              let kinds = entry.start["kinds"] as? [String],
              let values = LiveRolls.cleanValues(message["values"], kinds: kinds) else { return }
        rollStarts[id]?.done = true
        // A hidden roll's numbers stay with the broadcaster.
        if (entry.start["hidden"] as? Bool) == true { return }
        let result: LiveJSON = ["t": "rollResult", "id": id, "values": values]
        transport.send(result, to: nil)
        var logged: LiveJSON = ["id": id, "values": values, "at": LiveNet.now]
        for key in ["by", "mode", "modifier", "groups", "custom", "ask"] { logged[key] = entry.start[key] }
        rollLog.append(logged)
        if rollLog.count > 100 { rollLog.removeFirst() }
        if peer != nil { onRoll?(result) }
    }

    /// Who has which dice colour: [{ peer, name, color }] ("host" is the broadcaster).
    private var colorsMessage: LiveJSON {
        let list: [LiveJSON] = diceColors.map { peer, color in
            ["peer": peer, "color": color, "name": peer == "host" ? hostDiceName : (peers[peer]?.name ?? "Listener")]
        }
        return ["t": "diceColors", "colors": list]
    }

    private func broadcastColors() {
        transport.send(colorsMessage, to: nil)
        onColors?(colorsMessage)
    }

    /// Someone asks for a dice colour: theirs if no one else has it.
    private func claimColor(_ peer: String, _ color: String) -> Bool {
        let wanted = color.lowercased()
        guard LiveRolls.colors.contains(wanted) else { return false }
        if diceColors.contains(where: { $0.key != peer && $0.value == wanted }) {
            if peer != "host" { transport.send(colorsMessage, to: peer) }
            return false
        }
        diceColors[peer] = wanted
        broadcastColors()
        return true
    }

    /// The broadcaster's own colour and name.
    func setHostColor(_ color: String, name: String) {
        enqueue { [weak self] in
            guard let self else { return }
            if !name.isEmpty { self.hostDiceName = String(name.prefix(40)) }
            if !self.claimColor("host", color) { self.onColors?(self.colorsMessage) }
        }
    }

    /// The host's own roll.
    func roll(_ message: LiveJSON, by name: String) {
        enqueue { [weak self] in self?.startRoll(message, peer: nil, name: name) }
    }

    func rollResult(_ message: LiveJSON) {
        enqueue { [weak self] in self?.finishRoll(message, peer: nil) }
    }

    /// The broadcaster's table (from its own screen): shared custom dice, roll
    /// requests and initiative, sent on to listeners and remembered for late joiners.
    ///   customDice { list }             the broadcaster's custom dice, for listeners to roll
    ///   ask { id, kind, label, …, to }  a roll request (to: listener ids, or everyone)
    ///   askClosed { id } · askResult { id, … }
    ///   turns { phase, round, order, current }
    func table(_ message: LiveJSON) {
        enqueue { [weak self] in
            guard let self else { return }
            guard let data = try? JSONSerialization.data(withJSONObject: message), data.count <= 64 * 1024 else { return }
            switch LiveNet.string(message["t"]) {
            case "customDice":
                let list = ((message["list"] as? [Any]) ?? []).prefix(40).compactMap(CustomDie.clean)
                let m: LiveJSON = ["t": "customDice", "list": list.map(\.json)]
                self.tableDice = m
                self.transport.send(m, to: nil)
            case "ask":
                guard LiveRolls.isId(message["id"]), let id = LiveNet.string(message["id"]) else { return }
                var ask = message
                if let raw = message["to"] as? [Any] {
                    let to = raw.compactMap { LiveNet.string($0) }.filter { self.peers[$0] != nil }
                    ask["to"] = to
                    for peer in to { self.transport.send(ask, to: peer) }
                } else {
                    ask["to"] = nil
                    self.transport.send(ask, to: nil)
                }
                if self.tableAsks[id] == nil { self.tableAskOrder.append(id) }
                self.tableAsks[id] = ask
            case "askClosed", "askResult":
                let id = LiveNet.string(message["id"]) ?? ""
                let ask = self.tableAsks[id]
                let closing = LiveNet.string(message["t"]) == "askClosed"
                if closing {
                    self.tableAsks[id] = nil
                    self.tableAskOrder.removeAll { $0 == id }
                }
                if closing, let to = ask?["to"] as? [String] {
                    for peer in to { self.transport.send(message, to: peer) }
                } else {
                    self.transport.send(message, to: nil)
                }
            case "turns":
                self.tableTurns = LiveNet.string(message["phase"]) == "off" ? nil : message
                self.transport.send(message, to: nil)
            default:
                break
            }
        }
    }

    // MARK: Listeners' sounds

    private var rulesMessage: LiveJSON {
        ["t": "rules", "playerSounds": playerSounds.rawValue, "limit": PlayerSounds.limit]
    }

    private var catalogMessage: LiveJSON {
        ["t": "catalog", "sounds": catalog().map { ["id": $0.id, "name": $0.name, "color": $0.colorIndex] as LiveJSON }]
    }

    func setPlayerSounds(_ mode: PlayerSounds) {
        enqueue { [weak self] in
            guard let self else { return }
            self.playerSounds = mode
            for key in self.peers.keys {
                self.peers[key]?.cued = []
                if mode != .own { self.peers[key]?.offers = [:] }
            }
            self.broadcast(self.rulesMessage)
            if mode == .gm { self.broadcast(self.catalogMessage) }
        }
    }

    /// Sends the GM's sound list again (sounds added, renamed or marked GM only).
    func refreshCatalog() {
        enqueue { [weak self] in
            guard let self, self.playerSounds == .gm else { return }
            self.broadcast(self.catalogMessage)
        }
    }

    /// Checks a player's request against the rules: the right mode, at most five
    /// different sounds per player, and not too fast.
    private func handleCue(from peer: String, _ message: LiveJSON) {
        guard playerSounds != .off, var info = peers[peer], info.ready else { return }
        let now = LiveNet.now
        guard now - info.lastCue > 300 else { return }
        let key: String
        let cue: Cue?
        switch playerSounds {
        case .gm:
            guard let id = LiveNet.string(message["id"]).flatMap(UUID.init(uuidString:)),
                  catalog().contains(where: { $0.id == id.uuidString }) else { return }
            key = id.uuidString
            cue = .library(id)
        case .own:
            let hash = LiveNet.string(message["hash"]) ?? ""
            guard let offer = info.offers[hash] else { return }
            key = hash
            if let url = LiveFiles.cached(hash, offer.ext) {
                cue = .file(hash: hash, ext: offer.ext, name: offer.name, url: url)
            } else {
                // Play it once the file arrives from the player.
                cue = nil
                info.waitingCues.insert(hash)
                info.fetcher?.want(hash, ext: offer.ext, urgent: true)
            }
        case .off:
            return
        }
        guard info.cued.contains(key) || info.cued.count < PlayerSounds.limit else { return }
        info.cued.insert(key)
        info.lastCue = now
        peers[peer] = info
        if let cue { onCue?(peer, info.name, cue) }
    }

    /// A player's own sounds (at most five). The host fetches them ahead of time.
    private func handleOffer(from peer: String, _ message: LiveJSON) {
        guard playerSounds == .own, peers[peer]?.ready == true else { return }
        var offers: [String: (ext: String, name: String)] = [:]
        for item in ((message["sounds"] as? [LiveJSON]) ?? []).prefix(PlayerSounds.limit) {
            let hash = LiveNet.string(item["hash"]) ?? ""
            let ext = LiveNet.string(item["ext"]) ?? ""
            guard LiveFiles.isHash(hash), LiveFiles.isExt(ext) else { continue }
            offers[hash] = (ext, String((LiveNet.string(item["name"]) ?? "Sound").prefix(60)))
        }
        peers[peer]?.offers = offers
        if peers[peer]?.fetcher == nil {
            let fetcher = FileFetcher { [weak self] message in self?.transport.send(message, to: peer) }
            fetcher.onArrived = { [weak self] hash, url in self?.contributionArrived(from: peer, hash: hash, url: url) }
            fetcher.onFailed = { [weak self] hash in self?.peers[peer]?.waitingCues.remove(hash) }
            peers[peer]?.fetcher = fetcher
        }
        for (hash, offer) in offers { peers[peer]?.fetcher?.want(hash, ext: offer.ext, urgent: false) }
    }

    private func contributionArrived(from peer: String, hash: String, url: URL) {
        guard let info = peers[peer], let offer = info.offers[hash] else { return }
        if info.waitingCues.contains(hash) {
            peers[peer]?.waitingCues.remove(hash)
            onCue?(peer, info.name, .file(hash: hash, ext: offer.ext, name: offer.name, url: url))
        }
    }

    // MARK: Files

    /// Sends a message that refers to files, letting the listener fetch them.
    private func send(_ message: LiveJSON, to peer: String) {
        for hash in Self.hashes(in: message) { peers[peer]?.allowed.insert(hash) }
        transport.send(message, to: peer)
    }

    private func broadcast(_ message: LiveJSON) {
        let hashes = Self.hashes(in: message)
        for key in peers.keys { peers[key]?.allowed.formUnion(hashes) }
        transport.send(message, to: nil)
    }

    private static func hashes(in message: LiveJSON) -> [String] {
        switch LiveNet.string(message["t"]) {
        case "play": return [LiveNet.string(message["hash"])].compactMap { $0 }
        case "prefetch": return ((message["files"] as? [LiveJSON]) ?? []).compactMap { LiveNet.string($0["hash"]) }
        case "ambience": return ((message["layers"] as? [LiveJSON]) ?? []).compactMap { LiveNet.string($0["hash"]) }
        default: return []
        }
    }

    /// Hash and extension of a library sound, registering it to be served.
    private func file(for soundId: UUID) async -> (hash: String, ext: String)? {
        guard let url = resolveSound(soundId), let hash = await hasher.hash(url) else { return nil }
        files[hash] = url
        return (hash, url.pathExtension.lowercased())
    }

    private func prefetchMessage() async -> LiveJSON {
        var list: [LiveJSON] = []
        for id in prefetchIds {
            if let file = await file(for: id) { list.append(["hash": file.hash, "ext": file.ext]) }
        }
        return ["t": "prefetch", "files": list]
    }

    // MARK: Called by the board

    func play(_ event: PlayEvent) {
        enqueue { [weak self] in
            guard let self else { return }
            var message: LiveJSON = [
                "t": "play", "pid": event.pid, "group": event.group,
                "name": event.name, "at": event.at, "volume": clamp01(event.volume), "cat": event.cat,
                "loop": event.loop, "buzz": event.buzz, "whisper": event.to != nil,
            ]
            switch event.source {
            case .library(let id):
                guard let found = await self.file(for: id) else { return }
                message["hash"] = found.hash
                message["ext"] = found.ext
            case .file(let hash, let ext, let url):
                self.files[hash] = url
                message["hash"] = hash
                message["ext"] = ext
            case .builtin(let name):
                guard LiveNet.isBuiltinName(name) else { return }
                message["builtin"] = name
            }
            if event.gap > 0 { message["gap"] = event.gap }
            let fadeIn = LiveNet.fadeSeconds(event.fadeIn)
            if fadeIn > 0 { message["fadeIn"] = fadeIn }
            if let by = event.by { message["by"] = by }
            if let targets = event.to {
                for peer in targets where self.peers[peer] != nil { self.send(message, to: peer) }
                return
            }
            let endless = event.loop || event.gap > 0 || event.duration <= 0
            self.active[event.pid] = ActivePlay(message: message, group: event.group,
                                                until: endless ? .infinity : event.at + event.duration * 1000 + 1000)
            self.broadcast(message)
        }
    }

    /// fade: seconds listeners fade it out over (0: at once).
    func stop(group: String, fade: Double = 0) {
        enqueue { [weak self] in
            guard let self else { return }
            self.active = self.active.filter { $0.value.group != group }
            var message: LiveJSON = ["t": "stop", "group": group]
            let seconds = LiveNet.fadeSeconds(fade)
            if seconds > 0 { message["fade"] = seconds }
            self.broadcast(message)
        }
    }

    func volume(group: String, volume: Double) {
        enqueue { [weak self] in
            guard let self else { return }
            for (pid, play) in self.active where play.group == group {
                self.active[pid]?.message["volume"] = clamp01(volume)
            }
            self.broadcast(["t": "volume", "group": group, "volume": clamp01(volume)])
        }
    }

    func stopAll() {
        enqueue { [weak self] in
            self?.active.removeAll()
            self?.broadcast(["t": "stopAll"])
        }
    }

    /// The ambience layers playing now: built-in loops by file name, library sounds by id.
    /// fade: seconds listeners fade layers in and out over, for this change only (a scene change).
    func setAmbience(_ layers: [AmbienceLayer], names: [String: String], fade: Double = 0) {
        enqueue { [weak self] in
            guard let self else { return }
            var out: [LiveJSON] = []
            for layer in layers {
                var item: LiveJSON = ["key": layer.id, "name": names[layer.id] ?? "", "volume": clamp01(layer.volume)]
                switch layer.kind {
                case .builtin:
                    item["builtin"] = layer.ref
                case .sound:
                    guard let id = UUID(uuidString: layer.ref), let file = await self.file(for: id) else { continue }
                    item["hash"] = file.hash
                    item["ext"] = file.ext
                }
                out.append(item)
            }
            self.ambience = ["t": "ambience", "layers": out]
            var message = self.ambience
            let seconds = LiveNet.fadeSeconds(fade)
            if seconds > 0 { message["fade"] = seconds }
            self.broadcast(message)
        }
    }

    func setScene(_ name: String?) {
        enqueue { [weak self] in
            guard let self else { return }
            self.scene = ["t": "scene", "name": name ?? NSNull()]
            self.broadcast(self.scene)
        }
    }

    func setPrefetch(_ ids: [UUID]) {
        enqueue { [weak self] in
            guard let self else { return }
            self.prefetchIds = ids
            self.broadcast(await self.prefetchMessage())
        }
    }

    /// Removes a listener from the session.
    func kick(_ peer: String) {
        enqueue { [weak self] in
            guard let self, self.peers[peer] != nil else { return }
            self.transport.send(["t": "kicked"], to: peer)
            self.transport.kick(peer)
            self.peers[peer] = nil
            self.emitPeers()
        }
    }

    // MARK: Games: the buzzer and the quiz

    /// The broadcaster's commands: start {kind}, arm, reset (buzzer), ask {text,
    /// answers, correct, timer}, reveal, lobby, final (quiz), end.
    func gameControl(_ cmd: LiveJSON) {
        enqueue { [weak self] in
            guard let self else { return }
            switch LiveNet.string(cmd["action"]) ?? "" {
            case "start": self.game = LiveGame(kind: LiveNet.string(cmd["kind"]) ?? "")
            case "end": self.game = nil
            default:
                guard let game = self.game, game.control(cmd) else { return }
            }
            self.sendGame()
        }
    }

    /// Everyone gets the game as they may see it; the broadcaster's screen gets all of it.
    private func sendGame() {
        gameTimer?.cancel()
        // A question with a time limit ends by itself.
        if let game, game.phase == "question", let q = game.question, q.endsAt > 0 {
            let n = game.n
            let wait = max(0, q.endsAt - LiveNet.now) + 300
            gameTimer = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000))
                guard !Task.isCancelled, let self else { return }
                self.enqueue { [weak self] in
                    guard let self, let game = self.game, game.n == n, game.reveal() else { return }
                    self.sendGame()
                }
            }
        }
        transport.send(LiveGame.publicView(game), to: nil)
        var host = LiveGame.hostView(game)
        host["host"] = true
        onGame?(host)
    }

    func end() {
        gameTimer?.cancel()
        transport.send(["t": "bye"], to: nil)
        let transport = self.transport
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 200_000_000)
            transport.close()
        }
    }
}

// MARK: - Listener

@MainActor
final class LiveListenerEngine {
    enum State: Equatable { case connecting, connected, ended(String), failed(String) }

    /// A command with local times and file URLs, for the MirrorPlayer.
    enum Command {
        case play(MirrorPlay)
        /// fade: seconds to fade it out over (0: at once).
        case stop(group: String, fade: Double)
        case volume(group: String, volume: Double)
        case stopAll(ambienceToo: Bool)
        /// fade: seconds layers fade in and out over (longer on a scene change).
        case ambience([MirrorLayer], fade: Double)
    }

    var onState: ((State) -> Void)?
    var onCommand: ((Command) -> Void)?
    var onScene: ((String?) -> Void)?
    var onRules: ((PlayerSounds) -> Void)?
    var onCatalog: (([CatalogItem]) -> Void)?
    /// Dice rolls in the session: `roll`, `rollResult`, `rolls` and `diceColors` messages.
    var onRoll: ((LiveJSON) -> Void)?
    private(set) var hostName: String?
    /// This listener's id in the session (from `welcome`).
    private(set) var peerId: String?
    /// Resolves a built-in loop's file name to its URL.
    var builtinURL: (String) -> URL? = { _ in nil }

    private let socket: LiveSocket
    private let name: String
    private let device: String
    /// Host clock − local clock, in ms.
    private var offset: Double = 0
    private var samples: [(rtt: Double, offset: Double)] = []
    private var pingTask: Task<Void, Never>?
    private var closed = false
    private var fetcher: FileFetcher!
    private var pendingPlays: [String: [LiveJSON]] = [:]
    private var ambienceLayers: [LiveJSON] = []
    /// This player's own sounds on offer to the host: hash → file.
    private var offered: [String: URL] = [:]

    init(socket: LiveSocket, name: String, device: String) {
        self.socket = socket
        self.name = name
        self.device = device
        let fetcher = FileFetcher { [weak socket] message in socket?.send(message) }
        fetcher.onArrived = { [weak self] hash, url in self?.fileArrived(hash, url) }
        fetcher.onFailed = { [weak self] hash in self?.pendingPlays[hash] = nil }
        self.fetcher = fetcher
    }

    func start() {
        onState?(.connecting)
        socket.onOpen = { [weak self] in
            guard let self else { return }
            self.socket.send(["t": "hello", "name": self.name, "device": self.device, "v": LiveNet.version])
        }
        socket.onMessage = { [weak self] message in self?.handle(message) }
        socket.onClose = { [weak self] reason in
            guard let self, !self.closed else { return }
            self.closed = true
            self.pingTask?.cancel()
            if self.hostName == nil {
                self.onState?(.failed("Couldn't connect\(reason.map { " (\($0))" } ?? "")."))
            } else {
                self.onCommand?(.stopAll(ambienceToo: true))
                self.onState?(.ended("The session ended."))
            }
        }
        socket.start()
    }

    func leave() {
        closed = true
        pingTask?.cancel()
        socket.close()
        onCommand?(.stopAll(ambienceToo: true))
    }

    // MARK: Player sounds

    /// A dice roll starting or finished on this device, for everyone to see.
    func sendRoll(_ message: LiveJSON) {
        guard let t = LiveNet.string(message["t"]), ["roll", "rollResult", "diceColor", "gameInput"].contains(t) else { return }
        if t == "gameInput" {
            // A buzz or an answer, stamped with when it happened in the host's clock.
            var stamped = message
            stamped["at"] = LiveNet.now + offset
            socket.send(stamped)
            return
        }
        socket.send(message)
    }

    /// Asks the host to play one of the GM's sounds for everyone.
    func cue(soundId: String) {
        socket.send(["t": "cue", "id": soundId])
    }

    /// Asks the host to play one of this player's own (offered) sounds for everyone.
    func cue(hash: String) {
        socket.send(["t": "cue", "hash": hash])
    }

    /// Offers this player's own sounds (at most five) to the host.
    func offer(_ sounds: [(url: URL, hash: String, name: String)]) {
        offered = [:]
        var list: [LiveJSON] = []
        for sound in sounds.prefix(PlayerSounds.limit) {
            offered[sound.hash] = sound.url
            list.append(["hash": sound.hash, "ext": sound.url.pathExtension.lowercased(), "name": sound.name])
        }
        socket.send(["t": "offer", "sounds": list])
    }

    private func handle(_ message: LiveJSON) {
        switch LiveNet.string(message["t"]) {
        case "welcome":
            peerId = LiveNet.string(message["peer"])
            hostName = LiveNet.string(message["host"]) ?? "Game Master"
            onState?(.connected)
            startClockSync()
        case "no-room": fail("No session with that code. Check it with the broadcaster.")
        case "full": fail("That session is full.")
        case "ended", "bye", "kicked":
            closed = true
            pingTask?.cancel()
            onCommand?(.stopAll(ambienceToo: true))
            let kicked = LiveNet.string(message["t"]) == "kicked"
            onState?(.ended(kicked ? "The broadcaster removed you from the session." : "The broadcaster ended the session."))
            socket.close()
        case "pong": addClockSample(message)
        case "scene": onScene?(LiveNet.string(message["name"]))
        case "roll", "rollResult", "rolls", "customDice", "ask", "askClosed", "askResult":
            onRoll?(message)
        case "diceColors", "turns", "game":
            var tagged = message
            tagged["you"] = peerId ?? ""
            onRoll?(tagged)
        case "rules":
            onRules?(PlayerSounds(rawValue: LiveNet.string(message["playerSounds"]) ?? "") ?? .off)
        case "catalog":
            let items: [CatalogItem] = ((message["sounds"] as? [LiveJSON]) ?? []).compactMap { item in
                guard let id = LiveNet.string(item["id"]) else { return nil }
                return CatalogItem(id: id, name: LiveNet.string(item["name"]) ?? "Sound",
                                   colorIndex: Int(LiveNet.number(item["color"]) ?? 0))
            }
            onCatalog?(items)
        case "prefetch":
            for file in (message["files"] as? [LiveJSON]) ?? [] {
                fetcher.want(LiveNet.string(file["hash"]) ?? "", ext: LiveNet.string(file["ext"]) ?? "", urgent: false)
            }
        case "play": onPlay(message)
        case "stop":
            let group = LiveNet.string(message["group"]) ?? ""
            for (hash, plays) in pendingPlays { pendingPlays[hash] = plays.filter { LiveNet.string($0["group"]) != group } }
            onCommand?(.stop(group: group, fade: LiveNet.fadeSeconds(message["fade"])))
        case "volume":
            onCommand?(.volume(group: LiveNet.string(message["group"]) ?? "", volume: clamp01(LiveNet.number(message["volume"]))))
        case "stopAll":
            pendingPlays.removeAll()
            onCommand?(.stopAll(ambienceToo: false))
        case "ambience":
            ambienceLayers = (message["layers"] as? [LiveJSON]) ?? []
            for layer in ambienceLayers {
                if let hash = LiveNet.string(layer["hash"]) { fetcher.want(hash, ext: LiveNet.string(layer["ext"]) ?? "", urgent: true) }
            }
            emitAmbience(fade: LiveNet.fadeSeconds(message["fade"]))
        case "chunk": fetcher.handleChunk(message)
        case "missing": fetcher.handleMissing(LiveNet.string(message["hash"]) ?? "")
        case "need":
            // The host fetching one of this player's own sounds.
            let hash = LiveNet.string(message["hash"]) ?? ""
            let index = Int(LiveNet.number(message["i"]) ?? 0)
            if let url = offered[hash], let chunk = LiveFiles.chunk(of: url, hash: hash, index: index) {
                socket.send(chunk)
            } else {
                socket.send(["t": "missing", "hash": hash])
            }
        default: break
        }
    }

    private func fail(_ text: String) {
        closed = true
        pingTask?.cancel()
        onState?(.failed(text))
        socket.close()
    }

    // MARK: Clock

    private func startClockSync() {
        pingTask?.cancel()
        pingTask = Task { @MainActor [weak self] in
            var sent = 0
            while !Task.isCancelled {
                guard let self else { return }
                self.socket.send(["t": "ping", "id": UUID().uuidString, "t0": LiveNet.now])
                sent += 1
                // A quick burst for a good first estimate, then one every 15 s.
                let wait: UInt64 = sent < 7 ? 150_000_000 : 15_000_000_000
                try? await Task.sleep(nanoseconds: wait)
            }
        }
    }

    private func addClockSample(_ message: LiveJSON) {
        let t2 = LiveNet.now
        guard let t0 = LiveNet.number(message["t0"]), let t1 = LiveNet.number(message["t1"]) else { return }
        samples.append((rtt: t2 - t0, offset: t1 - (t0 + t2) / 2))
        if samples.count > 10 { samples.removeFirst() }
        // The round trip with the least delay gives the most accurate offset.
        if let best = samples.min(by: { $0.rtt < $1.rtt }) { offset = best.offset }
    }

    // MARK: Commands

    private func fileArrived(_ hash: String, _ url: URL) {
        let plays = pendingPlays.removeValue(forKey: hash) ?? []
        for play in plays { emitPlay(play, url: url) }
        if ambienceLayers.contains(where: { LiveNet.string($0["hash"]) == hash }) { emitAmbience() }
    }

    private func onPlay(_ message: LiveJSON) {
        // A built-in sound (a now-and-then ambience layer): nothing to fetch.
        if let builtin = LiveNet.string(message["builtin"]) {
            if LiveNet.isBuiltinName(builtin), let url = builtinURL(builtin) { emitPlay(message, url: url) }
            return
        }
        let hash = LiveNet.string(message["hash"]) ?? ""
        let ext = LiveNet.string(message["ext"]) ?? ""
        if let url = LiveFiles.cached(hash, ext) {
            emitPlay(message, url: url)
            return
        }
        guard LiveFiles.isHash(hash), LiveFiles.isExt(ext) else { return }
        pendingPlays[hash, default: []].append(message)
        fetcher.want(hash, ext: ext, urgent: true)
    }

    private func emitPlay(_ message: LiveJSON, url: URL) {
        let cat = LiveNet.string(message["cat"]) ?? "sfx"
        onCommand?(.play(MirrorPlay(
            pid: LiveNet.string(message["pid"]) ?? UUID().uuidString,
            group: LiveNet.string(message["group"]) ?? "",
            url: url,
            name: LiveNet.string(message["name"]) ?? "",
            // Host time → local time.
            at: Date(timeIntervalSince1970: ((LiveNet.number(message["at"]) ?? LiveNet.now) - offset) / 1000),
            volume: clamp01(LiveNet.number(message["volume"])),
            category: ["sfx", "music", "ambience"].contains(cat) ? cat : "sfx",
            loop: LiveNet.bool(message["loop"]),
            gap: max(0, LiveNet.number(message["gap"]) ?? 0),
            buzz: LiveNet.bool(message["buzz"]),
            whisper: LiveNet.bool(message["whisper"]),
            by: LiveNet.string(message["by"]),
            fadeIn: LiveNet.fadeSeconds(message["fadeIn"])
        )))
    }

    private func emitAmbience(fade: Double = 0) {
        var layers: [MirrorLayer] = []
        for layer in ambienceLayers {
            let key = LiveNet.string(layer["key"]) ?? UUID().uuidString
            let name = LiveNet.string(layer["name"]) ?? ""
            let volume = clamp01(LiveNet.number(layer["volume"]))
            if let builtin = LiveNet.string(layer["builtin"]) {
                if let url = builtinURL(builtin) { layers.append(MirrorLayer(key: key, url: url, name: name, volume: volume)) }
            } else if let url = LiveFiles.cached(LiveNet.string(layer["hash"]) ?? "", LiveNet.string(layer["ext"]) ?? "") {
                layers.append(MirrorLayer(key: key, url: url, name: name, volume: volume))
            }
        }
        onCommand?(.ambience(layers, fade: fade))
    }
}
