# `@openinkbridge/web`

The web SDK provides a session-isolated canvas API with native Android WebView
integration and a Pointer Events fallback.

## Build and test

```sh
npm ci
npm test
npm pack --dry-run
```

`npm run build` is deterministic from a clean checkout. It compiles the SDK and
the browser-global bundle using the pinned local `esbuild`; it does not download
tools through `npx`.

## Optional Rust/WASM acceleration

The JavaScript fallback uses the same zero-phase `0.25 / 0.50 / 0.25` smoothing
kernel as the Rust core, so generated WASM is not required for correctness.

To include the Rust implementation in a release artifact, install `wasm-pack`
and run:

```sh
npm run build:wasm
```

That command writes durable bindings under `generated/wasm/` and copies
`openinkbridge_core.js` and its `.wasm` binary into `dist/wasm/`. The normal
loader discovers the distribution files at runtime. Applications with a custom
asset pipeline can instead call `configureOpenInkBridgeWasmLoader(() => import(...))`
before constructing a canvas.

`initOpenInkBridgeWasm()` resolves `true` when bindings initialize and `false`
when the generated module is absent or loading fails. It normally does not reject
for this expected fallback case; use `isOpenInkBridgeWasmInitialized()` when a
synchronous status check is needed.

## Lifecycle

Each `OpenInkBridgeCanvas` owns a unique bridge session. Call `destroy()` when a
canvas is removed; this disables native drawing, releases pointer handlers, and
unsubscribes the shared resize listener. The React component does this
automatically during effect cleanup.

The original `window.onOpenInkBridgeStrokeFinished(JSON.stringify(points))`
callback remains supported. Protocol-v1 native hosts may send a scoped envelope:

```json
{
  "protocolVersion": 1,
  "type": "strokeFinished",
  "sessionId": "the-session-id-from-setWritingMode",
  "canvasId": "editor-canvas",
  "payload": { "points": [] }
}
```
