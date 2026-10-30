<script lang="ts">
	/**
	 * Accessible modal dialog, used for customisation, replace-cart, address forms and
	 * cancellation.
	 *
	 * Built on the native <dialog> element so the browser provides the top layer, the
	 * backdrop and Escape-to-close, with an explicit focus trap for Tab/Shift+Tab and focus
	 * restoration to the element that opened it. On phones it docks to the bottom as a
	 * sheet, which is where thumbs are.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		title: string;
		description?: string;
		onClose: () => void;
		children: Snippet;
		footer?: Snippet;
		/** Bottom-sheet on mobile (default) or a centred box at all widths. */
		variant?: 'sheet' | 'centred';
	}

	let { open, title, description, onClose, children, footer, variant = 'sheet' }: Props = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let opener: HTMLElement | null = null;

	$effect(() => {
		const node = dialog;
		if (!node) return;
		if (open && !node.open) {
			opener = document.activeElement as HTMLElement | null;
			node.showModal();
			// Focus the first control inside, not the dialog itself, so screen readers
			// announce the heading and land somewhere useful.
			queueMicrotask(() => {
				const target = node.querySelector<HTMLElement>(
					'[data-autofocus], button:not([disabled]), input:not([disabled]), select, textarea, a[href]'
				);
				target?.focus();
			});
		} else if (!open && node.open) {
			node.close();
			opener?.focus();
			opener = null;
		}
	});

	function trapTab(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !dialog) return;
		const focusable = [
			...dialog.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		].filter((element) => element.offsetParent !== null || element === document.activeElement);
		if (focusable.length === 0) return;

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="bg-paper text-cocoa-900 dark:bg-cocoa-900 dark:text-cocoa-50 m-0 w-full max-w-lg p-0 backdrop:bg-black/55 {variant ===
	'sheet'
		? 'mt-auto mb-0 rounded-t-3xl sm:m-auto sm:rounded-3xl'
		: 'm-auto rounded-3xl'}"
	aria-labelledby="fr-dialog-title"
	aria-describedby={description ? 'fr-dialog-description' : undefined}
	onclose={onClose}
	onkeydown={trapTab}
	oncancel={(event) => {
		// Let the parent own `open` instead of the browser closing behind its back.
		event.preventDefault();
		onClose();
	}}
>
	{#if open}
		<div class="flex max-h-[85vh] flex-col sm:max-h-[80vh]">
			<header
				class="border-cocoa-200 dark:border-cocoa-800 flex items-start justify-between gap-4 border-b px-5 py-4"
			>
				<div>
					<h2 id="fr-dialog-title" class="text-lg font-extrabold">{title}</h2>
					{#if description}
						<p id="fr-dialog-description" class="text-cocoa-600 dark:text-cocoa-200 mt-0.5 text-sm">
							{description}
						</p>
					{/if}
				</div>
				<button
					type="button"
					class="fr-btn-ghost -mt-1 -mr-2 h-11 w-11 rounded-full px-0 text-xl"
					onclick={onClose}
					aria-label="Close dialog"
				>
					×
				</button>
			</header>

			<div class="flex-1 overflow-y-auto px-5 py-4">
				{@render children()}
			</div>

			{#if footer}
				<footer
					class="border-cocoa-200 dark:border-cocoa-800 bg-paper dark:bg-cocoa-900 border-t px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
				>
					{@render footer()}
				</footer>
			{/if}
		</div>
	{/if}
</dialog>
