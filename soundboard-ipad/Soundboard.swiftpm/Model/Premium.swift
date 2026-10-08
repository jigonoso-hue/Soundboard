import StoreKit
import SwiftUI

/// Premium: the same rules as the Android app (soundboard-mac/src/premium.js;
/// keep the two the same). The Mac app is always unlocked.
///
/// Free: 10 clips, 5 full sounds, 5 bashes and 2 scene kits; all of ambience,
/// bookmarks and playlists; broadcasting with dice, custom dice and players'
/// sounds. Premium: no limits, plus the broadcaster's games, handouts,
/// whispers, emphasis, and roll requests, initiative and contests. Listeners
/// never need Premium. Nothing is taken away if Premium lapses; only adding
/// more past the limits is blocked.
enum PremiumRules {
    enum Limit: String {
        case clips, full, bashes, kits

        var max: Int {
            switch self {
            case .clips: return 10
            case .full: return 5
            case .bashes: return 5
            case .kits: return 2
            }
        }

        var message: String {
            let what: String
            switch self {
            case .clips: what = "\(max) clips"
            case .full: what = "\(max) full sounds"
            case .bashes: what = "\(max) bashes"
            case .kits: what = "\(max) scene kits"
            }
            return "The free version holds up to \(what). Premium removes the limit."
        }
    }

    /// The limit one more sound of this kind would break, or nil.
    static func soundLimit(_ sounds: [Sound], adding kind: SoundKind) -> Limit? {
        let full = sounds.filter(\.isFull).count
        if kind == .full { return full >= Limit.full.max ? .full : nil }
        return sounds.count - full >= Limit.clips.max ? .clips : nil
    }
}

/// What only a broadcaster with Premium can start.
enum PremiumFeature: String, CaseIterable {
    case games, handouts, whispers, emphasis, table

    var title: String {
        switch self {
        case .games: return "Games: buzzer and quiz"
        case .handouts: return "Handouts: show pictures on listeners’ screens"
        case .whispers: return "Whispers: play a sound to chosen listeners"
        case .emphasis: return "Emphasis: make listeners’ phones vibrate"
        case .table: return "Roll requests, initiative and “Who wins?” contests"
        }
    }

    var reason: String {
        switch self {
        case .games: return "Games are part of Premium."
        case .handouts: return "Handouts are part of Premium."
        case .whispers: return "Whispers are part of Premium."
        case .emphasis: return "Emphasis is part of Premium."
        case .table: return "Roll requests, initiative and contests are part of Premium."
        }
    }
}

/// Why the Premium screen is open (nil reason: opened from the sidebar).
struct PremiumRequest: Identifiable {
    let id = UUID()
    let reason: String?
}

/// Purchases through the App Store. In App Store Connect:
/// - an auto-renewable subscription group "Premium" with
///   com.dungeonradio.premium.monthly and com.dungeonradio.premium.yearly;
/// - a non-consumable com.dungeonradio.premium.lifetime.
/// Any of them unlocks Premium. The last answer is kept, so it works offline.
@MainActor
final class Premium: ObservableObject {
    static let shared = Premium()

    static let monthly = "com.dungeonradio.premium.monthly"
    static let yearly = "com.dungeonradio.premium.yearly"
    static let lifetime = "com.dungeonradio.premium.lifetime"
    static let productIDs = [yearly, monthly, lifetime]

    @Published private(set) var owned: Bool
    @Published private(set) var products: [Product] = []
    @Published private(set) var busy = false
    @Published var message: String?
    /// The Premium screen, when it's open.
    @Published var request: PremiumRequest?
    #if DEBUG
    /// Test builds: unlocked without buying (purchases need App Store Connect or a StoreKit file).
    @Published var testUnlock = UserDefaults.standard.bool(forKey: "premiumTestUnlock") {
        didSet { UserDefaults.standard.set(testUnlock, forKey: "premiumTestUnlock") }
    }
    #endif

    var isPremium: Bool {
        #if DEBUG
        if testUnlock { return true }
        #endif
        return owned
    }

    private var updates: Task<Void, Never>?

