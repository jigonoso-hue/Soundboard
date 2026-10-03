import PhotosUI
import SwiftUI
import UIKit

/// Full-screen bash editor: arrange when each sound starts on a timeline,
/// layer sounds on lanes, set volumes and repeats, and pick a cover.
struct BashEditorView: View {
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var bashes: BashStore
    @EnvironmentObject private var bashPlayer: BashPlayer
    @EnvironmentObject private var player: SoundPlayer
    @Environment(\.dismiss) private var dismiss

    let original: Bash
    @State private var draft: Bash
    @State private var selected: UUID?
    @State private var zoom: Double = 70 // points per second
    @State private var playhead: Double = 0
    @State private var dragOrigin: DragOrigin?
    @State private var showCover = false
    @State private var showAddSounds = false
    @State private var confirmClose = false
    @State private var photoItem: PhotosPickerItem?
    @State private var pendingImage: Data?
    @State private var removePhoto = false
    @State private var errorMessage: String?

    private let laneHeight: CGFloat = 58
    private let rulerHeight: CGFloat = 30

    struct DragOrigin {
        let clipId: UUID
        let offset: Double
        let lane: Int
    }

    init(bash: Bash) {
        original = bash
        _draft = State(initialValue: bash)
    }

    private var isDirty: Bool { draft != original || pendingImage != nil || removePhoto }
    private var isPlaying: Bool { bashPlayer.isPlaying(draft.id) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header
                Divider()
                timeline
                Divider()
                inspector
            }
            .navigationTitle(draft.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        if isDirty { confirmClose = true } else { close() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                        close()
                    }
                }
            }
            .confirmationDialog("Save changes to “\(draft.name)”?", isPresented: $confirmClose, titleVisibility: .visible) {
                Button("Save") {
                    save()
                    close()
                }
                Button("Don't Save", role: .destructive) { close() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("If you don't save, your changes to this bash will be lost.")
            }
            .sheet(isPresented: $showAddSounds) {
                AddSoundsToBashView { ids in addSounds(ids) }
            }
            .sheet(isPresented: $showCover) { coverSheet }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                photoItem = nil
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let jpeg = Self.coverJPEG(data) {
                        pendingImage = jpeg
                        removePhoto = false
                    } else {
                        errorMessage = "Couldn't use that picture."
                    }
                }
            }
            .alert("Something went wrong", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .onDisappear {
                if isPlaying { bashPlayer.stop() }
            }
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 14) {
            Button {
                showCover = true
            } label: {
                coverPreview(size: 52)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Change cover")

            TextField("Bash name", text: $draft.name)
                .font(.title3.weight(.semibold))
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 320)

            Button {
                togglePlay()
            } label: {
                IconLabel(isPlaying ? "Stop" : "Play", icon: isPlaying ? "stop" : "play")
            }
            .buttonStyle(.borderedProminent)
            .disabled(draft.clips.isEmpty)

            Text(timeText)
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)

            Spacer(minLength: 8)

            HStack(spacing: 6) {
                Image(systemName: "minus.magnifyingglass").foregroundStyle(.secondary)
                Slider(value: $zoom, in: 20...240)
                    .frame(width: 120)
                Image(systemName: "plus.magnifyingglass").foregroundStyle(.secondary)
            }

            Button {
                showAddSounds = true
            } label: {
                IconLabel("Add Sounds", icon: "plus")
            }
            .buttonStyle(.bordered)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private func coverPreview(size: CGFloat) -> some View {
        if let pendingImage, let image = UIImage(data: pendingImage) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
        } else {
            BashCoverView(cover: displayedCover, size: size)
        }
    }

    /// The cover as it will look once saved.
    private var displayedCover: BashCover {
        var cover = draft.cover
        if removePhoto { cover.imageFile = nil }
        return cover
    }

    private var coverSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 16) {
                        coverPreview(size: 76)
                        VStack(alignment: .leading, spacing: 8) {
                            PhotosPicker(selection: $photoItem, matching: .images) {
                                Label("Use a Photo…", systemImage: "photo")
                            }
                            .buttonStyle(.bordered)
                            if pendingImage != nil || (draft.cover.imageFile != nil && !removePhoto) {
                                Button("Use the Icon Instead") {
                                    pendingImage = nil
                                    removePhoto = draft.cover.imageFile != nil
                                }
                                .font(.callout)
                            }
                        }
                    }
                    IconPickerView(
                        icon: Binding(get: { draft.cover.icon }, set: { draft.cover.icon = $0; useIcon() }),
                        color: Binding(get: { draft.cover.color }, set: { draft.cover.color = $0; useIcon() }),
                        iconColor: Binding(get: { draft.cover.iconColor }, set: { draft.cover.iconColor = $0; useIcon() })
                    )
                }
                .padding()
            }
            .navigationTitle("Cover")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { showCover = false }
                }
            }
        }
    }

    /// Picking an icon or colour switches the cover back from a photo.
    private func useIcon() {
        pendingImage = nil
        if draft.cover.imageFile != nil { removePhoto = true }
    }

    // MARK: Timeline

    private var laneCount: Int { (draft.clips.map(\.lane).max() ?? -1) + 2 }

    private func length(_ clip: BashClip) -> Double {
        max(0.1, store.sound(clip.soundId)?.duration ?? 1)
    }

    /// Seconds shown on the timeline.
    private var visibleSeconds: Double {
        var end = 8.0
        for clip in draft.clips {
            let len = length(clip)
            end = max(end, (clip.end(length: len) ?? (clip.offset + len * 4 + (clip.repetition?.gap ?? 0) * 3)) + 4)
        }
        return end
    }

    private var timeline: some View {
        let width = CGFloat(visibleSeconds * zoom) + 40
        let height = rulerHeight + CGFloat(laneCount) * laneHeight
        return ScrollView([.horizontal, .vertical]) {
            ZStack(alignment: .topLeading) {
                lanesBackground(width: width)
                ruler(width: width)
                ForEach(draft.clips) { clip in
                    repeatGhosts(clip)
                    clipView(clip)
                }
                playheadLine(height: height)
            }
            .frame(width: width, height: max(height, 200), alignment: .topLeading)
        }
        .frame(maxHeight: .infinity)
        .background(Color.black.opacity(0.25))
        .overlay {
            if draft.clips.isEmpty {
                VStack(spacing: 8) {
                    Text("No sounds yet").font(.headline)
                    Text("Tap Add Sounds. Each sound gets its own lane and starts at the playhead.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .allowsHitTesting(false)
            }
        }
    }

    private func lanesBackground(width: CGFloat) -> some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: rulerHeight)
            ForEach(0..<laneCount, id: \.self) { lane in
                Rectangle()
                    .fill(lane % 2 == 0 ? Color.white.opacity(0.03) : Color.clear)
                    .frame(width: width, height: laneHeight)
                    .overlay(alignment: .bottom) { Divider() }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { selected = nil }
    }

    private func ruler(width: CGFloat) -> some View {
        Canvas { context, size in
            let seconds = Int(visibleSeconds)
            let step = zoom >= 60 ? 1 : (zoom >= 30 ? 2 : 5)
            for second in stride(from: 0, through: seconds, by: step) {
                let x = CGFloat(Double(second) * zoom)
                var tick = Path()
                tick.move(to: CGPoint(x: x, y: size.height - 8))
                tick.addLine(to: CGPoint(x: x, y: size.height))
                context.stroke(tick, with: .color(.secondary), lineWidth: 1)
                context.draw(
                    Text(TimeText.format(Double(second)).replacingOccurrences(of: ".0", with: "")).font(.caption2).foregroundColor(.secondary),
                    at: CGPoint(x: x + 3, y: 10),
                    anchor: .leading
                )
            }
        }
        .frame(width: width, height: rulerHeight)
        .background(Color.secondary.opacity(0.1))
        .contentShape(Rectangle())
        .onTapGesture { location in
            playhead = max(0, Double(location.x) / zoom)
            if isPlaying { bashPlayer.play(draft, store: store, masterVolume: player.masterVolume, from: playhead) }
        }
    }

    private func clipView(_ clip: BashClip) -> some View {
        let sound = store.sound(clip.soundId)
        let color = Palette.color(sound?.colorIndex ?? 0)
        let isSelected = selected == clip.id
        return RoundedRectangle(cornerRadius: 8)
            .fill(color.opacity(0.35 + clip.volume * 0.45))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(isSelected ? Color.white : color, lineWidth: isSelected ? 2 : 1)
            )
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(sound?.name ?? "Missing sound")
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    if let repetition = clip.repetition {
                        HStack(spacing: 3) {
                            AppIcon(id: "repeat", size: 10)
                            Text(repetition.times > 0 ? "×\(repetition.times)" : "∞")
                        }
                        .font(.caption2.weight(.bold))
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
            }
            .frame(width: max(14, CGFloat(length(clip) * zoom)), height: laneHeight - 10)
            .offset(x: CGFloat(clip.offset * zoom), y: rulerHeight + CGFloat(clip.lane) * laneHeight + 5)
            .onTapGesture { selected = clip.id }
            .gesture(
                DragGesture(minimumDistance: 4)
                    .onChanged { value in
                        if dragOrigin?.clipId != clip.id {
                            dragOrigin = DragOrigin(clipId: clip.id, offset: clip.offset, lane: clip.lane)
                            selected = clip.id
                        }
                        guard let origin = dragOrigin, let index = draft.clips.firstIndex(where: { $0.id == clip.id }) else { return }
                        let seconds = origin.offset + Double(value.translation.width) / zoom
                        draft.clips[index].offset = min(BashStore.maxOffset, max(0, (seconds * 10).rounded() / 10))
                        draft.clips[index].lane = max(0, origin.lane + Int((value.translation.height / laneHeight).rounded()))
                    }
                    .onEnded { _ in dragOrigin = nil }
            )
    }

    /// Faded copies showing when a repeating clip plays again.
    @ViewBuilder
    private func repeatGhosts(_ clip: BashClip) -> some View {
        if let repetition = clip.repetition {
            let len = length(clip)
            let period = len + repetition.gap
            let plays = repetition.times > 0 ? repetition.times : Int.max
            let visible = min(plays - 1, Int((visibleSeconds - clip.offset) / max(0.1, period)), 40)
            if visible > 0 {
                ForEach(1...visible, id: \.self) { k in
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.white.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.05)))
                        .frame(width: max(14, CGFloat(len * zoom)), height: laneHeight - 10)
                        .offset(x: CGFloat((clip.offset + Double(k) * period) * zoom), y: rulerHeight + CGFloat(clip.lane) * laneHeight + 5)
                        .allowsHitTesting(false)
                }
            }
        }
    }

    private func playheadLine(height: CGFloat) -> some View {
        let position = isPlaying ? bashPlayer.position : playhead
        return Rectangle()
            .fill(Color(hex: 0xFFE156))
            .frame(width: 2, height: max(height, 200))
            .offset(x: CGFloat(position * zoom))
            .allowsHitTesting(false)
    }

    private var timeText: String {
        let position = isPlaying ? bashPlayer.position : playhead
        var total: Double? = 0
        for clip in draft.clips {
            guard let end = clip.end(length: length(clip)) else { total = nil; break }
            total = max(total ?? 0, end)
        }
        return "\(TimeText.format(position)) / " + (total.map { TimeText.format($0) } ?? "∞ (repeats until stopped)")
    }

    // MARK: Inspector

    /// A binding to one field of a clip, found by id each time (safe while clips are removed).
    private func clipBinding<T>(_ id: UUID, _ keyPath: WritableKeyPath<BashClip, T>, fallback: T) -> Binding<T> {
        Binding(
            get: { draft.clips.first(where: { $0.id == id })?[keyPath: keyPath] ?? fallback },
            set: { value in
                if let index = draft.clips.firstIndex(where: { $0.id == id }) { draft.clips[index][keyPath: keyPath] = value }
            }
        )
    }

    private func updateClip(_ id: UUID, _ change: (inout BashClip) -> Void) {
        if let index = draft.clips.firstIndex(where: { $0.id == id }) { change(&draft.clips[index]) }
    }

    private var selectedIndex: Int? {
        guard let selected else { return nil }
        return draft.clips.firstIndex { $0.id == selected }
    }

    @ViewBuilder
    private var inspector: some View {
        if let index = selectedIndex {
            let clip = draft.clips[index]
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .center, spacing: 22) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.sound(clip.soundId)?.name ?? "Missing sound").font(.headline).lineLimit(1)
                        Text("Lane \(clip.lane + 1)").font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: 200, alignment: .leading)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Starts at").font(.caption).foregroundStyle(.secondary)
                        Stepper(TimeText.format(clip.offset), value: Binding(
                            get: { clip.offset },
                            set: { value in updateClip(clip.id) { $0.offset = min(BashStore.maxOffset, max(0, (value * 10).rounded() / 10)) } }
                        ), in: 0...BashStore.maxOffset, step: 0.1)
                        .monospacedDigit()
                        .frame(width: 190)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Volume \(Int(clip.volume * 100))%").font(.caption).foregroundStyle(.secondary)
                        Slider(value: clipBinding(clip.id, \.volume, fallback: 1), in: 0...1)
                            .frame(width: 150)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Repeat", isOn: Binding(
                            get: { clip.repetition != nil },
                            set: { on in updateClip(clip.id) { $0.repetition = on ? ClipRepeat(gap: 0, times: 0) : nil } }
                        ))
                        .frame(width: 140)
                        if clip.repetition != nil {
                            HStack(spacing: 14) {
                                Stepper("Gap \(String(format: "%.1f", clip.repetition?.gap ?? 0))s", value: Binding(
                                    get: { clip.repetition?.gap ?? 0 },
                                    set: { value in updateClip(clip.id) { $0.repetition?.gap = max(0, min(3600, (value * 10).rounded() / 10)) } }
                                ), in: 0...3600, step: 0.5)
                                .frame(width: 170)
                                Stepper((clip.repetition?.times ?? 0) == 0 ? "Plays: until stopped" : "Plays: \(clip.repetition?.times ?? 0)", value: Binding(
                                    get: { clip.repetition?.times ?? 0 },
                                    set: { value in
                                        // 0 = until stopped; otherwise at least 2 plays.
                                        let current = clip.repetition?.times ?? 0
                                        var next = value
                                        if current == 0 && value == 1 { next = 2 }
                                        if current == 2 && value == 1 { next = 0 }
                                        updateClip(clip.id) { $0.repetition?.times = max(0, min(999, next)) }
                                    }
                                ), in: 0...999)
                                .frame(width: 240)
                            }
                        }
                    }

                    Button {
                        duplicate(clip)
                    } label: {
                        Label("Duplicate", systemImage: "plus.square.on.square")
                    }
                    .buttonStyle(.bordered)
                    Button(role: .destructive) {
                        let id = clip.id
                        selected = nil
                        draft.clips.removeAll { $0.id == id }
                    } label: {
                        Label("Remove", systemImage: "trash")
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal)
                .padding(.vertical, 12)
            }
            .frame(height: clip.repetition != nil ? 110 : 80)
        } else {
            Text("Tap a sound to edit it. Drag sounds left or right to change when they start, and up or down to move them between lanes. Tap the ruler to move the playhead.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
    }

    // MARK: Actions

    private func togglePlay() {
        if isPlaying {
            playhead = 0
            bashPlayer.stop()
        } else {
            bashPlayer.play(draft, store: store, masterVolume: player.masterVolume, from: playhead)
        }
    }

    private func addSounds(_ ids: [UUID]) {
        var lane = laneCount - 1
        for id in ids {
            let clip = BashClip(id: UUID(), soundId: id, offset: (playhead * 10).rounded() / 10, volume: 1, lane: lane)
            draft.clips.append(clip)
            selected = clip.id
            lane += 1
        }
    }

    private func duplicate(_ clip: BashClip) {
        var copy = clip
        copy.id = UUID()
        copy.lane = laneCount - 1
        draft.clips.append(copy)
        selected = copy.id
    }

    private func save() {
        var next = draft
        if removePhoto { next.cover.imageFile = nil }
        bashes.update(next)
        if let pendingImage {
            do {
                try bashes.setCoverImage(next.id, data: pendingImage)
            } catch {
                errorMessage = "Couldn't save the cover picture."
            }
        }
    }

    private func close() {
        if isPlaying { bashPlayer.stop() }
        dismiss()
    }

    /// Shrinks a picked picture to a square-ish cover-sized JPEG.
    static func coverJPEG(_ data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let maxSide: CGFloat = 600
        let scale = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: size)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return resized.jpegData(compressionQuality: 0.85)
    }
}

