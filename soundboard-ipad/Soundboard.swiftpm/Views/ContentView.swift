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
    @StateObject private var themes = ThemeSettings()
    @StateObject private var live = LiveSession()
    @StateObject private var music = MusicDirector()
    @StateObject private var bookmarks = BookmarkStore()
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
                // Outside the NavigationStack, the panel gets its own full-height column,
                // and the toolbar stays above the board instead of over the panel.
                .inspector(isPresented: kitDrawerOpen) {
                    if case .kit(let id)? = selection {
                        KitDrawerView(kitId: id, target: $ui.kitDrawerTarget) { ui.kitDrawerOpen = false }
                            .inspectorColumnWidth(min: 300, ideal: 340, max: 420)
                    }
                }
                .frame(minWidth: 360, maxWidth: .infinity, maxHeight: .infinity)
                // On a full-width iPad the browser sits beside the board, like on the Mac.
                if showBrowser && sizeClass == .regular {
                    Divider()
                    YouTubePanel(controller: youtube)
                        .frame(minWidth: 320, maxWidth: .infinity)
                }
            }
        }
        // In Slide Over, narrow Split View or on iPhone it opens full screen instead.
        .fullScreenCover(isPresented: compactBrowser) {
            NavigationStack {
                YouTubePanel(controller: youtube)
                    .navigationTitle("Online")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showBrowser = false }
                        }
                    }
            }
            .premiumSheet()
        }
        .sheet(item: $ui.editingSound) { sound in
            EditSoundView(
                sound: sound,
                onSave: { store.update($0) },
                onDelete: { deleteSound(sound, store: store, player: player, bashes: bashes, kits: kits) }
            )
            .environmentObject(store)
            .premiumSheet()
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
                .premiumSheet()
        }
        // While tuned in to a Live Session, the stage covers the app until the player leaves.
        .fullScreenCover(isPresented: Binding(
            get: { live.showStage && live.role == .listener },
            set: { if !$0 { live.showStage = false } }
        )) {
            ListenerStageView()
                .environmentObject(live)
        }
        .sheet(item: $tagging, onDismiss: showTaggingIfNeeded) { request in
            TagNewSoundsView(soundIds: request.soundIds)
                .environmentObject(store)
                .premiumSheet()
        }
        // Premium (Premium.swift): when a limit or a locked feature asks for it.
        .premiumSheet()
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
        .environmentObject(youtube)
        .environmentObject(themes)
        .environmentObject(live)
        .environmentObject(music)
        .environmentObject(bookmarks)
        .overlay(alignment: .top) {
            if let notice = live.notice {
                Text(notice)
                    .font(.callout.weight(.semibold))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .shadow(radius: 8)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: notice) {
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        withAnimation { live.notice = nil }
                    }
            }
        }
        .animation(.easeOut(duration: 0.2), value: live.notice)
        .modifier(DicePresenter(tray: live.dice, active: !(live.showStage && live.role == .listener)))
        .tint(themes.accent)
        .preferredColorScheme(themes.theme.colorScheme)
        .fontDesign(themes.theme.fontDesign)
        .themedInk(themes.theme)
        .environment(\.appTheme, themes.theme)
        .onAppear {
            ambience.attach(to: store)
            live.attach(store: store, ambience: ambience, kits: kits, bashes: bashes, player: player)
            player.live = live
            bashPlayer.live = live
            music.attach(store: store, player: player, ambience: ambience, live: live)
            youtube.onCaptured = { file, name, source in
                _ = try store.addFile(at: file, name: name, source: source)
            }
        }
        .onChange(of: store.sounds) { _, _ in ambience.syncWithLibrary() }
        .onChange(of: selection) { old, destination in
            if case .kit(let id)? = destination { live.currentKitId = id } else { live.currentKitId = nil }
            // A kit set to start its music and ambience: the scene changes
            // (unless a bookmark opened it, bringing back its own sound).
            if ui.skipNextScene {
                ui.skipNextScene = false
            } else if case .kit(let id)? = destination, destination != old, let kit = kits.kit(id), kit.autoplay == true {
                music.sceneOpened(kit)
            }
        }
        .onChange(of: store.recentlyAdded) { _, _ in showTaggingIfNeeded() }
        .onChange(of: showBrowser) { _, open in
            if !open { showTaggingIfNeeded() }
        }
        .onChange(of: kits.kits) { _, list in
            // A deleted kit can't stay selected, and bookmarks forget it.
            if case .kit(let id)? = selection, !list.contains(where: { $0.id == id }) { selection = .all }
            let ids = Set(list.map(\.id))
            var used = Set<UUID>()
            for b in bookmarks.bookmarks {
                if let kitId = b.kitId { used.insert(kitId) }
                for spot in b.music.playlists { used.insert(spot.kitId) }
            }
            for id in used.subtracting(ids) { bookmarks.forgetKit(id) }
        }
    }

    private var kitDrawerOpen: Binding<Bool> {
        Binding(
            get: {
                if case .kit? = selection { return ui.kitDrawerOpen }
                return false
            },
            set: { ui.kitDrawerOpen = $0 }
        )
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
        if !ui.askToTag {
            store.recentlyAdded = []
            return
        }
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
