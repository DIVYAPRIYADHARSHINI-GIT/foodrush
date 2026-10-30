/** Route table, shared by the header, the mobile tab bar and the probes. */
export interface NavItem {
	route: string;
	label: string;
	/** Shown in the bottom tab bar on phones. */
	mobile: boolean;
}

export const NAV: NavItem[] = [
	{ route: '/', label: 'Home', mobile: true },
	{ route: '/restaurants', label: 'Restaurants', mobile: true },
	{ route: '/cart', label: 'Cart', mobile: true },
	{ route: '/orders', label: 'Orders', mobile: true },
	{ route: '/profile', label: 'Profile', mobile: true },
	{ route: '/offers', label: 'Offers', mobile: false },
	{ route: '/favourites', label: 'Favourites', mobile: false },
	{ route: '/owner', label: 'Restaurant view', mobile: false }
];

/**
 * True when `pathname` is inside `route`.
 *
 * Compares against the path SEGMENT rather than a prefix, so the build works at a domain
 * root and on a GitHub Pages sub-path (`/foodrush/restaurants/`) without the base path
 * breaking the highlight. Home only matches the exact root.
 */
export function isActive(pathname: string, route: string): boolean {
	const segments = pathname.split('/').filter(Boolean);
	if (route === '/') {
		// Home is active when no app route segment is present (root, or base path only).
		const known = NAV.map((item) => item.route.replace(/\//g, '')).filter(Boolean);
		return !segments.some((segment) => known.includes(segment));
	}
	return segments.includes(route.replace(/\//g, ''));
}
