/**
 * Builds the FoodRush catalog into `static/data/` as REAL JSON files.
 *
 * Why a generator and not hand-written JSON: the catalog has to be internally consistent
 * (every dish belongs to a category its restaurant actually lists, every bestseller has a
 * rating, every price is an integer number of paise, every id is unique and stable). A
 * deterministic script is the only way to keep ~30 restaurants x 8-14 dishes honest, and
 * re-running it must produce byte-identical output so the tests and screenshots do not
 * drift.
 *
 * MONEY: every price in the catalog is an integer number of PAISE. There is no float
 * rupee value anywhere in the data or the app - see src/lib/logic/money.ts.
 *
 * Restaurant and dish names are fictional but written the way real neighbourhood
 * restaurants in Indian cities name themselves. No lorem ipsum, no real brand names.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'static', 'data');

/** Deterministic PRNG (mulberry32) - same catalog on every machine, every run. */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const rand = rng(20260429);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
/** Round a paise amount to the nearest rupee so menu prices read like real menus. */
const rupees = (n) => Math.round(n) * 100;

// ---------------------------------------------------------------------------
// Option groups. Attached per dish category so a dosa gets spice level and a
// pizza gets a size + crust, rather than every dish getting the same dialog.
// `required: true` groups with min 1 are what the required-option validation tests.
// ---------------------------------------------------------------------------

const OPTION_LIBRARY = {
	size2: {
		id: 'size',
		name: 'Choose size',
		required: true,
		min: 1,
		max: 1,
		choices: [
			{ id: 'regular', name: 'Regular', deltaPaise: 0 },
			{ id: 'large', name: 'Large', deltaPaise: 7000 }
		]
	},
	pizzaSize: {
		id: 'size',
		name: 'Choose size',
		required: true,
		min: 1,
		max: 1,
		choices: [
			{ id: 'small', name: 'Small 7"', deltaPaise: 0 },
			{ id: 'medium', name: 'Medium 10"', deltaPaise: 12000 },
			{ id: 'large', name: 'Large 13"', deltaPaise: 24000 }
		]
	},
	crust: {
		id: 'crust',
		name: 'Pick a crust',
		required: true,
		min: 1,
		max: 1,
		choices: [
			{ id: 'classic', name: 'Classic hand-tossed', deltaPaise: 0 },
			{ id: 'thin', name: 'Thin & crispy', deltaPaise: 0 },
			{ id: 'cheeseburst', name: 'Cheese burst', deltaPaise: 9000 }
		]
	},
	spice: {
		id: 'spice',
		name: 'Spice level',
		required: true,
		min: 1,
		max: 1,
		choices: [
			{ id: 'mild', name: 'Mild', deltaPaise: 0 },
			{ id: 'medium', name: 'Medium', deltaPaise: 0 },
			{ id: 'spicy', name: 'Spicy', deltaPaise: 0 },
			{ id: 'extra', name: 'Extra spicy (chef dares you)', deltaPaise: 0 }
		]
	},
	riceQty: {
		id: 'portion',
		name: 'Portion',
		required: true,
		min: 1,
		max: 1,
		choices: [
			{ id: 'single', name: 'Single (serves 1)', deltaPaise: 0 },
			{ id: 'family', name: 'Family pack (serves 3)', deltaPaise: 42000 }
		]
	},
	southAddons: {
		id: 'addons',
		name: 'Add-ons',
		required: false,
		min: 0,
		max: 4,
		choices: [
			{ id: 'extra-sambar', name: 'Extra sambar bowl', deltaPaise: 3000 },
			{ id: 'extra-chutney', name: 'Extra coconut chutney', deltaPaise: 2500 },
			{ id: 'ghee', name: 'Ghee roast finish', deltaPaise: 4000 },
			{ id: 'podi', name: 'Idli podi + gingelly oil', deltaPaise: 3500 }
		]
	},
	northAddons: {
		id: 'addons',
		name: 'Add-ons',
		required: false,
		min: 0,
		max: 4,
		choices: [
			{ id: 'butter-naan', name: 'Butter naan', deltaPaise: 5500 },
			{ id: 'jeera-rice', name: 'Jeera rice', deltaPaise: 9000 },
			{ id: 'extra-gravy', name: 'Extra gravy', deltaPaise: 6000 },
			{ id: 'salad', name: 'Green salad + onion', deltaPaise: 4000 }
		]
	},
	biryaniAddons: {
		id: 'addons',
		name: 'Add-ons',
		required: false,
		min: 0,
		max: 4,
		choices: [
			{ id: 'raita', name: 'Boondi raita', deltaPaise: 3500 },
			{ id: 'mirchi', name: 'Mirchi ka salan', deltaPaise: 4500 },
			{ id: 'extra-egg', name: 'Extra boiled egg', deltaPaise: 2500 },
			{ id: 'gulab', name: 'Gulab jamun (2 pc)', deltaPaise: 6000 }
		]
	},
	pizzaAddons: {
		id: 'addons',
		name: 'Extra toppings',
		required: false,
		min: 0,
		max: 5,
		choices: [
			{ id: 'cheese', name: 'Extra mozzarella', deltaPaise: 7000 },
			{ id: 'paneer', name: 'Tandoori paneer', deltaPaise: 8000 },
			{ id: 'jalapeno', name: 'Jalapenos', deltaPaise: 4000 },
			{ id: 'olives', name: 'Black olives', deltaPaise: 4500 },
			{ id: 'corn', name: 'Sweet corn', deltaPaise: 3500 }
		]
	},
	burgerAddons: {
		id: 'addons',
		name: 'Make it yours',
		required: false,
		min: 0,
		max: 4,
		choices: [
			{ id: 'cheese-slice', name: 'Extra cheese slice', deltaPaise: 3000 },
			{ id: 'patty', name: 'Double the patty', deltaPaise: 9000 },
			{ id: 'fries', name: 'Peri peri fries', deltaPaise: 8000 },
			{ id: 'coke', name: 'Chilled cola 300ml', deltaPaise: 5000 }
		]
	},
	chineseAddons: {
		id: 'addons',
		name: 'Add-ons',
		required: false,
		min: 0,
		max: 3,
		choices: [
			{ id: 'schezwan', name: 'Schezwan chutney pot', deltaPaise: 2500 },
			{ id: 'extra-veg', name: 'Extra veggies', deltaPaise: 4000 },
			{ id: 'soup', name: 'Cup of hot & sour soup', deltaPaise: 7000 }
		]
	},
	sweetQty: {
		id: 'pack',
		name: 'Pack size',
		required: true,
		min: 1,
		max: 1,
		choices: [
			{ id: 'two', name: '2 pieces', deltaPaise: 0 },
			{ id: 'four', name: '4 pieces', deltaPaise: 9000 },
			{ id: 'box', name: 'Box of 8', deltaPaise: 21000 }
		]
	},
	sugar: {
		id: 'sugar',
		name: 'Sugar',
		required: true,
		min: 1,
		max: 1,
		choices: [
			{ id: 'normal', name: 'Normal sugar', deltaPaise: 0 },
			{ id: 'less', name: 'Less sugar', deltaPaise: 0 },
			{ id: 'none', name: 'No sugar', deltaPaise: 0 }
		]
	},
	bowlAddons: {
		id: 'addons',
		name: 'Boost it',
		required: false,
		min: 0,
		max: 4,
		choices: [
			{ id: 'grilled-chicken', name: 'Grilled chicken 100g', deltaPaise: 11000 },
			{ id: 'tofu', name: 'Peri tofu 100g', deltaPaise: 9000 },
			{ id: 'avocado', name: 'Avocado slices', deltaPaise: 12000 },
			{ id: 'seeds', name: 'Seed & nut mix', deltaPaise: 5000 }
		]
	}
};

