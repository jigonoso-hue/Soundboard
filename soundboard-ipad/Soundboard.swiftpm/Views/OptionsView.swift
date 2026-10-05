import SwiftUI
import WebKit

/// Options: appearance, playback, library and online settings, and storage.
struct OptionsView: View {
    @EnvironmentObject private var themes: ThemeSettings
    @EnvironmentObject private var player: SoundPlayer
    @EnvironmentObject private var ambience: AmbienceMixer
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var bashes: BashStore
    @EnvironmentObject private var kits: KitStore
    @EnvironmentObject private var ui: AppUI
    @EnvironmentObject private var youtube: YouTubeController
    @EnvironmentObject private var live: LiveSession

    @State private var storageText = "Measuring…"
    @State private var confirmSignOut = false
    @State private var signedOut = false

    var body: some View {
        Form {
            Group {
                appearance
                playback
                DiceEffectsSection(tray: live.dice)
                library
                online
                storage
                about
            }
            .themedRows(themes.theme)
        }
        .themedBackground(themes.theme, page: "options")
        .task { storageText = await Self.measureStorage(SoundStore.folder) }
    }

    // MARK: Appearance

    private var appearance: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(AppTheme.allCases) { theme in
                        Button {
                            withAnimation(.easeInOut(duration: 0.25)) { themes.theme = theme }
                        } label: {
                            ThemePreview(theme: theme, selected: themes.theme == theme)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(theme.name) theme")
                        .accessibilityAddTraits(themes.theme == theme ? .isSelected : [])
                    }
                }
                .padding(.vertical, 6)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Highlight colour")
                HStack(spacing: 10) {
                    ForEach(ThemeSettings.accentPresets.indices, id: \.self) { index in
                        let preset = ThemeSettings.accentPresets[index]
                        Button {
                            themes.accentHex = preset.1
                        } label: {
                            Circle()
                                .fill(Color(hexString: preset.1) ?? .purple)
                                .frame(width: 28, height: 28)
                                .overlay(Circle().strokeBorder(Color.primary, lineWidth: themes.accentHex == preset.1 ? 2.5 : 0))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(preset.0)
                    }
                    ColorPicker("Custom colour", selection: Binding(
                        get: { themes.accent },
                        set: { themes.accentHex = $0.hexString }
                    ), supportsOpacity: false)
                    .labelsHidden()
                }
                if themes.accentHex != nil {
                    Button("Use the theme's own colour") { themes.accentHex = nil }
                        .font(.callout)
                }
            }
            .padding(.vertical, 4)
        } header: {
            Text("Appearance")
        } footer: {
            Text("Tavern puts every page on worn parchment on a wooden table. Space Age looks out of a starship window onto deep space, with 50s atomic panels. Sci-Fi is a glowing holographic starship HUD. Dark Academia puts deep indigo pages in gilded frames under a starry night.")
        }
    }

    // MARK: Playback

    /// Dice effects: Automatic picks for this device and steps down if the dice stutter.
    private struct DiceEffectsSection: View {
        @ObservedObject var tray: DiceTray

        var body: some View {
            Section {
                Picker("Dice effects", selection: $tray.effects) {
                    ForEach(DiceEffects.allCases) { effect in
                        Text(effect == .auto ? "Automatic (\(tray.autoLevel.label))" : effect.label).tag(effect)
                    }
                }
            } header: {
                Text("Performance")
            } footer: {
                Text("Full: 3D dice with shadows. Reduced: lighter effects. Lite: for older iPhones; other people's rolls show just their result. Automatic picks for this device and steps down if the dice stutter or the phone gets hot.")
            }
        }
    }

    private var playback: some View {
        Section("Playback") {
            sliderRow("Master volume", value: $player.masterVolume)
            sliderRow("Ambience volume", value: $ambience.masterVolume)
            Toggle("Restart instead of overlap", isOn: $player.restartInsteadOfOverlap)
        }
    }

    private func sliderRow(_ title: String, value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int(value.wrappedValue * 100))%").foregroundStyle(.secondary).monospacedDigit()
            }
            Slider(value: value, in: 0...1)
        }
    }

    // MARK: Library

    private var library: some View {
        Section {
            Picker("Sort sounds by", selection: $ui.sort) {
                ForEach(SoundSort.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            Toggle("Show tags on tiles", isOn: $ui.showTagsOnTiles)
            Toggle("Ask for tags after adding sounds", isOn: $ui.askToTag)
            Toggle("Tag filters must all match", isOn: $ui.matchAllTags)
        } header: {
            Text("Library")
        } footer: {
            Text("With “must all match” off, a sound shows if it has any of the tags you pick.")
        }
    }

    // MARK: Online

    private var online: some View {
        Section {
            Label("Ads are always blocked", systemImage: "checkmark.shield")
                .foregroundStyle(.secondary)
            Button(signedOut ? "Signed out" : "Sign out of YouTube and clear its data", role: .destructive) {
                confirmSignOut = true
            }
            .disabled(signedOut)
            .confirmationDialog("Sign out of YouTube?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign Out and Clear", role: .destructive) { clearWebData() }
            } message: {
                Text("This clears YouTube's cookies, history and cache in the Online browser. Your sounds aren't affected.")
            }
        } header: {
            Text("Online")
        }
    }

    private func clearWebData() {
        let store = WKWebsiteDataStore.default()
        store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
            Task { @MainActor in
                youtube.goHome()
                signedOut = true
            }
        }
    }

    // MARK: Storage

    private var storage: some View {
        Section("Storage") {
            row("Sounds", "\(store.sounds.count)")
            row("Bashes", "\(bashes.bashes.count)")
            row("Scene kits", "\(kits.kits.count)")
            row("Space used", storageText)
        }
    }

    private var about: some View {
        Section("About") {
            row("Dungeon Radio", "Made for tabletop games")
            Text("The icon set, bashes, scene kits and ambience work the same way as in the Mac app.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).foregroundStyle(.secondary).monospacedDigit()
        }
    }

    /// Total size of the sounds folder, e.g. "48.2 MB".
    static func measureStorage(_ folder: URL) async -> String {
        await Task.detached(priority: .utility) {
            var total: Int64 = 0
            if let files = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.fileSizeKey]) {
                while let url = files.nextObject() as? URL {
                    total += Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
                }
            }
            return ByteCountFormatter.string(fromByteCount: total, countStyle: .file)
        }.value
    }
}

