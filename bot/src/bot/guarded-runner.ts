type Reporter = (error: unknown) => void;

// A background cycle must never reject: an unhandled rejection terminates the
// whole process, so a transient Turso or MCP outage would take the API down
// with it. Failures are reported and the next cycle starts clean.
export function createGuardedRunner(task: () => Promise<unknown>, report: Reporter): () => Promise<void> {
    let running = false;
    return async () => {
        if (running) return;
        running = true;
        try {
            await task();
        } catch (error) {
            report(error);
        } finally {
            running = false;
        }
    };
}
