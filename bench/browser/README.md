# Browser search benchmark

The harness builds the docs site's worker entry and serves it with the generated
docs index over gzip HTTP on loopback. Each mode starts in five fresh pages.
Cold time runs from importing the search client through receiving the first five
hydrated results for “hybrid search”. The harness then warms five queries and
records 30 queries per page. The summary takes the median of five cold starts
and the nearest-rank p95 of all 150 warm samples per mode.

Transferred bytes are gzip response bodies served through the first answer.
The Wasm file embeds the model weights, so both count together. The docs page
transfer is measured separately on a fresh visit to the search quality guide.
The small benchmark shell, HTTP headers, and public-network latency are excluded
from the search totals. Timing covers worker startup, retrieval and result
transfer to the caller. Rendering, UI debounce and human typing are outside
the timed interval.

## Desktop results

19 November 2026, AMD Ryzen 7 7800X3D, Linux under WSL2, headless Chromium
151.0.7922.34. The measured docs index contained 56 chunks. Body sizes below
are bytes through the first answer. A separate visit to the documentation
page transferred 235,071 bytes of application content.

| Mode | Cold median (ms) | Warm p95 (ms) | Runtime JS (B) | Index (B) | Model + Wasm (B) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Lexical | 17.6 | 0.3 | 9,138 | 28,801 | 0 |
| Hybrid | 199.3 | 1.3 | 11,475 | 48,982 | 5,048,274 |

On this corpus the first hybrid search paid most of its transfer cost for the
model. Once warm, the worker returned the first five hydrated results within
1.3 ms at p95. Physical-phone measurements are pending.
[Download the recorded samples](./2026-11-19-desktop.json).

## Run

With workspace dependencies installed:

```sh
pnpm --filter @seekite/core --filter @seekite/build --filter @seekite/embeddings-ternlight build
pnpm --filter @seekite/docs build
pnpm --filter @seekite/docs exec playwright install chromium
node apps/docs/scripts/bench-browser.mjs > browser-run.json
```

Use an otherwise-idle machine. The JSON includes every timing sample, payload
counts, browser version, host OS, device label, and digest of the measured
index. A new index build changes the digest, including its manifest timestamp.

For a physical Android run, enable USB debugging, connect a dedicated test phone
with Chrome running, and forward the debugging socket and loopback server port:

```sh
adb forward tcp:9222 localabstract:chrome_devtools_remote
adb reverse tcp:4175 tcp:4175
BENCH_PORT=4175 BENCH_CDP=http://127.0.0.1:9222 BENCH_DEVICE="phone model and Android version" \
  node apps/docs/scripts/bench-browser.mjs > phone-run.json
```

Connected Chrome uses fresh pages in its existing profile. All harness assets
are served with `Cache-Control: no-store`. Record physical-device results
separately from desktop results.
