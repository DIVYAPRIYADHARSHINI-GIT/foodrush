<script lang="ts">
	/**
	 * Cart: line items with steppers and customisations, cart-level problems, the coupon
	 * box and offers sheet, the tip selector and the bill.
	 *
	 * Everything here is derived from the store. The bill comes from `app.price` - the same
	 * single pricing result checkout and the receipt use - so no number on this screen can
	 * disagree with the next one.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import { formatPaise } from '#lib/logic/money';
	import { groupedOptions } from '#lib/logic/cart';
	import { TIP_PRESETS_PAISE } from '#lib/logic/pricing';
	import BillDetails from '#lib/components/BillDetails.svelte';
	import Stepper from '#lib/components/Stepper.svelte';
	import VegBadge from '#lib/components/VegBadge.svelte';
	import FoodImage from '#lib/components/FoodImage.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Dialog from '#lib/components/Dialog.svelte';

	let couponInput = $state('');
	let couponError = $state<string | null>(null);
	let offersOpen = $state(false);
	let editingInstructions = $state<string | null>(null);
	let instructionsDraft = $state('');

	let restaurant = $derived(app.cartRestaurant);
	let lines = $derived(app.cart.lines);
	let price = $derived(app.price);

	/** Problems that block checkout (missing / out-of-stock), vs. informational ones. */
	let blocking = $derived(app.cartIssues.filter((issue) => issue.kind !== 'price-changed'));
	let priceChanges = $derived(app.cartIssues.filter((issue) => issue.kind === 'price-changed'));

	function applyCoupon(code: string) {
		couponError = null;
		const result = app.applyCoupon(code);
		if (result.ok) {
			couponInput = '';
			offersOpen = false;
			app.toast(`${code.trim().toUpperCase()} applied.`, 'success');
		} else {
			couponError = result.error;
		}
	}

	function openInstructions(lineId: string, current: string) {
		editingInstructions = lineId;
		instructionsDraft = current;
	}

	function saveInstructions() {
		if (!editingInstructions) return;
		app.setLineInstructions(editingInstructions, instructionsDraft.trim());
		editingInstructions = null;
	}

	/** Remove every line that can no longer be ordered. */
	function dropBlockingLines() {
		for (const issue of blocking) app.removeLine(issue.line.id);
		app.toast('Removed the items that are no longer available.', 'warning');
	}

	/** Accept the new menu prices for lines whose dish got repriced. */
	function acceptNewPrices() {
		for (const issue of priceChanges) {
			if (issue.kind !== 'price-changed') continue;
			const line = app.lineFor(issue.line.id);
			if (line) line.basePricePaise = issue.toPaise;
		}
		app.persist();
		app.toast('Cart updated to the latest menu prices.', 'info');
	}
</script>

