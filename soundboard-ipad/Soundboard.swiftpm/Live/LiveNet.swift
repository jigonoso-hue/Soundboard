import Foundation
import Network

// Networking for Live Sessions (see live-relay/PROTOCOL.md): JSON messages
// over WebSockets, either directly on the local network (the host runs a
// server advertised with Bonjour) or through a relay server online.

typealias LiveJSON = [String: Any]

enum LiveNet {
    static let serviceType = "_dungeonradio._tcp"
    static let version = 1
    static let chunkSize = 256 * 1024
    static let maxMessage = 1024 * 1024
    /// The relay built into the app, used unless someone sets their own under Advanced.
    static let defaultRelay = "soundboard-r1zt.onrender.com"

    static func encode(_ message: LiveJSON) -> Data? {
        guard JSONSerialization.isValidJSONObject(message) else { return nil }
        return try? JSONSerialization.data(withJSONObject: message)
    }

    static func decode(_ data: Data) -> LiveJSON? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? LiveJSON,
              object["t"] is String else { return nil }
        return object
    }

    /// Milliseconds since 1970, the clock used in messages.
    static var now: Double { Date().timeIntervalSince1970 * 1000 }

    /// TCP + WebSocket parameters for the local server and local connections.
    static func webSocketParameters() -> NWParameters {
        let parameters = NWParameters.tcp
        let options = NWProtocolWebSocket.Options()
        options.autoReplyPing = true
        options.maximumMessageSize = maxMessage * 2
        parameters.defaultProtocolStack.applicationProtocols.insert(options, at: 0)
        return parameters
    }

    /// Turns what the user typed ("relay.example.com", "https://…") into the relay's WebSocket URL.
    static func relayURL(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        guard !text.isEmpty else { return nil }
        if text.lowercased().hasPrefix("https://") { text = "wss://" + text.dropFirst(8) }
        else if text.lowercased().hasPrefix("http://") { text = "ws://" + text.dropFirst(7) }
        else if !text.lowercased().hasPrefix("ws://") && !text.lowercased().hasPrefix("wss://") { text = "wss://" + text }
        if !text.hasSuffix("/live") { text += "/live" }
        return URL(string: text)
    }

    static func string(_ value: Any?) -> String? { value as? String }

    static func number(_ value: Any?) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        return nil
    }

    static func bool(_ value: Any?) -> Bool { (value as? NSNumber)?.boolValue ?? false }
}

// MARK: - Sockets

/// A WebSocket carrying JSON messages.
@MainActor
protocol LiveSocket: AnyObject {
    var onMessage: ((LiveJSON) -> Void)? { get set }
    var onOpen: (() -> Void)? { get set }
    var onClose: ((String?) -> Void)? { get set }
    func start()
    func send(_ message: LiveJSON)
    func close()
}

/// A WebSocket over Network.framework: connections accepted by the local
/// server, and connections to a session on the local network.
@MainActor
final class NWSocket: LiveSocket {
    let connection: NWConnection
    var onMessage: ((LiveJSON) -> Void)?
    var onOpen: (() -> Void)?
    var onClose: ((String?) -> Void)?
    private var finished = false

    init(connection: NWConnection) {
        self.connection = connection
    }

    convenience init(url: URL) {
        self.init(connection: NWConnection(to: .url(url), using: LiveNet.webSocketParameters()))
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.handle(state) }
            }
        }
        connection.start(queue: .main)
        receive()
    }

    private func handle(_ state: NWConnection.State) {
        switch state {
        case .ready: onOpen?()
        case .failed(let error): finish(error.localizedDescription)
        case .waiting(let error): finish(error.localizedDescription)
        case .cancelled: finish(nil)
        default: break
        }
    }

    private func receive() {
        connection.receiveMessage { [weak self] data, context, _, error in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, !self.finished else { return }
                    let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
                    if metadata?.opcode == .close {
                        self.finish(nil)
                        return
                    }
                    if let data, !data.isEmpty, metadata?.opcode == .text, let message = LiveNet.decode(data) {
                        self.onMessage?(message)
                    }
                    if let error {
                        self.finish(error.localizedDescription)
                        return
                    }
                    if data == nil && context?.isFinal == true {
                        self.finish(nil)
                        return
                    }
                    self.receive()
                }
            }
        }
    }

    func send(_ message: LiveJSON) {
        guard !finished, let data = LiveNet.encode(message) else { return }
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
        connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
    }

    func close() {
        finished = true
        connection.cancel()
    }

    private func finish(_ reason: String?) {
        guard !finished else { return }
        finished = true
        connection.cancel()
        onClose?(reason)
    }
}

/// A WebSocket over URLSession, for the relay server (wss://).
@MainActor
final class URLSocket: LiveSocket {
    private let task: URLSessionWebSocketTask
    var onMessage: ((LiveJSON) -> Void)?
    var onOpen: (() -> Void)?
    var onClose: ((String?) -> Void)?
    private var finished = false

