<script lang="ts">
	/**
	 * Quantity stepper. The "Add" button turns into this once an item is in the cart.
	 *
	 * Both controls stay at 44px for thumbs, the count is announced politely so screen
	 * readers hear the change, and the maximum is enforced here as well as in the store -
	 * the UI must not offer a 21st dosa that the store would silently clamp.
	 */
	import { MAX_LINE_QUANTITY } from '#lib/logic/pricing';

	interface Props {
		quantity: number;
		label: string;
		onIncrement: () => void;
		onDecrement: () => void;
		max?: number;
		size?: 'sm' | 'md';
	}

	let {
		quantity,
		label,
		onIncrement,
		onDecrement,
		max = MAX_LINE_QUANTITY,
		size = 'md'
	}: Props = $props();

	let atMax = $derived(quantity >= max);
</script>

<div
	class="border-saffron-500 bg-saffron-500/10 inline-flex items-center justify-between gap-1 rounded-full border font-bold {size ===
	'sm'
		? 'h-10 w-26'
		: 'h-11 w-30'}"
>
	<button
		type="button"
		class="text-saffron-700 dark:text-saffron-200 hover:bg-saffron-500/20 flex h-full w-10 cursor-pointer items-center justify-center rounded-l-full text-lg"
		onclick={onDecrement}
		aria-label="Decrease {label} quantity"
		title={quantity === 1 ? `Removes ${label} from your cart` : undefined}
	>
		−
	</button>
	<span
		class="text-saffron-700 dark:text-saffron-100 min-w-6 text-center text-sm tabular-nums"
		aria-live="polite"
		aria-atomic="true"
	>
		<span class="sr-only">{label} quantity:</span>{quantity}
	</span>
	<button
		type="button"
		class="text-saffron-700 dark:text-saffron-200 hover:bg-saffron-500/20 flex h-full w-10 cursor-pointer items-center justify-center rounded-r-full text-lg disabled:cursor-not-allowed disabled:opacity-40"
		onclick={onIncrement}
		disabled={atMax}
		aria-label={atMax ? `Maximum ${max} per item` : `Increase ${label} quantity`}
		title={atMax ? `You can order at most ${max} of one item` : undefined}
	>
		+
	</button>
</div>