/// Pick sounds from the library to add to a bash.
struct AddSoundsToBashView: View {
    @EnvironmentObject private var store: SoundStore
    @Environment(\.dismiss) private var dismiss
    let onAdd: ([UUID]) -> Void

    @State private var search = ""
    @State private var picked: [UUID] = []

    var body: some View {
        NavigationStack {
            List(filtered) { sound in
                Button {
                    if let index = picked.firstIndex(of: sound.id) { picked.remove(at: index) } else { picked.append(sound.id) }
                } label: {
                    HStack(spacing: 10) {
                        Circle().fill(Palette.color(sound.colorIndex)).frame(width: 10, height: 10)
                        AppIcon(id: sound.isFull ? "note" : "scissors", size: 14).foregroundStyle(.secondary)
                        Text(sound.name).foregroundStyle(Color.primary).lineLimit(1)
                        Spacer()
                        if let duration = sound.duration {
                            Text(TimeText.format(duration)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        Image(systemName: picked.contains(sound.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(picked.contains(sound.id) ? Color.accentColor : Color.secondary)
                    }
                }
            }
            .searchable(text: $search, prompt: "Search sounds and tags")
            .overlay {
                if store.sounds.isEmpty {
                    ContentUnavailableView("No sounds yet", systemImage: "speaker.wave.3", description: Text("Add sounds to your library first."))
                }
            }
            .navigationTitle("Add Sounds")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(picked.isEmpty ? "Add" : "Add \(picked.count)") {
                        onAdd(picked)
                        dismiss()
                    }
                    .disabled(picked.isEmpty)
                }
            }
        }
    }

    private var filtered: [Sound] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return store.sounds }
        return store.sounds.filter { $0.name.lowercased().contains(query) || $0.tagList.contains { $0.contains(query) } }
    }
}
