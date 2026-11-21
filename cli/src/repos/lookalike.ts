/**
 * Typosquats and dependency confusion (FT-7), offline. Nothing is looked up in a registry: a package's
 * name is compared with a short list of popular names shipped here, and a repository's own `.npmrc`,
 * `package-lock.json` and requirements files are read to see whether a name that looks internal could
 * come from a public registry instead.
 *
 * What this finds is advice, ranked medium or low with its reason, and never a reason to leave a
 * package out (invariant 10): a name one letter from a popular one may be a real package. Known
 * malicious packages already arrive as OSV `MAL-` advisories through the dependency scan.
 *
 * A scanned repository is hostile input (invariant 14): its files are read, never run; symbolic links
 * are not followed; a file larger than MAX_BYTES is not read and is said to be unread; and what is
 * kept is a package's name, a file's name at the repository's top and fixed words. Never a registry's
 * address, which can name a private host or carry a token, and never anything else a file holds.
 */
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type AdviceLevel = "medium" | "low";

export interface PackageAdvice {
	kind: "lookalike" | "confusion";
	level: AdviceLevel;
	ecosystem: "npm" | "PyPI";
	/** The package the advice is about; absent for advice about a repository's settings. */
	name?: string;
	/** Why, in Porchlight's own words. */
	reason: string;
}

/** The largest file read. A lockfile larger than this is not read, and that is said. */
const MAX_BYTES = 8 * 1024 * 1024;
/** Names shorter than this are not compared: two short names one letter apart are common and mostly real. */
const MIN_NAME = 5;

/**
 * Popular npm packages: the ones a typosquat imitates. Short on purpose; it is a check for the names
 * attackers have copied most, not a registry.
 */
export const POPULAR_NPM: readonly string[] = [
	"express", "react", "react-dom", "lodash", "axios", "chalk", "commander", "moment", "request", "debug",
	"webpack", "typescript", "eslint", "prettier", "jquery", "vue", "angular", "next", "nuxt", "svelte",
	"underscore", "async", "bluebird", "uuid", "dotenv", "yargs", "minimist", "mkdirp", "rimraf", "glob",
	"semver", "colors", "inquirer", "ora", "cheerio", "body-parser", "cookie-parser", "cors", "helmet", "morgan",
	"mongoose", "sequelize", "mysql", "mysql2", "pg", "redis", "ioredis", "sqlite3", "knex", "prisma",
	"socket.io", "ws", "jsonwebtoken", "bcrypt", "bcryptjs", "passport", "nodemailer", "multer", "sharp", "jimp",
	"babel-core", "babel-loader", "@babel/core", "core-js", "regenerator-runtime", "rxjs", "tslib", "zone.js", "classnames", "prop-types",
	"redux", "react-redux", "react-router", "react-router-dom", "styled-components", "emotion", "tailwindcss", "postcss", "autoprefixer", "sass",
	"less", "jest", "mocha", "chai", "sinon", "karma", "jasmine", "cypress", "puppeteer", "playwright",
	"nodemon", "concurrently", "cross-env", "dotenv-expand", "fs-extra", "graceful-fs", "chokidar", "node-fetch", "got", "superagent",
	"form-data", "qs", "querystring", "url-parse", "path-to-regexp", "mime", "mime-types", "iconv-lite", "safe-buffer", "buffer",
	"event-stream", "through2", "readable-stream", "string_decoder", "inherits", "once", "wrappy", "ansi-regex", "strip-ansi", "supports-color",
	"electron", "vite", "rollup", "esbuild", "parcel", "gulp", "grunt", "browserify", "terser", "uglify-js",
	"handlebars", "ejs", "pug", "marked", "markdown-it", "highlight.js", "d3", "chart.js", "three", "leaflet",
	"date-fns", "dayjs", "luxon", "validator", "joi", "yup", "zod", "ajv", "class-validator", "immer",
	"crypto-js", "node-forge", "elliptic", "ethers", "web3", "discord.js", "telegraf", "twilio", "stripe", "aws-sdk",
	"firebase", "firebase-admin", "googleapis", "graphql", "apollo-server", "koa", "fastify", "hapi", "nestjs", "loopback",
	"cross-spawn", "shelljs", "execa", "node-ipc", "coa", "rc", "ua-parser-js", "eslint-scope", "flatmap-stream", "left-pad",
];

