import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [cloudflare()],
	// The Worker bundles the interface from cli/ui and the roadmap code from cli/src.
	server: { fs: { allow: [".."] } },
	fmt: { useTabs: true },
	lint: {
		options: { typeAware: true, typeCheck: true },
		ignorePatterns: ["record.ts", "*.mjs"],
	},
});
