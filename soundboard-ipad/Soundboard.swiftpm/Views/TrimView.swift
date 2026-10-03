import AVKit
import SwiftUI

/// Pick a range of an imported video (or screen recording) and save its audio as a sound.
@MainActor
struct TrimView: View {
    let url: URL
    var onSave: (URL, String) throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer
    @State private var name: String
    @State private var duration: Double = 0
    @State private var start: Double = 0
    @State private var end: Double = 0
    @State private var exporting = false
    @State private var errorMessage: String?
    @State private var boundaryObserver: Any?

    init(url: URL, defaultName: String, onSave: @escaping (URL, String) throws -> Void) {
        self.url = url
        self.onSave = onSave
        _player = State(initialValue: AVPlayer(url: url))
        _name = State(initialValue: defaultName)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                VideoPlayer(player: player)
                    .frame(minHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                if duration > 0 {
                    rangeRow(label: "Start", value: $start, range: 0...duration) {
                        start = min(playhead, end - 0.1)
                    }
                    rangeRow(label: "End", value: $end, range: 0...duration) {
                        end = max(playhead, start + 0.1)
                    }
                    HStack {
                        Text("Length \(String(format: "%.1f", max(0, end - start)))s")
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                        Spacer()
                        Button {
                            preview()
                        } label: {
                            Label("Preview", systemImage: "play.fill")
                        }
                        .buttonStyle(.bordered)
                    }
                } else {
                    ProgressView()
                }

                TextField("Sound name", text: $name)
                    .textFieldStyle(.roundedBorder)

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }
            .padding()
            .navigationTitle("Trim Sound")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if exporting {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(duration == 0 || end - start < 0.05)
                    }
                }
            }
        }
        .task {
            let asset = AVURLAsset(url: url)
            if let length = try? await asset.load(.duration), length.seconds.isFinite {
                duration = length.seconds
                end = duration
            } else {
                errorMessage = "Couldn't read this file."
            }
        }
        .onChange(of: start) { _, value in if end < value + 0.05 { end = min(duration, value + 0.05) } }
        .onChange(of: end) { _, value in if start > value - 0.05 { start = max(0, value - 0.05) } }
        .onDisappear {
            player.pause()
            try? FileManager.default.removeItem(at: url)
        }
    }

    private var playhead: Double {
        let seconds = player.currentTime().seconds
        return seconds.isFinite ? seconds : 0
    }

    private func rangeRow(label: String, value: Binding<Double>, range: ClosedRange<Double>, setFromPlayhead: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            Text(label).frame(width: 44, alignment: .leading)
            Slider(value: value, in: range)
            Text(TimeText.format(value.wrappedValue))
                .monospacedDigit()
                .frame(width: 70, alignment: .trailing)
            Button("Use Playhead", action: setFromPlayhead)
                .buttonStyle(.bordered)
        }
    }

    private func preview() {
        if let boundaryObserver { player.removeTimeObserver(boundaryObserver) }
        let endTime = CMTime(seconds: end, preferredTimescale: 600)
        let player = self.player
        boundaryObserver = player.addBoundaryTimeObserver(forTimes: [NSValue(time: endTime)], queue: .main) {
            player.pause()
        }
        player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        player.play()
    }

    private func save() async {
        exporting = true
        defer { exporting = false }
        player.pause()
        do {
            let exported = try await ClipExporter.exportAudio(from: url, start: start, end: end)
            try onSave(exported, name)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
