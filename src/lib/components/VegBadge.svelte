<script lang="ts">
	/**
	 * The veg / non-veg mark.
	 *
	 * In India this is a regulated food symbol: a green dot in a green square for
	 * vegetarian, a brown/red triangle in a red square for non-vegetarian. It appears on
	 * EVERY dish in the app, and its colours are fixed tokens that theming never touches.
	 * The accessible label is explicit because colour alone must not carry the meaning.
	 */
	interface Props {
		veg: boolean;
		size?: number;
	}

	let { veg, size = 16 }: Props = $props();
</script>

<span
	class="inline-flex shrink-0 items-center justify-center rounded-[3px] border-[1.5px]"
	class:border-veg={veg}
	class:border-nonveg={!veg}
	style="width: {size}px; height: {size}px"
	role="img"
	aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'}
	title={veg ? 'Vegetarian' : 'Non-vegetarian'}
>
	{#if veg}
		<span class="bg-veg block rounded-full" style="width: {size * 0.5}px; height: {size * 0.5}px"
		></span>
	{:else}
		<!-- Non-veg is a triangle, so the two marks differ in SHAPE as well as colour. -->
		<svg
			width={size * 0.6}
			height={size * 0.6}
			viewBox="0 0 10 9"
			aria-hidden="true"
			class="fill-nonveg"
		>
			<path d="M5 0 L10 9 L0 9 Z" />
		</svg>
	{/if}
</span>
