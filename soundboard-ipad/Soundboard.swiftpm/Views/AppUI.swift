import SwiftUI

/// What the main area shows.
enum Destination: Hashable {
    case all, clips, full, bashes
    case kit(UUID)
}

enum SoundSort: String, CaseIterable {
    case custom, name, newest, longest

    var label: String {
        switch self {
        case .custom: return "My order"
        case .name: return "Name"
        case .newest: return "Newest first"
        case .longest: return "Longest first"
        }
    }
}

/// UI state shared by the sidebar, the boards and their sheets: search,
/// tag filters, sort, and which editor is open.
@MainActor
final class AppUI: ObservableObject {
    @Published var search = ""
    @Published var tagFilter: [String] = []
    @Published var matchAllTags: Bool {
        didSet { UserDefaults.standard.set(matchAllTags, forKey: "matchAllTags") }
    }
    @Published var sort: SoundSort {
        didSet { UserDefaults.standard.set(sort.rawValue, forKey: "sort") }
    }
    @Published var tagsOpen: Bool {
        didSet { UserDefaults.standard.set(tagsOpen, forKey: "tagsOpen") }
    }
    @Published var bashesCollapsed: Bool {
        didSet { UserDefaults.standard.set(bashesCollapsed, forKey: "bashesCollapsed") }
    }

    @Published var editingSound: Sound?
    @Published var editingBash: BashEditRequest?
    @Published var editingKit: KitEditRequest?
    @Published var choosingKitFor: KitChoice?
    @Published var errorMessage: String?
    /// The scene kit library panel, and the section it adds to.
    @Published var kitDrawerOpen = false
    @Published var kitDrawerTarget: UUID?

    init() {
        let defaults = UserDefaults.standard
        matchAllTags = defaults.bool(forKey: "matchAllTags")
        sort = SoundSort(rawValue: defaults.string(forKey: "sort") ?? "") ?? .custom
        tagsOpen = defaults.bool(forKey: "tagsOpen")
        bashesCollapsed = defaults.bool(forKey: "bashesCollapsed")
    }

    var isFiltering: Bool {
        !search.trimmingCharacters(in: .whitespaces).isEmpty || !tagFilter.isEmpty
    }

    func toggleTag(_ tag: String) {
        if let index = tagFilter.firstIndex(of: tag) { tagFilter.remove(at: index) } else { tagFilter.append(tag) }
    }

    /// Search matches names and tags; tag filters need any (or all) of the selected tags.
    func matches(_ sound: Sound) -> Bool {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        if !query.isEmpty {
            let inName = sound.name.lowercased().contains(query)
            let inTags = sound.tagList.contains { $0.contains(query) }
            if !inName && !inTags { return false }
        }
        if !tagFilter.isEmpty {
            let tags = Set(sound.tagList)
            if matchAllTags {
                if !tagFilter.allSatisfy(tags.contains) { return false }
            } else if !tagFilter.contains(where: tags.contains) {
                return false
            }
        }
        return true
    }

    func sorted(_ sounds: [Sound]) -> [Sound] {
        switch sort {
        case .custom: return sounds
        case .name: return sounds.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .newest: return sounds.sorted { $0.createdAt > $1.createdAt }
        case .longest: return sounds.sorted { ($0.duration ?? 0) > ($1.duration ?? 0) }
        }
    }
}

struct BashEditRequest: Identifiable {
    let id: UUID
}

struct KitEditRequest: Identifiable {
    let id = UUID()
    /// nil for a new kit.
    let kitId: UUID?
    /// Something to add to the new kit once it's made.
    var thenAdd: KitItem? = nil
}

/// "Add to Scene Kit" for one sound or bash.
struct KitChoice: Identifiable {
    let id = UUID()
    let item: KitItem
    let label: String
}

// MARK: - Small shared pieces

/// A small coloured pill for a tag.
struct TagChip: View {
    let tag: String
    var selected = false
    var small = false
    /// Text to show instead of the tag name (the colour still comes from the tag).
    var label: String? = nil

    var body: some View {
        let color = TagStyle.color(tag)
        Text(label ?? tag)
            .font(small ? .caption2.weight(.semibold) : .caption.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, small ? 6 : 9)
            .padding(.vertical, small ? 2 : 4)
            .foregroundStyle(selected ? Color.black : color)
            .background(Capsule().fill(selected ? color : color.opacity(0.16)))
            .overlay(Capsule().strokeBorder(color.opacity(selected ? 0 : 0.45), lineWidth: 1))
    }
}

/// Chips that wrap onto several lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: proposal.width ?? widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// Every known tag as a chip to toggle, plus a field for a new tag.
struct TagPicker: View {
    @EnvironmentObject private var store: SoundStore
    @Binding var selected: [String]
    @State private var newTag = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            FlowLayout(spacing: 6) {
                ForEach(tags, id: \.self) { tag in
                    Button {
                        if let index = selected.firstIndex(of: tag) { selected.remove(at: index) } else { selected.append(tag) }
                    } label: {
                        TagChip(tag: tag, selected: selected.contains(tag))
                    }
                    .buttonStyle(.plain)
                }
            }
            TextField("New tag", text: $newTag)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .submitLabel(.done)
                .onSubmit {
                    if let tag = store.addTag(newTag), !selected.contains(tag) { selected.append(tag) }
                    newTag = ""
                }
        }
    }

    private var tags: [String] {
        var all = store.allTags
        for tag in selected where !all.contains(tag) { all.append(tag) }
        return all
    }
}

/// Clip / Full sound switch.
struct KindPicker: View {
    @Binding var kind: SoundKind

    var body: some View {
        Picker("Type", selection: $kind) {
            ForEach(SoundKind.allCases, id: \.self) { kind in
                Text(kind.label).tag(kind)
            }
        }
        .pickerStyle(.segmented)
    }
}

/// A section title with one of the app's icons.
struct BlockTitle: View {
    let title: String
    let icon: String
    var count: Int? = nil

    var body: some View {
        HStack(spacing: 8) {
            AppIcon(id: icon, size: 16)
            Text(title.uppercased())
                .font(.footnote.weight(.bold))
                .tracking(0.6)
            if let count, count > 0 {
                Text("\(count)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(Color.primary.opacity(0.85))
    }
}
