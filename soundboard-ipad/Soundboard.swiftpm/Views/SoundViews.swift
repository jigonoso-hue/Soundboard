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
        // Sci-Fi tiles are see-through glass with a glowing edge and a synth wave while playing.
        let scifi = theme == .scifi
        // Dark Academia tiles are leather book covers that glow with magic while playing.
        let book = theme == .academia
        let shape = book
            ? AnyShape(UnevenRoundedRectangle(topLeadingRadius: 3, bottomLeadingRadius: 3, bottomTrailingRadius: 8, topTrailingRadius: 8))
            : AnyShape(RoundedRectangle(cornerRadius: 14))
        Button {
            playSound(sound, store: store, player: player, ui: ui, gain: gain)
        } label: {
            ZStack(alignment: .bottomLeading) {
                if book {
                    BookCover(seed: sound.id.uuidString, color: color, emblem: size == .l).equatable()
                    if isPlaying {
                        MagicGlow(color: color)
                    }
                } else {
                    plainTile(color: color, isPlaying: isPlaying, scifi: scifi)
                }
                VStack(alignment: book ? .center : .leading, spacing: 4) {
                    Text(sound.name)
                        .font(size == .s ? Font.caption.weight(.semibold) : (size == .l ? Font.headline : Font.subheadline.weight(.semibold)))
                        .italic(book)
                        .foregroundStyle(.primary)
                        .lineLimit(size == .l ? 3 : 2)
                        .multilineTextAlignment(book ? .center : .leading)
                        .shadow(color: book ? .black.opacity(0.6) : .clear, radius: 2, y: 1)
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
                    if sound.gmOnly == true && size != .s { GMBadge() }
                }
                .padding(size == .s ? 8 : 10)
                .padding(.leading, book ? 12 : 0)
                .padding(.top, book ? 2 : 0)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: book ? .top : .topLeading)
                GeometryReader { geo in
                    Rectangle()
                        .fill(color)
                        .frame(width: geo.size.width * (progress ?? 0), height: 4)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                }
            }
            .frame(height: size == .s ? 54 : (size == .l ? 104 : 74))
            .clipShape(shape)
            .contentShape(shape)
            .shadow(color: book && isPlaying ? Color(hex: 0xFFD27A).opacity(0.85) : .clear, radius: 12)
            .shadow(color: book ? (isPlaying ? color.opacity(0.9) : .black.opacity(0.5)) : .clear, radius: book && isPlaying ? 22 : 3, y: book && isPlaying ? 0 : 2)
            .shadow(color: book ? .clear : (scifi ? color.opacity(isPlaying ? 0.8 : 0.35) : (isPlaying ? color.opacity(0.6) : .clear)),
                    radius: scifi ? (isPlaying ? 12 : 6) : 10)
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

    /// The tile's colour, edge and (in Sci-Fi) glow and synth wave.
    @ViewBuilder
    private func plainTile(color: Color, isPlaying: Bool, scifi: Bool) -> some View {
        RoundedRectangle(cornerRadius: 14)
            .fill(scifi ? Color(hex: 0x081E36).opacity(0.35) : theme.tileBase)
        RoundedRectangle(cornerRadius: 14)
            .fill(color.opacity(scifi ? (isPlaying ? 0.3 : 0.12) : (isPlaying ? 0.55 : 0.26)))
        if scifi && isPlaying {
            SynthWave(color: color)
                .padding(.vertical, 6)
        }
        if scifi {
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(color, lineWidth: isPlaying ? 4 : 3)
                .blur(radius: isPlaying ? 6 : 4)
                .opacity(isPlaying ? 0.9 : 0.6)
        }
        RoundedRectangle(cornerRadius: 14)
            .strokeBorder(color.opacity(scifi ? 0.95 : 0.7), lineWidth: scifi ? 1.5 : 1)
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
    /// What tapping it does instead of playing it (a playlist starts from it).
    var onPlay: (() -> Void)? = nil
    /// The song a playlist is on: marked with an accent edge.
    var current = false

    var body: some View {
        let progress = player.progress[sound.id]
        let color = Palette.color(sound.colorIndex)
        let isPlaying = progress != nil
        let total = sound.duration ?? 0
        VStack(spacing: 0) {
            Button {
                if let onPlay { onPlay() } else { playSound(sound, store: store, player: player, ui: ui, gain: gain) }
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
                    if sound.gmOnly == true { GMBadge() }
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
        .background {
            if theme == .scifi && isPlaying {
                SynthWave(color: color).opacity(0.5).padding(.vertical, 4)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(theme.cardStroke, lineWidth: theme.hasBackdrop ? 1 : 0)
        )
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2).fill(current ? Color.accentColor : color).frame(width: current ? 4 : 3).padding(.vertical, current ? 0 : 8)
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
                guard Premium.shared.allows(.bashes, count: bashes.bashes.count) else { return }
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

/// Glowing synth waves that ripple across a playing sound in the Sci-Fi theme.
struct SynthWave: View {
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            Canvas { context, size in
                let time = timeline.date.timeIntervalSinceReferenceDate
                SynthWave.draw(&context, size: size, time: reduceMotion ? 0 : time, color: color)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func draw(_ context: inout GraphicsContext, size: CGSize, time: Double, color: Color) {
        let w = size.width
        let h = size.height
        guard w > 4, h > 4 else { return }
        // (height, waves across, speed, opacity)
        let waves: [(CGFloat, CGFloat, Double, Double)] = [(0.3, 2.2, 3.2, 0.95), (0.2, 3.4, -2.3, 0.6), (0.13, 5.1, 4.1, 0.4)]
        var glow = context
        glow.addFilter(.blur(radius: 4))
        for (index, wave) in waves.enumerated() {
            var path = Path()
            let steps = max(24, Int(w / 3))
            for step in 0...steps {
                let f = CGFloat(step) / CGFloat(steps)
                // Taper the ends so the wave fades into the tile's edges.
                let envelope = sin(f * .pi)
                let phase = CGFloat(time * wave.2) + CGFloat(index) * 1.7
                let y = h / 2 + sin(f * wave.1 * .pi * 2 + phase) * wave.0 * h * envelope
                let point = CGPoint(x: f * w, y: y)
                if step == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
            glow.stroke(path, with: .color(color.opacity(wave.3 * 0.8)), lineWidth: 4)
            context.stroke(path, with: .color(color.opacity(wave.3)), lineWidth: 1.5)
        }
    }
}

/// Marks sounds that never play for Live Session listeners.
struct GMBadge: View {
    var body: some View {
        Text("Only me")
            .font(.caption2.weight(.heavy))
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(Color(hex: 0xFF6A3D).opacity(0.3), in: Capsule())
            .accessibilityLabel("Broadcaster only")
    }
}
