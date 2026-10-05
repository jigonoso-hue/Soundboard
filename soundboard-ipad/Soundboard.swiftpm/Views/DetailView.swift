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
    @EnvironmentObject private var themes: ThemeSettings
    @EnvironmentObject private var live: LiveSession
    let destination: Destination
    @Binding var showBrowser: Bool

    @State private var showFileImporter = false
    @State private var showPhotoPicker = false
    @State private var photoItem: PhotosPickerItem?
    @State private var trimming: TrimRequest?
    @State private var showSettings = false
    @State private var showLive = false
    @State private var showRecorder = false
    /// What the Files picker offers: audio (MP3, M4A, WAV…) or video.
    @State private var importingVideo = false

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
        if destination == .options { return false }
        guard let kit, kit.hasAmbience else { return true }
        return ambience.stripPlaying
    }

    var body: some View {
        Group {
            if let kit {
                KitView(kitId: kit.id)
            } else if destination == .options {
                OptionsView()
            } else {
                LibraryView(destination: destination)
            }
        }
        // Always fill the column, with the theme's backdrop behind, so nothing
        // (like the Online panel opening beside it) can leave it a narrow strip.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .themedBackground(themes.theme, page: nil)
        .navigationTitle(kit?.name ?? title)
        .navigationBarTitleDisplayMode(.inline)
        // Scene kits show everything in them, so there's nothing to search there.
        .modifier(LibrarySearch(enabled: kit == nil && destination != .options, text: $ui.search))
        .toolbar { toolbar }
        .themedNavigationBar(themes.theme)
        .safeAreaInset(edge: .top, spacing: 0) {
            if !live.whisperTargets.isEmpty || live.emphasis {
                ArmedBanner(whisperNames: live.whisperNames, emphasis: live.emphasis) { live.disarm() }
            }
        }
        .sheet(isPresented: $showLive) {
            LiveView()
        }
        .sheet(isPresented: $showRecorder) {
            RecorderView()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if showStrip {
                if themes.theme.hasBackdrop {
                    AmbienceStrip()
                        .padding(.vertical, 4)
                        .background(ThemePanel(theme: themes.theme, seed: "ambience") { EmptyView() })
                        .padding(.horizontal, 8)
                        .padding(.bottom, 6)
                } else {
                    VStack(spacing: 0) {
                        Divider()
                        AmbienceStrip()
                    }
                    .background(.bar)
                }
            }
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: importingVideo ? [.movie] : [.audio, .mp3, .mpeg4Audio, .wav, .aiff],
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
        case .options: return "Options"
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if destination == .options {
            ToolbarItem(placement: .topBarLeading) {
                LiveControls(showLive: $showLive)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    player.stopAll()
                    bashPlayer.stop()
                } label: {
                    Label("Stop All", systemImage: "stop.fill")
                }
                .tint(.red)
            }
        } else if kit != nil {
            // In a scene kit: just the master volume, Live and Stop All.
            ToolbarItem(placement: .topBarLeading) {
                LiveControls(showLive: $showLive)
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                HStack(spacing: 6) {
                    Image(systemName: "speaker.fill").font(.caption).foregroundStyle(.secondary)
                    Slider(value: $player.masterVolume, in: 0...1)
                        .frame(width: 150)
                        .accessibilityLabel("Master volume")
                    Image(systemName: "speaker.wave.3.fill").font(.caption).foregroundStyle(.secondary)
                }
                Button {
                    player.stopAll()
                    bashPlayer.stop()
                } label: {
                    Label("Stop All", systemImage: "stop.fill")
                }
                .tint(.red)
            }
        } else {
            libraryToolbar
        }
    }

    @ToolbarContentBuilder
    private var libraryToolbar: some ToolbarContent {
        // Live (and Whisper/Emphasis while broadcasting) sit on the left, so the
        // buttons on the right never get pushed out of the toolbar.
        ToolbarItem(placement: .topBarLeading) {
            LiveControls(showLive: $showLive)
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
                showSettings = true
            } label: {
                Label("Sort and Settings", systemImage: "slider.horizontal.3")
            }
            .popover(isPresented: $showSettings) {
                SettingsPopover()
            }
            // No adding sounds mid-broadcast; it comes back when the session ends.
            if live.role != .host {
                Menu {
                    Section("Add Sounds") {
                        Button {
                            showRecorder = true
                        } label: {
                            Label("Record…", systemImage: "mic.fill")
                        }
                        Button {
                            importingVideo = false
                            showFileImporter = true
                        } label: {
                            Label("Audio from Files (MP3, M4A, WAV…)", systemImage: "music.note.list")
                        }
                        Button {
                            importingVideo = true
                            showFileImporter = true
                        } label: {
                            Label("Video from Files…", systemImage: "film")
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

/// Search for the library views only.
struct LibrarySearch: ViewModifier {
    let enabled: Bool
    @Binding var text: String

    func body(content: Content) -> some View {
        if enabled {
            content.searchable(text: $text, prompt: "Search sounds and tags")
        } else {
            content
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

/// Shown while a whisper or emphasis is armed for the next sound.
struct ArmedBanner: View {
    let whisperNames: [String]
    let emphasis: Bool
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: whisperNames.isEmpty ? "iphone.radiowaves.left.and.right" : "ear")
            Text(text).font(.callout)
            Spacer(minLength: 8)
            Button("Cancel", action: onCancel)
                .buttonStyle(.bordered)
                .controlSize(.small)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(color.opacity(0.22), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(color))
        .padding(.horizontal, 12)
        .padding(.top, 6)
    }

    private var color: Color { whisperNames.isEmpty ? Color(hex: 0xFF6A3D) : Color(hex: 0xB07CFF) }

    private var text: String {
        var parts: [String] = []
        if !whisperNames.isEmpty { parts.append("whispers to \(whisperNames.joined(separator: ", "))") }
        if emphasis { parts.append("vibrates phones") }
        return "Next sound " + parts.joined(separator: " and ") + "."
    }
}