    private init() {
        owned = UserDefaults.standard.bool(forKey: "premiumOwned")
        // Purchases made elsewhere (another device, a renewal, a refund) arrive here.
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let transaction) = result { await transaction.finish() }
                await self?.refresh()
            }
        }
        Task {
            await loadProducts()
            await refresh()
        }
    }

    // MARK: Asking

    /// True if unlocked; otherwise opens the Premium screen and says why.
    @discardableResult
    func require(_ feature: PremiumFeature) -> Bool {
        if isPremium { return true }
        request = PremiumRequest(reason: feature.reason)
        return false
    }

    /// True if one more bash (or kit) fits; otherwise opens the Premium screen.
    func allows(_ limit: PremiumRules.Limit, count: Int) -> Bool {
        if isPremium || count < limit.max { return true }
        request = PremiumRequest(reason: limit.message)
        return false
    }

    func open() { request = PremiumRequest(reason: nil) }

    // MARK: The store

    func loadProducts() async {
        do {
            let found = try await Product.products(for: Self.productIDs)
            products = Self.productIDs.compactMap { id in found.first { $0.id == id } }
        } catch {
            message = "Prices aren’t available right now. Check your connection and try again."
        }
    }

    /// Asks the App Store what this account owns.
    func refresh() async {
        var found = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result, Self.productIDs.contains(transaction.productID), transaction.revocationDate == nil {
                found = true
            }
        }
        owned = found
        UserDefaults.standard.set(found, forKey: "premiumOwned")
    }

    func purchase(_ product: Product) async {
        busy = true
        defer { busy = false }
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification else {
                    message = "The App Store couldn’t confirm that purchase."
                    return
                }
                await transaction.finish()
                await refresh()
                if isPremium { message = "Premium is on. Thank you!" }
            case .pending:
                message = "Your purchase is waiting for approval. Premium turns on once it goes through."
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            message = "The purchase didn’t go through (\(error.localizedDescription))."
        }
    }

    func restore() async {
        busy = true
        defer { busy = false }
        do { try await AppStore.sync() } catch { /* the user may cancel the sign-in */ }
        await refresh()
        message = isPremium ? "Premium restored." : "No Premium purchase found for this Apple ID."
    }

    static func priceLine(_ product: Product) -> String {
        switch product.id {
        case yearly: return "\(product.displayPrice) a year"
        case monthly: return "\(product.displayPrice) a month"
        default: return "\(product.displayPrice) once, yours to keep"
        }
    }

    static func title(_ product: Product) -> String {
        switch product.id {
        case yearly: return "Yearly"
        case monthly: return "Monthly"
        default: return "Lifetime"
        }
    }
}

// MARK: - The Premium screen

