import CryptoKit
import Foundation

// The protocol logic of a Live Session, shared by both ways of connecting.
// LiveHostEngine answers listeners, serves files and forwards what the board
// plays. LiveListenerEngine syncs its clock to the host, fetches and caches
// files, and turns host commands into local ones for the MirrorPlayer.

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

private func isHash(_ text: String) -> Bool {
    text.count == 64 && text.allSatisfy { $0.isHexDigit && !$0.isUppercase }
}

private func isExt(_ text: String) -> Bool {
    (1...5).contains(text.count) && text.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) && !$0.isUppercase }
}

private func clamp01(_ value: Double?) -> Double {
    guard let value, value.isFinite else { return 1 }
    return min(1, max(0, value))
}

// MARK: - Host

@MainActor
final class LiveHostEngine {
    struct Peer: Identifiable, Equatable {
        let id: String
        var name: String
        var device: String
    }

    /// A play for the host to send. `to` makes it a whisper to one listener.
    struct PlayEvent {
        var pid: String
        var group: String
        var soundId: UUID
        var name: String
        var at: Double
        var volume: Double
        var cat: String
        var loop = false
        var gap: Double = 0
        var buzz = false
        var duration: Double = 0
        var to: String? = nil
    }

    let name: String
    let transport: LiveHostTransport
    /// A library sound's file, or nil if it's gone.
    var resolveSound: (UUID) -> URL? = { _ in nil }
    var onPeers: (([Peer]) -> Void)?

