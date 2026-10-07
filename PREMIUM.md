# Dungeon Radio Premium

The iPhone/iPad and Android apps have a free version and Premium. The Mac app
is always unlocked.

## What's free and what's Premium

| | Free | Premium |
| --- | --- | --- |
| Clips | 10 | Unlimited |
| Full sounds | 5 | Unlimited |
| Bashes | 5 | Unlimited |
| Scene kits | 2 | Unlimited |
| Ambience, bookmarks, playlists, recording | ✓ | ✓ |
| Broadcasting, dice, custom dice, players' sounds | ✓ | ✓ |
| Games (buzzer, quiz) | | ✓ |
| Handouts | | ✓ |
| Whispers and emphasis | | ✓ |
| Roll requests, initiative, "Who wins?" | | ✓ |

- **Listeners never need Premium.** Only the broadcaster does. When a
  broadcaster with Premium runs a game, sends a handout or whispers, every
  listener gets it, whatever version they have.
- **Nothing is taken away** if Premium lapses (a subscription ends or is
  refunded). Everything already made keeps working; only adding more past the
  limits is blocked.
- **Purchases belong to each store.** Buying on iPhone unlocks every Apple
  device signed in to that Apple ID, and buying on Android unlocks that Google
  account. One doesn't unlock the other.

The rules live in `soundboard-mac/src/premium.js` (used by Android) and
`soundboard-ipad/Soundboard.swiftpm/Model/Premium.swift` (iPhone/iPad). Keep
the two the same.

## Products

Three ways to buy, all unlocking the same Premium. Prices are set in each
store, and the apps show whatever the store says.

| | App Store (iPhone/iPad) | Google Play (Android) |
| --- | --- | --- |
| Monthly | Auto-renewable subscription `com.dungeonradio.premium.monthly` | Subscription `premium`, base plan `monthly` |
| Yearly | Auto-renewable subscription `com.dungeonradio.premium.yearly` | Subscription `premium`, base plan `yearly` |
| Lifetime | Non-consumable `com.dungeonradio.premium.lifetime` | One-time product `premium_lifetime` |

On the App Store, put the two subscriptions in one subscription group (for
example "Premium"), so people can switch between monthly and yearly.

## Setting up the stores

### Apple (App Store Connect)

1. Join the Apple Developer Program, if you haven't already. It costs $99 a
   year.
2. Give the app a real bundle ID and your team. In
   `soundboard-ipad/Soundboard.swiftpm/Package.swift` these are currently
   `com.local.soundboard` with no team. Changing the bundle ID makes it a new
   app on devices, so libraries on test installs won't carry over.
3. In App Store Connect, create the app, then add the three products above
   under **Monetization → Subscriptions** and **In-App Purchases**. Each needs
   a price, a display name and a review screenshot of the Premium screen.
4. Sign the **Paid Apps Agreement**, and fill in tax and banking details.
   Purchases don't work until you do.
5. **Testing:**
   - Debug builds in the Simulator have an "Unlock for testing" switch on the
     Premium screen.
   - To try real purchase screens without App Store Connect, open the package
     in Xcode and choose **File → New → File → StoreKit Configuration File**.
     Add the three product IDs, then pick the file under **Product → Scheme →
     Edit Scheme → Run → Options → StoreKit Configuration**.
   - With App Store Connect set up, use a Sandbox account (Settings → App
     Store → Sandbox Account) or TestFlight.

### Google (Play Console)

1. Create a Google Play developer account. It costs $25, once.
2. Create the app with the application ID `com.dungeonradio.app`. That's the
   one in `soundboard-android/app/build.gradle.kts`, and it can't change after
   the first upload. Turn on Play App Signing.
3. Upload a signed build to the **Internal testing** track. Play only lists
   products for an app it has a build of.
4. Under **Monetize → Products**:
   - in **Subscriptions**, create `premium` with two auto-renewing base plans,
     `monthly` and `yearly`, and activate both;
   - in **In-app products**, create `premium_lifetime` and activate it.
5. Set up a merchant account (Payments profile) to get paid.
6. **Testing:**
   - Debug builds have an "Unlock for testing" button on the Premium screen.
   - For real purchases, add yourself under **Settings → License testing**
     and install the app from the internal testing link. Test purchases
     aren't charged, and test subscriptions renew every few minutes.

## Where it's built

- **Web screens** (shared, shown on Android):
  - `soundboard-mac/src/renderer/premium.js`: the Premium screen, the
    sidebar button and the locks.
  - Gates in `live.js` (whispers, emphasis), `games.js`, `handouts.js` and
    `table.js`.
- **Android:**
  - `soundboard-android/web/android-main.js` enforces the limits where
    sounds, bashes and kits are stored.
  - `app/.../Billing.kt` handles Google Play Billing.
  - Test: `node soundboard-android/web-test/premium.js`.
- **iPhone/iPad:**
  - `Model/Premium.swift` has StoreKit 2, the Premium screen, the lock card
    and the sidebar row.
  - Limits are enforced in `SoundStore` and at the bash and kit creation
    points.
  - Locks are in `LiveView`, `GamesView` and `DiceView`'s tray panels.

Purchases are checked on the device: StoreKit 2 verifies the App Store's
signature, and Play Billing reads Play's records. There's no server. That's
the usual setup for an app this size; a determined person with a modified
Android build could get around it.
