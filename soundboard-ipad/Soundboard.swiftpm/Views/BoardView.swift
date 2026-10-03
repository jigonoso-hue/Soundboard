import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct BoardView: View {
    @ObservedObject var store: SoundStore
    @ObservedObject var player: SoundPlayer
    @ObservedObject var ambience: AmbienceMixer
    @Binding var showBrowser: Bool

    @State private var filter = ""
    @State private var editing: Sound?
    @State private var showFileImporter = false
    @State private var showPhotoPicker = false
    @State private var photoItem: PhotosPickerItem?
    @State private var trimming: TrimRequest?
    @State private var errorMessage: String?

    struct TrimRequest: Identifiable {
        let id = UUID()
        let url: URL
        let name: String
    }

    private var visibleSounds: [Sound] {
        filter.isEmpty ? store.sounds : store.sounds.filter { $0.name.localizedCaseInsensitiveContains(filter) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                controls
                AmbienceStrip(mixer: ambience, store: store)
                Divider()
                if store.sounds.isEmpty {
                    ContentUnavailableView(
                        "No sounds yet",
                        systemImage: "speaker.wave.3",
                        description: Text("Tap + to add audio from Files or a video from Photos, or open YouTube to clip a sound from a video.")
                    )
                    .padding(.top, 60)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) {
                    ForEach(visibleSounds) { sound in
                        tile(for: sound)
                    }
                }
                .padding()
            }
            .navigationTitle("Soundboard")
            .searchable(text: $filter, prompt: "Filter sounds")
            .toolbar { toolbar }
            .fileImporter(
                isPresented: $showFileImporter,
                allowedContentTypes: [.audio, .movie],
                allowsMultipleSelection: true,
                onCompletion: importFiles
            )
            .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .videos)
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                photoItem = nil
                Task {
                    do {
                        if let movie = try await item.loadTransferable(type: PickedMovie.self) {
                            trimming = TrimRequest(url: movie.url, name: "Video clip")
                        }
                    } catch {
                        errorMessage = error.localizedDescription
                    }
                }
            }
            .onChange(of: store.sounds) { _, _ in ambience.syncWithLibrary() }
            .sheet(item: $editing) { sound in
                EditSoundView(
                    sound: sound,
                    onSave: { store.update($0) },
                    onDelete: {
                        player.stop(sound.id)
                        store.remove(sound.id)
                    }
                )
            }
            .sheet(item: $trimming) { request in
                TrimView(url: request.url, defaultName: request.name) { exported, name in
                    defer { try? FileManager.default.removeItem(at: exported) }
                    try store.addFile(at: exported, name: name)
                }
            }
            .alert("Something went wrong", isPresented: showingError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: Pieces

    private var controls: some View {
        HStack(spacing: 16) {
            Image(systemName: "speaker.wave.2.fill")
                .foregroundStyle(.secondary)
            Slider(value: $player.masterVolume, in: 0...1)
                .frame(maxWidth: 200)
            Toggle("Restart instead of overlap", isOn: $player.restartInsteadOfOverlap)
                .fixedSize()
                .font(.subheadline)
            Spacer(minLength: 0)
        }
        .padding(.horizontal)
        .padding(.top, 8)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
                player.stopAll()
            } label: {
                Label("Stop All", systemImage: "stop.fill")
            }
            Menu {
                Button {
                    showFileImporter = true
                } label: {
                    Label("Audio or Video from Files…", systemImage: "folder")
                }
                Button {
                    showPhotoPicker = true
                } label: {
                    Label("Video from Photos…", systemImage: "photo.on.rectangle")
                }
            } label: {
                Label("Add Sound", systemImage: "plus")
            }
            Button {
                showBrowser.toggle()
            } label: {
                Label("YouTube", systemImage: showBrowser ? "play.rectangle.fill" : "play.rectangle")
            }
        }
    }

    private func tile(for sound: Sound) -> some View {
        Button {
            play(sound)
        } label: {
            SoundTile(sound: sound, progress: player.progress[sound.id])
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                editing = sound
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            if player.progress[sound.id] != nil {
                Button {
                    player.stop(sound.id)
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                }
            }
            Button {
                ambience.add(.sound, ref: sound.id.uuidString)
            } label: {
                Label("Add to Ambience", systemImage: "waveform")
            }
            Button(role: .destructive) {
                player.stop(sound.id)
                store.remove(sound.id)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        // Drag a tile onto another to reorder.
        .draggable(sound.id.uuidString)
        .dropDestination(for: String.self) { items, _ in
            guard let first = items.first, let id = UUID(uuidString: first), id != sound.id else { return false }
            withAnimation { store.move(id, before: sound.id) }
            return true
        }
    }

    private var showingError: Binding<Bool> {
        Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
    }

    // MARK: Actions

    private func play(_ sound: Sound) {
        do {
            try player.play(sound, url: store.url(for: sound))
        } catch {
            errorMessage = "Couldn't play “\(sound.name)”."
        }
    }

    private func importFiles(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            errorMessage = error.localizedDescription
        case .success(let urls):
            var failures: [String] = []
            for url in urls {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let name = url.deletingPathExtension().lastPathComponent
                let isVideo = UTType(filenameExtension: url.pathExtension)?.conforms(to: .movie) ?? false
                do {
                    if isVideo {
                        // Videos go through the trimmer; copy out of the scoped location first.
                        let copy = FileManager.default.temporaryDirectory
                            .appendingPathComponent(UUID().uuidString)
                            .appendingPathExtension(url.pathExtension)
                        try FileManager.default.copyItem(at: url, to: copy)
                        trimming = TrimRequest(url: copy, name: name)
                    } else {
                        try store.addFile(at: url, name: name)
                    }
                } catch {
                    failures.append(url.lastPathComponent)
                }
            }
            if !failures.isEmpty {
                errorMessage = "Couldn't add: \(failures.joined(separator: ", "))"
            }
        }
    }
}

struct SoundTile: View {
    let sound: Sound
    /// nil when not playing.
    let progress: Double?

    var body: some View {
        let color = Palette.color(sound.colorIndex)
        let isPlaying = progress != nil
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 14)
                .fill(color.opacity(isPlaying ? 0.55 : 0.28))
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(color.opacity(0.7), lineWidth: 1)
            Text(sound.name)
                .font(.headline)
                .foregroundStyle(.white)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
                .padding(12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            GeometryReader { geo in
                Rectangle()
                    .fill(color)
                    .frame(width: geo.size.width * (progress ?? 0), height: 4)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .frame(height: 96)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .contentShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: isPlaying ? color.opacity(0.6) : .clear, radius: 10)
        .scaleEffect(isPlaying ? 1.02 : 1)
        .animation(.easeOut(duration: 0.15), value: isPlaying)
    }
}

/// A video picked from Photos, copied to a temporary file we own.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedMovie(url: copy)
        }
    }
}
