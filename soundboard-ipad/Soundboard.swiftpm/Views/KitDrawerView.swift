import SwiftUI

/// The library panel beside a kit: search and filter the library, then tap
/// to add or remove items from the chosen section (or drag them onto any section).
struct KitDrawerView: View {
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var bashes: BashStore
    @EnvironmentObject private var kits: KitStore
    @EnvironmentObject private var ambience: AmbienceMixer
    let kitId: UUID
    @Binding var target: UUID?
    var onClose: () -> Void = {}

    @State private var search = ""
    @State private var type: Filter = .all
    @State private var tags: Set<String> = []

    enum Filter: String, CaseIterable {
        case all, clips, full, bashes

        var label: String {
            switch self {
            case .all: return "All"
            case .clips: return "Clips"
            case .full: return "Full"
            case .bashes: return "Bashes"
            }
        }
    }

    private struct Row: Identifiable {
        let id: String
        let item: KitItem?
        let layerKind: AmbienceLayer.Kind?
        let layerRef: String?
        let icon: String
        let iconColor: Color
        let name: String
        let tags: [String]
        let meta: String
    }

    private var kit: SoundKit? { kits.kit(kitId) }
    private var section: KitSection? {
        guard let kit else { return nil }
        return kit.sections.first { $0.id == target } ?? kit.sections.first
    }

