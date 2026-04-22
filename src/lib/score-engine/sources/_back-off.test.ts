import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchWithBackOff } from "./_back-off";

/**
 * Network-free tests for the back-off helper. We mock `globalThis.fetch`
 * so retry logic is exercised without real HTTP, and shrink the
 * per-retry delay to ~0ms so the test suite runs in milliseconds.
 */

function makeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchWithBackOff", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Use fake timers so exponential-back-off sleep() doesn't slow the
    // suite. We advance them manually after each attempt.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("returns immediately on 200 OK with no retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchWithBackOff("https://example.test/ok", {
      method: "GET",
    });

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on 429 then returns 200 on the second attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, { error: "rate limit" }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchWithBackOff(
      "https://example.test/rl",
      { method: "GET" },
      { maxRetries: 2, initialDelayMs: 10 },
    );

    // First attempt resolves immediately, then a 10ms sleep, then
    // second attempt. Advance time to cover the sleep.
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchWithBackOff(
      "https://example.test/5xx",
      { method: "GET" },
      { maxRetries: 2, initialDelayMs: 10 },
    );

    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and returns the last bad Response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(503));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchWithBackOff(
      "https://example.test/down",
      { method: "GET" },
      { maxRetries: 2, initialDelayMs: 10 },
    );

    // Advance through both retry delays (10ms + 20ms).
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    // 3 total attempts: initial + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe(503);
    expect(result.ok).toBe(false);
  });

  it("does NOT retry on 4xx other than 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(404));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchWithBackOff(
      "https://example.test/missing",
      { method: "GET" },
      { maxRetries: 2, initialDelayMs: 10 },
    );

    expect(result.status).toBe(404);
    // 404 is a terminal client error — one attempt, no retries.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-throws the final network error after exhausting retries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = fetchWithBackOff(
      "https://example.test/net",
      { method: "GET" },
      { maxRetries: 1, initialDelayMs: 10 },
    );

    // Need to attach a rejection handler before advancing timers so
    // Vitest doesn't flag an unhandled rejection while we wait.
    const assertion = expect(promise).rejects.toThrow("network down");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
