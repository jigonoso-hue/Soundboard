import SwiftUI
import UIKit

/// A bash's cover: its picture, or its icon on a colour.
struct BashCoverView: View {
    @EnvironmentObject private var bashes: BashStore
    let cover: BashCover
    var size: CGFloat = 64

    var body: some View {
        if let file = cover.imageFile, let image = UIImage(contentsOfFile: bashes.coverURL(file).path) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
        } else {
            IconBadge(icon: cover.icon, color: cover.color, iconColor: cover.iconColor, size: size)
        }
    }
}

/// Starts or stops a bash.
@MainActor
func toggleBash(_ bash: Bash, store: SoundStore, player: SoundPlayer, bashPlayer: BashPlayer, ui: AppUI, gain: Double = 1) {
    if bashPlayer.isPlaying(bash.id) {
        bashPlayer.stop()
    } else if bash.clips.isEmpty {
        ui.editingBash = BashEditRequest(id: bash.id)
    } else {
        bashPlayer.play(bash, store: store, masterVolume: player.masterVolume * gain)
    }
}

/// A bash on the board: tap to play, long-press for options.
struct BashCard: View {
    @Environment(\.appTheme) private var theme
    @EnvironmentObject private var store: SoundStore
    @EnvironmentObject private var player: SoundPlayer
    @EnvironmentObject private var bashPlayer: BashPlayer
    @EnvironmentObject private var ui: AppUI
    let bash: Bash
    var size: ItemSize = .m
    /// Extra level, such as a scene kit section's volume slider.
    var gain: Double = 1

    var body: some View {
        let playing = bashPlayer.isPlaying(bash.id)
        let coverSize: CGFloat = size == .s ? 34 : (size == .l ? 60 : 44)
        Button {
            toggleBash(bash, store: store, player: player, bashPlayer: bashPlayer, ui: ui, gain: gain)
        } label: {
            HStack(spacing: 10) {
                BashCoverView(cover: bash.cover, size: coverSize)
                    .overlay {
                        if playing {
                            RoundedRectangle(cornerRadius: coverSize * 0.2, style: .continuous)
                                .fill(.black.opacity(0.45))
                            AppIcon(id: "stop", size: coverSize * 0.36)
                                .foregroundStyle(.white)
                        }
                    }
                VStack(alignment: .leading, spacing: 3) {
                    Text(bash.name)
                        .font(size == .l ? Font.headline : Font.subheadline.weight(.semibold))
                        .lineLimit(2)
                    Text(bash.clips.isEmpty ? "Empty, tap to edit" : "\(bash.soundCount) sound\(bash.soundCount == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(8)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(theme.cardFill(active: playing))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(playing ? theme.bashColor : theme.cardStroke, lineWidth: 1)
            )
            .overlay(alignment: .bottomLeading) {
                if playing {
                    GeometryReader { geo in
                        Rectangle()
                            .fill(theme.bashColor)
                            .frame(width: geo.size.width * (bashPlayer.progress ?? 0), height: 3)
                            .frame(maxHeight: .infinity, alignment: .bottom)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .contentShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .contextMenu { BashMenu(bash: bash) }
    }
}

/// Long-press menu for a bash.
struct BashMenu: View {
    @EnvironmentObject private var bashes: BashStore
    @EnvironmentObject private var bashPlayer: BashPlayer
    @EnvironmentObject private var kits: KitStore
    @EnvironmentObject private var ui: AppUI
    let bash: Bash

    var body: some View {
        Button {
            bashPlayer.stop()
            ui.editingBash = BashEditRequest(id: bash.id)
        } label: {
            Label("Edit…", systemImage: "pencil")
        }
        Button {
            guard Premium.shared.allows(.bashes, count: bashes.bashes.count) else { return }
            bashes.duplicate(bash.id)
        } label: {
            Label("Duplicate", systemImage: "plus.square.on.square")
        }
        Button {
            ui.choosingKitFor = KitChoice(item: KitItem(type: .bash, id: bash.id), label: bash.name)
        } label: {
            Label("Add to Scene Kit…", systemImage: "square.grid.2x2")
        }
        Divider()
        Button(role: .destructive) {
            if bashPlayer.isPlaying(bash.id) { bashPlayer.stop() }
            bashes.remove(bash.id)
            kits.prune(.bash, id: bash.id)
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }
}