    init(url: URL) {
        task = URLSession.shared.webSocketTask(with: url)
        task.maximumMessageSize = LiveNet.maxMessage * 2
    }

    func start() {
        task.resume()
        receive()
        // Messages sent before the handshake finishes are queued by URLSession.
        onOpen?()
    }

    private func receive() {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, !self.finished else { return }
                    switch result {
                    case .success(.string(let text)):
                        if let data = text.data(using: .utf8), let message = LiveNet.decode(data) { self.onMessage?(message) }
                        self.receive()
                    case .success:
                        self.receive()
                    case .failure(let error):
                        self.finish(error.localizedDescription)
                    }
                }
            }
        }
    }

    func send(_ message: LiveJSON) {
        guard !finished, let data = LiveNet.encode(message), let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    func close() {
        finished = true
        task.cancel(with: .normalClosure, reason: nil)
    }

    private func finish(_ reason: String?) {
        guard !finished else { return }
        finished = true
        task.cancel()
        onClose?(reason)
    }
}

// MARK: - Host transports

/// How the host reaches its listeners: directly (local network) or through the relay.
@MainActor
protocol LiveHostTransport: AnyObject {
    var onJoin: ((String) -> Void)? { get set }
    var onLeave: ((String) -> Void)? { get set }
    var onMessage: ((String, LiveJSON) -> Void)? { get set }
    /// To one listener, or to every listener when `peer` is nil.
    func send(_ message: LiveJSON, to peer: String?)
    /// Disconnects a listener (after the `kicked` message has gone out).
    func kick(_ peer: String)
    func close()
}

/// A WebSocket server on the local network, advertised with Bonjour.
@MainActor
final class LanServer: LiveHostTransport {
    var onJoin: ((String) -> Void)?
    var onLeave: ((String) -> Void)?
    var onMessage: ((String, LiveJSON) -> Void)?
    var onFailed: ((String) -> Void)?
    private var listener: NWListener?
    private var sockets: [String: NWSocket] = [:]
    private var nextPeer = 1

    func start(name: String) throws {
        let listener = try NWListener(using: LiveNet.webSocketParameters(), on: .any)
        // Bonjour names must be unique on the network, so add a short tag.
        let tag = String(UUID().uuidString.prefix(4)).lowercased()
        let txt = NWTXTRecord(["name": String(name.prefix(60)), "v": String(LiveNet.version)])
        listener.service = NWListener.Service(name: "\(name.prefix(50)) (\(tag))", type: LiveNet.serviceType, domain: nil, txtRecord: txt)
        listener.newConnectionHandler = { [weak self] connection in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.accept(connection) }
            }
        }
        listener.stateUpdateHandler = { [weak self] state in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    if case .failed(let error) = state { self?.onFailed?(error.localizedDescription) }
                }
            }
        }
        listener.start(queue: .main)
        self.listener = listener
    }

    private func accept(_ connection: NWConnection) {
        let peer = "l\(nextPeer)"
        nextPeer += 1
        let socket = NWSocket(connection: connection)
        sockets[peer] = socket
        socket.onMessage = { [weak self] message in self?.onMessage?(peer, message) }
        socket.onClose = { [weak self] _ in
            guard let self, self.sockets[peer] != nil else { return }
            self.sockets[peer] = nil
            self.onLeave?(peer)
        }
        socket.start()
        onJoin?(peer)
    }

    func send(_ message: LiveJSON, to peer: String?) {
        if let peer {
            sockets[peer]?.send(message)
        } else {
            for socket in sockets.values { socket.send(message) }
        }
    }

    func kick(_ peer: String) {
        guard let socket = sockets[peer] else { return }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 100_000_000)
            socket.close()
        }
    }

    func close() {
        for socket in sockets.values { socket.close() }
        sockets.removeAll()
        listener?.cancel()
        listener = nil
    }
}

/// The host's connection to the relay server, which gives it a room code.
/// It reconnects and resumes the room after a dropped connection.
@MainActor
final class RelayHost: LiveHostTransport {
    var onJoin: ((String) -> Void)?
    var onLeave: ((String) -> Void)?
    var onMessage: ((String, LiveJSON) -> Void)?
    var onCode: ((String) -> Void)?
    var onReconnecting: (() -> Void)?
    var onFailed: ((String) -> Void)?
    private(set) var code: String?
    private var key: String?
    private let base: URL
    private var socket: URLSocket?
    private var peers: Set<String> = []
    private var retries = 0
    private var closed = false

    init(base: URL) {
        self.base = base
    }