// ---------------------------------------------------------------------------
// Dish pools per cuisine. Real dishes, real menu-board descriptions, prices in
// rupees as they would appear in a mid-range Bengaluru restaurant in 2026.
// `base` is the rupee price; the restaurant's `priceIndex` scales it.
// ---------------------------------------------------------------------------

const POOLS = {
	'South Indian': {
		categories: ['Tiffin Specials', 'Dosa Counter', 'Rice Plates', 'Filter Coffee & More'],
		dishes: [
			['Ghee Podi Idli', 'Tiffin Specials', 129, true, 'Two steamed idlis tossed in idli podi and hot ghee, with coconut chutney.', ['southAddons']],
			['Idli Vada Combo', 'Tiffin Specials', 149, true, 'Two soft idlis and one crisp medu vada with sambar and two chutneys.', ['southAddons']],
			['Medu Vada (2 pc)', 'Tiffin Specials', 119, true, 'Crunchy outside, fluffy inside, soaked in piping sambar if you ask nicely.', ['southAddons']],
			['Rava Kesari Bath', 'Tiffin Specials', 99, true, 'Saffron semolina halwa with cashews and a generous spoon of ghee.', []],
			['Masala Dosa', 'Dosa Counter', 149, true, 'Crisp rice crepe folded over spiced potato masala, served with sambar.', ['southAddons', 'spice']],
			['Butter Mysore Masala Dosa', 'Dosa Counter', 189, true, 'Red chutney smeared dosa, loaded with butter and potato palya.', ['southAddons', 'spice']],
			['Paper Roast Dosa', 'Dosa Counter', 169, true, 'Two feet of paper-thin dosa. Yes, it will hang off the plate.', ['southAddons']],
			['Podi Ghee Uttapam', 'Dosa Counter', 159, true, 'Thick onion uttapam topped with gunpowder and ghee.', ['southAddons']],
			['Set Dosa with Saagu', 'Dosa Counter', 139, true, 'Three spongy set dosas with vegetable saagu and chutney.', ['southAddons']],
			['Bisi Bele Bath', 'Rice Plates', 169, true, 'Karnataka classic of rice, lentils and tamarind spice, with boondi on top.', ['spice']],
			['Curd Rice with Pickle', 'Rice Plates', 119, true, 'Cooling curd rice tempered with mustard, curry leaf and pomegranate.', []],
			['Andhra Veg Meals', 'Rice Plates', 219, true, 'Rice, three curries, rasam, sambar, pappu, curd and sweet of the day.', ['spice']],
			['Chettinad Chicken Curry', 'Rice Plates', 289, false, 'Peppery Chettinad masala, slow-cooked bone-in chicken, appam on the side.', ['spice']],
			['Filter Coffee', 'Filter Coffee & More', 59, true, 'Strong decoction and boiled milk, pulled high into a steel tumbler.', ['sugar']],
			['Masala Chai', 'Filter Coffee & More', 49, true, 'Ginger-cardamom chai brewed the long way.', ['sugar']]
		]
	},
	'North Indian': {
		categories: ['Starters', 'Main Course', 'Breads', 'Rice & Dal'],
		dishes: [
			['Paneer Tikka', 'Starters', 279, true, 'Charred cottage cheese cubes in hung-curd marinade, with pudina chutney.', ['spice']],
			['Tandoori Chicken (Half)', 'Starters', 329, false, 'Clay-oven chicken rubbed with kashmiri chilli and crushed garlic.', ['spice']],
			['Hara Bhara Kebab', 'Starters', 229, true, 'Spinach, peas and paneer patties, shallow-fried and served with chutney.', []],
			['Amritsari Fish Fry', 'Starters', 349, false, 'Ajwain-batter basa, fried crisp, finished with chaat masala and lime.', ['spice']],
			['Paneer Butter Masala', 'Main Course', 299, true, 'Tomato-cashew gravy, kasuri methi and a float of white butter.', ['northAddons', 'spice']],
			['Dal Makhani', 'Main Course', 259, true, 'Black urad dal simmered overnight with butter and cream.', ['northAddons']],
			['Kadai Mushroom', 'Main Course', 269, true, 'Button mushrooms tossed with bell peppers and freshly pounded kadai masala.', ['northAddons', 'spice']],
			['Butter Chicken', 'Main Course', 349, false, 'The one everybody orders. Tandoori chicken in silky makhani gravy.', ['northAddons', 'spice']],
			['Mutton Rogan Josh', 'Main Course', 429, false, 'Kashmiri-style mutton in a deep red ratan jot and fennel gravy.', ['northAddons', 'spice']],
			['Chole Bhature', 'Main Course', 199, true, 'Two balloon bhaturas with spiced chickpeas, onion and achar.', ['spice']],
			['Butter Naan', 'Breads', 69, true, 'Tandoor-fresh naan brushed with butter.', []],
			['Laccha Paratha', 'Breads', 79, true, 'Flaky layered whole-wheat paratha from the tandoor.', []],
			['Tandoori Roti (2 pc)', 'Breads', 59, true, 'Whole-wheat rotis straight off the clay wall.', []],
			['Jeera Rice', 'Rice & Dal', 149, true, 'Basmati tossed with cumin and ghee.', []],
			['Dal Tadka', 'Rice & Dal', 219, true, 'Yellow dal with a smoking garlic-chilli tempering poured at the table.', ['northAddons']]
		]
	},
	Chinese: {
		categories: ['Soups', 'Starters', 'Noodles & Rice', 'Main Course'],
		dishes: [
			['Hot & Sour Soup', 'Soups', 139, true, 'Peppery, vinegary, full of shredded veg. Comes with crispy noodles.', ['spice']],
			['Chicken Sweetcorn Soup', 'Soups', 159, false, 'Creamed corn and shredded chicken, finished with white pepper.', []],
			['Veg Manchurian Dry', 'Starters', 219, true, 'Cabbage-carrot dumplings wok-tossed in garlic, soy and green chilli.', ['chineseAddons', 'spice']],
			['Chilli Paneer Dry', 'Starters', 259, true, 'Crisp paneer, onion petals and capsicum in a sticky chilli glaze.', ['chineseAddons', 'spice']],
			['Chicken Lollipop (6 pc)', 'Starters', 289, false, 'Frenched wings in a red chilli batter, with schezwan dip.', ['spice']],
			['Crispy Corn Salt & Pepper', 'Starters', 199, true, 'Golden corn kernels tossed with spring onion, pepper and curry leaf.', ['chineseAddons']],
			['Veg Hakka Noodles', 'Noodles & Rice', 199, true, 'High-flame wok noodles with julienned vegetables.', ['chineseAddons', 'spice']],
			['Schezwan Chicken Noodles', 'Noodles & Rice', 249, false, 'Noodles fired up with house schezwan chutney and shredded chicken.', ['chineseAddons', 'spice']],
			['Burnt Garlic Fried Rice', 'Noodles & Rice', 209, true, 'Fried rice with crisped garlic, spring onion and a soy-pepper finish.', ['chineseAddons']],
			['Triple Schezwan Rice', 'Noodles & Rice', 299, false, 'Rice, noodles and gravy in one plate, topped with a fried egg.', ['spice']],
			['Chilli Garlic Momos (8 pc)', 'Starters', 199, true, 'Steamed veg momos tossed in a chilli-garlic sauce, served with red chutney.', ['spice']],
			['Kung Pao Chicken', 'Main Course', 299, false, 'Diced chicken, roasted peanuts and dried red chillies.', ['chineseAddons', 'spice']],
			['Mapo Tofu', 'Main Course', 259, true, 'Silken tofu in a fermented bean and Sichuan pepper gravy.', ['spice']]
		]
	},
	Biryani: {
		categories: ['Biryani', 'Kebabs', 'Curries', 'Sides'],
		dishes: [
			['Hyderabadi Chicken Dum Biryani', 'Biryani', 329, false, 'Kacchi-style dum biryani sealed with dough, with salan and raita.', ['riceQty', 'biryaniAddons', 'spice']],
			['Mutton Dum Biryani', 'Biryani', 449, false, 'Long-grain basmati layered with slow-cooked mutton and fried onion.', ['riceQty', 'biryaniAddons', 'spice']],
			['Veg Dum Biryani', 'Biryani', 269, true, 'Garden vegetables and paneer dum-cooked with whole spices.', ['riceQty', 'biryaniAddons', 'spice']],
			['Egg Biryani', 'Biryani', 249, false, 'Two boiled eggs folded into masala rice with mint and fried onion.', ['riceQty', 'biryaniAddons']],
			['Prawn Biryani', 'Biryani', 419, false, 'Coastal-style prawn biryani with curry leaf and coconut oil.', ['riceQty', 'biryaniAddons', 'spice']],
			['Chicken 65', 'Kebabs', 249, false, 'Red, fiery, curry-leaf tossed. The default biryani sidekick.', ['spice']],
			['Seekh Kebab (4 pc)', 'Kebabs', 299, false, 'Minced mutton skewers with green chilli and fried onion.', ['spice']],
			['Apollo Fish', 'Kebabs', 339, false, 'Boneless fish cubes in a tangy chilli-yoghurt toss.', ['spice']],
			['Mirchi ka Salan', 'Curries', 119, true, 'Peanut-sesame gravy with long green chillies.', []],
			['Double ka Meetha', 'Sides', 129, true, 'Fried bread pudding in saffron milk, topped with almonds.', []],
			['Boondi Raita', 'Sides', 69, true, 'Whisked curd with boondi, cumin and coriander.', []],
			['Qubani ka Meetha', 'Sides', 139, true, 'Stewed apricots with a spoon of fresh cream.', []]
		]
	},
	Pizza: {
		categories: ['Veg Pizzas', 'Non-veg Pizzas', 'Sides', 'Desserts'],
		dishes: [
			['Margherita Classic', 'Veg Pizzas', 199, true, 'San Marzano sauce, fior di latte mozzarella and torn basil.', ['pizzaSize', 'crust', 'pizzaAddons']],
			['Tandoori Paneer Pizza', 'Veg Pizzas', 329, true, 'Tandoori paneer, onion, capsicum and a mint-mayo drizzle.', ['pizzaSize', 'crust', 'pizzaAddons']],
			['Farmhouse Veggie', 'Veg Pizzas', 299, true, 'Mushroom, capsicum, onion, tomato and sweet corn.', ['pizzaSize', 'crust', 'pizzaAddons']],
			['Peri Peri Paneer Tikka', 'Veg Pizzas', 339, true, 'Peri peri paneer, red onion and a dusting of chilli flakes.', ['pizzaSize', 'crust', 'pizzaAddons']],
			['Chicken Tikka Pizza', 'Non-veg Pizzas', 379, false, 'Tandoori chicken tikka, onion and coriander on a garlic base.', ['pizzaSize', 'crust', 'pizzaAddons']],
			['Pepperoni Pizza', 'Non-veg Pizzas', 399, false, 'Cup-and-char pepperoni over a double-cheese base.', ['pizzaSize', 'crust', 'pizzaAddons']],
			['Butter Chicken Pizza', 'Non-veg Pizzas', 389, false, 'Makhani base, shredded butter chicken and kasuri methi.', ['pizzaSize', 'crust', 'pizzaAddons']],
			['Cheesy Garlic Bread', 'Sides', 169, true, 'Stuffed garlic bread with mozzarella and herb butter.', []],
			['Peri Peri Fries', 'Sides', 149, true, 'Thick-cut fries dusted with peri peri masala.', []],
			['Cheese Dip', 'Sides', 49, true, 'Warm cheddar dip. Goes with absolutely everything here.', []],
			['Choco Lava Cake', 'Desserts', 129, true, 'Molten chocolate centre, served warm in a ramekin.', []],
			['Tiramisu Jar', 'Desserts', 189, true, 'Coffee-soaked savoiardi and mascarpone cream in a jar.', []]
		]
	},
	Burgers: {
		categories: ['Burgers', 'Loaded Fries', 'Shakes', 'Combos'],
		dishes: [
			['Aloo Tikki Burger', 'Burgers', 119, true, 'Spiced potato tikki, tangy mayo and crunchy lettuce in a toasted bun.', ['size2', 'burgerAddons', 'spice']],
			['Paneer Makhani Burger', 'Burgers', 199, true, 'Grilled paneer slab in makhani sauce with pickled onion.', ['size2', 'burgerAddons', 'spice']],
			['Crispy Veggie Burger', 'Burgers', 169, true, 'Corn and bean patty fried crisp, with jalapeno mayo.', ['size2', 'burgerAddons']],
			['Classic Chicken Burger', 'Burgers', 209, false, 'Buttermilk-fried chicken thigh, slaw and house sauce.', ['size2', 'burgerAddons', 'spice']],
			['Smash Double Chicken', 'Burgers', 299, false, 'Two smashed chicken patties, double cheese, grilled onion.', ['size2', 'burgerAddons', 'spice']],
			['Peri Peri Chicken Burger', 'Burgers', 249, false, 'Peri peri glazed chicken with charred pineapple.', ['size2', 'burgerAddons', 'spice']],
			['Cheesy Loaded Fries', 'Loaded Fries', 179, true, 'Fries under cheese sauce, jalapeno and crisp onion.', []],
			['Chicken Popcorn', 'Loaded Fries', 199, false, 'Bite-size fried chicken with a smoky dip.', ['spice']],
			['Thick Chocolate Shake', 'Shakes', 179, true, 'Cocoa, vanilla ice cream and a brownie chunk on top.', ['size2']],
			['Filter Coffee Shake', 'Shakes', 189, true, 'South Indian filter decoction blended with ice cream. Dangerous.', ['size2', 'sugar']],
			['Burger + Fries + Cola', 'Combos', 299, true, 'Any veg burger, regular fries and a chilled cola.', ['burgerAddons']],
			['Chicken Feast Combo', 'Combos', 399, false, 'Chicken burger, popcorn chicken, fries and a shake.', ['burgerAddons']]
		]
	},
	Desserts: {
		categories: ['Indian Sweets', 'Cakes & Bakes', 'Ice Cream', 'Beverages'],
		dishes: [
			['Gulab Jamun', 'Indian Sweets', 99, true, 'Khoya dumplings soaked warm in cardamom syrup.', ['sweetQty']],
			['Motichoor Ladoo', 'Indian Sweets', 109, true, 'Fine boondi ladoos with melon seeds.', ['sweetQty']],
			['Kaju Katli', 'Indian Sweets', 189, true, 'Cashew fudge rolled thin with a whisper of silver leaf.', ['sweetQty']],
			['Rasmalai', 'Indian Sweets', 139, true, 'Soft chenna discs in saffron-pistachio milk, served chilled.', ['sweetQty']],
			['Mysore Pak', 'Indian Sweets', 129, true, 'Ghee-heavy, melt-in-mouth gram flour squares.', ['sweetQty']],
			['Belgian Chocolate Jar Cake', 'Cakes & Bakes', 199, true, 'Dark chocolate sponge, ganache and crunch in a jar.', []],
			['Red Velvet Pastry', 'Cakes & Bakes', 149, true, 'Cocoa-buttermilk sponge with cream cheese frosting.', []],
			['Fresh Fruit Cake Slice', 'Cakes & Bakes', 139, true, 'Vanilla sponge, whipped cream and seasonal fruit.', []],
			['Malai Kulfi', 'Ice Cream', 99, true, 'Slow-reduced milk kulfi on a stick, dusted with pistachio.', []],
			['Tender Coconut Ice Cream', 'Ice Cream', 129, true, 'Scooped tender coconut with real malai strands.', []],
			['Brownie with Ice Cream', 'Ice Cream', 189, true, 'Warm walnut brownie under a scoop of vanilla.', []],
			['Badam Milk', 'Beverages', 89, true, 'Chilled almond milk with saffron and cardamom.', ['sugar']]
		]
	},
	Healthy: {
		categories: ['Salad Bowls', 'Grain Bowls', 'Wraps', 'Cold Pressed'],
		dishes: [
			['Greek Chickpea Salad', 'Salad Bowls', 249, true, 'Chickpeas, cucumber, olives, feta and a lemon-oregano dressing.', ['bowlAddons']],
			['Sprout & Pomegranate Chaat Bowl', 'Salad Bowls', 199, true, 'Moong sprouts, pomegranate, raw mango and chaat masala.', ['bowlAddons', 'spice']],
			['Caesar Salad with Grilled Chicken', 'Salad Bowls', 319, false, 'Romaine, parmesan, sourdough croutons and grilled chicken.', ['bowlAddons']],
			['Quinoa Khichdi Bowl', 'Grain Bowls', 279, true, 'Quinoa cooked khichdi-style with moong dal and seasonal veg.', ['bowlAddons']],
			['Peri Paneer Power Bowl', 'Grain Bowls', 299, true, 'Brown rice, peri paneer, hummus, beetroot and greens.', ['bowlAddons', 'spice']],
			['Grilled Chicken Millet Bowl', 'Grain Bowls', 339, false, 'Little millet, herbed chicken, roast veg and tahini drizzle.', ['bowlAddons']],
			['Paneer Kathi Wrap', 'Wraps', 229, true, 'Whole-wheat roomali wrap with tandoori paneer and mint mayo.', ['spice']],
			['Chicken Tikka Wrap', 'Wraps', 259, false, 'Chargrilled chicken tikka, onion and pudina chutney in a wheat wrap.', ['spice']],
			['Hummus & Falafel Pita', 'Wraps', 239, true, 'Baked falafel, hummus, pickled veg and sumac onion.', []],
			['Amla Ginger Shot', 'Cold Pressed', 79, true, 'Cold-pressed amla, ginger and a touch of honey.', []],
			['Watermelon Mint Cooler', 'Cold Pressed', 129, true, 'Pressed watermelon with mint and black salt.', ['sugar']],
			['Green Detox Juice', 'Cold Pressed', 149, true, 'Spinach, cucumber, celery, green apple and lime.', ['sugar']]
		]
	},
	Beverages: {
		categories: ['Chai & Coffee', 'Shakes & Smoothies', 'Coolers', 'Snacks'],
		dishes: [
			['Kadak Masala Chai', 'Chai & Coffee', 49, true, 'Assam leaf boiled with ginger, cardamom and a lot of patience.', ['sugar']],
			['Filter Kaapi', 'Chai & Coffee', 59, true, 'Decoction-forward filter coffee, frothed between two tumblers.', ['sugar']],
			['Cold Coffee with Ice Cream', 'Shakes & Smoothies', 159, true, 'Blended cold coffee topped with a vanilla scoop.', ['size2', 'sugar']],
			['Mango Lassi', 'Shakes & Smoothies', 139, true, 'Thick curd lassi blended with alphonso pulp.', ['size2', 'sugar']],
			['Banana Peanut Smoothie', 'Shakes & Smoothies', 169, true, 'Banana, peanut butter, curd and dates. No added sugar needed.', ['size2']],
			['Masala Nimbu Soda', 'Coolers', 79, true, 'Lime, black salt, jeera and soda, shaken at the counter.', ['sugar']],
			['Jaljeera', 'Coolers', 69, true, 'Cumin-mint cooler with boondi floating on top.', []],
			['Rose Falooda', 'Coolers', 189, true, 'Rose syrup, vermicelli, basil seeds and a kulfi scoop.', []],
			['Butter Maska Bun', 'Snacks', 69, true, 'Soft bun split and loaded with salted butter. Chai compulsory.', []],
			['Veg Puff', 'Snacks', 49, true, 'Flaky bakery puff with spiced potato and peas filling.', ['spice']],
			['Samosa (2 pc)', 'Snacks', 59, true, 'Crisp samosas with mint and tamarind chutney.', ['spice']],
			['Cheese Chilli Toast', 'Snacks', 129, true, 'Grilled toast with molten cheese, green chilli and herbs.', ['spice']]
		]
	},
	Coastal: {
		categories: ['Seafood Specials', 'Curries', 'Rice & Neer Dosa', 'Starters'],
		dishes: [
			['Mangalorean Fish Curry', 'Curries', 349, false, 'Coconut and byadgi chilli gravy with the catch of the day.', ['spice']],
			['Prawn Ghee Roast', 'Seafood Specials', 429, false, 'Kundapur-style prawns roasted in ghee and red chilli masala.', ['spice']],
			['Anjal Tawa Fry', 'Seafood Specials', 459, false, 'Kingfish steaks rubbed with rava and shallow fried.', ['spice']],
			['Crab Sukka', 'Seafood Specials', 489, false, 'Crab tossed dry with grated coconut and curry leaf.', ['spice']],
			['Chicken Sukka', 'Starters', 299, false, 'Coastal dry chicken with coconut, pepper and curry leaf.', ['spice']],
			['Kori Rotti', 'Curries', 329, false, 'Crisp rice wafers drowned in Mangalorean chicken curry.', ['spice']],
			['Neer Dosa (3 pc)', 'Rice & Neer Dosa', 99, true, 'Lacy rice crepes, the softest thing on this menu.', []],
			['Boiled Rice Plate', 'Rice & Neer Dosa', 89, true, 'Kerala matta rice, the right base for every curry here.', []],
			['Veg Coconut Curry', 'Curries', 239, true, 'Seasonal vegetables in a mild coconut-tamarind gravy.', ['spice']],
			['Goli Baje (6 pc)', 'Starters', 129, true, 'Fluffy maida fritters with coconut chutney.', []],
			['Tender Coconut Water', 'Rice & Neer Dosa', 69, true, 'Served in the shell, scooped malai included.', []]
		]
	},
	'Street Food': {
		categories: ['Rolls', 'Chaat', 'Fried Chicken', 'Coolers'],
		dishes: [
			['Chicken Tikka Roll', 'Rolls', 189, false, 'Flaky paratha wrapped around chicken tikka, onion and chutney.', ['spice']],
			['Double Egg Chicken Roll', 'Rolls', 219, false, 'Kolkata-style roll with a double egg coating.', ['spice']],
			['Paneer Tikka Roll', 'Rolls', 169, true, 'Tandoori paneer, mint mayo and pickled onion in a kathi roll.', ['spice']],
			['Aloo Kulcha Roll', 'Rolls', 129, true, 'Spiced potato and onion rolled into a buttered kulcha.', ['spice']],
			['Pani Puri (6 pc)', 'Chaat', 79, true, 'Crisp puris, spiced water, sweet chutney and sprouts.', ['spice']],
			['Sev Puri', 'Chaat', 99, true, 'Flat puris loaded with potato, onion, chutneys and nylon sev.', ['spice']],
			['Dahi Puri', 'Chaat', 109, true, 'Chilled curd, tamarind, pomegranate and a lot of crunch.', []],
			['Samosa Chole Chaat', 'Chaat', 129, true, 'Crushed samosa under chole, curd and chutneys.', ['spice']],
			['Fried Chicken Bucket (6 pc)', 'Fried Chicken', 349, false, 'Six pieces of crunchy fried chicken with two dips.', ['spice']],
			['Chicken Wings (8 pc)', 'Fried Chicken', 279, false, 'Tossed in honey chilli or peri peri. You choose.', ['spice']],
			['Masala Lemonade', 'Coolers', 69, true, 'Lemon, mint and masala over crushed ice.', ['sugar']],
			['Sweet Lassi', 'Coolers', 99, true, 'Thick curd lassi with a dollop of malai.', ['sugar']]
		]
	}
};

