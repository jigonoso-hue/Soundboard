import SwiftUI

struct EditSoundView: View {
    @State var sound: Sound
    var onSave: (Sound) -> Void
    var onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss

    private var lengthNote: String {
        guard let duration = sound.duration else { return "" }
        return " This one is \(TimeText.format(duration)) long."
    }
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Name", text: $sound.name)
                }
                Section {
                    KindPicker(kind: Binding(
                        get: { sound.isFull ? .full : .clip },
                        set: { sound.kind = $0 }
                    ))
                } header: {
                    Text("Type")
                } footer: {
                    Text("Clips are short effects, shown as tiles. Full sounds are songs and long tracks, shown as rows with a timer." + lengthNote)
                }
                Section("Tags") {
                    TagPicker(selected: Binding(
                        get: { sound.tagList },
                        set: { sound.tags = $0 }
                    ))
                    .padding(.vertical, 4)
                }
                Section("Color") {
                    HStack(spacing: 12) {
                        ForEach(Palette.colors.indices, id: \.self) { index in
                            Circle()
                                .fill(Palette.colors[index])
                                .frame(width: 32, height: 32)
                                .overlay(Circle().stroke(.white, lineWidth: sound.colorIndex == index ? 3 : 0))
                                .onTapGesture { sound.colorIndex = index }
                                .accessibilityAddTraits(sound.colorIndex == index ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section("Volume") {
                    HStack {
                        Image(systemName: "speaker.fill").foregroundStyle(.secondary)
                        Slider(value: $sound.volume, in: 0...1)
                        Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary)
                    }
                }
                Section {
                    Toggle("Repeat when finished", isOn: Binding(
                        get: { sound.repeatGap != nil },
                        set: { sound.repeatGap = $0 ? (sound.repeatGap ?? 0) : nil }
                    ))
                    if sound.repeatGap != nil {
                        HStack {
                            Text("Wait before replaying")
                            Spacer()
                            TextField("Seconds", value: Binding(
                                get: { sound.repeatGap ?? 0 },
                                set: { sound.repeatGap = max(0, $0) }
                            ), format: .number)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 70)
                            Text("sec").foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Repeat")
                } footer: {
                    Text("0 seconds replays immediately. Tap the sound again, or Stop All, to stop it.")
                }
                Section {
                    Toggle("Broadcaster only", isOn: Binding(
                        get: { sound.gmOnly == true },
                        set: { sound.gmOnly = $0 }
                    ))
                    Toggle("Buzz phones", isOn: Binding(
                        get: { sound.buzz == true },
                        set: { sound.buzz = $0 }
                    ))
                } header: {
                    Text("Live Session")
                } footer: {
                    Text("Broadcaster-only sounds play only on your device, never for listeners. Buzz makes listeners' phones vibrate when it plays, for big hits.")
                }
                if let source = sound.source {
                    Section("From YouTube") {
                        Text(source.title.isEmpty ? "YouTube video" : source.title)
                        Text(source.full == true ? "Full audio" : "\(TimeText.format(source.start)) – \(TimeText.format(source.end))")
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                        if let url = URL(string: source.url) {
                            Link("Open video", destination: url)
                        }
                    }
                }
                Section {
                    Button("Delete Sound", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle("Edit Sound")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(sound)
                        dismiss()
                    }
                }
            }
            .confirmationDialog("Delete “\(sound.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    onDelete()
                    dismiss()
                }
            } message: {
                Text("This can't be undone.")
            }
        }
    }
}