    func start() {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        var query = [URLQueryItem(name: "role", value: "host")]
        if let code, let key {
            query.append(URLQueryItem(name: "code", value: code))
            query.append(URLQueryItem(name: "key", value: key))
        }
        components?.queryItems = query
        guard let url = components?.url else {
            onFailed?("That relay server address isn't valid.")
            return
        }
        let socket = URLSocket(url: url)
        self.socket = socket
        socket.onMessage = { [weak self] message in self?.handle(message) }
        socket.onClose = { [weak self] reason in
            guard let self, self.socket === socket, !self.closed else { return }
            if self.code == nil {
                self.closed = true
                self.onFailed?("Couldn't reach the relay server\(reason.map { " (\($0))" } ?? "").")
                return
            }
            // Listeners stay in the room for a minute; reconnect and resume it.
            for peer in self.peers { self.onLeave?(peer) }
            self.peers.removeAll()
            self.retries += 1
            if self.retries > 8 {
                self.closed = true
                self.onFailed?("Lost the connection to the relay server.")
                return
            }
            self.onReconnecting?()
            let delay = min(8.0, 0.5 * pow(2, Double(self.retries)))
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                guard let self, !self.closed else { return }
                self.start()
            }
        }
        socket.start()
    }

    private func handle(_ message: LiveJSON) {
        switch LiveNet.string(message["t"]) {
        case "room":
            code = LiveNet.string(message["code"])
            key = LiveNet.string(message["key"])
            retries = 0
            if let code { onCode?(code) }
        case "join":
            if let peer = LiveNet.string(message["peer"]) {
                peers.insert(peer)
                onJoin?(peer)
            }
        case "leave":
            if let peer = LiveNet.string(message["peer"]) {
                peers.remove(peer)
                onLeave?(peer)
            }
        case "msg":
            if let peer = LiveNet.string(message["peer"]), let inner = message["msg"] as? LiveJSON, inner["t"] is String {
                onMessage?(peer, inner)
            }
        case "no-room", "busy":
            closed = true
            socket?.close()
            onFailed?(LiveNet.string(message["t"]) == "busy" ? "The relay server is full right now." : "The session expired on the relay server.")
        default:
            break
        }
    }

    func send(_ message: LiveJSON, to peer: String?) {
        var envelope: LiveJSON = ["t": "send", "msg": message]
        if let peer { envelope["to"] = peer }
        socket?.send(envelope)
    }

    /// The relay tells the listener and disconnects it.
    func kick(_ peer: String) {
        socket?.send(["t": "kick", "peer": peer])
    }

    func close() {
        closed = true
        socket?.close()
    }
}

// MARK: - Finding sessions on the local network

struct FoundSession: Identifiable, Equatable {
    let id: String
    let name: String
    let endpoint: NWEndpoint
}

@MainActor
final class LanBrowser {
    var onChange: (([FoundSession]) -> Void)?
    private var browser: NWBrowser?

    func start() {
        stop()
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: LiveNet.serviceType, domain: nil), using: .tcp)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            let sessions: [FoundSession] = results.compactMap { result in
                guard case .service(let name, _, _, _) = result.endpoint else { return nil }
                var title = name
                if case .bonjour(let txt) = result.metadata, let shown = txt["name"], !shown.isEmpty { title = shown }
                return FoundSession(id: name, name: title, endpoint: result.endpoint)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.onChange?(sessions) }
            }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }

    /// Looks up a found session's address and returns it as a ws:// URL.
    static func resolve(_ endpoint: NWEndpoint, completion: @escaping @MainActor (URL?) -> Void) {
        EndpointResolver(endpoint: endpoint, completion: completion).start()
    }
}

/// Connects to a Bonjour service just long enough to learn its IPv4 address and
/// port. Everything runs on the main queue; the network callbacks aren't
/// main-actor code, so this class stays outside the main actor.
private final class EndpointResolver: @unchecked Sendable {
    private let connection: NWConnection
    private let completion: @MainActor (URL?) -> Void
    private var done = false

    init(endpoint: NWEndpoint, completion: @escaping @MainActor (URL?) -> Void) {
        let parameters = NWParameters.tcp
        if let ip = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ip.version = .v4
        }
        connection = NWConnection(to: endpoint, using: parameters)
        self.completion = completion
    }

    func start() {
        connection.stateUpdateHandler = { [self] state in
            switch state {
            case .ready:
                if case .hostPort(let host, let port)? = connection.currentPath?.remoteEndpoint {
                    var address = "\(host)"
                    if let percent = address.firstIndex(of: "%") { address = String(address[..<percent]) }
                    if address.contains(":") { address = "[\(address)]" }
                    finish(URL(string: "ws://\(address):\(port.rawValue)/"))
                } else {
                    finish(nil)
                }
            case .failed, .waiting, .cancelled:
                finish(nil)
            default:
                break
            }
        }
        connection.start(queue: .main)
        // Don't wait forever on a session that has gone away.
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [self] in finish(nil) }
    }

    /// Reports once, then closes the lookup connection (it keeps itself alive until then).
    private func finish(_ url: URL?) {
        guard !done else { return }
        done = true
        connection.stateUpdateHandler = nil
        connection.cancel()
        let completion = completion
        DispatchQueue.main.async {
            MainActor.assumeIsolated { completion(url) }
        }
    }
}