// ---------------------------------------------------------------------------
// Restaurants. Fictional names, real Bengaluru areas, plausible ratings.
// `priceIndex` scales the pool prices; `pureVeg` restaurants drop non-veg dishes.
// ---------------------------------------------------------------------------

const RESTAURANTS = [
	['Dosa Darbar', ['South Indian'], 'Jayanagar', '42, 11th Main Road, 4th Block, Jayanagar', 4.4, 1.0, 1.8, true, ['OFF50']],
	['Idli Express', ['South Indian', 'Beverages'], 'Koramangala', '7, 80 Feet Road, 4th Block, Koramangala', 4.2, 0.9, 2.4, true, ['FREEDEL']],
	["Anna's Tiffin Room", ['South Indian'], 'Malleswaram', '18, Sampige Road, Malleswaram', 4.6, 0.95, 5.2, true, []],
	['Madras Filter House', ['South Indian', 'Beverages'], 'Indiranagar', '221, CMH Road, Indiranagar', 4.3, 1.1, 3.6, true, ['OFF20']],
	['Punjabi Tadka House', ['North Indian'], 'Rajajinagar', '55, 1st Block, Rajajinagar', 4.1, 1.0, 6.4, false, ['OFF50']],
	['Butter & Bhatura', ['North Indian', 'Street Food'], 'HSR Layout', '9, 27th Main, Sector 2, HSR Layout', 4.4, 1.05, 2.1, false, []],
	['Tandoor Tales', ['North Indian', 'Biryani'], 'Whitefield', '12, Whitefield Main Road, Whitefield', 4.5, 1.2, 8.9, false, ['FREEDEL']],
	['Dhaba 47', ['North Indian'], 'Electronic City', '47, Neeladri Road, Electronic City Phase 1', 3.9, 0.85, 11.2, false, ['OFF20']],
	['Wok of Fame', ['Chinese'], 'Koramangala', '31, 5th Block, Koramangala', 4.3, 1.05, 2.8, false, []],
	['Chilli Dragon', ['Chinese'], 'BTM Layout', '14, 16th Main, BTM 2nd Stage', 4.0, 0.9, 4.1, false, ['OFF50']],
	['Momo Mandi', ['Chinese', 'Street Food'], 'Marathahalli', '6, Outer Ring Road, Marathahalli', 4.2, 0.85, 7.3, false, []],
	['Hyderabadi Handi', ['Biryani', 'North Indian'], 'Banashankari', '88, 50 Feet Road, Banashankari 2nd Stage', 4.5, 1.1, 5.7, false, ['OFF50']],
	['Biryani Bros.', ['Biryani'], 'HSR Layout', '3, 17th Cross, Sector 3, HSR Layout', 4.3, 1.0, 2.6, false, ['BROS40']],
	["Nizam's Dum House", ['Biryani'], 'Jayanagar', '27, 30th Cross, 7th Block, Jayanagar', 4.6, 1.15, 3.1, false, []],
	['Dum Pukht Lane', ['Biryani', 'North Indian'], 'Indiranagar', '101, 12th Main, HAL 2nd Stage, Indiranagar', 4.1, 1.25, 4.4, false, ['OFF20']],
	['Crust Culture', ['Pizza'], 'Indiranagar', '66, 100 Feet Road, Indiranagar', 4.4, 1.15, 3.9, false, ['FREEDEL']],
	['Napoli Nook', ['Pizza'], 'Koramangala', '19, 6th Block, Koramangala', 4.5, 1.3, 2.9, false, []],
	['Slice of Bengaluru', ['Pizza', 'Burgers'], 'Whitefield', '23, Varthur Road, Whitefield', 3.8, 0.95, 9.6, false, ['OFF50']],
	['Burger Baithak', ['Burgers'], 'BTM Layout', '5, 29th Main, BTM 1st Stage', 4.2, 0.9, 4.6, false, []],
	['Patty Pandal', ['Burgers', 'Desserts'], 'Jayanagar', '71, 9th Main, 3rd Block, Jayanagar', 4.0, 0.95, 2.3, false, ['OFF20']],
	['Smash & Stack', ['Burgers'], 'HSR Layout', '2, 14th Main, Sector 6, HSR Layout', 4.6, 1.2, 1.9, false, ['FREEDEL']],
	['Mithai Mahal', ['Desserts'], 'Malleswaram', '4, 8th Cross, Malleswaram', 4.7, 1.0, 5.9, true, []],
	['Choco Chaupal', ['Desserts'], 'Indiranagar', '38, 80 Feet Road, Indiranagar', 4.3, 1.15, 3.4, true, ['OFF20']],
	['Kulfi Katta', ['Desserts', 'Beverages'], 'Rajajinagar', '16, Dr Rajkumar Road, Rajajinagar', 4.1, 0.85, 6.8, true, []],
	['Green Bowl Co.', ['Healthy'], 'Koramangala', '45, 7th Block, Koramangala', 4.4, 1.25, 2.7, false, ['FREEDEL']],
	['Salad Samrat', ['Healthy'], 'HSR Layout', '11, 24th Main, Sector 2, HSR Layout', 4.0, 1.1, 2.2, true, []],
	['Chai Chaupal', ['Beverages', 'Street Food'], 'Marathahalli', '8, Kundalahalli Gate, Marathahalli', 4.2, 0.8, 7.1, true, ['OFF20']],
	['Juice Junction', ['Beverages', 'Healthy'], 'Banashankari', '62, Kathriguppe Main Road, Banashankari', 3.9, 0.9, 5.4, true, []],
	['Rolls Royale', ['Street Food'], 'Electronic City', '29, Hosur Road, Electronic City Phase 2', 4.3, 0.95, 10.4, false, ['OFF50']],
	['Coastal Curry Co.', ['Coastal'], 'Indiranagar', '90, Double Road, Indiranagar', 4.5, 1.2, 4.2, false, []]
];

