import SwiftUI

/// New or edit scene kit: name, icon and colours.
struct KitEditView: View {
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var kits: KitStore
    @Environment(\.dismiss) private var dismiss
    let request: KitEditRequest
    /// Called with the saved kit (for opening a new one).
    var onSaved: (SoundKit) -> Void = { _ in }

    @State private var name = ""
    @State private var icon = "mug"
    @State private var color = "#f5a742"
    @State private var iconColor = "#ffffff"
    @State private var autoplay = false
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 16) {
                        IconBadge(icon: icon, color: color, iconColor: iconColor, size: 76)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Name").font(.caption).foregroundStyle(.secondary)
                            TextField("e.g. Tavern Brawl, Dragon’s Lair", text: $name)
                                .textFieldStyle(.roundedBorder)
                                .font(.title3)
                        }
                    }
                    IconPickerView(icon: $icon, color: $color, iconColor: $iconColor, backgrounds: KitStore.colors + ["#1f6f4a", "#7a1f2b"])
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Start its music and ambience when opened", isOn: $autoplay)
                            .font(.headline)
                        Text("Opening the kit fades out the music and ambience that's playing, then fades in its first playlist and the ambience layers you had on there.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding()
            }
            .navigationTitle(request.kitId == nil ? "New Scene Kit" : "Edit Scene Kit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let id = request.kitId, let kit = kits.kit(id) {
            name = kit.name
            icon = kit.icon
            color = kit.color
            iconColor = kit.iconColor
            autoplay = kit.autoplay == true
        } else {
            let index = kits.kits.count
            icon = KitStore.icons[index % KitStore.icons.count]
            color = KitStore.colors[index % KitStore.colors.count]
        }
    }

    private func save() {
        if let id = request.kitId, var kit = kits.kit(id) {
            if !name.trimmingCharacters(in: .whitespaces).isEmpty { kit.name = name }
            kit.icon = icon
            kit.color = color
            kit.iconColor = iconColor
            kit.autoplay = autoplay ? true : nil
            kits.update(kit)
            onSaved(kit)
        } else {
            var kit = kits.create(name: name, icon: icon, color: color, iconColor: iconColor)
            if autoplay {
                kit.autoplay = true
                kits.update(kit)
            }
            if let item = request.thenAdd {
                let isFull = item.type == .sound && (store.sound(item.id)?.isFull ?? false)
                kits.add(item, to: kit.id, isFull: isFull)
            }
            onSaved(kit)
        }
        dismiss()
    }
}

/// "Add to Scene Kit": pick a kit for one sound or bash.
struct KitChooserView: View {
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var kits: KitStore
    @EnvironmentObject private var ui: AppUI
    @Environment(\.dismiss) private var dismiss
    let choice: KitChoice

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(kits.kits) { kit in
                        let already = kit.allItems.contains(choice.item)
                        Button {
                            let isFull = choice.item.type == .sound && (store.sound(choice.item.id)?.isFull ?? false)
                            kits.add(choice.item, to: kit.id, isFull: isFull)
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                IconBadge(icon: kit.icon, color: kit.color, iconColor: kit.iconColor, size: 30)
                                Text(kit.name).foregroundStyle(Color.primary)
                                Spacer()
                                if already {
                                    Text("already added").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .disabled(already)
                    }
                } footer: {
                    Text("It goes into the section that suits it. You can move it between sections on the kit's board.")
                }
                Section {
                    Button {
                        let item = choice.item
                        guard Premium.shared.allows(.kits, count: kits.kits.count) else { return }
                        dismiss()
                        // Open the new-kit sheet once this one has gone.
                        Task {
                            try? await Task.sleep(nanoseconds: 450_000_000)
                            ui.editingKit = KitEditRequest(kitId: nil, thenAdd: item)
                        }
                    } label: {
                        IconLabel("New Scene Kit…", icon: "plus")
                    }
                }
            }
            .navigationTitle("Add “\(choice.label)” to a Scene Kit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
