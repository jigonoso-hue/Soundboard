import SwiftUI

struct SidebarView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var bashes: BashStore
    @EnvironmentObject private var kits: KitStore
    @EnvironmentObject private var ui: AppUI
    @EnvironmentObject private var themes: ThemeSettings
    @Binding var selection: Destination?
    @State private var newTag = ""
    @State private var deletingTag: String?
    @State private var deletingKit: SoundKit?

    var body: some View {
        List(selection: $selection) {
            Section {
                ForEach(kits.kits) { kit in
                    NavigationLink(value: Destination.kit(kit.id)) {
                        HStack(spacing: 10) {
                            IconBadge(icon: kit.icon, color: kit.color, iconColor: kit.iconColor, size: 26)
                            Text(kit.name).lineLimit(1)
                            Spacer()
                            if count(kit) > 0 {
                                Text("\(count(kit))").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .contextMenu {
                        Button {
                            ui.editingKit = KitEditRequest(kitId: kit.id)
                        } label: {
                            Label("Edit…", systemImage: "pencil")
                        }
                        Button {
                            if let copy = kits.duplicate(kit.id) { selection = .kit(copy.id) }
                        } label: {
                            Label("Duplicate", systemImage: "plus.square.on.square")
                        }
                        Button(role: .destructive) {
                            deletingKit = kit
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
                Button {
                    ui.editingKit = KitEditRequest(kitId: nil)
                } label: {
                    IconLabel("New Scene Kit", icon: "plus")
                }
                .foregroundStyle(Color.accentColor)
            } header: {
                Text("Scene Kits")
            } footer: {
                if kits.kits.isEmpty {
                    Text("Group sounds, songs, bashes and ambience for a scene, like “Tavern Brawl”.")
                }
            }
            .themedRows(themes.theme, compactOnly: true)

            Section("Library") {
                row(.all, "All", icon: "grid", count: store.sounds.count)
                row(.clips, "Clips", icon: "scissors", count: store.sounds.filter { !$0.isFull }.count)
                row(.full, "Full Sounds", icon: "note", count: store.sounds.filter(\.isFull).count)
                row(.bashes, "Bashes", icon: "bolt", count: bashes.bashes.count)
            }
            .themedRows(themes.theme, compactOnly: true)

            Section {
                NavigationLink(value: Destination.options) {
                    Label("Options", systemImage: "gearshape")
                }
            }
            .themedRows(themes.theme, compactOnly: true)

            Section {
                if ui.tagsOpen {
                    tagFilters
                }
            } header: {
                HStack {
                    Button {
                        withAnimation { ui.tagsOpen.toggle() }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: ui.tagsOpen ? "chevron.down" : "chevron.right")
                                .font(.caption2.weight(.bold))
                            Text("Tags")
                            if !ui.tagFilter.isEmpty {
                                Text("· \(ui.tagFilter.count) active").foregroundStyle(Color.accentColor)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    if ui.tagsOpen {
                        Button(ui.matchAllTags ? "Match all" : "Match any") { ui.matchAllTags.toggle() }
                            .font(.caption)
                            .buttonStyle(.bordered)
                            // A real tap target on iPhone.
                            .controlSize(sizeClass == .compact ? .regular : .mini)
                    }
                }
            }
            .themedRows(themes.theme, compactOnly: true)
        }
        .listStyle(.sidebar)
        .themedBackground(themes.theme, page: "sidebar")
        .themedNavigationBar(themes.theme)
        .navigationTitle("Dungeon Radio")
        .alert("Delete the “\(deletingTag ?? "")” tag?", isPresented: Binding(get: { deletingTag != nil }, set: { if !$0 { deletingTag = nil } })) {
            Button("Delete", role: .destructive) {
                if let tag = deletingTag {
                    store.removeTag(tag)
                    ui.tagFilter.removeAll { $0 == tag }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It will be removed from every sound. The sounds themselves stay.")
        }
        .confirmationDialog(
            "Delete the scene kit “\(deletingKit?.name ?? "")”?",
            isPresented: Binding(get: { deletingKit != nil }, set: { if !$0 { deletingKit = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete Kit", role: .destructive) {
                if let kit = deletingKit {
                    if selection == .kit(kit.id) { selection = .all }
                    kits.remove(kit.id)
                }
            }
        } message: {
            Text("The sounds and bashes in it stay in your library.")
        }
    }

    private func row(_ destination: Destination, _ title: String, icon: String, count: Int) -> some View {
        NavigationLink(value: destination) {
            HStack {
                IconLabel(title, icon: icon)
                Spacer()
                if count > 0 { Text("\(count)").font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    private func count(_ kit: SoundKit) -> Int {
        Set(kit.allItems).count + kit.sections.reduce(0) { $0 + $1.layers.count }
    }

    private var tagFilters: some View {
        VStack(alignment: .leading, spacing: 10) {
            FlowLayout(spacing: 6) {
                ForEach(store.allTags, id: \.self) { tag in
                    let used = store.sounds.filter { $0.tagList.contains(tag) }.count
                    Button {
                        ui.toggleTag(tag)
                    } label: {
                        TagChip(tag: tag, selected: ui.tagFilter.contains(tag), label: used > 0 ? "\(tag) \(used)" : tag)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        if !TagStyle.premade.contains(tag) {
                            Button(role: .destructive) {
                                deletingTag = tag
                            } label: {
                                Label("Delete Tag", systemImage: "trash")
                            }
                        }
                    }
                }
            }
            TextField("New tag", text: $newTag)
                .textInputAutocapitalization(.never)
                .submitLabel(.done)
                .onSubmit {
                    store.addTag(newTag)
                    newTag = ""
                }
            if !ui.tagFilter.isEmpty {
                Button("Clear tag filters") { ui.tagFilter = [] }
                    .font(.caption)
            }
        }
        .padding(.vertical, 4)
    }
}
