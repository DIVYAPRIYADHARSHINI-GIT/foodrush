<script lang="ts">
	/**
	 * Star display and star input.
	 *
	 * As an input it is a real radiogroup: arrow keys move between stars, the current value
	 * is announced, and it works without a mouse. As a display it is a single labelled
	 * image, so a screen reader hears "4.4 out of 5" rather than five separate stars.
	 */
	interface Props {
		value: number;
		interactive?: boolean;
		label?: string;
		size?: number;
		onChange?: (value: number) => void;
	}

	let { value, interactive = false, label = 'Rating', size = 20, onChange }: Props = $props();

	const STARS = [1, 2, 3, 4, 5];

	function pick(next: number) {
		onChange?.(next);
	}

	function onKeydown(event: KeyboardEvent) {
		if (!interactive) return;
		const delta =
			event.key === 'ArrowRight' || event.key === 'ArrowUp'
				? 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowDown'
					? -1
					: 0;
		if (delta === 0) return;
		event.preventDefault();
		pick(Math.min(5, Math.max(1, Math.round(value) + delta)));
	}
</script>

{#snippet star(filled: number)}
	<!-- `filled` is 0..1 so a 4.4 average can show a partial star. -->
	<svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" class="shrink-0">
		<defs>
			<linearGradient id="fr-star-{filled}-{size}">
				<stop offset="{filled * 100}%" stop-color="currentColor" />
				<stop offset="{filled * 100}%" stop-color="transparent" />
			</linearGradient>
		</defs>
		<path
			d="M10 1.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L10 14.9l-5.25 2.75 1-5.85L1.5 7.65l5.9-.85z"
			fill="url(#fr-star-{filled}-{size})"
			stroke="currentColor"
			stroke-width="1.2"
			stroke-linejoin="round"
		/>
	</svg>
{/snippet}

{#if interactive}
	<div
		role="radiogroup"
		aria-label={label}
		class="text-saffron-500 inline-flex items-center gap-1"
		onkeydown={onKeydown}
		tabindex={-1}
	>
		{#each STARS as position (position)}
			<button
				type="button"
				role="radio"
				aria-checked={Math.round(value) === position}
				aria-label="{position} star{position === 1 ? '' : 's'}"
				tabindex={Math.round(value) === position || (value === 0 && position === 1) ? 0 : -1}
				class="flex h-11 w-9 cursor-pointer items-center justify-center rounded-lg"
				onclick={() => pick(position)}
			>
				{@render star(position <= Math.round(value) ? 1 : 0)}
			</button>
		{/each}
	</div>
{:else}
	<span
		class="text-saffron-500 inline-flex items-center gap-0.5"
		role="img"
		aria-label="{value.toFixed(1)} out of 5"
	>
		{#each STARS as position (position)}
			{@render star(Math.min(1, Math.max(0, value - (position - 1))))}
		{/each}
	</span>
{/if}
