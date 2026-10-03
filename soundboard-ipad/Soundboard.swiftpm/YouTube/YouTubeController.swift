import Foundation
import UIKit
import WebKit

/// Owns the embedded YouTube web view and talks to the injected capture script.
@MainActor
final class YouTubeController: ObservableObject {
    enum CaptureState: Equatable {
        case idle
        /// Progress 0...1 and what is happening.
        case recording(Double, String)
        case done(String)
        case failed(String)
    }

    static let home = URL(string: "https://www.youtube.com/")!
    static let maxClipSeconds = 120.0
    static let maxFullSeconds = 3 * 60 * 60.0

    @Published private(set) var hasVideo = false
    @Published private(set) var currentTime: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var adShowing = false
    @Published private(set) var title = ""
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    @Published private(set) var capture: CaptureState = .idle

    /// Called with the finished .m4a file, the sound's name and where it came from.
    var onCaptured: ((URL, String, SoundSource) throws -> Void)?

    let webView: WKWebView
    private var writer: CaptureWriter?
    private var pendingName = ""
    private var pendingFull = false
    private var label = ""

    var isRecording: Bool {
        if case .recording = capture { return true }
        return false
    }

    init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Without a Safari token YouTube serves a reduced page.
        config.applicationNameForUserAgent = "Version/17.0 Safari/605.1.15"
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: CaptureScript.source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = content

        webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        content.add(MessageBridge(self), name: "soundboard")
    }

    // MARK: Navigation

    func goHome() { webView.load(URLRequest(url: Self.home)) }
    func goBack() { webView.goBack() }
    func goForward() { webView.goForward() }

    func search(_ text: String) {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        let isLink = query.range(
            of: #"^(https?://)?((www|m|music)\.)?(youtube\.com|youtu\.be)/"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
        let url: URL?
        if isLink {
            url = URL(string: query.lowercased().hasPrefix("http") ? query : "https://\(query)")
        } else {
            var components = URLComponents(string: "https://www.youtube.com/results")!
            components.queryItems = [URLQueryItem(name: "search_query", value: query)]
            url = components.url
        }
        if let url { webView.load(URLRequest(url: url)) }
    }

    // MARK: Playback state

    /// Polls the page for the player's state while the panel is visible.
    func pollLoop() async {
        // YouTube loads the first time the panel is shown.
        if webView.url == nil { goHome() }
        while !Task.isCancelled {
            await poll()
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    private func poll() async {
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        guard !isRecording else { return }
        guard let json = try? await webView.evaluateJavaScript("window.__sb ? window.__sb.state() : ''") as? String,
              let data = json.data(using: .utf8),
              let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            hasVideo = false
            return
        }
        hasVideo = state["hasVideo"] as? Bool ?? false
        currentTime = (state["currentTime"] as? NSNumber)?.doubleValue ?? 0
        duration = (state["duration"] as? NSNumber)?.doubleValue ?? 0
        adShowing = state["ad"] as? Bool ?? false
        title = state["title"] as? String ?? ""
    }

    // MARK: Clipping

    func preview(start: Double, end: Double) {
        webView.evaluateJavaScript("window.__sb && window.__sb.preview(\(start), \(end))", completionHandler: nil)
    }

    /// Records [start, end] of the current video. `listen` plays it out loud while recording.
    func startCapture(start: Double, end: Double, name: String, full: Bool = false, listen: Bool = true) {
        guard !isRecording else { return }
        writer?.discard()
        writer = nil
        pendingName = name
        pendingFull = full
        label = full ? "Saving full audio" : "Recording clip"
        capture = .recording(0, "\(label)…")
        // Keep the screen awake: iPadOS pauses web audio when the iPad locks.
        UIApplication.shared.isIdleTimerDisabled = true
        Task {
            let js = "window.__sb ? window.__sb.capture(\(start), \(end), { listen: \(listen) }) : 'missing'"
            let result = try? await webView.evaluateJavaScript(js)
            if (result as? String) != "ok" {
                fail("This page isn't ready yet. Wait for it to load, then try again.")
            }
        }
    }

    /// Saves the whole current video's audio.
    func saveFullAudio(name: String, listen: Bool) {
        guard hasVideo else { return reportError("Open a YouTube video first.") }
        guard duration > 0 else { return reportError("Live streams can't be saved. Open a normal video.") }
        guard duration <= Self.maxFullSeconds else { return reportError("Videos longer than 3 hours can't be saved.") }
        startCapture(start: 0, end: duration, name: name, full: true, listen: listen)
    }

    private func fail(_ message: String) {
        writer?.discard()
        writer = nil
        UIApplication.shared.isIdleTimerDisabled = false
        capture = .failed(message)
    }

    func reportError(_ message: String) {
        capture = .failed(message)
    }

    var captureLabel: String {
        if case .recording(_, let detail) = capture { return detail }
        return ""
    }

    func cancelCapture() {
        webView.evaluateJavaScript("window.__sb && window.__sb.cancel()", completionHandler: nil)
    }

    fileprivate func handle(_ body: Any) {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return }
        switch type {
        case "start":
            let sampleRate = (message["sampleRate"] as? NSNumber)?.doubleValue ?? 48000
            let channels = (message["channels"] as? NSNumber)?.intValue ?? 2
            do {
                writer = try CaptureWriter(sampleRate: sampleRate, channels: channels)
            } catch {
                fail("Couldn't create the audio file: \(error.localizedDescription)")
                cancelCapture()
            }
        case "chunk":
            guard let writer, let base64 = message["data"] as? String, let chunk = Data(base64Encoded: base64) else { return }
            do {
                try writer.append(chunk)
            } catch {
                fail("Couldn't save the audio: \(error.localizedDescription)")
                cancelCapture()
            }
        case "status":
            guard isRecording else { return }
            capture = .recording(0, message["message"] as? String ?? "\(label)…")
        case "progress":
            guard isRecording else { return }
            let time = (message["time"] as? NSNumber)?.doubleValue ?? currentTime
            currentTime = time
            let detail = pendingFull
                ? "\(label)… \(TimeText.format(time)) / \(TimeText.format(duration)), in real time"
                : "\(label)… the clip plays in real time."
            capture = .recording((message["fraction"] as? NSNumber)?.doubleValue ?? 0, detail)
        case "done":
            guard let writer else { return fail("No audio was captured.") }
            self.writer = nil
            UIApplication.shared.isIdleTimerDisabled = false
            let pageTitle = message["title"] as? String ?? ""
            let source = SoundSource(
                title: pageTitle,
                url: message["url"] as? String ?? "",
                start: (message["start"] as? NSNumber)?.doubleValue ?? 0,
                end: (message["end"] as? NSNumber)?.doubleValue ?? 0,
                full: pendingFull ? true : nil
            )
            let name = pendingName.isEmpty ? (pageTitle.isEmpty ? "YouTube audio" : pageTitle) : pendingName
            let seconds = Double(writer.frames) / writer.sampleRate
            let file = writer.finish()
            defer { try? FileManager.default.removeItem(at: file) }
            do {
                try onCaptured?(file, name, source)
                capture = .done("Saved “\(name)” (\(TimeText.format(seconds))).")
            } catch {
                capture = .failed(error.localizedDescription)
            }
        case "error":
            fail(message["message"] as? String ?? "Capture failed.")
        default:
            break
        }
    }
}

/// Forwards script messages without the user content controller retaining the controller.
private final class MessageBridge: NSObject, WKScriptMessageHandler {
    weak var target: YouTubeController?

    init(_ target: YouTubeController) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        MainActor.assumeIsolated {
            target?.handle(body)
        }
    }
}
