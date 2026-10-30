<script lang="ts">
	/**
	 * Coupon wallet: every coupon with its real status against the CURRENT cart.
	 *
	 * The same `rankCoupons` evaluation the cart uses drives this page, so a coupon marked
	 * "add ₹149 more" here is the exact reason the cart would give.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import { formatPaise } from '#lib/logic/money';
	import { formatDate } from '#lib/logic/coupons';

	let copied = $state<string | null>(null);

	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			copied = code;
			setTimeout(() => (copied = null), 2000);
		} catch {
			// Clipboard blocked (insecure context / permission) - tell the user plainly.
			app.toast(`Copy failed. The code is ${code}.`, 'warning');
		}
	}
</script>

<svelte:head>
	<title>Offers & coupons · FoodRush</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-5">
	<h1 class="text-2xl font-extrabold">Offers & coupons</h1>
	<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-sm">
		{#if app.cartCount > 0}
			Checked against your current cart ({formatPaise(app.price.itemTotalPaise)} of food from
			{app.cartRestaurant?.name}).
		{:else}
			Add something to your cart and this page will tell you exactly which coupons apply.
		{/if}
	</p>

	{#if app.catalogStatus !== 'ready'}
		<ul class="mt-5 space-y-3" aria-hidden="true">
			{#each Array.from({ length: 5 }, (_, index) => index) as index (index)}
				<li class="fr-skeleton h-28 rounded-card"></li>
			{/each}
		</ul>
	{:else}
		<ul class="mt-5 space-y-3">
			{#each app.couponOffers as offer (offer.coupon.code)}
				{@const usable = offer.evaluation.ok}
				<li
					class="fr-card p-4 {usable ? 'border-saffron-500/50' : 'fr-dimmed'}"
				>
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<code
									class="bg-saffron-500/12 text-saffron-700 dark:text-saffron-200 rounded-lg px-2.5 py-1 font-mono text-sm font-extrabold"
								>
									{offer.coupon.code}
								</code>
								{#if offer.coupon.restaurantId}
									<span class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
										{app.restaurant(offer.coupon.restaurantId)?.name ?? 'Selected restaurant'} only
									</span>
								{/if}
								{#if offer.coupon.firstOrderOnly}
									<span class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
										First order
									</span>
								{/if}
							</div>
							<p class="mt-1.5 text-base font-extrabold">{offer.coupon.title}</p>
							<p class="text-cocoa-600 dark:text-cocoa-200 mt-0.5 text-sm">
								{offer.coupon.description}
							</p>
							<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-xs font-semibold">
								{#if offer.coupon.minOrderPaise > 0}
									Minimum order {formatPaise(offer.coupon.minOrderPaise)} ·
								{/if}
								Valid until {formatDate(offer.coupon.expiresOn)}
							</p>

							{#if usable}
								{#if offer.savingsPaise > 0}
									<p class="text-success dark:text-success-bright mt-2 text-sm font-extrabold">
										Saves you {formatPaise(offer.savingsPaise)} right now
									</p>
								{:else}
									<p class="text-success dark:text-success-bright mt-2 text-sm font-bold">
										Ready to use
									</p>
								{/if}
							{:else}
								<p class="text-warn dark:text-warn-bright mt-2 text-sm font-bold">
									{offer.evaluation.reason}
								</p>
							{/if}
						</div>

						<div class="flex shrink-0 flex-col gap-2">
							<button
								type="button"
								class="fr-btn-secondary min-h-10 px-3.5 text-xs"
								onclick={() => copyCode(offer.coupon.code)}
							>
								{copied === offer.coupon.code ? 'Copied!' : 'Copy code'}
							</button>
							{#if usable && app.cartCount > 0}
								<button
									type="button"
									class="fr-btn-primary min-h-10 px-3.5 text-xs"
									onclick={() => {
										const result = app.applyCoupon(offer.coupon.code);
										app.toast(
											result.ok ? `${offer.coupon.code} applied to your cart.` : result.error,
											result.ok ? 'success' : 'warning'
										);
									}}
								>
									Apply
								</button>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>

		<p class="text-cocoa-500 dark:text-cocoa-300 mt-5 text-xs">
			One coupon per order. We never stack two discounts - if several apply, pick the one that
			saves the most.
		</p>

		{#if app.cartCount === 0}
			<a href={href('/restaurants')} class="fr-btn-primary mt-4">Start an order</a>
		{:else}
			<a href={href('/cart')} class="fr-btn-primary mt-4">Back to cart</a>
		{/if}
	{/if}
</div>
