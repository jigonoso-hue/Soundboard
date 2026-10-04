import SwiftUI

/// What a player sees while tuned in: a full-screen stage that stays up until
/// they leave. Radio waves pulse out from the tower while sounds play; whispers
/// glow purple, buzz sounds shake the screen; the player's own sound pads sit at
/// the bottom when the GM allows them.
struct ListenerStageView: View {
    @EnvironmentObject private var live: LiveSession
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showVolumes = false
    @State private var choosingSounds = false
    @State private var whisperGlow = false
    @State private var buzzFlash = false
    @State private var shake: CGFloat = 0
    @State private var confirmLeave = false

    private var playing: Bool { !live.nowPlaying.isEmpty }

    var body: some View {
        ZStack {
            StageBackground(active: playing, reduceMotion: reduceMotion)
                .ignoresSafeArea()
            if whisperGlow {
                RadialGradient(colors: [.clear, Color(hex: 0xB07CFF).opacity(0.55)], center: .center, startRadius: 120, endRadius: 700)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
            if buzzFlash {
                Color(hex: 0xFF6A3D).opacity(0.28)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 12)
                center
                Spacer(minLength: 12)
                if live.allowedPlayerSounds != .off {
                    PlayerPads(choose: { choosingSounds = true })
                        .padding(.bottom, 14)
                }
                bottomBar
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .frame(maxWidth: 760)

            if whisperGlow {
                VStack(spacing: 6) {
                    Image(systemName: "ear.fill").font(.title)
                    Text("A whisper only you can hear…")
                        .font(.title3.italic())
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 22)
                .padding(.vertical, 14)
                .background(Color(hex: 0x2A1546).opacity(0.85), in: RoundedRectangle(cornerRadius: 18))
                .transition(.scale.combined(with: .opacity))
                .allowsHitTesting(false)
            }
        }
        .modifier(ShakeEffect(amount: shake))
        .foregroundStyle(.white)
        .preferredColorScheme(.dark)
        .onChange(of: live.whisperPulse) { _, _ in
            withAnimation(.easeOut(duration: 0.4)) { whisperGlow = true }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 2_800_000_000)
                withAnimation(.easeIn(duration: 0.8)) { whisperGlow = false }
            }
        }
        .onChange(of: live.buzzPulse) { _, _ in
            if !reduceMotion { withAnimation(.linear(duration: 0.45)) { shake += 1 } }
            withAnimation(.easeOut(duration: 0.1)) { buzzFlash = true }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 350_000_000)
                withAnimation(.easeIn(duration: 0.5)) { buzzFlash = false }
            }
        }
        .sheet(isPresented: $showVolumes) {
            LiveVolumesView()
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $choosingSounds) {
            PlayerSoundPicker()
        }
        .confirmationDialog("Leave the session?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave Session", role: .destructive) { live.leave() }
        }
    }

    private var topBar: some View {
        HStack {
            HStack(spacing: 6) {
                Circle()
                    .fill(live.connected ? Color(hex: 0xFF4A3D) : .gray)
                    .frame(width: 8, height: 8)
                    .shadow(color: Color(hex: 0xFF4A3D), radius: live.connected ? 6 : 0)
                Text(live.connected ? "LIVE" : "CONNECTING")
                    .font(.caption.weight(.heavy))
                    .tracking(1.5)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.white.opacity(0.1), in: Capsule())
            Spacer()
            Button {
                showVolumes = true
            } label: {
                Label("Volumes", systemImage: "slider.horizontal.3")
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.white.opacity(0.1), in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    private var center: some View {
        VStack(spacing: 14) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.system(size: 76, weight: .semibold))
                .foregroundStyle(LinearGradient(colors: [Color(hex: 0xFFB35C), Color(hex: 0xFF6A3D)], startPoint: .top, endPoint: .bottom))
                .symbolEffect(.variableColor.iterative.reversing, isActive: playing && !reduceMotion)
                .shadow(color: Color(hex: 0xFF6A3D).opacity(0.7), radius: playing ? 24 : 8)
            if live.connected {
                Text("Tuned in to").font(.subheadline).foregroundStyle(.white.opacity(0.6))
                Text(live.hostName ?? "the GM")
                    .font(.system(size: 34, weight: .bold, design: .serif))
                    .multilineTextAlignment(.center)
                if let scene = live.scene {
                    Label(scene, systemImage: "theatermasks.fill")
                        .font(.headline)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(.white.opacity(0.1), in: Capsule())
                }
            } else {
                ProgressView().tint(.white)
                Text("Connecting…").foregroundStyle(.white.opacity(0.7))
            }
            nowPlaying
                .padding(.top, 8)
        }
    }

    private var nowPlaying: some View {
        VStack(spacing: 8) {
            if live.nowPlaying.isEmpty {
                Text("Waiting for the GM…")
                    .font(.callout)
                    .foregroundStyle(.white.opacity(0.5))
            } else {
                Text("NOW PLAYING")
                    .font(.caption.weight(.bold))
                    .tracking(1.5)
                    .foregroundStyle(.white.opacity(0.55))
                FlowChips(items: live.nowPlaying)
            }
            if let added = live.lastPlayerSound {
                Label(added, systemImage: "person.wave.2.fill")
                    .font(.caption)
                    .foregroundStyle(Color(hex: 0xFFB35C))
                    .transition(.opacity)
            }
        }
    }

    private var bottomBar: some View {
        HStack {
            Label("You can lock your screen; sounds keep playing.", systemImage: "lock.fill")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.5))
            Spacer()
            Button(role: .destructive) {
                confirmLeave = true
            } label: {
                Text("Leave")
                    .font(.callout.weight(.semibold))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.red.opacity(0.25), in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }
}

