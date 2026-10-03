import SwiftUI

/// Shown after adding sounds: name them, pick clip or full sound, and tag them.
struct TagNewSoundsView: View {
    @EnvironmentObject private var store: SoundStore
    @Environment(\.dismiss) private var dismiss
    let soundIds: [UUID]

    @State private var drafts: [Draft] = []
    @State private var tags: [String] = []

    struct Draft: Identifiable {
        let id: UUID
        var name: String
        var kind: SoundKind
        var duration: Double?
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach($drafts) { $draft in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                TextField("Name", text: $draft.name)
                                    .font(.headline)
                                if let duration = draft.duration {
                                    Text(TimeText.format(duration))
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            KindPicker(kind: $draft.kind)
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text(drafts.count == 1 ? "New sound" : "\(drafts.count) new sounds")
                }
                Section {
                    TagPicker(selected: $tags)
                        .padding(.vertical, 4)
                } header: {
                    Text("Tags")
                } footer: {
                    Text("Tags help you find sounds later, for example in the Tags filter or when adding to a scene kit. You can change them any time in a sound's editor.")
                }
            }
            .navigationTitle("Tag New Sounds")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Skip") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                        dismiss()
                    }
                }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard drafts.isEmpty else { return }
        drafts = soundIds.compactMap { id in
            guard let sound = store.sound(id) else { return nil }
            return Draft(id: id, name: sound.name, kind: sound.isFull ? .full : .clip, duration: sound.duration)
        }
    }

    private func save() {
        for draft in drafts {
            guard var sound = store.sound(draft.id) else { continue }
            sound.name = draft.name
            sound.kind = draft.kind
            var merged = sound.tagList
            for tag in tags where !merged.contains(tag) { merged.append(tag) }
            sound.tags = merged
            store.update(sound)
        }
    }
}