struct PremiumView: View {
    @ObservedObject var premium = Premium.shared
    let reason: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let reason, !premium.isPremium {
                    Section {
                        Text(reason).font(.headline)
                    }
                }
                Section {
                    Label("Unlimited sounds, bashes and scene kits", systemImage: "infinity")
                    ForEach(PremiumFeature.allCases, id: \.self) { feature in
                        Label(feature.title, systemImage: icon(feature))
                    }
                } footer: {
                    Text("Your players never need Premium: when you broadcast, everyone in your session gets all of it.")
                }
                if premium.isPremium {
                    Section {
                        Label("Premium is on", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                        if !premium.owned {
                            Text("Unlocked for testing.").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Section {
                        if premium.products.isEmpty {
                            Text("Prices aren’t available right now. Check your connection and try again.")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(premium.products, id: \.id) { product in
                            Button {
                                Task { await premium.purchase(product) }
                            } label: {
                                HStack {
                                    Text(Premium.title(product)).font(.headline)
                                    Spacer()
                                    Text(Premium.priceLine(product))
                                }
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .disabled(premium.busy)
                        }
                    } footer: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Free: 10 clips, 5 full sounds, 5 bashes and 2 scene kits, all of ambience, and broadcasting with dice, custom dice and players’ sounds.")
                            // What the App Store requires next to subscription prices.
                            Text("Subscriptions renew automatically at the price shown until you cancel. Payment is charged to your Apple ID. Cancel any time in Settings → your name → Subscriptions, at least 24 hours before the period ends. Lifetime is a single payment.")
                        }
                    }
                    Section {
                        Button("Restore Purchases") { Task { await premium.restore() } }
                            .disabled(premium.busy)
                    }
                }
                if premium.isPremium && premium.owned {
                    Section {
                        Button("Manage Subscription") {
                            if let url = URL(string: "https://apps.apple.com/account/subscriptions") { UIApplication.shared.open(url) }
                        }
                    }
                }
                Section {
                    Link("Terms of Use", destination: LegalLinks.terms)
                    Link("Privacy Policy", destination: LegalLinks.privacy)
                }
                #if DEBUG
                Section {
                    Toggle("Unlock for testing (test build)", isOn: $premium.testUnlock)
                }
                #endif
            }
            .navigationTitle("⭐ Premium")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(premium.isPremium ? "Done" : "Not Now") { dismiss() }
                }
            }
            .alert(premium.message ?? "", isPresented: Binding(get: { premium.message != nil }, set: { if !$0 { premium.message = nil } })) {
                Button("OK", role: .cancel) {}
            }
            .task { if premium.products.isEmpty { await premium.loadProducts() } }
        }
    }

    private func icon(_ feature: PremiumFeature) -> String {
        switch feature {
        case .games: return "bell"
        case .handouts: return "map"
        case .whispers: return "ear"
        case .emphasis: return "iphone.radiowaves.left.and.right"
        case .table: return "dice"
        }
    }
}

/// In place of a locked panel in the dice tray.
struct PremiumLockCard: View {
    let feature: PremiumFeature

    var body: some View {
        VStack(spacing: 8) {
            Text("⭐ Premium").font(.headline).foregroundStyle(Color(hex: 0xF5C542))
            Text(feature.title).font(.footnote).multilineTextAlignment(.center)
            Button("See Premium") { Premium.shared.open() }
                .accentProminent()
                .frame(minHeight: 44)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
    }
}

/// Shows the Premium screen when something asks for it. On the app's root
/// view and inside the sheets that can hit a limit (a sheet can only be shown
/// from the topmost one).
struct PremiumPresenter: ViewModifier {
    @ObservedObject var premium = Premium.shared

    func body(content: Content) -> some View {
        content.sheet(item: $premium.request) { request in
            PremiumView(reason: request.reason)
        }
    }
}

extension View {
    func premiumSheet() -> some View { modifier(PremiumPresenter()) }
}

/// A broadcaster's panel that's Premium: the lock card instead while locked.
struct PremiumGate<Content: View>: View {
    @ObservedObject var premium = Premium.shared
    let feature: PremiumFeature
    let content: () -> Content

    init(_ feature: PremiumFeature, @ViewBuilder content: @escaping () -> Content) {
        self.feature = feature
        self.content = content
    }

    var body: some View {
        if premium.isPremium { content() } else { PremiumLockCard(feature: feature) }
    }
}

/// The sidebar's way in: "Get Premium", or a quiet "Premium" once it's on.
struct PremiumRow: View {
    @ObservedObject var premium = Premium.shared

    var body: some View {
        Button {
            premium.open()
        } label: {
            Label(premium.isPremium ? "Premium" : "Get Premium", systemImage: premium.isPremium ? "star.fill" : "star")
                .foregroundStyle(premium.isPremium ? Color.secondary : Color(hex: 0xF5C542))
        }
        .accessibilityHint("Unlimited sounds, games, handouts, whispers and more")
    }
}

/// The Privacy Policy, Terms of Use and Licenses, served by the Live Session
/// relay (live-relay/legal). The same pages the stores link to.
enum LegalLinks {
    static let privacy = URL(string: "https://soundboard-r1zt.onrender.com/privacy")!
    static let terms = URL(string: "https://soundboard-r1zt.onrender.com/terms")!
    static let licenses = URL(string: "https://soundboard-r1zt.onrender.com/licenses")!
}
