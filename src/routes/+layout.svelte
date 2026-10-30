<script lang="ts">
	/**
	 * App shell: header, location pill, theme toggle, mobile tab bar, sticky cart bar and
	 * the storage banner.
	 *
	 * The shell hydrates the store and loads the catalog ONCE for the whole app, so every
	 * route finds the same data already in memory and a deep link / hard refresh on any
	 * page boots identically to a click-through.
	 */
	import '../app.css';
	import { page } from '$app/state';
	import { onMount, type Snippet } from 'svelte';
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import { NAV, isActive } from '#lib/nav';
	import { formatPaise } from '#lib/logic/money';
	import { statusAt, STATUS_COPY } from '#lib/logic/orders';
	import CartBar from '#lib/components/CartBar.svelte';
	import Toasts from '#lib/components/Toasts.svelte';

	let { children }: { children: Snippet } = $props();

	let menuOpen = $state(false);

	onMount(() => {
		app.hydrate();
		void app.loadCatalog();
		// Flush any debounced write before the tab goes away, so a refresh mid-change keeps
		// the cart.
		const flush = () => app.flush();
		window.addEventListener('pagehide', flush);
		return () => {
			window.removeEventListener('pagehide', flush);
			app.stopClock();
			app.flush();
		};
	});

	// Close the overflow menu whenever the route changes.
	$effect(() => {
		void page.url.pathname;
		menuOpen = false;
	});

	let themeLabel = $derived(
		app.settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
	);

	let liveOrder = $derived(app.activeOrder);
	let liveStatus = $derived(liveOrder ? statusAt(liveOrder, app.clock) : null);

	function toggleTheme() {
		const isDark =
			app.settings.theme === 'dark' ||
			(app.settings.theme === 'system' &&
				typeof window !== 'undefined' &&
				window.matchMedia('(prefers-color-scheme: dark)').matches);
		app.setTheme(isDark ? 'light' : 'dark');
	}
</script>

<svelte:head>
	<title>FoodRush - Hungry? Order in minutes.</title>
</svelte:head>

<a class="fr-skip" href="#main">Skip to content</a>

