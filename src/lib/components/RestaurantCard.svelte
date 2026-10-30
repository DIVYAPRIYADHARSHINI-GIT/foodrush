<script lang="ts">
	/**
	 * Restaurant card: image, name, cuisines, rating, delivery time, price for two, offer
	 * tag, favourite toggle and the "Closed now" state.
	 *
	 * The whole card is one link (so keyboard users tab once, not four times), with the
	 * favourite button layered above it as a separate control.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { formatPaise } from '#lib/logic/money';
	import { isOpenAt, minutesOfDay } from '#lib/logic/catalog';
	import { href } from '#lib/paths';
	import type { Dish, Restaurant } from '#lib/types';
	import FoodImage from './FoodImage.svelte';

	interface Props {
		restaurant: Restaurant;
		matchedDishes?: Dish[];
		eager?: boolean;
	}

	let { restaurant, matchedDishes = [], eager = false }: Props = $props();

	// Minutes come from the shared clock so a card flips to "Closed now" on its own.
	let open = $derived(isOpenAt(restaurant, minutesOfDay(new Date(app.clock))));
	let rating = $derived(app.ratingFor(restaurant.id));
	let offers = $derived(app.offersFor(restaurant.id));
	let favourite = $derived(app.isFavouriteRestaurant(restaurant.id));
</script>

<article class="fr-card group relative overflow-hidden">
	<a href={href(`/restaurant?id=${restaurant.id}`)} class="block focus-visible:outline-offset-[-2px]">
		<div class="relative">
			<FoodImage art={restaurant.art} alt="{restaurant.name} - {restaurant.cuisines.join(', ')}" {eager} />
			{#if !open}
				<div
					class="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-extrabold text-white"
				>
					<span class="rounded-full bg-black/55 px-3 py-1.5">Closed now · opens {Math.floor(restaurant.hours.open / 60)}:{String(restaurant.hours.open % 60).padStart(2, '0')}</span>
				</div>
			{/if}
			{#if offers.length > 0 && open}
				<span
					class="bg-saffron-600 absolute bottom-0 left-0 rounded-tr-xl px-2.5 py-1 text-xs font-extrabold text-white"
				>
					{offers[0].kind === 'free-delivery' ? 'FREE DELIVERY' : offers[0].title.toUpperCase()}
				</span>
			{/if}
		</div>

		<div class="p-3.5">
			<div class="flex items-start justify-between gap-2">
				<h3 class="min-w-0 flex-1 truncate text-base font-extrabold" title={restaurant.name}>
					{restaurant.name}
				</h3>
				<span class="fr-rating shrink-0" aria-label="Rated {rating.average} out of 5">
					{rating.average.toFixed(1)}
					<svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path d="M10 1.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L10 14.9l-5.25 2.75 1-5.85L1.5 7.65l5.9-.85z" />
					</svg>
				</span>
			</div>

			<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 truncate text-sm">
				{restaurant.cuisines.join(', ')}
			</p>

			<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 flex flex-wrap items-center gap-x-2 text-xs font-semibold">
				<span>{restaurant.deliveryMinutes} min</span>
				<span aria-hidden="true">·</span>
				<span>{formatPaise(restaurant.priceForTwoPaise)} for two</span>
				<span aria-hidden="true">·</span>
				<span>{restaurant.area}</span>
				{#if restaurant.pureVeg}
					<span class="text-veg-ink dark:text-success-bright">· Pure veg</span>
				{/if}
			</p>

			{#if matchedDishes.length > 0}
				<p class="text-saffron-700 dark:text-saffron-300 mt-2 truncate text-xs font-semibold">
					Serves: {matchedDishes
						.slice(0, 3)
						.map((dish) => dish.name)
						.join(', ')}
				</p>
			{/if}
		</div>
	</a>

	<button
		type="button"
		class="absolute top-2 right-2 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/90 shadow-sm transition-colors dark:bg-cocoa-900/90"
		onclick={() => app.toggleFavouriteRestaurant(restaurant.id)}
		aria-pressed={favourite}
		aria-label={favourite ? `Remove ${restaurant.name} from favourites` : `Save ${restaurant.name} to favourites`}
	>
		<svg
			width="18"
			height="18"
			viewBox="0 0 20 20"
			aria-hidden="true"
			class={favourite ? 'fill-nonveg' : 'fill-none stroke-cocoa-500 dark:stroke-cocoa-300'}
			stroke-width="1.8"
		>
			<path
				d="M10 17s-6.5-4.2-6.5-8.4A3.6 3.6 0 0 1 10 6.2a3.6 3.6 0 0 1 6.5 2.4C16.5 12.8 10 17 10 17Z"
			/>
		</svg>
	</button>
</article>
