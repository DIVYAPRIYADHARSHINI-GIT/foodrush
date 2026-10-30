<script lang="ts">
	/**
	 * Address form, used for both add and edit.
	 *
	 * Validation runs on submit AND re-runs per field once that field has been touched, so
	 * the user is not shouted at while typing but does get immediate confirmation once they
	 * fix something. Pin code and phone use the Indian-format validators from logic/orders.
	 */
	import { validateAddress } from '#lib/logic/orders';
	import type { Address, AddressLabel } from '#lib/types';

	interface Props {
		initial?: Partial<Address>;
		submitLabel?: string;
		onSubmit: (address: Omit<Address, 'id'>) => void;
		onCancel: () => void;
	}

	let { initial = {}, submitLabel = 'Save address', onSubmit, onCancel }: Props = $props();

	const LABELS: AddressLabel[] = ['Home', 'Work', 'Other'];

	/**
	 * The form is seeded FROM the `initial` prop and re-seeded whenever the parent swaps in a
	 * different address. Reading a prop directly inside `$state({...})` would capture only its
	 * first value, so editing address A then B without unmounting would show A's data - hence
	 * the explicit effect below rather than an inline initialiser.
	 */
	function seed(source: Partial<Address>) {
		return {
			label: (source.label ?? 'Home') as AddressLabel,
			name: source.name ?? '',
			phone: source.phone ?? '',
			line1: source.line1 ?? '',
			line2: source.line2 ?? '',
			area: source.area ?? '',
			city: source.city ?? 'Bengaluru',
			pin: source.pin ?? '',
			landmark: source.landmark ?? '',
			instructions: source.instructions ?? '',
			isDefault: source.isDefault ?? false
		};
	}

	// Capturing the initial value here is deliberate - the effect below re-seeds the form
	// when the parent swaps in a different address - so the "initial value only" hint is
	// suppressed rather than worked around with a derived (a derived cannot be edited).
	// svelte-ignore state_referenced_locally
	let form = $state(seed(initial));
	// svelte-ignore state_referenced_locally
	let seededFor = $state(initial.id ?? '__new__');

	$effect(() => {
		const key = initial.id ?? '__new__';
		if (key === seededFor) return;
		form = seed(initial);
		seededFor = key;
		touched = {};
		submitted = false;
	});

	let touched = $state<Record<string, boolean>>({});
	let submitted = $state(false);

	let errors = $derived(validateAddress(form));
	let showError = (field: keyof Address) => (submitted || touched[field]) && errors[field];

	function submit(event: SubmitEvent) {
		event.preventDefault();
		submitted = true;
		if (Object.keys(errors).length > 0) {
			const firstField = Object.keys(errors)[0];
			document.getElementById(`addr-${firstField}`)?.focus();
			return;
		}
		onSubmit({ ...form });
	}
</script>