<div class="flex min-h-full flex-col">
	<header
		class="bg-paper/95 dark:bg-cocoa-950/95 border-cocoa-200 dark:border-cocoa-800 sticky top-0 z-40 border-b backdrop-blur"
	>
		<div class="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
			<a href={href('/')} class="flex shrink-0 items-center gap-2" aria-label="FoodRush home">
				<span
					class="bg-saffron-500 flex h-9 w-9 items-center justify-center rounded-xl text-white"
					aria-hidden="true"
				>
					<svg width="22" height="22" viewBox="0 0 64 64" fill="currentColor">
						<path d="M12 32h40a20 20 0 0 1-40 0Z" />
						<rect x="8" y="27" width="48" height="5" rx="2.5" />
						<path
							d="M24 22q6-5 0-10q-6-5 0-9M40 22q6-5 0-10q-6-5 0-9"
							fill="none"
							stroke="currentColor"
							stroke-width="3.4"
							stroke-linecap="round"
						/>
					</svg>
				</span>
				<span class="hidden text-lg font-extrabold tracking-tight sm:block">FoodRush</span>
			</a>

			<!-- Location pill: the one piece of context every screen needs. -->
			<a
				href={href('/')}
				class="fr-sunk text-cocoa-700 dark:text-cocoa-200 hover:text-saffron-700 flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1.5 text-left text-xs font-semibold sm:flex-none sm:text-sm"
			>
				<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" class="shrink-0">
					<path
						d="M8 1a5 5 0 0 0-5 5c0 3.6 4.3 8.5 4.5 8.7a.7.7 0 0 0 1 0C8.7 14.5 13 9.6 13 6a5 5 0 0 0-5-5Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
					/>
				</svg>
				<span class="truncate">
					{app.location.label || 'Set delivery location'}
				</span>
			</a>

			<nav class="ml-auto hidden min-w-0 items-center gap-1 lg:flex" aria-label="Main">
				{#each NAV.filter((item) => item.route !== '/') as item (item.route)}
					<a
						href={href(item.route)}
						class="rounded-full px-3 py-2 text-sm font-semibold transition-colors {isActive(
							page.url.pathname,
							item.route
						)
							? 'bg-saffron-500/15 text-saffron-700 dark:text-saffron-200'
							: 'text-cocoa-700 hover:bg-cocoa-100 dark:text-cocoa-200 dark:hover:bg-cocoa-800'}"
						aria-current={isActive(page.url.pathname, item.route) ? 'page' : undefined}
					>
						{item.label}
						{#if item.route === '/cart' && app.cartCount > 0}
							<span
								class="bg-saffron-500 ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
							>
								{app.cartCount}
							</span>
						{/if}
					</a>
				{/each}
			</nav>

			<button
				type="button"
				class="fr-btn-ghost h-10 w-10 shrink-0 rounded-full px-0"
				onclick={toggleTheme}
				aria-label={themeLabel}
				title={themeLabel}
			>
				<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
					<path
						d="M10 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-13.5a.9.9 0 0 1 .9.9V4a.9.9 0 1 1-1.8 0V2.4a.9.9 0 0 1 .9-.9Zm0 14a.9.9 0 0 1 .9.9v1.2a.9.9 0 1 1-1.8 0v-1.2a.9.9 0 0 1 .9-.9ZM2.4 9.1h1.2a.9.9 0 1 1 0 1.8H2.4a.9.9 0 1 1 0-1.8Zm14 0h1.2a.9.9 0 1 1 0 1.8h-1.2a.9.9 0 1 1 0-1.8ZM4.2 3.9l.9.9A.9.9 0 1 1 3.8 6l-.9-.9a.9.9 0 0 1 1.3-1.2Zm10.7 10.7.9.9a.9.9 0 1 1-1.3 1.3l-.9-.9a.9.9 0 0 1 1.3-1.3ZM15.8 3.9a.9.9 0 0 1 0 1.3l-.9.9A.9.9 0 1 1 13.7 4.8l.9-.9a.9.9 0 0 1 1.2 0ZM5.1 14.6a.9.9 0 0 1 0 1.3l-.9.9A.9.9 0 1 1 2.9 15.5l.9-.9a.9.9 0 0 1 1.3 0Z"
					/>
				</svg>
			</button>

			<button
				type="button"
				class="fr-btn-ghost h-10 w-10 shrink-0 rounded-full px-0 lg:hidden"
				onclick={() => (menuOpen = !menuOpen)}
				aria-expanded={menuOpen}
				aria-controls="fr-overflow-menu"
				aria-label="More pages"
			>
				<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<circle cx="8" cy="3" r="1.6" /><circle cx="8" cy="8" r="1.6" /><circle cx="8" cy="13" r="1.6" />
				</svg>
			</button>
		</div>

		{#if menuOpen}
			<nav
				id="fr-overflow-menu"
				class="border-cocoa-200 dark:border-cocoa-800 border-t px-4 py-2 lg:hidden"
				aria-label="More"
			>
				{#each NAV.filter((item) => item.route !== '/') as item (item.route)}
					<a
						href={href(item.route)}
						class="text-cocoa-700 hover:bg-cocoa-100 dark:text-cocoa-200 dark:hover:bg-cocoa-800 block rounded-xl px-3 py-2.5 text-sm font-semibold"
					>
						{item.label}
					</a>
				{/each}
			</nav>
		{/if}
	</header>

	<!-- Storage problems are never silent: the user is told their data is not being saved. -->
	{#if app.storage.kind !== 'ok'}
		<div
			class="bg-warn/15 text-warn dark:text-warn-bright border-warn/40 border-b px-4 py-2.5 text-center text-xs font-semibold"
			role="alert"
		>
			{app.storage.message}
		</div>
	{/if}

	<!-- Live order strip, so tracking is one tap away from anywhere in the app. -->
	{#if liveOrder && liveStatus && !page.url.pathname.split('/').includes('order')}
		<a
			href={href(`/order?id=${liveOrder.id}`)}
			class="bg-success/12 text-success dark:text-success-bright hover:bg-success/20 flex items-center justify-center gap-2 px-4 py-2 text-center text-xs font-bold transition-colors"
		>
			<span class="bg-success-bright h-2 w-2 animate-pulse rounded-full" aria-hidden="true"></span>
			{STATUS_COPY[liveStatus].title} · {liveOrder.restaurantName} · Track order
		</a>
	{/if}

	<main id="main" class="flex-1 pb-28 sm:pb-20">
		{@render children()}
	</main>

	<footer
		class="border-cocoa-200 dark:border-cocoa-800 text-cocoa-500 dark:text-cocoa-300 mt-auto hidden border-t px-4 py-6 text-center text-xs sm:block"
	>
		<p class="font-semibold">FoodRush · Hungry? Order in minutes.</p>
		<p class="mt-1">
			Demo app. Restaurants, dishes, riders and payments are simulated - no real orders are
			placed and no money changes hands.
		</p>
	</footer>

	<!-- Mobile tab bar: thumb-reachable, 5 destinations, always visible. -->
	<nav
		class="bg-paper/97 dark:bg-cocoa-950/97 border-cocoa-200 dark:border-cocoa-800 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
		aria-label="Primary"
	>
		<ul class="grid grid-cols-5">
			{#each NAV.filter((item) => item.mobile) as item (item.route)}
				{@const active = isActive(page.url.pathname, item.route)}
				<li>
					<a
						href={href(item.route)}
						class="relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-bold {active
							? 'text-saffron-600 dark:text-saffron-300'
							: 'text-cocoa-500 dark:text-cocoa-300'}"
						aria-current={active ? 'page' : undefined}
					>
						{item.label}
						{#if item.route === '/cart' && app.cartCount > 0}
							<span
								class="bg-saffron-500 absolute top-1.5 right-1/4 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] text-white"
								aria-hidden="true"
							>
								{app.cartCount}
							</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<CartBar />
	<Toasts />
</div>
