<script lang="ts">
	/**
	 * Order tracking: live status timeline, ETA countdown, illustrated route with a moving
	 * rider, the delivery-partner card, cancellation, the receipt and the rating prompt.
	 *
	 * The status is DERIVED from elapsed time (see logic/orders.ts), so refreshing this
	 * page resumes the order exactly where it was. The only timer here is the store's
	 * shared 1-second clock, which the layout stops on unmount - there is no per-page
	 * interval to leak.
	 */
	import { page } from '$app/state';
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import { formatPaise } from '#lib/logic/money';
	import {
		STATUS_COPY,
		canCancel,
		cancelBlockedReason,
		etaSecondsLeft,
		formatCountdown,
		formatWhen,
		orderReference,
		progressAt,
		statusAt,
		timelineFor
	} from '#lib/logic/orders';
	import BillDetails from '#lib/components/BillDetails.svelte';
	import TrackingMap from '#lib/components/TrackingMap.svelte';
	import RatingDialog from '#lib/components/RatingDialog.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import VegBadge from '#lib/components/VegBadge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';

	let orderId = $derived(page.url.searchParams.get('id'));
	let order = $derived(app.order(orderId));

	let status = $derived(order ? statusAt(order, app.clock) : null);
	let progress = $derived(order ? progressAt(order, app.clock) : 0);
	let secondsLeft = $derived(order ? etaSecondsLeft(order, app.clock) : 0);
	let steps = $derived(order ? timelineFor(order, app.clock) : []);
	let cancellable = $derived(order ? canCancel(order, app.clock) : false);

	let cancelling = $state(false);
	let cancelReason = $state('');
	let rating = $state(false);
	let ratingPrompted = $state(false);

	/**
	 * Write the clock-derived status back into the record so history and the owner view
	 * agree with what tracking shows. Runs off the shared clock, not its own timer.
	 */
	$effect(() => {
		if (!order || !orderId) return;
		void app.clock;
		app.syncOrderStatus(orderId);
	});

	// Offer the rating prompt once, as soon as the order lands.
	$effect(() => {
		if (!order || status !== 'delivered' || ratingPrompted) return;
		if (app.ratedOrders.includes(order.id)) return;
		ratingPrompted = true;
		rating = true;
	});

	const CANCEL_REASONS = [
		'Ordered by mistake',
		'Taking too long',
		'Changed my mind',
		'Wrong address or items',
		'Found a better offer'
	];

	let existingReview = $derived(order ? app.reviewForOrder(order.id) : null);
</script>

<svelte:head>
	<title>{order ? `Order ${orderReference(order.id)} · FoodRush` : 'Order · FoodRush'}</title>
</svelte:head>

