import { describe, expect, it } from 'vitest';
import {
	cartCount,
	defaultSelection,
	describeOptions,
	groupedOptions,
	lineIdFor,
	needsCustomisation,
	validateOptions
} from './cart';
import type { Dish, OptionGroup, SelectedOption } from '../types';

function group(overrides: Partial<OptionGroup> = {}): OptionGroup {
	return {
		id: 'size',
		name: 'Choose size',
		required: true,
		min: 1,
		max: 1,
		choices: [
			{ id: 'regular', name: 'Regular', deltaPaise: 0 },
			{ id: 'large', name: 'Large', deltaPaise: 7000 }
		],
		...overrides
	};
}

function dish(overrides: Partial<Dish> = {}): Dish {
	return {
		id: 'napoli-nook--margherita-classic',
		restaurantId: 'napoli-nook',
		name: 'Margherita Classic',
		description: 'San Marzano sauce and basil',
		category: 'Veg Pizzas',
		pricePaise: 25900,
		veg: true,
		bestseller: true,
		recommended: true,
		rating: 4.5,
		ratingCount: 220,
		serves: 1,
		art: 'pizza',
		optionGroups: [],
		available: true,
		...overrides
	};
}

function option(groupId: string, choiceId: string, deltaPaise = 0): SelectedOption {
	return { groupId, groupName: groupId, choiceId, choiceName: choiceId, deltaPaise };
}

describe('lineIdFor', () => {
	it('is stable for the same dish and options', () => {
		const a = lineIdFor('dish-1', [option('size', 'large', 7000)], '');
		const b = lineIdFor('dish-1', [option('size', 'large', 7000)], '');
		expect(a).toBe(b);
	});

	it('ignores the order options were picked in', () => {
		const a = lineIdFor('dish-1', [option('size', 'large'), option('addons', 'cheese')], '');
		const b = lineIdFor('dish-1', [option('addons', 'cheese'), option('size', 'large')], '');
		expect(a).toBe(b);
	});

	it('treats different option sets as different lines', () => {
		const plain = lineIdFor('dish-1', [], '');
		const withCheese = lineIdFor('dish-1', [option('addons', 'cheese')], '');
		expect(plain).not.toBe(withCheese);
	});

	it('treats different dishes as different lines', () => {
		expect(lineIdFor('dish-1', [], '')).not.toBe(lineIdFor('dish-2', [], ''));
	});

	it('separates lines by special instructions but normalises whitespace and case', () => {
		expect(lineIdFor('d', [], 'No onion')).not.toBe(lineIdFor('d', [], ''));
		expect(lineIdFor('d', [], 'No onion')).toBe(lineIdFor('d', [], '  no   ONION '));
	});

	it('survives emojis and special characters in instructions', () => {
		const id = lineIdFor('d', [], 'extra spicy 🌶️ & no "dahi"');
		expect(id.startsWith('d~')).toBe(true);
		expect(id).toBe(lineIdFor('d', [], 'extra spicy 🌶️ & no "dahi"'));
	});
});

describe('validateOptions', () => {
	it('accepts a valid single-pick selection', () => {
		const result = validateOptions(dish({ optionGroups: [group()] }), { size: ['large'] });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.options).toEqual([
				{ groupId: 'size', groupName: 'Choose size', choiceId: 'large', choiceName: 'Large', deltaPaise: 7000 }
			]);
		}
	});

	it('rejects a missing required group with a per-group message', () => {
		const result = validateOptions(dish({ optionGroups: [group()] }), { size: [] });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.size).toBe('Choose size to continue.');
	});

	it('rejects more choices than the group allows', () => {
		const addons = group({
			id: 'addons',
			name: 'Add-ons',
			required: false,
			min: 0,
			max: 2,
			choices: [
				{ id: 'a', name: 'A', deltaPaise: 100 },
				{ id: 'b', name: 'B', deltaPaise: 100 },
				{ id: 'c', name: 'C', deltaPaise: 100 }
			]
		});
		const result = validateOptions(dish({ optionGroups: [addons] }), { addons: ['a', 'b', 'c'] });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.addons).toBe('Pick at most 2.');
	});

	it('allows an empty optional group', () => {
		const addons = group({ id: 'addons', required: false, min: 0, max: 3 });
		const result = validateOptions(dish({ optionGroups: [addons] }), { addons: [] });
		expect(result.ok).toBe(true);
	});

	it('ignores choice ids that are not in the group', () => {
		const result = validateOptions(dish({ optionGroups: [group()] }), { size: ['regular', 'ghost'] });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.options.map((o) => o.choiceId)).toEqual(['regular']);
	});

	it('validates several groups at once and reports every failure', () => {
		const size = group();
		const crust = group({ id: 'crust', name: 'Pick a crust' });
		const result = validateOptions(dish({ optionGroups: [size, crust] }), { size: [], crust: [] });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['crust', 'size']);
	});

	it('accepts a dish with no option groups', () => {
		expect(validateOptions(dish(), {}).ok).toBe(true);
	});
});

describe('defaultSelection', () => {
	it('pre-selects the first choice of a required single-pick group', () => {
		const selection = defaultSelection(dish({ optionGroups: [group()] }));
		expect(selection.size).toEqual(['regular']);
	});

	it('leaves optional groups empty', () => {
		const addons = group({ id: 'addons', required: false, min: 0, max: 3 });
		expect(defaultSelection(dish({ optionGroups: [addons] })).addons).toEqual([]);
	});

	it('produces a selection that passes validation immediately', () => {
		const d = dish({ optionGroups: [group(), group({ id: 'crust', name: 'Crust' })] });
		expect(validateOptions(d, defaultSelection(d)).ok).toBe(true);
	});

	it('leaves a required multi-pick group empty so the user must choose', () => {
		const pickTwo = group({ id: 'pick2', required: true, min: 2, max: 3 });
		const d = dish({ optionGroups: [pickTwo] });
		expect(defaultSelection(d).pick2).toEqual([]);
		expect(validateOptions(d, defaultSelection(d)).ok).toBe(false);
	});
});

describe('needsCustomisation', () => {
	it('is true only when the dish has option groups', () => {
		expect(needsCustomisation(dish())).toBe(false);
		expect(needsCustomisation(dish({ optionGroups: [group()] }))).toBe(true);
	});
});

describe('option display helpers', () => {
	it('summarises options on one line', () => {
		const options = [option('size', 'Large'), option('addons', 'Extra cheese')];
		expect(describeOptions({ options })).toBe('Large · Extra cheese');
	});

	it('groups options by their group name', () => {
		const options: SelectedOption[] = [
			{ groupId: 'size', groupName: 'Choose size', choiceId: 'l', choiceName: 'Large', deltaPaise: 0 },
			{ groupId: 'addons', groupName: 'Add-ons', choiceId: 'c', choiceName: 'Cheese', deltaPaise: 0 },
			{ groupId: 'addons', groupName: 'Add-ons', choiceId: 'o', choiceName: 'Olives', deltaPaise: 0 }
		];
		expect(groupedOptions({ options })).toEqual([
			{ name: 'Choose size', values: ['Large'] },
			{ name: 'Add-ons', values: ['Cheese', 'Olives'] }
		]);
	});
});

describe('cartCount', () => {
	it('sums quantities and ignores negatives', () => {
		expect(
			cartCount([
				{ quantity: 2 } as never,
				{ quantity: 3 } as never,
				{ quantity: -1 } as never
			])
		).toBe(5);
	});
});