/// Now-playing names as chips, each with a little dancing equalizer.
private struct FlowChips: View {
    let items: [String]

    var body: some View {
        // Wraps onto several rows on narrow screens.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { chips(items) }
            VStack(spacing: 8) {
                ForEach(Array(stride(from: 0, to: items.count, by: 2)), id: \.self) { start in
                    HStack(spacing: 8) { chips(Array(items[start..<min(start + 2, items.count)])) }
                }
            }
        }
    }

    private func chips(_ names: [String]) -> some View {
        ForEach(names, id: \.self) { name in
            HStack(spacing: 6) {
                EqualizerBars()
                Text(name).font(.callout.weight(.semibold)).lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(.white.opacity(0.12), in: Capsule())
        }
    }
}

/// Three bars bouncing like a level meter.
private struct EqualizerBars: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(0..<3, id: \.self) { i in
                    let phase = sin(t * (5 + Double(i) * 1.7) + Double(i) * 1.3)
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color(hex: 0xFFB35C))
                        .frame(width: 3, height: reduceMotion ? 8 : 4 + 8 * (phase + 1) / 2)
                }
            }
            .frame(height: 12, alignment: .bottom)
        }
        .accessibilityHidden(true)
    }
}

/// The stage's backdrop: a dark night with radio waves rippling out from the
/// centre (faster while sounds play) and drifting sparks.
private struct StageBackground: View {
    let active: Bool
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            Canvas { context, size in
                let t = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                let rect = CGRect(origin: .zero, size: size)
                context.fill(Path(rect), with: .linearGradient(
                    Gradient(colors: [Color(hex: 0x0B0716), Color(hex: 0x1A0F2E), Color(hex: 0x0E0A1C)]),
                    startPoint: .zero, endPoint: CGPoint(x: size.width, y: size.height)))

                let center = CGPoint(x: size.width / 2, y: size.height * 0.38)
                let maxRadius = max(size.width, size.height) * 0.75
                var glow = context
                glow.addFilter(.blur(radius: 60))
                let pulse = 0.5 + 0.5 * sin(t * (active ? 2.4 : 0.8))
                glow.fill(Path(ellipseIn: CGRect(x: center.x - 180, y: center.y - 180, width: 360, height: 360)),
                          with: .color(Color(hex: 0xFF6A3D).opacity(active ? 0.25 + 0.15 * pulse : 0.12)))

                // Rings travelling outwards.
                let rings = 6
                let speed = active ? 0.22 : 0.07
                for i in 0..<rings {
                    let progress = (t * speed + Double(i) / Double(rings)).truncatingRemainder(dividingBy: 1)
                    let radius = 40 + progress * maxRadius
                    let alpha = (1 - progress) * (active ? 0.55 : 0.3)
                    let ring = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
                    let color = i.isMultiple(of: 2) ? Color(hex: 0xFF6A3D) : Color(hex: 0xB07CFF)
                    context.stroke(ring, with: .color(color.opacity(alpha)), lineWidth: active ? 2.5 : 1.5)
                }

                // Sparks drifting upwards.
                var random = SeededRandom(11)
                for _ in 0..<40 {
                    let x = random.range(0, size.width)
                    let speedY = random.range(8, 26)
                    let y = (random.range(0, size.height) - CGFloat(t) * speedY).truncatingRemainder(dividingBy: size.height)
                    let wrapped = y < 0 ? y + size.height : y
                    let r = random.range(0.8, 2.2)
                    let twinkle = 0.4 + 0.6 * abs(sin(t * Double(random.range(0.5, 2)) + Double(x)))
                    context.fill(Path(ellipseIn: CGRect(x: x - r, y: wrapped - r, width: r * 2, height: r * 2)),
                                 with: .color(Color(hex: 0xFFD9A0).opacity(0.5 * twinkle)))
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// Shakes its content side to side when `amount` increases by one.
private struct ShakeEffect: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 12 * sin(amount * .pi * 6), y: 0))
    }
}

