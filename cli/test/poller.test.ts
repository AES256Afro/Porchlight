import assert from "node:assert/strict";
import { test } from "node:test";
import { isStopped, poller, POLL_TRIES, waitUntil } from "../ui/poller.js";

/** A clock the test moves by hand: timers fire only when `advance` passes them. */
function fakeClock() {
	let now = 0;
	let next = 1;
	const timers = new Map<number, { at: number; run: () => void }>();
	return {
		timers: {
			set: (run: () => void, ms: number) => {
				const id = next++;
				timers.set(id, { at: now + ms, run });
				return id;
			},
			clear: (id: unknown) => void timers.delete(id as number),
		},
		pending: () => [...timers.values()].map((timer) => timer.at - now),
		async advance(ms: number) {
			const until = now + ms;
			for (;;) {
				const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				timers.delete(due[0]);
				now = due[1].at;
				due[1].run();
				// Let the poll's promise settle before the next timer.
				for (let i = 0; i < 10; i++) await Promise.resolve();
			}
			now = until;
		},
	};
}

function fakeVisibility(hidden = false) {
	const listeners = new Set<() => void>();
	return {
		visibility: { hidden: () => hidden, onChange: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)) },
		set(value: boolean) {
			hidden = value;
			for (const listener of listeners) listener();
		},
		listeners,
	};
}

const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

test("a poller asks again after each answer until told to stop", async () => {
	const clock = fakeClock();
	const answers = [true, true, false];
	let asked = 0;
	const poll = poller({ every: 800, timers: clock.timers, run: async () => answers[asked++] ?? false });
	poll.start();
	assert.equal(asked, 0);
	await clock.advance(800);
	assert.equal(asked, 1);
	await clock.advance(800);
	await clock.advance(800);
	assert.equal(asked, 3);
	assert.equal(poll.running(), false);
	await clock.advance(10_000);
	assert.equal(asked, 3, "a stopped poller asks nothing more");
});

test("one failed poll is forgiven with a longer wait, and the poller carries on (UI-B10)", async () => {
	const clock = fakeClock();
	const failures: number[] = [];
	let recovered = 0;
	let gaveUp: unknown = null;
	let asked = 0;
	const poll = poller({
		every: 800,
		timers: clock.timers,
		run: async () => {
			asked++;
			if (asked === 1) throw new Error("dropped");
			return asked < 3;
		},
		onFailure: (_err, count) => failures.push(count),
		onRecover: () => recovered++,
		onGiveUp: (err) => (gaveUp = err),
	});
	poll.start();
	await clock.advance(800);
	assert.deepEqual(failures, [1]);
	// The wait doubles after a failure.
	assert.deepEqual(clock.pending(), [1600]);
	await clock.advance(1600);
	assert.equal(recovered, 1);
	assert.equal(poll.running(), true, "still following after one failure and a success");
	await clock.advance(800);
	assert.equal(asked, 3);
	assert.equal(gaveUp, null);
});

test("a poller gives up after failures in a row, and says why", async () => {
	const clock = fakeClock();
	let gaveUp: unknown = null;
	let asked = 0;
	const poll = poller({
		every: 100,
		timers: clock.timers,
		maxWait: 1000,
		run: async () => {
			asked++;
			throw new Error("offline");
		},
		onGiveUp: (err) => (gaveUp = err),
	});
	poll.start();
	await clock.advance(60_000);
	assert.equal(asked, POLL_TRIES);
	assert.ok(gaveUp instanceof Error && gaveUp.message === "offline");
	assert.equal(poll.running(), false);
});

test("a poller waits while the tab is hidden and asks at once when it is shown (OP-8)", async () => {
	const clock = fakeClock();
	const tab = fakeVisibility(false);
	let asked = 0;
	const poll = poller({ every: 1000, timers: clock.timers, visibility: tab.visibility, run: async () => (asked++, true) });
	poll.start();
	await clock.advance(1000);
	assert.equal(asked, 1);
	tab.set(true);
	await clock.advance(10_000);
	assert.equal(asked, 1, "nothing is asked while hidden");
	tab.set(false);
	await settle();
	assert.equal(asked, 2, "shown again, it asks at once");
	poll.stop();
	assert.equal(tab.listeners.size, 0, "a stopped poller stops listening");
});

test("a poll is never started while the last is still out, so answers never overlap (R6U-9)", async () => {
	const clock = fakeClock();
	let inFlight = 0;
	let most = 0;
	let release: () => void = () => {};
	let asked = 0;
	const poll = poller({
		every: 100,
		timers: clock.timers,
		run: async () => {
			asked++;
			inFlight++;
			most = Math.max(most, inFlight);
			await new Promise<void>((resolve) => (release = resolve));
			inFlight--;
			return asked < 3;
		},
	});
	poll.now();
	poll.now();
	poll.now();
	await settle();
	assert.equal(asked, 1);
	release();
	await settle();
	// Asked for again while out: once more, right after the answer.
	assert.equal(asked, 2);
	release();
	await settle();
	await clock.advance(100);
	release();
	await settle();
	assert.equal(most, 1);
});

test("a number from a poll sets the next wait", async () => {
	const clock = fakeClock();
	let asked = 0;
	const poll = poller({ every: 1000, timers: clock.timers, run: async () => (asked++, 15_000) });
	poll.now();
	await settle();
	assert.deepEqual(clock.pending(), [15_000]);
	poll.stop();
	assert.deepEqual(clock.pending(), []);
	assert.equal(asked, 1);
});

test("waiting for a mural ends when it is done, and stops when cancelled (UI-B9)", async () => {
	const sleeps: number[] = [];
	const sleep = async (ms: number) => void sleeps.push(ms);
	let checks = 0;
	const value = await waitUntil({ every: 2000, sleep, check: async () => (++checks < 3 ? { done: false } : { done: true, value: "mural" }) });
	assert.equal(value, "mural");
	assert.deepEqual(sleeps, [2000, 2000, 2000]);

	const cancel = new AbortController();
	let asked = 0;
	const waiting = waitUntil({
		every: 2000,
		signal: cancel.signal,
		sleep,
		check: async () => {
			asked++;
			if (asked === 2) cancel.abort();
			return { done: false };
		},
	});
	await assert.rejects(waiting, (err: unknown) => isStopped(err));
	assert.equal(asked, 2, "nothing is asked after Cancel");

	// A failure on the server ends the wait with its reason, rather than polling for ever.
	await assert.rejects(
		waitUntil({ every: 1, sleep, check: async () => Promise.reject(new Error("The mural was replaced or stopped elsewhere.")) }),
		/replaced/,
	);
});