/** Opening hours per restaurant archetype, in minutes from midnight. */
function hoursFor(cuisines) {
	if (cuisines.includes('South Indian')) return { open: 6 * 60 + 30, close: 22 * 60 };
	if (cuisines.includes('Beverages')) return { open: 6 * 60, close: 23 * 60 };
	if (cuisines.includes('Desserts')) return { open: 10 * 60, close: 23 * 60 };
	if (cuisines.includes('Biryani')) return { open: 11 * 60, close: 23 * 60 + 30 };
	return { open: 11 * 60, close: 23 * 60 };
}

/** Pick the illustration key for a dish from its name and category. */
function artFor(name, category, veg) {
	const n = name.toLowerCase();
	if (n.includes('dosa') || n.includes('uttapam')) return 'dosa';
	if (n.includes('idli') || n.includes('vada')) return 'idli';
	if (n.includes('biryani')) return 'biryani';
	if (n.includes('pizza') || n.includes('margherita')) return 'pizza';
	if (n.includes('burger')) return 'burger';
	if (n.includes('noodle') || n.includes('hakka')) return 'noodles';
	if (n.includes('momo')) return 'momo';
	if (n.includes('roll') || n.includes('wrap') || n.includes('pita')) return 'roll';
	if (n.includes('fries')) return 'fries';
	if (n.includes('kebab') || n.includes('tikka') || n.includes('seekh') || n.includes('tandoori')) return 'kebab';
	if (n.includes('soup')) return 'soup';
	if (n.includes('naan') || n.includes('roti') || n.includes('paratha') || n.includes('bhature') || n.includes('bun') || n.includes('toast') || n.includes('puff') || n.includes('samosa')) return 'bread';
	if (n.includes('kulfi') || n.includes('ice cream') || n.includes('falooda')) return 'icecream';
	if (n.includes('cake') || n.includes('brownie') || n.includes('pastry') || n.includes('tiramisu')) return 'cake';
	if (n.includes('ladoo') || n.includes('jamun') || n.includes('katli') || n.includes('rasmalai') || n.includes('mysore pak') || n.includes('meetha')) return 'sweet';
	if (n.includes('salad') || n.includes('bowl') || n.includes('chaat') || n.includes('puri')) return 'salad';
	if (n.includes('coffee') || n.includes('chai') || n.includes('kaapi')) return 'coffee';
	if (n.includes('juice') || n.includes('lassi') || n.includes('shake') || n.includes('smoothie') || n.includes('soda') || n.includes('cooler') || n.includes('milk') || n.includes('lemonade') || n.includes('jaljeera') || n.includes('coconut water') || n.includes('shot')) return 'juice';
	if (n.includes('rice') || n.includes('bath') || n.includes('meals') || n.includes('khichdi')) return 'rice';
	if (n.includes('fish') || n.includes('prawn') || n.includes('crab') || n.includes('anjal')) return 'seafood';
	if (n.includes('chicken') || n.includes('mutton') || n.includes('lollipop') || n.includes('wings')) return 'curry-nonveg';
	if (category === 'Curries' || n.includes('paneer') || n.includes('dal') || n.includes('curry') || n.includes('masala') || n.includes('manchurian') || n.includes('tofu') || n.includes('mushroom') || n.includes('corn')) return veg ? 'curry-veg' : 'curry-nonveg';
	return veg ? 'curry-veg' : 'curry-nonveg';
}

