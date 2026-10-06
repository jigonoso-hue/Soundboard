import CryptoKit
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// Handouts: pictures the broadcaster pushes to every listener's screen (a map,
// a wanted poster, a monster reveal). A new one locks the listener's screen to
// it, fitted to the screen, until they close it; pinch to zoom, drag to look
// around, Save to keep a copy. Handouts are only kept for the session: the
// list of them goes away when the listener leaves. Matches the Mac app's
// handouts.js.

// MARK: - A handout

struct Handout: Identifiable, Equatable {
    let id: String
    var title: String
    /// The picture, in the session's temporary folder (nil until it arrives).
    var url: URL?
    /// A new handout: lock the screen to it.
    var show: Bool

    /// Pictures are scaled down to this many pixels on their longest side.
    static let maxSide: CGFloat = 2048

    /// One line, up to 60 characters.
    static func cleanTitle(_ text: String) -> String {
        let line = String(text.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) ? " " : Character($0) })
        return String(line.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
    }

    /// Where the broadcaster's sent pictures wait until the session ends.
    private static var sentFolder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("handouts-sent", isDirectory: true)
    }

    /// Scales a picture down, saves it as a JPEG and hashes it, ready to send.
    static func prepare(_ image: UIImage) -> (url: URL, hash: String)? {
        let width = image.size.width * image.scale
        let height = image.size.height * image.scale
        guard width > 0, height > 0 else { return nil }
        let ratio = min(1, maxSide / max(width, height))
        let size = CGSize(width: max(1, (width * ratio).rounded()), height: max(1, (height * ratio).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let scaled = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let data = scaled.jpegData(compressionQuality: 0.85) else { return nil }
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        try? FileManager.default.createDirectory(at: sentFolder, withIntermediateDirectories: true)
        let url = sentFolder.appendingPathComponent("\(hash).jpg")
        do { try data.write(to: url, options: .atomic) } catch { return nil }
        return (url, hash)
    }

    /// Deletes the broadcaster's sent pictures (the session ended).
    static func dropSent() {
        try? FileManager.default.removeItem(at: sentFolder)
    }
}

// MARK: - The lock

/// A new handout covers everything (sheets, the dice, even a game) in its own
/// window until the listener closes it.
@MainActor
final class HandoutLock {
    static let shared = HandoutLock()
    private var window: UIWindow?

    func update(_ live: LiveSession) {
        let showing = live.role == .listener && live.viewingHandout != nil
        if showing && window == nil {
            guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }) ?? UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert + 2
            let host = UIHostingController(rootView: HandoutLockView().environmentObject(live))
            host.view.backgroundColor = .clear
            window.rootViewController = host
            window.makeKeyAndVisible()
            self.window = window
            UIAccessibility.post(notification: .screenChanged, argument: nil)
        } else if !showing, let window {
            window.isHidden = true
            self.window = nil
        }
    }
}

private struct HandoutLockView: View {
    @EnvironmentObject private var live: LiveSession

    var body: some View {
        if let handout = live.viewingHandout, let url = handout.url {
            HandoutViewer(title: handout.title, url: url) { live.closeHandout() }
                .id(handout.id)
        }
    }
}

// MARK: - The viewer

/// A picture fitted to the screen: pinch to zoom, drag to look around,
/// double-tap to zoom in or back out. Save and Close at the bottom.
struct HandoutViewer: View {
    let title: String
    let url: URL
    let onClose: () -> Void

    @State private var image: UIImage?
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    private static let maxZoom: CGFloat = 6

    var body: some View {
        ZStack {
            Color(red: 0.024, green: 0.024, blue: 0.04).ignoresSafeArea()
            VStack(spacing: 0) {
                Text(title.isEmpty ? "Handout" : title)
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                GeometryReader { geo in
                    if let image {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(width: geo.size.width, height: geo.size.height)
                            .scaleEffect(scale)
                            .offset(offset)
                            .gesture(zoom(in: geo.size).simultaneously(with: pan(in: geo.size)))
                            .onTapGesture(count: 2) {
                                withAnimation(.easeOut(duration: 0.25)) {
                                    if scale > 1.01 {
                                        reset()
                                    } else {
                                        scale = 2.5
                                        lastScale = 2.5
                                    }
                                }
                            }
                            .accessibilityLabel(title.isEmpty ? "Handout" : title)
                            .accessibilityHint("Pinch to zoom, double-tap to zoom in or out")
                    } else {
                        ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .clipped()
                HStack(spacing: 12) {
                    if let image {
                        ShareLink(item: url, preview: SharePreview(title.isEmpty ? "Handout" : title, image: Image(uiImage: image))) {
                            Text("Save")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .foregroundStyle(Color.white)
                                .background(Color.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 14))
                                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.white.opacity(0.22)))
                        }
                        .accessibilityHint("Keep a copy of this picture")
                    }
                    Button(action: onClose) {
                        Text("Close")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .foregroundStyle(Color.white)
                            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .layoutPriority(1)
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 8)
            }
        }
        .task(id: url) {
            image = UIImage(contentsOfFile: url.path)
        }
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }

