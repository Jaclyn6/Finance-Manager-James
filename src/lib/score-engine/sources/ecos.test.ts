import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wrapper tests for `fetchEcosSeries`. We stub `globalThis.fetch` so
 * the test stays network-free and deterministic; the underlying parser
 * is exercised by `ecos-parse.test.ts` so this file focuses on:
 *   - URL composition (path-segment API key, encoded segments)
 *   - timeout / abort behaviour
 *   - HTTP-error mapping to fetch_status: "error"
 *   - missing-env-var throws
 *   - error-envelope passthrough from the parser
 *
 * `import "server-only"` works under Vitest because the package is a
 * no-op outside Next's bundler.
 */

const ORIGINAL_KEY = process.env.ECOS_API_KEY;

beforeEach(() => {
  process.env.ECOS_API_KEY = "TEST_KEY_VALUE";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ECOS_API_KEY;
  } else {
    process.env.ECOS_API_KEY = ORIGINAL_KEY;
  }
});

type FetchArgs = [input: string, init: RequestInit];
type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

describe("fetchEcosSeries — URL composition", () => {
  it("embeds the API key as a path segment (not a query param) and encodes each segment", async () => {
    const fetchSpy = vi.fn<FetchFn>(async () => okJson({
      StatisticSearch: {
        list_total_count: 1,
        row: [
          {
            STAT_CODE: "722Y001",
            ITEM_CODE1: "0101000",
            TIME: "202401",
            DATA_VALUE: "3.5",
          },
        ],
      },
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchEcosSeries } = await import("./ecos");
    const result = await fetchEcosSeries("722Y001", {
      cycle: "M",
      from: "202401",
      to: "202412",
      itemCode: "0101000",
    });

    expect(result.fetch_status).toBe("success");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl] = fetchSpy.mock.calls[0] as FetchArgs;
    expect(calledUrl).toBe(
      "https://ecos.bok.or.kr/api/StatisticSearch/TEST_KEY_VALUE/json/kr/1/10000/722Y001/M/202401/202412",
    );
    // The key MUST be a path segment, not a `?api_key=` query param.
    expect(calledUrl).not.toContain("api_key=");
    expect(calledUrl).not.toContain("?");
  });

  it("URL-encodes a key with reserved characters", async () => {
    process.env.ECOS_API_KEY = "key/with?special chars";
    const fetchSpy = vi.fn<FetchFn>(async () => okJson({
      StatisticSearch: { row: [] },
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchEcosSeries } = await import("./ecos");
    await fetchEcosSeries("X", { cycle: "D", from: "20260101", to: "20260105" });

    const [calledUrl] = fetchSpy.mock.calls[0] as FetchArgs;
    expect(calledUrl).toContain("/key%2Fwith%3Fspecial%20chars/");
  });

  it("uses cache: 'no-store' for fresh data", async () => {
    const fetchSpy = vi.fn<FetchFn>(async () => okJson({
      StatisticSearch: { row: [{ ITEM_CODE1: "A", TIME: "202401", DATA_VALUE: "1" }] },
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchEcosSeries } = await import("./ecos");
    await fetchEcosSeries("X", {
      cycle: "M",
      from: "202401",
      to: "202401",
      itemCode: "A",
    });

    const [, init] = fetchSpy.mock.calls[0] as FetchArgs;
    expect(init).toMatchObject({ cache: "no-store" });
  });
});

describe("fetchEcosSeries — error paths", () => {
  it("throws when ECOS_API_KEY is unset (config error, not transient)", async () => {
    delete process.env.ECOS_API_KEY;
    const { fetchEcosSeries } = await import("./ecos");
    await expect(
      fetchEcosSeries("722Y001", {
        cycle: "M",
        from: "202401",
        to: "202412",
      }),
    ).rejects.toThrow(/ECOS_API_KEY is not set/);
  });

  it("returns fetch_status: 'error' on non-200 HTTP", async () => {
    const fetchSpy = vi.fn<FetchFn>(async () => new Response("internal error", {
      status: 500,
      statusText: "Internal Server Error",
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchEcosSeries } = await import("./ecos");
    const result = await fetchEcosSeries("X", {
      cycle: "M",
      from: "202401",
      to: "202401",
    });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/HTTP 500/);
    expect(result.observations).toEqual([]);
  });

  it("returns fetch_status: 'error' on network throw (does not propagate)", async () => {
    const fetchSpy = vi.fn<FetchFn>(async () => {
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchEcosSeries } = await import("./ecos");
    const result = await fetchEcosSeries("X", {
      cycle: "M",
      from: "202401",
      to: "202401",
    });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/ECONNRESET/);
  });

  it("returns a timeout error when the upstream hangs past 15s", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn<FetchFn>(
      (_url, init) =>
        // Never resolve; instead reject when AbortController fires.
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchEcosSeries } = await import("./ecos");
    const promise = fetchEcosSeries("X", {
      cycle: "M",
      from: "202401",
      to: "202401",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;
    expect(result.fetch_status).toBe("error");
    expect(result.error).toMatch(/timed out/);
    vi.useRealTimers();
  });

  it("propagates ECOS error envelopes (INFO-100 / INFO-200) from the parser", async () => {
    const fetchSpy = vi.fn<FetchFn>(async () => okJson({
      RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." },
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchEcosSeries } = await import("./ecos");
    const result = await fetchEcosSeries("BAD_CODE", {
      cycle: "M",
      from: "202401",
      to: "202412",
    });
    expect(result.fetch_status).toBe("error");
    expect(result.error).toContain("INFO-200");
  });
});

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
