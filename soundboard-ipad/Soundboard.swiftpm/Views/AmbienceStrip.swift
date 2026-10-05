import SwiftUI

/// The row of ambience layers shown under the board.
struct AmbienceStrip: View {
    @Environment(\.appTheme) private var theme
    @EnvironmentObject private var mixer: AmbienceMixer
    @EnvironmentObject private var store: SoundStore
    @AppStorage("ambienceCollapsed") private var collapsed = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }

    private var activeColor: Color { theme.ambienceColor }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { collapsed.toggle() }
                } label: {
                    Label("Ambience", systemImage: collapsed ? "chevron.right" : "chevron.down")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(mixer.playing.isEmpty ? (theme.ink ?? Color.primary) : activeColor)
                        .lineLimit(1)
                        .fixedSize()
                }
                .buttonStyle(.plain)

                if !compact { volume.frame(minWidth: 90, maxWidth: 160) }

                addMenu

                if mixer.kitLayersPlaying > 0 {
                    Text("+\(mixer.kitLayersPlaying) from kits")
                        .font(.caption)
                        .foregroundStyle(activeColor)
                        .lineLimit(1)
                        .fixedSize()
                }

                Spacer(minLength: 0)

                Button {
                    mixer.stopAll()
                } label: {
                    IconLabel("Stop", icon: "stop", size: 12)
                        .font(.subheadline)
                        .lineLimit(1)
                        .fixedSize()
                }
                .buttonStyle(.bordered)
                .controlSize(compact ? .regular : .small)
                .disabled(mixer.playing.isEmpty)
                .accessibilityLabel("Stop ambience")
            }

            // iPhone: the master volume gets its own full-width row.
            if compact && !collapsed { volume }

            if !collapsed {
                if compact {
                    // iPhone: two columns of wider cards (longer sliders), scrolling
                    // down within a few rows rather than off the side.
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                            ForEach(mixer.layers) { layer in
                                card(for: layer)
                            }
                        }
                    }
                    .frame(maxHeight: 190)
                    .fixedSize(horizontal: false, vertical: mixer.layers.count <= 4)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(mixer.layers) { layer in
                                card(for: layer)
                            }
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var volume: some View {
        HStack(spacing: 8) {
            Image(systemName: "speaker.wave.1.fill")
                .foregroundStyle(.secondary)
            Slider(value: $mixer.masterVolume, in: 0...1)
                .accessibilityLabel("Ambience volume")
        }
    }

    private var addMenu: some View {
        Menu {
            let used = Set(mixer.layers.map { "\($0.kind.rawValue):\($0.ref)" })
            Section("Built-in loops") {
                ForEach(mixer.builtins.filter { !used.contains("builtin:\($0.file)") }) { loop in
                    Button(loop.name) { mixer.add(.builtin, ref: loop.file) }
                }
            }
            Section("Your sounds") {
                ForEach(store.sounds.filter { !used.contains("sound:\($0.id.uuidString)") }) { sound in
                    Button(sound.name) { mixer.add(.sound, ref: sound.id.uuidString) }
                }
            }
        } label: {
            Label("Add", systemImage: "plus.circle")
                .font(.subheadline)
                .lineLimit(1)
                .fixedSize()
        }
    }

    private func card(for layer: AmbienceLayer) -> some View {
        let isOn = mixer.isPlaying(layer)
        return VStack(alignment: .leading, spacing: 2) {
            Button {
                mixer.toggle(layer)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isOn ? "speaker.wave.2.fill" : "speaker.slash")
                        .foregroundStyle(isOn ? activeColor : .secondary)
                    Text(mixer.name(of: layer))
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, minHeight: compact ? 30 : nil, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(isOn ? "Fades this layer out" : "Fades this layer in")

            Slider(
                value: Binding(get: { layer.volume }, set: { mixer.setVolume($0, for: layer) }),
                in: 0...1
            )
            .accessibilityLabel("\(mixer.name(of: layer)) volume")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, compact ? 8 : 6)
        .frame(width: compact ? nil : 150)
        .frame(maxWidth: compact ? .infinity : nil)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(isOn ? activeColor.opacity(0.15) : theme.cardFill())
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(isOn ? activeColor : theme.cardStroke, lineWidth: 1)
        )
        .contextMenu {
            Button(role: .destructive) {
                mixer.remove(layer)
            } label: {
                Label("Remove Layer", systemImage: "trash")
            }
        }
    }
}
