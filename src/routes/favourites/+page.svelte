<script lang="ts">
	/** Favourite restaurants and dishes, both read straight from the store. */
	import { app } from '#lib/stores/app.svelte';
	import { href } from '#lib/paths';
	import { formatPaise } from '#lib/logic/money';
	import RestaurantCard from '#lib/components/RestaurantCard.svelte';
	import FoodImage from '#lib/components/FoodImage.svelte';
	import VegBadge from '#lib/components/VegBadge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';

	let restaurants = $derived(
		app.favourites.restaurants
			.map((id) => app.restaurant(id))
			.filter((restaurant): restaurant is NonNullable<typeof restaurant> => Boolean(restaurant))
	);

	let dishes = $derived(
		app.favourites.dishes
			.map((id) => app.dish(id))
			.filter((dish): dish is NonNullable<typeof dish> => Boolean(dish))
	);

	let empty = $derived(restaurants.length === 0 && dishes.length === 0);
</script>

<svelte:head>
	<title>Favourites · FoodRush</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-5">
	<h1 class="text-2xl font-extrabold">Favourites</h1>

	{#if app.catalogStatus !== 'ready'}
		<p class="text-cocoa-600 dark:text-cocoa-200 mt-2 text-sm">Loading your saved places…</p>
	{:else if empty}
		<EmptyState
			icon="heart"
			title="Nothing saved yet"
			message="Tap the heart on any restaurant or dish and it lands here, ready for the next time you cannot decide."
		>
			{#snippet action()}
				<a href={href('/restaurants')} class="fr-btn-primary">Find something to love</a>
			{/snippet}
		</EmptyState>
	{:else}
		{#if restaurants.length > 0}
			<section class="mt-5" aria-labelledby="fav-restaurants-heading">
				<h2 id="fav-restaurants-heading" class="text-lg font-extrabold">
					Saved restaurants ({restaurants.length})
				</h2>
				<ul class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each restaurants as restaurant (restaurant.id)}
						<li><RestaurantCard {restaurant} /></li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if dishes.length > 0}
			<section class="mt-8" aria-labelledby="fav-dishes-heading">
				<h2 id="fav-dishes-heading" class="text-lg font-extrabold">
					Saved dishes ({dishes.length})
				</h2>
				<ul class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
					{#each dishes as dish (dish.id)}
						{@const restaurant = app.restaurant(dish.restaurantId)}
						<li class="fr-card flex gap-3 p-3">
							<FoodImage art={dish.art} alt={dish.name} class="w-20 shrink-0 rounded-lg" />
							<div class="min-w-0 flex-1">
								<p class="flex items-center gap-2">
									<VegBadge veg={dish.veg} size={14} />
									<span class="truncate text-sm font-extrabold">{dish.name}</span>
								</p>
								{#if restaurant}
									<a
										href={href(`/restaurant?id=${restaurant.id}`)}
										class="text-saffron-700 dark:text-saffron-300 mt-0.5 block truncate text-xs font-bold"
									>
										{restaurant.name}
									</a>
								{/if}
								<p class="mt-1 text-sm font-bold">{formatPaise(dish.pricePaise)}</p>
								{#if !app.isAvailable(dish.id)}
									<p class="text-danger dark:text-danger-bright text-xs font-bold">Out of stock</p>
								{/if}
								<button
									type="button"
									class="text-cocoa-500 hover:text-danger dark:text-cocoa-300 mt-1 min-h-9 cursor-pointer text-xs font-bold"
									onclick={() => app.toggleFavouriteDish(dish.id)}
								>
									Remove
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>
