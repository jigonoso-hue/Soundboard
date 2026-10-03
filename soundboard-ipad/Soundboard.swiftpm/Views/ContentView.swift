import SwiftUI

struct ContentView: View {
    @StateObject private var store = SoundStore()
    @StateObject private var player = SoundPlayer()
    @StateObject private var youtube = YouTubeController()
    @StateObject private var ambience = AmbienceMixer()
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showBrowser = false

    var body: some View {
        HStack(spacing: 0) {
            BoardView(store: store, player: player, ambience: ambience, showBrowser: $showBrowser)
                .frame(maxWidth: .infinity)
            // On a full-width iPad the browser sits beside the board, like on the Mac.
            if showBrowser && sizeClass == .regular {
                Divider()
                YouTubePanel(controller: youtube)
                    .frame(maxWidth: .infinity)
            }
        }
        // In Slide Over, narrow Split View or on iPhone it opens full screen instead.
        .fullScreenCover(isPresented: compactBrowser) {
            NavigationStack {
                YouTubePanel(controller: youtube)
                    .navigationTitle("YouTube")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showBrowser = false }
                        }
                    }
            }
        }
        .onAppear {
            ambience.attach(to: store)
            youtube.onCaptured = { file, name, source in
                _ = try store.addFile(at: file, name: name, source: source)
            }
        }
    }

    private var compactBrowser: Binding<Bool> {
        Binding(
            get: { showBrowser && sizeClass != .regular },
            set: { if !$0 { showBrowser = false } }
        )
    }
}
