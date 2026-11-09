import { SaveQueue } from "./saveQueue";

/** A save whose outcome the test decides, one call at a time. */
function harness() {
  const calls: { text: string; ok: () => void; fail: () => void }[] = [];
  const stored: string[] = [];
  const settled: boolean[] = [];
  const queue = new SaveQueue(
    (text) =>
      new Promise((resolve, reject) => {
        calls.push({
          text,
          ok: () => {
            stored.push(text);
            resolve();
          },
          fail: () => reject(new Error("no")),
        });
      }),
    (failed) => settled.push(failed),
  );
  return { calls, stored, settled, queue };
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe("SaveQueue", () => {
  it("saves one at a time, in order", async () => {
    const { calls, stored, queue } = harness();
    queue.change("a");
    void queue.flush();
    queue.change("ab");
    void queue.flush();
    await tick();
    expect(calls.map((c) => c.text)).toEqual(["a"]);
    calls[0].ok();
    await tick();
    expect(calls.map((c) => c.text)).toEqual(["a", "ab"]);
    calls[1].ok();
    await tick();
    expect(stored).toEqual(["a", "ab"]);
    expect(queue.busy).toBe(false);
  });

  it("flush waits for a save already running, for Back to rely on", async () => {
    const { calls, queue } = harness();
    queue.change("a");
    void queue.flush();
    await tick();
    let done = false;
    void queue.flush().then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    calls[0].fail();
    await tick();
    expect(done).toBe(true);
    expect(queue.hasUnsaved).toBe(true);
  });

  it("keeps the newest text when two saves in a row fail", async () => {
    const { calls, stored, queue } = harness();
    queue.change("a");
    void queue.flush();
    queue.change("ab");
    void queue.flush();
    await tick();
    calls[0].fail();
    await tick();
    calls[1].fail();
    await tick();
    expect(queue.hasUnsaved).toBe(true);
    void queue.flush();
    await tick();
    calls[2].ok();
    await tick();
    expect(stored).toEqual(["ab"]);
  });

  it("never writes older text over newer after an early failure", async () => {
    const { calls, stored, settled, queue } = harness();
    queue.change("a");
    void queue.flush();
    queue.change("ab");
    void queue.flush();
    await tick();
    calls[0].fail();
    await tick();
    calls[1].ok();
    await tick();
    expect(queue.hasUnsaved).toBe(false);
    void queue.flush();
    await tick();
    expect(calls).toHaveLength(2);
    expect(stored).toEqual(["ab"]);
    expect(settled).toEqual([false]);
  });

  it("keeps what's typed during a save that then fails", async () => {
    const { calls, stored, queue } = harness();
    queue.change("a");
    void queue.flush();
    await tick();
    queue.change("abc");
    calls[0].fail();
    await tick();
    void queue.flush();
    await tick();
    calls[1].ok();
    await tick();
    expect(stored).toEqual(["abc"]);
  });
});
