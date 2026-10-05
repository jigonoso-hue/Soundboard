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
            effects
            content
            if whisperGlow { whisperCard }
        }
        .modifier(ShakeEffect(amount: shake))
        .foregroundStyle(Color.white)
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

    /// The purple glow of a whisper and the orange flash of a buzz.
    @ViewBuilder
    private var effects: some View {
        if whisperGlow {
            RadialGradient(colors: [Color.clear, Color(hex: 0xB07CFF).opacity(0.55)],
                           center: .center, startRadius: 120, endRadius: 700)
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
    }

    private var content: some View {
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
    }

    private var whisperCard: some View {
        VStack(spacing: 6) {
            Image(systemName: "ear.fill").font(.title)
            Text("A whisper only you can hear…").font(.title3.italic())
        }
        .foregroundStyle(Color.white)
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
        .background(Color(hex: 0x2A1546).opacity(0.85), in: RoundedRectangle(cornerRadius: 18))
        .transition(.scale.combined(with: .opacity))
        .allowsHitTesting(false)
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
            .background(Color.white.opacity(0.1), in: Capsule())
            Spacer()
            Button {
                showVolumes = true
            } label: {
                Label("Volumes", systemImage: "slider.horizontal.3")
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.white.opacity(0.1), in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    private var tower: some View {
        let gradient = LinearGradient(colors: [Color(hex: 0xFFB35C), Color(hex: 0xFF6A3D)], startPoint: .top, endPoint: .bottom)
        let glow: CGFloat = playing ? 24 : 8
        return Image(systemName: "dot.radiowaves.left.and.right")
            .font(.system(size: 76, weight: .semibold))
            .foregroundStyle(gradient)
            .symbolEffect(.variableColor.iterative.reversing, isActive: playing && !reduceMotion)
            .shadow(color: Color(hex: 0xFF6A3D).opacity(0.7), radius: glow)
    }

    private var center: some View {
        VStack(spacing: 14) {
            tower
            if live.connected {
                Text("Tuned in to").font(.subheadline).foregroundStyle(Color.white.opacity(0.6))
                Text(live.hostName ?? "the GM")
                    .font(.system(size: 34, weight: .bold, design: .serif))
                    .multilineTextAlignment(.center)
                if let scene = live.scene {
                    Label(scene, systemImage: "theatermasks.fill")
                        .font(.headline)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(Color.white.opacity(0.1), in: Capsule())
                }
            } else {
                ProgressView().tint(Color.white)
                Text("Connecting…").foregroundStyle(Color.white.opacity(0.7))
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
                    .foregroundStyle(Color.white.opacity(0.5))
            } else {
                Text("NOW PLAYING")
                    .font(.caption.weight(.bold))
                    .tracking(1.5)
                    .foregroundStyle(Color.white.opacity(0.55))
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
                .foregroundStyle(Color.white.opacity(0.5))
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
            .background(Color.white.opacity(0.12), in: Capsule())
        }
    }
}

/// Three bars bouncing like a level meter.
private struct EqualizerBars: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            bars(at: timeline.date.timeIntervalSinceReferenceDate)
        }
        .accessibilityHidden(true)
    }

    private func bars(at time: Double) -> some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(0..<3, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color(hex: 0xFFB35C))
                    .frame(width: 3, height: barHeight(index: index, time: time))
            }
        }
        .frame(height: 12, alignment: .bottom)
    }

    private func barHeight(index: Int, time: Double) -> CGFloat {
        if reduceMotion { return 8 }
        let i = Double(index)
        let speed: Double = 5 + i * 1.7
        let phase: Double = sin(time * speed + i * 1.3)
        let level: Double = (phase + 1) / 2
        return CGFloat(4 + 8 * level)
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
                let time: Double = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                StageBackground.draw(&context, size: size, time: time, active: active)
            }
        }
        .accessibilityHidden(true)
    }

    static func draw(_ context: inout GraphicsContext, size: CGSize, time: Double, active: Bool) {
        let width: CGFloat = size.width
        let height: CGFloat = size.height
        guard width > 1, height > 1 else { return }
        let gradient = Gradient(colors: [Color(hex: 0x0B0716), Color(hex: 0x1A0F2E), Color(hex: 0x0E0A1C)])
        context.fill(Path(CGRect(origin: .zero, size: size)),
                     with: .linearGradient(gradient, startPoint: .zero, endPoint: CGPoint(x: width, y: height)))

        let center = CGPoint(x: width / 2, y: height * 0.38)
        drawGlow(&context, center: center, time: time, active: active)
        drawRings(&context, center: center, maxRadius: max(width, height) * 0.75, time: time, active: active)
        drawSparks(&context, width: width, height: height, time: time)
    }

    private static func drawGlow(_ context: inout GraphicsContext, center: CGPoint, time: Double, active: Bool) {
        var glow = context
        glow.addFilter(.blur(radius: 60))
        let rate: Double = active ? 2.4 : 0.8
        let pulse: Double = 0.5 + 0.5 * sin(time * rate)
        let strength: Double = active ? 0.25 + 0.15 * pulse : 0.12
        let rect = CGRect(x: center.x - 180, y: center.y - 180, width: 360, height: 360)
        glow.fill(Path(ellipseIn: rect), with: .color(Color(hex: 0xFF6A3D).opacity(strength)))
    }

    /// Rings travelling outwards from the centre.
    private static func drawRings(_ context: inout GraphicsContext, center: CGPoint, maxRadius: CGFloat, time: Double, active: Bool) {
        let rings = 6
        let speed: Double = active ? 0.22 : 0.07
        let maxAlpha: Double = active ? 0.55 : 0.3
        let lineWidth: CGFloat = active ? 2.5 : 1.5
        for index in 0..<rings {
            let offset: Double = Double(index) / Double(rings)
            let progress: Double = (time * speed + offset).truncatingRemainder(dividingBy: 1)
            let radius: CGFloat = 40 + CGFloat(progress) * maxRadius
            let alpha: Double = (1 - progress) * maxAlpha
            let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
            let color: Color = index.isMultiple(of: 2) ? Color(hex: 0xFF6A3D) : Color(hex: 0xB07CFF)
            context.stroke(Path(ellipseIn: rect), with: .color(color.opacity(alpha)), lineWidth: lineWidth)
        }
    }

    /// Sparks drifting upwards.
    private static func drawSparks(_ context: inout GraphicsContext, width: CGFloat, height: CGFloat, time: Double) {
        var random = SeededRandom(11)
        let elapsed = CGFloat(time)
        for _ in 0..<40 {
            let x: CGFloat = random.range(0, width)
            let rise: CGFloat = random.range(8, 26)
            let start: CGFloat = random.range(0, height)
            let radius: CGFloat = random.range(0.8, 2.2)
            let rate = Double(random.range(0.5, 2))
            var y: CGFloat = (start - elapsed * rise).truncatingRemainder(dividingBy: height)
            if y < 0 { y += height }
            let twinkle: Double = 0.4 + 0.6 * abs(sin(time * rate + Double(x)))
            let rect = CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)
            context.fill(Path(ellipseIn: rect), with: .color(Color(hex: 0xFFD9A0).opacity(0.5 * twinkle)))
        }
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
        let offset: CGFloat = 12 * sin(amount * CGFloat.pi * 6)
        return ProjectionTransform(CGAffineTransform(translationX: offset, y: 0))
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
                    .foregroundStyle(Color.white.opacity(0.6))
                Spacer()
                Button(live.pickedSounds.isEmpty ? "Choose" : "Change", action: choose)
                    .font(.callout.weight(.semibold))
            }
            if live.pickedSounds.isEmpty {
                Button(action: choose) {
                    Label("Choose up to \(PlayerSounds.limit) sounds to play for everyone", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
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
        .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Color.white.opacity(0.12)))
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
