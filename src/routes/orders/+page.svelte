<script lang="ts">
	/**
	 * Order history and reorder.
	 *
	 * Reorder rebuilds the cart from the store and reports exactly what changed - a dish
	 * that left the menu, one that is out of stock, or one whose price moved - instead of
	 * quietly charging the new total. The invoice is generated client-side as a real PDF.
	 */
	import { goto } from '$app/navigation';
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import { formatPaise } from '#lib/logic/money';
	import { STATUS_COPY, formatWhen, orderReference, statusAt } from '#lib/logic/orders';
	import { invoiceFileName, invoicePdf } from '#lib/export/invoice';
	import type { Order } from '#lib/types';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import RatingDialog from '#lib/components/RatingDialog.svelte';
	import VegBadge from '#lib/components/VegBadge.svelte';

	let reorderReport = $state<{
		order: Order;
		unavailable: string[];
		priceChanged: { name: string; fromPaise: number; toPaise: number }[];
	} | null>(null);
	let ratingOrder = $state<Order | null>(null);

	let orders = $derived(app.orders);

	function reorder(order: Order) {
		const result = app.reorder(order.id);
		if (!result.ok) {
			app.toast(
				result.unavailable.length > 0
					? `Nothing from that order is available right now: ${result.unavailable.join(', ')}.`
					: 'That order could not be rebuilt.',
				'warning'
			);
			return;
		}
		if (result.unavailable.length > 0 || result.priceChanged.length > 0) {
			// Something changed - show it before the user walks into a surprise at checkout.
			reorderReport = { order, unavailable: result.unavailable, priceChanged: result.priceChanged };
			return;
		}
		app.toast(`${result.added} item${result.added === 1 ? '' : 's'} back in your cart.`, 'success');
		void goto(href('/cart'));
	}

	/** Order ids currently generating a PDF, so the button can show progress and block re-entry. */
	let generating = $state<string[]>([]);

	/**
	 * Build and download the invoice.
	 *
	 * Async because the PDF embeds a real font (fetched once from `static/fonts/`, then
	 * cached) so the invoice can print ₹ rather than "Rs.". A failed font load surfaces as a
	 * toast instead of silently producing a document with blank boxes where the rupee signs
	 * should be.
	 */
	async function downloadInvoice(order: Order) {
		if (generating.includes(order.id)) return;
		generating = [...generating, order.id];
		try {
			const blob = await invoicePdf(order);
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = invoiceFileName(order);
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			// Release the object URL once the download has been handed to the browser.
			setTimeout(() => URL.revokeObjectURL(url), 4000);
		} catch (error) {
			app.toast(
				error instanceof Error
					? `Could not build the invoice: ${error.message}`
					: 'Could not build the invoice.',
				'warning'
			);
		} finally {
			generating = generating.filter((id) => id !== order.id);
		}
	}
</script>

