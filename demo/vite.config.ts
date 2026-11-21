import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [cloudflare()],
	// The exports' colour list is read from disk on a computer; the Worker gets it bundled instead.
	resolve: {
		alias: [
			{
				find: /^\.\/tokens-css\.ts$/,
				replacement: fileURLToPath(new URL("./src/tokens-css.ts", import.meta.url)),
			},
		],
	},
	// The Worker bundles the interface from cli/ui and the roadmap code from cli/src.
	server: { fs: { allow: [".."] } },
	fmt: { useTabs: true },
	lint: {
		options: { typeAware: true, typeCheck: true },
		ignorePatterns: ["record.ts", "*.mjs"],
	},
});
