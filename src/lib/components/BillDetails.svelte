<script lang="ts">
	/**
	 * Bill details block, shared by the cart, checkout and the order receipt.
	 *
	 * It renders a `PriceBreakdown` and nothing else - it never computes a number. That is
	 * what guarantees the cart, checkout and receipt show identical figures: there is one
	 * pricing function and one renderer.
	 */
	import { formatPaise } from '#lib/logic/money';
	import type { PriceBreakdown } from '#lib/types';

	interface Props {
		price: PriceBreakdown;
		/** Pre-waiver delivery fee, so a waived fee can be shown struck through. */
		baseDeliveryFeePaise?: number;
		couponCode?: string | null;
		heading?: string;
	}

	let { price, baseDeliveryFeePaise, couponCode = null, heading = 'Bill details' }: Props = $props();

	let savings = $derived(
		price.discountPaise +
			(price.deliveryFeeWaived && baseDeliveryFeePaise ? baseDeliveryFeePaise : 0)
	);
</script>

<section class="fr-card p-4" aria-labelledby="bill-heading">
	<h2 id="bill-heading" class="text-sm font-extrabold tracking-wide uppercase">{heading}</h2>

	<dl class="mt-3 space-y-2 text-sm">
		<div class="flex justify-between gap-4">
			<dt>Item total</dt>
			<dd class="font-semibold tabular-nums">{formatPaise(price.itemTotalPaise, { decimals: true })}</dd>
		</div>

		{#if price.discountPaise > 0}
			<div class="text-success dark:text-success-bright flex justify-between gap-4">
				<dt>Coupon discount{couponCode ? ` (${couponCode})` : ''}</dt>
				<dd class="font-semibold tabular-nums">
					− {formatPaise(price.discountPaise, { decimals: true })}
				</dd>
			</div>
		{/if}

		<div class="flex justify-between gap-4">
			<dt>
				Delivery fee
				<span class="text-cocoa-500 dark:text-cocoa-300 block text-xs">
					{price.distanceKm} km from the restaurant
				</span>
			</dt>
			<dd class="shrink-0 font-semibold tabular-nums">
				{#if price.deliveryFeeWaived}
					{#if baseDeliveryFeePaise}
						<s class="text-cocoa-400 dark:text-cocoa-300 mr-1.5">{formatPaise(baseDeliveryFeePaise)}</s>
					{/if}
					<span class="text-success dark:text-success-bright">FREE</span>
				{:else}
					{formatPaise(price.deliveryFeePaise, { decimals: true })}
				{/if}
			</dd>
		</div>

		<div class="flex justify-between gap-4">
			<dt>Packaging charge</dt>
			<dd class="font-semibold tabular-nums">{formatPaise(price.packagingPaise, { decimals: true })}</dd>
		</div>

		<div class="flex justify-between gap-4">
			<dt>
				Taxes
				<span class="text-cocoa-500 dark:text-cocoa-300 block text-xs">
					GST 5% on food, 18% on delivery
				</span>
			</dt>
			<dd class="shrink-0 font-semibold tabular-nums">{formatPaise(price.taxPaise, { decimals: true })}</dd>
		</div>

		{#if price.tipPaise > 0}
			<div class="flex justify-between gap-4">
				<dt>Delivery tip</dt>
				<dd class="font-semibold tabular-nums">{formatPaise(price.tipPaise, { decimals: true })}</dd>
			</div>
		{/if}

		<div
			class="border-cocoa-200 dark:border-cocoa-800 flex justify-between gap-4 border-t pt-2.5 text-base font-extrabold"
		>
			<dt>To pay</dt>
			<dd class="tabular-nums">{formatPaise(price.totalPaise, { decimals: true })}</dd>
		</div>
	</dl>

	{#if savings > 0}
		<p
			class="bg-success/12 text-success dark:text-success-bright mt-3 rounded-xl px-3 py-2 text-center text-xs font-extrabold"
		>
			You saved {formatPaise(savings)} on this order
		</p>
	{/if}
</section>
