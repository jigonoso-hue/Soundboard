import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The main area: the library or a scene kit, with the toolbar, the
/// importers and the ambience strip.
struct DetailView: View {
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var player: SoundPlayer
    @EnvironmentObject private var bashPlayer: BashPlayer
    @EnvironmentObject private var ambience: AmbienceMixer
    @EnvironmentObject private var kits: KitStore
    @EnvironmentObject private var ui: AppUI
    let destination: Destination
    @Binding var showBrowser: Bool

    @State private var showFileImporter = false
    @State private var showPhotoPicker = false
    @State private var photoItem: PhotosPickerItem?
    @State private var trimming: TrimRequest?
    @State private var showSettings = false

    struct TrimRequest: Identifiable {
        let id = UUID()
        let url: URL
        let name: String
    }

    private var kit: SoundKit? {
        if case .kit(let id) = destination { return kits.kit(id) }
        return nil
    }

    /// While a kit with its own ambience section is open, that section replaces
    /// the strip (unless the strip's own layers are playing).
    private var showStrip: Bool {
        guard let kit, kit.hasAmbience else { return true }
        return ambience.stripPlaying
    }

    var body: some View {
        Group {
            if let kit {
                KitView(kitId: kit.id)
            } else {
                LibraryView(destination: destination)
            }
        }
        .navigationTitle(kit?.name ?? title)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $ui.search, prompt: "Search sounds and tags")
        .toolbar { toolbar }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if showStrip {
                VStack(spacing: 0) {
                    Divider()
                    AmbienceStrip()
                }
                .background(.bar)
            }
        }
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
                    ui.errorMessage = error.localizedDescription
                }
            }
        }
        .sheet(item: $trimming) { request in
            TrimView(url: request.url, defaultName: request.name) { exported, name in
                defer { try? FileManager.default.removeItem(at: exported) }
                try store.addFile(at: exported, name: name)
            }
        }
    }

    private var title: String {
        switch destination {
        case .all: return "All Sounds"
        case .clips: return "Clips"
        case .full: return "Full Sounds"
        case .bashes: return "Bashes"
        case .kit: return "Scene Kit"
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
                showSettings = true
            } label: {
                Label("Sort and Settings", systemImage: "slider.horizontal.3")
            }
            .popover(isPresented: $showSettings) {
                SettingsPopover()
            }
            Menu {
                Section("Add Sounds") {
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
                }
                Section {
                    Button {
                        showBrowser.toggle()
                    } label: {
                        Label(showBrowser ? "Hide Online" : "Online", systemImage: "globe")
                    }
                }
            } label: {
                Label("Add Sounds", systemImage: "plus")
            }
            Button {
                player.stopAll()
                bashPlayer.stop()
            } label: {
                Label("Stop All", systemImage: "stop.fill")
            }
            .tint(.red)
        }
    }

    private func importFiles(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            ui.errorMessage = error.localizedDescription
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
                ui.errorMessage = "Couldn't add: \(failures.joined(separator: ", "))"
            }
        }
    }
}

/// Master volume and playback options.
struct SettingsPopover: View {
    @EnvironmentObject private var player: SoundPlayer
    @EnvironmentObject private var ui: AppUI

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Sort sounds").font(.headline)
                Picker("Sort", selection: $ui.sort) {
                    ForEach(SoundSort.allCases, id: \.self) { sort in
                        Text(sort.label).tag(sort)
                    }
                }
                .pickerStyle(.segmented)
            }
            Divider()
            Text("Master volume").font(.headline)
            HStack {
                Image(systemName: "speaker.fill").foregroundStyle(.secondary)
                Slider(value: $player.masterVolume, in: 0...1)
                Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary)
            }
            Toggle("Restart instead of overlap", isOn: $player.restartInsteadOfOverlap)
            Text("When on, a sound restarts instead of layering over itself.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(minWidth: 360)
        .presentationCompactAdaptation(.popover)
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
