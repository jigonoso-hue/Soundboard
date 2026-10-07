package com.dungeonradio.app

import android.app.Activity
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClient.ProductType
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray
import org.json.JSONObject

/**
 * Premium through Google Play. In the Play Console:
 * - a subscription "premium" with two auto-renewing base plans, "monthly" and "yearly";
 * - a one-time product "premium_lifetime".
 * Any of them unlocks Premium. The page asks for them as premium_monthly,
 * premium_yearly and premium_lifetime. The last known answer is kept, so
 * Premium works offline. Test (debuggable) builds can also unlock without
 * buying, since purchases only work in builds installed from Play.
 */
class Billing(private val context: Context, private val onChanged: () -> Unit) : PurchasesUpdatedListener {
    private val main = Handler(Looper.getMainLooper())
    private val prefs = context.getSharedPreferences("premium", Context.MODE_PRIVATE)
    private val debug = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    private val client = BillingClient.newBuilder(context)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        // Reconnects by itself if Play's billing service drops.
        .enableAutoServiceReconnection()
        .build()

    @Volatile private var owned = prefs.getBoolean("owned", false)
    @Volatile private var subscription: ProductDetails? = null
    @Volatile private var lifetime: ProductDetails? = null
    @Volatile private var error: String? = null
    private var pending: ((JSONObject?, String?) -> Unit)? = null
    private var connecting = false

    val premium: Boolean get() = owned || (debug && prefs.getBoolean("testUnlock", false))

    fun start() = main.post { connect {} }

    private fun connect(then: () -> Unit) {
        if (client.isReady) { then(); return }
        if (connecting) { main.postDelayed({ connect(then) }, 500); return }
        connecting = true
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                main.post { setUp(result, then) }
            }

