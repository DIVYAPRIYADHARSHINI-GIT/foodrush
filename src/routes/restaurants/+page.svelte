<script lang="ts">
	/**
	 * Restaurant listing: search, sort, filters, chips and infinite scroll.
	 *
	 * FILTER STATE LIVES IN THE URL. Every control writes a query parameter and the list is
	 * derived from `page.url`, so:
	 *   - going into a restaurant and pressing Back restores the exact filter set,
	 *   - the scroll position is restored by the browser because the page is not remounted
	 *     with different state,
	 *   - and a filtered view can be shared or refreshed as a deep link.
	 * No component-local copy of the filters exists anywhere.
	 */
	import { page } from '$app/state';
	import { beforeNavigate, goto } from '$app/navigation';
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import {
		EMPTY_FILTERS,
		PRICE_BANDS,
		SORT_OPTIONS,
		activeChips,
		filterRestaurants,
		hasActiveFilters,
		minutesOfDay,
		type Filters,
		type SortKey
	} from '#lib/logic/catalog';
	import RestaurantCard from '#lib/components/RestaurantCard.svelte';
	import SkeletonCards from '#lib/components/SkeletonCards.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';

	const PAGE_SIZE = 9;

	/**
	 * Parsed query string - the single source of truth for this page's filters.
	 *
	 * Derived from `page.url.search` (a STRING) rather than from `page.url.searchParams`:
	 * reading the searchParams object did not re-trigger this derived when the query
	 * changed, so the list silently kept showing unfiltered results while the URL updated.
	 */
	let params = $derived(new URLSearchParams(page.url.search));

	let filters = $derived.by<Filters>(() => {
		const band = PRICE_BANDS.find((entry) => entry.id === params.get('price'));
		const sort = params.get('sort');
		return {
			query: params.get('q') ?? '',
			cuisine: params.get('cuisine'),
			vegOnly: params.get('veg') === '1',
			ratingFourPlus: params.get('rating') === '1',
			fastDelivery: params.get('fast') === '1',
			offersOnly: params.get('offers') === '1',
			minPricePaise: band?.minPaise ?? null,
			maxPricePaise: band?.maxPaise ?? null,
			sort: (SORT_OPTIONS.some((option) => option.key === sort) ? sort : 'relevance') as SortKey
		};
	});

	/** Local mirror of the search box so typing stays responsive; URL is the truth. */
	let searchText = $state('');
	let searchSynced = $state(false);
	$effect(() => {
		// Adopt the URL value once on mount and whenever it changes from outside (chips).
		const fromUrl = params.get('q') ?? '';
		if (!searchSynced || fromUrl !== searchText) {
			searchText = fromUrl;
			searchSynced = true;
		}
	});

	let visibleCount = $state(PAGE_SIZE);

	let nowMinutes = $derived(minutesOfDay(new Date(app.clock)));

	let hits = $derived(
		app.catalogStatus === 'ready'
			? filterRestaurants({
					restaurants: app.restaurants,
					menus: app.menus,
					filters,
					nowMinutes,
					availability: app.availability
				})
			: []
	);

	let visible = $derived(hits.slice(0, visibleCount));
	let chips = $derived(activeChips(filters));
	let anyFilter = $derived(hasActiveFilters(filters));

	/**
	 * Paging AND scroll position, remembered per filter set in sessionStorage.
	 *
	 * The brief requires that coming back from a restaurant page never loses the scroll
	 * position. Two things have to be true for that:
	 *
	 *  1. the page must be as TALL as it was - if infinite scroll resets to 9 cards there is
	 *     nothing to scroll back to, so the card count is restored first; and
	 *  2. the scroll must be applied AFTER those cards render. The browser (and SvelteKit's
	 *     own scroll restoration) run before this page's catalog-driven list paints, so they
	 *     land near the top and the position is lost. Hence the explicit restore below,
	 *     which waits for the list to reach its remembered height.
	 *
	 * Changing the filters clears both, because the result set is then genuinely different.
	 */
	const PAGING_KEY = 'foodrush:listing-paging';
	let filterKey = $derived(page.url.search);

	interface ListingMemory {
		key: string;
		count: number;
		scrollY: number;
	}

	function readMemory(): ListingMemory | null {
		try {
			const raw = sessionStorage.getItem(PAGING_KEY);
			if (!raw) return null;
			const saved = JSON.parse(raw) as ListingMemory;
			return Number.isFinite(saved?.count) ? saved : null;
		} catch {
			// Session storage blocked or corrupt - fall back to the first page.
			return null;
		}
	}

	function writeMemory(memory: ListingMemory): void {
		try {
			sessionStorage.setItem(PAGING_KEY, JSON.stringify(memory));
		} catch {
			// Non-fatal: paging/scroll just will not be restored on Back.
		}
	}

	// Restore the card count as soon as the filter set is known.
	$effect(() => {
		const key = filterKey;
		const saved = readMemory();
		visibleCount =
			saved && saved.key === key ? Math.max(PAGE_SIZE, Math.min(120, saved.count)) : PAGE_SIZE;
	});

	/**
	 * The scroll offset to restore, captured ONCE per filter set at mount.
	 *
	 * It must be read before the scroll listener below starts recording, otherwise the
	 * listener overwrites the remembered offset with the current (top-of-page) one while
	 * the restore is still waiting for cards to render - which is exactly the race that
	 * made Back land at the top.
	 */
	let pendingScroll = $state<number | null>(null);
	let restoredFor = $state<string | null>(null);

	$effect(() => {
		const key = filterKey;
		if (restoredFor === key) return;
		const saved = readMemory();
		pendingScroll = saved && saved.key === key && saved.scrollY >= 80 ? saved.scrollY : null;
		restoredFor = key;
	});

	// Apply it once the list is tall enough to hold that offset.
	$effect(() => {
		const target = pendingScroll;
		if (target === null || app.catalogStatus !== 'ready' || visible.length === 0) return;

		let cancelled = false;
		let frames = 0;
		const restore = () => {
			if (cancelled) return;
			const tallEnough = document.documentElement.scrollHeight >= target + window.innerHeight;
			if (tallEnough || frames > 60) {
				window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
				pendingScroll = null;
				return;
			}
			frames += 1;
			requestAnimationFrame(restore);
		};
		requestAnimationFrame(restore);
		return () => {
			cancelled = true;
		};
	});

	/**
	 * Record paging and scroll as the user moves, so Back has something to restore.
	 *
	 * Recording STOPS the moment a navigation starts (`beforeNavigate`). SvelteKit scrolls
	 * the window to the top when it navigates to the restaurant page, and without this
	 * freeze the scroll listener faithfully recorded that 0 - overwriting the position we
	 * are trying to come back to. Writes are also paused while a restore is pending, for
	 * the same reason.
	 */
	let recording = $state(true);
	beforeNavigate(() => {
		recording = false;
	});

	$effect(() => {
		const key = filterKey;
		const count = visibleCount;
		const save = () => {
			if (!recording || pendingScroll !== null) return;
			writeMemory({ key, count, scrollY: Math.round(window.scrollY) });
		};
		save();

		let ticking = false;
		const onScroll = () => {
			if (ticking) return;
			ticking = true;
			requestAnimationFrame(() => {
				ticking = false;
				save();
			});
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	function setParams(changes: Record<string, string | null>) {
		const next = new URLSearchParams(page.url.search);
		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === '') next.delete(key);
			else next.set(key, value);
		}
		const search = next.toString();
		/*
		 * `goto` with `replaceState: true`, NOT the shallow-routing `replaceState()` helper.
		 *
		 * The shallow helper rewrites the address bar without updating `page.url`, so the
		 * URL said `?q=biryani` while the derived filters still saw the old (empty) query
		 * and the list kept showing all 30 kitchens. `goto` updates the router's own state,
		 * which is what the filters derive from; `replaceState: true` still keeps the Back
		 * button pointing at the page the user came FROM instead of filling history with one
		 * entry per keystroke, and `reset: false` stops the search box losing focus or the
		 * list jumping to the top while typing.
		 */
		void goto(`${page.url.pathname}${search ? `?${search}` : ''}`, { replace: true, reset: false });
	}

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	function onSearchInput(value: string) {
		searchText = value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => setParams({ q: value.trim() || null }), 180);
	}

	function toggleParam(key: string) {
		setParams({ [key]: params.get(key) === '1' ? null : '1' });
	}

	function clearChip(id: string) {
		const map: Record<string, string> = {
			vegOnly: 'veg',
			ratingFourPlus: 'rating',
			fastDelivery: 'fast',
			offersOnly: 'offers',
			cuisine: 'cuisine',
			price: 'price'
		};
		setParams({ [map[id]]: null });
	}

	function clearAll() {
		searchText = '';
		void goto(page.url.pathname, { replace: true, reset: false });
	}

	/** Infinite scroll: a sentinel at the end of the list loads the next page. */
	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting) && visibleCount < hits.length) {
					visibleCount = Math.min(hits.length, visibleCount + PAGE_SIZE);
				}
			},
			{ rootMargin: '400px' }
		);
		observer.observe(node);
		return {
			destroy() {
				// Always disconnect: a leaked observer keeps the page alive after navigation.
				observer.disconnect();
			}
		};
	}

	let cuisines = $derived([...new Set(app.restaurants.flatMap((restaurant) => restaurant.cuisines))].sort());
	let filtersOpen = $state(false);
