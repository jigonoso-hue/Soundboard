import SwiftUI

/// Plays a sound, or reports why it couldn't.
@MainActor
func playSound(_ sound: Sound, store: SoundStore, player: SoundPlayer, ui: AppUI, gain: Double = 1) {
    do {
        try player.play(sound, url: store.url(for: sound), gain: gain)
    } catch {
        ui.errorMessage = "Couldn't play “\(sound.name)”."
    }
}

/// Deletes a sound and everything that points at it.
@MainActor
func deleteSound(_ sound: Sound, store: SoundStore, player: SoundPlayer, bashes: BashStore, kits: KitStore) {
    player.stop(sound.id)
    store.remove(sound.id)
    bashes.prune(soundId: sound.id)
    kits.prune(.sound, id: sound.id)
}

/// A clip: a coloured tile that plays when tapped.
struct SoundTile: View {
    @Environment(\.appTheme) private var theme
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var player: SoundPlayer
    @EnvironmentObject private var ui: AppUI
    let sound: Sound
    var size: ItemSize = .m
    /// Extra level, such as a scene kit section's volume slider.
    var gain: Double = 1

    var body: some View {
        let progress = player.progress[sound.id]
        let color = Palette.color(sound.colorIndex)
        let isPlaying = progress != nil
        Button {
            playSound(sound, store: store, player: player, ui: ui, gain: gain)
        } label: {
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(theme.tileBase)
                RoundedRectangle(cornerRadius: 14)
                    .fill(color.opacity(isPlaying ? 0.55 : 0.26))
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(color.opacity(0.7), lineWidth: 1)
                VStack(alignment: .leading, spacing: 4) {
                    Text(sound.name)
                        .font(size == .s ? Font.caption.weight(.semibold) : (size == .l ? Font.headline : Font.subheadline.weight(.semibold)))
                        .foregroundStyle(.primary)
                        .lineLimit(size == .l ? 3 : 2)
                        .multilineTextAlignment(.leading)
                    if ui.showTagsOnTiles && !sound.tagList.isEmpty && size != .s {
                        HStack(spacing: 4) {
                            ForEach(sound.tagList.prefix(2), id: \.self) { TagChip(tag: $0, small: true) }
                        }
                    }
                    if let gap = sound.repeatGap {
                        HStack(spacing: 4) {
                            AppIcon(id: "repeat", size: 11)
                            if gap > 0 { Text("\(gap.formatted())s") }
                        }
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    }
                }
                .padding(size == .s ? 8 : 10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                GeometryReader { geo in
                    Rectangle()
                        .fill(color)
                        .frame(width: geo.size.width * (progress ?? 0), height: 4)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                }
            }
            .frame(height: size == .s ? 54 : (size == .l ? 104 : 74))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .contentShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: isPlaying ? color.opacity(0.6) : .clear, radius: 10)
            .scaleEffect(isPlaying ? 1.02 : 1)
            .animation(.easeOut(duration: 0.15), value: isPlaying)
        }
        .buttonStyle(.plain)
        // A stop button on the tile while this sound is playing.
        .overlay(alignment: .bottomTrailing) {
            if isPlaying {
                Button {
                    player.stop(sound.id)
                } label: {
                    HStack(spacing: 4) {
                        AppIcon(id: "stop", size: 11)
                        Text("Stop")
                    }
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.black.opacity(0.5), in: Capsule())
                    .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .padding(8)
                .accessibilityLabel("Stop \(sound.name)")
            }
        }
        .contextMenu { SoundMenu(sound: sound) }
    }
}

/// A full sound: a row with a play button, its tags and a timer.
struct TrackRow: View {
    @Environment(\.appTheme) private var theme
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var player: SoundPlayer
    @EnvironmentObject private var ui: AppUI
    let sound: Sound
    var size: ItemSize = .m
    /// Extra level, such as a scene kit section's volume slider.
    var gain: Double = 1

