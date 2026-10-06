import SwiftUI

// Bookmarks: save the moment's sound and bring it back with one tap (next
// session, or after a detour): the scene kit that was open, the playlists
// playing (which song, how far in), other songs playing, the ambience layers
// and their volumes, and the master and ambience volumes. Coming back is a
// scene change: what isn't in the bookmark fades out while what is fades in,
// for listeners too. Matches the Mac app's renderer/bookmarks.js.

/// The sidebar's Bookmarks section.
struct BookmarkSection: View {
    @EnvironmentObject private var bookmarks: BookmarkStore
    @EnvironmentObject private var kits: KitStore
    @EnvironmentObject private var music: MusicDirector
    @EnvironmentObject private var ambience: AmbienceMixer
    @EnvironmentObject private var player: SoundPlayer
    @EnvironmentObject private var live: LiveSession
    @EnvironmentObject private var ui: AppUI
    @Binding var selection: Destination?

    /// The name being typed: for a new bookmark (nil id) or a rename.
    @State private var naming: (id: UUID?, text: String)?
    @State private var deleting: Bookmark?

    static let fade: Double = 3

    var body: some View {
        Section {
            ForEach(bookmarks.bookmarks) { bookmark in
                Button {
                    restore(bookmark)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "bookmark.fill")
                            .foregroundStyle(Color.accentColor)
                            .frame(width: 26)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(bookmark.name).lineLimit(1).foregroundStyle(Color.primary)
                            Text(bookmark.summary).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 40)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Bring back \(bookmark.name)")
                .accessibilityHint(bookmark.summary)
                .contextMenu {
                    Button {
                        restore(bookmark)
                    } label: {
                        Label("Bring Back", systemImage: "arrow.uturn.backward")
                    }
                    Button {
                        var updated = capture(name: bookmark.name)
                        updated.id = bookmark.id
                        bookmarks.save(updated)
                        live.notice = "Updated “\(bookmark.name)”."
                    } label: {
                        Label("Update to What's Playing", systemImage: "arrow.triangle.2.circlepath")
                    }
                    Button {
                        naming = (bookmark.id, bookmark.name)
                    } label: {
                        Label("Rename…", systemImage: "pencil")
                    }
                    Button(role: .destructive) {
                        deleting = bookmark
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
                .swipeActions {
                    Button(role: .destructive) { deleting = bookmark } label: { Label("Delete", systemImage: "trash") }
                }
            }
            Button {
                naming = (nil, defaultName())
            } label: {
                Label("Save This Moment", systemImage: "bookmark")
            }
            .foregroundStyle(Color.accentColor)
        } header: {
            Text("Bookmarks")
        } footer: {
            if bookmarks.bookmarks.isEmpty {
                Text("Save the music and ambience playing now, to bring it all back with one tap.")
            }
        }
        .alert(naming?.id == nil ? "Bookmark This Moment" : "Rename Bookmark",
               isPresented: Binding(get: { naming != nil }, set: { if !$0 { naming = nil } })) {
            TextField("Name", text: Binding(get: { naming?.text ?? "" }, set: { naming?.text = $0 }))
            Button("Save") {
                guard let naming else { return }
                if let id = naming.id {
                    bookmarks.rename(id, to: naming.text)
                } else {
                    let name = Bookmark.cleanName(naming.text)
                    bookmarks.save(capture(name: name.isEmpty ? defaultName() : name))
                    live.notice = "Bookmarked “\(name.isEmpty ? defaultName() : name)”."
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            if naming?.id == nil { Text("Saves the scene kit, the songs and where they are, and the ambience.") }
        }
        .confirmationDialog("Delete the bookmark “\(deleting?.name ?? "")”?",
                            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let deleting { bookmarks.remove(deleting.id) }
            }
        }
    }

    private var openKit: SoundKit? {
        if case .kit(let id)? = selection { return kits.kit(id) }
        return nil
    }

    private func defaultName() -> String {
        let time = Date().formatted(date: .omitted, time: .shortened)
        return "\(openKit?.name ?? "Library") · \(time)"
    }

    /// What's playing now.
    private func capture(name: String) -> Bookmark {
        Bookmark(name: name, kitId: openKit?.id, master: player.masterVolume,
                 music: music.capture(), ambience: ambience.capture())
    }

    /// Brings a bookmark back.
    private func restore(_ bookmark: Bookmark) {
        if let id = bookmark.kitId, kits.kit(id) != nil, selection != .kit(id) {
            ui.skipNextScene = true
            selection = .kit(id)
        }
        // Listeners fade their ambience over the same time.
        live.sceneChanged(fade: Self.fade)
        music.restore(bookmark.music, kit: { kits.kit($0) }, fade: Self.fade)
        ambience.applyScene(bookmark.ambience, fade: Self.fade)
        player.masterVolume = min(1, max(0, bookmark.master))
        live.notice = "Back to “\(bookmark.name)”."
    }
}
