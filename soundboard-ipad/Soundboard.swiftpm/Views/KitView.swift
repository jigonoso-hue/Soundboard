import SwiftUI

/// A scene kit's page: a header and a board of movable, resizable sections.
struct KitView: View {
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var bashes: BashStore
    @EnvironmentObject private var kits: KitStore
    @EnvironmentObject private var ambience: AmbienceMixer
    @EnvironmentObject private var ui: AppUI
    let kitId: UUID

    @State private var editing = false
    // The library panel is shown by ContentView, beside the whole page (so the toolbar moves with the board).
    private var drawerOpen: Bool {
        get { ui.kitDrawerOpen }
        nonmutating set { ui.kitDrawerOpen = newValue }
    }
    private var drawerTarget: UUID? {
        get { ui.kitDrawerTarget }
        nonmutating set { ui.kitDrawerTarget = newValue }
    }
    @State private var dragging: DragState?
    @State private var renaming: KitSection?
    @State private var renameText = ""
    @State private var confirmDelete = false
    @State private var removingSection: KitSection?

    static let row: CGFloat = 34
    static let gap: CGFloat = 12

    struct DragState {
        let sectionId: UUID
        let resizing: Bool
        let x: Int
        let y: Int
        let w: Int
        let h: Int
    }

    private var kit: SoundKit? { kits.kit(kitId) }

