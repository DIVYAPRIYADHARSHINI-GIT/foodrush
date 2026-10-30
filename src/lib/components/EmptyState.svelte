<script lang="ts">
	/**
	 * Friendly empty state with an illustration, a line of microcopy and an action.
	 * Used for an empty cart, no search results, no favourites, no orders.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		message: string;
		/** 'plate' | 'search' | 'bag' | 'heart' */
		icon?: 'plate' | 'search' | 'bag' | 'heart';
		action?: Snippet;
	}

	let { title, message, icon = 'plate', action }: Props = $props();
</script>

<div class="flex flex-col items-center px-6 py-14 text-center">
	<div
		class="bg-saffron-500/12 text-saffron-600 dark:text-saffron-300 mb-4 flex h-20 w-20 items-center justify-center rounded-full"
		aria-hidden="true"
	>
		{#if icon === 'search'}
			<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="10.5" cy="10.5" r="6.5" />
				<path d="M15.5 15.5 21 21" stroke-linecap="round" />
			</svg>
		{:else if icon === 'bag'}
			<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M4 8h16l-1.3 12H5.3z" stroke-linejoin="round" />
				<path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2" stroke-linecap="round" />
			</svg>
		{:else if icon === 'heart'}
			<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 20s-7.5-4.9-7.5-9.8A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.8C19.5 15.1 12 20 12 20Z" stroke-linejoin="round" />
			</svg>
		{:else}
			<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="8" />
				<circle cx="12" cy="12" r="3.2" />
			</svg>
		{/if}
	</div>
	<h2 class="text-lg font-extrabold">{title}</h2>
	<p class="text-cocoa-600 dark:text-cocoa-200 mt-1.5 max-w-sm text-sm">{message}</p>
	{#if action}
		<div class="mt-5">{@render action()}</div>
	{/if}
</div>
