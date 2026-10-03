import SwiftUI

/// Pick an icon from the app's set, a background colour and an icon colour.
struct IconPickerView: View {
    @Binding var icon: String
    @Binding var color: String
    @Binding var iconColor: String
    var backgrounds: [String] = IconPickerView.backgroundPresets

    static let backgroundPresets = ["#7c6cff", "#ff5d73", "#f5a742", "#6ee7b7", "#5ec8ff", "#d58bff", "#8a6a4f", "#3f4a5a", "#1f6f4a", "#7a1f2b"]
    static let iconPresets = ["#ffffff", "#1b1b22", "#ffd166", "#ff5d73", "#6ee7b7", "#5ec8ff", "#d58bff", "#f5a742", "#c0c6d4", "#8a6a4f"]

    @State private var search = ""
    @State private var category = "All"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            colorRow("Background", presets: backgrounds, value: $color)
            colorRow("Icon colour", presets: Self.iconPresets, value: $iconColor)

            TextField("Search icons (dragon, tavern, storm)", text: $search)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(["All"] + Icons.categories, id: \.self) { name in
                        Button {
                            category = name
                        } label: {
                            Text(name)
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .foregroundStyle(category == name ? Color.white : Color.primary)
                                .background(Capsule().fill(category == name ? Color.accentColor : Color.secondary.opacity(0.15)))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 6)], spacing: 6) {
                ForEach(matches) { definition in
                    let selected = definition.id == icon
                    Button {
                        icon = definition.id
                    } label: {
                        AppIcon(id: definition.id, size: 24)
                            .foregroundStyle(selected ? (Color(hexString: iconColor) ?? .white) : Color.primary.opacity(0.85))
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(
                                RoundedRectangle(cornerRadius: 9)
                                    .fill(selected ? (Color(hexString: color) ?? .accentColor) : Color.secondary.opacity(0.1))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 9)
                                    .strokeBorder(selected ? Color.white : Color.clear, lineWidth: 1.5)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(definition.name)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            if matches.isEmpty {
                Text("No icons match.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var matches: [IconDefinition] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return IconData.all.filter { definition in
            (category == "All" || definition.category == category)
                && (query.isEmpty || definition.name.lowercased().contains(query) || definition.id.contains(query)
                    || definition.category.lowercased().contains(query))
        }
    }

    private func colorRow(_ title: String, presets: [String], value: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                ForEach(presets, id: \.self) { hex in
                    Button {
                        value.wrappedValue = hex
                    } label: {
                        Circle()
                            .fill(Color(hexString: hex) ?? .gray)
                            .frame(width: 26, height: 26)
                            .overlay(Circle().strokeBorder(Color.white.opacity(value.wrappedValue == hex ? 1 : 0.15), lineWidth: value.wrappedValue == hex ? 2.5 : 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(hex)
                }
                // Any other colour, from the system colour picker.
                ColorPicker(
                    "Custom \(title.lowercased())",
                    selection: Binding(
                        get: { Color(hexString: value.wrappedValue) ?? .white },
                        set: { value.wrappedValue = $0.hexString }
                    ),
                    supportsOpacity: false
                )
                .labelsHidden()
                .overlay(
                    Circle()
                        .strokeBorder(Color.white, lineWidth: presets.contains(value.wrappedValue) ? 0 : 2.5)
                        .allowsHitTesting(false)
                )
            }
        }
    }
}
