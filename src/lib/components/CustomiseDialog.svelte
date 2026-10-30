<script lang="ts">
	/**
	 * Customisation dialog: size, add-ons, spice level and special instructions, with a
	 * live price and required-option validation.
	 *
	 * The running price comes from the SAME `unitPrice` the cart and the bill use, so the
	 * "Add item · ₹x" button can never promise a different number than the cart charges.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { defaultSelection, validateOptions } from '#lib/logic/cart';
	import { unitPrice, MAX_LINE_QUANTITY } from '#lib/logic/pricing';
	import { formatPaise } from '#lib/logic/money';
	import type { Dish } from '#lib/types';
	import Dialog from './Dialog.svelte';
	import VegBadge from './VegBadge.svelte';
	import FoodImage from './FoodImage.svelte';

	interface Props {
		dish: Dish | null;
		onClose: () => void;
		/** Called with the validated options; the parent owns the replace-cart decision. */
		onAdd: (dish: Dish, options: ReturnType<typeof validateOptions>, instructions: string, quantity: number) => void;
	}

	let { dish, onClose, onAdd }: Props = $props();

	let selection = $state<Record<string, string[]>>({});
	let instructions = $state('');
	let quantity = $state(1);
	let showErrors = $state(false);

	// Reset the form whenever a different dish opens the dialog.
	$effect(() => {
		if (!dish) return;
		selection = defaultSelection(dish);
		instructions = '';
		quantity = 1;
		showErrors = false;
	});

	let validation = $derived(dish ? validateOptions(dish, selection) : null);
	let errors = $derived(validation && !validation.ok ? validation.errors : {});
	let chosenOptions = $derived(validation?.ok ? validation.options : []);

	// Live price: base + every selected delta, times quantity.
	let unit = $derived(
		dish ? unitPrice({ basePricePaise: dish.pricePaise, options: chosenOptions }) : 0
	);
	let total = $derived(unit * quantity);

	function toggleChoice(groupId: string, choiceId: string, single: boolean, max: number) {
		const current = selection[groupId] ?? [];
		if (single) {
			selection = { ...selection, [groupId]: [choiceId] };
			return;
		}
		if (current.includes(choiceId)) {
			selection = { ...selection, [groupId]: current.filter((id) => id !== choiceId) };
		} else if (current.length < max) {
			selection = { ...selection, [groupId]: [...current, choiceId] };
		}
	}

	function submit() {
		if (!dish || !validation) return;
		if (!validation.ok) {
			showErrors = true;
			// Move focus to the first group that failed so keyboard users land on it.
			const firstBadGroup = Object.keys(validation.errors)[0];
			document.getElementById(`group-${firstBadGroup}`)?.scrollIntoView({ block: 'center' });
			return;
		}
		onAdd(dish, validation, instructions, quantity);
	}
</script>

<Dialog
	open={Boolean(dish)}
	title={dish?.name ?? ''}
	description={dish ? `${dish.serves > 1 ? `Serves ${dish.serves}` : 'Serves 1'} · customise before adding` : undefined}
	{onClose}
>
	{#if dish}
		<div class="flex gap-3">
			<FoodImage art={dish.art} alt={dish.name} class="w-28 shrink-0 rounded-xl" />
			<div class="min-w-0">
				<p class="flex items-center gap-1.5 text-sm font-bold">
					<VegBadge veg={dish.veg} />
					{formatPaise(dish.pricePaise)}
				</p>
				<p class="text-cocoa-600 dark:text-cocoa-200 mt-1 text-xs">{dish.description}</p>
			</div>
		</div>

		{#each dish.optionGroups as group (group.id)}
			{@const single = group.max === 1}
			<fieldset id="group-{group.id}" class="border-cocoa-200 dark:border-cocoa-800 mt-5 border-t pt-4">
				<legend class="flex items-center gap-2 text-sm font-extrabold">
					{group.name}
					{#if group.required}
						<span class="text-nonveg dark:text-danger-bright text-[11px] font-bold tracking-wide uppercase">
							Required
						</span>
					{:else}
						<span class="text-cocoa-500 dark:text-cocoa-300 text-[11px] font-semibold">
							Optional · up to {group.max}
						</span>
					{/if}
				</legend>

				<div class="mt-2 space-y-1" role={single ? 'radiogroup' : 'group'} aria-label={group.name}>
					{#each group.choices as choice (choice.id)}
						{@const checked = (selection[group.id] ?? []).includes(choice.id)}
						{@const atMax = !single && !checked && (selection[group.id] ?? []).length >= group.max}
						<label
							class="hover:bg-cocoa-100 dark:hover:bg-cocoa-800 flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-1.5 {atMax
								? 'opacity-45'
								: ''}"
						>
							<span class="flex items-center gap-2.5 text-sm">
								<input
									type={single ? 'radio' : 'checkbox'}
									name="group-{group.id}"
									class="accent-saffron-500 h-4.5 w-4.5"
									{checked}
									disabled={atMax}
									onchange={() => toggleChoice(group.id, choice.id, single, group.max)}
								/>
								{choice.name}
							</span>
							<span class="text-cocoa-600 dark:text-cocoa-200 shrink-0 text-xs font-bold">
								{choice.deltaPaise === 0 ? '—' : `+ ${formatPaise(choice.deltaPaise)}`}
							</span>
						</label>
					{/each}
				</div>

				{#if showErrors && errors[group.id]}
					<p class="fr-error" role="alert">{errors[group.id]}</p>
				{/if}
			</fieldset>
		{/each}

		<div class="border-cocoa-200 dark:border-cocoa-800 mt-5 border-t pt-4">
			<label class="fr-label" for="dish-instructions">
				Any special instructions?
				<span class="text-cocoa-500 dark:text-cocoa-300 font-normal">(optional)</span>
			</label>
			<textarea
				id="dish-instructions"
				class="fr-input min-h-20 py-2"
				maxlength="180"
				placeholder="Less oil, no onion, extra curry leaves…"
				bind:value={instructions}
			></textarea>
			<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-right text-xs">
				{instructions.length}/180
			</p>
			<p class="text-cocoa-500 dark:text-cocoa-300 text-xs">
				The restaurant will try, but cannot always promise.
			</p>
		</div>
	{/if}

	{#snippet footer()}
		{#if dish}
			<div class="flex items-center gap-3">
				<div
					class="border-cocoa-300 dark:border-cocoa-700 flex h-11 shrink-0 items-center rounded-full border font-bold"
				>
					<button
						type="button"
						class="flex h-full w-10 cursor-pointer items-center justify-center rounded-l-full text-lg disabled:opacity-40"
						onclick={() => (quantity = Math.max(1, quantity - 1))}
						disabled={quantity <= 1}
						aria-label="Decrease quantity"
					>
						−
					</button>
					<span class="min-w-6 text-center text-sm tabular-nums" aria-live="polite">{quantity}</span>
					<button
						type="button"
						class="flex h-full w-10 cursor-pointer items-center justify-center rounded-r-full text-lg disabled:opacity-40"
						onclick={() => (quantity = Math.min(MAX_LINE_QUANTITY, quantity + 1))}
						disabled={quantity >= MAX_LINE_QUANTITY}
						aria-label="Increase quantity"
					>
						+
					</button>
				</div>
				<button type="button" class="fr-btn-primary flex-1" onclick={submit} data-autofocus>
					Add item · {formatPaise(total)}
				</button>
			</div>
		{/if}
	{/snippet}
</Dialog>
