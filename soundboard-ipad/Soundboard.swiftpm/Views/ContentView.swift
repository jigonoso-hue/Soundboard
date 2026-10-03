import SwiftUI

struct ContentView: View {
    @StateObject private var store = SoundStore()
    @StateObject private var player = SoundPlayer()
    @StateObject private var youtube = YouTubeController()
    @StateObject private var ambience = AmbienceMixer()
    @StateObject private var bashes = BashStore()
    @StateObject private var bashPlayer = BashPlayer()
    @StateObject private var kits = KitStore()
    @StateObject private var ui = AppUI()
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showBrowser = false
    @State private var selection: Destination? = .all
    @State private var tagging: TagRequest?

    struct TagRequest: Identifiable {
        let id = UUID()
        let soundIds: [UUID]
    }

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $selection)
        } detail: {
            HStack(spacing: 0) {
                NavigationStack {
                    DetailView(destination: selection ?? .all, showBrowser: $showBrowser)
                }
                .frame(maxWidth: .infinity)
                // On a full-width iPad the browser sits beside the board, like on the Mac.
                if showBrowser && sizeClass == .regular {
                    Divider()
                    YouTubePanel(controller: youtube)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        // In Slide Over, narrow Split View or on iPhone it opens full screen instead.
        .fullScreenCover(isPresented: compactBrowser) {
            NavigationStack {
                YouTubePanel(controller: youtube)
                    .navigationTitle("YouTube")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showBrowser = false }
                        }
                    }
            }
        }
        .sheet(item: $ui.editingSound) { sound in
            EditSoundView(
                sound: sound,
                onSave: { store.update($0) },
                onDelete: { deleteSound(sound, store: store, player: player, bashes: bashes, kits: kits) }
            )
            .environmentObject(store)
        }
        .fullScreenCover(item: $ui.editingBash) { request in
            if let bash = bashes.bash(request.id) {
                BashEditorView(bash: bash)
                    .environmentObject(store)
                    .environmentObject(bashes)
                    .environmentObject(bashPlayer)
                    .environmentObject(player)
            }
        }
        .sheet(item: $ui.editingKit) { request in
            KitEditView(request: request) { kit in
                if request.kitId == nil { selection = .kit(kit.id) }
            }
            .environmentObject(store)
            .environmentObject(kits)
        }
        .sheet(item: $ui.choosingKitFor) { choice in
            KitChooserView(choice: choice)
                .environmentObject(store)
                .environmentObject(kits)
                .environmentObject(ui)
        }
        .sheet(item: $tagging, onDismiss: showTaggingIfNeeded) { request in
            TagNewSoundsView(soundIds: request.soundIds)
                .environmentObject(store)
        }
        .alert("Something went wrong", isPresented: Binding(get: { ui.errorMessage != nil }, set: { if !$0 { ui.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(ui.errorMessage ?? "")
        }
        .environmentObject(store)
        .environmentObject(player)
        .environmentObject(ambience)
        .environmentObject(bashes)
        .environmentObject(bashPlayer)
        .environmentObject(kits)
        .environmentObject(ui)
        .onAppear {
            ambience.attach(to: store)
            youtube.onCaptured = { file, name, source in
                _ = try store.addFile(at: file, name: name, source: source)
            }
        }
        .onChange(of: store.sounds) { _, _ in ambience.syncWithLibrary() }
        .onChange(of: store.recentlyAdded) { _, _ in showTaggingIfNeeded() }
        .onChange(of: showBrowser) { _, open in
            if !open { showTaggingIfNeeded() }
        }
        .onChange(of: kits.kits) { _, list in
            // A deleted kit can't stay selected.
            if case .kit(let id)? = selection, !list.contains(where: { $0.id == id }) { selection = .all }
        }
    }

    private var compactBrowser: Binding<Bool> {
        Binding(
            get: { showBrowser && sizeClass != .regular },
            set: { if !$0 { showBrowser = false } }
        )
    }

    /// After sounds are added, ask for their tags (like the Mac app). Waits a
    /// moment so it doesn't collide with a sheet that's closing.
    private func showTaggingIfNeeded() {
        // A full-screen YouTube browser would hide the sheet; wait until it closes.
        guard tagging == nil, !store.recentlyAdded.isEmpty, !compactBrowser.wrappedValue else { return }
        Task {
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard tagging == nil, !store.recentlyAdded.isEmpty, !compactBrowser.wrappedValue else { return }
            let ids = store.recentlyAdded
            store.recentlyAdded = []
            tagging = TagRequest(soundIds: ids)
        }
    }
}
