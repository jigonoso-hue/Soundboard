import PhotosUI
import SwiftUI
import UIKit

// Listeners' pictures: each listener can pick one, shown beside their name for
// the broadcaster and everyone else (the listener list, Whisper, handouts,
// games, dice). Pictures are small square JPEGs, sent as base64. Matches the
// Mac app's face() in live.js.

/// Decoded pictures, so a list doesn't decode the same one on every redraw
/// (used from the main thread; avatar(from:) is safe on any thread).
enum FaceCache {
    private static var images: [String: UIImage] = [:]

    static func image(_ base64: String) -> UIImage? {
        if base64.isEmpty { return nil }
        let key = String(base64.prefix(64)) + "\(base64.count)"
        if let hit = images[key] { return hit }
        guard let data = Data(base64Encoded: base64), let image = UIImage(data: data) else { return nil }
        if images.count > 64 { images.removeAll() }
        images[key] = image
        return image
    }

    /// A picture made into a small square JPEG (cropped from the middle), as
    /// base64 small enough to send, or nil.
    static func avatar(from image: UIImage, size: CGFloat = 192) -> String? {
        let width = image.size.width
        let height = image.size.height
        guard width > 0, height > 0 else { return nil }
        let side = min(width, height)
        let scale = size / side
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let square = UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: format).image { _ in
            image.draw(in: CGRect(x: -(width - side) / 2 * scale, y: -(height - side) / 2 * scale,
                                  width: width * scale, height: height * scale))
        }
        for quality in [0.82, 0.7, 0.55, 0.4] as [CGFloat] {
            if let data = square.jpegData(compressionQuality: quality), data.count <= LiveNet.avatarMax {
                return data.base64EncodedString()
            }
        }
        return nil
    }
}

/// A round picture, or the name's first letter when there's none.
struct FaceView: View {
    let avatar: String
    let name: String
    var size: CGFloat = 28

    var body: some View {
        Group {
            if let image = FaceCache.image(avatar) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Text(String(name.trimmingCharacters(in: .whitespaces).first ?? "?").uppercased())
                    .font(.system(size: size * 0.45, weight: .bold))
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.accentColor.opacity(0.75))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

extension LiveSession {
    /// Someone's face, by peer id ("host" is the broadcaster).
    func face(_ peer: String, name: String, size: CGFloat = 28) -> FaceView {
        FaceView(avatar: avatar(of: peer), name: name, size: size)
    }
}

/// Choose your picture from Photos: cropped square, made small, then sent.
struct AvatarPicker<Label: View>: View {
    @EnvironmentObject private var live: LiveSession
    @State private var item: PhotosPickerItem?
    @ViewBuilder let label: () -> Label

    var body: some View {
        PhotosPicker(selection: $item, matching: .images) { label() }
            .onChange(of: item) { _, picked in
                guard let picked else { return }
                item = nil
                Task { @MainActor in
                    guard let data = try? await picked.loadTransferable(type: Data.self),
                          let image = UIImage(data: data),
                          let avatar = await Task.detached(priority: .userInitiated, operation: { FaceCache.avatar(from: image) }).value
                    else {
                        live.notice = "Couldn't use that picture."
                        return
                    }
                    live.setAvatar(avatar)
                }
            }
    }
}