    var body: some View {
        if let kit {
            GeometryReader { geo in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        header(kit)
                        board(kit, width: geo.size.width - 24)
                    }
                    .padding(12)
                }
            }
            .onDisappear { ui.kitDrawerOpen = false }
            .alert("Section name", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Name", text: $renameText)
                Button("Save") {
                    if let section = renaming { change(kit) { k in
                        if let i = k.sections.firstIndex(where: { $0.id == section.id }) { k.sections[i].title = renameText }
                    } }
                }
                Button("Cancel", role: .cancel) {}
            }
            .confirmationDialog("Delete the scene kit “\(kit.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete Kit", role: .destructive) {
                    stopLayers(kit.sections)
                    kits.remove(kit.id)
                }
            } message: {
                Text("The sounds and bashes in it stay in your library.")
            }
            .confirmationDialog(
                "Remove the “\(removingSection?.title ?? "")” section?",
                isPresented: Binding(get: { removingSection != nil }, set: { if !$0 { removingSection = nil } }),
                titleVisibility: .visible
            ) {
                Button("Remove Section", role: .destructive) {
                    if let section = removingSection { removeSection(section, from: kit) }
                }
            } message: {
                Text("Its \(removingSection?.isAmbience == true ? "layers" : "items") leave this kit. Your library isn't changed.")
            }
        } else {
            ContentUnavailableView("Scene kit not found", systemImage: "square.grid.2x2")
        }
    }

    // MARK: Header

    private func header(_ kit: SoundKit) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // One row when there's room, otherwise the buttons go under the title.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    title(kit)
                    Spacer(minLength: 12)
                    actions(kit)
                }
                VStack(alignment: .leading, spacing: 10) {
                    title(kit)
                    actions(kit)
                }
            }
            if editing {
                Text("Drag a section by its title bar to move it, or drag its bottom-right corner to resize it. Tap Done when finished.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func title(_ kit: SoundKit) -> some View {
        HStack(spacing: 12) {
            IconBadge(icon: kit.icon, color: kit.color, iconColor: kit.iconColor, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(kit.name).font(.title3.weight(.bold)).lineLimit(1)
                Text(describe(kit)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }

    private func actions(_ kit: SoundKit) -> some View {
        HStack(spacing: 8) {
            Button {
                if drawerOpen { drawerOpen = false } else { openDrawer(kit, section: drawerTarget) }
            } label: {
                IconLabel(drawerOpen ? "Close Library" : "Add from Library", icon: drawerOpen ? "close" : "plus", size: 14)
            }
            .buttonStyle(.borderedProminent)
            Button {
                withAnimation { editing.toggle() }
            } label: {
                if editing { Text("Done") } else { IconLabel("Layout", icon: "grid", size: 14) }
            }
            .buttonStyle(.bordered)
            .tint(editing ? Color.accentColor : nil)
            Menu {
                Button {
                    addSection(to: kit, kind: .mixed)
                } label: {
                    Label("Sound Section", systemImage: "square.grid.2x2")
                }
                Button {
                    addSection(to: kit, kind: .ambience)
                } label: {
                    Label("Ambience Section", systemImage: "square.3.layers.3d")
                }
            } label: {
                IconLabel("Section", icon: "plus", size: 14)
            }
            .buttonStyle(.bordered)
            Menu {
                Button {
                    ui.editingKit = KitEditRequest(kitId: kit.id)
                } label: {
                    Label("Edit Name and Icon…", systemImage: "pencil")
                }
                Button {
                    kits.duplicate(kit.id)
                } label: {
                    Label("Duplicate", systemImage: "plus.square.on.square")
                }
                Divider()
                Button(role: .destructive) {
                    confirmDelete = true
                } label: {
                    Label("Delete Kit", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .frame(minHeight: 18)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Kit options")
        }
        .controlSize(.small)
        .fixedSize()
    }

    private func describe(_ kit: SoundKit) -> String {
        var clips = 0, full = 0, bashCount = 0
        for item in Set(kit.allItems) {
            switch item.type {
            case .bash:
                if bashes.bash(item.id) != nil { bashCount += 1 }
            case .sound:
                if let sound = store.sound(item.id) { if sound.isFull { full += 1 } else { clips += 1 } }
            }
        }
        let layers = kit.sections.reduce(0) { $0 + $1.layers.count }
        var parts: [String] = []
        if clips > 0 { parts.append("\(clips) clip\(clips == 1 ? "" : "s")") }
        if full > 0 { parts.append("\(full) full sound\(full == 1 ? "" : "s")") }
        if bashCount > 0 { parts.append("\(bashCount) bash\(bashCount == 1 ? "" : "es")") }
        if layers > 0 { parts.append("\(layers) ambience layer\(layers == 1 ? "" : "s")") }
        return parts.isEmpty ? "Empty, add sounds from your library" : parts.joined(separator: " · ")
    }

    // MARK: Board

    private func column(_ width: CGFloat) -> CGFloat {
        (width - Self.gap * CGFloat(KitStore.columns - 1)) / CGFloat(KitStore.columns)
    }

    private func board(_ kit: SoundKit, width: CGFloat) -> some View {
        let col = column(width)
        let rows = kit.sections.reduce(0) { max($0, $1.y + $1.h) } + (editing ? 3 : 0)
        let height = CGFloat(rows) * (Self.row + Self.gap)
        return ZStack(alignment: .topLeading) {
            ForEach(kit.sections) { section in
                KitSectionView(
                    kit: kit,
                    section: section,
                    editing: editing,
                    targeted: drawerOpen && drawerTarget == section.id,
                    onAdd: { openDrawer(kit, section: section.id) },
                    onRename: {
                        renameText = section.title
                        renaming = section
                    },
                    onRemove: {
                        if section.count == 0 { removeSection(section, from: kit) } else { removingSection = section }
                    },
                    onChange: { updated in
                        change(kit) { k in
                            if let i = k.sections.firstIndex(where: { $0.id == updated.id }) { k.sections[i] = updated }
                        }
                    },
                    onMoveItem: { item, from, to in moveItem(item, from: from, to: to, in: kit) }
                )
                .frame(width: span(section.w, col), height: span(section.h, Self.row))
                .overlay(alignment: .top) {
                    if editing {
                        // Drag handle over the title bar.
                        Color.white.opacity(0.001)
                            .frame(height: 34)
                            .padding(.trailing, 70)
                            .gesture(layoutDrag(kit, section: section, col: col, resizing: false))
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if editing {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.caption2.weight(.bold))
                            .padding(8)
                            .background(Circle().fill(Color.accentColor))
                            .foregroundStyle(.white)
                            .padding(4)
                            .gesture(layoutDrag(kit, section: section, col: col, resizing: true))
                            .accessibilityLabel("Resize \(section.title)")
                    }
                }
                .offset(x: CGFloat(section.x) * (col + Self.gap), y: CGFloat(section.y) * (Self.row + Self.gap))
                .animation(dragging == nil ? .easeOut(duration: 0.2) : nil, value: section)
            }
        }
        .frame(width: max(0, width), height: max(height, 200), alignment: .topLeading)
    }

    private func span(_ cells: Int, _ size: CGFloat) -> CGFloat {
        CGFloat(cells) * size + CGFloat(max(0, cells - 1)) * Self.gap
    }

    private func layoutDrag(_ kit: SoundKit, section: KitSection, col: CGFloat, resizing: Bool) -> some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                if dragging?.sectionId != section.id {
                    dragging = DragState(sectionId: section.id, resizing: resizing, x: section.x, y: section.y, w: section.w, h: section.h)
                }
                guard let start = dragging, var current = kits.kit(kit.id),
                      let i = current.sections.firstIndex(where: { $0.id == section.id }) else { return }
                let dx = Int((value.translation.width / (col + Self.gap)).rounded())
                let dy = Int((value.translation.height / (Self.row + Self.gap)).rounded())
                var s = current.sections[i]
                if start.resizing {
                    s.w = min(KitStore.columns - s.x, max(2, start.w + dx))
                    s.h = min(40, max(2, start.h + dy))
                } else {
                    s.x = min(KitStore.columns - s.w, max(0, start.x + dx))
                    s.y = max(0, start.y + dy)
                }
                guard s != current.sections[i] else { return }
                current.sections[i] = s
                KitStore.compact(&current.sections, fixed: s.id)
                kits.update(current)
            }
            .onEnded { _ in
                dragging = nil
                change(kit) { k in KitStore.compact(&k.sections) }
            }
    }

    // MARK: Changes

    /// Applies a change to the latest copy of the kit and saves it.
    private func change(_ kit: SoundKit, _ apply: (inout SoundKit) -> Void) {
        guard var current = kits.kit(kit.id) else { return }
        apply(&current)
        kits.update(current)
    }

    private func openDrawer(_ kit: SoundKit, section: UUID?) {
        if kit.sections.isEmpty {
            addSection(to: kit, kind: .mixed)
            return
        }
        if let section, kit.sections.contains(where: { $0.id == section }) {
            drawerTarget = section
        } else {
            drawerTarget = kit.sections.first?.id
        }
        drawerOpen = true
    }

    private func addSection(to kit: SoundKit, kind: SectionKind) {
        let bottom = kit.sections.reduce(0) { max($0, $1.y + $1.h) }
        let ambienceKind = kind == .ambience
        let section = KitSection(
            id: UUID(),
            title: ambienceKind ? "Ambience" : "New Section",
            kind: kind,
            x: 0,
            y: bottom,
            w: ambienceKind ? 12 : 6,
            h: ambienceKind ? 5 : 6,
            size: .m,
            items: [],
            layers: []
        )
        change(kit) { $0.sections.append(section) }
        renameText = section.title
        renaming = section
    }

    private func removeSection(_ section: KitSection, from kit: SoundKit) {
        stopLayers([section])
        change(kit) { k in
            k.sections.removeAll { $0.id == section.id }
            KitStore.compact(&k.sections)
        }
    }

    private func stopLayers(_ sections: [KitSection]) {
        for section in sections {
            for layer in section.layers { ambience.stopVoice(section.voiceId(layer)) }
        }
    }

    /// Drops an item on a section: moved from another section, or added from the library panel.
    private func moveItem(_ item: KitItem, from: UUID?, to target: UUID, in kit: SoundKit) {
        guard from != target else { return }
        change(kit) { k in
            guard let t = k.sections.firstIndex(where: { $0.id == target }) else { return }
            if k.sections[t].isAmbience {
                guard item.type == .sound else { return }
                if !k.sections[t].layers.contains(where: { $0.kind == .sound && $0.ref == item.id.uuidString }) {
                    k.sections[t].layers.append(KitLayer(id: UUID(), kind: .sound, ref: item.id.uuidString, volume: 0.7))
                }
                return
            }
            if let from, let f = k.sections.firstIndex(where: { $0.id == from }) {
                k.sections[f].items.removeAll { $0 == item }
            }
            if !k.sections[t].items.contains(item) { k.sections[t].items.append(item) }
        }
    }
}

/// A section item with the sound or bash it points at.
struct KitEntry<Value>: Identifiable {
    let item: KitItem
    let value: Value
    var id: KitItem { item }
}

/// Drag payload for kit items: "kit-item|sound|<id>|<from section or empty>".
enum KitDrag {
    static func encode(_ item: KitItem, from section: UUID?) -> String {
        "kit-item|\(item.type.rawValue)|\(item.id.uuidString)|\(section?.uuidString ?? "")"
    }

    static func decode(_ text: String) -> (KitItem, UUID?)? {
        let parts = text.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 4, parts[0] == "kit-item",
              let type = KitItem.ItemType(rawValue: parts[1]),
              let id = UUID(uuidString: parts[2]) else {
            // A plain sound id (dragged from the library board).
            if let id = UUID(uuidString: text) { return (KitItem(type: .sound, id: id), nil) }
            return nil
        }
        return (KitItem(type: type, id: id), UUID(uuidString: parts[3]))
    }
}

/// One section of a kit's board.
struct KitSectionView: View {
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var bashes: BashStore
    @EnvironmentObject private var ambience: AmbienceMixer
    @EnvironmentObject private var ui: AppUI
    let kit: SoundKit
    let section: KitSection
    let editing: Bool
    let targeted: Bool
    let onAdd: () -> Void
    let onRename: () -> Void
    let onRemove: () -> Void
    let onChange: (KitSection) -> Void
    /// (item, section it came from, section it goes to).
    let onMoveItem: (KitItem, UUID?, UUID) -> Void

    @State private var dropHover = false

    private let ambienceColor = Color(hex: 0x6EE7B7)

    var body: some View {
        VStack(spacing: 0) {
            head
            Divider()
            ScrollView {
                content
                    .padding(8)
            }
            .disabled(editing)
            .opacity(editing ? 0.6 : 1)
        }
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.secondary.opacity(section.isAmbience ? 0.1 : 0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(borderColor, style: StrokeStyle(lineWidth: targeted || dropHover ? 2 : 1, dash: editing ? [6, 4] : []))
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .dropDestination(for: String.self) { items, _ in
            guard let first = items.first else { return false }
            // A built-in loop from the library panel.
            if first.hasPrefix("builtin|") {
                let file = String(first.dropFirst("builtin|".count))
                guard section.isAmbience, !file.isEmpty else { return false }
                var s = section
                if !s.layers.contains(where: { $0.kind == .builtin && $0.ref == file }) {
                    s.layers.append(KitLayer(id: UUID(), kind: .builtin, ref: file, volume: 0.7))
                    onChange(s)
                }
                return true
            }
            guard let decoded = KitDrag.decode(first) else { return false }
            let (item, from) = decoded
            if section.isAmbience && item.type != .sound {
                ui.errorMessage = "Bashes can't be ambience layers. Drop a sound or a built-in loop here."
                return false
            }
            onMoveItem(item, from, section.id)
            return true
        } isTargeted: { dropHover = $0 }
    }

    private var borderColor: Color {
        if targeted || dropHover { return .accentColor }
        return section.isAmbience ? ambienceColor.opacity(0.35) : Color.secondary.opacity(0.25)
    }

    // MARK: Head

    private var head: some View {
        HStack(spacing: 8) {
            if section.isAmbience {
                AppIcon(id: "layers", size: 15).foregroundStyle(ambienceColor)
            }
            Text(section.title.uppercased())
                .font(.caption.weight(.bold))
                .tracking(0.5)
                .lineLimit(1)
            if section.count > 0 {
                Text("\(section.count)").font(.caption).foregroundStyle(Color.accentColor)
            }
            if section.isAmbience {
                let anyOn = section.layers.contains { ambience.isPlaying(voice: section.voiceId($0)) }
                Button {
                    for layer in section.layers { ambience.stopVoice(section.voiceId(layer)) }
                } label: {
                    IconLabel("Stop", icon: "stop", size: 10).font(.caption2.weight(.semibold))
                }
                .buttonStyle(.borderless)
                .disabled(!anyOn)
            }
            Spacer(minLength: 4)
            Button(action: onAdd) {
                AppIcon(id: "plus", size: 16)
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(section.isAmbience ? "Add layers" : "Add from library")
            Menu {
                Button(section.isAmbience ? "Add Layers…" : "Add from Library…", action: onAdd)
                Button("Rename…", action: onRename)
                if !section.isAmbience {
                    Picker("Item size", selection: Binding(get: { section.size }, set: { size in
                        var s = section
                        s.size = size
                        onChange(s)
                    })) {
                        ForEach(ItemSize.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    Picker("Meant for", selection: Binding(get: { section.kind }, set: { kind in
                        var s = section
                        s.kind = kind
                        onChange(s)
                    })) {
                        ForEach([SectionKind.clips, .full, .bashes, .mixed], id: \.self) { kind in
                            Text(kind.label).tag(kind)
                        }
                    }
                }
                Divider()
                Button("Remove Section", role: .destructive, action: onRemove)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.subheadline.weight(.semibold))
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Section options")
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .frame(height: 34)
        .background(section.isAmbience ? ambienceColor.opacity(0.07) : Color.clear)
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if section.isAmbience {
            ambienceContent
        } else {
            itemContent
        }
    }

    private var itemContent: some View {
        let filtering = ui.isFiltering
        let query = ui.search.trimmingCharacters(in: .whitespaces).lowercased()
        var bashItems: [KitEntry<Bash>] = []
        var clipItems: [KitEntry<Sound>] = []
        var fullItems: [KitEntry<Sound>] = []
        for item in section.items {
            switch item.type {
            case .bash:
                if let bash = bashes.bash(item.id), !filtering || query.isEmpty || bash.name.lowercased().contains(query) {
                    bashItems.append(KitEntry(item: item, value: bash))
                }
            case .sound:
                if let sound = store.sound(item.id), !filtering || ui.matches(sound) {
                    if sound.isFull {
                        fullItems.append(KitEntry(item: item, value: sound))
                    } else {
                        clipItems.append(KitEntry(item: item, value: sound))
                    }
                }
            }
        }
        let tileWidth: CGFloat = section.size == .s ? 100 : (section.size == .l ? 170 : 128)
        let cardWidth: CGFloat = section.size == .s ? 170 : (section.size == .l ? 260 : 210)
        return VStack(alignment: .leading, spacing: 8) {
            if section.items.isEmpty {
                emptyButton(section.kind == .bashes ? "Add bashes from your library" : "Add from your library", icon: "plus")
            } else if bashItems.isEmpty && clipItems.isEmpty && fullItems.isEmpty {
                Text("Nothing here matches your filters.").font(.caption).foregroundStyle(.secondary)
            }
            if !bashItems.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: cardWidth), spacing: 8)], spacing: 8) {
                    ForEach(bashItems) { entry in
                        BashCard(bash: entry.value, size: section.size)
                            .draggable(KitDrag.encode(entry.item, from: section.id))
                            .contextMenu { itemMenu(entry.item) }
                    }
                }
            }
            if !clipItems.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: tileWidth), spacing: 8)], spacing: 8) {
                    ForEach(clipItems) { entry in
                        SoundTile(sound: entry.value, size: section.size)
                            .draggable(KitDrag.encode(entry.item, from: section.id))
                            .contextMenu { itemMenu(entry.item) }
                    }
                }
            }
            if !fullItems.isEmpty {
                VStack(spacing: 8) {
                    ForEach(fullItems) { entry in
                        TrackRow(sound: entry.value, size: section.size)
                            .draggable(KitDrag.encode(entry.item, from: section.id))
                            .contextMenu { itemMenu(entry.item) }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func itemMenu(_ item: KitItem) -> some View {
        if item.type == .sound, let sound = store.sound(item.id) {
            Button {
                ui.editingSound = sound
            } label: {
                Label("Edit Sound", systemImage: "pencil")
            }
        }
        if item.type == .bash {
            Button {
                ui.editingBash = BashEditRequest(id: item.id)
            } label: {
                Label("Edit Bash…", systemImage: "pencil")
            }
        }
        let others = kit.sections.filter { $0.id != section.id && ($0.isAmbience ? item.type == .sound : true) }
        if !others.isEmpty {
            Menu {
                ForEach(others) { other in
                    Button(other.title) { onMoveItem(item, section.id, other.id) }
                }
            } label: {
                Label("Move to Section", systemImage: "arrow.right.square")
            }
        }
        Button(role: .destructive) {
            var s = section
            s.items.removeAll { $0 == item }
            onChange(s)
        } label: {
            Label("Remove from “\(section.title)”", systemImage: "minus.circle")
        }
    }

    private func emptyButton(_ title: String, icon: String) -> some View {
        Button(action: onAdd) {
            IconLabel(title, icon: icon)
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(Color.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: Ambience

    private var ambienceContent: some View {
        let layers = section.layers.filter { $0.kind == .builtin || store.sound(UUID(uuidString: $0.ref) ?? UUID()) != nil }
        let minWidth: CGFloat = section.size == .s ? 140 : 180
        return Group {
            if layers.isEmpty {
                emptyButton("Add rain, wind, a campfire or your own loops", icon: "layers")
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: minWidth), spacing: 8)], spacing: 8) {
                    ForEach(layers) { layer in
                        layerCard(layer)
                    }
                }
            }
        }
    }

    private func layerCard(_ layer: KitLayer) -> some View {
        let voice = section.voiceId(layer)
        let isOn = ambience.isPlaying(voice: voice)
        return VStack(alignment: .leading, spacing: 8) {
            Button {
                ambience.toggleVoice(voice, kind: layer.kind, ref: layer.ref, volume: layer.volume)
            } label: {
                HStack(spacing: 10) {
                    AppIcon(id: Self.layerIcon(layer), size: 20)
                        .foregroundStyle(isOn ? Color(hex: 0x10261D) : Color.secondary)
                        .frame(width: 30, height: 30)
                        .background(RoundedRectangle(cornerRadius: 8).fill(isOn ? ambienceColor : Color.secondary.opacity(0.15)))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(ambience.name(kind: layer.kind, ref: layer.ref))
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text(isOn ? "Playing" : "Off")
                            .font(.caption2)
                            .foregroundStyle(isOn ? ambienceColor : Color.secondary)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(isOn ? "Fades this layer out" : "Fades this layer in")
            Slider(value: Binding(
                get: { layer.volume },
                set: { volume in
                    ambience.setVoiceVolume(voice, volume: volume)
                    var s = section
                    if let i = s.layers.firstIndex(where: { $0.id == layer.id }) { s.layers[i].volume = volume }
                    onChange(s)
                }
            ), in: 0...1)
            .accessibilityLabel("Volume")
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(isOn ? ambienceColor.opacity(0.13) : Color.secondary.opacity(0.1))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(isOn ? ambienceColor : Color.secondary.opacity(0.25), lineWidth: 1)
        )
        .contextMenu {
            Button(role: .destructive) {
                ambience.stopVoice(voice)
                var s = section
                s.layers.removeAll { $0.id == layer.id }
                onChange(s)
            } label: {
                Label("Remove Layer", systemImage: "trash")
            }
        }
    }

    /// A fitting icon for a built-in loop, from its file name.
    static func layerIcon(_ layer: KitLayer) -> String {
        layerIcon(kind: layer.kind, ref: layer.ref)
    }

    static func layerIcon(kind: AmbienceLayer.Kind, ref: String) -> String {
        if kind == .sound { return "note" }
        let matches: [(String, String)] = [
            ("thunder", "storm"), ("storm", "wave"), ("rain", "rain"), ("wind", "wind"), ("ocean", "wave"), ("sea", "wave"),
            ("campfire", "campfire"), ("fire", "flame"), ("cave", "cave"), ("night", "moon"), ("forest", "pine"), ("drone", "eye"),
        ]
        return matches.first { ref.contains($0.0) }?.1 ?? "layers"
    }
}