const slug = (text) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

const restaurants = [];
const menus = {};

for (const [name, cuisines, area, address, rating, priceIndex, distanceKm, pureVeg, offerCodes] of RESTAURANTS) {
	const id = slug(name);
	const pools = cuisines.filter((c) => POOLS[c]);
	/** @type {any[]} */
	const dishes = [];
	const usedNames = new Set();

	for (const cuisine of pools) {
		const pool = POOLS[cuisine];
		const share = Math.ceil(12 / pools.length) + 2;
		const candidates = pool.dishes.filter(([dishName, , , veg]) => (pureVeg ? veg : true) && !usedNames.has(dishName));
		for (const dish of candidates.slice(0, share)) {
			const [dishName, category, base, veg, description, optionKeys] = dish;
			usedNames.add(dishName);
			const price = rupees(base * priceIndex);
			const dishRating = Math.min(5, Math.max(3.2, rating + (rand() - 0.45) * 0.8));
			dishes.push({
				id: `${id}--${slug(dishName)}`,
				restaurantId: id,
				name: dishName,
				description,
				category,
				pricePaise: price,
				veg,
				bestseller: false,
				recommended: false,
				rating: Math.round(dishRating * 10) / 10,
				ratingCount: between(18, 940),
				serves: price > 30000 ? 2 : 1,
				art: artFor(dishName, category, veg),
				optionGroups: optionKeys.map((key) => OPTION_LIBRARY[key]).filter(Boolean),
				available: true
			});
		}
	}

	// Mark 2 bestsellers and 3 recommended, deterministically but not always the first rows.
	const sortedByRating = [...dishes].sort((a, b) => b.rating - a.rating);
	for (const dish of sortedByRating.slice(0, 2)) dish.bestseller = true;
	for (const dish of sortedByRating.slice(0, 3)) dish.recommended = true;
	const extraRecommended = dishes[Math.floor(rand() * dishes.length)];
	if (extraRecommended) extraRecommended.recommended = true;

	// One restaurant deliberately ships an out-of-stock dish so the "unavailable" UI,
	// the reorder warning and the owner view all have real data on first load.
	if (id === 'biryani-bros') {
		const target = dishes.find((d) => d.name === 'Prawn Biryani');
		if (target) target.available = false;
	}

	const categories = [];
	for (const dish of dishes) if (!categories.includes(dish.category)) categories.push(dish.category);

	menus[id] = dishes;

	restaurants.push({
		id,
		name,
		cuisines,
		area,
		address: `${address}, Bengaluru 560${String(between(1, 99)).padStart(2, '0')}`,
		rating,
		ratingCount: between(240, 4800),
		deliveryMinutes: Math.max(16, Math.round(16 + distanceKm * 2.6 + (rand() - 0.5) * 4)),
		distanceKm,
		priceForTwoPaise: rupees(Math.round((250 + priceIndex * 220) / 10) * 10),
		pureVeg,
		offerCodes,
		hours: hoursFor(cuisines),
		categories,
		art: artFor(dishes[0]?.name ?? name, dishes[0]?.category ?? '', pureVeg),
		tagline:
			cuisines.includes('Biryani')
				? 'Dum-cooked daily, never reheated'
				: cuisines.includes('South Indian')
					? 'Batter ground fresh every morning'
					: cuisines.includes('Healthy')
						? 'Counted calories, uncounted flavour'
						: 'Neighbourhood favourite since forever'
	});
}

