import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuardedRunner } from './guarded-runner';

test('a failing cycle never rejects the scheduled runner', async () => {
    const reported: unknown[] = [];
    const run = createGuardedRunner(
        async () => { throw new Error('SERVER_ERROR: Server returned HTTP status 502'); },
        error => reported.push(error)
    );

    await run();

    assert.equal(reported.length, 1);
    assert.match((reported[0] as Error).message, /502/);
});

test('the runner keeps working after a failed cycle', async () => {
    let attempts = 0;
    const run = createGuardedRunner(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient database outage');
    }, () => undefined);

    await run();
    await run();

    assert.equal(attempts, 2);
});

test('a new cycle is skipped while the previous one is still in flight', async () => {
    let started = 0;
    let release: () => void = () => undefined;
    const inFlight = new Promise<void>(resolve => { release = resolve; });
    const run = createGuardedRunner(async () => {
        started += 1;
        await inFlight;
    }, () => undefined);

    const first = run();
    await run();
    release();
    await first;

    assert.equal(started, 1);
});