    /// Keeps the picture from being dragged off screen.
    private func clamped(_ value: CGSize, in size: CGSize, scale: CGFloat) -> CGSize {
        let maxX = max(0, size.width * (scale - 1) / 2)
        let maxY = max(0, size.height * (scale - 1) / 2)
        return CGSize(width: min(maxX, max(-maxX, value.width)), height: min(maxY, max(-maxY, value.height)))
    }

    private func zoom(in size: CGSize) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                scale = min(Self.maxZoom, max(1, lastScale * value.magnification))
                offset = clamped(offset, in: size, scale: scale)
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1.01 { withAnimation(.easeOut(duration: 0.2)) { reset() } }
                lastOffset = offset
            }
    }

    private func pan(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { value in
                guard scale > 1.01 else { return }
                offset = clamped(CGSize(width: lastOffset.width + value.translation.width,
                                        height: lastOffset.height + value.translation.height), in: size, scale: scale)
            }
            .onEnded { _ in lastOffset = offset }
    }
}

// MARK: - A listener's list

/// The session's handouts, newest first, from the stage's Handouts button.
struct HandoutLogView: View {
    @EnvironmentObject private var live: LiveSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                HandoutGrid(handouts: Array(live.handouts.reversed())) { handout in
                    dismiss()
                    live.openHandout(handout)
                }
                .padding(16)
                Text("Handouts are only kept until you leave the session. Open one and Save to keep a copy.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("Handouts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

/// Thumbnails with their titles.
struct HandoutGrid: View {
    let handouts: [Handout]
    let onTap: (Handout) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) {
            ForEach(handouts) { handout in
                Button {
                    onTap(handout)
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Color.black
                            .aspectRatio(4 / 3, contentMode: .fit)
                            .overlay {
                                if let url = handout.url, let image = UIImage(contentsOfFile: url.path) {
                                    Image(uiImage: image).resizable().scaledToFill()
                                }
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        Text(handout.title.isEmpty ? "Handout" : handout.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                            .foregroundStyle(Color.primary)
                    }
                    .padding(6)
                    .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(handout.title.isEmpty ? "handout" : handout.title)")
            }
        }
    }
}

// MARK: - The broadcaster

/// Send a picture to every listener's screen; show one sent earlier again.
struct HandoutSendView: View {
    @EnvironmentObject private var live: LiveSession
    @Environment(\.dismiss) private var dismiss
    @State private var photo: PhotosPickerItem?
    @State private var image: UIImage?
    @State private var title = ""
    @State private var importing = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("It fills every listener's screen until they close it. They can zoom in and save a copy.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let image {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity, maxHeight: 280)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    // Wraps onto two rows on a narrow phone.
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { choosers }
                        VStack(spacing: 10) { choosers }
                    }
                    if failed {
                        Text("Couldn't open that picture.").font(.footnote).foregroundStyle(.red)
                    }
                    TextField("Title, e.g. Wanted: The Red Fox (optional)", text: $title)
                        .textFieldStyle(.roundedBorder)
                    let sent = live.handouts.reversed()
                    if !sent.isEmpty {
                        Text("SENT THIS SESSION").font(.caption.weight(.bold)).foregroundStyle(.secondary).padding(.top, 8)
                        HandoutGrid(handouts: Array(sent)) { live.showHandoutAgain($0) }
                        Text("Tap one to show it on everyone's screen again.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .padding(16)
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    if let image { live.sendHandout(image, title: title) }
                    dismiss()
                } label: {
                    Text("Send to Everyone")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
                .disabled(image == nil)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .navigationTitle("Send a Handout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let picked = UIImage(data: data) {
                        image = picked
                        failed = false
                    } else {
                        failed = true
                    }
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
                guard case .success(let url) = result else { return }
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                if let data = try? Data(contentsOf: url), let picked = UIImage(data: data) {
                    image = picked
                    failed = false
                    if title.isEmpty {
                        title = Handout.cleanTitle(url.deletingPathExtension().lastPathComponent
                            .replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " "))
                    }
                } else {
                    failed = true
                }
            }
        }
    }

    @ViewBuilder
    private var choosers: some View {
        PhotosPicker(selection: $photo, matching: .images) {
            Label(image == nil ? "Choose from Photos" : "Another from Photos", systemImage: "photo.on.rectangle")
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
        Button {
            importing = true
        } label: {
            Label("Choose from Files", systemImage: "folder")
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
    }
}
