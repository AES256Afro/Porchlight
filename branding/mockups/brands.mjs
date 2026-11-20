// The concepts the owner shortlisted for mockups, and how each would dress the app.
//
// `app` sets the interface's own colour roles (cli/ui/styles.css). Severity colours are left
// alone: they mark state, so a brand never borrows them, and no accent here is a red.
// `onAccent` is the text colour on a primary button. `brandFont` sets the name in the sidebar,
// `headFont` the page titles; the body stays in the system face, as the real app has it.

export const SMALL_LINE = 'Your repos · Your servers · Your computer';

/** @type {Array<{n: number, slug: string, name: string, from?: number, tagline: string, scheme: 'light'|'dark', brandFont: string, brandCase?: 'upper', brandSize?: number, brandTracking?: string, lit?: string, headFont: string, headWeight?: number, app: Record<string, string>, onAccent: string, desk: [string, string], wall: string}>} */
export const BRANDS = [
	{
		n: 54, slug: '54-poster-moderne-doorway', name: 'Poster moderne (doorway)', from: 35,
		tagline: 'Nothing left out in the open.', scheme: 'dark',
		brandFont: '"Futura Condensed ExtraBold", "Futura", sans-serif', brandCase: 'upper', brandSize: 21, brandTracking: '0.02em',
		headFont: '"Futura Condensed ExtraBold", "Futura", sans-serif', headWeight: 800,
		app: { page: '#0c0e12', surface: '#131a23', ink: '#f5ebd3', ink2: '#cdc4ae', muted: '#8b8676', hairline: '#243140', accent: '#3f6080', accentHover: '#8aa7c0', link: '#dca63f' },
		onAccent: '#fff', lit: '#dca63f', desk: ['#1f2f42', '#0c0e12'], wall: '#1f2f42',
	},
	{
		n: 22, slug: '22-boomerang-daylight', name: 'Boomerang (daylight)',
		tagline: 'Leave the light on.', scheme: 'light',
		brandFont: '"SignPainter", "SignPainter-HouseScript", cursive', brandSize: 27,
		headFont: '"Futura", sans-serif', headWeight: 700,
		app: { page: '#f5ead2', surface: '#fbf4e4', ink: '#2a292e', ink2: '#56535b', muted: '#8c8579', hairline: '#e3d5b6', accent: '#23908b', accentHover: '#1b7470', link: '#1b7470' },
		onAccent: '#fff', desk: ['#62c4bb', '#23908b'], wall: '#f5ead2',
	},
	{
		n: 23, slug: '23-sputnik-lamp', name: 'Sputnik lamp',
		tagline: 'Lights on. Eyes open.', scheme: 'dark',
		brandFont: '"Futura", sans-serif', brandCase: 'upper', brandSize: 15, brandTracking: '0.22em',
		headFont: '"Futura", sans-serif', headWeight: 500,
		app: { page: '#150f1c', surface: '#211830', ink: '#f5e9cf', ink2: '#d7c8ae', muted: '#9a8a9e', hairline: '#352841', accent: '#874551', accentHover: '#f2b632', link: '#f2b632' },
		onAccent: '#fff', desk: ['#4b2f4e', '#150f1c'], wall: '#291d36',
	},
	{
		n: 24, slug: '24-ranch-rooftop', name: 'Ranch rooftop',
		tagline: "Know what's on your doorstep.", scheme: 'dark',
		brandFont: '"Futura", sans-serif', brandCase: 'upper', brandSize: 17, brandTracking: '0.06em',
		headFont: '"Futura", sans-serif', headWeight: 700,
		app: { page: '#0a1230', surface: '#101d4c', ink: '#fbf1dc', ink2: '#cbd2e6', muted: '#8ea0c8', hairline: '#1d3478', accent: '#f26d85', accentHover: '#7fd3c0', link: '#7fd3c0' },
		onAccent: '#0a1230', desk: ['#1b367f', '#0a1230'], wall: '#15296a',
	},
	{
		n: 32, slug: '32-deco-monogram', name: 'Deco monogram',
		tagline: "Know what's on your doorstep.", scheme: 'dark',
		brandFont: '"Copperplate", serif', brandCase: 'upper', brandSize: 16, brandTracking: '0.16em',
		headFont: '"Copperplate", serif', headWeight: 600,
		app: { page: '#0b0b0c', surface: '#151516', ink: '#f3ead8', ink2: '#d0c7b3', muted: '#8f877a', hairline: '#2b2925', accent: '#c9a24a', accentHover: '#e0bf6e', link: '#d9b766' },
		onAccent: '#0b0b0c', desk: ['#2a2620', '#0b0b0c'], wall: '#151516',
	},
	{
		n: 55, slug: '55-scratchboard-lantern', name: 'Scratchboard lantern', from: 50,
		tagline: 'Keep your secrets off the street.', scheme: 'dark',
		brandFont: '"Bodoni 72", "Didot", serif', brandSize: 22,
		headFont: '"Bodoni 72", "Didot", serif', headWeight: 700,
		app: { page: '#0d0c0b', surface: '#171513', ink: '#f4efe4', ink2: '#cdc6b8', muted: '#8d867a', hairline: '#2b2723', accent: '#f2a63a', accentHover: '#f7c070', link: '#f2a63a' },
		onAccent: '#0d0c0b', desk: ['#2a2622', '#0d0c0b'], wall: '#171513',
	},
	{
		n: 56, slug: '56-lantern-shadowbox-two', name: 'Lantern shadow-box II', from: 51,
		tagline: "Know what's on your doorstep.", scheme: 'light',
		brandFont: '"Gill Sans", sans-serif', brandSize: 20,
		headFont: '"Gill Sans", sans-serif', headWeight: 600,
		app: { page: '#efe6d3', surface: '#f8f1e2', ink: '#232846', ink2: '#4a4f72', muted: '#8a8676', hairline: '#ddd0b3', accent: '#3a4380', accentHover: '#2f3a7c', link: '#3a4380' },
		onAccent: '#fff', desk: ['#40509a', '#232846'], wall: '#efe6d3',
	},
	{
		n: 57, slug: '57-engraved-lantern', name: 'Engraved lantern', from: 39,
		tagline: 'Keep private things private.', scheme: 'light',
		brandFont: '"Academy Engraved LET", "Copperplate", serif', brandCase: 'upper', brandSize: 18, brandTracking: '0.08em',
		headFont: '"Academy Engraved LET", "Copperplate", serif', headWeight: 400,
		app: { page: '#f3ebd3', surface: '#fbf5e5', ink: '#12261d', ink2: '#2f5c47', muted: '#7b8975', hairline: '#ddd3b5', accent: '#2f5c47', accentHover: '#12261d', link: '#2f5c47' },
		onAccent: '#fff', desk: ['#2f5c47', '#12261d'], wall: '#f3ebd3',
	},
	{
		n: 58, slug: '58-deco-lantern', name: 'Deco lantern', from: 40,
		tagline: 'The light stays on.', scheme: 'dark',
		brandFont: '"Bodoni 72", "Didot", serif', brandCase: 'upper', brandSize: 17, brandTracking: '0.1em',
		headFont: '"Bodoni 72", "Didot", serif', headWeight: 700,
		app: { page: '#0a1634', surface: '#0f2150', ink: '#fff4d8', ink2: '#e2d6b4', muted: '#9aa3c0', hairline: '#1d3a7c', accent: '#e6b450', accentHover: '#f8dc8a', link: '#f8dc8a' },
		onAccent: '#0a1634', desk: ['#1b3a80', '#0a1634'], wall: '#0f2150',
	},
	{
		n: 59, slug: '59-linocut-two', name: 'Linocut II', from: 49,
		tagline: 'Nothing hides on a lit porch.', scheme: 'light',
		brandFont: '"Futura", sans-serif', brandCase: 'upper', brandSize: 18, brandTracking: '0.04em',
		headFont: '"Futura", sans-serif', headWeight: 800,
		app: { page: '#efe7d5', surface: '#f8f2e4', ink: '#1a2847', ink2: '#3e4a68', muted: '#8d867a', hairline: '#ddd1b9', accent: '#1a2847', accentHover: '#d98a1c', link: '#1a2847' },
		onAccent: '#fff', lit: '#d98a1c', desk: ['#1a2847', '#0f1830'], wall: '#efe7d5',
	},
	{
		n: 60, slug: '60-flat-stoop-two', name: 'Flat city stoop II', from: 47,
		tagline: "See what you've left out in the open.", scheme: 'dark',
		brandFont: '"Iowan Old Style", serif', brandSize: 20,
		headFont: '"Iowan Old Style", serif', headWeight: 900,
		app: { page: '#1c1526', surface: '#251c31', ink: '#f3e6cf', ink2: '#d9c9af', muted: '#a0907e', hairline: '#3a2d45', accent: '#2c6c70', accentHover: '#c9a14e', link: '#f0b55a' },
		onAccent: '#fff', desk: ['#7b4743', '#241b30'], wall: '#241b30',
	},
];
