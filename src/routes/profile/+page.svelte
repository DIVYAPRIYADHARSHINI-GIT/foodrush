<script lang="ts">
	/**
	 * Profile: personal details, order stats, saved addresses, settings (theme, veg
	 * default, reduced motion, language) and data tools.
	 *
	 * Language is a real setting with one shipped locale: the UI exposes it and persists
	 * it, but FoodRush only ships English copy today, so the control says so rather than
	 * pretending to switch.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import { formatPaise } from '#lib/logic/money';
	import { orderStats } from '#lib/logic/orders';
	import type { Address, Theme } from '#lib/types';
	import AddressForm from '#lib/components/AddressForm.svelte';
	import Dialog from '#lib/components/Dialog.svelte';

	let addingAddress = $state(false);
	let editingAddress = $state<Address | null>(null);
	let resetting = $state(false);
	let importError = $state<string | null>(null);

	let stats = $derived(orderStats(app.orders));

	const THEMES: { id: Theme; label: string }[] = [
		{ id: 'light', label: 'Light' },
		{ id: 'dark', label: 'Dark' },
		{ id: 'system', label: 'Match device' }
	];

	function exportData() {
		const blob = new Blob([app.exportJson()], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `foodrush-backup-${new Date().toISOString().slice(0, 10)}.json`;
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 4000);
	}

	async function importData(event: Event) {
		importError = null;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const result = app.importJson(await file.text());
			if (result.ok) app.toast('Backup restored.', 'success');
			else importError = result.error;
		} catch {
			importError = 'That file could not be read.';
		}
		// Allow re-picking the same file after a failure.
		input.value = '';
	}
</script>

<svelte:head>
	<title>Your profile · FoodRush</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-5">
	<h1 class="text-2xl font-extrabold">Your profile</h1>

	<!-- stats -->
	<dl class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="fr-card p-3.5 text-center">
			<dt class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
				Delivered
			</dt>
			<dd class="mt-1 text-xl font-extrabold">{stats.delivered}</dd>
		</div>
		<div class="fr-card p-3.5 text-center">
			<dt class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
				Total spent
			</dt>
			<dd class="mt-1 text-xl font-extrabold">{formatPaise(stats.spentPaise)}</dd>
		</div>
		<div class="fr-card p-3.5 text-center">
			<dt class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
				Favourites
			</dt>
			<dd class="mt-1 text-xl font-extrabold">
				{app.favourites.restaurants.length + app.favourites.dishes.length}
			</dd>
		</div>
		<div class="fr-card p-3.5 text-center">
			<dt class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
				Most ordered
			</dt>
			<dd class="mt-1 truncate text-sm font-extrabold" title={stats.favouriteRestaurant ?? '—'}>
				{stats.favouriteRestaurant ?? '—'}
			</dd>
		</div>
	</dl>

	<!-- details -->
	<section class="fr-card mt-5 p-4" aria-labelledby="details-heading">
		<h2 id="details-heading" class="text-sm font-extrabold tracking-wide uppercase">
			Your details
		</h2>
		<div class="mt-3 grid gap-3 sm:grid-cols-3">
			<div>
				<label class="fr-label" for="profile-name">Name</label>
				<input
					id="profile-name"
					class="fr-input"
					value={app.profile.name}
					oninput={(event) => app.updateProfile({ name: event.currentTarget.value })}
					autocomplete="name"
				/>
			</div>
			<div>
				<label class="fr-label" for="profile-phone">Mobile</label>
				<input
					id="profile-phone"
					class="fr-input"
					type="tel"
					value={app.profile.phone}
					oninput={(event) => app.updateProfile({ phone: event.currentTarget.value })}
					autocomplete="tel-national"
				/>
			</div>
			<div>
				<label class="fr-label" for="profile-email">Email</label>
				<input
					id="profile-email"
					class="fr-input"
					type="email"
					value={app.profile.email}
					oninput={(event) => app.updateProfile({ email: event.currentTarget.value })}
					autocomplete="email"
				/>
			</div>
		</div>
		<p class="text-cocoa-500 dark:text-cocoa-300 mt-2 text-xs">
			Saved in this browser only. FoodRush has no accounts and no server.
		</p>
	</section>

	<!-- addresses -->
	<section class="fr-card mt-4 p-4" aria-labelledby="addresses-heading">
		<div class="flex items-center justify-between gap-3">
			<h2 id="addresses-heading" class="text-sm font-extrabold tracking-wide uppercase">
				Saved addresses
			</h2>
			<button type="button" class="fr-btn-ghost min-h-9 px-3 text-xs" onclick={() => (addingAddress = true)}>
				+ Add
			</button>
		</div>

		{#if app.addresses.length === 0}
			<p class="text-cocoa-600 dark:text-cocoa-200 mt-3 text-sm">
				No addresses saved yet. Add one here or during checkout.
			</p>
		{:else}
			<ul class="divide-cocoa-200 dark:divide-cocoa-800 mt-2 divide-y">
				{#each app.addresses as address (address.id)}
					<li class="py-3 text-sm">
						<p class="flex flex-wrap items-center gap-2 font-extrabold">
							{address.label}
							{#if address.isDefault}
								<span
									class="bg-saffron-500/15 text-saffron-700 dark:text-saffron-200 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase"
								>
									Default
								</span>
							{/if}
						</p>
						<p class="text-cocoa-600 dark:text-cocoa-200 mt-0.5">
							{address.name} · {address.phone}
						</p>
						<p class="text-cocoa-600 dark:text-cocoa-200">
							{address.line1}{address.line2 ? `, ${address.line2}` : ''}, {address.area}, {address.city}
							{address.pin}
						</p>
						<div class="mt-1.5 flex flex-wrap gap-1">
							<button
								type="button"
								class="text-saffron-700 dark:text-saffron-300 min-h-9 cursor-pointer px-1.5 text-xs font-bold"
								onclick={() => (editingAddress = address)}
							>
								Edit
							</button>
							{#if !address.isDefault}
								<button
									type="button"
									class="text-cocoa-600 dark:text-cocoa-200 min-h-9 cursor-pointer px-1.5 text-xs font-bold"
									onclick={() => app.setDefaultAddress(address.id)}
								>
									Set default
								</button>
							{/if}
							<button
								type="button"
								class="text-danger dark:text-danger-bright min-h-9 cursor-pointer px-1.5 text-xs font-bold"
								onclick={() => {
									app.deleteAddress(address.id);
									app.toast('Address deleted.', 'info');
								}}
							>
								Delete
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- settings -->
	<section class="fr-card mt-4 p-4" aria-labelledby="settings-heading">
		<h2 id="settings-heading" class="text-sm font-extrabold tracking-wide uppercase">Settings</h2>

		<div class="mt-3">
			<p class="fr-label mb-1.5">Theme</p>
			<div class="flex gap-2" role="group" aria-label="Theme">
				{#each THEMES as theme (theme.id)}
					<button
						type="button"
						class="fr-chip"
						class:fr-chip-active={app.settings.theme === theme.id}
						aria-pressed={app.settings.theme === theme.id}
						onclick={() => app.setTheme(theme.id)}
					>
						{theme.label}
					</button>
				{/each}
			</div>
		</div>

		<label class="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
			<span>
				<span class="block font-bold">Show veg food by default</span>
				<span class="text-cocoa-500 dark:text-cocoa-300 block text-xs">
					Menus open with the veg filter already on.
				</span>
			</span>
			<input
				type="checkbox"
				class="accent-saffron-500 h-5 w-5 shrink-0"
				checked={app.settings.vegOnly}
				onchange={(event) => app.setVegOnly(event.currentTarget.checked)}
			/>
		</label>

		<label class="mt-2 flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
			<span>
				<span class="block font-bold">Reduce motion</span>
				<span class="text-cocoa-500 dark:text-cocoa-300 block text-xs">
					Turn off smooth scrolling and shimmer animations.
				</span>
			</span>
			<input
				type="checkbox"
				class="accent-saffron-500 h-5 w-5 shrink-0"
				checked={app.settings.reduceMotion}
				onchange={(event) => app.setReduceMotion(event.currentTarget.checked)}
			/>
		</label>

		<div class="mt-4">
			<label class="fr-label" for="language-select">Language</label>
			<select id="language-select" class="fr-input" value={app.settings.language} disabled>
				<option value="en">English (India)</option>
			</select>
			<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-xs">
				Only English ships today. The setting is stored so more languages can be dropped in
				without a data migration.
			</p>
		</div>
	</section>

	<!-- data -->
	<section class="fr-card mt-4 p-4" aria-labelledby="data-heading">
		<h2 id="data-heading" class="text-sm font-extrabold tracking-wide uppercase">Your data</h2>
		<p class="text-cocoa-600 dark:text-cocoa-200 mt-2 text-xs">
			Everything - cart, orders, addresses, reviews, favourites - lives in this browser.
			Clearing site data erases it, so take a backup if you care about it.
		</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<button type="button" class="fr-btn-secondary min-h-10 px-4 text-xs" onclick={exportData}>
				Download backup
			</button>
			<label class="fr-btn-secondary min-h-10 cursor-pointer px-4 text-xs">
				Restore backup
				<input type="file" accept="application/json,.json" class="sr-only" onchange={importData} />
			</label>
			<button
				type="button"
				class="fr-btn-danger min-h-10 px-4 text-xs"
				onclick={() => (resetting = true)}
			>
				Start fresh
			</button>
		</div>
		{#if importError}
			<p class="fr-error" role="alert">{importError}</p>
		{/if}
	</section>

	<div class="mt-5 flex flex-wrap gap-3">
		<a href={href('/favourites')} class="fr-btn-ghost">Favourites</a>
		<a href={href('/offers')} class="fr-btn-ghost">Coupon wallet</a>
		<a href={href('/owner')} class="fr-btn-ghost">Restaurant owner view</a>
	</div>
</div>

<Dialog open={addingAddress} title="Add address" onClose={() => (addingAddress = false)}>
	<AddressForm
		onCancel={() => (addingAddress = false)}
		onSubmit={(data) => {
			app.addAddress(data);
			addingAddress = false;
			app.toast('Address saved.', 'success');
		}}
	/>
</Dialog>

<Dialog open={Boolean(editingAddress)} title="Edit address" onClose={() => (editingAddress = null)}>
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

<Dialog
	open={resetting}
	title="Start fresh?"
	variant="centred"
	onClose={() => (resetting = false)}
>
	<p class="text-cocoa-600 dark:text-cocoa-200 text-sm">
		This deletes your cart, orders, addresses, reviews and favourites from this browser. It cannot
		be undone - download a backup first if you want to keep them.
	</p>
	{#snippet footer()}
		<div class="flex gap-3">
			<button type="button" class="fr-btn-secondary flex-1" onclick={() => (resetting = false)}>
				Keep my data
			</button>
			<button
				type="button"
				class="fr-btn-danger flex-1"
				onclick={() => {
					app.resetAll();
					resetting = false;
					app.toast('FoodRush data cleared.', 'info');
				}}
			>
				Delete everything
			</button>
		</div>
	{/snippet}
</Dialog>