    var body: some View {
        if let kit, let section {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Library").font(.headline)
                    Spacer()
                    Button("Done", action: onClose)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Adding to").font(.caption).foregroundStyle(.secondary)
                    Picker("Section", selection: Binding(get: { section.id }, set: { id in
                        target = id
                        if let s = kit.sections.first(where: { $0.id == id }) { type = Self.defaultFilter(s) }
                    })) {
                        ForEach(kit.sections) { s in
                            Text(s.isAmbience ? "\(s.title) (ambience)" : s.title).tag(s.id)
                        }
                    }
                    .pickerStyle(.menu)
                }
                TextField("Search names and tags", text: $search)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !section.isAmbience {
                    Picker("Type", selection: $type) {
                        ForEach(Filter.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                let usedTags = store.allTags.filter { tag in store.sounds.contains { $0.tagList.contains(tag) } }
                if !usedTags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(usedTags, id: \.self) { tag in
                                Button {
                                    if tags.contains(tag) { tags.remove(tag) } else { tags.insert(tag) }
                                } label: {
                                    TagChip(tag: tag, selected: tags.contains(tag), small: true)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                List {
                    if section.isAmbience {
                        let builtins = builtinRows
                        let sounds = soundRows(sortFullFirst: true)
                        if !builtins.isEmpty {
                            Section("Built-in loops") { ForEach(builtins) { rowView($0, kit: kit, section: section) } }
                        }
                        if !sounds.isEmpty {
                            Section("Your sounds") { ForEach(sounds) { rowView($0, kit: kit, section: section) } }
                        }
                        if builtins.isEmpty && sounds.isEmpty { emptyText }
                    } else {
                        let rows = itemRows
                        if rows.isEmpty { emptyText }
                        ForEach(rows) { rowView($0, kit: kit, section: section) }
                    }
                }
                .listStyle(.plain)
                .environment(\.defaultMinListRowHeight, 34)
                Text(section.isAmbience
                     ? "Tap to add or remove a layer. You can also drag sounds onto any ambience section."
                     : "Tap to add or remove. You can also drag items onto any section.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .onAppear { type = Self.defaultFilter(section) }
            .onChange(of: target) { _, _ in
                if let current = self.section { type = Self.defaultFilter(current) }
            }
        } else {
            Text("Pick a section to add to.").foregroundStyle(.secondary).padding()
        }
    }

    private var emptyText: some View {
        Text("Nothing matches. Try another search or clear the tag filters.")
            .font(.callout)
            .foregroundStyle(.secondary)
    }

    static func defaultFilter(_ section: KitSection) -> Filter {
        switch section.kind {
        case .clips: return .clips
        case .full: return .full
        case .bashes: return .bashes
        case .mixed, .ambience: return .all
        }
    }

    // MARK: Rows

    private func matches(name: String, tags rowTags: [String]) -> Bool {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        if !query.isEmpty && !name.lowercased().contains(query) && !rowTags.contains(where: { $0.contains(query) }) { return false }
        if !tags.isEmpty && !rowTags.contains(where: tags.contains) { return false }
        return true
    }

    private var itemRows: [Row] {
        var rows: [Row] = []
        if type == .all || type == .bashes {
            for bash in bashes.bashes where matches(name: bash.name, tags: []) && tags.isEmpty {
                rows.append(Row(id: "bash-\(bash.id)", item: KitItem(type: .bash, id: bash.id), layerKind: nil, layerRef: nil,
                                icon: "bolt", iconColor: Color(hex: 0xFFE156), name: bash.name, tags: [],
                                meta: "\(bash.soundCount) sound\(bash.soundCount == 1 ? "" : "s")"))
            }
        }
        if type != .bashes {
            for sound in soundRowsSource where (type == .all || (type == .full) == sound.isFull) {
                rows.append(soundRow(sound, asLayer: false))
            }
        }
        return rows
    }

    private var soundRowsSource: [Sound] {
        store.sounds.filter { matches(name: $0.name, tags: $0.tagList) }
    }

    private func soundRows(sortFullFirst: Bool) -> [Row] {
        let list = sortFullFirst ? soundRowsSource.sorted { $0.isFull && !$1.isFull } : soundRowsSource
        return list.map { soundRow($0, asLayer: true) }
    }

    private func soundRow(_ sound: Sound, asLayer: Bool) -> Row {
        Row(
            id: "sound-\(sound.id)",
            item: asLayer ? nil : KitItem(type: .sound, id: sound.id),
            layerKind: asLayer ? .sound : nil,
            layerRef: asLayer ? sound.id.uuidString : nil,
            icon: sound.isFull ? "note" : "scissors",
            iconColor: sound.isFull ? Color(hex: 0xF472B6) : Color.secondary,
            name: sound.name,
            tags: sound.tagList,
            meta: sound.duration.map { TimeText.format($0) } ?? ""
        )
    }

    private var builtinRows: [Row] {
        guard tags.isEmpty else { return [] }
        return ambience.builtins.filter { matches(name: $0.name, tags: []) }.map { loop in
            Row(id: "builtin-\(loop.file)", item: nil, layerKind: .builtin, layerRef: loop.file,
                icon: KitSectionView.layerIcon(kind: .builtin, ref: loop.file), iconColor: Color(hex: 0x6EE7B7),
                name: loop.name, tags: [], meta: "loop")
        }
    }

    private func isAdded(_ row: Row, in section: KitSection) -> Bool {
        if let item = row.item { return section.items.contains(item) }
        if let kind = row.layerKind, let ref = row.layerRef {
            return section.layers.contains { $0.kind == kind && $0.ref == ref }
        }
        return false
    }

    private func rowView(_ row: Row, kit: SoundKit, section: KitSection) -> some View {
        let added = isAdded(row, in: section)
        return Button {
            toggle(row, kit: kit, section: section)
        } label: {
            HStack(spacing: 10) {
                AppIcon(id: row.icon, size: 16)
                    .foregroundStyle(row.iconColor)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.name).font(.subheadline).lineLimit(1).foregroundStyle(Color.primary)
                    HStack(spacing: 4) {
                        ForEach(row.tags.prefix(3), id: \.self) { TagChip(tag: $0, small: true) }
                        Text(row.meta).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 4)
                Image(systemName: added ? "checkmark" : "plus")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(added ? Color.black : Color.secondary)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(added ? Color(hex: 0x6EE7B7) : Color.secondary.opacity(0.15)))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 5, leading: 8, bottom: 5, trailing: 8))
        .listRowBackground(added ? Color(hex: 0x6EE7B7).opacity(0.1) : Color.clear)
        .draggable(dragPayload(row))
    }

    private func dragPayload(_ row: Row) -> String {
        if let item = row.item { return KitDrag.encode(item, from: nil) }
        if row.layerKind == .sound, let ref = row.layerRef, let id = UUID(uuidString: ref) {
            return KitDrag.encode(KitItem(type: .sound, id: id), from: nil)
        }
        return "builtin|\(row.layerRef ?? "")"
    }

    private func toggle(_ row: Row, kit: SoundKit, section: KitSection) {
        guard var current = kits.kit(kit.id), let i = current.sections.firstIndex(where: { $0.id == section.id }) else { return }
        if let item = row.item {
            if current.sections[i].items.contains(item) {
                current.sections[i].items.removeAll { $0 == item }
            } else {
                current.sections[i].items.append(item)
            }
        } else if let kind = row.layerKind, let ref = row.layerRef {
            if let existing = current.sections[i].layers.first(where: { $0.kind == kind && $0.ref == ref }) {
                ambience.stopVoice(current.sections[i].voiceId(existing))
                current.sections[i].layers.removeAll { $0.id == existing.id }
            } else {
                current.sections[i].layers.append(KitLayer(id: UUID(), kind: kind, ref: ref, volume: 0.7))
            }
        }
        kits.update(current)
    }
}
