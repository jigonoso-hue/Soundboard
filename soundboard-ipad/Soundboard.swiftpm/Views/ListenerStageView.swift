import SwiftUI

/// What a player sees while tuned in: a full-screen stage that stays up until
/// they leave, drawn in the style of the app's theme. Rings ripple out while
/// sounds play; whispers glow purple, buzz sounds shake the screen; what's
/// playing is grouped into sounds, full sounds and ambience; the player's own
/// sound pads sit at the bottom when the GM allows them.
struct ListenerStageView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @EnvironmentObject private var live: LiveSession
    @Environment(\.appTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showVolumes = false
    @State private var showHandouts = false
    @State private var choosingSounds = false
    @State private var whisperGlow = false
    @State private var buzzFlash = false
    @State private var shake: CGFloat = 0
    @State private var confirmLeave = false

    private var style: StageStyle { StageStyle(theme) }
    private var playing: Bool { !live.nowPlaying.isEmpty }

    var body: some View {
        ZStack {
            // Lite dice effects: the stage holds still too.
            StageBackdrop(style: style, active: playing, reduceMotion: reduceMotion || live.dice.level == .lite)
                .ignoresSafeArea()
            effects
            content
            if whisperGlow { whisperCard }
        }
        .modifier(ShakeEffect(amount: shake))
        .foregroundStyle(style.ink)
        .fontDesign(style.fontDesign)
        .tint(style.accent)
        .preferredColorScheme(style.colorScheme)
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
        .modifier(DicePresenter(tray: live.dice, active: true, inset: 16))  // below the 44pt top bar
        .confirmationDialog("Leave the session?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave Session", role: .destructive) { live.leave() }
        }
    }

    /// The purple glow of a whisper and the flash of a buzz.
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
            style.accent.opacity(0.28)
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .transition(.opacity)
        }
    }

    private var content: some View {
        VStack(spacing: 0) {
            topBar.diceCover(live.dice, "stageTop")
            Spacer(minLength: 12)
            // When a lot is playing on a small screen, the middle scrolls rather
            // than pushing the pads and Leave off the bottom.
            ViewThatFits(in: .vertical) {
                center
                ScrollView(showsIndicators: false) { center.padding(.vertical, 8) }
            }
            Spacer(minLength: 12)
            if live.allowedPlayerSounds != .off {
                PlayerPads(style: style, choose: { choosingSounds = true })
                    .padding(.bottom, 14)
            }
            bottomBar.diceCover(live.dice, "stageBottom")
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
                    .fill(live.connected ? Color(hex: 0xFF4A3D) : Color.gray)
                    .frame(width: 8, height: 8)
                    .shadow(color: Color(hex: 0xFF4A3D), radius: live.connected ? 6 : 0)
                Text(live.connected ? "LIVE" : "CONNECTING")
                    .font(.caption.weight(.heavy))
                    .tracking(1.5)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(style.chipFill, in: Capsule())
            Spacer()
            // The session's handouts, once there are any.
            if !live.handouts.isEmpty {
                Button {
                    showHandouts = true
                } label: {
                    Label("Handouts · \(live.handouts.count)", systemImage: "map")
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(style.chipFill, in: Capsule())
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .sheet(isPresented: $showHandouts) {
                    HandoutLogView().environmentObject(live)
                }
                .accessibilityLabel("Handouts: \(live.handouts.count)")
            }
            // iPhone: Dice is at the bottom instead, in thumb reach.
            if sizeClass != .compact {
                Button {
                    live.dice.open()
                } label: {
                    Label("Dice", systemImage: "dice")
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(style.chipFill, in: Capsule())
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Button {
                showVolumes = true
            } label: {
                Label("Volumes", systemImage: "slider.horizontal.3")
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(style.chipFill, in: Capsule())
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private var emblem: some View {
        let gradient = LinearGradient(colors: [style.accent, style.ringA], startPoint: .top, endPoint: .bottom)
        let glow: CGFloat = playing ? 24 : 8
        return Image(systemName: style.symbol)
            .font(.system(size: 72, weight: .semibold))
            .foregroundStyle(gradient)
            .symbolEffect(.variableColor.iterative.reversing, isActive: playing && !reduceMotion)
            .shadow(color: style.ringA.opacity(0.7), radius: glow)
    }

    private var center: some View {
        VStack(spacing: 14) {
            emblem
            if live.connected {
                Text("Tuned in to").font(.subheadline).foregroundStyle(style.secondaryInk)
                Text(live.hostName ?? "the broadcaster")
                    .font(.system(size: sizeClass == .compact ? 28 : 34, weight: .bold, design: style.titleDesign))
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .minimumScaleFactor(0.7)
                if let scene = live.scene {
                    Label(scene, systemImage: "theatermasks.fill")
                        .font(.headline)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(style.chipFill, in: Capsule())
                }
            } else {
                ProgressView().tint(style.ink)
                Text("Connecting…").foregroundStyle(style.secondaryInk)
            }
            NowPlayingGroups(items: live.nowPlaying, style: style, me: live.yourName)
                .padding(.top, 8)
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 10) {
            if sizeClass == .compact {
                // iPhone: the listener's main action, big and in thumb reach.
                Button {
                    live.dice.open()
                } label: {
                    Label("Roll Dice", systemImage: "dice.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(style.chipFill, in: RoundedRectangle(cornerRadius: 16))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            bottomRow
        }
    }

    private var bottomRow: some View {
        HStack {
            Label("You can lock your screen; sounds keep playing.", systemImage: "lock.fill")
                .font(.caption)
                .foregroundStyle(style.secondaryInk)
            Spacer()
            Button(role: .destructive) {
                confirmLeave = true
            } label: {
                Text("Leave")
                    .font(.callout.weight(.semibold))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.red.opacity(0.25), in: Capsule())
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - Theme styles

/// How the stage looks in each theme.
struct StageStyle {
    enum Overlay { case sparks, candle, orbit, radar, sigil }

    let theme: AppTheme
    let ink: Color
    let secondaryInk: Color
    let accent: Color
    /// The two colours of the rippling rings.
    let ringA: Color
    let ringB: Color
    let chipFill: Color
    let colorScheme: ColorScheme
    let fontDesign: Font.Design
    let titleDesign: Font.Design
    let symbol: String
    let overlay: Overlay

    init(_ theme: AppTheme) {
        self.theme = theme
        switch theme {
        case .tavern:
            ink = Color(hex: 0x2B1A0C)
            secondaryInk = Color(hex: 0x5B4127)
            accent = Color(hex: 0x9C3D12)
            ringA = Color(hex: 0x7A5228)
            ringB = Color(hex: 0x9C3D12)
            chipFill = Color(hex: 0x7A5228).opacity(0.16)
            colorScheme = .light
            fontDesign = .serif
            titleDesign = .serif
            symbol = "music.note"
            overlay = .candle
        case .spaceAge:
            ink = Color(hex: 0xF6EFDD)
            secondaryInk = Color(hex: 0xA9B6D6)
            accent = Color(hex: 0x2AD4C0)
            ringA = Color(hex: 0x12B5A5)
            ringB = Color(hex: 0xF0643C)
            chipFill = Color(hex: 0x0C142C).opacity(0.8)
            colorScheme = .dark
            fontDesign = .rounded
            titleDesign = .rounded
            symbol = "antenna.radiowaves.left.and.right"
            overlay = .orbit
        case .scifi:
            ink = Color(hex: 0xDDF6FF)
            secondaryInk = Color(hex: 0x7FB6D4)
            accent = Color(hex: 0x3FD2FF)
            ringA = Color(hex: 0x3FD2FF)
            ringB = Color(hex: 0x1E8FBF)
            chipFill = Color(hex: 0x08203A).opacity(0.8)
            colorScheme = .dark
            fontDesign = .monospaced
            titleDesign = .monospaced
            symbol = "dot.radiowaves.left.and.right"
            overlay = .radar
        case .academia:
            ink = Color(hex: 0xF1E6C8)
            secondaryInk = Color(hex: 0xA9A3C9)
            accent = Color(hex: 0xD4A94A)
            ringA = Color(hex: 0xD4A94A)
            ringB = Color(hex: 0x8FA6FF)
            chipFill = Color(hex: 0x14164A).opacity(0.8)
            colorScheme = .dark
            fontDesign = .serif
            titleDesign = .serif
            symbol = "moon.stars.fill"
            overlay = .sigil
        default:
            ink = Color.white
            secondaryInk = Color.white.opacity(0.6)
            accent = Color(hex: 0xFFB35C)
            ringA = Color(hex: 0xFF6A3D)
            ringB = Color(hex: 0xB07CFF)
            chipFill = Color.white.opacity(0.12)
            colorScheme = .dark
            fontDesign = .default
            titleDesign = .serif
            symbol = "dot.radiowaves.left.and.right"
            overlay = .sparks
        }
    }
}

/// The theme's backdrop with the stage's animated layer on top.
private struct StageBackdrop: View {
    let style: StageStyle
    let active: Bool
    let reduceMotion: Bool

    var body: some View {
        ZStack {
            base
            TimelineView(.animation(paused: reduceMotion)) { timeline in
                Canvas { context, size in
                    let time: Double = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                    StageDrawing.draw(&context, size: size, time: time, active: active, style: style)
                }
            }
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var base: some View {
        switch style.theme {
        case .tavern: TavernBackdrop(page: "stage")
        case .spaceAge: SpaceScene(seed: "stage").equatable()
        case .scifi: HUDBackdrop().equatable()
        case .academia: ArcaneBackdrop().equatable()
        default: StageNight()
        }
    }
}

/// The default stage's dark night sky.
private struct StageNight: View {
    var body: some View {
        LinearGradient(colors: [Color(hex: 0x0B0716), Color(hex: 0x1A0F2E), Color(hex: 0x0E0A1C)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

/// The animated layer: a glow and rings rippling out from the emblem, plus a
/// touch for each theme (sparks, candlelight, an orbiting atom, a radar sweep,
/// a turning sigil).
enum StageDrawing {
    static func draw(_ context: inout GraphicsContext, size: CGSize, time: Double, active: Bool, style: StageStyle) {
        let width: CGFloat = size.width
        let height: CGFloat = size.height
        guard width > 1, height > 1 else { return }
        let center = CGPoint(x: width / 2, y: height * 0.36)
        let reach: CGFloat = max(width, height) * 0.75
        drawGlow(&context, center: center, time: time, active: active, color: style.ringA)
        switch style.overlay {
        case .sparks: drawSparks(&context, width: width, height: height, time: time, color: Color(hex: 0xFFD9A0))
        case .candle: drawCandle(&context, width: width, height: height, time: time)
        case .orbit: drawOrbit(&context, center: center, time: time)
        case .radar: drawRadar(&context, center: center, reach: reach, time: time)
        case .sigil: drawSigil(&context, center: center, time: time, active: active)
        }
        drawRings(&context, center: center, reach: reach, time: time, active: active, style: style)
    }

    private static func drawGlow(_ context: inout GraphicsContext, center: CGPoint, time: Double, active: Bool, color: Color) {
        var glow = context
        glow.addFilter(.blur(radius: 60))
        let rate: Double = active ? 2.4 : 0.8
        let pulse: Double = 0.5 + 0.5 * sin(time * rate)
        let strength: Double = active ? 0.25 + 0.15 * pulse : 0.12
        let rect = CGRect(x: center.x - 180, y: center.y - 180, width: 360, height: 360)
        glow.fill(Path(ellipseIn: rect), with: .color(color.opacity(strength)))
    }

    /// Rings travelling outwards from the emblem; faster while sounds play.
    private static func drawRings(_ context: inout GraphicsContext, center: CGPoint, reach: CGFloat, time: Double, active: Bool, style: StageStyle) {
        let rings = 6
        let speed: Double = active ? 0.22 : 0.07
        let maxAlpha: Double = active ? 0.55 : 0.3
        let lineWidth: CGFloat = active ? 2.5 : 1.5
        for index in 0..<rings {
            let offset: Double = Double(index) / Double(rings)
            let progress: Double = (time * speed + offset).truncatingRemainder(dividingBy: 1)
            let radius: CGFloat = 40 + CGFloat(progress) * reach
            let alpha: Double = (1 - progress) * maxAlpha
            let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
            let color: Color = index.isMultiple(of: 2) ? style.ringA : style.ringB
            var ring = Path(ellipseIn: rect)
            if style.overlay == .radar {
                // Sci-Fi rings are dashed, like a scope's range markers.
                ring = ring.strokedPath(StrokeStyle(lineWidth: lineWidth, dash: [10, 6]))
                context.fill(ring, with: .color(color.opacity(alpha)))
            } else {
                context.stroke(ring, with: .color(color.opacity(alpha)), lineWidth: lineWidth)
            }
        }
    }

    /// Sparks drifting upwards.
    private static func drawSparks(_ context: inout GraphicsContext, width: CGFloat, height: CGFloat, time: Double, color: Color) {
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
            context.fill(Path(ellipseIn: rect), with: .color(color.opacity(0.5 * twinkle)))
        }
    }

    /// Tavern: warm candlelight flickering at the edges of the page.
    private static func drawCandle(_ context: inout GraphicsContext, width: CGFloat, height: CGFloat, time: Double) {
        var light = context
        light.addFilter(.blur(radius: 70))
        let flicker: Double = 0.75 + 0.15 * sin(time * 7.3) + 0.1 * sin(time * 13.1)
        let size: CGFloat = min(width, height) * 0.5
        let corners = [CGPoint(x: 0, y: height), CGPoint(x: width, y: height)]
        for corner in corners {
            let rect = CGRect(x: corner.x - size / 2, y: corner.y - size / 2, width: size, height: size)
            light.fill(Path(ellipseIn: rect), with: .color(Color(hex: 0xFFB347).opacity(0.35 * flicker)))
        }
    }

    /// Space Age: a small atom circling the emblem.
    private static func drawOrbit(_ context: inout GraphicsContext, center: CGPoint, time: Double) {
        let radius: CGFloat = 130
        let angle: Double = time * 0.6
        let orbit = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius * 0.4, width: radius * 2, height: radius * 0.8))
        context.stroke(orbit, with: .color(Color(hex: 0xF6EFDD).opacity(0.25)), lineWidth: 1)
        let x: CGFloat = center.x + radius * CGFloat(cos(angle))
        let y: CGFloat = center.y + radius * 0.4 * CGFloat(sin(angle))
        context.fill(Path(ellipseIn: CGRect(x: x - 6, y: y - 6, width: 12, height: 12)), with: .color(Color(hex: 0xF5A623)))
        let back: Double = angle + Double.pi
        let bx: CGFloat = center.x + radius * CGFloat(cos(back))
        let by: CGFloat = center.y + radius * 0.4 * CGFloat(sin(back))
        context.fill(Path(ellipseIn: CGRect(x: bx - 4, y: by - 4, width: 8, height: 8)), with: .color(Color(hex: 0x12B5A5)))
    }

    /// Sci-Fi: a radar beam sweeping round the emblem.
    private static func drawRadar(_ context: inout GraphicsContext, center: CGPoint, reach: CGFloat, time: Double) {
        let angle: Double = time * 1.2
        let span: Double = 0.5
        var beam = Path()
        beam.move(to: center)
        beam.addArc(center: center, radius: reach * 0.7, startAngle: .radians(angle - span), endAngle: .radians(angle), clockwise: false)
        beam.closeSubpath()
        context.fill(beam, with: .color(Color(hex: 0x3FD2FF).opacity(0.10)))
        var edge = Path()
        edge.move(to: center)
        let ex: CGFloat = center.x + reach * 0.7 * CGFloat(cos(angle))
        let ey: CGFloat = center.y + reach * 0.7 * CGFloat(sin(angle))
        edge.addLine(to: CGPoint(x: ex, y: ey))
        context.stroke(edge, with: .color(Color(hex: 0x3FD2FF).opacity(0.45)), lineWidth: 1.5)
    }

    /// Dark Academia: a gold sigil slowly turning behind the emblem.
    private static func drawSigil(_ context: inout GraphicsContext, center: CGPoint, time: Double, active: Bool) {
        var sigil = context
        sigil.translateBy(x: center.x, y: center.y)
        sigil.rotate(by: .radians(time * 0.08))
        let path = Arcane.sigil(center: .zero, radius: 150)
        let alpha: Double = active ? 0.35 : 0.2
        sigil.stroke(path, with: .color(Color(hex: 0xD4A94A).opacity(alpha)), lineWidth: 1.2)
    }
}

// MARK: - Now playing

/// What's playing, as chips grouped into sounds, full sounds and, last and
/// quieter, ambience. A player's sound says who played it.
private struct NowPlayingGroups: View {
    let items: [NowPlayingItem]
    let style: StageStyle
    let me: String

    var body: some View {
        VStack(spacing: 12) {
            if items.isEmpty {
                Text("Waiting for the broadcaster…")
                    .font(.callout)
                    .foregroundStyle(style.secondaryInk)
            } else {
                group("SOUNDS", items.filter { $0.kind == .sound })
                group("FULL SOUNDS", items.filter { $0.kind == .music })
                group("AMBIENCE", items.filter { $0.kind == .ambience })
            }
        }
    }

    @ViewBuilder
    private func group(_ title: String, _ list: [NowPlayingItem]) -> some View {
        if !list.isEmpty {
            VStack(spacing: 6) {
                Text(title)
                    .font(.caption2.weight(.bold))
                    .tracking(1.5)
                    .foregroundStyle(style.secondaryInk)
                ChipRows(items: list, style: style, me: me)
            }
        }
    }
}

/// Chips in rows: one row when they fit, otherwise two per row.
private struct ChipRows: View {
    let items: [NowPlayingItem]
    let style: StageStyle
    let me: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { chips(items) }
            VStack(spacing: 8) {
                ForEach(Array(stride(from: 0, to: items.count, by: 2)), id: \.self) { start in
                    HStack(spacing: 8) { chips(Array(items[start..<min(start + 2, items.count)])) }
                }
            }
        }
    }

    private func chips(_ list: [NowPlayingItem]) -> some View {
        ForEach(list) { item in
            NowPlayingChip(item: item, style: style, me: me)
        }
    }
}

private struct NowPlayingChip: View {
    let item: NowPlayingItem
    let style: StageStyle
    let me: String

    var body: some View {
        if item.kind == .ambience {
            // Ambience: quieter, outlined, with a breeze instead of bouncing bars.
            HStack(spacing: 6) {
                Image(systemName: "wind").font(.caption)
                Text(item.name).font(.callout.italic()).lineLimit(1)
            }
            .foregroundStyle(style.secondaryInk)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .overlay(Capsule().strokeBorder(style.secondaryInk.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else {
            HStack(spacing: 6) {
                EqualizerBars(color: style.accent)
                Text(item.name).font(.callout.weight(.semibold)).lineLimit(1)
                if let by = item.by {
                    Text(byLine(by))
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(style.accent.opacity(0.25), in: Capsule())
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(style.chipFill, in: Capsule())
        }
    }

    private func byLine(_ by: String) -> String {
        let mine = !me.isEmpty && by.caseInsensitiveCompare(me) == .orderedSame
        return mine ? "you" : by
    }
}

/// Three bars bouncing like a level meter.
private struct EqualizerBars: View {
    let color: Color
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
                    .fill(color)
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

// MARK: - Player pads

/// The player's own pads: up to five sounds that play for everyone, on the
/// theme's kind of panel.
private struct PlayerPads: View {
    @EnvironmentObject private var live: LiveSession
    @Environment(\.horizontalSizeClass) private var sizeClass
    let style: StageStyle
    let choose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(live.allowedPlayerSounds == .gm ? "YOUR PICKS FROM THE BROADCASTER'S SOUNDS" : "YOUR SOUNDS")
                    .font(.caption.weight(.bold))
                    .tracking(1.2)
                    .foregroundStyle(style.secondaryInk)
                Spacer()
                Button(live.pickedSounds.isEmpty ? "Choose" : "Change", action: choose)
                    .font(.callout.weight(.semibold))
            }
            if live.pickedSounds.isEmpty {
                Button(action: choose) {
                    Label("Choose up to \(PlayerSounds.limit) sounds to play for everyone", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(style.chipFill, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
            } else {
                // iPhone: three to a row, so each pad is big enough for its name.
                let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: sizeClass == .compact ? 3 : max(1, live.pickedSounds.count))
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(live.pickedSounds) { sound in
                        PadButton(name: sound.name, color: Palette.color(sound.colorIndex)) {
                            live.playPick(sound.id)
                        }
                    }
                }
            }
        }
        .padding(sizeClass == .compact ? 14 : 18)
        .background(panel)
    }

    @ViewBuilder
    private var panel: some View {
        if style.theme.hasBackdrop {
            ThemePanel(theme: style.theme, seed: "stage-pads") { EmptyView() }
        } else {
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.black.opacity(0.35))
                .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Color.white.opacity(0.12)))
        }
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
                            Text("The broadcaster hasn't any sounds to share yet.").foregroundStyle(.secondary)
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
            .navigationTitle(live.allowedPlayerSounds == .gm ? "The Broadcaster's Sounds" : "Your Sounds")
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
