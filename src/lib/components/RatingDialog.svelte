<script lang="ts">
	/**
	 * Post-delivery rating: separate food and delivery stars, quick tags and a written
	 * review. Submitting writes to the store, which immediately moves the restaurant's
	 * average on its menu page - no refresh, no second source of truth.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { REVIEW_TAGS } from '#lib/logic/orders';
	import type { Order } from '#lib/types';
	import Dialog from './Dialog.svelte';
	import Stars from './Stars.svelte';

	interface Props {
		order: Order | null;
		onClose: () => void;
		onSubmitted?: () => void;
	}

	let { order, onClose, onSubmitted }: Props = $props();

	let foodRating = $state(0);
	let deliveryRating = $state(0);
	let tags = $state<string[]>([]);
	let text = $state('');
	let attempted = $state(false);

	// Reset when a different order opens the dialog, and prefill an existing review so
	// re-rating shows what was said last time instead of a blank form.
	$effect(() => {
		if (!order) return;
		const existing = app.reviewForOrder(order.id);
		foodRating = existing?.foodRating ?? 0;
		deliveryRating = existing?.deliveryRating ?? 0;
		tags = existing ? [...existing.tags] : [];
		text = existing?.text ?? '';
		attempted = false;
	});

	let valid = $derived(foodRating >= 1 && deliveryRating >= 1);

	function toggleTag(tag: string) {
		tags = tags.includes(tag) ? tags.filter((entry) => entry !== tag) : [...tags, tag];
	}

	function submit() {
		attempted = true;
		if (!order || !valid) return;
		app.addReview({
			orderId: order.id,
			restaurantId: order.restaurantId,
			foodRating,
			deliveryRating,
			tags: [...tags],
			text: text.trim()
		});
		app.toast('Thanks! Your rating is live on the restaurant page.', 'success');
		onSubmitted?.();
		onClose();
	}
</script>

<Dialog
	open={Boolean(order)}
	title="How was your order?"
	description={order ? `${order.restaurantName} · ${order.lines.length} item${order.lines.length === 1 ? '' : 's'}` : undefined}
	{onClose}
>
	{#if order}
		<div class="space-y-5">
			<div>
				<p class="fr-label mb-1">Food quality</p>
				<Stars value={foodRating} interactive label="Rate the food" size={28} onChange={(value) => (foodRating = value)} />
				{#if attempted && foodRating < 1}
					<p class="fr-error" role="alert">Give the food at least one star.</p>
				{/if}
			</div>

			<div>
				<p class="fr-label mb-1">Delivery experience</p>
				<Stars
					value={deliveryRating}
					interactive
					label="Rate the delivery"
					size={28}
					onChange={(value) => (deliveryRating = value)}
				/>
				{#if attempted && deliveryRating < 1}
					<p class="fr-error" role="alert">Rate the delivery too.</p>
				{/if}
			</div>

			<div>
				<p class="fr-label mb-1.5">What stood out?</p>
				<div class="flex flex-wrap gap-2" role="group" aria-label="Review tags">
					{#each REVIEW_TAGS as tag (tag)}
						<button
							type="button"
							class="fr-chip"
							class:fr-chip-active={tags.includes(tag)}
							aria-pressed={tags.includes(tag)}
							onclick={() => toggleTag(tag)}
						>
							{tag}
						</button>
					{/each}
				</div>
			</div>

			<div>
				<label class="fr-label" for="review-text">
					Tell us more <span class="text-cocoa-500 font-normal">(optional)</span>
				</label>
				<textarea
					id="review-text"
					class="fr-input min-h-24 py-2"
					maxlength="400"
					placeholder="The biryani was properly dum-cooked and still hot…"
					bind:value={text}
				></textarea>
				<p class="text-cocoa-500 dark:text-cocoa-300 mt-1 text-right text-xs">{text.length}/400</p>
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<div class="flex gap-3">
			<button type="button" class="fr-btn-secondary flex-1" onclick={onClose}>Maybe later</button>
			<button type="button" class="fr-btn-primary flex-1" onclick={submit} data-autofocus>
				Submit rating
			</button>
		</div>
	{/snippet}
</Dialog>
