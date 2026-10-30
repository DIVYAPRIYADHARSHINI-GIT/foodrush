<script lang="ts">
	/**
	 * Restaurant owner demo view.
	 *
	 * Incoming orders can be accepted, marked preparing and marked ready, and dishes can be
	 * toggled out of stock. Both write to the SAME store the customer app reads, so marking
	 * a dish unavailable updates the customer menu instantly - and removes it from the live
	 * cart with a message, rather than letting someone check out a dish the kitchen just ran
	 * out of.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import { formatPaise } from '#lib/logic/money';
	import { STATUS_COPY, formatWhen, orderReference, statusAt } from '#lib/logic/orders';
	import type { OrderStatus } from '#lib/types';
	import VegBadge from '#lib/components/VegBadge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';

	let selectedId = $state<string | null>(null);
	let menuQuery = $state('');

	// Default to whichever restaurant the user last ordered from, else the first one.
	$effect(() => {
		if (selectedId || app.catalogStatus !== 'ready') return;
		selectedId = app.orders[0]?.restaurantId ?? app.restaurants[0]?.id ?? null;
	});

	let restaurant = $derived(app.restaurant(selectedId));
	let orders = $derived(selectedId ? app.ordersForRestaurant(selectedId) : []);
	let dishes = $derived(
		selectedId
			? app
					.menuFor(selectedId)
					.filter((dish) => dish.name.toLowerCase().includes(menuQuery.trim().toLowerCase()))
			: []
	);

	let outOfStockCount = $derived(dishes.filter((dish) => !dish.available).length);

	/** The next action the owner can take on an order, if any. */
	function nextAction(status: OrderStatus): { status: OrderStatus; label: string } | null {
		if (status === 'placed') return { status: 'confirmed', label: 'Accept order' };
		if (status === 'confirmed') return { status: 'preparing', label: 'Mark preparing' };
		if (status === 'preparing') return { status: 'out-for-delivery', label: 'Mark ready for pickup' };
		if (status === 'out-for-delivery') return { status: 'delivered', label: 'Mark delivered' };
		return null;
	}
</script>

<svelte:head>
	<title>Restaurant view · FoodRush</title>
</svelte:head>