    private struct PeerInfo {
        var name = "Listener"
        var device = ""
        var ready = false
        var allowed: Set<String> = []
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
            self?.peers[peer] = nil
            self?.emitPeers()
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
            sendChunk(to: peer, hash: LiveNet.string(message["hash"]) ?? "", index: Int(LiveNet.number(message["i"]) ?? 0))
        default:
            break
        }
    }

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

    private func sendChunk(to peer: String, hash: String, index: Int) {
        guard isHash(hash), peers[peer]?.allowed.contains(hash) == true, let url = files[hash],
              let handle = try? FileHandle(forReadingFrom: url) else {
            transport.send(["t": "missing", "hash": hash], to: peer)
            return
        }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()) ?? 0
        let total = max(1, Int((size + UInt64(LiveNet.chunkSize) - 1) / UInt64(LiveNet.chunkSize)))
        guard index >= 0, index < total else { return }
        try? handle.seek(toOffset: UInt64(index * LiveNet.chunkSize))
        let data = (try? handle.read(upToCount: LiveNet.chunkSize)) ?? Data()
        transport.send([
            "t": "chunk", "hash": hash, "i": index, "n": total,
            "ext": url.pathExtension.lowercased(), "data": data.base64EncodedString(),
        ], to: peer)
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
            guard let self, let file = await self.file(for: event.soundId) else { return }
            var message: LiveJSON = [
                "t": "play", "pid": event.pid, "group": event.group, "hash": file.hash, "ext": file.ext,
                "name": event.name, "at": event.at, "volume": clamp01(event.volume), "cat": event.cat,
                "loop": event.loop, "buzz": event.buzz, "whisper": event.to != nil,
            ]
            if event.gap > 0 { message["gap"] = event.gap }
            if let peer = event.to {
                if self.peers[peer] != nil { self.send(message, to: peer) }
                return
            }
            let endless = event.loop || event.gap > 0 || event.duration <= 0
            self.active[event.pid] = ActivePlay(message: message, group: event.group,
                                                until: endless ? .infinity : event.at + event.duration * 1000 + 1000)
            self.broadcast(message)
        }
    }

    func stop(group: String) {
        enqueue { [weak self] in
            guard let self else { return }
            self.active = self.active.filter { $0.value.group != group }
            self.broadcast(["t": "stop", "group": group])
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
    func setAmbience(_ layers: [AmbienceLayer], names: [String: String]) {
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
            self.broadcast(self.ambience)
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

    func end() {
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
        case stop(group: String)
        case volume(group: String, volume: Double)
        case stopAll(ambienceToo: Bool)
        case ambience([MirrorLayer])
    }

    var onState: ((State) -> Void)?
    var onCommand: ((Command) -> Void)?
    var onScene: ((String?) -> Void)?
    private(set) var hostName: String?
    /// Resolves a built-in loop's file name to its URL.
    var builtinURL: (String) -> URL? = { _ in nil }

    private let socket: LiveSocket
    private let name: String
    private let device: String
    private let cacheDir: URL
    /// Host clock − local clock, in ms.
    private var offset: Double = 0
    private var samples: [(rtt: Double, offset: Double)] = []
    private var pingTask: Task<Void, Never>?
    private var closed = false

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
    private var pendingPlays: [String: [LiveJSON]] = [:]
    private var ambienceLayers: [LiveJSON] = []

    init(socket: LiveSocket, name: String, device: String) {
        self.socket = socket
        self.name = name
        self.device = device
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        cacheDir = caches.appendingPathComponent("LiveCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
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

    private func handle(_ message: LiveJSON) {
        switch LiveNet.string(message["t"]) {
        case "welcome":
            hostName = LiveNet.string(message["host"]) ?? "Game Master"
            onState?(.connected)
            startClockSync()
        case "no-room": fail("No session with that code. Check it with your GM.")
        case "full": fail("That session is full.")
        case "ended", "bye":
            closed = true
            pingTask?.cancel()
            onCommand?(.stopAll(ambienceToo: true))
            onState?(.ended("The GM ended the session."))
            socket.close()
        case "pong": addClockSample(message)
        case "scene": onScene?(LiveNet.string(message["name"]))
        case "prefetch":
            for file in (message["files"] as? [LiveJSON]) ?? [] {
                want(LiveNet.string(file["hash"]) ?? "", ext: LiveNet.string(file["ext"]) ?? "", urgent: false)
            }
        case "play": onPlay(message)
        case "stop":
            let group = LiveNet.string(message["group"]) ?? ""
            for (hash, plays) in pendingPlays { pendingPlays[hash] = plays.filter { LiveNet.string($0["group"]) != group } }
            onCommand?(.stop(group: group))
        case "volume":
            onCommand?(.volume(group: LiveNet.string(message["group"]) ?? "", volume: clamp01(LiveNet.number(message["volume"]))))
        case "stopAll":
            pendingPlays.removeAll()
            onCommand?(.stopAll(ambienceToo: false))
        case "ambience":
            ambienceLayers = (message["layers"] as? [LiveJSON]) ?? []
            for layer in ambienceLayers {
                if let hash = LiveNet.string(layer["hash"]) { want(hash, ext: LiveNet.string(layer["ext"]) ?? "", urgent: true) }
            }
            emitAmbience()
        case "chunk": onChunk(message)
        case "missing": dropJob(LiveNet.string(message["hash"]) ?? "")
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

    // MARK: Files

    private func cacheURL(_ hash: String, _ ext: String) -> URL {
        cacheDir.appendingPathComponent("\(hash).\(ext)")
    }

    private func cached(_ hash: String, _ ext: String) -> URL? {
        guard isHash(hash), isExt(ext) else { return nil }
        let url = cacheURL(hash, ext)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private func want(_ hash: String, ext: String, urgent: Bool) {
        guard isHash(hash), isExt(ext), cached(hash, ext) == nil else { return }
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
            socket.send(["t": "need", "hash": hash, "i": job.next])
            job.next += 1
            job.inFlight += 1
        }
        jobs[hash] = job
    }

    private func onChunk(_ message: LiveJSON) {
        guard let hash = LiveNet.string(message["hash"]), var job = jobs[hash],
              let index = LiveNet.number(message["i"]).map({ Int($0) }), let total = LiveNet.number(message["n"]).map({ Int($0) }),
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
            let url = cacheURL(hash, job.ext)
            try? bytes.write(to: url, options: .atomic)
            fileArrived(hash, url)
        } else {
            pendingPlays[hash] = nil
        }
        pump()
    }

    private func dropJob(_ hash: String) {
        jobs[hash] = nil
        queue.removeAll { $0 == hash }
        pendingPlays[hash] = nil
        pump()
    }

    private func fileArrived(_ hash: String, _ url: URL) {
        let plays = pendingPlays.removeValue(forKey: hash) ?? []
        for play in plays { emitPlay(play, url: url) }
        if ambienceLayers.contains(where: { LiveNet.string($0["hash"]) == hash }) { emitAmbience() }
    }

    // MARK: Commands

    private func onPlay(_ message: LiveJSON) {
        let hash = LiveNet.string(message["hash"]) ?? ""
        let ext = LiveNet.string(message["ext"]) ?? ""
        if let url = cached(hash, ext) {
            emitPlay(message, url: url)
            return
        }
        guard isHash(hash), isExt(ext) else { return }
        pendingPlays[hash, default: []].append(message)
        want(hash, ext: ext, urgent: true)
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
            whisper: LiveNet.bool(message["whisper"])
        )))
    }

    private func emitAmbience() {
        var layers: [MirrorLayer] = []
        for layer in ambienceLayers {
            let key = LiveNet.string(layer["key"]) ?? UUID().uuidString
            let name = LiveNet.string(layer["name"]) ?? ""
            let volume = clamp01(LiveNet.number(layer["volume"]))
            if let builtin = LiveNet.string(layer["builtin"]) {
                if let url = builtinURL(builtin) { layers.append(MirrorLayer(key: key, url: url, name: name, volume: volume)) }
            } else if let url = cached(LiveNet.string(layer["hash"]) ?? "", LiveNet.string(layer["ext"]) ?? "") {
                layers.append(MirrorLayer(key: key, url: url, name: name, volume: volume))
            }
        }
        onCommand?(.ambience(layers))
    }

    /// Deletes cached files not used for a month.
    static func pruneCache() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = caches.appendingPathComponent("LiveCache", isDirectory: true)
        let cutoff = Date().addingTimeInterval(-30 * 86400)
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentAccessDateKey])) ?? []
        for file in files {
            let used = (try? file.resourceValues(forKeys: [.contentAccessDateKey]).contentAccessDate) ?? Date()
            if used < cutoff { try? FileManager.default.removeItem(at: file) }
        }
    }
}
