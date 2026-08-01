# Web & WebApp Integration Guide

The `@openinkbridge/web` package provides low-latency stylus drawing inside the Android E-Ink WebView wrapper and standard Pointer Events rendering in other browsers. No fixed latency is guaranteed across devices.

---

## 1. Installation

Install the package via npm or yarn:

```bash
npm install @openinkbridge/web
```

---

## 2. Basic HTML5 Canvas Integration

To integrate OpenInkBridge into a standard web page, bind the `OpenInkBridgeCanvas` class to an HTML5 canvas:

```html
<div id="canvas-container" style="position: relative; width: 800px; height: 600px;">
    <canvas id="drawing-canvas"></canvas>
</div>

<script type="module">
    import { OpenInkBridgeCanvas } from '@openinkbridge/web';

    const canvasElement = document.getElementById("drawing-canvas");
    
    // Initialize the wrapper
    const canvas = new OpenInkBridgeCanvas(canvasElement, {
        strokeColor: "#000000",
        strokeWidth: 4,
        smoothing: true // Applies the shared 0.25 / 0.50 / 0.25 filter
    });

    // Start drawing capture
    canvas.enableDrawing();

    // Listen to finalized vector strokes
    canvas.onStrokeFinished((points) => {
        console.log("Captured path:", points);
    });

    // Call canvas.destroy() when this editor is permanently removed.
</script>
```

### Layout

The native bridge uses the canvas parent's `getBoundingClientRect()` as the drawing region (or the canvas itself when it has no parent). Give that element explicit, stable dimensions; the SDK recomputes the region when the window resize event fires. No particular CSS `position` value is required.

---

## 3. React Integration

Use the plug-and-play React component for simple drop-in setups:

```tsx
import React from 'react';
import type { StrokePoint } from '@openinkbridge/web';
import { OpenInkBridgeCanvasComponent } from '@openinkbridge/web/react';

function DrawingApp() {
    const handleStrokeFinished = (points: StrokePoint[]) => {
        console.log(`User finished a stroke with ${points.length} points.`);
    };

    return (
        <div style={{ width: '800px', height: '600px', border: '1px solid #ccc' }}>
            <OpenInkBridgeCanvasComponent
                strokeColor="#000000"
                strokeWidth={5}
                smoothing={true}
                onStrokeFinished={handleStrokeFinished}
            />
        </div>
    );
}
```

---

## 4. Optional WebAssembly Core

`OpenInkBridgeCanvas` attempts to initialize Wasm in the background, but a clean checkout has no generated Wasm bindings. A normal npm build uses the JavaScript fallback unless bindings were generated separately. That fallback implements the same smoothing contract.

To preload a generated artifact, inspect the loader's boolean result. `initOpenInkBridgeWasm()` resolves `true` after successful initialization and `false` when loading fails or no generated module is present; fallback availability is not reported by a rejected promise.

```javascript
import {
    initOpenInkBridgeWasm,
    isOpenInkBridgeWasmInitialized
} from '@openinkbridge/web';

const loaded = await initOpenInkBridgeWasm();
console.log(loaded ? "Wasm smoothing loaded." : "Using JavaScript smoothing.");
console.log(isOpenInkBridgeWasmInitialized());
```

---

## 5. Lifecycle

`disableDrawing()` is reversible: it removes active input/native-overlay handling and a later `enableDrawing()` restores it. `destroy()` is terminal and also releases the bridge session and shared resize subscription. The React component calls `destroy()` automatically when it unmounts.

---

## 6. API Reference

### `OpenInkBridgeCanvas`

| Method / Property | Type | Description |
| :--- | :--- | :--- |
| `enableDrawing()` | `() => void` | Turns on E-Ink native overlay interceptor or standard pointer listeners. |
| `disableDrawing()` | `() => void` | Temporarily disables native drawing and pointer listeners. |
| `destroy()` | `() => void` | Permanently releases this canvas, its bridge session, listeners, and backing surface. |
| `setStyle(color, width, stylusOnly?)` | `(string, number, boolean?) => void` | Updates brush color, line width, and optional stylus-only routing. |
| `clear()` | `() => void` | Clears local HTML5 canvas drawing context and the E-Ink hardware direct layer. |
| `exportToSvg()` | `() => string` | Returns the complete vector drawing represented as an XML SVG string. |
| `getDocument()` | `() => InkDocument` | Returns a defensive copy of the document and stroke styles. |
| `getStrokes()` | `() => StrokePoint[][]` | Returns a defensive, point-only copy of all completed strokes. |
| `onStrokeFinished(callback)` | `(cb) => () => void` | Subscribes to pen-lift events. Returns an unsubscribe function. |

---

## 7. Verification

From `web/`:

```bash
npm ci
npm test
npm pack --dry-run --ignore-scripts
```

To generate and then test the optional Rust implementation, install `wasm-pack` and run `npm run build:wasm` before the package checks.