    var body: some View {
        let progress = player.progress[sound.id]
        let color = Palette.color(sound.colorIndex)
        let isPlaying = progress != nil
        let total = sound.duration ?? 0
        VStack(spacing: 0) {
            Button {
                playSound(sound, store: store, player: player, ui: ui, gain: gain)
            } label: {
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(isPlaying ? color : color.opacity(0.22))
                        AppIcon(id: isPlaying ? "stop" : "play", size: 14)
                            .foregroundStyle(isPlaying ? Color.black : color)
                    }
                    .frame(width: size == .l ? 40 : 32, height: size == .l ? 40 : 32)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(sound.name)
                            .font(size == .l ? Font.headline : Font.subheadline.weight(.semibold))
                            .lineLimit(1)
                        if ui.showTagsOnTiles && !sound.tagList.isEmpty && size != .s {
                            HStack(spacing: 4) {
                                ForEach(sound.tagList.prefix(5), id: \.self) { TagChip(tag: $0, small: true) }
                            }
                        }
                    }
                    Spacer(minLength: 8)
                    if let gap = sound.repeatGap {
                        HStack(spacing: 3) {
                            AppIcon(id: "repeat", size: 11)
                            if gap > 0 { Text("\(gap.formatted())s") }
                        }
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    }
                    Text(isPlaying ? "\(TimeText.format((progress ?? 0) * total)) / \(TimeText.format(total))" : (total > 0 ? TimeText.format(total) : ""))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, size == .s ? 4 : 7)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Volume, like an ambience layer, while it plays.
            if isPlaying {
                HStack(spacing: 8) {
                    Image(systemName: "speaker.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Slider(
                        value: Binding(
                            get: { player.volumes[sound.id] ?? sound.volume },
                            set: { player.setVolume($0, for: sound.id) }
                        ),
                        in: 0...1,
                        onEditingChanged: { editing in
                            // Keep the new level for next time.
                            guard !editing, let volume = player.volumes[sound.id], var current = store.sound(sound.id) else { return }
                            current.volume = volume
                            store.update(current)
                        }
                    )
                    .tint(color)
                    .accessibilityLabel("\(sound.name) volume")
                    Image(systemName: "speaker.wave.3.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .padding(.leading, size == .l ? 62 : 54)
                .padding(.trailing, 12)
                .padding(.bottom, 8)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(theme.cardFill(active: isPlaying))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(theme.cardStroke, lineWidth: theme.hasBackdrop ? 1 : 0)
        )
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 3).padding(.vertical, 8)
        }
        .overlay(alignment: .bottomLeading) {
            GeometryReader { geo in
                Rectangle()
                    .fill(color.opacity(0.8))
                    .frame(width: geo.size.width * (progress ?? 0), height: 3)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            }
            .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .animation(.easeOut(duration: 0.2), value: isPlaying)
        .contextMenu { SoundMenu(sound: sound) }
    }
}

/// Long-press menu for a sound.
struct SoundMenu: View {
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var player: SoundPlayer
    @EnvironmentObject private var ambience: AmbienceMixer
    @EnvironmentObject private var bashes: BashStore
    @EnvironmentObject private var kits: KitStore
    @EnvironmentObject private var ui: AppUI
    let sound: Sound

    var body: some View {
        Button {
            ui.editingSound = sound
        } label: {
            Label("Edit", systemImage: "pencil")
        }
        if player.progress[sound.id] != nil {
            Button {
                player.stop(sound.id)
            } label: {
                Label("Stop", systemImage: "stop.fill")
            }
        }
        Button {
            ambience.add(.sound, ref: sound.id.uuidString)
        } label: {
            Label("Add to Ambience", systemImage: "square.3.layers.3d")
        }
        Menu {
            ForEach(bashes.bashes) { bash in
                Button(bash.name) { bashes.addSounds([sound.id], to: bash.id) }
            }
            Divider()
            Button {
                let bash = bashes.create(name: sound.name, soundIds: [sound.id])
                ui.editingBash = BashEditRequest(id: bash.id)
            } label: {
                Label("New Bash with This Sound", systemImage: "plus")
            }
        } label: {
            Label("Add to Bash", systemImage: "bolt")
        }
        Button {
            ui.choosingKitFor = KitChoice(item: KitItem(type: .sound, id: sound.id), label: sound.name)
        } label: {
            Label("Add to Scene Kit…", systemImage: "square.grid.2x2")
        }
        Divider()
        Button(role: .destructive) {
            deleteSound(sound, store: store, player: player, bashes: bashes, kits: kits)
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }
}
