"use strict";
var OpenInkBridge = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/global.ts
  var global_exports = {};
  __export(global_exports, {
    OpenInkBridgeCanvas: () => OpenInkBridgeCanvas,
    initOpenInkBridgeWasm: () => initOpenInkBridgeWasm,
    openInkBridge: () => openInkBridge
  });

  // src/bridge.ts
  var OpenInkBridge = class {
    constructor() {
      this.strokeCallbacks = [];
      this.strokeStartCallbacks = [];
      this.strokeUpdateCallbacks = [];
      this.fallbackCanvas = null;
      this.fallbackCtx = null;
      this.currentFallbackStroke = [];
      this.isDrawingFallback = false;
      if (typeof window !== "undefined") {
        window.onOpenInkBridgeStrokeFinished = (strokeJson) => {
          try {
            const points = JSON.parse(strokeJson);
            this.notifyStrokeCallbacks(points);
          } catch (e) {
            console.error("OpenInkBridge: Failed to parse stroke data from native client", e);
          }
        };
      }
    }
    /**
     * Check if the web app is running inside a native OpenInkBridge container.
     */
    isSupported() {
      return typeof window !== "undefined" && typeof window.OpenInkBridgeNative !== "undefined";
    }
    /**
     * Set writing mode. 
     * If supported, it enables the high-performance native E-Ink overlay.
     * If running in a standard web browser, it sets up standard pointer fallback listeners.
     */
    setWritingMode(enabled, targetElement, options) {
      if (this.isSupported()) {
        const rect = targetElement.getBoundingClientRect();
        const payload = {
          color: options?.color || "#000000",
          width: options?.width || 4,
          stylusOnly: options?.stylusOnly !== false,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }
        };
        window.OpenInkBridgeNative.setWritingMode(enabled, JSON.stringify(payload));
        return;
      }
      if (enabled) {
        this.setupFallbackListeners(targetElement, options);
      } else {
        this.removeFallbackListeners(targetElement);
      }
    }
    /**
     * Notify the native bridge that the stroke has been successfully redrawn on the software canvas.
     */
    onStrokeDrawn() {
      if (this.isSupported() && typeof window.OpenInkBridgeNative.onStrokeDrawn === "function") {
        window.OpenInkBridgeNative.onStrokeDrawn();
      }
    }
    /**
     * Listen to finalized strokes.
     */
    onStrokeFinished(callback) {
      this.strokeCallbacks.push(callback);
      return () => {
        this.strokeCallbacks = this.strokeCallbacks.filter((cb) => cb !== callback);
      };
    }
    /**
     * Listen to the start of a stylus stroke (pen down).
     */
    onStrokeStarted(callback) {
      this.strokeStartCallbacks.push(callback);
      return () => {
        this.strokeStartCallbacks = this.strokeStartCallbacks.filter((cb) => cb !== callback);
      };
    }
    /**
     * Listen to live updates during a stylus stroke (pen drag).
     */
    onStrokeUpdated(callback) {
      this.strokeUpdateCallbacks.push(callback);
      return () => {
        this.strokeUpdateCallbacks = this.strokeUpdateCallbacks.filter((cb) => cb !== callback);
      };
    }
    notifyStrokeCallbacks(points) {
      this.strokeCallbacks.forEach((cb) => cb(points));
    }
    notifyStrokeStarted(point) {
      this.strokeStartCallbacks.forEach((cb) => cb(point));
    }
    notifyStrokeUpdated(point) {
      this.strokeUpdateCallbacks.forEach((cb) => cb(point));
    }
    setupFallbackListeners(element, options) {
      const handlePointerDown = (e) => {
        if (options?.stylusOnly && e.pointerType !== "pen") return;
        e.preventDefault();
        try {
          element.setPointerCapture(e.pointerId);
        } catch (err) {
        }
        this.isDrawingFallback = true;
        const pt = this.getPointFromEvent(e, element);
        this.currentFallbackStroke = [pt];
        this.notifyStrokeStarted(pt);
      };
      const handlePointerMove = (e) => {
        if (!this.isDrawingFallback) return;
        if (options?.stylusOnly && e.pointerType !== "pen") return;
        e.preventDefault();
        const pt = this.getPointFromEvent(e, element);
        this.currentFallbackStroke.push(pt);
        this.notifyStrokeUpdated(pt);
      };
      const handlePointerUp = (e) => {
        if (!this.isDrawingFallback) return;
        this.isDrawingFallback = false;
        try {
          element.releasePointerCapture(e.pointerId);
        } catch (err) {
        }
        if (this.currentFallbackStroke.length > 0) {
          this.notifyStrokeCallbacks(this.currentFallbackStroke);
        }
        this.currentFallbackStroke = [];
      };
      const handlePointerCancel = (e) => {
        if (!this.isDrawingFallback) return;
        this.isDrawingFallback = false;
        try {
          element.releasePointerCapture(e.pointerId);
        } catch (err) {
        }
        this.currentFallbackStroke = [];
      };
      element._openInkBridgeDown = handlePointerDown;
      element._openInkBridgeMove = handlePointerMove;
      element._openInkBridgeUp = handlePointerUp;
      element._openInkBridgeCancel = handlePointerCancel;
      element.addEventListener("pointerdown", handlePointerDown, { passive: false });
      element.addEventListener("pointermove", handlePointerMove, { passive: false });
      element.addEventListener("pointerup", handlePointerUp);
      element.addEventListener("pointercancel", handlePointerCancel);
      element.style.touchAction = "none";
    }
    removeFallbackListeners(element) {
      const down = element._openInkBridgeDown;
      const move = element._openInkBridgeMove;
      const up = element._openInkBridgeUp;
      const cancel = element._openInkBridgeCancel;
      if (down) element.removeEventListener("pointerdown", down);
      if (move) element.removeEventListener("pointermove", move);
      if (up) element.removeEventListener("pointerup", up);
      if (cancel) element.removeEventListener("pointercancel", cancel);
      element.style.touchAction = "";
    }
    getPointFromEvent(e, element) {
      const rect = element.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        pressure: e.pressure || 0.5,
        tilt: e.tiltX || 0,
        // Simplified tilt
        timestamp: Date.now()
      };
    }
  };
  var openInkBridge = new OpenInkBridge();

  // src/wasm/openinkbridge_core.js
  var import_meta = {};
  var Point = class {
    __destroy_into_raw() {
      const ptr = this.__wbg_ptr;
      this.__wbg_ptr = 0;
      PointFinalization.unregister(this);
      return ptr;
    }
    free() {
      const ptr = this.__destroy_into_raw();
      wasm.__wbg_point_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get pressure() {
      const ret = wasm.__wbg_get_point_pressure(this.__wbg_ptr);
      return ret;
    }
    /**
     * @returns {number}
     */
    get tilt() {
      const ret = wasm.__wbg_get_point_tilt(this.__wbg_ptr);
      return ret;
    }
    /**
     * @returns {bigint}
     */
    get timestamp() {
      const ret = wasm.__wbg_get_point_timestamp(this.__wbg_ptr);
      return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {number}
     */
    get x() {
      const ret = wasm.__wbg_get_point_x(this.__wbg_ptr);
      return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
      const ret = wasm.__wbg_get_point_y(this.__wbg_ptr);
      return ret;
    }
    /**
     * @param {number} arg0
     */
    set pressure(arg0) {
      wasm.__wbg_set_point_pressure(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set tilt(arg0) {
      wasm.__wbg_set_point_tilt(this.__wbg_ptr, arg0);
    }
    /**
     * @param {bigint} arg0
     */
    set timestamp(arg0) {
      wasm.__wbg_set_point_timestamp(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set x(arg0) {
      wasm.__wbg_set_point_x(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set y(arg0) {
      wasm.__wbg_set_point_y(this.__wbg_ptr, arg0);
    }
  };
  if (Symbol.dispose) Point.prototype[Symbol.dispose] = Point.prototype.free;
  function smooth_stroke_wasm(points_json) {
    let deferred2_0;
    let deferred2_1;
    try {
      const ptr0 = passStringToWasm0(points_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len0 = WASM_VECTOR_LEN;
      const ret = wasm.smooth_stroke_wasm(ptr0, len0);
      deferred2_0 = ret[0];
      deferred2_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
  }
  function __wbg_get_imports() {
    const import0 = {
      __proto__: null,
      __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
      },
      __wbindgen_init_externref_table: function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, void 0);
        table.set(offset + 0, void 0);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
      }
    };
    return {
      __proto__: null,
      "./openinkbridge_core_bg.js": import0
    };
  }
  var PointFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
  }, unregister: () => {
  } } : new FinalizationRegistry((ptr) => wasm.__wbg_point_free(ptr, 1));
  function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
  }
  var cachedUint8ArrayMemory0 = null;
  function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
      cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
  }
  function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === void 0) {
      const buf = cachedTextEncoder.encode(arg);
      const ptr2 = malloc(buf.length, 1) >>> 0;
      getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);
      WASM_VECTOR_LEN = buf.length;
      return ptr2;
    }
    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;
    const mem = getUint8ArrayMemory0();
    let offset = 0;
    for (; offset < len; offset++) {
      const code = arg.charCodeAt(offset);
      if (code > 127) break;
      mem[ptr + offset] = code;
    }
    if (offset !== len) {
      if (offset !== 0) {
        arg = arg.slice(offset);
      }
      ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
      const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
      const ret = cachedTextEncoder.encodeInto(arg, view);
      offset += ret.written;
      ptr = realloc(ptr, len, offset, 1) >>> 0;
    }
    WASM_VECTOR_LEN = offset;
    return ptr;
  }
  var cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
  cachedTextDecoder.decode();
  var MAX_SAFARI_DECODE_BYTES = 2146435072;
  var numBytesDecoded = 0;
  function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
      cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
      cachedTextDecoder.decode();
      numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
  }
  var cachedTextEncoder = new TextEncoder();
  if (!("encodeInto" in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function(arg, view) {
      const buf = cachedTextEncoder.encode(arg);
      view.set(buf);
      return {
        read: arg.length,
        written: buf.length
      };
    };
  }
  var WASM_VECTOR_LEN = 0;
  var wasmModule;
  var wasmInstance;
  var wasm;
  function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
  }
  async function __wbg_load(module, imports) {
    if (typeof Response === "function" && module instanceof Response) {
      if (typeof WebAssembly.instantiateStreaming === "function") {
        try {
          return await WebAssembly.instantiateStreaming(module, imports);
        } catch (e) {
          const validResponse = module.ok && expectedResponseType(module.type);
          if (validResponse && module.headers.get("Content-Type") !== "application/wasm") {
            console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
          } else {
            throw e;
          }
        }
      }
      const bytes = await module.arrayBuffer();
      return await WebAssembly.instantiate(bytes, imports);
    } else {
      const instance = await WebAssembly.instantiate(module, imports);
      if (instance instanceof WebAssembly.Instance) {
        return { instance, module };
      } else {
        return instance;
      }
    }
    function expectedResponseType(type) {
      switch (type) {
        case "basic":
        case "cors":
        case "default":
          return true;
      }
      return false;
    }
  }
  async function __wbg_init(module_or_path) {
    if (wasm !== void 0) return wasm;
    if (module_or_path !== void 0) {
      if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
        ({ module_or_path } = module_or_path);
      } else {
        console.warn("using deprecated parameters for the initialization function; pass a single object instead");
      }
    }
    if (module_or_path === void 0) {
      module_or_path = new URL("openinkbridge_core_bg.wasm", import_meta.url);
    }
    const imports = __wbg_get_imports();
    if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {
      module_or_path = fetch(module_or_path);
    }
    const { instance, module } = await __wbg_load(await module_or_path, imports);
    return __wbg_finalize_init(instance, module);
  }

  // src/canvas.ts
  var isWasmInitialized = false;
  var wasmInitPromise = null;
  async function initOpenInkBridgeWasm(wasmUrl) {
    if (isWasmInitialized) return;
    if (!wasmInitPromise) {
      wasmInitPromise = __wbg_init(wasmUrl).then(() => {
        isWasmInitialized = true;
        console.log("OpenInkBridge: WebAssembly core math engine initialized successfully.");
      }).catch((err) => {
        console.warn("OpenInkBridge: WebAssembly initialization failed. Drawing will fallback to browser JS math.", err);
      });
    }
    return wasmInitPromise;
  }
  var OpenInkBridgeCanvas = class {
    constructor(canvas, options) {
      this.strokes = [];
      this.unsubscribeBridge = null;
      this.liveUnsubscribeStart = null;
      this.liveUnsubscribeUpdate = null;
      this.isDrawingActive = false;
      this.canvas = canvas;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("OpenInkBridgeCanvas: Could not acquire 2D context from canvas element.");
      }
      this.ctx = context;
      this.options = {
        strokeColor: options?.strokeColor || "#000000",
        strokeWidth: options?.strokeWidth || 4,
        smoothing: options?.smoothing !== false,
        stylusOnly: options?.stylusOnly !== false
      };
      this.setupCanvasQuality();
      if (typeof window !== "undefined") {
        window.addEventListener("resize", () => {
          this.setupCanvasQuality();
          this.redrawCanvas();
          if (this.isDrawingActive) {
            const container = this.canvas.parentElement || this.canvas;
            openInkBridge.setWritingMode(true, container, {
              color: this.options.strokeColor,
              width: this.options.strokeWidth
            });
          }
        });
      }
      initOpenInkBridgeWasm().catch(() => {
      });
    }
    setupCanvasQuality() {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx.scale(dpr, dpr);
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
    }
    /**
     * Enable E-Ink drawing mode. Hands over input rendering to the EPD overlay
     * if supported, otherwise configures local browser pointer capture fallback.
     */
    enableDrawing() {
      if (this.isDrawingActive) return;
      this.isDrawingActive = true;
      const container = this.canvas.parentElement || this.canvas;
      openInkBridge.setWritingMode(true, container, {
        color: this.options.strokeColor,
        width: this.options.strokeWidth,
        stylusOnly: this.options.stylusOnly
      });
      this.unsubscribeBridge = openInkBridge.onStrokeFinished((points) => {
        const processedPoints = this.options.smoothing ? this.smoothPoints(points) : points;
        this.strokes.push(processedPoints);
        this.redrawCanvas();
        openInkBridge.onStrokeDrawn();
      });
      if (!openInkBridge.isSupported()) {
        let lastPoint = null;
        this.liveUnsubscribeStart = openInkBridge.onStrokeStarted((point) => {
          this.ctx.strokeStyle = this.options.strokeColor;
          lastPoint = point;
        });
        this.liveUnsubscribeUpdate = openInkBridge.onStrokeUpdated((point) => {
          if (lastPoint) {
            const avgPressure = (lastPoint.pressure + point.pressure) / 2;
            const width = this.options.strokeWidth * (0.3 + 1.4 * avgPressure);
            this.ctx.lineWidth = width;
            this.ctx.beginPath();
            this.ctx.moveTo(lastPoint.x, lastPoint.y);
            this.ctx.lineTo(point.x, point.y);
            this.ctx.stroke();
          }
          lastPoint = point;
        });
      }
    }
    /**
     * Disable E-Ink drawing mode, releasing overlays and listeners.
     */
    disableDrawing() {
      if (!this.isDrawingActive) return;
      this.isDrawingActive = false;
      const container = this.canvas.parentElement || this.canvas;
      openInkBridge.setWritingMode(false, container);
      if (this.unsubscribeBridge) {
        this.unsubscribeBridge();
        this.unsubscribeBridge = null;
      }
      if (this.liveUnsubscribeStart) {
        this.liveUnsubscribeStart();
        this.liveUnsubscribeStart = null;
      }
      if (this.liveUnsubscribeUpdate) {
        this.liveUnsubscribeUpdate();
        this.liveUnsubscribeUpdate = null;
      }
    }
    /**
     * Redraws all completed strokes onto the canvas element.
     */
    redrawCanvas() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      for (const stroke of this.strokes) {
        this.drawStroke(stroke);
      }
    }
    setStyle(color, width, stylusOnly) {
      this.options.strokeColor = color;
      this.options.strokeWidth = width;
      if (stylusOnly !== void 0) {
        this.options.stylusOnly = stylusOnly;
      }
      if (this.isDrawingActive) {
        const container = this.canvas.parentElement || this.canvas;
        openInkBridge.setWritingMode(true, container, {
          color,
          width,
          stylusOnly: this.options.stylusOnly
        });
      }
    }
    /**
     * Clear the canvas and internal vector database.
     */
    clear() {
      this.strokes = [];
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (openInkBridge.isSupported()) {
        const container = this.canvas.parentElement || this.canvas;
        const rect = container.getBoundingClientRect();
        window.OpenInkBridgeNative.setWritingMode(this.isDrawingActive, JSON.stringify({
          color: this.options.strokeColor,
          width: this.options.strokeWidth,
          stylusOnly: this.options.stylusOnly,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }
        }));
      }
    }
    /**
     * Export the vector canvas contents directly to an SVG string.
     */
    exportToSvg() {
      const width = this.canvas.clientWidth;
      const height = this.canvas.clientHeight;
      let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
      for (const stroke of this.strokes) {
        if (stroke.length < 2) continue;
        svg += `<path d="M ${stroke[0].x} ${stroke[0].y}`;
        for (let i = 1; i < stroke.length; i++) {
          svg += ` L ${stroke[i].x} ${stroke[i].y}`;
        }
        svg += `" stroke="${this.options.strokeColor}" stroke-width="${this.options.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
      }
      svg += "</svg>";
      return svg;
    }
    /**
     * Export vector strokes.
     */
    getStrokes() {
      return this.strokes;
    }
    /**
     * Listen to finished strokes.
     */
    onStrokeFinished(callback) {
      return openInkBridge.onStrokeFinished(callback);
    }
    drawStroke(points) {
      if (points.length < 2) return;
      this.ctx.strokeStyle = this.options.strokeColor;
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const avgPressure = (p1.pressure + p2.pressure) / 2;
        const width = this.options.strokeWidth * (0.3 + 1.4 * avgPressure);
        this.ctx.lineWidth = width;
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();
      }
    }
    smoothPoints(points) {
      if (points.length < 3) return points;
      if (isWasmInitialized) {
        try {
          const jsonInput = JSON.stringify(points);
          const jsonOutput = smooth_stroke_wasm(jsonInput);
          return JSON.parse(jsonOutput);
        } catch (e) {
          console.error("OpenInkBridge: WASM stroke smoothing failed; falling back to JS", e);
        }
      }
      const smoothed = [points[0]];
      for (let i = 1; i < points.length - 1; i++) {
        smoothed.push({
          x: (points[i - 1].x + points[i].x + points[i + 1].x) / 3,
          y: (points[i - 1].y + points[i].y + points[i + 1].y) / 3,
          pressure: (points[i - 1].pressure + points[i].pressure + points[i + 1].pressure) / 3,
          tilt: (points[i - 1].tilt + points[i].tilt + points[i + 1].tilt) / 3,
          timestamp: points[i].timestamp
        });
      }
      smoothed.push(points[points.length - 1]);
      return smoothed;
    }
  };
  return __toCommonJS(global_exports);
})();
