import SwiftUI

/// The library board: bashes, clips (tiles) and full sounds (rows).
struct LibraryView: View {
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var bashes: BashStore
    @EnvironmentObject private var ui: AppUI
    let destination: Destination

    private var showBashes: Bool { destination == .all || destination == .bashes }
    private var showClips: Bool { destination == .all || destination == .clips }
    private var showFull: Bool { destination == .all || destination == .full }

    private var visible: [Sound] { ui.sorted(store.sounds.filter { ui.matches($0) }) }
    private var clips: [Sound] { visible.filter { !$0.isFull } }
    private var full: [Sound] { visible.filter(\.isFull) }
    private var visibleBashes: [Bash] {
        let query = ui.search.trimmingCharacters(in: .whitespaces).lowercased()
        return query.isEmpty ? bashes.bashes : bashes.bashes.filter { $0.name.lowercased().contains(query) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !ui.tagFilter.isEmpty {
                    activeFilters
                }
                if store.sounds.isEmpty && bashes.bashes.isEmpty {
                    ContentUnavailableView(
                        "No sounds yet",
                        systemImage: "speaker.wave.3",
                        description: Text("Tap + to add audio from Files or a video from Photos, or open YouTube to clip a sound from a video.")
                    )
                    .padding(.top, 60)
                }
                if showBashes { bashBlock }
                if showClips && !store.sounds.isEmpty { clipBlock }
                if showFull && !store.sounds.isEmpty { fullBlock }
            }
            .padding()
        }
    }

    private var activeFilters: some View {
        HStack(spacing: 6) {
            Text("Showing \(ui.matchAllTags ? "all" : "any") of:")
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(ui.tagFilter, id: \.self) { tag in
                Button {
                    ui.toggleTag(tag)
                } label: {
                    TagChip(tag: tag, selected: true, label: "\(tag) ×")
                }
                .buttonStyle(.plain)
            }
            Button("Clear") { ui.tagFilter = [] }
                .font(.caption)
        }
    }

    // MARK: Bashes

    private var bashBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Button {
                    withAnimation { ui.bashesCollapsed.toggle() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: ui.bashesCollapsed && destination != .bashes ? "chevron.right" : "chevron.down")
                            .font(.caption2.weight(.bold))
                        BlockTitle(title: "Bashes", icon: "bolt", count: bashes.bashes.count)
                    }
                }
                .buttonStyle(.plain)
                .disabled(destination == .bashes)
                Text("Several sounds fired together with one tap")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                Button {
                    let bash = bashes.create()
                    ui.editingBash = BashEditRequest(id: bash.id)
                } label: {
                    IconLabel("New Bash", icon: "plus", size: 14)
                }
                .buttonStyle(.bordered)
            }
            if !ui.bashesCollapsed || destination == .bashes {
                if visibleBashes.isEmpty {
                    Text(bashes.bashes.isEmpty ? "No bashes yet. Make one to fire several sounds at once." : "No bashes match your search.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 10)], spacing: 10) {
                        ForEach(visibleBashes) { bash in
                            BashCard(bash: bash)
                        }
                    }
                }
            }
        }
    }

    // MARK: Clips

    private var clipBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            BlockTitle(title: "Clips", icon: "scissors", count: clips.count)
            if clips.isEmpty {
                Text(ui.isFiltering ? "No clips match your filters." : "No clips yet. Short sounds show up here as tiles.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 128), spacing: 10)], spacing: 10) {
                    ForEach(clips) { sound in
                        SoundTile(sound: sound)
                            .draggable(sound.id.uuidString)
                            .dropDestination(for: String.self) { items, _ in reorder(items, before: sound) }
                    }
                }
            }
        }
    }

    // MARK: Full sounds

    private var fullBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            BlockTitle(title: "Full Sounds", icon: "note", count: full.count)
            if full.isEmpty {
                Text(ui.isFiltering ? "No full sounds match your filters." : "No full sounds yet. Songs and long tracks show up here as rows.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                LazyVStack(spacing: 6) {
                    ForEach(full) { sound in
                        TrackRow(sound: sound)
                            .draggable(sound.id.uuidString)
                            .dropDestination(for: String.self) { items, _ in reorder(items, before: sound) }
                    }
                }
            }
        }
    }

    /// Drag a tile or row onto another to reorder (switches the sort to "My order").
    private func reorder(_ items: [String], before sound: Sound) -> Bool {
        guard let first = items.first, let id = UUID(uuidString: first), id != sound.id else { return false }
        withAnimation { store.move(id, before: sound.id) }
        ui.sort = .custom
        return true
    }
}