/// A small card showing what a theme looks like.
struct ThemePreview: View {
    let theme: AppTheme
    let selected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .bottomLeading) {
                background
                VStack(alignment: .leading, spacing: 5) {
                    RoundedRectangle(cornerRadius: 3).fill(textColor.opacity(0.85)).frame(width: 46, height: 6)
                    HStack(spacing: 5) {
                        ForEach(0..<3, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: 4)
                                .fill(accent.opacity(0.35))
                                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(accent.opacity(0.7), lineWidth: 1))
                                .frame(width: 26, height: 20)
                        }
                    }
                }
                .padding(8)
            }
            .frame(width: 120, height: 78)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(selected ? accent : Color.secondary.opacity(0.3), lineWidth: selected ? 3 : 1)
            )
            Text(theme.name).font(.subheadline.weight(.semibold)).fontDesign(theme.fontDesign)
            Text(theme.blurb).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(width: 120, alignment: .leading)
    }

    private var accent: Color { Color(hexString: theme.defaultAccent) ?? .purple }

    private var textColor: Color {
        switch theme {
        case .light, .tavern: return Color(hex: 0x2B1D0E)
        case .spaceAge: return Color(hex: 0xF6EFDD)
        case .scifi: return Color(hex: 0xDDF6FF)
        case .academia: return Color(hex: 0xF1E6C8)
        default: return .white
        }
    }

    @ViewBuilder
    private var background: some View {
        switch theme {
        case .system:
            HStack(spacing: 0) {
                Color.white
                Color.black
            }
        case .dark: Color(hex: 0x111114)
        case .light: Color(hex: 0xF5F5F7)
        case .tavern:
            ZStack {
                WoodTable().equatable()
                Parchment(seed: "preview").equatable().padding(6)
            }
        case .spaceAge:
            SpaceScene(seed: "preview").equatable()
        case .scifi:
            ZStack {
                HUDBackdrop().equatable()
                HUDPanel(seed: "preview").equatable().padding(8)
            }
        case .academia:
            ZStack {
                ArcaneBackdrop().equatable()
                GildedPanel(seed: "preview").equatable().padding(10)
            }
        }
    }
}