{#if !app.hydrated}
	<h1 class="sr-only">Loading order</h1>
	<div class="mx-auto w-full max-w-3xl px-4 py-6" aria-hidden="true">
		<div class="fr-skeleton h-8 w-2/3"></div>
		<div class="fr-skeleton mt-4 h-48 rounded-card"></div>
		<div class="fr-skeleton mt-4 h-64 rounded-card"></div>
	</div>
{:else if !order}
	<h1 class="sr-only">Order not found</h1>
	<EmptyState
		icon="bag"
		title="We cannot find that order"
		message="The link may be from a different browser or the data may have been cleared. Your past orders are listed under Orders."
	>
		{#snippet action()}
			<a href={href('/orders')} class="fr-btn-primary">See my orders</a>
		{/snippet}
	</EmptyState>
{:else if status}
	<div class="mx-auto w-full max-w-3xl px-4 py-5">
		<!-- headline ------------------------------------------------------ -->
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h1 class="text-2xl font-extrabold">{STATUS_COPY[status].title}</h1>
				<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-sm">
					{STATUS_COPY[status].detail}
				</p>
				<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-xs font-semibold">
					{orderReference(order.id)} · {order.restaurantName} · placed {formatWhen(order.placedAt, app.clock)}
				</p>
			</div>

			{#if status !== 'delivered' && status !== 'cancelled'}
				<div class="fr-sunk px-4 py-2.5 text-center">
					<p class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
						{order.scheduledFor ? 'Scheduled' : 'Arriving in'}
					</p>
					<p class="text-xl font-extrabold tabular-nums" aria-live="polite">
						{order.scheduledFor ? order.scheduledFor : formatCountdown(secondsLeft)}
					</p>
				</div>
			{/if}
		</div>

		{#if status === 'cancelled'}
			<div class="fr-card border-danger/50 bg-danger/5 mt-4 p-4" role="status">
				<p class="text-danger dark:text-danger-bright text-sm font-extrabold">This order was cancelled</p>
				{#if order.cancelledReason}
					<p class="text-cocoa-700 dark:text-cocoa-200 mt-1 text-sm">Reason: {order.cancelledReason}</p>
				{/if}
				<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-xs">
					Any amount paid is refunded to the original method within 3-5 working days. (Demo: no real
					money moved.)
				</p>
			</div>
		{:else}
			<!-- map + rider ------------------------------------------------- -->
			<div class="mt-4">
				<TrackingMap
					{progress}
					restaurantName={order.restaurantName}
					addressLabel="{order.address.label} · {order.address.area}"
					riderName={order.partner.name}
					riderActive={status === 'out-for-delivery' || status === 'delivered'}
				/>
			</div>

			<!-- delivery partner -->
			<section class="fr-card mt-4 flex items-center gap-3 p-4" aria-labelledby="partner-heading">
				<span
					class="bg-saffron-500/15 text-saffron-700 dark:text-saffron-200 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-extrabold"
					aria-hidden="true"
				>
					{order.partner.name.charAt(0)}
				</span>
				<div class="min-w-0 flex-1">
					<h2 id="partner-heading" class="text-sm font-extrabold">{order.partner.name}</h2>
					<p class="text-cocoa-600 dark:text-cocoa-200 text-xs">
						{order.partner.rating} ★ · {order.partner.vehicle}
					</p>
					<p class="text-cocoa-500 dark:text-cocoa-300 text-xs">
						{status === 'out-for-delivery'
							? 'On the way to you now'
							: status === 'delivered'
								? 'Delivered your order'
								: 'Will pick up your order shortly'}
					</p>
				</div>
				<a
					href="tel:{order.partner.phone.replace(/\s/g, '')}"
					class="fr-btn-secondary shrink-0"
					aria-label="Call {order.partner.name}"
				>
					<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
						<path
							d="M3.7 1.2a1.3 1.3 0 0 1 1.8.3l1.2 1.7a1.3 1.3 0 0 1-.2 1.7l-.7.6a8 8 0 0 0 3.7 3.7l.6-.7a1.3 1.3 0 0 1 1.7-.2l1.7 1.2a1.3 1.3 0 0 1 .3 1.8l-.8 1.1a2 2 0 0 1-2.3.7C7.4 12.4 3.6 8.6 2 4.3a2 2 0 0 1 .7-2.3Z"
						/>
					</svg>
					Call
				</a>
			</section>
		{/if}

		<!-- timeline -------------------------------------------------------- -->
		<section class="fr-card mt-4 p-4" aria-labelledby="timeline-heading">
			<h2 id="timeline-heading" class="text-sm font-extrabold tracking-wide uppercase">
				Order status
			</h2>
			<ol class="mt-3">
				{#each steps as step, index (step.status)}
					<li class="flex gap-3">
						<div class="flex flex-col items-center">
							<span
								class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 {step.done
									? step.status === 'cancelled'
										? 'border-danger bg-danger text-white'
										: 'border-success bg-success text-white'
									: 'border-cocoa-300 dark:border-cocoa-700'}"
								aria-hidden="true"
							>
								{#if step.done}
									<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
										{#if step.status === 'cancelled'}
											<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2.2" />
										{:else}
											<path d="M6.2 10.9 3.6 8.3l-1 1 3.6 3.6 7-7-1-1z" />
										{/if}
									</svg>
								{/if}
							</span>
							{#if index < steps.length - 1}
								<span
									class="w-0.5 flex-1 {step.done ? 'bg-success' : 'bg-cocoa-300 dark:bg-cocoa-700'}"
									style="min-height: 1.75rem"
									aria-hidden="true"
								></span>
							{/if}
						</div>
						<div class="pb-5">
							<p class="text-sm font-extrabold {step.done ? '' : 'text-cocoa-500 dark:text-cocoa-300'}">
								{STATUS_COPY[step.status].title}
							</p>
							<p class="text-cocoa-500 dark:text-cocoa-300 text-xs">
								{#if step.at}
									{formatWhen(step.at, app.clock)}
								{:else}
									Pending
								{/if}
							</p>
						</div>
					</li>
				{/each}
			</ol>

			{#if status !== 'delivered' && status !== 'cancelled'}
				{#if cancellable}
					<button
						type="button"
						class="fr-btn-danger w-full"
						onclick={() => (cancelling = true)}
					>
						Cancel order
					</button>
				{:else}
					<p class="fr-sunk text-cocoa-600 dark:text-cocoa-200 px-3 py-2.5 text-center text-xs font-semibold">
						{cancelBlockedReason(order, app.clock)}
					</p>
				{/if}
			{/if}
		</section>

		<!-- rating prompt / thanks ------------------------------------------ -->
		{#if status === 'delivered'}
			<section class="fr-card mt-4 p-4" aria-labelledby="rate-heading">
				<h2 id="rate-heading" class="text-sm font-extrabold tracking-wide uppercase">
					{existingReview ? 'Your rating' : 'Rate your order'}
				</h2>
				{#if existingReview}
					<p class="text-cocoa-600 dark:text-cocoa-200 mt-2 text-sm">
						You rated the food {existingReview.foodRating}/5 and the delivery
						{existingReview.deliveryRating}/5.
						{#if existingReview.text}
							<span class="mt-1 block italic">“{existingReview.text}”</span>
						{/if}
					</p>
					<button type="button" class="fr-btn-secondary mt-3" onclick={() => (rating = true)}>
						Edit my rating
					</button>
				{:else}
					<p class="text-cocoa-600 dark:text-cocoa-200 mt-2 text-sm">
						Tell the kitchen and the rider how they did. It takes ten seconds and it actually moves
						their rating.
					</p>
					<button type="button" class="fr-btn-primary mt-3" onclick={() => (rating = true)}>
						Rate this order
					</button>
				{/if}
			</section>
		{/if}

		<!-- receipt ---------------------------------------------------------- -->
		<section class="mt-4" aria-labelledby="receipt-heading">
			<h2 id="receipt-heading" class="sr-only">Order details and receipt</h2>
			<div class="fr-card p-4">
				<h3 class="text-sm font-extrabold tracking-wide uppercase">Items</h3>
				<ul class="mt-3 space-y-2 text-sm">
					{#each order.lines as line (line.id)}
						<li class="flex items-start justify-between gap-3">
							<span class="flex min-w-0 items-start gap-2">
								<VegBadge veg={line.veg} size={14} />
								<span class="min-w-0">
									<span class="block font-semibold">{line.name} × {line.quantity}</span>
									{#if line.options.length > 0}
										<span class="text-cocoa-500 dark:text-cocoa-300 block text-xs">
											{line.options.map((option) => option.choiceName).join(', ')}
										</span>
									{/if}
									{#if line.instructions}
										<span class="text-cocoa-500 dark:text-cocoa-300 block text-xs italic">
											“{line.instructions}”
										</span>
									{/if}
								</span>
							</span>
							<span class="shrink-0 font-semibold tabular-nums">
								{formatPaise(
									(line.basePricePaise + line.options.reduce((sum, option) => sum + option.deltaPaise, 0)) *
										line.quantity
								)}
							</span>
						</li>
					{/each}
				</ul>

				<div class="border-cocoa-200 dark:border-cocoa-800 mt-4 border-t pt-3 text-xs">
					<p class="font-bold">Delivered to</p>
					<p class="text-cocoa-600 dark:text-cocoa-200">
						{order.address.name} · {order.address.phone}
					</p>
					<p class="text-cocoa-600 dark:text-cocoa-200">
						{order.address.line1}{order.address.line2 ? `, ${order.address.line2}` : ''},
						{order.address.area}, {order.address.city}
						{order.address.pin}
					</p>
					{#if order.address.instructions}
						<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 italic">
							“{order.address.instructions}”
						</p>
					{/if}
					<p class="mt-2 font-bold">Payment</p>
					<p class="text-cocoa-600 dark:text-cocoa-200">
						{order.payment === 'cod'
							? 'Cash on delivery'
							: order.payment === 'upi'
								? 'UPI'
								: order.payment === 'card'
									? 'Card'
									: 'FoodRush wallet'} · simulated, no real payment taken
					</p>
				</div>
			</div>

			<div class="mt-4">
				<BillDetails price={order.price} couponCode={order.couponCode} heading="Receipt" />
			</div>
		</section>

		<div class="mt-5 flex flex-wrap gap-3">
			<a href={href('/orders')} class="fr-btn-secondary">All my orders</a>
			<a href={href(`/restaurant?id=${order.restaurantId}`)} class="fr-btn-ghost">
				Order from {order.restaurantName} again
			</a>
		</div>
	</div>

	<!-- cancel dialog -->
	<Dialog
		open={cancelling}
		title="Cancel this order?"
		description="Tell us why, so the restaurant knows."
		variant="centred"
		onClose={() => (cancelling = false)}
	>
		<div class="space-y-2" role="radiogroup" aria-label="Cancellation reason">
			{#each CANCEL_REASONS as reason (reason)}
				<label class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-2 text-sm">
					<input
						type="radio"
						name="cancel-reason"
						class="accent-saffron-500 h-4.5 w-4.5"
						checked={cancelReason === reason}
						onchange={() => (cancelReason = reason)}
					/>
					{reason}
				</label>
			{/each}
		</div>
		{#snippet footer()}
			<div class="flex gap-3">
				<button type="button" class="fr-btn-secondary flex-1" onclick={() => (cancelling = false)}>
					Keep my order
				</button>
				<button
					type="button"
					class="fr-btn-danger flex-1"
					disabled={!cancelReason}
					onclick={() => {
						if (!order) return;
						const done = app.cancelOrder(order.id, cancelReason);
						cancelling = false;
						app.toast(
							done
								? 'Order cancelled. Any payment will be refunded.'
								: 'Too late to cancel - the kitchen already started.',
							done ? 'info' : 'warning'
						);
					}}
				>
					Confirm cancellation
				</button>
			</div>
		{/snippet}
	</Dialog>

	<RatingDialog order={rating ? order : null} onClose={() => {
		rating = false;
		if (order && !app.reviewForOrder(order.id)) app.dismissRating(order.id);
	}} />
{/if}
