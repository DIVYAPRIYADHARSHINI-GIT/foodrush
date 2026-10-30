<script lang="ts">
	/** Skeleton grid shown while the catalog JSON is in flight. */
	interface Props {
		count?: number;
	}
	let { count = 8 }: Props = $props();
</script>

<ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
	{#each Array.from({ length: count }, (_, index) => index) as index (index)}
		<li class="fr-card overflow-hidden">
			<div class="fr-skeleton aspect-4/3 rounded-none"></div>
			<div class="space-y-2 p-3.5">
				<div class="fr-skeleton h-4 w-3/5"></div>
				<div class="fr-skeleton h-3 w-4/5"></div>
				<div class="fr-skeleton h-3 w-2/5"></div>
			</div>
		</li>
	{/each}
</ul>
