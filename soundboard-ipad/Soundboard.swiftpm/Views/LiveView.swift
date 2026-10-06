import SwiftUI
import UIKit

/// The Live Session sheet: start broadcasting, tune in to a session, or (while
/// connected) see listeners and whisper, or set your own volumes.
struct LiveView: View {
    @EnvironmentObject private var live: LiveSession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var tab: Tab = .broadcast
    /// A name is needed to tune in.
    private var hasName: Bool { !live.yourName.trimmingCharacters(in: .whitespaces).isEmpty }
    /// The player waiting for "Remove from the session?" to be confirmed.
    @State private var kicking: LiveHostEngine.Peer?
    @State private var confirmEnd = false
    @State private var copied = false

    enum Tab: String, CaseIterable {
        case broadcast = "Broadcast"
        case tuneIn = "Tune In"
    }

    var body: some View {
        NavigationStack {
            Form {
                switch live.role {
                case .host: hosting
                case .listener: listening
                case .idle: idle
                }
                if let error = live.error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            // The main action stays at the bottom, in thumb reach, however long the form.
            .safeAreaInset(edge: .bottom) {
                if live.role == .idle && tab == .broadcast { startBar }
            }
            .navigationTitle("Live Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog("End the session?", isPresented: $confirmEnd, titleVisibility: .visible) {
                Button("End Session", role: .destructive) {
                    live.leave()
                    // Out of the way of the session recap.
                    dismiss()
                }
            } message: {
                Text(live.peers.isEmpty ? "No one is listening yet." : "\(live.peers.count) listener\(live.peers.count == 1 ? "" : "s") will be disconnected.")
            }
            .confirmationDialog(
                "Remove \(kicking?.name ?? "this listener") from the session?",
                isPresented: Binding(get: { kicking != nil }, set: { if !$0 { kicking = nil } }),
                titleVisibility: .visible
            ) {
                Button("Remove", role: .destructive) {
                    if let peer = kicking { live.kick(peer.id) }
                    kicking = nil
                }
            }
            .onAppear { live.browse(live.role == .idle && tab == .tuneIn) }
            .onDisappear { live.browse(false) }
            .onChange(of: tab) { _, newTab in
                live.error = nil
                live.browse(live.role == .idle && newTab == .tuneIn)
            }
            .onChange(of: live.role) { _, role in
                // Tuning in opens the full-screen stage once this sheet has closed.
                guard role == .listener else { return }
                dismiss()
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 450_000_000)
                    if live.role == .listener { live.showStage = true }
                }
            }
        }
    }

    // MARK: Idle

    @ViewBuilder
    private var idle: some View {
        Section {
            Picker("Mode", selection: $tab) {
                ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
        if tab == .broadcast { broadcastForm } else { tuneInForm }
    }

    @ViewBuilder
    private var broadcastForm: some View {
        Section {
            TextField("Session name, e.g. Friday Night Game", text: $live.sessionName)
            Picker("Where are your listeners?", selection: $live.mode) {
                Text("At the table").tag(LiveSession.Mode.local)
                Text("Online").tag(LiveSession.Mode.online)
            }
        } footer: {
            Text(live.mode == .local
                 ? "Listeners on the same Wi-Fi find your session under Tune In."
                 : "Listeners anywhere join with a code.")
        }
        playerSoundsSection
        natSoundsSection
        Section {} footer: {
            Text("Each listener's device plays the sounds itself, in sync, with its own volume for music, effects and ambience.")
        }
    }

    private var startBar: some View {
        Button {
            live.startHosting()
        } label: {
            HStack(spacing: 10) {
                if live.busy {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "dot.radiowaves.left.and.right")
                }
                Text(live.busy ? "Starting…" : "Start Broadcasting")
            }
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.borderedProminent)
        .disabled(live.busy)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }

    @ViewBuilder
    private var tuneInForm: some View {
        Section {
            TextField("e.g. Sam", text: $live.yourName)
                .textInputAutocapitalization(.words)
        } header: {
            Text("Your name (required)")
        } footer: {
            Text("Enter your name to tune in. Everyone sees it on your sounds and dice rolls.")
                .foregroundStyle(hasName ? Color.secondary : Color.red)
        }
        Section("Sessions on this Wi-Fi") {
            if live.found.isEmpty {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Looking for sessions…").foregroundStyle(.secondary)
                }
            }
            ForEach(live.found) { session in
                Button {
                    live.tuneIn(to: session)
                } label: {
                    HStack {
                        Label(session.name, systemImage: "dot.radiowaves.left.and.right")
                        Spacer()
                        Text("Tune In").foregroundStyle(Color.accentColor)
                    }
                }
                .disabled(live.busy || !hasName)
            }
        }
        Section {
            TextField("Code, e.g. K7QX2", text: $live.codeInput)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .font(.body.monospaced())
            Button("Tune In Online") { live.tuneInOnline() }
                .disabled(live.busy || !hasName || live.codeInput.filter { $0.isLetter || $0.isNumber }.isEmpty)
        } header: {
            Text("Online session")
        }
    }

    /// Whether players may play sounds for everyone, and from whose soundboard.
    private var playerSoundsSection: some View {
        Section {
            Picker("Listener sounds", selection: $live.playerSounds) {
                ForEach(PlayerSounds.allCases, id: \.self) { Text($0.label).tag($0) }
            }
        } header: {
            Text("Listeners' sounds")
        } footer: {
            switch live.playerSounds {
            case .off: Text("Only you play sounds.")
            case .own: Text("Each listener picks up to \(PlayerSounds.limit) sounds from their own library. When they play one, everyone hears it. You can still use all your sounds.")
            case .gm: Text("Each listener picks up to \(PlayerSounds.limit) of your sounds (not broadcaster-only ones). When they play one, everyone hears it. You can still use all your sounds.")
            }
        }
    }

    /// The sounds that play for everyone on a natural 20 or a natural 1: the
    /// open Scene Kit's sounds first.
    private var natSoundsSection: some View {
        let choices = live.natSoundChoices
        return Section {
            ForEach([("Natural 20 sound", $live.nat20Sound), ("Natural 1 sound", $live.nat1Sound)], id: \.0) { label, binding in
                Picker(label, selection: binding) {
                    Text("None").tag("")
                    if let kit = choices.kit, !choices.inKit.isEmpty {
                        Section(kit) {
                            ForEach(choices.inKit) { Text($0.name).tag($0.id.uuidString) }
                        }
                    }
                    Section(choices.kit == nil ? "Sounds" : "All sounds") {
                        ForEach(choices.others) { Text($0.name).tag($0.id.uuidString) }
                    }
                }
            }
        } header: {
            Text("Dice")
        } footer: {
            Text("Plays for everyone when anyone rolls a natural 20 or a natural 1.")
        }
    }

    // MARK: Hosting

    @ViewBuilder
    private var hosting: some View {
        Section {
            VStack(spacing: 6) {
                Text(live.hostingMode == .online ? "Broadcasting online" : "Broadcasting at the table")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(live.hostingName).font(.title3.bold())
                if live.hostingMode == .online, let code = live.code {
                    Text(code)
                        .font(.system(size: 40, weight: .bold, design: .monospaced))
                        .tracking(6)
                        .foregroundStyle(Color.accentColor)
                        .textSelection(.enabled)
                    Text("Listeners open Live → Tune In and enter this code.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    // Send it to players who aren't at the table.
                    HStack(spacing: 10) {
                        ShareLink(item: "Tune in to “\(live.hostingName)” on Dungeon Radio: open Live → Tune In and enter the code \(code).") {
                            Label("Share Code", systemImage: "square.and.arrow.up")
                                .frame(minHeight: 36)
                        }
                        Button {
                            UIPasteboard.general.string = code
                            copied = true
                        } label: {
                            Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                                .frame(minHeight: 36)
                        }
                    }
                    .buttonStyle(.bordered)
                    .padding(.top, 4)
                } else {
                    Text("Listeners on the same Wi-Fi open Live → Tune In and pick this session.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                if live.reconnecting {
                    Label("Reconnecting to the relay…", systemImage: "arrow.triangle.2.circlepath")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
        }
        Section {
            if live.peers.isEmpty {
                Text("No one has tuned in yet.").foregroundStyle(.secondary)
            }
            ForEach(live.peers) { peer in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(peer.name).font(.body.weight(.semibold))
                        if !peer.device.isEmpty {
                            Text(peer.device).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Button {
                        live.whisperTargets = [peer.id]
                        dismiss()
                    } label: {
                        Label("Whisper", systemImage: "ear")
                    }
                    .buttonStyle(.bordered)
                    Button(role: .destructive) {
                        kicking = peer
                    } label: {
                        Label("Remove", systemImage: "person.fill.xmark")
                    }
                    .buttonStyle(.bordered)
                }
                // iPhone: icons only, so the name keeps the room.
                .labelStyle(PeerButtonLabel(compact: sizeClass == .compact))
            }
        } header: {
            Text(live.peers.isEmpty ? "Listeners" : "Listening (\(live.peers.count))")
        } footer: {
            Text("Whisper sends the next sound you play to that listener only. Remove takes a listener out of the session. Mark sounds Broadcaster only or Buzz in each sound's Edit screen.")
        }
        playerSoundsSection
        natSoundsSection
        Section {
            Button("End Session", role: .destructive) { confirmEnd = true }
        }
    }

    // MARK: Listening

    @ViewBuilder
    private var listening: some View {
        Section {
            VStack(spacing: 6) {
                if live.connected {
                    Text("Tuned in to").font(.caption).foregroundStyle(.secondary)
                    Text(live.hostName ?? "the broadcaster").font(.title3.bold())
                    if let scene = live.scene {
                        Text("Scene: \(scene)").font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    ProgressView()
                    Text("Connecting…").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
        }
        Section {
            levelRow("Volume", key: "master", icon: "speaker.wave.2.fill")
            levelRow("Music", key: "music", icon: "music.note")
            levelRow("Effects", key: "sfx", icon: "burst.fill")
            levelRow("Ambience", key: "ambience", icon: "wind")
        } header: {
            Text("Your volumes")
        } footer: {
            Text("Sounds keep playing with the screen locked or while you use another app.")
        }
        Section("Now playing") {
            Text(live.nowPlaying.isEmpty ? "Nothing right now." : live.nowPlaying.map(\.name).joined(separator: " · "))
                .foregroundStyle(.secondary)
        }
        Section {
            Button("Leave Session", role: .destructive) { live.leave() }
        }
    }

    private func levelRow(_ title: String, key: String, icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .frame(width: 22)
                .foregroundStyle(.secondary)
            Text(title).frame(width: 80, alignment: .leading)
            Slider(value: Binding(
                get: { live.levels[key] ?? 1 },
                set: { live.levels[key] = $0 }
            ), in: 0...1)
            .accessibilityLabel("\(title) volume")
        }
    }
}

/// The listener row's buttons: icon and title, or just a big icon on iPhone.
private struct PeerButtonLabel: LabelStyle {
    let compact: Bool

    func makeBody(configuration: Configuration) -> some View {
        if compact {
            // Icon only, still read out by its title.
            Label(configuration).labelStyle(.iconOnly).frame(minWidth: 36, minHeight: 36)
        } else {
            Label(configuration)
        }
    }
}

/// The toolbar's Live controls. While broadcasting: Whisper (choose listeners
/// for the next sound) and Emphasis (the next sound vibrates phones), then the
/// button that opens the Live sheet.
struct LiveControls: View {
    @EnvironmentObject private var live: LiveSession
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Binding var showLive: Bool
    @State private var choosingWhisper = false
    @State private var showGames = false
    @State private var showHandout = false

    /// iPhone while broadcasting: the tools are in the bar at the bottom instead.
    private var toolsBelow: Bool { sizeClass == .compact && live.role == .host }

    var body: some View {
        HStack(spacing: 14) {
            if live.role == .host && !toolsBelow {
                Button {
                    choosingWhisper = true
                } label: {
                    Label(live.whisperTargets.isEmpty ? "Whisper" : "Whisper (\(live.whisperTargets.count))",
                          systemImage: live.whisperTargets.isEmpty ? "ear" : "ear.fill")
                }
                .tint(live.whisperTargets.isEmpty ? nil : Color(hex: 0xB07CFF))
                .popover(isPresented: $choosingWhisper) {
                    WhisperPicker()
                        .presentationCompactAdaptation(.popover)
                }
                .accessibilityLabel("Whisper the next sound")

                Button {
                    live.emphasis.toggle()
                } label: {
                    Label("Emphasis", systemImage: live.emphasis ? "iphone.radiowaves.left.and.right.circle.fill" : "iphone.radiowaves.left.and.right")
                }
                .tint(live.emphasis ? Color(hex: 0xFF6A3D) : nil)
                .accessibilityLabel("Emphasis: the next sound vibrates listeners' phones")
                .accessibilityAddTraits(live.emphasis ? .isSelected : [])
            }
            if live.role == .host && !toolsBelow {
                // A buzzer or a quiz; starting one locks listeners' screens to it.
                Button {
                    showGames = true
                } label: {
                    Label("Games", systemImage: live.game == nil ? "bell" : "bell.fill")
                }
                .tint(live.game == nil ? nil : Color(hex: 0xC41818))
                .accessibilityLabel("Games: a buzzer or a quiz for everyone")
                .sheet(isPresented: $showGames) {
                    GameHostView().environmentObject(live)
                }
                // A picture on every listener's screen.
                Button {
                    showHandout = true
                } label: {
                    Label("Handout", systemImage: "map")
                }
                .accessibilityLabel("Handout: show a picture on every listener's screen")
                .sheet(isPresented: $showHandout) {
                    HandoutSendView().environmentObject(live)
                }
            }
            if !toolsBelow {
                Button {
                    live.dice.open()
                } label: {
                    Label("Dice", systemImage: "dice")
                }
                .accessibilityLabel("Roll dice")
            }
            Button {
                showLive = true
            } label: {
                Label(label, systemImage: "dot.radiowaves.left.and.right")
                    .symbolEffect(.pulse, isActive: live.role != .idle)
            }
            .tint(live.role == .idle ? nil : Color(hex: 0xFF6A3D))
            .accessibilityLabel("Live Session")
        }
    }

    private var label: String {
        switch live.role {
        case .host: return "Live · \(live.peers.count)"
        case .listener: return "Tuned In"
        case .idle: return "Live"
        }
    }
}

/// iPhone while broadcasting: Whisper, Emphasis, Games and Dice in a bar at the
/// bottom of the screen, big and within thumb reach, instead of crowding the
/// toolbar.
struct BroadcastBar: View {
    @EnvironmentObject private var live: LiveSession
    @State private var choosingWhisper = false
    @State private var showGames = false
    @State private var showHandout = false

    var body: some View {
        HStack(spacing: 6) {
            tool(live.whisperTargets.isEmpty ? "Whisper" : "Whisper (\(live.whisperTargets.count))",
                 live.whisperTargets.isEmpty ? "ear" : "ear.fill", on: !live.whisperTargets.isEmpty, color: Color(hex: 0xB07CFF)) {
                choosingWhisper = true
            }
            .popover(isPresented: $choosingWhisper) {
                WhisperPicker().presentationCompactAdaptation(.popover)
            }
            .accessibilityLabel("Whisper the next sound")
            tool("Emphasis", live.emphasis ? "iphone.radiowaves.left.and.right.circle.fill" : "iphone.radiowaves.left.and.right",
                 on: live.emphasis, color: Color(hex: 0xFF6A3D)) {
                live.emphasis.toggle()
            }
            .accessibilityLabel("Emphasis: the next sound vibrates listeners' phones")
            .accessibilityAddTraits(live.emphasis ? .isSelected : [])
            tool("Games", live.game == nil ? "bell" : "bell.fill", on: live.game != nil, color: Color(hex: 0xC41818)) {
                showGames = true
            }
            .sheet(isPresented: $showGames) {
                GameHostView().environmentObject(live)
            }
            .accessibilityLabel("Games: a buzzer or a quiz for everyone")
            tool("Handout", "map", on: false, color: .accentColor) { showHandout = true }
                .sheet(isPresented: $showHandout) {
                    HandoutSendView().environmentObject(live)
                }
                .accessibilityLabel("Handout: show a picture on every listener's screen")
            tool("Dice", "dice", on: false, color: .accentColor) { live.dice.open() }
                .accessibilityLabel("Roll dice")
        }
        .padding(.horizontal, 8)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private func tool(_ title: String, _ icon: String, on: Bool, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.title3)
                Text(title).font(.caption2.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(on ? Color.white : Color.primary)
            .background(on ? color : Color.clear, in: RoundedRectangle(cornerRadius: 12))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The Whisper drop-down: tick one or more listeners. The next sound you play
/// goes only to them, then whispering switches off again.
struct WhisperPicker: View {
    @EnvironmentObject private var live: LiveSession

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Whisper the next sound to…")
                .font(.headline)
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 8)
            if live.peers.isEmpty {
                Text("No one has tuned in yet.")
                    .foregroundStyle(.secondary)
                    .padding(16)
            }
            // A big table scrolls instead of running off a phone's screen.
            ScrollView {
            VStack(spacing: 0) {
            ForEach(live.peers) { peer in
                Button {
                    if live.whisperTargets.contains(peer.id) {
                        live.whisperTargets.remove(peer.id)
                    } else {
                        live.whisperTargets.insert(peer.id)
                    }
                } label: {
                    HStack {
                        Image(systemName: live.whisperTargets.contains(peer.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(live.whisperTargets.contains(peer.id) ? Color(hex: 0xB07CFF) : .secondary)
                        Text(peer.name)
                        Spacer()
                        Text(peer.device).font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            }
            }
            .frame(maxHeight: 340)
            .fixedSize(horizontal: false, vertical: true)
            if !live.whisperTargets.isEmpty {
                Divider()
                Button("Don't Whisper") { live.whisperTargets = [] }
                    .padding(16)
            }
        }
        .frame(minWidth: 280)
    }
}
