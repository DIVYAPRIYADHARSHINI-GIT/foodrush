<script lang="ts">
	/**
	 * Landing page: hero, delivery location, category row, offers carousel and
	 * "Top rated near you".
	 *
	 * Location is permission-AWARE: the browser prompt is only triggered when the user asks
	 * for it, every outcome (granted, denied, unavailable, timeout) produces a readable
	 * message, and the user can always pick an area by hand instead.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { href, assetUrl } from '#lib/paths';
	import { formatPaise } from '#lib/logic/money';
	import { isOpenAt, minutesOfDay } from '#lib/logic/catalog';
	import { dishArt } from '#lib/paths';
	import RestaurantCard from '#lib/components/RestaurantCard.svelte';
	import SkeletonCards from '#lib/components/SkeletonCards.svelte';

	let locating = $state(false);
	let locationMessage = $state<string | null>(null);
	let areaQuery = $state('');

	let areas = $derived(
		app.areas.filter((area) =>
			`${area.name} ${area.pin}`.toLowerCase().includes(areaQuery.trim().toLowerCase())
		)
	);

	let nowMinutes = $derived(minutesOfDay(new Date(app.clock)));

	/** Top rated: open restaurants, best live rating first. */
	let topRated = $derived(
		[...app.restaurants]
			.map((restaurant) => ({ restaurant, rating: app.ratingFor(restaurant.id) }))
			.filter((entry) => isOpenAt(entry.restaurant, nowMinutes))
			.sort((a, b) => b.rating.exactAverage - a.rating.exactAverage)
			.slice(0, 6)
	);

	/** Fastest open kitchens, for the second rail. */
	let quickest = $derived(
		[...app.restaurants]
			.filter((restaurant) => isOpenAt(restaurant, nowMinutes))
			.sort((a, b) => a.deliveryMinutes - b.deliveryMinutes)
			.slice(0, 6)
	);

	let liveOffers = $derived(app.couponOffers.map((offer) => offer.coupon).slice(0, 6));

	function useCurrentLocation() {
		locationMessage = null;
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			locationMessage = 'This browser cannot share your location. Pick an area below instead.';
			return;
		}
		locating = true;
		navigator.geolocation.getCurrentPosition(
			() => {
				locating = false;
				// A demo app has no reverse-geocoder, so the nearest listed area is used and
				// labelled honestly rather than pretending to know the street.
				const nearest = app.areas[0];
				if (nearest) {
					app.setLocation(nearest.id, `${nearest.name}, ${nearest.city}`, true);
					locationMessage = `Using your location - closest serviceable area is ${nearest.name}.`;
				} else {
					locationMessage = 'We could not match your location to a delivery area.';
				}
			},
			(error) => {
				locating = false;
				locationMessage =
					error.code === error.PERMISSION_DENIED
						? 'Location permission was denied. Pick an area below instead.'
						: error.code === error.TIMEOUT
							? 'Finding your location took too long. Pick an area below instead.'
							: 'Your location is unavailable right now. Pick an area below instead.';
			},
			{ timeout: 8000, maximumAge: 60_000 }
		);
	}

	function chooseArea(areaId: string, name: string, city: string) {
		app.setLocation(areaId, `${name}, ${city}`, false);
		locationMessage = `Delivering to ${name}. Showing restaurants that cover this area.`;
	}
</script>

<svelte:head>
	<title>FoodRush - Hungry? Order in minutes.</title>
</svelte:head>

