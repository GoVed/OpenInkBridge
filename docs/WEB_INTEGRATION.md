# Web & WebApp Integration Guide

The `@openinkbridge/web` package allows web applications to run with zero-latency stylus drawing inside supported E-Ink WebView wrappers, while falling back to standard pointer rendering on desktop and standard mobile browsers.

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
        smoothing: true // Enables coordinate line smoothing
    });

    // Start drawing capture
    canvas.enableDrawing();

    // Listen to finalized vector strokes
    canvas.onStrokeFinished((points) => {
        console.log("Captured path:", points);
    });
</script>
```

### Important Layout Requirement:
For E-Ink latency compensation to work properly, the `<canvas>` element **must** be inside a relative or absolute positioned parent container (`#canvas-container`). The native EPD overlay view will attach itself exactly over this parent container.

---

## 3. React Integration

Use the plug-and-play React component for simple drop-in setups:

```tsx
import React from 'react';
import { OpenInkBridgeCanvasComponent, StrokePoint } from '@openinkbridge/web';

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

## 4. Pre-loading WebAssembly Core

By default, the SDK automatically initializes the WebAssembly binary in the background upon class instantiation. If you wish to pre-load the WASM binary during application startup to prevent any initial JS math fallback delays, call the loader manually:

```javascript
import { initOpenInkBridgeWasm } from '@openinkbridge/web';

// Run on application mount
initOpenInkBridgeWasm()
    .then(() => console.log("OpenInkBridge WebAssembly loaded."))
    .catch((err) => console.warn("Failed to load WASM, using JS fallback."));
```

---

## 5. API Reference

### `OpenInkBridgeCanvas`

| Method / Property | Type | Description |
| :--- | :--- | :--- |
| `enableDrawing()` | `() => void` | Turns on E-Ink native overlay interceptor or standard pointer listeners. |
| `disableDrawing()` | `() => void` | Releases overlays and touch listeners. |
| `setStyle(color: string, width: number)` | `(string, number) => void` | Dynamically updates brush color and line width. |
| `clear()` | `() => void` | Clears local HTML5 canvas drawing context and the E-Ink hardware direct layer. |
| `exportToSvg()` | `() => string` | Returns the complete vector drawing represented as an XML SVG string. |
| `getStrokes()` | `() => StrokePoint[][]` | Returns the raw coordinate data array for all completed strokes. |
| `onStrokeFinished(callback)` | `(cb) => () => void` | Subscribes to pen-lift events. Returns an unsubscribe function. |
