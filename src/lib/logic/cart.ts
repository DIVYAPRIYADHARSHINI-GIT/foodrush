/**
 * Cart line identity and option validation.
 *
 * LINE IDENTITY: two cart lines are the same line only if they are the same dish WITH the
 * same options and the same special instructions. "Masala Dosa, extra sambar" and "Masala
 * Dosa, no add-ons" are two lines, and adding the second must not bump the first's
 * quantity. The identity is a deterministic hash of (dishId, sorted options, instructions)
 * so it survives a page refresh and a reorder.
 */

import type { CartLine, Dish, OptionGroup, SelectedOption } from '../types';

/** Stable ordering so {A,B} and {B,A} hash identically. */
function optionKey(options: SelectedOption[]): string {
	return options
		.map((option) => `${option.groupId}:${option.choiceId}`)
		.sort()
		.join('|');
}

/**
 * Deterministic line id.
 *
 * Instructions are part of the identity but are normalised (trimmed, collapsed whitespace,
 * lowercased) so "No onion" and "no  onion " merge instead of creating two lines.
 */
export function lineIdFor(dishId: string, options: SelectedOption[], instructions: string): string {
	const normalised = instructions.trim().replace(/\s+/g, ' ').toLowerCase();
	const signature = `${dishId}#${optionKey(options)}#${normalised}`;
	// FNV-1a: tiny, dependency-free, and stable across engines.
	let hash = 0x811c9dc5;
	for (let i = 0; i < signature.length; i += 1) {
		hash ^= signature.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${dishId}~${hash.toString(36)}`;
}

export type OptionValidation =
	| { ok: true; options: SelectedOption[] }
	| { ok: false; errors: Record<string, string> };

/**
 * Validate a selection map (groupId -> choiceIds) against a dish's option groups.
 *
 * Required groups must hit their `min`, and no group may exceed its `max`. Errors are
 * keyed by group id so the dialog can mark the offending group rather than showing one
 * generic message at the bottom.
 */
export function validateOptions(dish: Dish, selection: Record<string, string[]>): OptionValidation {
	const errors: Record<string, string> = {};
	const options: SelectedOption[] = [];

	for (const group of dish.optionGroups) {
		const chosen = selection[group.id] ?? [];
		const valid = chosen.filter((choiceId) => group.choices.some((choice) => choice.id === choiceId));

		if (group.required && valid.length < Math.max(1, group.min)) {
			// Group names are written as instructions ("Choose size", "Pick a crust"), so the
			// message reuses the name verbatim rather than building "Pick a choose size."
			errors[group.id] =
				group.max === 1
					? `${group.name} to continue.`
					: `Pick at least ${Math.max(1, group.min)} from ${group.name}.`;
			continue;
		}
		if (valid.length > group.max) {
			errors[group.id] = `Pick at most ${group.max}.`;
			continue;
		}
		for (const choiceId of valid) {
			const choice = group.choices.find((entry) => entry.id === choiceId);
			if (!choice) continue;
			options.push({
				groupId: group.id,
				groupName: group.name,
				choiceId: choice.id,
				choiceName: choice.name,
				deltaPaise: choice.deltaPaise
			});
		}
	}

	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, options };
}

/** Default selection: pre-selects the first choice of every single-pick required group. */
export function defaultSelection(dish: Dish): Record<string, string[]> {
	const selection: Record<string, string[]> = {};
	for (const group of dish.optionGroups) {
		if (group.required && group.max === 1 && group.choices[0]) {
			selection[group.id] = [group.choices[0].id];
		} else {
			selection[group.id] = [];
		}
	}
	return selection;
}

/** True when a dish can be added straight from the card without opening the dialog. */
export function needsCustomisation(dish: Dish): boolean {
	return dish.optionGroups.length > 0;
}

/** One-line summary of a line's options, e.g. "Large - Cheese burst - Extra mozzarella". */
export function describeOptions(line: Pick<CartLine, 'options'>): string {
	return line.options.map((option) => option.choiceName).join(' · ');
}

/** Group options by their group name, for the cart's expanded customisation list. */
export function groupedOptions(line: Pick<CartLine, 'options'>): { name: string; values: string[] }[] {
	const map = new Map<string, string[]>();
	for (const option of line.options) {
		const existing = map.get(option.groupName) ?? [];
		existing.push(option.choiceName);
		map.set(option.groupName, existing);
	}
	return [...map.entries()].map(([name, values]) => ({ name, values }));
}

/** Total items in the cart (sum of quantities), for the sticky bar and the header badge. */
export function cartCount(lines: CartLine[]): number {
	return lines.reduce((sum, line) => sum + Math.max(0, line.quantity), 0);
}

/** Pick the option groups a dish actually needs, guarding malformed catalog rows. */
export function usableGroups(dish: Dish): OptionGroup[] {
	return dish.optionGroups.filter((group) => Array.isArray(group.choices) && group.choices.length > 0);
}
