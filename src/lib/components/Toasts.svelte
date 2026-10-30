<script lang="ts">
	/**
	 * Toast stack. Announced through an aria-live region so coupon removals and
	 * out-of-stock messages reach screen readers, not just sighted users.
	 */
	import { app } from '#lib/stores/app.svelte';
</script>

<div
	class="pointer-events-none fixed inset-x-0 top-2 z-50 flex flex-col items-center gap-2 px-3"
	role="status"
	aria-live="polite"
	aria-atomic="false"
>
	{#each app.toasts as toast (toast.id)}
		<div
			class="fr-rise pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg {toast.tone ===
			'warning'
				? 'bg-warn text-white'
				: toast.tone === 'success'
					? 'bg-success text-white'
					: 'bg-cocoa-900 dark:bg-cocoa-100 dark:text-cocoa-900 text-white'}"
		>
			<span class="flex-1">{toast.message}</span>
			<button
				type="button"
				class="shrink-0 cursor-pointer rounded px-1 opacity-80 hover:opacity-100"
				onclick={() => app.dismissToast(toast.id)}
				aria-label="Dismiss message"
			>
				×
			</button>
		</div>
	{/each}
</div>
