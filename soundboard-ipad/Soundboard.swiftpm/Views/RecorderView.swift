import AVFoundation
import SwiftUI

/// Records a sound with the microphone: record, listen back, name it and save
/// it to the library. Matches the Mac app's Record window.
@MainActor
final class SoundRecorder: ObservableObject {
    enum Phase: Equatable { case idle, recording, recorded }

    /// Recordings stop on their own after ten minutes.
    static let maxSeconds: TimeInterval = 600

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var elapsed: TimeInterval = 0
    /// Recent input levels (0…1), newest last, for the meter.
    @Published private(set) var levels: [Double] = Array(repeating: 0, count: 40)
    @Published private(set) var isPreviewing = false
    @Published var error: String?

    private var recorder: AVAudioRecorder?
    private var preview: AVAudioPlayer?
    private var ticker: Timer?
    private let file = FileManager.default.temporaryDirectory.appendingPathComponent("recording-\(UUID().uuidString).m4a")

    var fileURL: URL { file }

    func start() {
        error = nil
        stopPreview()
        let file = self.file
        Task { @MainActor in
            guard await AVAudioApplication.requestRecordPermission() else {
                error = "Dungeon Radio can't use the microphone. Allow it in Settings → Privacy & Security → Microphone."
                return
            }
            // Switching the audio session to recording waits on the system, so it
            // runs off the main thread.
            await Task.detached(priority: .userInitiated) {
                let session = AVAudioSession.sharedInstance()
                try? session.setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
                try? session.setActive(true)
            }.value
            record(to: file)
        }
    }

    private func record(to file: URL) {
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            try? FileManager.default.removeItem(at: file)
            let recorder = try AVAudioRecorder(url: file, settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record(forDuration: Self.maxSeconds) else { throw CocoaError(.fileWriteUnknown) }
            self.recorder = recorder
            phase = .recording
            elapsed = 0
            levels = Array(repeating: 0, count: levels.count)
            ticker = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tick() }
            }
        } catch {
            self.error = "Couldn't start recording."
            BackgroundAudio.shared.configure()
        }
    }

    private func tick() {
        guard let recorder else { return }
        if !recorder.isRecording {
            // Reached the time limit.
            stop()
            return
        }
        recorder.updateMeters()
        // -50 dB and below is silence.
        let power = Double(recorder.averagePower(forChannel: 0))
        let level = max(0, min(1, (power + 50) / 50))
        levels = Array(levels.dropFirst()) + [level]
        elapsed = recorder.currentTime
    }

    func stop() {
        ticker?.invalidate()
        ticker = nil
        if let recorder {
            elapsed = max(elapsed, recorder.currentTime)
            recorder.stop()
        }
        recorder = nil
        // Back to playback only, mixing with other apps.
        BackgroundAudio.shared.configure()
        phase = FileManager.default.fileExists(atPath: file.path) && elapsed > 0.2 ? .recorded : .idle
    }

    func togglePreview() {
        if isPreviewing {
            stopPreview()
            return
        }
        guard let player = try? AVAudioPlayer(contentsOf: file) else { return }
        preview = player
        player.play()
        isPreviewing = true
        let length = player.duration
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64((length + 0.1) * 1_000_000_000))
            if self?.preview === player { self?.isPreviewing = false }
        }
    }

    func stopPreview() {
        preview?.stop()
        preview = nil
        isPreviewing = false
    }

    func discard() {
        if phase == .recording { stop() }
        stopPreview()
        try? FileManager.default.removeItem(at: file)
        phase = .idle
        elapsed = 0
    }
}

struct RecorderView: View {
    @EnvironmentObject private var store: SoundStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var recorder = SoundRecorder()
    @State private var name = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 22) {
                Spacer(minLength: 10)
                Text(timeText(recorder.elapsed))
                    .font(.system(size: 44, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(recorder.phase == .recording ? Color.red : Color.primary)
                LevelMeter(levels: recorder.levels, active: recorder.phase == .recording)
                    .frame(height: 54)
                    .padding(.horizontal)
                recordButton
                if recorder.phase == .recorded {
                    recordedControls
                } else {
                    Text(recorder.phase == .recording ? "Recording… tap to stop." : "Tap to record. Up to 10 minutes.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                if let error = recorder.error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.callout)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                Spacer(minLength: 10)
            }
            .padding()
            .navigationTitle("Record a Sound")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        recorder.discard()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(recorder.phase != .recorded)
                }
            }
        }
        .interactiveDismissDisabled(recorder.phase != .idle)
        .onAppear {
            if name.isEmpty { name = "Recording \(store.sounds.count + 1)" }
        }
        .onDisappear { if recorder.phase == .recording { recorder.discard() } }
    }

    private var recordButton: some View {
        Button {
            recorder.phase == .recording ? recorder.stop() : recorder.start()
        } label: {
            ZStack {
                Circle().strokeBorder(Color.primary.opacity(0.25), lineWidth: 4).frame(width: 84, height: 84)
                if recorder.phase == .recording {
                    RoundedRectangle(cornerRadius: 8).fill(Color.red).frame(width: 32, height: 32)
                } else {
                    Circle().fill(Color.red).frame(width: 66, height: 66)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(recorder.phase == .recording ? "Stop recording" : (recorder.phase == .recorded ? "Record again" : "Record"))
    }

    private var recordedControls: some View {
        VStack(spacing: 14) {
            Button {
                recorder.togglePreview()
            } label: {
                Label(recorder.isPreviewing ? "Stop" : "Listen", systemImage: recorder.isPreviewing ? "stop.fill" : "play.fill")
                    .frame(minWidth: 120)
            }
            .buttonStyle(.bordered)
            TextField("Sound name", text: $name)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 360)
            Text("Tap the red button to record again.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func save() {
        recorder.stopPreview()
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try store.addFile(at: recorder.fileURL, name: clean.isEmpty ? "Recording" : clean)
            recorder.discard()
            dismiss()
        } catch {
            recorder.error = "Couldn't save the recording."
        }
    }

    private func timeText(_ seconds: TimeInterval) -> String {
        let tenths = Int((seconds * 10).rounded(.down))
        return String(format: "%d:%02d.%d", tenths / 600, (tenths / 10) % 60, tenths % 10)
    }
}

/// Bars showing the microphone's recent level.
private struct LevelMeter: View {
    let levels: [Double]
    let active: Bool

    var body: some View {
        GeometryReader { geo in
            let count = CGFloat(max(1, levels.count))
            let barWidth: CGFloat = max(2, geo.size.width / count - 3)
            HStack(alignment: .center, spacing: 3) {
                ForEach(levels.indices, id: \.self) { index in
                    let height: CGFloat = max(3, geo.size.height * CGFloat(levels[index]))
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(active ? Color.red.opacity(0.8) : Color.secondary.opacity(0.35))
                        .frame(width: barWidth, height: height)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .accessibilityHidden(true)
    }
}