<svelte:head>
	<title>Your orders · FoodRush</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-5">
	<h1 class="text-2xl font-extrabold">Your orders</h1>

	{#if orders.length === 0}
		<EmptyState
			icon="bag"
			title="No orders yet"
			message="Once you order something it shows up here, with a receipt, an invoice and a one-tap reorder button."
		>
			{#snippet action()}
				<a href={href('/restaurants')} class="fr-btn-primary">Find something to eat</a>
			{/snippet}
		</EmptyState>
	{:else}
		<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-sm">
			{orders.length} order{orders.length === 1 ? '' : 's'} · tap any order to track or review it
		</p>

		<ul class="mt-5 space-y-4">
			{#each orders as order (order.id)}
				{@const status = statusAt(order, app.clock)}
				{@const live = status !== 'delivered' && status !== 'cancelled'}
				{@const review = app.reviewForOrder(order.id)}
				<li class="fr-card p-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<h2 class="text-base font-extrabold">
								<a href={href(`/restaurant?id=${order.restaurantId}`)} class="hover:text-saffron-700">
									{order.restaurantName}
								</a>
							</h2>
							<p class="text-cocoa-500 dark:text-cocoa-300 text-xs font-semibold">
								{orderReference(order.id)} · {formatWhen(order.placedAt, app.clock)}
							</p>
						</div>
						<span
							class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-wide uppercase {status ===
							'delivered'
								? 'bg-success/15 text-success dark:text-success-bright'
								: status === 'cancelled'
									? 'bg-danger/15 text-danger dark:text-danger-bright'
									: 'bg-saffron-500/15 text-saffron-700 dark:text-saffron-200'}"
						>
							{STATUS_COPY[status].title}
						</span>
					</div>

					<ul class="text-cocoa-600 dark:text-cocoa-200 mt-3 space-y-1 text-sm">
						{#each order.lines.slice(0, 3) as line (line.id)}
							<li class="flex items-center gap-2">
								<VegBadge veg={line.veg} size={13} />
								<span class="truncate">{line.name} × {line.quantity}</span>
							</li>
						{/each}
						{#if order.lines.length > 3}
							<li class="text-cocoa-500 dark:text-cocoa-300 text-xs font-semibold">
								+{order.lines.length - 3} more item{order.lines.length - 3 === 1 ? '' : 's'}
							</li>
						{/if}
					</ul>

					<p class="mt-3 text-sm font-extrabold">
						{formatPaise(order.price.totalPaise)}
						{#if order.price.discountPaise > 0}
							<span class="text-success dark:text-success-bright text-xs font-bold">
								· saved {formatPaise(order.price.discountPaise)}
							</span>
						{/if}
					</p>

					{#if review}
						<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-xs font-semibold">
							You rated it {review.foodRating}★ food · {review.deliveryRating}★ delivery
						</p>
					{/if}

					<div class="mt-3 flex flex-wrap gap-2">
						<a href={href(`/order?id=${order.id}`)} class="fr-btn-secondary min-h-10 px-4 text-xs">
							{live ? 'Track order' : 'View details'}
						</a>
						{#if status !== 'cancelled'}
							<button type="button" class="fr-btn-primary min-h-10 px-4 text-xs" onclick={() => reorder(order)}>
								Reorder
							</button>
						{/if}
						{#if status === 'delivered'}
							<button
								type="button"
								class="fr-btn-ghost min-h-10 px-3 text-xs"
								onclick={() => (ratingOrder = order)}
							>
								{review ? 'Edit rating' : 'Rate order'}
							</button>
						{/if}
						<button
							type="button"
							class="fr-btn-ghost min-h-10 px-3 text-xs"
							onclick={() => downloadInvoice(order)}
							disabled={generating.includes(order.id)}
							aria-busy={generating.includes(order.id)}
						>
							{generating.includes(order.id) ? 'Building PDF…' : 'Invoice (PDF)'}
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<!-- Reorder report: what could not be restored, before the user hits checkout. -->
<Dialog
	open={Boolean(reorderReport)}
	title="Cart rebuilt, with changes"
	variant="centred"
	onClose={() => (reorderReport = null)}
>
	{#if reorderReport}
		{#if reorderReport.unavailable.length > 0}
			<p class="text-sm font-bold">Not available right now</p>
			<ul class="text-cocoa-600 dark:text-cocoa-200 mt-1 list-inside list-disc text-sm">
				{#each reorderReport.unavailable as name (name)}
					<li>{name}</li>
				{/each}
			</ul>
			<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-xs">
				These were left out of your cart.
			</p>
		{/if}

		{#if reorderReport.priceChanged.length > 0}
			<p class="mt-4 text-sm font-bold">Prices changed since then</p>
			<ul class="text-cocoa-600 dark:text-cocoa-200 mt-1 space-y-0.5 text-sm">
				{#each reorderReport.priceChanged as change (change.name)}
					<li>
						{change.name}:
						<s class="text-cocoa-500">{formatPaise(change.fromPaise)}</s>
						→ <span class="font-bold">{formatPaise(change.toPaise)}</span>
					</li>
				{/each}
			</ul>
			<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-xs">
				Your cart uses today's menu prices.
			</p>
		{/if}
	{/if}

	{#snippet footer()}
		<div class="flex gap-3">
			<button type="button" class="fr-btn-secondary flex-1" onclick={() => (reorderReport = null)}>
				Stay here
			</button>
			<button
				type="button"
				class="fr-btn-primary flex-1"
				onclick={() => {
					reorderReport = null;
					void goto(href('/cart'));
				}}
				data-autofocus
			>
				Go to cart
			</button>
		</div>
	{/snippet}
</Dialog>

<RatingDialog order={ratingOrder} onClose={() => (ratingOrder = null)} />
