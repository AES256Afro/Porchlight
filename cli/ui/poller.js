// @ts-check
// One way to ask the server again and again (OP-8, UI-C2): one request at a time, each started only
// after the last has answered (so a slow link never draws an older answer over a newer one, R6U-9),
// a few failures in a row forgiven with a growing wait, and nothing asked while the tab is hidden.
// No DOM here: the clock and the tab's visibility are handed in, so it is tested directly.

/**
 * What a poll says about the next one: `false` stops, `true` asks again after the usual wait, and a
 * number asks again after that many milliseconds.
 *
 * @typedef {boolean | number} PollAnswer
 */

/**
 * Whether the page is hidden, and a way to hear when that changes. In the page this is
 * `pageVisibility()` from dom.js; tests pass their own.
 *
 * @typedef {{ hidden: () => boolean, onChange: (listener: () => void) => () => void }} Visibility
 */

/** @typedef {{ set: (run: () => void, ms: number) => unknown, clear: (id: unknown) => void }} Timers */

/** @type {Timers} */
const REAL_TIMERS = {
	set: (run, ms) => setTimeout(run, ms),
	clear: (id) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (id)),
};

/** How many polls in a row may fail before the poller gives up. */
export const POLL_TRIES = 5;

/**
 * @param {{
 *   run: () => Promise<PollAnswer>,
 *   every: number,
 *   tries?: number,
 *   maxWait?: number,
 *   onFailure?: (err: unknown, failures: number) => void,
 *   onRecover?: () => void,
 *   onGiveUp?: (err: unknown) => void,
 *   visibility?: Visibility | null,
 *   timers?: Timers,
 * }} options
 *   `run` asks once. `every` is the usual wait. After a failure the wait doubles, up to `maxWait`;
 *   after `tries` failures in a row the poller stops and `onGiveUp` is told. `onFailure` hears each
 *   failure that is forgiven, and `onRecover` the first success after one.
 */
export function poller(options) {
	const timers = options.timers ?? REAL_TIMERS;
	const tries = options.tries ?? POLL_TRIES;
	const maxWait = options.maxWait ?? 30_000;
	/** @type {unknown} */
	let timer = null;
	let stopped = true;
	let inFlight = false;
	/** Asked for again while a request was out: run once more as soon as it answers. */
	let again = false;
	/** A poll came due while the tab was hidden: run it when the tab is shown. */
	let due = false;
	let failures = 0;
	/** @type {(() => void) | null} */
	let unlisten = null;

	const schedule = (/** @type {number} */ ms) => {
		if (timer !== null) timers.clear(timer);
		timer = timers.set(() => {
			timer = null;
			fire();
		}, ms);
	};

	const fire = () => {
		if (stopped) return;
		if (options.visibility?.hidden()) {
			due = true;
			return;
		}
		void tick();
	};

	const tick = async () => {
		if (inFlight) {
			again = true;
			return;
		}
		inFlight = true;
		/** @type {PollAnswer} */
		let answer;
		try {
			answer = await options.run();
		} catch (err) {
			inFlight = false;
			if (stopped) return;
			failures++;
			if (failures >= tries) {
				stop();
				options.onGiveUp?.(err);
				return;
			}
			options.onFailure?.(err, failures);
			schedule(Math.min(maxWait, options.every * 2 ** failures));
			return;
		}
		inFlight = false;
		if (stopped) return;
		if (failures > 0) {
			failures = 0;
			options.onRecover?.();
		}
		if (again) {
			again = false;
			return void tick();
		}
		if (answer === false) return stop();
		schedule(typeof answer === "number" ? answer : options.every);
	};

	const shown = () => {
		if (stopped || options.visibility?.hidden() || !due) return;
		due = false;
		void tick();
	};

	function stop() {
		stopped = true;
		due = false;
		again = false;
		if (timer !== null) timers.clear(timer);
		timer = null;
		unlisten?.();
		unlisten = null;
	}

	return {
		/**
		 * Starts following, or carries on: the next poll after `delay` (the usual wait unless given). A
		 * poller already running is rescheduled, never doubled.
		 *
		 * @param {number} [delay]
		 */
		start(delay = options.every) {
			if (stopped) {
				stopped = false;
				failures = 0;
				unlisten ??= options.visibility?.onChange(shown) ?? null;
			}
			if (!inFlight) schedule(delay);
		},
		/** Asks now (or as soon as the request that is out has answered), then carries on as usual. */
		now() {
			if (stopped) {
				stopped = false;
				failures = 0;
				unlisten ??= options.visibility?.onChange(shown) ?? null;
			}
			if (timer !== null) timers.clear(timer);
			timer = null;
			if (options.visibility?.hidden()) {
				due = true;
				return;
			}
			void tick();
		},
		stop,
		/** Whether it is following: started, and neither stopped nor given up. */
		running: () => !stopped,
	};
}

/**
 * Waits until `check` says the work is done, asking every `every` milliseconds, and stops early when
 * `signal` is aborted (the owner pressed Cancel), throwing an error marked `stopped`. Used for a
 * one-off wait such as a mural being written (UI-B9).
 *
 * @template T
 * @param {{ check: () => Promise<{ done: true, value: T } | { done: false }>, every: number, signal?: AbortSignal, sleep?: (ms: number, signal?: AbortSignal) => Promise<void> }} options
 * @returns {Promise<T>}
 */
export async function waitUntil({ check, every, signal, sleep = pause }) {
	for (;;) {
		if (signal?.aborted) throw stoppedError();
		await sleep(every, signal);
		if (signal?.aborted) throw stoppedError();
		const answer = await check();
		if (signal?.aborted) throw stoppedError();
		if (answer.done) return answer.value;
	}
}

/** @returns {Error & { stopped: true }} */
function stoppedError() {
	return Object.assign(new Error("Stopped"), { stopped: /** @type {const} */ (true) });
}

/** @param {unknown} err */
export function isStopped(err) {
	return typeof err === "object" && err !== null && /** @type {{ stopped?: unknown }} */ (err).stopped === true;
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function pause(ms, signal) {
	return new Promise((resolve) => {
		const id = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(id);
				resolve();
			},
			{ once: true },
		);
	});
}
