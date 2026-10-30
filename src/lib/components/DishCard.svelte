<script lang="ts">
	/**
	 * Dish row: veg/non-veg mark, tags, price, rating, description, image and the
	 * Add -> stepper control.
	 *
	 * The quantity shown comes from the store (summed across customisation lines of the
	 * same dish), so the stepper, the sticky bar and the cart page always agree. An
	 * out-of-stock dish keeps its row but loses its Add button, because silently hiding a
	 * dish the user was looking for is worse than telling them it ran out.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { formatPaise } from '#lib/logic/money';
	import { needsCustomisation } from '#lib/logic/cart';
	import type { Dish } from '#lib/types';
	import FoodImage from './FoodImage.svelte';
	import VegBadge from './VegBadge.svelte';
	import Stepper from './Stepper.svelte';

	interface Props {
		dish: Dish;
		onCustomise: (dish: Dish) => void;
		onQuickAdd: (dish: Dish) => void;
		onRepeat: (dish: Dish) => void;
	}

	let { dish, onCustomise, onQuickAdd, onRepeat }: Props = $props();

	let quantity = $derived(app.quantityOf(dish.id));
	let available = $derived(app.isAvailable(dish.id));
	let customisable = $derived(needsCustomisation(dish));
	let favourite = $derived(app.isFavouriteDish(dish.id));
	/** More than one distinct customisation of this dish is in the cart. */
	let lineCount = $derived(app.cart.lines.filter((line) => line.dishId === dish.id).length);
</script>

<article
	class="border-cocoa-200 dark:border-cocoa-800 flex gap-4 border-b py-5"
	class:fr-dimmed={!available}
>
	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-2">
			<VegBadge veg={dish.veg} />
			{#if dish.bestseller}
				<span class="text-saffron-700 dark:text-saffron-300 text-[11px] font-extrabold tracking-wide uppercase">
					★ Bestseller
				</span>
			{:else if dish.recommended}
				<span class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-bold tracking-wide uppercase">
					Recommended
				</span>
			{/if}
		</div>

		<h3 class="mt-1 text-base font-extrabold">{dish.name}</h3>

		<p class="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-bold">
			{formatPaise(dish.pricePaise)}
			{#if dish.serves > 1}
				<span class="text-cocoa-500 dark:text-cocoa-300 text-xs font-semibold">
					Serves {dish.serves}
				</span>
			{/if}
		</p>

		<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 flex items-center gap-1 text-xs font-bold">
			<svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor" class="text-rating" aria-hidden="true">
				<path d="M10 1.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L10 14.9l-5.25 2.75 1-5.85L1.5 7.65l5.9-.85z" />
			</svg>
			{dish.rating.toFixed(1)}
			<span class="font-semibold">({dish.ratingCount})</span>
		</p>

		<p class="text-cocoa-600 dark:text-cocoa-200 mt-2 text-sm">{dish.description}</p>

		<button
			type="button"
			class="text-cocoa-500 hover:text-nonveg dark:text-cocoa-300 mt-2 inline-flex min-h-9 cursor-pointer items-center gap-1.5 text-xs font-bold"
			onclick={() => app.toggleFavouriteDish(dish.id)}
			aria-pressed={favourite}
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 20 20"
				aria-hidden="true"
				class={favourite ? 'fill-nonveg stroke-nonveg' : 'fill-none stroke-current'}
				stroke-width="1.8"
			>
				<path d="M10 17s-6.5-4.2-6.5-8.4A3.6 3.6 0 0 1 10 6.2a3.6 3.6 0 0 1 6.5 2.4C16.5 12.8 10 17 10 17Z" />
			</svg>
			{favourite ? 'Saved' : 'Save dish'}
		</button>
	</div>

	<div class="w-28 shrink-0 sm:w-36">
		<div class="relative">
			<FoodImage art={dish.art} alt={dish.name} class="rounded-xl" />

			<!-- z-10: this control is pulled up over the image, so it must paint above the
			     following card's artwork or it cannot be clicked. -->
			<div class="relative z-10 -mt-5 flex justify-center px-1">
				{#if !available}
					<span
						class="bg-cocoa-200 text-cocoa-700 dark:bg-cocoa-800 dark:text-cocoa-200 inline-flex min-h-9 items-center rounded-full px-3 text-xs font-extrabold"
					>
						Out of stock
					</span>
				{:else if quantity > 0}
					<Stepper
						{quantity}
						label={dish.name}
						size="sm"
						onIncrement={() => (customisable && lineCount > 0 ? onRepeat(dish) : onQuickAdd(dish))}
						onDecrement={() => app.decrementDish(dish.id)}
					/>
				{:else}
					<button
						type="button"
						class="border-saffron-500 bg-paper text-saffron-700 hover:bg-saffron-500 dark:bg-cocoa-900 dark:text-saffron-200 min-h-10 w-26 cursor-pointer rounded-full border text-sm font-extrabold shadow-sm transition-colors hover:text-white"
						onclick={() => (customisable ? onCustomise(dish) : onQuickAdd(dish))}
						aria-label="Add {dish.name} to cart"
					>
						ADD
					</button>
				{/if}
			</div>

			{#if available && customisable}
				<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-center text-[11px] font-semibold">
					customisable
				</p>
			{/if}
		</div>
	</div>
</article>