<svelte:head>
	<title>Your cart · FoodRush</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-5">
	<h1 class="text-2xl font-extrabold">Your cart</h1>

	{#if lines.length === 0}
		<EmptyState
			icon="bag"
			title="Your cart is empty"
			message="Nothing in here yet. Pick a kitchen and let us fix that - most orders arrive in under half an hour."
		>
			{#snippet action()}
				<a href={href('/restaurants')} class="fr-btn-primary">Browse restaurants</a>
			{/snippet}
		</EmptyState>
	{:else}
		<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-sm">
			{app.cartCount}
			{app.cartCount === 1 ? 'item' : 'items'} from
			{#if restaurant}
				<a href={href(`/restaurant?id=${restaurant.id}`)} class="text-saffron-700 dark:text-saffron-300 font-bold">
					{restaurant.name}
				</a>
			{/if}
		</p>

		<!-- Cart problems ------------------------------------------------ -->
		{#if blocking.length > 0}
			<div class="fr-card border-danger/50 bg-danger/5 mt-4 p-4" role="alert">
				<p class="text-danger dark:text-danger-bright text-sm font-extrabold">
					{blocking.length === 1 ? 'One item is' : `${blocking.length} items are`} no longer available
				</p>
				<ul class="text-cocoa-700 dark:text-cocoa-200 mt-1.5 list-inside list-disc text-sm">
					{#each blocking as issue (issue.line.id)}
						<li>
							{issue.line.name}
							{issue.kind === 'unavailable' ? '— out of stock right now' : '— removed from the menu'}
						</li>
					{/each}
				</ul>
				<button type="button" class="fr-btn-danger mt-3" onclick={dropBlockingLines}>
					Remove {blocking.length === 1 ? 'it' : 'them'} and continue
				</button>
			</div>
		{/if}

		{#if priceChanges.length > 0}
			<div class="fr-card border-warn/50 bg-warn/5 mt-4 p-4" role="status">
				<p class="text-warn dark:text-warn-bright text-sm font-extrabold">Some prices changed</p>
				<ul class="text-cocoa-700 dark:text-cocoa-200 mt-1.5 text-sm">
					{#each priceChanges as issue (issue.line.id)}
						{#if issue.kind === 'price-changed'}
							<li>
								{issue.line.name}:
								<s class="text-cocoa-500">{formatPaise(issue.fromPaise)}</s>
								→ <span class="font-bold">{formatPaise(issue.toPaise)}</span>
							</li>
						{/if}
					{/each}
				</ul>
				<button type="button" class="fr-btn-secondary mt-3" onclick={acceptNewPrices}>
					Update to new prices
				</button>
			</div>
		{/if}

		<div class="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
			<!-- Items ------------------------------------------------------ -->
			<section aria-labelledby="items-heading">
				<h2 id="items-heading" class="sr-only">Items in your cart</h2>
				<ul class="fr-card divide-cocoa-200 dark:divide-cocoa-800 divide-y">
					{#each lines as line (line.id)}
						{@const unavailable = !app.isAvailable(line.dishId)}
						<li class="p-4" class:fr-dimmed={unavailable}>
							<div class="flex gap-3">
								<FoodImage art={line.art} alt={line.name} class="w-16 shrink-0 rounded-lg" />

								<div class="min-w-0 flex-1">
									<div class="flex items-start gap-2">
										<VegBadge veg={line.veg} />
										<h3 class="min-w-0 flex-1 text-sm font-extrabold">{line.name}</h3>
										<span class="shrink-0 text-sm font-extrabold tabular-nums">
											{formatPaise(
												(line.basePricePaise +
													line.options.reduce((sum, option) => sum + option.deltaPaise, 0)) *
													line.quantity
											)}
										</span>
									</div>

									{#if line.options.length > 0}
										<ul class="text-cocoa-600 dark:text-cocoa-200 mt-1 space-y-0.5 text-xs">
											{#each groupedOptions(line) as group (group.name)}
												<li>
													<span class="font-semibold">{group.name}:</span>
													{group.values.join(', ')}
												</li>
											{/each}
										</ul>
									{/if}

									{#if line.instructions}
										<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-xs italic">
											“{line.instructions}”
										</p>
									{/if}

									{#if unavailable}
										<p class="text-danger dark:text-danger-bright mt-1 text-xs font-bold">
											Out of stock — remove to continue
										</p>
									{/if}

									<div class="mt-2.5 flex flex-wrap items-center gap-2">
										<Stepper
											quantity={line.quantity}
											label={line.name}
											size="sm"
											onIncrement={() => app.incrementLine(line.id)}
											onDecrement={() => app.decrementLine(line.id)}
										/>
										<button
											type="button"
											class="fr-btn-ghost min-h-9 px-2.5 text-xs"
											onclick={() => openInstructions(line.id, line.instructions)}
										>
											{line.instructions ? 'Edit note' : 'Add note'}
										</button>
										<button
											type="button"
											class="text-cocoa-500 hover:text-danger dark:text-cocoa-300 min-h-9 cursor-pointer px-2 text-xs font-bold"
											onclick={() => app.removeLine(line.id)}
											aria-label="Remove {line.name} from cart"
										>
											Remove
										</button>
									</div>
								</div>
							</div>
						</li>
					{/each}
				</ul>

				{#if restaurant}
					<a
						href={href(`/restaurant?id=${restaurant.id}`)}
						class="text-saffron-700 dark:text-saffron-300 mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold"
					>
						+ Add more items from {restaurant.name}
					</a>
				{/if}
			</section>

			<!-- Coupons, tip, bill ----------------------------------------- -->
			<div class="space-y-4">
				<!-- coupon box -->
				<section class="fr-card p-4" aria-labelledby="coupon-heading">
					<h2 id="coupon-heading" class="text-sm font-extrabold tracking-wide uppercase">
						Coupons & offers
					</h2>

					{#if price.appliedCode}
						<div
							class="border-success/40 bg-success/10 mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5"
						>
							<div class="min-w-0">
								<p class="text-success dark:text-success-bright text-sm font-extrabold">
									{price.appliedCode} applied
								</p>
								<p class="text-cocoa-600 dark:text-cocoa-200 text-xs">
									{price.deliveryFeeWaived
										? 'Delivery fee waived'
										: `You saved ${formatPaise(price.discountPaise)}`}
								</p>
							</div>
							<button
								type="button"
								class="fr-btn-ghost min-h-9 shrink-0 px-3 text-xs"
								onclick={() => app.removeCoupon()}
								aria-label="Remove coupon {price.appliedCode}"
							>
								Remove
							</button>
						</div>
					{:else}
						<div class="mt-3 flex gap-2">
							<label class="sr-only" for="coupon-code">Coupon code</label>
							<input
								id="coupon-code"
								class="fr-input font-mono uppercase"
								placeholder="WELCOME50"
								bind:value={couponInput}
								onkeydown={(event) => {
									if (event.key === 'Enter') applyCoupon(couponInput);
								}}
							/>
							<button type="button" class="fr-btn-secondary shrink-0" onclick={() => applyCoupon(couponInput)}>
								Apply
							</button>
						</div>
						{#if couponError}
							<p class="fr-error" role="alert">{couponError}</p>
						{/if}
					{/if}

					<button
						type="button"
						class="text-saffron-700 dark:text-saffron-300 mt-2.5 min-h-9 cursor-pointer text-xs font-bold underline"
						onclick={() => (offersOpen = true)}
					>
						See all {app.couponOffers.length} offers
					</button>
				</section>

				<!-- tip -->
				<section class="fr-card p-4" aria-labelledby="tip-heading">
					<h2 id="tip-heading" class="text-sm font-extrabold tracking-wide uppercase">
						Tip your delivery partner
					</h2>
					<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-xs">
						100% of the tip goes to the rider. Rain, traffic, four flights of stairs - it adds up.
					</p>
					<div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Tip amount">
						{#each TIP_PRESETS_PAISE as tip (tip)}
							<button
								type="button"
								class="fr-chip"
								class:fr-chip-active={app.cart.tipPaise === tip}
								aria-pressed={app.cart.tipPaise === tip}
								onclick={() => app.setTip(tip)}
							>
								{tip === 0 ? 'No tip' : formatPaise(tip)}
							</button>
						{/each}
					</div>
				</section>

				<BillDetails
					{price}
					baseDeliveryFeePaise={app.baseDeliveryFee}
					couponCode={price.appliedCode}
				/>

				<a
					href={href('/checkout')}
					class="fr-btn-primary w-full {blocking.length > 0 ? 'pointer-events-none opacity-55' : ''}"
					aria-disabled={blocking.length > 0}
					tabindex={blocking.length > 0 ? -1 : 0}
				>
					Proceed to checkout · {formatPaise(price.totalPaise)}
				</a>

				{#if blocking.length > 0}
					<p class="text-danger dark:text-danger-bright text-center text-xs font-bold">
						Remove the unavailable items to continue.
					</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Offers sheet: the whole wallet, with honest reasons for the ones that do not apply. -->
<Dialog
	open={offersOpen}
	title="Offers for this order"
	description="One coupon per order - we apply the one you pick."
	onClose={() => (offersOpen = false)}
>
	<ul class="space-y-2.5">
		{#each app.couponOffers as offer (offer.coupon.code)}
			<li
				class="rounded-2xl border p-3.5 {offer.evaluation.ok
					? 'border-saffron-500/50 bg-saffron-500/5'
					: 'border-cocoa-200 dark:border-cocoa-800 opacity-75'}"
			>
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<p class="font-mono text-sm font-extrabold">{offer.coupon.code}</p>
						<p class="mt-0.5 text-sm font-bold">{offer.coupon.title}</p>
						<p class="text-cocoa-600 dark:text-cocoa-200 mt-0.5 text-xs">{offer.coupon.description}</p>
						{#if !offer.evaluation.ok}
							<p class="text-warn dark:text-warn-bright mt-1.5 text-xs font-bold">
								{offer.evaluation.reason}
							</p>
						{/if}
					</div>
					{#if offer.evaluation.ok}
						<div class="shrink-0 text-right">
							{#if offer.savingsPaise > 0}
								<p class="text-success dark:text-success-bright text-xs font-extrabold">
									Save {formatPaise(offer.savingsPaise)}
								</p>
							{/if}
							<button
								type="button"
								class="fr-btn-secondary mt-1.5 min-h-9 px-3 text-xs"
								onclick={() => applyCoupon(offer.coupon.code)}
							>
								Apply
							</button>
						</div>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
</Dialog>

<!-- Per-item special instructions -->
<Dialog
	open={Boolean(editingInstructions)}
	title="Note for the restaurant"
	variant="centred"
	onClose={() => (editingInstructions = null)}
>
	<label class="fr-label" for="line-instructions">Special instructions</label>
	<textarea
		id="line-instructions"
		class="fr-input min-h-24 py-2"
		maxlength="180"
		placeholder="No onion, less spicy, cut into halves…"
		bind:value={instructionsDraft}
		data-autofocus
	></textarea>
	<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-xs">
		{instructionsDraft.length}/180 · the kitchen will try its best.
	</p>
	{#snippet footer()}
		<div class="flex gap-3">
			<button type="button" class="fr-btn-secondary flex-1" onclick={() => (editingInstructions = null)}>
				Cancel
			</button>
			<button type="button" class="fr-btn-primary flex-1" onclick={saveInstructions}>Save note</button>
		</div>
	{/snippet}
</Dialog>
