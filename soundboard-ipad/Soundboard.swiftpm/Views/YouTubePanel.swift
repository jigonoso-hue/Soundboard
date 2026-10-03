import SwiftUI
import WebKit

struct YouTubePanel: View {
    @ObservedObject var controller: YouTubeController

    @State private var query = ""
    @State private var startText = "0:00.0"
    @State private var endText = "0:05.0"
    @State private var name = ""
    @State private var listenWhileSaving = false

    var body: some View {
        VStack(spacing: 0) {
            navigationBar
                .disabled(controller.isRecording)
            Divider()
            WebViewContainer(webView: controller.webView)
                // Navigating away would stop a recording in progress.
                .allowsHitTesting(!controller.isRecording)
            Divider()
            clipper
        }
        .task { await controller.pollLoop() }
    }

    // MARK: Browser bar

    private var navigationBar: some View {
        HStack(spacing: 10) {
            Button { controller.goBack() } label: { Image(systemName: "chevron.left") }
                .disabled(!controller.canGoBack)
            Button { controller.goForward() } label: { Image(systemName: "chevron.right") }
                .disabled(!controller.canGoForward)
            Button { controller.goHome() } label: { Image(systemName: "house") }
            TextField("Search YouTube or paste a link", text: $query)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onSubmit { controller.search(query) }
        }
        .padding(10)
    }

    // MARK: Clipper

    private var range: (start: Double, end: Double)? {
        guard let start = TimeText.parse(startText), let end = TimeText.parse(endText), end > start else { return nil }
        return (start, end)
    }

    private var clipper: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(controller.hasVideo ? TimeText.format(controller.currentTime) : "–:––")
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(.tint)
                Spacer()
                if let range {
                    Text("\(String(format: "%.1f", range.end - range.start))s clip")
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                } else {
                    Text("Invalid range").foregroundStyle(.red)
                }
            }

            HStack(spacing: 8) {
                Button("Set Start") { setStart() }
                timeField("Start", text: $startText)
                Image(systemName: "arrow.right").foregroundStyle(.secondary)
                timeField("End", text: $endText)
                Button("Set End") { setEnd() }
            }
            .disabled(controller.isRecording)

            HStack(spacing: 8) {
                TextField("Sound name (defaults to video title)", text: $name)
                    .textFieldStyle(.roundedBorder)
                Button {
                    if let range { controller.preview(start: range.start, end: range.end) }
                } label: {
                    Image(systemName: "play.fill")
                }
                .accessibilityLabel("Preview")
                .disabled(controller.isRecording || !controller.hasVideo || range == nil)

                if controller.isRecording {
                    Button("Cancel", role: .cancel) { controller.cancelCapture() }
                } else {
                    Button {
                        create()
                    } label: {
                        Label("Create Sound", systemImage: "scissors")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }

            HStack(spacing: 8) {
                Button {
                    controller.saveFullAudio(name: name.trimmingCharacters(in: .whitespaces), listen: listenWhileSaving)
                    name = ""
                } label: {
                    Label("Save Full Audio", systemImage: "square.and.arrow.down")
                }
                .disabled(controller.isRecording || !controller.hasVideo)
                Toggle("Play out loud", isOn: $listenWhileSaving)
                    .fixedSize()
                    .font(.subheadline)
                    .disabled(controller.isRecording)
            }

            status
        }
        .buttonStyle(.bordered)
        .padding(12)
    }

    private func timeField(_ label: String, text: Binding<String>) -> some View {
        TextField(label, text: text)
            .textFieldStyle(.roundedBorder)
            .keyboardType(.numbersAndPunctuation)
            .multilineTextAlignment(.center)
            .font(.body.monospacedDigit())
            .frame(width: 84)
    }

    @ViewBuilder
    private var status: some View {
        switch controller.capture {
        case .idle:
            Text("Mark a start and end to clip a sound, or save the whole video's audio. Keep the app open while it records.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        case .recording(let fraction, let detail):
            VStack(alignment: .leading, spacing: 4) {
                ProgressView(value: fraction)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case .done(let message):
            Label(message, systemImage: "checkmark.circle.fill")
                .font(.footnote)
                .foregroundStyle(.green)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(.red)
        }
    }

    // MARK: Actions

    private func setStart() {
        guard controller.hasVideo else { return }
        startText = TimeText.format(controller.currentTime)
        if range == nil { endText = TimeText.format(controller.currentTime + 3) }
    }

    private func setEnd() {
        guard controller.hasVideo else { return }
        endText = TimeText.format(controller.currentTime)
    }

    private func create() {
        guard controller.hasVideo else {
            controller.reportError("Open a YouTube video first.")
            return
        }
        guard let range else {
            controller.reportError("Set a valid start and end time.")
            return
        }
        guard range.end - range.start <= YouTubeController.maxClipSeconds else {
            controller.reportError("Clips can be at most \(Int(YouTubeController.maxClipSeconds)) seconds long.")
            return
        }
        if controller.duration > 0 && range.start >= controller.duration {
            controller.reportError("The start time is past the end of the video.")
            return
        }
        controller.startCapture(start: range.start, end: range.end, name: name.trimmingCharacters(in: .whitespaces))
        name = ""
    }
}

struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