/** Popular PyPI packages, in their normalised form (lower case, separators as "-"). */
export const POPULAR_PYPI: readonly string[] = [
	"requests", "urllib3", "numpy", "pandas", "scipy", "matplotlib", "seaborn", "scikit-learn", "tensorflow", "torch",
	"keras", "django", "flask", "fastapi", "uvicorn", "gunicorn", "celery", "redis", "sqlalchemy", "psycopg2",
	"psycopg2-binary", "pymysql", "pymongo", "boto3", "botocore", "s3transfer", "awscli", "google-cloud-storage", "azure-storage-blob", "pyyaml",
	"jinja2", "markupsafe", "werkzeug", "click", "itsdangerous", "six", "setuptools", "wheel", "pip", "virtualenv",
	"pytest", "pytest-cov", "coverage", "tox", "nose", "mock", "black", "flake8", "pylint", "mypy",
	"isort", "autopep8", "yapf", "pre-commit", "attrs", "pydantic", "marshmallow", "python-dateutil", "pytz", "tzdata",
	"certifi", "chardet", "charset-normalizer", "idna", "cryptography", "pyopenssl", "pycryptodome", "paramiko", "bcrypt", "pyjwt",
	"python-jose", "passlib", "oauthlib", "requests-oauthlib", "httpx", "aiohttp", "websockets", "tornado", "twisted", "grpcio",
	"protobuf", "beautifulsoup4", "lxml", "html5lib", "scrapy", "selenium", "playwright", "pillow", "opencv-python", "imageio",
	"tqdm", "rich", "colorama", "termcolor", "tabulate", "prettytable", "pyfiglet", "loguru", "python-dotenv", "toml",
	"tomli", "simplejson", "ujson", "orjson", "msgpack", "docutils", "sphinx", "jupyter", "notebook", "ipython",
	"ipykernel", "nltk", "spacy", "gensim", "transformers", "openai", "anthropic", "langchain", "xgboost", "lightgbm",
	"statsmodels", "sympy", "networkx", "plotly", "bokeh", "dash", "streamlit", "gradio", "huggingface-hub", "datasets",
	"pyarrow", "fsspec", "dask", "joblib", "cloudpickle", "psutil", "docker", "kubernetes", "ansible", "fabric",
	"pexpect", "sh", "invoke", "typer", "fire", "argparse", "colorlog", "structlog", "sentry-sdk", "prometheus-client",
	"discord-py", "python-telegram-bot", "tweepy", "slack-sdk", "stripe", "twilio", "web3", "ccxt", "pysocks", "dnspython",
];

