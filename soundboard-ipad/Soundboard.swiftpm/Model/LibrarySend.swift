import Foundation
import UIKit

/// Sending a whole library online with a code, through the Live Session
/// relay. The sender opens a room like a broadcaster and gets a 5-character
/// code; whoever types it joins and pulls the library file (the same zip as
/// Share your library, LibraryShare.swift) in 256 KB pieces, then imports it.
/// Nothing is stored on the relay, so both apps stay open until it's there.
/// The Mac and Android speak the same messages in
/// soundboard-mac/src/library-send.js; keep the two in step.
enum LibrarySend {
    static let chunk = 256 * 1024
    static let version = 1
    /// Pieces asked for at once.
    static let window = 4

    static var deviceName: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone" }

    static func relayURL(role: String, code: String? = nil) -> URL? {
        guard let base = LiveNet.relayURL(LiveNet.defaultRelay),
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        components.queryItems = [URLQueryItem(name: "role", value: role)] + (code.map { [URLQueryItem(name: "code", value: $0)] } ?? [])
        return components.url
    }

    static func clean(_ value: Any?, _ max: Int = 40) -> String {
        let text = (value as? String) ?? ""
        let scalars = text.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f }
        return String(String(String.UnicodeScalarView(scalars)).trimmingCharacters(in: .whitespaces).prefix(max))
    }
}

/// Sends this library to everyone who comes with the code, until stopped.
@MainActor
final class LibrarySender: ObservableObject {
    static let shared = LibrarySender()

    struct Receiver: Identifiable, Equatable {
        let id: String
        var name: String
        var got = 0
        let n: Int
        var done = false
        var message: String?
        var failed: String?
        var left = false
    }

    @Published private(set) var active = false
    @Published private(set) var code: String?
    @Published private(set) var receivers: [Receiver] = []
    @Published private(set) var status: String?
    @Published private(set) var failed = false

    private var socket: URLSocket?
    private var file: FileHandle?
    private var folder: URL?
    private var size = 0
    private var pieces = 0
    private var summary = (sounds: 0, bashes: 0, kits: 0)

    func start(store: SoundStore, bashes: BashStore, kits: KitStore) {
        stop()
        active = true
        failed = false
        status = "Packing your library…"
        Task {
            do {
                let exported = try await LibraryShare.export(store: store, bashes: bashes, kits: kits)
                guard active else { return }
                guard exported.sounds + exported.bashes + exported.kits > 0 else {
                    fail("Your library is empty. Add some sounds first.")
                    return
                }
                // Its own copy, so an Export meanwhile doesn't replace it.
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Send-\(UUID().uuidString)", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let url = folder.appendingPathComponent("library.zip")
                try FileManager.default.copyItem(at: exported.url, to: url)
                self.folder = folder
                file = try FileHandle(forReadingFrom: url)
                size = exported.bytes
                pieces = (size + LibrarySend.chunk - 1) / LibrarySend.chunk
                summary = (exported.sounds, exported.bashes, exported.kits)
                guard size > 0, size < Int(UInt32.max), let relay = LibrarySend.relayURL(role: "host") else {
                    fail("The library is too big to send (over 4 GB).")
                    return
                }
                let socket = URLSocket(url: relay)
                socket.onMessage = { [weak self] message in self?.handle(message) }
                socket.onClose = { [weak self] _ in
                    guard let self, self.active else { return }
                    self.fail("Lost the connection to the relay. Send again to get a new code.")
                }
                self.socket = socket
                status = "Getting a code…"
                socket.start()
            } catch {
                fail(error.localizedDescription)
            }
        }
    }