/// The player's own pads: up to five sounds that play for everyone.
private struct PlayerPads: View {
    @EnvironmentObject private var live: LiveSession
    let choose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(live.allowedPlayerSounds == .gm ? "YOUR PICKS FROM THE GM'S SOUNDS" : "YOUR SOUNDS")
                    .font(.caption.weight(.bold))
                    .tracking(1.2)
                    .foregroundStyle(.white.opacity(0.6))
                Spacer()
                Button(live.pickedSounds.isEmpty ? "Choose" : "Change", action: choose)
                    .font(.callout.weight(.semibold))
            }
            if live.pickedSounds.isEmpty {
                Button(action: choose) {
                    Label("Choose up to \(PlayerSounds.limit) sounds to play for everyone", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
            } else {
                HStack(spacing: 10) {
                    ForEach(live.pickedSounds) { sound in
                        PadButton(name: sound.name, color: Palette.color(sound.colorIndex)) {
                            live.playPick(sound.id)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(.white.opacity(0.12)))
    }
}

private struct PadButton: View {
    let name: String
    let color: Color
    let action: () -> Void
    @State private var pressed = false

    var body: some View {
        Button {
            action()
            pressed = true
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 250_000_000)
                pressed = false
            }
        } label: {
            Text(name)
                .font(.callout.weight(.semibold))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: 64)
                .padding(.horizontal, 6)
                .background(color.opacity(pressed ? 0.75 : 0.35), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(color, lineWidth: 1.5))
                .shadow(color: color.opacity(pressed ? 0.8 : 0), radius: 12)
                .scaleEffect(pressed ? 0.95 : 1)
                .animation(.easeOut(duration: 0.15), value: pressed)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Play \(name) for everyone")
    }
}

/// Choose up to five sounds, from the GM's soundboard or your own library.
struct PlayerSoundPicker: View {
    @EnvironmentObject private var live: LiveSession
    @Environment(\.dismiss) private var dismiss

    private var chosenCount: Int {
        live.allowedPlayerSounds == .gm ? live.picksFromGM.count : live.picksOwn.count
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if live.allowedPlayerSounds == .gm {
                        if live.catalog.isEmpty {
                            Text("The GM hasn't any sounds to share yet.").foregroundStyle(.secondary)
                        }
                        ForEach(live.catalog) { item in
                            row(id: item.id, name: item.name, colorIndex: item.colorIndex)
                        }
                    } else {
                        if live.ownLibrary.isEmpty {
                            Text("Your library is empty. Add sounds to it first.").foregroundStyle(.secondary)
                        }
                        ForEach(live.ownLibrary) { sound in
                            row(id: sound.id.uuidString, name: sound.name, colorIndex: sound.colorIndex)
                        }
                    }
                } header: {
                    Text("\(chosenCount) of \(PlayerSounds.limit) chosen")
                } footer: {
                    Text("When you tap one of these on the stage, everyone in the session hears it.")
                }
            }
            .navigationTitle(live.allowedPlayerSounds == .gm ? "The GM's Sounds" : "Your Sounds")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func row(id: String, name: String, colorIndex: Int) -> some View {
        let picked = live.isPicked(id)
        return Button {
            live.togglePick(id)
        } label: {
            HStack(spacing: 12) {
                Circle().fill(Palette.color(colorIndex)).frame(width: 14, height: 14)
                Text(name).foregroundStyle(Color.primary)
                Spacer()
                Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(picked ? Color.accentColor : .secondary)
            }
        }
        .disabled(!picked && chosenCount >= PlayerSounds.limit)
    }
}

/// The listener's volume sliders.
struct LiveVolumesView: View {
    @EnvironmentObject private var live: LiveSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    row("Volume", key: "master", icon: "speaker.wave.2.fill")
                    row("Music", key: "music", icon: "music.note")
                    row("Effects", key: "sfx", icon: "burst.fill")
                    row("Ambience", key: "ambience", icon: "wind")
                } footer: {
                    Text("These only change what you hear.")
                }
            }
            .navigationTitle("Your Volumes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func row(_ title: String, key: String, icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).frame(width: 22).foregroundStyle(.secondary)
            Text(title).frame(width: 80, alignment: .leading)
            Slider(value: Binding(
                get: { live.levels[key] ?? 1 },
                set: { live.levels[key] = $0 }
            ), in: 0...1)
            .accessibilityLabel("\(title) volume")
        }
    }
}
