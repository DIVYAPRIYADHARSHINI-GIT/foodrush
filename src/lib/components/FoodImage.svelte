<script lang="ts">
	/**
	 * Food image with a guaranteed box and a real fallback.
	 *
	 * The brief: "broken or slow images need a fallback placeholder and fixed dimensions so
	 * the layout never jumps". This component always renders an element of the exact aspect
	 * ratio, shows a shimmer until the image decodes, and swaps to the generic plate
	 * illustration on error - so a 404 or a slow network can never collapse a card.
	 */
	import { dishArt, fallbackArt } from '#lib/paths';

	interface Props {
		art: string | null | undefined;
		alt: string;
		/** Tailwind aspect ratio class; dish art is 4:3, hero art is 16:9. */
		ratio?: string;
		class?: string;
		eager?: boolean;
	}

	let { art, alt, ratio = 'aspect-4/3', class: className = '', eager = false }: Props = $props();

	let loaded = $state(false);
	let failed = $state(false);

	// A new dish in the same slot (e.g. filtering a list) must re-show the shimmer.
	let source = $derived(failed ? fallbackArt() : dishArt(art));
	$effect(() => {
		// Reset load state whenever the requested art changes.
		void art;
		loaded = false;
		failed = false;
	});
</script>

<div class="fr-sunk relative overflow-hidden {ratio} {className}">
	{#if !loaded}
		<div class="fr-skeleton absolute inset-0 rounded-none" aria-hidden="true"></div>
	{/if}
	<img
		src={source}
		{alt}
		width="480"
		height="360"
		loading={eager ? 'eager' : 'lazy'}
		decoding="async"
		class="h-full w-full object-cover transition-opacity duration-300"
		class:opacity-0={!loaded}
		onload={() => (loaded = true)}
		onerror={() => {
			// Fall back once; if the fallback itself fails we still keep the sized box.
			if (!failed) failed = true;
			loaded = true;
		}}
	/>
</div>