    /// Tells anyone mid-way, closes the room and forgets the file.
    func stop() {
        if let socket {
            socket.send(["t": "send", "msg": ["t": "lib-stopped"]])
            socket.send(["t": "end"])
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 300_000_000)
                socket.close()
            }
        }
        socket = nil
        try? file?.close()
        file = nil
        if let folder { try? FileManager.default.removeItem(at: folder) }
        folder = nil
        active = false
        code = nil
        receivers = []
        status = nil
        failed = false
    }

    private func fail(_ text: String) {
        let message = text
        stop()
        status = message
        failed = true
    }

    private func handle(_ m: LiveJSON) {
        switch m["t"] as? String {
        case "room":
            code = m["code"] as? String
            let size = ByteCountFormatter.string(fromByteCount: Int64(self.size), countStyle: .file)
            status = "Give this code to whoever should get your library (\(summary.sounds) sound\(summary.sounds == 1 ? "" : "s"), \(size)). They choose Receive in Options. Keep this open until they have it."
        case "busy":
            fail("The relay is busy right now. Try again in a minute.")
        case "leave":
            if let peer = m["peer"] as? String, let i = receivers.firstIndex(where: { $0.id == peer }), !receivers[i].done {
                receivers[i].left = true
            }
        case "msg":
            guard let peer = m["peer"] as? String, let msg = m["msg"] as? LiveJSON else { return }
            message(msg, from: peer)
        default:
            break
        }
    }

    private func message(_ msg: LiveJSON, from peer: String) {
        let index = receivers.firstIndex { $0.id == peer }
        switch msg["t"] as? String {
        case "lib-hello":
            let name = LibrarySend.clean(msg["name"])
            receivers.removeAll { $0.id == peer }
            receivers.append(Receiver(id: peer, name: name.isEmpty ? "Someone" : name, n: pieces))
            send(to: peer, [
                "t": "lib-offer", "v": LibrarySend.version, "name": LibrarySend.deviceName, "bytes": size, "n": pieces,
                "chunk": LibrarySend.chunk, "sounds": summary.sounds, "bashes": summary.bashes, "kits": summary.kits,
            ])
        case "lib-need":
            guard let index, let i = (msg["i"] as? NSNumber)?.intValue, i >= 0, i < pieces, let file else { return }
            do {
                try file.seek(toOffset: UInt64(i * LibrarySend.chunk))
                let data = try file.read(upToCount: min(LibrarySend.chunk, size - i * LibrarySend.chunk)) ?? Data()
                send(to: peer, ["t": "lib-chunk", "i": i, "data": data.base64EncodedString()])
                receivers[index].got = max(receivers[index].got, i + 1)
            } catch {
                send(to: peer, ["t": "lib-error", "error": "The sender couldn’t read the library file."])
            }
        case "lib-done":
            guard let index else { return }
            receivers[index].done = true
            receivers[index].got = pieces
            receivers[index].message = LibrarySend.clean(msg["message"], 200)
        case "lib-fail":
            guard let index else { return }
            let error = LibrarySend.clean(msg["error"], 200)
            receivers[index].failed = error.isEmpty ? "It didn’t work." : error
        default:
            break // a Live Session listener with the wrong code, or something newer
        }
    }

    private func send(to peer: String, _ message: LiveJSON) {
        socket?.send(["t": "send", "to": peer, "msg": message])
    }
}

/// Receives a library with a code and adds it to this library.
@MainActor
final class LibraryReceiver: ObservableObject {
    static let shared = LibraryReceiver()

    enum Phase { case idle, connecting, receiving, importing, done, error }

    struct Offer {
        let name: String
        let bytes: Int
        let n: Int
        let sounds: Int
        let bashes: Int
        let kits: Int
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var offer: Offer?
    @Published private(set) var progress = 0.0
    @Published private(set) var message: String?

    private var socket: URLSocket?
    private var out: FileHandle?
    private var fileURL: URL?
    private var next = 0
    private var written = 0
    private var inFlight = 0
    private var waiting: [Int: Data] = [:]
    private var timer: Task<Void, Never>?
    private var stores: (SoundStore, BashStore, KitStore)?

    var busy: Bool { phase == .connecting || phase == .receiving || phase == .importing }

