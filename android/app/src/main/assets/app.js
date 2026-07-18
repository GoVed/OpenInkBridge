// web/example/app.js

document.addEventListener("DOMContentLoaded", () => {
    const consoleEl = document.getElementById("debug-log");
    
    function log(msg) {
        const time = new Date().toTimeString().split(' ')[0];
        consoleEl.innerHTML += `[${time}] ${msg}<br>`;
        consoleEl.scrollTop = consoleEl.scrollHeight;
        console.log(msg);
    }

    // Capture global JS errors
    window.onerror = function(message, source, lineno, colno, error) {
        log(`<span style='color: #dc3545;'>ERR: ${message} at ${source}:${lineno}</span>`);
        return false;
    };

    log("Initializing side-by-side performance comparison...");

    function detectEInkDevice() {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes("boox") || ua.includes("onyx")) return "Onyx Boox Note/Tablet Series";
        if (ua.includes("bigme")) return "Bigme Tablet Series";
        if (ua.includes("remarkable")) return "reMarkable Paper Tablet";
        if (ua.includes("kobo")) return "Kobo E-Reader";
        return "Standard Screen (PC/Mobile)";
    }

    log(`Detected Hardware: <strong>${detectEInkDevice()}</strong>`);

    const OpenInkBridgeCanvasClass = window.OpenInkBridge?.OpenInkBridgeCanvas || window.OpenInkBridgeCanvas;
    if (!OpenInkBridgeCanvasClass) {
        log("<span style='color: #dc3545;'>Error: OpenInkBridge SDK failed to load.</span>");
        return;
    }

    const isNativeBridge = window.OpenInkBridge?.openInkBridge?.isSupported();
    if (isNativeBridge) {
        log("<span style='color: #28a745; font-weight: bold;'>⚡ RUNNING IN NATIVE CONTAINER (Near-Zero Latency Active!)</span>");
    } else {
        log("<span style='color: #ffc107; font-weight: bold;'>⚠️ RUNNING IN BROWSER FALLBACK MODE (Latency is unoptimized)</span>");
        log("<span style='color: #ffc107;'>Standard browsers block direct E-Ink hardware framebuffers. To experience zero-latency drawing, compile and deploy the Android ':app' sample onto your Boox Note!</span>");
    }

    // -------------------------------------------------------------
    // 1. Initialize Optimized Canvas (OpenInkBridge)
    // -------------------------------------------------------------
    const canvasOpt = document.getElementById("canvas-opt");
    const chkStylusOnly = document.getElementById("chk-stylus-only");
    
    const isCompatible = detectEInkDevice() !== "Standard Screen (PC/Mobile)";
    chkStylusOnly.checked = isCompatible;

    let currentStrokeWidth = 4;

    const osCanvas = new OpenInkBridgeCanvasClass(canvasOpt, {
        strokeColor: "#28a745", // Green
        strokeWidth: currentStrokeWidth,
        smoothing: true,
        stylusOnly: chkStylusOnly.checked
    });
    osCanvas.enableDrawing();
    log(`Optimized Canvas initialized (Stylus Only: ${chkStylusOnly.checked}).`);

    chkStylusOnly.addEventListener("change", () => {
        const isChecked = chkStylusOnly.checked;
        osCanvas.setStyle("#28a745", currentStrokeWidth, isChecked);
        log(`Stylus Only Mode toggled: ${isChecked ? "ENABLED (palm rejection active)" : "DISABLED (touch drawing active)"}`);
    });

    // Expose a helper to update stroke width from Android WebView host
    window.setStrokeWidth = function(width) {
        currentStrokeWidth = width;
        if (osCanvas) {
            osCanvas.setStyle("#28a745", width, chkStylusOnly.checked);
        }
    };

    // -------------------------------------------------------------
    // 2. Initialize Traditional Canvas (Standard Whiteboard)
    // -------------------------------------------------------------
    const canvasTrad = document.getElementById("canvas-trad");
    const ctxTrad = canvasTrad.getContext("2d");
    
    // Scale traditional canvas for high-DPI support
    const dpr = window.devicePixelRatio || 1;
    function resizeTrad() {
        const rect = canvasTrad.getBoundingClientRect();
        canvasTrad.width = rect.width * dpr;
        canvasTrad.height = rect.height * dpr;
        ctxTrad.scale(dpr, dpr);
        ctxTrad.lineCap = "round";
        ctxTrad.lineJoin = "round";
        ctxTrad.strokeStyle = "#dc3545"; // Red
        ctxTrad.lineWidth = 4;
    }
    resizeTrad();
    window.addEventListener("resize", resizeTrad);

    let isDrawingTrad = false;
    let lastPointTrad = null;
    canvasTrad.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        isDrawingTrad = true;
        const rect = canvasTrad.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        lastPointTrad = { x, y, pressure: e.pressure || 0.5 };
        log(`Traditional: pointerdown x=${x.toFixed(0)}, y=${y.toFixed(0)}`);
    });

    canvasTrad.addEventListener("pointermove", (e) => {
        if (!isDrawingTrad || !lastPointTrad) return;
        e.preventDefault();
        const rect = canvasTrad.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const pressure = e.pressure || 0.5;

        const avgPressure = (lastPointTrad.pressure + pressure) / 2;
        const width = currentStrokeWidth * (0.3 + 1.4 * avgPressure);
        ctxTrad.lineWidth = width;
        
        ctxTrad.beginPath();
        ctxTrad.moveTo(lastPointTrad.x, lastPointTrad.y);
        ctxTrad.lineTo(x, y);
        ctxTrad.stroke();

        lastPointTrad = { x, y, pressure };

        if (window.OpenInkBridgeNative && window.OpenInkBridgeNative.onStrokeDrawn) {
            window.OpenInkBridgeNative.onStrokeDrawn();
        }
    });

    canvasTrad.addEventListener("pointerup", () => {
        if (isDrawingTrad) {
            isDrawingTrad = false;
            lastPointTrad = null;
            log("Traditional: stroke finished.");
            if (window.OpenInkBridgeNative && window.OpenInkBridgeNative.onStrokeDrawn) {
                window.OpenInkBridgeNative.onStrokeDrawn();
            }
        }
    });

    canvasTrad.addEventListener("pointercancel", () => {
        isDrawingTrad = false;
        lastPointTrad = null;
    });

    // -------------------------------------------------------------
    // 3. Clear Button
    // -------------------------------------------------------------
    const btnClear = document.getElementById("btn-clear");
    btnClear.addEventListener("click", () => {
        // Clear OpenInkBridge canvas
        osCanvas.clear();
        
        // Clear Traditional canvas
        ctxTrad.clearRect(0, 0, canvasTrad.width, canvasTrad.height);
        
        log("Both canvases cleared.");
    });

    // Monitor optimized stroke completions
    osCanvas.onStrokeFinished((strokePoints) => {
        log(`Optimized: stroke completed. Points count: ${strokePoints.length}`);
    });
});
