import SwiftUI
import WebKit

/// The Online panel's browser: it opens on Google, with a bookmark for YouTube.
/// It's a plain browser. It doesn't save audio or block ads, which App Store
/// guideline 5.2.3 and YouTube's terms don't allow (the Mac app, for personal
/// use, keeps its clipper). To use a sound from a video, screen-record it and
/// add it with + → Video from Photos.
@MainActor
final class OnlineBrowser: ObservableObject {
    struct Bookmark: Identifiable {
        let name: String
        let symbol: String
        let url: URL
        var id: String { name }
    }

    static let home = URL(string: "https://www.google.com")!
    static let bookmarks = [
        Bookmark(name: "Google", symbol: "magnifyingglass", url: home),
        Bookmark(name: "YouTube", symbol: "play.rectangle", url: URL(string: "https://www.youtube.com")!),
    ]

    let webView: WKWebView
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    private var observations: [NSKeyValueObservation] = []

    init() {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        observations = [
            webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] view, _ in
                let value = view.canGoBack
                Task { @MainActor in self?.canGoBack = value }
            },
            webView.observe(\.canGoForward, options: [.initial, .new]) { [weak self] view, _ in
                let value = view.canGoForward
                Task { @MainActor in self?.canGoForward = value }
            },
        ]
        open(Self.home)
    }

    func open(_ url: URL) {
        webView.load(URLRequest(url: url))
    }

    func goHome() {
        open(Self.home)
    }

    /// Goes to a web address, or searches Google for anything else.
    func go(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            open(url)
        } else if !trimmed.contains(" "), trimmed.contains("."), let url = URL(string: "https://" + trimmed) {
            open(url)
        } else {
            var search = URLComponents(string: "https://www.google.com/search")!
            search.queryItems = [URLQueryItem(name: "q", value: trimmed)]
            if let url = search.url { open(url) }
        }
    }

    /// Signs out of every site and clears the browser's cookies, history and cache.
    func clearData(then done: @escaping () -> Void) {
        WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
            Task { @MainActor in
                self.goHome()
                done()
            }
        }
    }
}

/// The Online panel: back and forward, a search or address field, the
/// bookmarks, and the page.
struct OnlinePanel: View {
    @ObservedObject var browser: OnlineBrowser
    @State private var query = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                Button { browser.webView.goBack() } label: {
                    Image(systemName: "chevron.left").frame(width: 44, height: 44)
                }
                .disabled(!browser.canGoBack)
                .accessibilityLabel("Back")
                Button { browser.webView.goForward() } label: {
                    Image(systemName: "chevron.right").frame(width: 44, height: 44)
                }
                .disabled(!browser.canGoForward)
                .accessibilityLabel("Forward")
                TextField("Search Google or type an address", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.webSearch)
                    .submitLabel(.go)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onSubmit { browser.go(query) }
            }
            .padding(.horizontal, 6)
            .padding(.trailing, 4)
            HStack(spacing: 8) {
                ForEach(OnlineBrowser.bookmarks) { bookmark in
                    Button { browser.open(bookmark.url) } label: {
                        Label(bookmark.name, systemImage: bookmark.symbol)
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 32)
                    }
                    .buttonStyle(.bordered)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
            Divider()
            WebViewContainer(webView: browser.webView)
        }
    }
}

struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