    func start(code: String, store: SoundStore, bashes: BashStore, kits: KitStore) {
        cancel()
        let clean = String(code.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }.prefix(8))
        guard clean.count >= 4 else {
            fail("Enter the code from whoever is sending.")
            return
        }
        guard let url = LibrarySend.relayURL(role: "listen", code: clean) else {
            fail("That relay server address isn't valid.")
            return
        }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("receive-\(UUID().uuidString).zip")
        FileManager.default.createFile(atPath: file.path, contents: nil)
        fileURL = file
        out = try? FileHandle(forWritingTo: file)
        stores = (store, bashes, kits)
        phase = .connecting
        offer = nil
        progress = 0
        message = nil
        let socket = URLSocket(url: url)
        socket.onMessage = { [weak self] message in self?.handle(message) }
        socket.onClose = { [weak self] _ in
            guard let self, self.busy else { return }
            self.fail("Lost the connection to the relay.")
        }
        self.socket = socket
        socket.start()
        socket.send(["t": "lib-hello", "v": LibrarySend.version, "name": LibrarySend.deviceName])
        timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            guard let self, self.phase == .connecting else { return }
            self.fail("Nothing is being sent with that code. Check it and try again.")
        }
    }

    func cancel() {
        timer?.cancel()
        timer = nil
        socket?.close()
        socket = nil
        try? out?.close()
        out = nil
        if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
        fileURL = nil
        waiting = [:]
        next = 0
        written = 0
        inFlight = 0
        phase = .idle
    }

    private func fail(_ text: String) {
        let offer = self.offer
        cancel()
        self.offer = offer
        message = text
        phase = .error
    }

    private func handle(_ m: LiveJSON) {
        guard busy else { return }
        switch m["t"] as? String {
        case "no-room": fail("Nothing is being sent with that code. Check it and try again.")
        case "full": fail("Too many people are receiving this right now. Try again in a minute.")
        case "ended", "lib-stopped": fail("The sender stopped before everything arrived.")
        case "lib-error":
            let error = LibrarySend.clean(m["error"], 200)
            fail(error.isEmpty ? "The sender couldn’t send the library." : error)
        case "lib-offer":
            guard offer == nil else { return }
            let bytes = (m["bytes"] as? NSNumber)?.intValue ?? 0
            let n = (m["n"] as? NSNumber)?.intValue ?? 0
            guard bytes > 0, bytes < Int(UInt32.max), (m["chunk"] as? NSNumber)?.intValue == LibrarySend.chunk,
                  n == (bytes + LibrarySend.chunk - 1) / LibrarySend.chunk else {
                fail("That code isn’t a library from a version of Dungeon Radio this one can read.")
                return
            }
            timer?.cancel()
            let name = LibrarySend.clean(m["name"])
            offer = Offer(name: name.isEmpty ? "Someone" : name, bytes: bytes, n: n,
                          sounds: (m["sounds"] as? NSNumber)?.intValue ?? 0, bashes: (m["bashes"] as? NSNumber)?.intValue ?? 0,
                          kits: (m["kits"] as? NSNumber)?.intValue ?? 0)
            phase = .receiving
            pump()
        case "lib-chunk":
            guard let offer, let i = (m["i"] as? NSNumber)?.intValue, i >= written, i < offer.n, waiting[i] == nil,
                  let text = m["data"] as? String else { return }
            guard let data = Data(base64Encoded: text), data.count <= LibrarySend.chunk else {
                fail("The library arrived damaged.")
                return
            }
            inFlight -= 1
            waiting[i] = data
            while let piece = waiting.removeValue(forKey: written) {
                do { try out?.write(contentsOf: piece) } catch {
                    fail("Couldn’t save the library.")
                    return
                }
                written += 1
            }
            progress = Double(written) / Double(offer.n)
            if written == offer.n { finish(offer) } else { pump() }
        default:
            break
        }
    }

    private func pump() {
        guard let offer else { return }
        while inFlight < LibrarySend.window && next < offer.n {
            socket?.send(["t": "lib-need", "i": next])
            next += 1
            inFlight += 1
        }
    }

    private func finish(_ offer: Offer) {
        phase = .importing
        try? out?.close()
        out = nil
        Task {
            // Lets "Adding…" show before the work starts.
            await Task.yield()
            guard let fileURL, let stores else { return }
            let (store, bashes, kits) = stores
            let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? -1
            do {
                guard size == offer.bytes else { throw LibraryShare.ShareError.damaged }
                let result = try LibraryShare.importLibrary(from: fileURL, store: store, bashes: bashes, kits: kits)
                socket?.send(["t": "lib-done", "message": result.message])
                let socket = self.socket
                self.socket = nil
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    socket?.close()
                }
                try? FileManager.default.removeItem(at: fileURL)
                self.fileURL = nil
                message = result.message
                phase = .done
            } catch {
                socket?.send(["t": "lib-fail", "error": error.localizedDescription])
                fail(error.localizedDescription)
            }
        }
    }
}