// ---------------------------------------------------------------------------
// Coupons. `kind` drives the pricing engine; see src/lib/logic/coupons.ts.
// Dates are ISO so an expired coupon stays expired without a clock trick.
// ---------------------------------------------------------------------------

const coupons = [
	{
		code: 'WELCOME50',
		title: '50% off your first order',
		description: 'Flat 50% off up to ₹100 on orders above ₹199. First order only.',
		kind: 'percent',
		percent: 50,
		maxDiscountPaise: 10000,
		minOrderPaise: 19900,
		firstOrderOnly: true,
		oncePerUser: true,
		restaurantId: null,
		expiresOn: '2027-12-31'
	},
	{
		code: 'FREEDEL',
		title: 'Free delivery',
		description: 'Delivery fee waived on orders above ₹149.',
		kind: 'free-delivery',
		minOrderPaise: 14900,
		oncePerUser: false,
		restaurantId: null,
		expiresOn: '2027-12-31'
	},
	{
		code: 'SAVE20',
		title: '20% off up to ₹80',
		description: '20% off up to ₹80 on orders above ₹299.',
		kind: 'percent',
		percent: 20,
		maxDiscountPaise: 8000,
		minOrderPaise: 29900,
		oncePerUser: false,
		restaurantId: null,
		expiresOn: '2027-12-31'
	},
	{
		code: 'BROS40',
		title: '₹40 off at Biryani Bros.',
		description: 'Flat ₹40 off on orders above ₹249 at Biryani Bros. only.',
		kind: 'flat',
		flatPaise: 4000,
		minOrderPaise: 24900,
		oncePerUser: false,
		restaurantId: 'biryani-bros',
		expiresOn: '2027-12-31'
	},
	{
		code: 'OFF50',
		title: '₹50 off above ₹299',
		description: 'Flat ₹50 off on orders above ₹299.',
		kind: 'flat',
		flatPaise: 5000,
		minOrderPaise: 29900,
		oncePerUser: false,
		restaurantId: null,
		expiresOn: '2027-12-31'
	},
	{
		code: 'OFF20',
		title: '₹20 off, no minimum',
		description: 'Flat ₹20 off with no minimum order. Because why not.',
		kind: 'flat',
		flatPaise: 2000,
		minOrderPaise: 0,
		oncePerUser: false,
		restaurantId: null,
		expiresOn: '2027-12-31'
	},
	{
		code: 'MONSOON25',
		title: 'Expired: monsoon treat',
		description: 'This one ran out in 2024 - kept here so you can see what an expired coupon looks like.',
		kind: 'percent',
		percent: 25,
		maxDiscountPaise: 12500,
		minOrderPaise: 19900,
		oncePerUser: false,
		restaurantId: null,
		expiresOn: '2024-09-30'
	}
];