<div class="mx-auto w-full max-w-4xl px-4 py-5">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl font-extrabold">Restaurant view</h1>
			<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-sm">
				A simplified owner console. Everything here writes to the same data the customer app
				reads.
			</p>
		</div>
		<a href={href('/')} class="fr-btn-ghost shrink-0">Back to customer app</a>
	</div>

	{#if app.catalogStatus !== 'ready'}
		<p class="text-cocoa-600 dark:text-cocoa-200 mt-5 text-sm">Loading kitchens…</p>
	{:else}
		<div class="mt-4">
			<label class="fr-label" for="owner-restaurant">Signed in as</label>
			<select id="owner-restaurant" class="fr-input" bind:value={selectedId}>
				{#each app.restaurants as entry (entry.id)}
					<option value={entry.id}>{entry.name} — {entry.area}</option>
				{/each}
			</select>
		</div>

		<!-- INCOMING ORDERS ------------------------------------------------ -->
		<section class="mt-6" aria-labelledby="incoming-heading">
			<h2 id="incoming-heading" class="text-lg font-extrabold">
				Orders ({orders.length})
			</h2>

			{#if orders.length === 0}
				<div class="fr-card mt-3 p-5">
					<p class="text-cocoa-600 dark:text-cocoa-200 text-sm">
						No orders for {restaurant?.name} yet. Place one from the customer app and it appears here
						immediately.
					</p>
					<a href={href(`/restaurant?id=${selectedId}`)} class="fr-btn-secondary mt-3">
						Open this menu as a customer
					</a>
				</div>
			{:else}
				<ul class="mt-3 space-y-3">
					{#each orders as order (order.id)}
						{@const status = statusAt(order, app.clock)}
						{@const action = nextAction(status)}
						<li class="fr-card p-4">
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="text-sm font-extrabold">
										{orderReference(order.id)} · {formatPaise(order.price.totalPaise)}
									</p>
									<p class="text-cocoa-500 dark:text-cocoa-300 text-xs font-semibold">
										{formatWhen(order.placedAt, app.clock)} · {order.address.area} ·
										{order.payment === 'cod' ? 'CASH ON DELIVERY' : order.payment.toUpperCase()}
									</p>
									{#if order.scheduledFor}
										<p class="text-saffron-700 dark:text-saffron-300 text-xs font-bold">
											Scheduled for {order.scheduledFor}
										</p>
									{/if}
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

							<ul class="text-cocoa-700 dark:text-cocoa-200 mt-3 space-y-1 text-sm">
								{#each order.lines as line (line.id)}
									<li class="flex items-start gap-2">
										<VegBadge veg={line.veg} size={13} />
										<span class="min-w-0">
											<span class="font-semibold">{line.quantity} × {line.name}</span>
											{#if line.options.length > 0}
												<span class="text-cocoa-500 dark:text-cocoa-300 block text-xs">
													{line.options.map((option) => option.choiceName).join(', ')}
												</span>
											{/if}
											{#if line.instructions}
												<span class="text-warn dark:text-warn-bright block text-xs font-bold">
													Note: {line.instructions}
												</span>
											{/if}
										</span>
									</li>
								{/each}
							</ul>

							{#if action}
								<button
									type="button"
									class="fr-btn-primary mt-3 min-h-10 px-4 text-xs"
									onclick={() => {
										app.advanceOrder(order.id, action.status);
										app.toast(`${orderReference(order.id)}: ${action.label.toLowerCase()}.`, 'success');
									}}
								>
									{action.label}
								</button>
							{:else}
								<p class="text-cocoa-500 dark:text-cocoa-300 mt-3 text-xs font-semibold">
									{status === 'cancelled'
										? `Cancelled by the customer${order.cancelledReason ? `: ${order.cancelledReason}` : ''}`
										: 'This order is complete.'}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- MENU AVAILABILITY ---------------------------------------------- -->
		<section class="mt-8" aria-labelledby="availability-heading">
			<h2 id="availability-heading" class="text-lg font-extrabold">Menu availability</h2>
			<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-sm">
				Switch a dish off and it is instantly marked out of stock for customers - including
				anyone who already has it in their cart.
				{#if outOfStockCount > 0}
					<span class="text-danger dark:text-danger-bright font-bold">
						{outOfStockCount} dish{outOfStockCount === 1 ? '' : 'es'} currently off.
					</span>
				{/if}
			</p>

			<div class="mt-3">
				<label class="sr-only" for="owner-menu-search">Search this menu</label>
				<input
					id="owner-menu-search"
					class="fr-input"
					type="search"
					placeholder="Find a dish…"
					bind:value={menuQuery}
				/>
			</div>

			{#if dishes.length === 0}
				<EmptyState
					icon="search"
					title="No dishes match"
					message="Nothing on this menu matches that search."
				/>
			{:else}
				<ul class="fr-card divide-cocoa-200 dark:divide-cocoa-800 mt-3 divide-y">
					{#each dishes as dish (dish.id)}
						<li class="flex items-center justify-between gap-3 p-3.5">
							<div class="min-w-0">
								<p class="flex items-center gap-2 text-sm font-bold">
									<VegBadge veg={dish.veg} size={14} />
									<span class="truncate">{dish.name}</span>
								</p>
								<p class="text-cocoa-500 dark:text-cocoa-300 text-xs font-semibold">
									{dish.category} · {formatPaise(dish.pricePaise)}
								</p>
							</div>

							<label class="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-bold">
								<span class={dish.available ? 'text-success dark:text-success-bright' : 'text-danger dark:text-danger-bright'}>
									{dish.available ? 'In stock' : 'Out of stock'}
								</span>
								<input
									type="checkbox"
									class="accent-saffron-500 h-5 w-5"
									checked={dish.available}
									onchange={(event) =>
										app.setDishAvailability(dish.id, event.currentTarget.checked)}
									aria-label="{dish.name} availability"
								/>
							</label>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
