<script lang="ts">
	/**
	 * Sticky cart bar.
	 *
	 * Reads the item count and the grand total straight from the store's single pricing
	 * result, so it can never disagree with the cart page. It hides itself on the cart and
	 * checkout routes (where it would duplicate the real bill) and sits above the mobile
	 * tab bar.
	 */
	import { page } from '$app/state';
	import { app } from '#lib/stores/app.svelte';
	import { formatPaise } from '#lib/logic/money';
	import { href } from '#lib/paths';

	let hiddenHere = $derived(
		['cart', 'checkout', 'order'].some((segment) => page.url.pathname.split('/').includes(segment))
	);
	let visible = $derived(app.cartCount > 0 && !hiddenHere);
</script>

{#if visible}
	<div
		class="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
	>
		<a
			href={href('/cart')}
			class="bg-saffron-500 hover:bg-saffron-600 pointer-events-auto fr-rise mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-2xl px-4 py-3 text-white shadow-lg transition-colors"
		>
			<span class="min-w-0">
				<span class="block text-xs font-semibold opacity-90">
					{app.cartCount}
					{app.cartCount === 1 ? 'item' : 'items'}
					{#if app.cartRestaurant}
						· <span class="truncate">{app.cartRestaurant.name}</span>
					{/if}
				</span>
				<span class="block text-base font-extrabold">{formatPaise(app.price.totalPaise)}</span>
			</span>
			<span class="flex shrink-0 items-center gap-1.5 text-sm font-extrabold">
				View cart
				<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
					<path d="M5.5 2.5L11 8l-5.5 5.5-1.4-1.4L8.2 8 4.1 3.9z" />
				</svg>
			</span>
		</a>
	</div>
{/if}