/** Delivery areas offered on the landing page. */
const areas = [
	{ id: 'koramangala', name: 'Koramangala', city: 'Bengaluru', pin: '560034' },
	{ id: 'indiranagar', name: 'Indiranagar', city: 'Bengaluru', pin: '560038' },
	{ id: 'hsr-layout', name: 'HSR Layout', city: 'Bengaluru', pin: '560102' },
	{ id: 'jayanagar', name: 'Jayanagar', city: 'Bengaluru', pin: '560041' },
	{ id: 'whitefield', name: 'Whitefield', city: 'Bengaluru', pin: '560066' },
	{ id: 'malleswaram', name: 'Malleswaram', city: 'Bengaluru', pin: '560003' },
	{ id: 'btm-layout', name: 'BTM Layout', city: 'Bengaluru', pin: '560076' },
	{ id: 'marathahalli', name: 'Marathahalli', city: 'Bengaluru', pin: '560037' },
	{ id: 'banashankari', name: 'Banashankari', city: 'Bengaluru', pin: '560070' },
	{ id: 'rajajinagar', name: 'Rajajinagar', city: 'Bengaluru', pin: '560010' },
	{ id: 'electronic-city', name: 'Electronic City', city: 'Bengaluru', pin: '560100' }
];

/** Categories shown in the landing page category row. */
const categories = [
	{ id: 'biryani', name: 'Biryani', art: 'biryani' },
	{ id: 'pizza', name: 'Pizza', art: 'pizza' },
	{ id: 'south-indian', name: 'South Indian', art: 'dosa' },
	{ id: 'burgers', name: 'Burgers', art: 'burger' },
	{ id: 'north-indian', name: 'North Indian', art: 'curry-veg' },
	{ id: 'chinese', name: 'Chinese', art: 'noodles' },
	{ id: 'desserts', name: 'Desserts', art: 'cake' },
	{ id: 'healthy', name: 'Healthy', art: 'salad' },
	{ id: 'beverages', name: 'Beverages', art: 'coffee' },
	{ id: 'street-food', name: 'Street Food', art: 'roll' },
	{ id: 'coastal', name: 'Coastal', art: 'seafood' }
];

mkdirSync(OUT, { recursive: true });
const write = (file, value) => {
	writeFileSync(join(OUT, file), `${JSON.stringify(value, null, '\t')}\n`, 'utf8');
};

write('restaurants.json', restaurants);
write('menus.json', menus);
write('coupons.json', coupons);
write('areas.json', areas);
write('categories.json', categories);

const dishCount = Object.values(menus).reduce((sum, list) => sum + list.length, 0);
const minDishes = Math.min(...Object.values(menus).map((list) => list.length));
console.log(
	`FoodRush catalog: ${restaurants.length} restaurants, ${dishCount} dishes ` +
		`(min ${minDishes} per restaurant), ${coupons.length} coupons, ${areas.length} areas.`
);
if (restaurants.length < 25) throw new Error('Brief requires 25+ restaurants');
if (minDishes < 8) throw new Error('Brief requires 8+ dishes per restaurant');
