import test from 'node:test';
import assert from 'node:assert/strict';
import { createLazyBootstrap } from './lazy-bootstrap';

test('a bootstrap that failed is retried on the next call', async () => {
    let attempts = 0;
    const ready = createLazyBootstrap(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('SERVER_ERROR: Server returned HTTP status 502');
    });

    await assert.rejects(ready(), /502/);
    await ready();

    assert.equal(attempts, 2);
});

test('a successful bootstrap runs only once', async () => {
    let attempts = 0;
    const ready = createLazyBootstrap(async () => { attempts += 1; });

    await ready();
    await ready();
    await ready();

    assert.equal(attempts, 1);
});

test('callers waiting together share one bootstrap attempt', async () => {
    let attempts = 0;
    const ready = createLazyBootstrap(async () => {
        attempts += 1;
        await new Promise(resolve => setTimeout(resolve, 10));
    });

    await Promise.all([ready(), ready(), ready()]);

    assert.equal(attempts, 1);
});