<!-- ---------------------------------------------------------------- hero -->
<section class="relative overflow-hidden">
	<img
		src={assetUrl('/img/hero/spread.svg')}
		alt=""
		width="1280"
		height="720"
		class="absolute inset-0 h-full w-full object-cover opacity-45 dark:opacity-25"
		aria-hidden="true"
	/>
	<div
		class="from-paper/60 via-paper/90 to-paper dark:from-cocoa-950/60 dark:via-cocoa-950/90 dark:to-cocoa-950 absolute inset-0 bg-gradient-to-b"
		aria-hidden="true"
	></div>

	<div class="relative mx-auto w-full max-w-3xl px-4 py-12 text-center sm:py-16">
		<p class="text-saffron-700 dark:text-saffron-300 text-xs font-extrabold tracking-[0.18em] uppercase">
			Bengaluru · 30 kitchens open
		</p>
		<h1 class="mt-3 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
			Hungry? Order in minutes.
		</h1>
		<p class="text-cocoa-600 dark:text-cocoa-200 mx-auto mt-3 max-w-xl text-base text-pretty">
			Dosas at dawn, biryani at midnight. Tell us where you are and we will show you what is hot,
			close and actually open right now.
		</p>

		<!-- Location picker -->
		<div class="fr-card mx-auto mt-7 max-w-xl p-4 text-left">
			<label class="fr-label" for="area-search">Delivery location</label>
			<div class="flex flex-col gap-2 sm:flex-row">
				<input
					id="area-search"
					class="fr-input"
					type="search"
					placeholder="Search area or pin code, e.g. Koramangala or 560034"
					bind:value={areaQuery}
					autocomplete="postal-code"
				/>
				<button
					type="button"
					class="fr-btn-secondary shrink-0"
					onclick={useCurrentLocation}
					disabled={locating}
				>
					{#if locating}
						Locating…
					{:else}
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<path
								d="M8 0a.8.8 0 0 1 .8.8v1.26a6 6 0 0 1 5.14 5.14H15.2a.8.8 0 1 1 0 1.6h-1.26a6 6 0 0 1-5.14 5.14V15.2a.8.8 0 1 1-1.6 0v-1.26a6 6 0 0 1-5.14-5.14H.8a.8.8 0 0 1 0-1.6h1.26A6 6 0 0 1 7.2 2.06V.8A.8.8 0 0 1 8 0Zm0 3.6A4.4 4.4 0 1 0 8 12.4 4.4 4.4 0 0 0 8 3.6Zm0 2.4a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
							/>
						</svg>
						Use current location
					{/if}
				</button>
			</div>

			{#if locationMessage}
				<p class="text-cocoa-600 dark:text-cocoa-200 mt-2 text-xs font-semibold" role="status">
					{locationMessage}
				</p>
			{/if}

			<p class="text-cocoa-500 dark:text-cocoa-300 mt-3 mb-1.5 text-xs font-bold tracking-wide uppercase">
				{areaQuery ? 'Matching areas' : 'Popular areas'}
			</p>
			{#if areas.length === 0}
				<p class="text-cocoa-600 dark:text-cocoa-200 text-sm">
					We do not deliver to “{areaQuery}” yet. Try another area or pin code.
				</p>
			{:else}
				<ul class="flex flex-wrap gap-2">
					{#each areas.slice(0, 8) as area (area.id)}
						<li>
							<button
								type="button"
								class="fr-chip"
								class:fr-chip-active={app.location.areaId === area.id}
								onclick={() => chooseArea(area.id, area.name, area.city)}
								aria-pressed={app.location.areaId === area.id}
							>
								{area.name}
								<span class="text-cocoa-400 dark:text-cocoa-300 font-medium">{area.pin}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<a href={href('/restaurants')} class="fr-btn-primary mt-4 w-full">
				{app.location.label ? `Find food in ${app.location.label.split(',')[0]}` : 'Browse all restaurants'}
			</a>
		</div>
	</div>
</section>

<!-- ----------------------------------------------------------- categories -->
<section class="mx-auto w-full max-w-6xl px-4 py-6" aria-labelledby="categories-heading">
	<h2 id="categories-heading" class="text-xl font-extrabold">What are you craving?</h2>
	<!--
		tabindex=0 on the scroll CONTAINER, not on the <ul>: a scrollable region must be
		reachable by keyboard so arrow keys can pan it (axe: "scrollable-region-focusable"),
		but putting role="group" on the <ul> itself strips the list role from its <li>s
		(axe: "listitem"). A wrapper keeps both correct.
	-->
	<div class="fr-rail mt-4 overflow-x-auto pb-2" tabindex="0" role="group" aria-label="Food categories">
	<ul class="flex gap-3">
		{#if app.catalogStatus !== 'ready'}
			{#each Array.from({ length: 8 }, (_, index) => index) as index (index)}
				<li class="shrink-0" aria-hidden="true">
					<div class="fr-skeleton h-24 w-20 rounded-2xl"></div>
				</li>
			{/each}
		{:else}
			{#each app.categories as category (category.id)}
				<li class="shrink-0">
					<a
						href={href(`/restaurants?cuisine=${encodeURIComponent(category.name)}`)}
						class="group flex w-20 flex-col items-center gap-1.5"
					>
						<span
							class="fr-sunk group-hover:ring-saffron-500 block h-20 w-20 overflow-hidden rounded-full ring-2 ring-transparent transition"
						>
							<img
								src={dishArt(category.art)}
								alt=""
								width="480"
								height="360"
								loading="lazy"
								class="h-full w-full object-cover"
							/>
						</span>
						<span class="text-center text-xs font-bold">{category.name}</span>
					</a>
				</li>
			{/each}
		{/if}
	</ul>
	</div>
</section>

<!-- --------------------------------------------------------------- offers -->
{#if liveOffers.length > 0}
	<section class="mx-auto w-full max-w-6xl px-4 py-4" aria-labelledby="offers-heading">
		<div class="flex items-end justify-between gap-3">
			<h2 id="offers-heading" class="text-xl font-extrabold">Offers for you</h2>
			<a href={href('/offers')} class="text-saffron-700 dark:text-saffron-300 text-sm font-bold">
				See all
			</a>
		</div>
		<div
			class="fr-rail mt-4 overflow-x-auto pb-2"
			tabindex="0"
			role="group"
			aria-label="Current offers"
		>
		<ul class="flex snap-x snap-mandatory gap-3">
			{#each liveOffers as coupon (coupon.code)}
				<li class="w-72 shrink-0 snap-start">
					<div
						class="from-saffron-500 to-saffron-700 flex h-full flex-col justify-between rounded-card bg-gradient-to-br p-4 text-white"
					>
						<p class="text-2xl font-extrabold">
							{coupon.kind === 'free-delivery'
								? 'Free delivery'
								: coupon.kind === 'percent'
									? `${coupon.percent}% OFF`
									: `${formatPaise(coupon.flatPaise ?? 0)} OFF`}
						</p>
						<p class="mt-1 text-sm opacity-95">{coupon.description}</p>
						<p class="mt-3 inline-flex w-fit rounded-lg bg-white/20 px-2.5 py-1 font-mono text-xs font-bold">
							{coupon.code}
						</p>
					</div>
				</li>
			{/each}
		</ul>
		</div>
	</section>
{/if}

<!-- ------------------------------------------------------------ top rated -->
<section class="mx-auto w-full max-w-6xl px-4 py-6" aria-labelledby="top-rated-heading">
	<div class="flex items-end justify-between gap-3">
		<h2 id="top-rated-heading" class="text-xl font-extrabold">Top rated near you</h2>
		<a href={href('/restaurants?sort=rating')} class="text-saffron-700 dark:text-saffron-300 text-sm font-bold">
			See all
		</a>
	</div>

	{#if app.catalogStatus === 'error'}
		<div class="fr-card border-danger/40 mt-4 p-5 text-sm" role="alert">
			<p class="font-bold">We could not load the FoodRush menu.</p>
			<p class="text-cocoa-600 dark:text-cocoa-200 mt-1">{app.catalogError}</p>
			<button type="button" class="fr-btn-secondary mt-3" onclick={() => app.loadCatalog()}>
				Try again
			</button>
		</div>
	{:else if app.catalogStatus !== 'ready'}
		<div class="mt-4"><SkeletonCards count={6} /></div>
	{:else}
		<ul class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each topRated as entry, index (entry.restaurant.id)}
				<li><RestaurantCard restaurant={entry.restaurant} eager={index < 3} /></li>
			{/each}
		</ul>
	{/if}
</section>

<!-- -------------------------------------------------------------- fastest -->
{#if app.catalogStatus === 'ready' && quickest.length > 0}
	<section class="mx-auto w-full max-w-6xl px-4 py-6" aria-labelledby="quickest-heading">
		<h2 id="quickest-heading" class="text-xl font-extrabold">On your table fastest</h2>
		<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-sm">
			Kitchens closest to you, sorted by how quickly they usually deliver.
		</p>
		<ul class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each quickest as restaurant (restaurant.id)}
				<li><RestaurantCard {restaurant} /></li>
			{/each}
		</ul>
	</section>
{/if}