            override fun onBillingServiceDisconnected() { connecting = false }
        })
    }

    private fun setUp(result: BillingResult, then: () -> Unit) {
        connecting = false
        if (result.responseCode == BillingResponseCode.OK) {
            error = null
            loadProducts()
            refresh {}
        } else {
            error = "Google Play purchases aren’t available on this device (${result.debugMessage.ifEmpty { result.responseCode.toString() }})."
            onChanged()
        }
        then()
    }

    private fun loadProducts() {
        fun query(id: String, type: String, set: (ProductDetails?) -> Unit) {
            val params = QueryProductDetailsParams.newBuilder().setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder().setProductId(id).setProductType(type).build())).build()
            client.queryProductDetailsAsync(params) { result, found ->
                if (result.responseCode == BillingResponseCode.OK) { set(found.productDetailsList.firstOrNull()); main.post(onChanged) }
                else Log.w(TAG, "Products: ${result.debugMessage}")
            }
        }
        query(SUBSCRIPTION, ProductType.SUBS) { subscription = it }
        query(LIFETIME, ProductType.INAPP) { lifetime = it }
    }

    /** Asks Play for this account's purchases (subscriptions and the lifetime unlock). */
    fun refresh(done: () -> Unit) {
        connect {
            val found = ArrayList<Purchase>()
            client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(ProductType.SUBS).build()) { r1, subs ->
                if (r1.responseCode == BillingResponseCode.OK) found.addAll(subs)
                client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(ProductType.INAPP).build()) { r2, items ->
                    if (r2.responseCode == BillingResponseCode.OK) found.addAll(items)
                    main.post {
                        // Only a definite answer changes what's remembered (offline keeps the last one).
                        if (r1.responseCode == BillingResponseCode.OK && r2.responseCode == BillingResponseCode.OK) setOwned(found.any(::unlocks))
                        found.forEach(::acknowledge)
                        done()
                    }
                }
            }
        }
    }

    private fun unlocks(p: Purchase) = p.purchaseState == Purchase.PurchaseState.PURCHASED && p.products.any { it == SUBSCRIPTION || it == LIFETIME }

    private fun acknowledge(p: Purchase) {
        if (p.purchaseState != Purchase.PurchaseState.PURCHASED || p.isAcknowledged) return
        // Unacknowledged purchases are refunded by Play after three days.
        client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { r ->
            if (r.responseCode != BillingResponseCode.OK) Log.w(TAG, "Acknowledge: ${r.debugMessage}")
        }
    }

    private fun setOwned(value: Boolean) {
        val changed = value != owned
        owned = value
        prefs.edit().putBoolean("owned", value).apply()
        if (changed) onChanged()
    }

    /** Buys premium_monthly, premium_yearly or premium_lifetime; done(status, error). */
    fun purchase(activity: Activity?, id: String, done: (JSONObject?, String?) -> Unit) = main.post {
        if (activity == null) { done(null, "Open the app to buy Premium."); return@post }
        connect {
            val params = when (id) {
                ID_LIFETIME -> lifetime?.let { BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(it).build() }
                ID_MONTHLY, ID_YEARLY -> subscription?.let { details ->
                    val plan = if (id == ID_YEARLY) "yearly" else "monthly"
                    // The base plan itself, or a trial or discount on it if one is offered.
                    val offers = details.subscriptionOfferDetails.orEmpty().filter { it.basePlanId == plan }
                    val offer = offers.firstOrNull { it.offerId != null } ?: offers.firstOrNull()
                    offer?.let { BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details).setOfferToken(it.offerToken).build() }
                }
                else -> null
            }
            if (params == null) { done(null, error ?: "That isn’t available right now. Try again in a moment."); return@connect }
            pending?.invoke(null, "Cancelled.")
            pending = done
            val result = client.launchBillingFlow(activity, BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(params)).build())
            if (result.responseCode != BillingResponseCode.OK) {
                pending = null
                done(null, describe(result))
            }
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        main.post {
            val done = pending
            pending = null
            when (result.responseCode) {
                BillingResponseCode.OK -> {
                    val list = purchases.orEmpty()
                    list.forEach(::acknowledge)
                    if (list.any(::unlocks)) setOwned(true)
                    val waiting = list.any { it.purchaseState == Purchase.PurchaseState.PENDING }
                    if (waiting && !premium) done?.invoke(null, "Your payment is pending. Premium turns on once it goes through.")
                    else done?.invoke(status(), null)
                }
                BillingResponseCode.ITEM_ALREADY_OWNED -> refresh { done?.invoke(status(), null) }
                BillingResponseCode.USER_CANCELED -> done?.invoke(status(), null)
                else -> done?.invoke(null, describe(result))
            }
        }
    }

    private fun describe(result: BillingResult) = when (result.responseCode) {
        BillingResponseCode.SERVICE_UNAVAILABLE, BillingResponseCode.SERVICE_DISCONNECTED, BillingResponseCode.NETWORK_ERROR ->
            "Couldn’t reach Google Play. Check your connection and try again."
        BillingResponseCode.BILLING_UNAVAILABLE -> "Google Play purchases aren’t available on this device or account."
        else -> "The purchase didn’t go through (${result.debugMessage.ifEmpty { result.responseCode.toString() }})."
    }

    fun testUnlock(on: Boolean): JSONObject {
        if (debug) {
            prefs.edit().putBoolean("testUnlock", on).apply()
            main.post(onChanged)
        }
        return status()
    }

    /** What the page's Premium screen shows (see Platform.premiumStatus). */
    fun status(): JSONObject {
        val products = JSONArray()
        subscription?.subscriptionOfferDetails.orEmpty().filter { it.offerId == null }.forEach { plan ->
            val period = when (plan.basePlanId) { "yearly" -> "year"; "monthly" -> "month"; else -> return@forEach }
            // The price it renews at (after any trial or intro price).
            val price = plan.pricingPhases.pricingPhaseList.lastOrNull()?.formattedPrice ?: return@forEach
            products.put(JSONObject().put("id", if (period == "year") ID_YEARLY else ID_MONTHLY)
                .put("title", if (period == "year") "Yearly" else "Monthly").put("price", price).put("period", period))
        }
        lifetime?.oneTimePurchaseOfferDetails?.let {
            products.put(JSONObject().put("id", ID_LIFETIME).put("title", "Lifetime").put("price", it.formattedPrice).put("period", JSONObject.NULL))
        }
        return JSONObject().put("premium", premium).put("products", products).put("debug", debug)
            .put("manageUrl", "https://play.google.com/store/account/subscriptions?sku=$SUBSCRIPTION&package=${context.packageName}")
            .apply { error?.let { put("error", it) } }
    }

    companion object {
        private const val TAG = "DungeonRadio"
        const val SUBSCRIPTION = "premium"
        const val LIFETIME = "premium_lifetime"
        const val ID_MONTHLY = "premium_monthly"
        const val ID_YEARLY = "premium_yearly"
        const val ID_LIFETIME = "premium_lifetime"
    }
}
