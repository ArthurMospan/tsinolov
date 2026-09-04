// Schema setup runs once, but a failed attempt must not be cached: a rejected
// promise kept forever would make every later query fail, leaving the service
// alive yet unable to read anything until it is restarted by hand.
export function createLazyBootstrap(run: () => Promise<void>): () => Promise<void> {
    let pending: Promise<void> | null = null;
    return () => {
        if (!pending) {
            pending = run().catch(error => {
                pending = null;
                throw error;
            });
        }
        return pending;
    };
}