/** A PyPI name as PyPI compares names: lower case, and any run of "-", "_" or "." as one "-" (PEP 503). */
export function normalisePypi(name: string): string {
	return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/**
 * Whether two names are one edit apart: one letter changed, added or removed, or two neighbouring
 * letters swapped. Equal names are not.
 */
export function oneEditApart(a: string, b: string): boolean {
	if (a === b) return false;
	if (Math.abs(a.length - b.length) > 1) return false;
	if (a.length === b.length) {
		const differ: number[] = [];
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ.push(i);
		if (differ.length === 1) return true;
		return differ.length === 2 && differ[1] === differ[0]! + 1 && a[differ[0]!] === b[differ[1]!] && a[differ[1]!] === b[differ[0]!];
	}
	const [short, long] = a.length < b.length ? [a, b] : [b, a];
	let i = 0;
	while (i < short.length && short[i] === long[i]) i++;
	return short.slice(i) === long.slice(i + 1);
}

/** The popular name a package's name imitates, or null. */
export function imitates(ecosystem: "npm" | "PyPI", name: string): string | null {
	const popular = ecosystem === "npm" ? POPULAR_NPM : POPULAR_PYPI;
	const own = ecosystem === "PyPI" ? normalisePypi(name) : name.toLowerCase();
	if (own.length < MIN_NAME || popular.includes(own)) return null;
	// A scoped npm package is its scope's: imitating a popular name inside a scope is not this check's to judge.
	if (ecosystem === "npm" && own.startsWith("@") && !popular.some((known) => known.startsWith("@") && oneEditApart(known, own))) return null;
	return popular.find((known) => known.length >= MIN_NAME && oneEditApart(known, own)) ?? null;
}

/** Advice for names one edit from a popular package's, each once. */
export function lookalikes(packages: { ecosystem: "npm" | "PyPI"; name: string }[]): PackageAdvice[] {
	const advice: PackageAdvice[] = [];
	const seen = new Set<string>();
	for (const { ecosystem, name } of packages) {
		const key = `${ecosystem}\n${name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const like = imitates(ecosystem, name);
		if (!like) continue;
		advice.push({
			kind: "lookalike",
			level: "medium",
			ecosystem,
			name,
			reason: `Its name is one letter from ${like}, a popular package. Check it is the package you meant: typosquats copy popular names.`,
		});
	}
	return advice;
}

/** An npm scope that reads as an organisation's own: @acme-internal, @corp, @private-tools. */
const INTERNAL_SCOPE = /^@(?:[a-z0-9_.-]*[-_.])?(?:internal|private|corp|intra|intranet|priv|inhouse|in-house)(?:[-_.][a-z0-9_.-]*)?$/;
const PUBLIC_NPM = /^https:\/\/registry\.(?:npmjs\.org|yarnpkg\.com)\//;

/** A file read for this check: its text, or why it was not read. */
type Read = { text: string } | { skipped: "missing" | "too large" | "not a plain file" | "unreadable" };

async function readPlain(path: string): Promise<Read> {
	try {
		const info = await lstat(path);
		// A link is not followed: it could lead out of the repository (invariant 14).
		if (!info.isFile()) return { skipped: "not a plain file" };
		if (info.size > MAX_BYTES) return { skipped: "too large" };
		return { text: await readFile(path, "utf8") };
	} catch (err) {
		return { skipped: (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable" };
	}
}

/** The scopes a repository's `.npmrc` sends to a registry other than the public one. Never the registry's address. */
export function privateScopes(npmrc: string): Set<string> {
	const scopes = new Set<string>();
	for (const line of npmrc.split(/\r?\n/)) {
		const match = /^\s*(@[a-z0-9_.-]+):registry\s*=\s*(\S+)/i.exec(line);
		if (match && !PUBLIC_NPM.test(`${match[2]!.replace(/\/?$/, "/")}`)) scopes.add(match[1]!.toLowerCase());
	}
	return scopes;
}

/** Each package a package-lock.json (v2 or v3) installs, with where it was resolved from, when it says. */
export function lockedPackages(lock: string): { name: string; resolved?: string }[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(lock);
	} catch {
		return [];
	}
	const packages = (parsed as { packages?: unknown } | null)?.packages;
	if (typeof packages !== "object" || packages === null) return [];
	const found: { name: string; resolved?: string }[] = [];
	for (const [path, entry] of Object.entries(packages as Record<string, unknown>)) {
		const at = path.lastIndexOf("node_modules/");
		if (at < 0) continue;
		const name = path.slice(at + "node_modules/".length);
		if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.~-]+$/i.test(name)) continue;
		const resolved = (entry as { resolved?: unknown } | null)?.resolved;
		found.push({ name, ...(typeof resolved === "string" ? { resolved } : {}) });
	}
	return found;
}

/**
 * Dependency confusion in one repository, from the files at its top: an `.npmrc` that sends a scope to
 * a private registry while the lockfile installed that scope from the public one (medium); a scope
 * that looks internal installed from the public registry (low); a requirements file that adds a
 * second index with `--extra-index-url`, which pip consults beside PyPI (medium). `unread` names the
 * files that were there and could not be read, so a quiet answer is never taken for a whole one.
 */
export async function confusionIn(repo: string): Promise<{ advice: PackageAdvice[]; unread: string[] }> {
	const advice: PackageAdvice[] = [];
	const unread: string[] = [];
	const read = async (name: string): Promise<string | null> => {
		const file = await readPlain(join(repo, name));
		if ("text" in file) return file.text;
		if (file.skipped !== "missing") unread.push(`${name} (${file.skipped})`);
		return null;
	};

	const npmrc = await read(".npmrc");
	const scopes = npmrc === null ? new Set<string>() : privateScopes(npmrc);
	const lock = await read("package-lock.json");
	if (lock !== null) {
		const seen = new Set<string>();
		for (const { name, resolved } of lockedPackages(lock)) {
			if (seen.has(name) || !name.startsWith("@")) continue;
			seen.add(name);
			const scope = name.slice(0, name.indexOf("/")).toLowerCase();
			const fromPublic = resolved !== undefined && PUBLIC_NPM.test(resolved);
			if (scopes.has(scope) && fromPublic) {
				advice.push({ kind: "confusion", level: "medium", ecosystem: "npm", name, reason: `.npmrc sends ${scope} to a private registry, but the lockfile installed this package from the public one. Check who published it, and install it again from your registry.` });
			} else if (INTERNAL_SCOPE.test(scope) && (fromPublic || resolved === undefined) && !scopes.has(scope)) {
				advice.push({ kind: "confusion", level: "low", ecosystem: "npm", name, reason: `${scope} reads as an organisation's own scope, and nothing sends it to a private registry. If it is yours, make sure your organisation owns the scope on npmjs.com.` });
			}
		}
	}

	let names: string[] = [];
	try {
		names = (await readdir(repo)).filter((name) => /^requirements[\w.-]*\.(?:txt|in)$/i.test(name)).sort();
	} catch {
		unread.push("the repository's top folder (unreadable)");
	}
	for (const name of names) {
		const text = await read(name);
		if (text === null) continue;
		if (/^\s*--extra-index-url\b/m.test(text)) {
			advice.push({
				kind: "confusion",
				level: "medium",
				ecosystem: "PyPI",
				reason: `${name} adds a second index with --extra-index-url. pip looks in it and in PyPI and takes the highest version, so a name your index serves could be claimed on PyPI. Use --index-url alone, or pin each package with --require-hashes.`,
			});
		}
	}
	return { advice, unread };
}

/** The ecosystem and name of a CycloneDX component this check knows, from its package URL. */
export function ecosystemOfPurl(purl: string | undefined): "npm" | "PyPI" | null {
	if (!purl) return null;
	if (purl.startsWith("pkg:npm/")) return "npm";
	if (purl.startsWith("pkg:pypi/")) return "PyPI";
	return null;
}
