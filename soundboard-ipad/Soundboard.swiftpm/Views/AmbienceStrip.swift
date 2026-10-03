import SwiftUI

/// The row of ambience layers shown under the board.
struct AmbienceStrip: View {
    @EnvironmentObject private var mixer: AmbienceMixer
    @EnvironmentObject private var store: SoundStore
    @AppStorage("ambienceCollapsed") private var collapsed = false

    private let activeColor = Color(hex: 0x6EE7B7)

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { collapsed.toggle() }
                } label: {
                    Label("Ambience", systemImage: collapsed ? "chevron.right" : "chevron.down")
                        .font(.headline)
                        .foregroundStyle(mixer.playing.isEmpty ? Color.primary : activeColor)
                }
                .buttonStyle(.plain)

                Image(systemName: "speaker.wave.1.fill")
                    .foregroundStyle(.secondary)
                Slider(value: $mixer.masterVolume, in: 0...1)
                    .frame(maxWidth: 160)

                addMenu

                if mixer.kitLayersPlaying > 0 {
                    Text("+ \(mixer.kitLayersPlaying) from scene kits")
                        .font(.caption)
                        .foregroundStyle(activeColor)
                }

                Spacer(minLength: 0)

                Button("Stop Ambience") { mixer.stopAll() }
                    .buttonStyle(.bordered)
                    .disabled(mixer.playing.isEmpty)
            }

            if !collapsed {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(mixer.layers) { layer in
                            card(for: layer)
                        }
                    }
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
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
            Label("Add Layer", systemImage: "plus.circle")
        }
    }

    private func card(for layer: AmbienceLayer) -> some View {
        let isOn = mixer.isPlaying(layer)
        return VStack(alignment: .leading, spacing: 6) {
            Button {
                mixer.toggle(layer)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isOn ? "speaker.wave.2.fill" : "speaker.slash")
                        .foregroundStyle(isOn ? activeColor : .secondary)
                    Text(mixer.name(of: layer))
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
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
        .padding(10)
        .frame(width: 170)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(isOn ? activeColor.opacity(0.15) : Color.secondary.opacity(0.12))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(isOn ? activeColor : Color.secondary.opacity(0.3), lineWidth: 1)
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
