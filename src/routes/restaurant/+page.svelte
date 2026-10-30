<script lang="ts">
	/**
	 * Restaurant page: header, offers, menu search, veg/non-veg toggle, category tabs with
	 * scroll-spy, dish rows, the customisation dialog, the replace-cart confirmation and
	 * the rating breakdown with recent reviews.
	 *
	 * The restaurant id is a QUERY PARAM (`/restaurant/?id=...`) rather than a route
	 * segment so every route in the app is prerenderable and a hard refresh resolves to a
	 * real file on any static host.
	 */
	import { page } from '$app/state';
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import { formatPaise } from '#lib/logic/money';
	import { filterDishes, groupByCategory, isOpenAt, minutesOfDay } from '#lib/logic/catalog';
	import { validateOptions } from '#lib/logic/cart';
	import type { Dish, SelectedOption } from '#lib/types';
	import DishCard from '#lib/components/DishCard.svelte';
	import CustomiseDialog from '#lib/components/CustomiseDialog.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import Stars from '#lib/components/Stars.svelte';
	import FoodImage from '#lib/components/FoodImage.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';

	let restaurantId = $derived(page.url.searchParams.get('id'));
	let restaurant = $derived(app.restaurant(restaurantId));

	let menuQuery = $state('');
	let vegFilter = $state<'all' | 'veg' | 'non-veg'>('all');
	let activeCategory = $state<string | null>(null);

	// The global "veg only" setting seeds the page filter, but the user can override it here.
	let seeded = $state(false);
	$effect(() => {
		if (!seeded && app.hydrated) {
			if (app.settings.vegOnly) vegFilter = 'veg';
			seeded = true;
		}
	});

	let open = $derived(restaurant ? isOpenAt(restaurant, minutesOfDay(new Date(app.clock))) : false);
	let rating = $derived(restaurantId ? app.ratingFor(restaurantId) : null);
	let offers = $derived(restaurantId ? app.offersFor(restaurantId) : []);
	let reviews = $derived(restaurantId ? app.reviewsFor(restaurantId) : []);
	let favourite = $derived(restaurantId ? app.isFavouriteRestaurant(restaurantId) : false);

	let allDishes = $derived(restaurantId ? app.menuFor(restaurantId) : []);
	let filtered = $derived(filterDishes(allDishes, { query: menuQuery, veg: vegFilter }));
	let groups = $derived(groupByCategory(filtered, restaurant?.categories ?? []));

	let vegCount = $derived(allDishes.filter((dish) => dish.veg).length);
	let nonVegCount = $derived(allDishes.length - vegCount);

	// --- customisation + replace-cart dialogs ---------------------------
	let customising = $state<Dish | null>(null);
	let pendingReplace = $state<{
		dish: Dish;
		options: SelectedOption[];
		instructions: string;
		quantity: number;
	} | null>(null);

	function add(dish: Dish, options: SelectedOption[], instructions: string, quantity: number) {
		const result = app.addToCart(dish, options, instructions, quantity);
		if (result === 'needs-replace') {
			pendingReplace = { dish, options, instructions, quantity };
			return;
		}
		if (result === 'unavailable') {
			app.toast(`${dish.name} just went out of stock.`, 'warning');
			return;
		}
		app.toast(`${dish.name} added to your cart.`, 'success');
	}

	function quickAdd(dish: Dish) {
		// A dish with no required options can be added straight from the card. Dishes WITH
		// options get defaults applied so the "+" on an existing line repeats the last
		// choice instead of silently dropping it.
		const validation = validateOptions(dish, {});
		add(dish, validation.ok ? validation.options : [], '', 1);
	}

	function repeatLast(dish: Dish) {
		// "+" on a customised dish repeats the most recent customisation of that dish,
		// which is what every food app does, instead of re-opening the dialog.
		const lines = app.cart.lines.filter((line) => line.dishId === dish.id);
		const last = lines[lines.length - 1];
		if (!last) {
			quickAdd(dish);
			return;
		}
		app.incrementLine(last.id);
	}

	function confirmReplace() {
		if (!pendingReplace) return;
		const { dish, options, instructions, quantity } = pendingReplace;
		app.replaceCartWith(dish, options, instructions, quantity);
		pendingReplace = null;
		app.toast(`Cart replaced with food from ${dish.restaurantId === restaurantId ? restaurant?.name : 'the new restaurant'}.`, 'success');
	}

	/** Scroll-spy: highlight the category tab whose section is in view. */
	function spy(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
				if (visible) activeCategory = visible.target.getAttribute('data-category');
			},
			// Only count a section as "current" once its heading is near the top.
			{ rootMargin: '-120px 0px -65% 0px', threshold: 0 }
		);
		for (const section of node.querySelectorAll('[data-category]')) observer.observe(section);
		return {
			destroy() {
				observer.disconnect();
			}
		};
	}

	function jumpTo(category: string) {
		activeCategory = category;
		document
			.querySelector(`[data-category="${CSS.escape(category)}"]`)
			?.scrollIntoView({ behavior: app.settings.reduceMotion ? 'auto' : 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>{restaurant ? `${restaurant.name} · FoodRush` : 'Restaurant · FoodRush'}</title>
</svelte:head>

{#if app.catalogStatus !== 'ready'}
	<h1 class="sr-only">Loading restaurant</h1>
	<div class="mx-auto w-full max-w-4xl px-4 py-6" aria-hidden="true">
		<div class="fr-skeleton h-40 rounded-card"></div>
		<div class="fr-skeleton mt-4 h-8 w-2/3"></div>
		<div class="mt-6 space-y-6">
			{#each Array.from({ length: 5 }, (_, index) => index) as index (index)}
				<div class="flex gap-4">
					<div class="flex-1 space-y-2">
						<div class="fr-skeleton h-4 w-1/2"></div>
						<div class="fr-skeleton h-3 w-1/4"></div>
						<div class="fr-skeleton h-3 w-full"></div>
					</div>
					<div class="fr-skeleton aspect-4/3 w-28 shrink-0 sm:w-36"></div>
				</div>
			{/each}
		</div>
	</div>
{:else if !restaurant}
	<h1 class="sr-only">Restaurant not found</h1>
	<EmptyState
		icon="search"
		title="That restaurant is not on FoodRush"
		message="The link may be old, or the kitchen may have left the platform. Browse what is open right now instead."
	>
		{#snippet action()}
			<a href={href('/restaurants')} class="fr-btn-primary">See all restaurants</a>
		{/snippet}
	</EmptyState>
{:else}
	<!-- ------------------------------------------------------- header -->
	<header class="mx-auto w-full max-w-4xl px-4 pt-4">
		<nav class="text-cocoa-500 dark:text-cocoa-300 mb-3 text-xs font-semibold" aria-label="Breadcrumb">
			<a href={href('/restaurants')} class="hover:text-saffron-700">Restaurants</a>
			<span aria-hidden="true"> › </span>
			<span>{restaurant.name}</span>
		</nav>

		<div class="fr-card overflow-hidden">
			<div class="relative">
				<FoodImage
					art={restaurant.art}
					alt="{restaurant.name} - {restaurant.cuisines.join(', ')}"
					ratio="aspect-16/6"
					eager
				/>
				{#if !open}
					<p
						class="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-extrabold text-white"
					>
						Closed right now · opens at {Math.floor(restaurant.hours.open / 60)}:{String(
							restaurant.hours.open % 60
						).padStart(2, '0')}
					</p>
				{/if}
			</div>

			<div class="p-4">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<h1 class="text-2xl font-extrabold">{restaurant.name}</h1>
						<p class="text-cocoa-600 dark:text-cocoa-200 text-sm">
							{restaurant.cuisines.join(', ')} · {restaurant.area}
						</p>
						<p class="text-cocoa-500 dark:text-cocoa-300 mt-0.5 text-xs">{restaurant.tagline}</p>
					</div>
					<button
						type="button"
						class="fr-btn-secondary h-11 w-11 shrink-0 rounded-full px-0"
						onclick={() => app.toggleFavouriteRestaurant(restaurant.id)}
						aria-pressed={favourite}
						aria-label={favourite ? 'Remove from favourites' : 'Save to favourites'}
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 20 20"
							aria-hidden="true"
							class={favourite ? 'fill-nonveg stroke-nonveg' : 'fill-none stroke-current'}
							stroke-width="1.8"
						>
							<path d="M10 17s-6.5-4.2-6.5-8.4A3.6 3.6 0 0 1 10 6.2a3.6 3.6 0 0 1 6.5 2.4C16.5 12.8 10 17 10 17Z" />
						</svg>
					</button>
				</div>

				<dl class="fr-sunk mt-4 grid grid-cols-3 divide-x divide-cocoa-200 dark:divide-cocoa-800 p-3 text-center">
					<div class="px-2">
						<dt class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
							Rating
						</dt>
						<dd class="mt-0.5 text-sm font-extrabold">
							{rating?.average.toFixed(1)} ★
							<span class="text-cocoa-500 dark:text-cocoa-300 block text-[11px] font-semibold">
								{rating?.count.toLocaleString('en-IN')} ratings
							</span>
						</dd>
					</div>
					<div class="px-2">
						<dt class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
							Delivery
						</dt>
						<dd class="mt-0.5 text-sm font-extrabold">
							{restaurant.deliveryMinutes} min
							<span class="text-cocoa-500 dark:text-cocoa-300 block text-[11px] font-semibold">
								{restaurant.distanceKm} km away
							</span>
						</dd>
					</div>
					<div class="px-2">
						<dt class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
							Price
						</dt>
						<dd class="mt-0.5 text-sm font-extrabold">
							{formatPaise(restaurant.priceForTwoPaise)}
							<span class="text-cocoa-500 dark:text-cocoa-300 block text-[11px] font-semibold">
								for two
							</span>
						</dd>
					</div>
				</dl>

				<p class="text-cocoa-600 dark:text-cocoa-200 mt-3 text-xs">
					<span class="font-bold">Address:</span>
					{restaurant.address}
					<span class="mt-0.5 block">
						<span class="font-bold">Open:</span>
						{Math.floor(restaurant.hours.open / 60)}:{String(restaurant.hours.open % 60).padStart(2, '0')}
						–
						{Math.floor(restaurant.hours.close / 60)}:{String(restaurant.hours.close % 60).padStart(2, '0')}
						every day
					</span>
				</p>

				{#if offers.length > 0}
					<ul class="mt-3 flex flex-wrap gap-2">
						{#each offers as coupon (coupon.code)}
							<li
								class="border-saffron-500/50 bg-saffron-500/10 text-saffron-700 dark:text-saffron-200 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold"
							>
								<span aria-hidden="true">%</span>
								{coupon.title} · code {coupon.code}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</header>

	<!-- --------------------------------------------------------- menu -->
	<div class="mx-auto w-full max-w-4xl px-4">
		<h2 class="mt-7 text-xl font-extrabold">Menu</h2>

		<div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
			<div class="relative flex-1">
				<label class="sr-only" for="menu-search">Search this menu</label>
				<input
					id="menu-search"
					class="fr-input pl-10"
					type="search"
					placeholder="Search in {restaurant.name}…"
					bind:value={menuQuery}
				/>
				<svg
					class="text-cocoa-400 pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
					aria-hidden="true"
				>
					<circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" stroke-linecap="round" />
				</svg>
			</div>

			<!-- Veg / non-veg toggle -->
			<div
				class="border-cocoa-300 dark:border-cocoa-700 inline-flex shrink-0 rounded-full border p-0.5"
				role="group"
				aria-label="Filter by vegetarian or non-vegetarian"
			>
				<button
					type="button"
					class="min-h-9 cursor-pointer rounded-full px-3.5 text-xs font-bold {vegFilter === 'all'
						? 'bg-cocoa-900 dark:bg-cocoa-100 dark:text-cocoa-900 text-white'
						: ''}"
					aria-pressed={vegFilter === 'all'}
					onclick={() => (vegFilter = 'all')}
				>
					All {allDishes.length}
				</button>
				<button
					type="button"
					class="min-h-9 cursor-pointer rounded-full px-3.5 text-xs font-bold {vegFilter === 'veg'
						? 'bg-veg text-white'
						: 'text-veg-ink dark:text-success-bright'}"
					aria-pressed={vegFilter === 'veg'}
					onclick={() => (vegFilter = vegFilter === 'veg' ? 'all' : 'veg')}
				>
					Veg {vegCount}
				</button>
				<button
					type="button"
					class="min-h-9 cursor-pointer rounded-full px-3.5 text-xs font-bold {vegFilter === 'non-veg'
						? 'bg-nonveg text-white'
						: 'text-nonveg dark:text-danger-bright'}"
					aria-pressed={vegFilter === 'non-veg'}
					onclick={() => (vegFilter = vegFilter === 'non-veg' ? 'all' : 'non-veg')}
					disabled={nonVegCount === 0}
					title={nonVegCount === 0 ? 'This is a pure veg kitchen' : undefined}
				>
					Non-veg {nonVegCount}
				</button>
			</div>
		</div>

		<!-- Category tabs with scroll-spy -->
		{#if groups.length > 1}
			<nav
				class="bg-paper/95 dark:bg-cocoa-950/95 fr-rail sticky top-[3.5rem] z-20 -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 py-2 backdrop-blur"
				aria-label="Menu categories"
			>
				{#each groups as group (group.category)}
					<button
						type="button"
						class="fr-chip"
						class:fr-chip-active={activeCategory === group.category}
						aria-current={activeCategory === group.category ? 'true' : undefined}
						onclick={() => jumpTo(group.category)}
					>
						{group.category}
						<span class="text-cocoa-400 dark:text-cocoa-300 font-medium">{group.dishes.length}</span>
					</button>
				{/each}
			</nav>
		{/if}

		{#if filtered.length === 0}
			<EmptyState
				icon="search"
				title="Nothing matches that here"
				message={menuQuery
					? `“${menuQuery}” is not on this menu${vegFilter !== 'all' ? ` under ${vegFilter === 'veg' ? 'veg' : 'non-veg'}` : ''}. Try another dish.`
					: 'No dishes match this filter.'}
			>
				{#snippet action()}
					<button
						type="button"
						class="fr-btn-secondary"
						onclick={() => {
							menuQuery = '';
							vegFilter = 'all';
						}}
					>
						Reset menu filters
					</button>
				{/snippet}
			</EmptyState>
		{:else}
			<div use:spy class="pb-4">
				{#each groups as group (group.category)}
					<section data-category={group.category} class="scroll-mt-28 pt-6">
						<h3 class="text-lg font-extrabold">
							{group.category}
							<span class="text-cocoa-500 dark:text-cocoa-300 text-sm font-bold">
								({group.dishes.length})
							</span>
						</h3>
						{#each group.dishes as dish (dish.id)}
							<DishCard
								{dish}
								onCustomise={(target) => (customising = target)}
								onQuickAdd={quickAdd}
								onRepeat={repeatLast}
							/>
						{/each}
					</section>
				{/each}
			</div>
		{/if}

		<!-- ------------------------------------------------- reviews -->
		{#if rating}
			<section class="border-cocoa-200 dark:border-cocoa-800 mt-8 border-t py-6" aria-labelledby="reviews-heading">
				<h2 id="reviews-heading" class="text-xl font-extrabold">Ratings & reviews</h2>

				<div class="mt-4 flex flex-col gap-6 sm:flex-row sm:items-center">
					<div class="text-center sm:w-36">
						<p class="text-4xl font-extrabold">{rating.average.toFixed(1)}</p>
						<Stars value={rating.average} />
						<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-xs font-semibold">
							{rating.count.toLocaleString('en-IN')} ratings
						</p>
					</div>

					<ul class="flex-1 space-y-1.5">
						{#each [5, 4, 3, 2, 1] as star (star)}
							{@const count = rating.distribution[star - 1]}
							{@const percent = rating.count === 0 ? 0 : Math.round((count / rating.count) * 100)}
							<li class="flex items-center gap-2 text-xs font-semibold">
								<span class="w-8 shrink-0">{star} ★</span>
								<span class="fr-sunk h-2.5 flex-1 overflow-hidden rounded-full">
									<span
										class="bg-rating block h-full rounded-full"
										style="width: {percent}%"
										role="img"
										aria-label="{percent}% of ratings are {star} star"
									></span>
								</span>
								<span class="text-cocoa-500 dark:text-cocoa-300 w-12 shrink-0 text-right">{percent}%</span>
							</li>
						{/each}
					</ul>
				</div>

				{#if reviews.length > 0}
					<ul class="mt-6 space-y-3">
						{#each reviews.slice(0, 5) as review (review.id)}
							<li class="fr-card p-4">
								<div class="flex items-center justify-between gap-3">
									<p class="text-sm font-extrabold">{review.authorName}</p>
									<span class="fr-rating">{review.foodRating.toFixed(1)} ★</span>
								</div>
								{#if review.tags.length > 0}
									<ul class="mt-2 flex flex-wrap gap-1.5">
										{#each review.tags as tag (tag)}
											<li class="fr-sunk px-2 py-0.5 text-[11px] font-bold">{tag}</li>
										{/each}
									</ul>
								{/if}
								{#if review.text}
									<p class="text-cocoa-600 dark:text-cocoa-200 mt-2 text-sm">{review.text}</p>
								{/if}
								<p class="text-cocoa-500 dark:text-cocoa-300 mt-2 text-[11px] font-semibold">
									Delivery rated {review.deliveryRating}/5
								</p>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-cocoa-600 dark:text-cocoa-200 mt-5 text-sm">
						No written reviews yet. Order something and you could be the first.
					</p>
				{/if}
			</section>
		{/if}
	</div>

	<CustomiseDialog
		dish={customising}
		onClose={() => (customising = null)}
		onAdd={(dish, validation, instructions, quantity) => {
			customising = null;
			if (validation.ok) add(dish, validation.options, instructions, quantity);
		}}
	/>

	<!-- Replace-cart confirmation: mixing two kitchens is never silent. -->
	<Dialog
		open={Boolean(pendingReplace)}
		title="Replace cart?"
		description="Your cart has food from another restaurant."
		variant="centred"
		onClose={() => (pendingReplace = null)}
	>
		<p class="text-cocoa-600 dark:text-cocoa-200 text-sm">
			FoodRush delivers one restaurant per order. Your cart currently has
			<span class="font-bold">{app.cartCount} item{app.cartCount === 1 ? '' : 's'}</span>
			from <span class="font-bold">{app.cartRestaurant?.name}</span>. Adding
			<span class="font-bold">{pendingReplace?.dish.name}</span>
			from <span class="font-bold">{restaurant.name}</span> will empty that cart first.
		</p>
		{#snippet footer()}
			<div class="flex gap-3">
				<button type="button" class="fr-btn-secondary flex-1" onclick={() => (pendingReplace = null)}>
					Keep old cart
				</button>
				<button type="button" class="fr-btn-primary flex-1" onclick={confirmReplace} data-autofocus>
					Replace cart
				</button>
			</div>
		{/snippet}
	</Dialog>
{/if}