</script>

<svelte:head>
	<title>Restaurants near you · FoodRush</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-5">
	<h1 class="text-2xl font-extrabold">
		{filters.cuisine ? `${filters.cuisine} near you` : 'Restaurants near you'}
	</h1>
	<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-sm">
		{#if app.catalogStatus === 'ready'}
			{hits.length}
			{hits.length === 1 ? 'kitchen' : 'kitchens'}
			{app.location.label ? `delivering to ${app.location.label.split(',')[0]}` : 'in Bengaluru'}
		{:else}
			Loading kitchens…
		{/if}
	</p>

	<!-- search -->
	<div class="mt-4 flex gap-2">
		<div class="relative flex-1">
			<label class="sr-only" for="restaurant-search">Search restaurants and dishes</label>
			<input
				id="restaurant-search"
				class="fr-input pl-10"
				type="search"
				placeholder="Search for biryani, Dosa Darbar, pizza…"
				value={searchText}
				oninput={(event) => onSearchInput(event.currentTarget.value)}
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
		<button
			type="button"
			class="fr-btn-secondary shrink-0 sm:hidden"
			onclick={() => (filtersOpen = !filtersOpen)}
			aria-expanded={filtersOpen}
			aria-controls="filter-panel"
		>
			Filters{chips.length > 0 ? ` (${chips.length})` : ''}
		</button>
	</div>

	<!-- filters -->
	<div id="filter-panel" class="mt-3 {filtersOpen ? 'block' : 'hidden sm:block'}">
		<div class="flex flex-wrap items-center gap-2">
			<label class="sr-only" for="sort-select">Sort restaurants</label>
			<select
				id="sort-select"
				class="fr-input h-9 min-h-9 w-auto py-0 text-xs font-semibold"
				value={filters.sort}
				onchange={(event) =>
					setParams({ sort: event.currentTarget.value === 'relevance' ? null : event.currentTarget.value })}
			>
				{#each SORT_OPTIONS as option (option.key)}
					<option value={option.key}>Sort: {option.label}</option>
				{/each}
			</select>

			<button
				type="button"
				class="fr-chip"
				class:fr-chip-active={filters.vegOnly}
				aria-pressed={filters.vegOnly}
				onclick={() => toggleParam('veg')}
			>
				<span
					class="border-veg flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border-[1.5px]"
					aria-hidden="true"
				>
					<span class="bg-veg h-1.5 w-1.5 rounded-full"></span>
				</span>
				Veg only
			</button>

			<button
				type="button"
				class="fr-chip"
				class:fr-chip-active={filters.ratingFourPlus}
				aria-pressed={filters.ratingFourPlus}
				onclick={() => toggleParam('rating')}
			>
				Rating 4.0+
			</button>

			<button
				type="button"
				class="fr-chip"
				class:fr-chip-active={filters.fastDelivery}
				aria-pressed={filters.fastDelivery}
				onclick={() => toggleParam('fast')}
			>
				Fast delivery
			</button>

			<button
				type="button"
				class="fr-chip"
				class:fr-chip-active={filters.offersOnly}
				aria-pressed={filters.offersOnly}
				onclick={() => toggleParam('offers')}
			>
				Has offers
			</button>

			{#each PRICE_BANDS as band (band.id)}
				<button
					type="button"
					class="fr-chip"
					class:fr-chip-active={params.get('price') === band.id}
					aria-pressed={params.get('price') === band.id}
					onclick={() =>
						setParams({ price: params.get('price') === band.id ? null : band.id })}
				>
					{band.label}
				</button>
			{/each}

			<label class="sr-only" for="cuisine-select">Filter by cuisine</label>
			<select
				id="cuisine-select"
				class="fr-input h-9 min-h-9 w-auto py-0 text-xs font-semibold"
				value={filters.cuisine ?? ''}
				onchange={(event) => setParams({ cuisine: event.currentTarget.value || null })}
			>
				<option value="">All cuisines</option>
				{#each cuisines as cuisine (cuisine)}
					<option value={cuisine}>{cuisine}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- active chips -->
	{#if chips.length > 0 || filters.query}
		<div class="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
			{#each chips as chip (chip.id)}
				<button
					type="button"
					class="fr-chip fr-chip-active"
					onclick={() => clearChip(chip.id)}
					aria-label="Remove {chip.label} filter"
				>
					<span aria-hidden="true">{chip.label} ×</span>
				</button>
			{/each}
			{#if filters.query}
				<span class="fr-chip fr-chip-active">“{filters.query}”</span>
			{/if}
			{#if anyFilter}
				<button type="button" class="text-saffron-700 dark:text-saffron-300 cursor-pointer px-2 text-xs font-bold underline" onclick={clearAll}>
					Clear all
				</button>
			{/if}
		</div>
	{/if}

	<!-- results -->
	<div class="mt-5">
		{#if app.catalogStatus === 'error'}
			<div class="fr-card border-danger/40 p-5 text-sm" role="alert">
				<p class="font-bold">We could not load the restaurant list.</p>
				<p class="text-cocoa-600 dark:text-cocoa-200 mt-1">{app.catalogError}</p>
				<button type="button" class="fr-btn-secondary mt-3" onclick={() => app.loadCatalog()}>Try again</button>
			</div>
		{:else if app.catalogStatus !== 'ready'}
			<SkeletonCards count={9} />
		{:else if hits.length === 0}
			<EmptyState
				icon="search"
				title="No kitchens match that"
				message={filters.query
					? `We could not find anything for “${filters.query}” with these filters. Try a different dish, or loosen a filter.`
					: 'No restaurants match these filters right now. Try removing one.'}
			>
				{#snippet action()}
					<button type="button" class="fr-btn-primary" onclick={clearAll}>Clear all filters</button>
				{/snippet}
			</EmptyState>
		{:else}
			<ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each visible as hit, index (hit.restaurant.id)}
					<li>
						<RestaurantCard
							restaurant={hit.restaurant}
							matchedDishes={hit.matchedDishes}
							eager={index < 3}
						/>
					</li>
				{/each}
			</ul>

			{#if visibleCount < hits.length}
				<div use:observeSentinel class="py-6 text-center">
					<button
						type="button"
						class="fr-btn-secondary"
						onclick={() => (visibleCount = Math.min(hits.length, visibleCount + PAGE_SIZE))}
					>
						Show more kitchens ({hits.length - visibleCount} left)
					</button>
				</div>
			{:else}
				<p class="text-cocoa-500 dark:text-cocoa-300 py-6 text-center text-sm font-semibold">
					That is every kitchen we have here. Hungry for more? Try another area.
				</p>
			{/if}
		{/if}
	</div>
</div>
