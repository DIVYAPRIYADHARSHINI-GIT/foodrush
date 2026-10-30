<script lang="ts">
	/**
	 * Checkout: address selection and management, delivery timing, payment method and the
	 * order review.
	 *
	 * DOUBLE SUBMISSION is guarded three ways: the button disables itself, a `placing` flag
	 * rejects re-entry, and `app.placeOrder()` clears the cart - so even a double-fired
	 * click event cannot produce two orders.
	 *
	 * Payment is SIMULATED and labelled as such on screen; no card data is stored or sent
	 * anywhere, and the card fields only exist to exercise the validation.
	 */
	import { goto } from '$app/navigation';
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import { formatPaise } from '#lib/logic/money';
	import { deliveryFeeFor } from '#lib/logic/pricing';
	import { isValidPhone, scheduleSlots } from '#lib/logic/orders';
	import type { Address, PaymentMethod } from '#lib/types';
	import BillDetails from '#lib/components/BillDetails.svelte';
	import AddressForm from '#lib/components/AddressForm.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import VegBadge from '#lib/components/VegBadge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';

	let selectedAddressId = $state<string | null>(null);
	let addingAddress = $state(false);
	let editingAddress = $state<Address | null>(null);
	let deletingAddress = $state<Address | null>(null);

	let timing = $state<'now' | 'later'>('now');
	let slot = $state<string | null>(null);
	let payment = $state<PaymentMethod>('upi');
	let riderNote = $state('');
	let placing = $state(false);
	let attempted = $state(false);

	// Payment-form fields. Simulated: validated, never stored, never transmitted.
	let upiId = $state('');
	let cardNumber = $state('');
	let cardExpiry = $state('');
	let cardCvv = $state('');
	let cardName = $state('');

	let lines = $derived(app.cart.lines);
	let restaurant = $derived(app.cartRestaurant);
	let slots = $derived(scheduleSlots(app.clock));

	// Default to the user's default address once addresses exist.
	$effect(() => {
		if (!selectedAddressId && app.defaultAddress) selectedAddressId = app.defaultAddress.id;
		// If the selected address was deleted, fall back rather than breaking checkout.
		if (selectedAddressId && !app.addresses.some((entry) => entry.id === selectedAddressId)) {
			selectedAddressId = app.defaultAddress?.id ?? null;
		}
	});

	let address = $derived(app.addresses.find((entry) => entry.id === selectedAddressId) ?? null);

	/**
	 * The delivery fee follows the chosen address: a far-away address costs more. Pricing
	 * is recomputed with that distance so the review, the bill and the receipt agree.
	 */
	let distanceKm = $derived.by(() => {
		if (!restaurant) return 0;
		if (!address) return restaurant.distanceKm;
		// Same area as the restaurant keeps the base distance; a different area adds a bit.
		return address.area.trim().toLowerCase() === restaurant.area.toLowerCase()
			? restaurant.distanceKm
			: Math.round((restaurant.distanceKm + 2.4) * 10) / 10;
	});

	let price = $derived.by(() => {
		// Reuse the ONE pricing function, with the address-derived distance.
		const base = app.price;
		if (!restaurant || distanceKm === base.distanceKm) return base;
		return {
			...base,
			...(() => {
				// Recompute via the store's own inputs so coupon/tax rules stay identical.
				const fee = base.deliveryFeeWaived ? 0 : deliveryFeeFor(distanceKm);
				const taxOnFood = base.taxPaise - Math.round((base.deliveryFeePaise * 18) / 100);
				const tax = taxOnFood + Math.round((fee * 18) / 100);
				return {
					deliveryFeePaise: fee,
					taxPaise: tax,
					distanceKm,
					totalPaise: Math.max(
						0,
						base.itemTotalPaise +
							base.packagingPaise +
							fee +
							tax -
							base.discountPaise +
							base.tipPaise
					)
				};
			})()
		};
	});

	let paymentErrors = $derived.by(() => {
		const errors: Record<string, string> = {};
		if (payment === 'upi') {
			if (!upiId.trim()) errors.upi = 'Enter your UPI ID.';
			else if (!/^[\w.-]{2,}@[a-z]{2,}$/i.test(upiId.trim())) errors.upi = 'That does not look like a UPI ID (name@bank).';
		}
		if (payment === 'card') {
			const digits = cardNumber.replace(/\s/g, '');
			if (!digits) errors.cardNumber = 'Enter a card number.';
			else if (!/^\d{16}$/.test(digits)) errors.cardNumber = 'A card number is 16 digits.';
			if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(cardExpiry.trim())) errors.cardExpiry = 'Use MM/YY.';
			if (!/^\d{3}$/.test(cardCvv.trim())) errors.cardCvv = 'CVV is 3 digits.';
			if (!cardName.trim()) errors.cardName = 'Enter the name on the card.';
		}
		return errors;
	});

	let blocking = $derived(app.cartIssues.filter((issue) => issue.kind !== 'price-changed'));

	let readyToPlace = $derived(
		lines.length > 0 &&
			Boolean(address) &&
			blocking.length === 0 &&
			Object.keys(paymentErrors).length === 0 &&
			(timing === 'now' || Boolean(slot)) &&
			!placing
	);

	async function placeOrder() {
		// Guard 1: re-entry flag. Guard 2: the disabled button. Guard 3: placeOrder() empties
		// the cart, so a second call finds nothing to order.
		if (placing) return;
		attempted = true;
		if (!readyToPlace || !address) return;
		placing = true;

		const order = app.placeOrder({
			address,
			payment,
			scheduledFor: timing === 'later' ? (slots.find((entry) => entry.id === slot)?.label ?? null) : null,
			instructions: riderNote.trim()
		});

		if (!order) {
			placing = false;
			app.toast('We could not place that order. Check your cart and try again.', 'warning');
			return;
		}
		await goto(href(`/order?id=${order.id}`));
	}
