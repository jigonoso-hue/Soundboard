import SwiftUI

/// The Live Session sheet: start broadcasting, tune in to a session, or (while
/// connected) see listeners and whisper, or set your own volumes.
struct LiveView: View {
    @EnvironmentObject private var live: LiveSession
    @Environment(\.dismiss) private var dismiss
    @State private var tab: Tab = .broadcast

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
            .navigationTitle("Live Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear { live.browse(live.role == .idle && tab == .tuneIn) }
            .onDisappear { live.browse(false) }
            .onChange(of: tab) { _, newTab in
                live.error = nil
                live.browse(live.role == .idle && newTab == .tuneIn)
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
            Picker("Where are your players?", selection: $live.mode) {
                Text("At the table").tag(LiveSession.Mode.local)
                Text("Online").tag(LiveSession.Mode.online)
            }
            if live.mode == .online { relayField }
        } footer: {
            Text(live.mode == .local
                 ? "Players on the same Wi-Fi find your session under Tune In."
                 : "Players anywhere join with a code, through a relay server.")
        }
        Section {
            Button {
                live.startHosting()
            } label: {
                HStack {
                    Label("Start Broadcasting", systemImage: "dot.radiowaves.left.and.right")
                    if live.busy {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(live.busy)
        } footer: {
            Text("Each player's device plays the sounds itself, in sync, with its own volume for music, effects and ambience.")
        }
    }

    @ViewBuilder
    private var tuneInForm: some View {
        Section("Your name (shown to the GM)") {
            TextField("e.g. Sam", text: $live.yourName)
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
                .disabled(live.busy)
            }
        }
        Section {
            TextField("Code, e.g. K7QX2", text: $live.codeInput)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .font(.body.monospaced())
            relayField
            Button("Tune In Online") { live.tuneInOnline() }
                .disabled(live.busy)
        } header: {
            Text("Online session")
        }
    }

    private var relayField: some View {
        TextField("Relay server, e.g. relay.example.com", text: $live.relay)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.URL)
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
                    Text("Players open Live → Tune In and enter this code.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Players on the same Wi-Fi open Live → Tune In and pick this session.")
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
                        live.whisperTo = peer
                        dismiss()
                    } label: {
                        Label("Whisper", systemImage: "ear")
                    }
                    .buttonStyle(.bordered)
                }
            }
        } header: {
            Text(live.peers.isEmpty ? "Listeners" : "Listening (\(live.peers.count))")
        } footer: {
            Text("Whisper sends the next sound you play to that player only. Mark sounds GM only or Buzz in each sound's Edit screen.")
        }
        Section {
            Button("End Session", role: .destructive) { live.leave() }
        }
    }

    // MARK: Listening

    @ViewBuilder
    private var listening: some View {
        Section {
            VStack(spacing: 6) {
                if live.connected {
                    Text("Tuned in to").font(.caption).foregroundStyle(.secondary)
                    Text(live.hostName ?? "the GM").font(.title3.bold())
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
            Text("Keep Dungeon Radio open while tuned in; the screen stays on.")
        }
        Section("Now playing") {
            Text(live.nowPlaying.isEmpty ? "Nothing right now." : live.nowPlaying.joined(separator: " · "))
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

/// The toolbar button that opens the Live sheet, showing whether a session is on.
struct LiveButton: View {
    @EnvironmentObject private var live: LiveSession
    @Binding var showLive: Bool

    var body: some View {
        Button {
            showLive = true
        } label: {
            Label(label, systemImage: "dot.radiowaves.left.and.right")
                .symbolEffect(.pulse, isActive: live.role != .idle)
        }
        .tint(live.role == .idle ? nil : Color(hex: 0xFF6A3D))
        .accessibilityLabel("Live Session")
    }

    private var label: String {
        switch live.role {
        case .host: return "Live · \(live.peers.count)"
        case .listener: return "Tuned In"
        case .idle: return "Live"
        }
    }
}