<form onsubmit={submit} novalidate>
	<fieldset>
		<legend class="fr-label">Save as</legend>
		<div class="flex gap-2" role="group" aria-label="Address label">
			{#each LABELS as label (label)}
				<button
					type="button"
					class="fr-chip"
					class:fr-chip-active={form.label === label}
					aria-pressed={form.label === label}
					onclick={() => (form.label = label)}
				>
					{label}
				</button>
			{/each}
		</div>
	</fieldset>

	<div class="mt-4 grid gap-3 sm:grid-cols-2">
		<div>
			<label class="fr-label" for="addr-name">Receiver's name</label>
			<input
				id="addr-name"
				class="fr-input"
				bind:value={form.name}
				onblur={() => (touched.name = true)}
				autocomplete="name"
				aria-invalid={Boolean(showError('name'))}
				aria-describedby={showError('name') ? 'addr-name-error' : undefined}
				data-autofocus
			/>
			{#if showError('name')}
				<p class="fr-error" id="addr-name-error">{errors.name}</p>
			{/if}
		</div>

		<div>
			<label class="fr-label" for="addr-phone">Mobile number</label>
			<input
				id="addr-phone"
				class="fr-input"
				type="tel"
				inputmode="tel"
				placeholder="98450 12345"
				bind:value={form.phone}
				onblur={() => (touched.phone = true)}
				autocomplete="tel-national"
				aria-invalid={Boolean(showError('phone'))}
				aria-describedby={showError('phone') ? 'addr-phone-error' : undefined}
			/>
			{#if showError('phone')}
				<p class="fr-error" id="addr-phone-error">{errors.phone}</p>
			{/if}
		</div>
	</div>

	<div class="mt-3">
		<label class="fr-label" for="addr-line1">Flat / house no. / building</label>
		<input
			id="addr-line1"
			class="fr-input"
			bind:value={form.line1}
			onblur={() => (touched.line1 = true)}
			autocomplete="address-line1"
			aria-invalid={Boolean(showError('line1'))}
			aria-describedby={showError('line1') ? 'addr-line1-error' : undefined}
		/>
		{#if showError('line1')}
			<p class="fr-error" id="addr-line1-error">{errors.line1}</p>
		{/if}
	</div>

	<div class="mt-3">
		<label class="fr-label" for="addr-line2">
			Street / sector <span class="text-cocoa-500 font-normal">(optional)</span>
		</label>
		<input id="addr-line2" class="fr-input" bind:value={form.line2} autocomplete="address-line2" />
	</div>

	<div class="mt-3 grid gap-3 sm:grid-cols-3">
		<div>
			<label class="fr-label" for="addr-area">Area / locality</label>
			<input
				id="addr-area"
				class="fr-input"
				bind:value={form.area}
				onblur={() => (touched.area = true)}
				aria-invalid={Boolean(showError('area'))}
				aria-describedby={showError('area') ? 'addr-area-error' : undefined}
			/>
			{#if showError('area')}
				<p class="fr-error" id="addr-area-error">{errors.area}</p>
			{/if}
		</div>

		<div>
			<label class="fr-label" for="addr-city">City</label>
			<input
				id="addr-city"
				class="fr-input"
				bind:value={form.city}
				onblur={() => (touched.city = true)}
				autocomplete="address-level2"
				aria-invalid={Boolean(showError('city'))}
				aria-describedby={showError('city') ? 'addr-city-error' : undefined}
			/>
			{#if showError('city')}
				<p class="fr-error" id="addr-city-error">{errors.city}</p>
			{/if}
		</div>

		<div>
			<label class="fr-label" for="addr-pin">Pin code</label>
			<input
				id="addr-pin"
				class="fr-input"
				inputmode="numeric"
				maxlength="6"
				placeholder="560034"
				bind:value={form.pin}
				onblur={() => (touched.pin = true)}
				autocomplete="postal-code"
				aria-invalid={Boolean(showError('pin'))}
				aria-describedby={showError('pin') ? 'addr-pin-error' : undefined}
			/>
			{#if showError('pin')}
				<p class="fr-error" id="addr-pin-error">{errors.pin}</p>
			{/if}
		</div>
	</div>

	<div class="mt-3">
		<label class="fr-label" for="addr-landmark">
			Landmark <span class="text-cocoa-500 font-normal">(optional)</span>
		</label>
		<input
			id="addr-landmark"
			class="fr-input"
			placeholder="Opposite the bakery, next to the park gate"
			bind:value={form.landmark}
		/>
	</div>

	<div class="mt-3">
		<label class="fr-label" for="addr-instructions">
			Directions for the rider <span class="text-cocoa-500 font-normal">(optional)</span>
		</label>
		<input
			id="addr-instructions"
			class="fr-input"
			placeholder="Call on arrival, gate code 4421, 2nd floor"
			bind:value={form.instructions}
		/>
	</div>

	<label class="mt-4 flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-semibold">
		<input type="checkbox" class="accent-saffron-500 h-4.5 w-4.5" bind:checked={form.isDefault} />
		Make this my default delivery address
	</label>

	<div class="mt-5 flex gap-3">
		<button type="button" class="fr-btn-secondary flex-1" onclick={onCancel}>Cancel</button>
		<button type="submit" class="fr-btn-primary flex-1">{submitLabel}</button>
	</div>
</form>
