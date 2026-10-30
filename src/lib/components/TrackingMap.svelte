<script lang="ts">
	/**
	 * Illustrated delivery route with a moving rider marker.
	 *
	 * Deliberately NOT a real map: a demo app has no business loading a tile provider, and
	 * an illustrated route is honest about being simulated. The rider position is derived
	 * from the order's elapsed-time progress, so it resumes correctly after a refresh and
	 * moves in step with the status timeline.
	 */
	interface Props {
		/** 0..1 along the route. */
		progress: number;
		restaurantName: string;
		addressLabel: string;
		riderName: string;
		/** Hide the rider until it has actually been picked up. */
		riderActive: boolean;
	}

	let { progress, restaurantName, addressLabel, riderName, riderActive }: Props = $props();

	// The route is a fixed cubic curve; the marker rides it by de Casteljau subdivision so
	// the marker is always exactly on the drawn line.
	const P0 = { x: 42, y: 150 };
	const P1 = { x: 130, y: 30 };
	const P2 = { x: 250, y: 190 };
	const P3 = { x: 338, y: 60 };

	// Clamp so a progress of 0 parks the marker at the restaurant, never off-canvas.
	let t = $derived(Math.min(1, Math.max(0, progress)));

	let point = $derived.by(() => {
		const u = 1 - t;
		return {
			x: u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x,
			y: u * u * u * P0.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y
		};
	});

	const PATH = `M ${P0.x} ${P0.y} C ${P1.x} ${P1.y}, ${P2.x} ${P2.y}, ${P3.x} ${P3.y}`;
</script>

<figure class="fr-card overflow-hidden">
	<svg
		viewBox="0 0 380 210"
		class="bg-paper-sunk dark:bg-cocoa-900 h-auto w-full"
		role="img"
		aria-label="Illustrated map: {riderActive
			? `${riderName} is ${Math.round(t * 100)} percent of the way from ${restaurantName} to ${addressLabel}`
			: `Route from ${restaurantName} to ${addressLabel}`}"
	>
		<!-- Street grid, purely decorative. -->
		<g stroke="currentColor" class="text-cocoa-300 dark:text-cocoa-700" stroke-width="7" opacity="0.5">
			<path d="M-10 70 H 390" /><path d="M-10 140 H 390" />
			<path d="M90 -10 V 220" /><path d="M200 -10 V 220" /><path d="M300 -10 V 220" />
		</g>
		<g class="text-cocoa-200 dark:text-cocoa-800" fill="currentColor" opacity="0.75">
			<rect x="18" y="16" width="52" height="38" rx="5" />
			<rect x="118" y="90" width="60" height="34" rx="5" />
			<rect x="228" y="12" width="48" height="40" rx="5" />
			<rect x="236" y="152" width="58" height="42" rx="5" />
			<rect x="26" y="168" width="44" height="30" rx="5" />
		</g>

		<!-- Route: dashed remainder, solid travelled part. -->
		<path d={PATH} fill="none" stroke="currentColor" class="text-cocoa-400 dark:text-cocoa-600" stroke-width="4" stroke-dasharray="9 8" stroke-linecap="round" />
		<path
			d={PATH}
			fill="none"
			stroke="currentColor"
			class="text-saffron-500"
			stroke-width="4"
			stroke-linecap="round"
			pathLength="1"
			stroke-dasharray="1"
			stroke-dashoffset={1 - t}
		/>

		<!-- Restaurant pin -->
		<g transform="translate({P0.x} {P0.y})">
			<circle r="11" class="fill-cocoa-800 dark:fill-cocoa-100" />
			<path d="M-4 -2 h8 a4 4 0 0 1 -8 0 Z M-5 -3.2 h10 v1.4 h-10 Z" class="fill-paper dark:fill-cocoa-900" />
		</g>

		<!-- Home pin -->
		<g transform="translate({P3.x} {P3.y})">
			<circle r="11" class="fill-success" />
			<path d="M0 -5.5 L5.5 0 H3.2 V5 H-3.2 V0 H-5.5 Z" fill="white" />
		</g>

		{#if riderActive}
			<!-- Rider marker -->
			<g transform="translate({point.x} {point.y})">
				<circle r="15" class="fill-saffron-500/25" />
				<circle r="10" class="fill-saffron-500" />
				<path
					d="M-4.5 2.5 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0 M1.2 2.5 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0 M-2.3 2.5 h3.5 l1.6 -4.2 h-2.2 M1.5 -1.7 h2.2"
					fill="none"
					stroke="white"
					stroke-width="1.3"
					stroke-linecap="round"
				/>
			</g>
		{/if}
	</svg>

	<figcaption class="text-cocoa-600 dark:text-cocoa-200 flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs font-semibold">
		<span class="truncate">{restaurantName}</span>
		<span class="text-cocoa-400" aria-hidden="true">······</span>
		<span class="truncate">{addressLabel}</span>
	</figcaption>
</figure>
