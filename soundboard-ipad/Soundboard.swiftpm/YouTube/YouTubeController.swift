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

    /// "Block YouTube ads" (on by default).
    @Published private(set) var blockAds: Bool = UserDefaults.standard.object(forKey: "blockAds") as? Bool ?? true

    let webView: WKWebView
    private let content: WKUserContentController
    private var adRules: WKContentRuleList?
    private var writer: CaptureWriter?
    /// Records the app's own audio (used on iPadOS, where the page can't tap YouTube's audio).
    private var recorder: AppAudioRecorder?
    /// The downloaded-audio file being received from the page.
    private var segmentFile: FileHandle?
    private var segmentURL: URL?
    private var segmentRange: (start: Double, end: Double) = (0, 0)
    /// Set while saving downloaded audio; used to fall back to recording.
    private var segmentRequest: (start: Double, end: Double, listen: Bool)?
    /// Why the downloaded audio wasn't available, shown if recording fails too.
    private var segmentDetail: String?
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
        config.userContentController = content
        self.content = content

        webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        // Lets Safari on a Mac inspect the YouTube page (Develop menu) for troubleshooting.
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        content.add(MessageBridge(self), name: "soundboard")
        installScripts()
    }

    // MARK: Scripts and ad blocking

    private func installScripts() {
        content.removeAllUserScripts()
        if blockAds {
            content.addUserScript(WKUserScript(source: AdBlockScript.source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // Must run before YouTube's player starts, to see the audio it downloads.
        content.addUserScript(WKUserScript(source: SegmentScript.source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: CaptureScript.source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

        content.removeAllContentRuleLists()
        guard blockAds else { return }
        if let adRules {
            content.add(adRules)
            return
        }
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "soundboard-youtube-ads",
            encodedContentRuleList: AdBlockScript.contentRules
        ) { [weak self] list, _ in
            guard let self, let list else { return }
            self.adRules = list
            if self.blockAds { self.content.add(list) }
        }
    }

    /// Turns the YouTube ad blocker on or off and reloads the page.
    func setBlockAds(_ enabled: Bool) {
        guard enabled != blockAds else { return }
        blockAds = enabled
        UserDefaults.standard.set(enabled, forKey: "blockAds")
        installScripts()
        if webView.url != nil { webView.reload() }
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
        // Best: save the audio the player downloads. If this page can't, record instead.
        segmentRequest = (start, end, listen)
        segmentDetail = nil
        Task {
            let js = "window.__sbSeg ? window.__sbSeg.capture(\(start), \(end), {}) : 'missing'"
            let result = try? await webView.evaluateJavaScript(js)
            if (result as? String) != "ok" { fallBackToRecording() }
        }
    }

    /// When the downloaded audio isn't available: record what plays instead.
    private func fallBackToRecording() {
        guard let request = segmentRequest else { return }
        segmentRequest = nil
        let start = request.start, end = request.end, listen = request.listen
        guard AppAudioRecorder.isAvailable else {
            runPageCapture(start: start, end: end, listen: listen, native: false)
            return
        }
        // iPadOS asks once for permission to record the app's audio.
        let recorder = AppAudioRecorder(start: start, end: end)
        self.recorder = recorder
        capture = .recording(0, "Starting the recorder…")
        recorder.begin { [weak self] error in
            guard let self else { return }
            if let error {
                self.recorder = nil
                self.fail(error.localizedDescription)
                return
            }
            self.capture = .recording(0, "\(self.label)…")
            self.runPageCapture(start: start, end: end, listen: listen, native: true)
        }
    }

    private func runPageCapture(start: Double, end: Double, listen: Bool, native: Bool) {
        Task {
            let js = "window.__sb ? window.__sb.capture(\(start), \(end), { listen: \(listen), native: \(native) }) : 'missing'"
            let result = try? await webView.evaluateJavaScript(js)
            if (result as? String) != "ok" {
                fail("This page isn't ready yet. Wait for it to load, then try again.")
            }
        }
    }

    /// Saves what the native recorder captured.
    private func finishNative(_ recorder: AppAudioRecorder, message: [String: Any]) {
        self.recorder = nil
        recorder.finish { [weak self] result, error in
            guard let self else { return }
            UIApplication.shared.isIdleTimerDisabled = false
            if let error { return self.fail("Couldn't save the audio: \(error.localizedDescription)") }
            let detail = self.segmentDetail.map { " (\($0))" } ?? ""
            guard let result else {
                return self.fail("Couldn't get this video's audio\(detail). Play the video for a moment, then try again.")
            }
            guard result.peak > 0.0005 else {
                try? FileManager.default.removeItem(at: result.file)
                return self.fail("Only silence was recorded\(detail). Play the video for a moment, then try again.")
            }
            self.save(file: result.file, seconds: Double(result.frames) / result.sampleRate, message: message)
        }
    }

    private func save(file: URL, seconds: Double, message: [String: Any]) {
        defer { try? FileManager.default.removeItem(at: file) }
        let pageTitle = message["title"] as? String ?? ""
        let source = SoundSource(
            title: pageTitle,
            url: message["url"] as? String ?? "",
            start: (message["start"] as? NSNumber)?.doubleValue ?? 0,
            end: (message["end"] as? NSNumber)?.doubleValue ?? 0,
            full: pendingFull ? true : nil
        )
        let name = pendingName.isEmpty ? (pageTitle.isEmpty ? "YouTube audio" : pageTitle) : pendingName
        do {
            try onCaptured?(file, name, source)
            capture = .done("Saved “\(name)” (\(TimeText.format(seconds))).")
        } catch {
            capture = .failed(error.localizedDescription)
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
        segmentRequest = nil
        closeSegmentFile(delete: true)
        writer?.discard()
        writer = nil
        recorder?.cancel()
        recorder = nil
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
        webView.evaluateJavaScript("window.__sbSeg && window.__sbSeg.cancel()", completionHandler: nil)
        webView.evaluateJavaScript("window.__sb && window.__sb.cancel()", completionHandler: nil)
    }

    // MARK: Downloaded audio

    private func closeSegmentFile(delete: Bool) {
        try? segmentFile?.close()
        segmentFile = nil
        if delete, let url = segmentURL { try? FileManager.default.removeItem(at: url) }
        if delete { segmentURL = nil }
    }

    private func finishSegments(message: [String: Any]) {
        guard let url = segmentURL else { return fail("No audio was downloaded.") }
        closeSegmentFile(delete: false)
        segmentURL = nil
        segmentRequest = nil
        let range = segmentRange
        capture = .recording(1, "Saving…")
        Task {
            defer { try? FileManager.default.removeItem(at: url) }
            do {
                let clip = try await ClipExporter.exportAudio(from: url, start: range.start, end: range.end)
                UIApplication.shared.isIdleTimerDisabled = false
                save(file: clip, seconds: range.end - range.start, message: message)
            } catch {
                fail("Couldn't save the audio: \(error.localizedDescription)")
            }
        }
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
            let fraction = (message["fraction"] as? NSNumber)?.doubleValue ?? 0
            let detail = segmentRequest != nil
                ? "Downloading the audio… \(Int(fraction * 100))%"
                : pendingFull
                    ? "\(label)… \(TimeText.format(time)) / \(TimeText.format(duration)), in real time"
                    : "\(label)… the clip plays in real time."
            capture = .recording((message["fraction"] as? NSNumber)?.doubleValue ?? 0, detail)
        case "segments-unavailable":
            segmentDetail = message["detail"] as? String
            fallBackToRecording()
        case "segments-start":
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("mp4")
            FileManager.default.createFile(atPath: url.path, contents: nil)
            segmentURL = url
            segmentFile = try? FileHandle(forWritingTo: url)
            segmentRange = (
                (message["relStart"] as? NSNumber)?.doubleValue ?? 0,
                (message["relEnd"] as? NSNumber)?.doubleValue ?? 0
            )
            if segmentFile == nil { fail("Couldn't create the audio file.") }
        case "segments-chunk":
            guard let file = segmentFile, let base64 = message["data"] as? String, let chunk = Data(base64Encoded: base64) else { return }
            do {
                try file.write(contentsOf: chunk)
            } catch {
                fail("Couldn't save the audio: \(error.localizedDescription)")
            }
        case "segments-done":
            finishSegments(message: message)
        case "clock":
            let time = (message["time"] as? NSNumber)?.doubleValue ?? 0
            let playing = message["playing"] as? Bool ?? false
            recorder?.updateClock(media: time, playing: playing)
        case "done":
            if let recorder {
                capture = .recording(1, "Finishing…")
                finishNative(recorder, message: message)
                return
            }
            guard let writer else { return fail("No audio was captured.") }
            self.writer = nil
            UIApplication.shared.isIdleTimerDisabled = false
            let seconds = Double(writer.frames) / writer.sampleRate
            save(file: writer.finish(), seconds: seconds, message: message)
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