</script>

<svelte:head>
	<title>Checkout · FoodRush</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-5">
	{#if lines.length === 0}
		<!-- Every page needs exactly one h1, including this empty variant. -->
		<h1 class="sr-only">Checkout</h1>
		<EmptyState
			icon="bag"
			title="Nothing to check out"
			message="Your cart is empty - probably because the order went through. Check your orders, or start a new one."
		>
			{#snippet action()}
				<div class="flex flex-wrap justify-center gap-3">
					<a href={href('/restaurants')} class="fr-btn-primary">Browse restaurants</a>
					<a href={href('/orders')} class="fr-btn-secondary">My orders</a>
				</div>
			{/snippet}
		</EmptyState>
	{:else}
		<h1 class="text-2xl font-extrabold">Checkout</h1>
		<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-sm">
			{app.cartCount} item{app.cartCount === 1 ? '' : 's'} from {restaurant?.name}
		</p>

		<div class="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
			<div class="space-y-4">
				<!-- ADDRESS -------------------------------------------------- -->
				<section class="fr-card p-4" aria-labelledby="address-heading">
					<div class="flex items-center justify-between gap-3">
						<h2 id="address-heading" class="text-sm font-extrabold tracking-wide uppercase">
							Delivery address
						</h2>
						<button type="button" class="fr-btn-ghost min-h-9 px-3 text-xs" onclick={() => (addingAddress = true)}>
							+ Add new
						</button>
					</div>

					{#if app.addresses.length === 0}
						<p class="text-cocoa-600 dark:text-cocoa-200 mt-3 text-sm">
							No saved addresses yet. Add one so the rider knows where to go.
						</p>
						<button type="button" class="fr-btn-primary mt-3" onclick={() => (addingAddress = true)}>
							Add delivery address
						</button>
						{#if attempted}
							<p class="fr-error" role="alert">A delivery address is required.</p>
						{/if}
					{:else}
						<ul class="mt-3 space-y-2" role="radiogroup" aria-labelledby="address-heading">
							{#each app.addresses as entry (entry.id)}
								{@const selected = selectedAddressId === entry.id}
								<li
									class="rounded-2xl border p-3 {selected
										? 'border-saffron-500 bg-saffron-500/5'
										: 'border-cocoa-200 dark:border-cocoa-800'}"
								>
									<div class="flex items-start gap-3">
										<input
											type="radio"
											name="address"
											class="accent-saffron-500 mt-1 h-4.5 w-4.5"
											checked={selected}
											onchange={() => (selectedAddressId = entry.id)}
											aria-label="Deliver to {entry.label} address, {entry.line1}"
										/>
										<div class="min-w-0 flex-1 text-sm">
											<p class="flex flex-wrap items-center gap-2 font-extrabold">
												{entry.label}
												{#if entry.isDefault}
													<span
														class="bg-saffron-500/15 text-saffron-700 dark:text-saffron-200 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase"
													>
														Default
													</span>
												{/if}
											</p>
											<p class="text-cocoa-600 dark:text-cocoa-200 mt-0.5">
												{entry.name} · {entry.phone}
											</p>
											<p class="text-cocoa-600 dark:text-cocoa-200">
												{entry.line1}{entry.line2 ? `, ${entry.line2}` : ''}, {entry.area}, {entry.city}
												{entry.pin}
											</p>
											{#if entry.landmark}
												<p class="text-cocoa-500 dark:text-cocoa-300 text-xs">Near {entry.landmark}</p>
											{/if}
											<div class="mt-1.5 flex flex-wrap gap-1">
												<button
													type="button"
													class="text-saffron-700 dark:text-saffron-300 min-h-9 cursor-pointer px-1.5 text-xs font-bold"
													onclick={() => (editingAddress = entry)}
												>
													Edit
												</button>
												{#if !entry.isDefault}
													<button
														type="button"
														class="text-cocoa-600 dark:text-cocoa-200 min-h-9 cursor-pointer px-1.5 text-xs font-bold"
														onclick={() => app.setDefaultAddress(entry.id)}
													>
														Set default
													</button>
												{/if}
												<button
													type="button"
													class="text-danger dark:text-danger-bright min-h-9 cursor-pointer px-1.5 text-xs font-bold"
													onclick={() => (deletingAddress = entry)}
												>
													Delete
												</button>
											</div>
										</div>
									</div>
								</li>
							{/each}
						</ul>
					{/if}

					<div class="mt-4">
						<label class="fr-label" for="rider-note">
							Delivery instructions <span class="text-cocoa-500 font-normal">(optional)</span>
						</label>
						<input
							id="rider-note"
							class="fr-input"
							placeholder="Leave at the door, do not ring the bell"
							bind:value={riderNote}
						/>
					</div>
				</section>

				<!-- TIMING --------------------------------------------------- -->
				<section class="fr-card p-4" aria-labelledby="timing-heading">
					<h2 id="timing-heading" class="text-sm font-extrabold tracking-wide uppercase">
						When should it arrive?
					</h2>
					<div class="mt-3 flex gap-2" role="group" aria-labelledby="timing-heading">
						<button
							type="button"
							class="fr-chip"
							class:fr-chip-active={timing === 'now'}
							aria-pressed={timing === 'now'}
							onclick={() => {
								timing = 'now';
								slot = null;
							}}
						>
							Deliver now · {restaurant?.deliveryMinutes} min
						</button>
						<button
							type="button"
							class="fr-chip"
							class:fr-chip-active={timing === 'later'}
							aria-pressed={timing === 'later'}
							onclick={() => (timing = 'later')}
						>
							Schedule for later
						</button>
					</div>

					{#if timing === 'later'}
						<div class="mt-3">
							<label class="fr-label" for="slot-select">Pick a 30-minute slot</label>
							<select id="slot-select" class="fr-input" bind:value={slot}>
								<option value={null}>Choose a time…</option>
								{#each slots as entry (entry.id)}
									<option value={entry.id}>{entry.label}</option>
								{/each}
							</select>
							{#if attempted && !slot}
								<p class="fr-error" role="alert">Pick a delivery slot.</p>
							{/if}
						</div>
					{/if}
				</section>

				<!-- PAYMENT -------------------------------------------------- -->
				<section class="fr-card p-4" aria-labelledby="payment-heading">
					<h2 id="payment-heading" class="text-sm font-extrabold tracking-wide uppercase">
						Payment method
					</h2>
					<p
						class="bg-warn/12 text-warn dark:text-warn-bright mt-2 rounded-xl px-3 py-2 text-xs font-bold"
						role="note"
					>
						Demo only — no real payment is taken and nothing you type here is stored or sent
						anywhere.
					</p>

					<div class="mt-3 space-y-2" role="radiogroup" aria-labelledby="payment-heading">
						{#each [{ id: 'upi', label: 'UPI', detail: 'Pay by any UPI app' }, { id: 'card', label: 'Credit / debit card', detail: 'Visa, Mastercard, RuPay' }, { id: 'wallet', label: 'FoodRush wallet', detail: 'Balance ₹500 (demo)' }, { id: 'cod', label: 'Cash on delivery', detail: 'Pay the rider when it arrives' }] as method (method.id)}
							<label
								class="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border p-3 text-sm {payment ===
								method.id
									? 'border-saffron-500 bg-saffron-500/5'
									: 'border-cocoa-200 dark:border-cocoa-800'}"
							>
								<input
									type="radio"
									name="payment"
									class="accent-saffron-500 h-4.5 w-4.5"
									checked={payment === method.id}
									onchange={() => (payment = method.id as PaymentMethod)}
								/>
								<span>
									<span class="block font-bold">{method.label}</span>
									<span class="text-cocoa-500 dark:text-cocoa-300 block text-xs">{method.detail}</span>
								</span>
							</label>
						{/each}
					</div>

					{#if payment === 'upi'}
						<div class="mt-3">
							<label class="fr-label" for="upi-id">UPI ID</label>
							<input
								id="upi-id"
								class="fr-input"
								placeholder="yourname@okbank"
								bind:value={upiId}
								aria-invalid={Boolean(attempted && paymentErrors.upi)}
							/>
							{#if attempted && paymentErrors.upi}
								<p class="fr-error" role="alert">{paymentErrors.upi}</p>
							{/if}
						</div>
					{:else if payment === 'card'}
						<div class="mt-3 grid gap-3 sm:grid-cols-2">
							<div class="sm:col-span-2">
								<label class="fr-label" for="card-number">Card number</label>
								<input
									id="card-number"
									class="fr-input font-mono"
									inputmode="numeric"
									maxlength="19"
									placeholder="4111 1111 1111 1111"
									bind:value={cardNumber}
									aria-invalid={Boolean(attempted && paymentErrors.cardNumber)}
								/>
								{#if attempted && paymentErrors.cardNumber}
									<p class="fr-error" role="alert">{paymentErrors.cardNumber}</p>
								{/if}
							</div>
							<div>
								<label class="fr-label" for="card-expiry">Expiry (MM/YY)</label>
								<input
									id="card-expiry"
									class="fr-input font-mono"
									placeholder="09/29"
									maxlength="5"
									bind:value={cardExpiry}
									aria-invalid={Boolean(attempted && paymentErrors.cardExpiry)}
								/>
								{#if attempted && paymentErrors.cardExpiry}
									<p class="fr-error" role="alert">{paymentErrors.cardExpiry}</p>
								{/if}
							</div>
							<div>
								<label class="fr-label" for="card-cvv">CVV</label>
								<input
									id="card-cvv"
									class="fr-input font-mono"
									inputmode="numeric"
									maxlength="3"
									placeholder="123"
									bind:value={cardCvv}
									aria-invalid={Boolean(attempted && paymentErrors.cardCvv)}
								/>
								{#if attempted && paymentErrors.cardCvv}
									<p class="fr-error" role="alert">{paymentErrors.cardCvv}</p>
								{/if}
							</div>
							<div class="sm:col-span-2">
								<label class="fr-label" for="card-name">Name on card</label>
								<input
									id="card-name"
									class="fr-input"
									bind:value={cardName}
									aria-invalid={Boolean(attempted && paymentErrors.cardName)}
								/>
								{#if attempted && paymentErrors.cardName}
									<p class="fr-error" role="alert">{paymentErrors.cardName}</p>
								{/if}
							</div>
						</div>
					{:else if payment === 'cod'}
						<p class="text-cocoa-600 dark:text-cocoa-200 mt-3 text-xs">
							Please keep {formatPaise(price.totalPaise)} ready. Riders rarely carry change for ₹2000 notes.
						</p>
					{/if}
				</section>
			</div>

			<!-- REVIEW + PLACE ---------------------------------------------- -->
			<div class="space-y-4">
				<section class="fr-card p-4" aria-labelledby="review-heading">
					<h2 id="review-heading" class="text-sm font-extrabold tracking-wide uppercase">
						Order summary
					</h2>
					<ul class="mt-3 space-y-2 text-sm">
						{#each lines as line (line.id)}
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
									</span>
								</span>
								<span class="shrink-0 font-semibold tabular-nums">
									{formatPaise(
										(line.basePricePaise +
											line.options.reduce((sum, option) => sum + option.deltaPaise, 0)) *
											line.quantity
									)}
								</span>
							</li>
						{/each}
					</ul>
					<a href={href('/cart')} class="text-saffron-700 dark:text-saffron-300 mt-3 inline-block text-xs font-bold">
						Edit cart
					</a>
				</section>

				<BillDetails {price} baseDeliveryFeePaise={app.baseDeliveryFee} couponCode={price.appliedCode} />

				<button
					type="button"
					class="fr-btn-primary w-full"
					onclick={placeOrder}
					disabled={placing || blocking.length > 0}
					aria-busy={placing}
				>
					{placing ? 'Placing your order…' : `Place order · ${formatPaise(price.totalPaise)}`}
				</button>

				{#if attempted && !readyToPlace && !placing}
					<p class="text-danger dark:text-danger-bright text-center text-xs font-bold" role="alert">
						{#if !address}
							Add a delivery address to continue.
						{:else if blocking.length > 0}
							Some items are unavailable - fix your cart first.
						{:else if timing === 'later' && !slot}
							Pick a delivery slot.
						{:else}
							Check the payment details above.
						{/if}
					</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Add address -->
<Dialog open={addingAddress} title="Add delivery address" onClose={() => (addingAddress = false)}>
	<AddressForm
		submitLabel="Save address"
		onCancel={() => (addingAddress = false)}
		onSubmit={(data) => {
			const created = app.addAddress(data);
			selectedAddressId = created.id;
			addingAddress = false;
			app.toast('Address saved.', 'success');
		}}
	/>
</Dialog>

<!-- Edit address -->
<Dialog
	open={Boolean(editingAddress)}
	title="Edit address"
	onClose={() => (editingAddress = null)}
>
	{#if editingAddress}
		<AddressForm
			initial={editingAddress}
			submitLabel="Update address"
			onCancel={() => (editingAddress = null)}
			onSubmit={(data) => {
				app.updateAddress(editingAddress!.id, data);
				editingAddress = null;
				app.toast('Address updated.', 'success');
			}}
		/>
	{/if}
</Dialog>

<!-- Delete address confirmation -->
<Dialog
	open={Boolean(deletingAddress)}
	title="Delete this address?"
	variant="centred"
	onClose={() => (deletingAddress = null)}
>
	<p class="text-cocoa-600 dark:text-cocoa-200 text-sm">
		{deletingAddress?.label} · {deletingAddress?.line1}, {deletingAddress?.area}
		{#if deletingAddress?.isDefault}
			<span class="mt-2 block font-bold">
				This is your default address. The next saved address will become the default.
			</span>
		{/if}
	</p>
	{#snippet footer()}
		<div class="flex gap-3">
			<button type="button" class="fr-btn-secondary flex-1" onclick={() => (deletingAddress = null)}>
				Keep it
			</button>
			<button
				type="button"
				class="fr-btn-danger flex-1"
				onclick={() => {
					if (deletingAddress) app.deleteAddress(deletingAddress.id);
					deletingAddress = null;
					app.toast('Address deleted.', 'info');
				}}
			>
				Delete address
			</button>
		</div>
	{/snippet}
</Dialog>
