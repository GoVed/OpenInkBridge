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
    BRIDGE_PROTOCOL_VERSION: () => BRIDGE_PROTOCOL_VERSION,
    LogLevel: () => LogLevel,
    OpenInkBridge: () => OpenInkBridge,
    OpenInkBridgeCanvas: () => OpenInkBridgeCanvas,
    OpenInkBridgeSession: () => OpenInkBridgeSession,
    SDK_VERSION: () => SDK_VERSION,
    Subsystem: () => Subsystem,
    collectDiagnostics: () => collectDiagnostics,
    configureOpenInkBridgeWasmLoader: () => configureOpenInkBridgeWasmLoader,
    createBugReport: () => createBugReport,
    dumpConfiguration: () => dumpConfiguration,
    initOpenInkBridgeWasm: () => initOpenInkBridgeWasm,
    isOpenInkBridgeWasmInitialized: () => isOpenInkBridgeWasmInitialized,
    logger: () => logger,
    openInkBridge: () => openInkBridge,
    parseNativeStrokePayload: () => parseNativeStrokePayload,
    smoothStrokeJs: () => smoothStrokeJs
  });

  // src/logger.ts
  var LogLevel = /* @__PURE__ */ ((LogLevel3) => {
    LogLevel3[LogLevel3["ERROR"] = 0] = "ERROR";
    LogLevel3[LogLevel3["WARN"] = 1] = "WARN";
    LogLevel3[LogLevel3["INFO"] = 2] = "INFO";
    LogLevel3[LogLevel3["DEBUG"] = 3] = "DEBUG";
    LogLevel3[LogLevel3["TRACE"] = 4] = "TRACE";
    return LogLevel3;
  })(LogLevel || {});
  var Subsystem = /* @__PURE__ */ ((Subsystem2) => {
    Subsystem2["Core"] = "Core";
    Subsystem2["Backend"] = "Backend";
    Subsystem2["Renderer"] = "Renderer";
    Subsystem2["PenInput"] = "PenInput";
    Subsystem2["Refresh"] = "Refresh";
    Subsystem2["Synchronization"] = "Synchronization";
    Subsystem2["JsBridge"] = "JsBridge";
    Subsystem2["Android"] = "Android";
    Subsystem2["Linux"] = "Linux";
    Subsystem2["Performance"] = "Performance";
    Subsystem2["Configuration"] = "Configuration";
    Subsystem2["Networking"] = "Networking";
    return Subsystem2;
  })(Subsystem || {});
  var OpenInkBridgeLogger = class {
    constructor() {
      this.activeLogLevel = 2 /* INFO */;
      this.ringBuffer = [];
      this.maxBufferCapacity = 500;
      this.lastTraceTimestamp = 0;
    }
    setLogLevel(level) {
      if (typeof level === "string") {
        switch (level.toUpperCase()) {
          case "ERROR":
            this.activeLogLevel = 0 /* ERROR */;
            break;
          case "WARN":
          case "WARNING":
            this.activeLogLevel = 1 /* WARN */;
            break;
          case "INFO":
            this.activeLogLevel = 2 /* INFO */;
            break;
          case "DEBUG":
            this.activeLogLevel = 3 /* DEBUG */;
            break;
          case "TRACE":
            this.activeLogLevel = 4 /* TRACE */;
            break;
          default:
            this.activeLogLevel = 2 /* INFO */;
            break;
        }
      } else {
        this.activeLogLevel = level;
      }
    }
    getLogLevel() {
      return this.activeLogLevel;
    }
    log(level, subsystem, backend, event, message, parameters) {
      const entry = {
        timestamp: Date.now(),
        level,
        subsystem,
        backend: backend || "Browser",
        event,
        message,
        parameters
      };
      if (this.ringBuffer.length >= this.maxBufferCapacity) {
        this.ringBuffer.shift();
      }
      this.ringBuffer.push(entry);
      if (level <= this.activeLogLevel && typeof console !== "undefined") {
        const levelStr = LogLevel[level];
        const prefix = `[${levelStr}][${subsystem}][${entry.backend}] ${event}:`;
        const args = parameters ? [prefix, message, parameters] : [prefix, message];
        switch (level) {
          case 0 /* ERROR */:
            console.error(...args);
            break;
          case 1 /* WARN */:
            console.warn(...args);
            break;
          case 2 /* INFO */:
            console.info(...args);
            break;
          case 3 /* DEBUG */:
          case 4 /* TRACE */:
            console.log(...args);
            break;
        }
      }
    }
    shouldLogTrace(minIntervalMs = 20) {
      const now = Date.now();
      if (now >= this.lastTraceTimestamp + minIntervalMs) {
        this.lastTraceTimestamp = now;
        return true;
      }
      return false;
    }
    error(subsystem, backend, event, message, params) {
      this.log(0 /* ERROR */, subsystem, backend, event, message, params);
    }
    warn(subsystem, backend, event, message, params) {
      this.log(1 /* WARN */, subsystem, backend, event, message, params);
    }
    info(subsystem, backend, event, message, params) {
      this.log(2 /* INFO */, subsystem, backend, event, message, params);
    }
    debug(subsystem, backend, event, message, params) {
      this.log(3 /* DEBUG */, subsystem, backend, event, message, params);
    }
    trace(subsystem, backend, event, message, params) {
      this.log(4 /* TRACE */, subsystem, backend, event, message, params);
    }
    getRingBufferLogs() {
      return [...this.ringBuffer];
    }
    clearRingBuffer() {
      this.ringBuffer = [];
    }
  };
  var logger = new OpenInkBridgeLogger();

  // src/generated/version.ts
  var SDK_VERSION = "0.1.3";

  // src/diagnostics.ts
  function collectDiagnostics(activeBackend, isNativeSupported) {
    const isBrowser = typeof window !== "undefined";
    const ua = isBrowser ? window.navigator.userAgent : "Node.js / Server Environment";
    const dpr = isBrowser ? window.devicePixelRatio || 1 : 1;
    const res = isBrowser ? `${window.screen?.width || 0}x${window.screen?.height || 0}` : "0x0";
    const hasPointer = isBrowser && typeof window.PointerEvent !== "undefined";
    const maxTouch = isBrowser ? window.navigator.maxTouchPoints || 0 : 0;
    const backend = activeBackend || (isNativeSupported ? "NativeOpenInkBridge" : "PointerEventFallback");
    const fallbackReason = isNativeSupported ? null : "OpenInkBridgeNative bridge object not detected on window; using HTML5 PointerEvents fallback";
    return {
      version: SDK_VERSION,
      platform: "Web SDK",
      userAgent: ua,
      devicePixelRatio: dpr,
      screenResolution: res,
      hasPointerEvents: hasPointer,
      maxTouchPoints: maxTouch,
      selectedBackend: backend,
      availableBackends: ["NativeOpenInkBridge", "PointerEventFallback", "WasmCore"],
      fallbackReason,
      capabilities: {
        pressure: true,
        tilt: true,
        hover: true,
        eraser: true,
        refreshModes: ["Fast", "Partial", "Full", "Clear"],
        hardwareAcceleration: !!isNativeSupported
      },
      refreshMode: isNativeSupported ? "Fast" : "Software",
      recentLogs: logger.getRingBufferLogs()
    };
  }
  function dumpConfiguration(activeBackend, isNativeSupported) {
    const diag = collectDiagnostics(activeBackend, isNativeSupported);
    let out = "";
    out += "========== OpenInkBridge Diagnostics ==========\n";
    out += `Version: ${diag.version}
`;
    out += `Platform: ${diag.platform}
`;
    out += `User Agent: ${diag.userAgent}
`;
    out += `Screen: ${diag.screenResolution} (DPR: ${diag.devicePixelRatio})
`;
    out += `Pointer Events: ${diag.hasPointerEvents ? "Supported" : "Unsupported"} (Max Touch: ${diag.maxTouchPoints})
`;
    out += `Selected Backend: ${diag.selectedBackend}
`;
    out += `Available Backends: ${diag.availableBackends.join(", ")}
`;
    if (diag.fallbackReason) {
      out += `Fallback Reason: ${diag.fallbackReason}
`;
    }
    out += "Capabilities:\n";
    out += `  - Pressure: ${diag.capabilities.pressure ? "Supported" : "Unsupported"}
`;
    out += `  - Tilt: ${diag.capabilities.tilt ? "Supported" : "Unsupported"}
`;
    out += `  - Hover: ${diag.capabilities.hover ? "Supported" : "Unsupported"}
`;
    out += `  - Eraser: ${diag.capabilities.eraser ? "Supported" : "Unsupported"}
`;
    out += `  - Refresh Modes: [${diag.capabilities.refreshModes.join(", ")}]
`;
    out += `  - Hardware Acceleration: ${diag.capabilities.hardwareAcceleration ? "Enabled" : "Disabled"}
`;
    out += `Refresh Mode: ${diag.refreshMode}
`;
    out += "===============================================\n";
    return out;
  }
  function createBugReport(activeBackend, isNativeSupported) {
    let out = dumpConfiguration(activeBackend, isNativeSupported);
    out += "\n========== Recent Warnings & Errors ==========\n";
    const warnErrorLogs = logger.getRingBufferLogs().filter((e) => e.level === 1 /* WARN */ || e.level === 0 /* ERROR */);
    if (warnErrorLogs.length === 0) {
      out += "No warnings or errors reported in recent log buffer.\n";
    } else {
      for (const entry of warnErrorLogs) {
        const levelStr = LogLevel[entry.level];
        out += `[${levelStr}][${entry.subsystem}][${entry.backend}] ${entry.event}: ${entry.message}
`;
      }
    }
    out += "===============================================\n";
    return out;
  }

  // src/model.ts
  var INK_DOCUMENT_SCHEMA_VERSION = 1;
  var DEFAULT_STROKE_COLOR = "#000000";
  var DEFAULT_STROKE_WIDTH = 4;
  var HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  var NAMED_COLOR = /^[a-z]{1,32}$/i;
  var FUNCTION_COLOR = /^(?:rgb|rgba|hsl|hsla)\([0-9+\-.,%/\s]+\)$/i;
  var SAFE_CSS_COLOR_CHARACTERS = /^[#(),.%+\-/\sa-z0-9]+$/i;
  function normalizeStrokeColor(value, fallback = DEFAULT_STROKE_COLOR) {
    if (typeof value !== "string") return fallback;
    const color = value.trim();
    if (color.length === 0 || color.length > 128 || !SAFE_CSS_COLOR_CHARACTERS.test(color)) {
      return fallback;
    }
    if (HEX_COLOR.test(color) || NAMED_COLOR.test(color) || FUNCTION_COLOR.test(color)) {
      return color;
    }
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", color)) {
      return color;
    }
    return fallback;
  }
  function normalizeStrokeWidth(value, fallback = DEFAULT_STROKE_WIDTH) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1024 ? value : fallback;
  }
  function isValidStrokePoint(value) {
    if (!isRecord(value)) return false;
    return isFiniteCoordinate(value.x) && isFiniteCoordinate(value.y) && isFiniteNumberInRange(value.pressure, 0, 16) && isFiniteNumberInRange(value.tilt, -180, 180) && isFiniteNumberInRange(value.timestamp, 0, Number.MAX_SAFE_INTEGER);
  }
  function validateStrokePoints(value, maxPoints = 1e5) {
    if (!Array.isArray(value) || value.length > maxPoints) return null;
    const points = [];
    for (const candidate of value) {
      if (!isValidStrokePoint(candidate)) return null;
      points.push(cloneStrokePoint(candidate));
    }
    return points;
  }
  function cloneStrokePoint(point) {
    return {
      x: point.x,
      y: point.y,
      pressure: point.pressure,
      tilt: point.tilt,
      timestamp: point.timestamp
    };
  }
  function cloneStrokePoints(points) {
    return points.map(cloneStrokePoint);
  }
  function cloneInkDocument(document2) {
    return {
      schemaVersion: INK_DOCUMENT_SCHEMA_VERSION,
      strokes: document2.strokes.map((stroke) => ({
        id: stroke.id,
        points: cloneStrokePoints(stroke.points),
        style: { ...stroke.style }
      }))
    };
  }
  function escapeXmlAttribute(value) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function formatSvgNumber(value) {
    if (!Number.isFinite(value)) {
      throw new TypeError("SVG coordinates and dimensions must be finite numbers");
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  function smoothStrokeJs(points) {
    if (points.length < 3) return cloneStrokePoints(points);
    const smoothed = [cloneStrokePoint(points[0])];
    for (let index = 1; index < points.length - 1; index++) {
      const previous = points[index - 1];
      const current = points[index];
      const next = points[index + 1];
      smoothed.push({
        x: 0.25 * previous.x + 0.5 * current.x + 0.25 * next.x,
        y: 0.25 * previous.y + 0.5 * current.y + 0.25 * next.y,
        pressure: 0.25 * previous.pressure + 0.5 * current.pressure + 0.25 * next.pressure,
        tilt: 0.25 * previous.tilt + 0.5 * current.tilt + 0.25 * next.tilt,
        timestamp: current.timestamp
      });
    }
    smoothed.push(cloneStrokePoint(points[points.length - 1]));
    return smoothed;
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function isFiniteCoordinate(value) {
    return isFiniteNumberInRange(value, -1e7, 1e7);
  }
  function isFiniteNumberInRange(value, minimum, maximum) {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
  }

  // src/bridge.ts
  var BRIDGE_PROTOCOL_VERSION = 1;
  var MAX_NATIVE_PAYLOAD_LENGTH = 8 * 1024 * 1024;
  var LEGACY_SESSION_ID = "legacy";
  var CALLBACK_REGISTRY_KEY = "__openInkBridgeCallbackRegistryV1";
  var sessionSequence = 0;
  function parseNativeStrokePayload(input) {
    let value = input;
    if (typeof input === "string") {
      if (input.length > MAX_NATIVE_PAYLOAD_LENGTH) return null;
      try {
        value = JSON.parse(input);
      } catch {
        return null;
      }
    }
    if (Array.isArray(value)) {
      const points2 = validateStrokePoints(value);
      return points2 ? { protocolVersion: BRIDGE_PROTOCOL_VERSION, points: points2 } : null;
    }
    if (!isRecord2(value)) return null;
    if (value.protocolVersion !== void 0 && value.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      return null;
    }
    if (value.type !== void 0 && value.type !== "strokeFinished") return null;
    const sessionId = readIdentifier(value.sessionId);
    const canvasId = readIdentifier(value.canvasId);
    if (value.sessionId !== void 0 && !sessionId) return null;
    if (value.canvasId !== void 0 && !canvasId) return null;
    let pointValue = value.points;
    if (pointValue === void 0 && Array.isArray(value.payload)) {
      pointValue = value.payload;
    } else if (pointValue === void 0 && isRecord2(value.payload)) {
      pointValue = value.payload.points;
    }
    const points = validateStrokePoints(pointValue);
    if (!points) return null;
    return {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      ...sessionId ? { sessionId } : {},
      ...canvasId ? { canvasId } : {},
      points
    };
  }
  var OpenInkBridgeSession = class {
    constructor(owner, record) {
      this.owner = owner;
      this.destroyed = false;
      this.id = record.id;
      this.canvasId = record.canvasId;
    }
    setWritingMode(enabled, targetElement, options) {
      this.assertActive();
      this.owner.configureSession(this.id, enabled, targetElement, options);
    }
    onStrokeFinished(callback) {
      this.assertActive();
      return this.owner.subscribeToSession(this.id, "finished", callback);
    }
    onStrokeStarted(callback) {
      this.assertActive();
      return this.owner.subscribeToSession(this.id, "started", callback);
    }
    onStrokeUpdated(callback) {
      this.assertActive();
      return this.owner.subscribeToSession(this.id, "updated", callback);
    }
    onStrokeDrawn() {
      if (!this.destroyed) this.owner.onStrokeDrawn(this.id);
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.owner.destroySession(this.id);
    }
    assertActive() {
      if (this.destroyed) throw new Error("OpenInkBridgeSession has been destroyed");
    }
  };
  var OpenInkBridge = class {
    constructor() {
      this.sessions = /* @__PURE__ */ new Map();
      this.strokeCallbacks = /* @__PURE__ */ new Set();
      this.strokeStartCallbacks = /* @__PURE__ */ new Set();
      this.strokeUpdateCallbacks = /* @__PURE__ */ new Set();
      this.nativePayloadHandler = (payload) => this.handleNativePayload(payload);
      this.activeNativeSessionId = null;
      this.activationSequence = 0;
      this.destroyed = false;
      this.sessions.set(LEGACY_SESSION_ID, this.createSessionRecord(LEGACY_SESSION_ID, LEGACY_SESSION_ID));
      this.installNativeCallback();
      logger.info("JsBridge" /* JsBridge */, "Browser", "INITIALIZE", "OpenInkBridge JS SDK initialized");
    }
    /** Create an isolated event and fallback-input scope for one canvas. */
    createSession(canvasId) {
      this.assertActive();
      const normalizedCanvasId = sanitizeIdentifier(canvasId) || `canvas-${++sessionSequence}`;
      const sessionId = `oib-${normalizedCanvasId}-${Date.now().toString(36)}-${++sessionSequence}`;
      const record = this.createSessionRecord(sessionId, normalizedCanvasId);
      this.sessions.set(sessionId, record);
      return new OpenInkBridgeSession(this, record);
    }
    /** Check whether a callable native OpenInkBridge interface is present. */
    isSupported() {
      const nativeBridge = getNativeBridge();
      const supported = isDirectNativeBridge(nativeBridge) || isMessageNativeBridge(nativeBridge);
      logger.debug(
        "Backend" /* Backend */,
        supported ? "NativeBridge" : "PointerFallback",
        "SUPPORTED_CHECK",
        supported ? "Native OpenInkBridge interface detected" : "Native OpenInkBridge interface not present; using browser fallbacks"
      );
      return supported;
    }
    /** Backwards-compatible singleton API, scoped internally as the legacy session. */
    setWritingMode(enabled, targetElement, options) {
      this.configureSession(LEGACY_SESSION_ID, enabled, targetElement, options);
    }
    configureSession(sessionId, enabled, targetElement, options) {
      this.assertActive();
      const record = this.requireSession(sessionId);
      const normalizedOptions = normalizeOptions(options, record.options);
      record.targetElement = targetElement;
      record.options = normalizedOptions;
      record.writingEnabled = enabled;
      if (this.isSupported()) {
        this.removeFallbackListeners(record);
        if (enabled) {
          record.activationOrder = ++this.activationSequence;
          this.activeNativeSessionId = record.id;
          this.invokeNativeWritingMode(record, true);
        } else if (this.activeNativeSessionId === record.id) {
          const nextRecord = this.findMostRecentlyActivatedNativeSession(record.id);
          this.activeNativeSessionId = nextRecord?.id || null;
          if (nextRecord) {
            this.invokeNativeWritingMode(nextRecord, true);
          } else {
            this.invokeNativeWritingMode(record, false);
          }
        }
        return;
      }
      if (enabled) {
        this.setupFallbackListeners(record, targetElement);
      } else {
        this.removeFallbackListeners(record);
      }
    }
    /** Notify native hardware that the corresponding software stroke is committed. */
    onStrokeDrawn(sessionId = LEGACY_SESSION_ID) {
      const nativeBridge = getNativeBridge();
      if (!nativeBridge) return;
      try {
        const record = this.sessions.get(sessionId);
        if (isMessageNativeBridge(nativeBridge) && record) {
          nativeBridge.postMessage(JSON.stringify({
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            type: "strokeDrawn",
            sessionId,
            canvasId: record.canvasId
          }));
        } else if (isDirectNativeBridge(nativeBridge) && typeof nativeBridge.onStrokeDrawnForSession === "function") {
          nativeBridge.onStrokeDrawnForSession(JSON.stringify({
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            type: "strokeDrawn",
            sessionId,
            canvasId: record?.canvasId || sessionId
          }));
        } else if (isDirectNativeBridge(nativeBridge) && typeof nativeBridge.onStrokeDrawn === "function") {
          nativeBridge.onStrokeDrawn();
        }
      } catch (error) {
        logger.error(
          "Synchronization" /* Synchronization */,
          "NativeBridge",
          "ON_STROKE_DRAWN_ERROR",
          `Failed to acknowledge native stroke: ${errorMessage(error)}`
        );
      }
    }
    /** Global observers are retained for source compatibility and receive every valid stroke. */
    onStrokeFinished(callback) {
      return subscribe(this.strokeCallbacks, callback);
    }
    onStrokeStarted(callback) {
      return subscribe(this.strokeStartCallbacks, callback);
    }
    onStrokeUpdated(callback) {
      return subscribe(this.strokeUpdateCallbacks, callback);
    }
    subscribeToSession(sessionId, event, callback) {
      const record = this.requireSession(sessionId);
      if (event === "finished") {
        return subscribe(record.strokeCallbacks, callback);
      }
      if (event === "started") {
        return subscribe(record.strokeStartCallbacks, callback);
      }
      return subscribe(record.strokeUpdateCallbacks, callback);
    }
    destroySession(sessionId) {
      if (sessionId === LEGACY_SESSION_ID) return;
      const record = this.sessions.get(sessionId);
      if (!record) return;
      if (record.writingEnabled && record.targetElement) {
        this.configureSession(sessionId, false, record.targetElement, record.options);
      }
      this.removeFallbackListeners(record);
      record.strokeCallbacks.clear();
      record.strokeStartCallbacks.clear();
      record.strokeUpdateCallbacks.clear();
      this.sessions.delete(sessionId);
    }
    setLogLevel(level) {
      logger.setLogLevel(level);
    }
    collectDiagnostics() {
      return collectDiagnostics(void 0, this.isSupported());
    }
    dumpConfiguration() {
      return dumpConfiguration(void 0, this.isSupported());
    }
    createBugReport() {
      return createBugReport(void 0, this.isSupported());
    }
    getRingBufferLogs() {
      return logger.getRingBufferLogs();
    }
    /** Primarily useful for isolated runtimes and tests; the exported singleton normally lives for the page. */
    destroy() {
      if (this.destroyed) return;
      if (this.activeNativeSessionId) {
        const activeRecord = this.sessions.get(this.activeNativeSessionId);
        if (activeRecord) this.invokeNativeWritingMode(activeRecord, false);
        this.activeNativeSessionId = null;
      }
      for (const record of Array.from(this.sessions.values())) {
        this.removeFallbackListeners(record);
      }
      this.sessions.clear();
      this.strokeCallbacks.clear();
      this.strokeStartCallbacks.clear();
      this.strokeUpdateCallbacks.clear();
      this.removeNativeCallback();
      this.destroyed = true;
    }
    createSessionRecord(id, canvasId) {
      return {
        id,
        canvasId,
        strokeCallbacks: /* @__PURE__ */ new Set(),
        strokeStartCallbacks: /* @__PURE__ */ new Set(),
        strokeUpdateCallbacks: /* @__PURE__ */ new Set(),
        writingEnabled: false,
        activationOrder: 0,
        targetElement: null,
        options: {
          color: "#000000",
          width: 4,
          stylusOnly: true
        },
        fallbackBinding: null,
        currentFallbackStroke: [],
        activePointerId: null
      };
    }
    requireSession(sessionId) {
      const record = this.sessions.get(sessionId);
      if (!record) throw new Error(`Unknown OpenInkBridge session: ${sessionId}`);
      return record;
    }
    installNativeCallback() {
      const bridgeWindow = getBridgeWindow();
      if (!bridgeWindow) return;
      let registry = bridgeWindow[CALLBACK_REGISTRY_KEY];
      if (!registry || registry.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
        const previous = typeof bridgeWindow.onOpenInkBridgeStrokeFinished === "function" ? bridgeWindow.onOpenInkBridgeStrokeFinished : void 0;
        const handlers = /* @__PURE__ */ new Set();
        registry = {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          handlers,
          previous,
          dispatcher: (payload) => {
            for (const handler of Array.from(handlers)) handler(payload);
            if (previous && previous !== registry?.dispatcher) previous(payload);
          }
        };
        bridgeWindow[CALLBACK_REGISTRY_KEY] = registry;
        bridgeWindow.onOpenInkBridgeStrokeFinished = registry.dispatcher;
      }
      registry.handlers.add(this.nativePayloadHandler);
    }
    removeNativeCallback() {
      const bridgeWindow = getBridgeWindow();
      const registry = bridgeWindow?.[CALLBACK_REGISTRY_KEY];
      if (!bridgeWindow || !registry) return;
      registry.handlers.delete(this.nativePayloadHandler);
      if (registry.handlers.size === 0) {
        if (bridgeWindow.onOpenInkBridgeStrokeFinished === registry.dispatcher) {
          bridgeWindow.onOpenInkBridgeStrokeFinished = registry.previous;
        }
        delete bridgeWindow[CALLBACK_REGISTRY_KEY];
      }
    }
    handleNativePayload(payload) {
      const parsed = parseNativeStrokePayload(payload);
      if (!parsed) {
        logger.error(
          "Synchronization" /* Synchronization */,
          "NativeBridge",
          "INVALID_STROKE_PAYLOAD",
          "Rejected malformed or unsupported native stroke payload"
        );
        return;
      }
      let record;
      if (parsed.sessionId) record = this.sessions.get(parsed.sessionId);
      if (!record && parsed.canvasId) {
        record = Array.from(this.sessions.values()).find((candidate) => candidate.canvasId === parsed.canvasId);
      }
      if (!record && !parsed.sessionId && !parsed.canvasId && this.activeNativeSessionId) {
        record = this.sessions.get(this.activeNativeSessionId);
      }
      if (!record && !parsed.sessionId && !parsed.canvasId) record = this.sessions.get(LEGACY_SESSION_ID);
      if (!record) {
        logger.warn(
          "Synchronization" /* Synchronization */,
          "NativeBridge",
          "UNKNOWN_SESSION",
          `Ignoring stroke for unknown session ${parsed.sessionId || parsed.canvasId || "(none)"}`
        );
        return;
      }
      logger.debug(
        "Synchronization" /* Synchronization */,
        "NativeBridge",
        "STROKE_RECEIVED",
        `Received finalized stroke with ${parsed.points.length} points for session ${record.id}`
      );
      this.notifyFinished(record, parsed.points);
    }
    notifyFinished(record, points) {
      invokeStrokeCallbacks(record.strokeCallbacks, points);
      if (record.id !== LEGACY_SESSION_ID) invokeStrokeCallbacks(this.strokeCallbacks, points);
    }
    notifyStarted(record, point) {
      invokePointCallbacks(record.strokeStartCallbacks, point);
      if (record.id !== LEGACY_SESSION_ID) invokePointCallbacks(this.strokeStartCallbacks, point);
    }
    notifyUpdated(record, point) {
      invokePointCallbacks(record.strokeUpdateCallbacks, point);
      if (record.id !== LEGACY_SESSION_ID) invokePointCallbacks(this.strokeUpdateCallbacks, point);
    }
    invokeNativeWritingMode(record, enabled) {
      const nativeBridge = getNativeBridge();
      if (!nativeBridge || !record.targetElement) return;
      const rect = record.targetElement.getBoundingClientRect();
      const payload = {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        type: "setWritingMode",
        sessionId: record.id,
        canvasId: record.canvasId,
        enabled,
        color: record.options.color,
        width: record.options.width,
        stylusOnly: record.options.stylusOnly !== false,
        rect: {
          left: finiteOrZero(rect.left),
          top: finiteOrZero(rect.top),
          width: Math.max(0, finiteOrZero(rect.width)),
          height: Math.max(0, finiteOrZero(rect.height))
        }
      };
      try {
        if (isMessageNativeBridge(nativeBridge)) {
          nativeBridge.postMessage(JSON.stringify(payload));
        } else {
          nativeBridge.setWritingMode(enabled, JSON.stringify(payload));
        }
        logger.info(
          "JsBridge" /* JsBridge */,
          "NativeBridge",
          "SET_WRITING_MODE",
          `Native writing mode enabled=${enabled} for session ${record.id}`,
          payload
        );
      } catch (error) {
        logger.error(
          "JsBridge" /* JsBridge */,
          "NativeBridge",
          "SET_WRITING_MODE_ERROR",
          `Native bridge rejected writing mode update: ${errorMessage(error)}`
        );
      }
    }
    findMostRecentlyActivatedNativeSession(excludedId) {
      return Array.from(this.sessions.values()).filter((record) => record.id !== excludedId && record.writingEnabled && record.targetElement).sort((left, right) => right.activationOrder - left.activationOrder)[0];
    }
    setupFallbackListeners(record, element) {
      if (record.fallbackBinding?.element === element) return;
      this.removeFallbackListeners(record);
      const pointerDown = (event) => {
        if (record.activePointerId !== null) return;
        if (record.options.stylusOnly && event.pointerType !== "pen") return;
        event.preventDefault();
        tryCapturePointer(element, event.pointerId);
        record.activePointerId = event.pointerId;
        const point = pointFromEvent(event, element);
        record.currentFallbackStroke = [point];
        this.notifyStarted(record, point);
      };
      const pointerMove = (event) => {
        if (record.activePointerId !== event.pointerId) return;
        event.preventDefault();
        const point = pointFromEvent(event, element);
        record.currentFallbackStroke.push(point);
        this.notifyUpdated(record, point);
      };
      const pointerUp = (event) => {
        if (record.activePointerId !== event.pointerId) return;
        event.preventDefault();
        tryReleasePointer(element, event.pointerId);
        record.activePointerId = null;
        const points = record.currentFallbackStroke;
        record.currentFallbackStroke = [];
        if (points.length > 0) this.notifyFinished(record, points);
      };
      const pointerCancel = (event) => {
        if (record.activePointerId !== event.pointerId) return;
        tryReleasePointer(element, event.pointerId);
        record.activePointerId = null;
        record.currentFallbackStroke = [];
        logger.warn("PenInput" /* PenInput */, "PointerFallback", "PEN_CANCEL", "Pointer stroke cancelled");
      };
      record.fallbackBinding = {
        element,
        previousTouchAction: element.style.touchAction,
        pointerDown,
        pointerMove,
        pointerUp,
        pointerCancel
      };
      element.addEventListener("pointerdown", pointerDown, { passive: false });
      element.addEventListener("pointermove", pointerMove, { passive: false });
      element.addEventListener("pointerup", pointerUp, { passive: false });
      element.addEventListener("pointercancel", pointerCancel);
      element.style.touchAction = "none";
    }
    removeFallbackListeners(record) {
      const binding = record.fallbackBinding;
      if (!binding) return;
      binding.element.removeEventListener("pointerdown", binding.pointerDown);
      binding.element.removeEventListener("pointermove", binding.pointerMove);
      binding.element.removeEventListener("pointerup", binding.pointerUp);
      binding.element.removeEventListener("pointercancel", binding.pointerCancel);
      binding.element.style.touchAction = binding.previousTouchAction;
      record.fallbackBinding = null;
      record.currentFallbackStroke = [];
      record.activePointerId = null;
    }
    assertActive() {
      if (this.destroyed) throw new Error("OpenInkBridge has been destroyed");
    }
  };
  function normalizeOptions(options, previous) {
    return {
      color: normalizeStrokeColor(options?.color, previous.color),
      width: normalizeStrokeWidth(options?.width, previous.width),
      stylusOnly: options?.stylusOnly ?? previous.stylusOnly ?? true
    };
  }
  function pointFromEvent(event, element) {
    const rect = element.getBoundingClientRect();
    return {
      x: finiteOrZero(event.clientX - rect.left),
      y: finiteOrZero(event.clientY - rect.top),
      pressure: Number.isFinite(event.pressure) ? Math.max(0, Math.min(16, event.pressure)) : 0.5,
      tilt: Number.isFinite(event.tiltX) ? Math.max(-180, Math.min(180, event.tiltX)) : 0,
      timestamp: Date.now()
    };
  }
  function invokeStrokeCallbacks(callbacks, points) {
    for (const callback of Array.from(callbacks)) {
      try {
        callback(cloneStrokePoints(points));
      } catch (error) {
        logger.error(
          "JsBridge" /* JsBridge */,
          "Callback",
          "STROKE_CALLBACK_ERROR",
          `Stroke callback failed: ${errorMessage(error)}`
        );
      }
    }
  }
  function invokePointCallbacks(callbacks, point) {
    for (const callback of Array.from(callbacks)) {
      try {
        callback(cloneStrokePoint(point));
      } catch (error) {
        logger.error(
          "JsBridge" /* JsBridge */,
          "Callback",
          "POINT_CALLBACK_ERROR",
          `Point callback failed: ${errorMessage(error)}`
        );
      }
    }
  }
  function subscribe(callbacks, callback) {
    callbacks.add(callback);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      callbacks.delete(callback);
    };
  }
  function getBridgeWindow() {
    return typeof window === "undefined" ? null : window;
  }
  function getNativeBridge() {
    return getBridgeWindow()?.OpenInkBridgeNative;
  }
  function isDirectNativeBridge(value) {
    return typeof value?.setWritingMode === "function";
  }
  function isMessageNativeBridge(value) {
    return typeof value?.postMessage === "function";
  }
  function readIdentifier(value) {
    if (typeof value !== "string") return void 0;
    const identifier = sanitizeIdentifier(value);
    return identifier || void 0;
  }
  function sanitizeIdentifier(value) {
    return typeof value === "string" && /^[a-z0-9._:-]{1,128}$/i.test(value) ? value : "";
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function finiteOrZero(value) {
    return Number.isFinite(value) ? value : 0;
  }
  function tryCapturePointer(element, pointerId) {
    try {
      element.setPointerCapture(pointerId);
    } catch {
    }
  }
  function tryReleasePointer(element, pointerId) {
    try {
      element.releasePointerCapture(pointerId);
    } catch {
    }
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  var openInkBridge = new OpenInkBridge();

  // src/wasm.ts
  var GENERATED_WASM_MODULE_PATH = "./wasm/openinkbridge_core.js";
  var configuredLoader = null;
  var bindings = null;
  var initialization = null;
  function configureOpenInkBridgeWasmLoader(loader) {
    configuredLoader = loader;
    bindings = null;
    initialization = null;
  }
  function initOpenInkBridgeWasm(wasmUrl, loader) {
    if (bindings) return Promise.resolve(true);
    if (initialization) return initialization;
    const selectedLoader = loader || configuredLoader || loadGeneratedBindings;
    initialization = selectedLoader().then(async (loadedBindings) => {
      if (!isBindings(loadedBindings)) {
        throw new TypeError("Generated WASM module does not expose the expected bindings");
      }
      await loadedBindings.default(wasmUrl);
      bindings = loadedBindings;
      logger.info("Core" /* Core */, "WasmCore", "INITIALIZED", "WebAssembly stroke processing initialized");
      return true;
    }).catch((error) => {
      logger.debug(
        "Core" /* Core */,
        "JsCore",
        "WASM_UNAVAILABLE",
        `Using JavaScript stroke processing fallback: ${errorMessage2(error)}`
      );
      return false;
    });
    return initialization;
  }
  function smoothStroke(points) {
    if (!bindings) return smoothStrokeJs(points);
    try {
      const output = bindings.smooth_stroke_wasm(JSON.stringify(points));
      const parsed = validateStrokePoints(JSON.parse(output));
      if (parsed) return parsed;
      throw new TypeError("WASM returned an invalid stroke payload");
    } catch (error) {
      logger.error(
        "Core" /* Core */,
        "WasmCore",
        "SMOOTHING_ERROR",
        `WASM smoothing failed; using JavaScript fallback: ${errorMessage2(error)}`
      );
      return smoothStrokeJs(points);
    }
  }
  function isOpenInkBridgeWasmInitialized() {
    return bindings !== null;
  }
  async function loadGeneratedBindings() {
    return import(GENERATED_WASM_MODULE_PATH);
  }
  function isBindings(value) {
    return typeof value === "object" && value !== null && typeof value.default === "function" && typeof value.smooth_stroke_wasm === "function";
  }
  function errorMessage2(error) {
    return error instanceof Error ? error.message : String(error);
  }

  // src/canvas.ts
  var resizeSubscribers = /* @__PURE__ */ new Set();
  var resizeListenerInstalled = false;
  var strokeSequence = 0;
  var canvasSequence = 0;
  function dispatchResize() {
    for (const subscriber of Array.from(resizeSubscribers)) subscriber();
  }
  function subscribeToWindowResize(subscriber) {
    if (typeof window === "undefined") return () => {
    };
    resizeSubscribers.add(subscriber);
    if (!resizeListenerInstalled) {
      window.addEventListener("resize", dispatchResize);
      resizeListenerInstalled = true;
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      resizeSubscribers.delete(subscriber);
      if (resizeSubscribers.size === 0 && resizeListenerInstalled) {
        window.removeEventListener("resize", dispatchResize);
        resizeListenerInstalled = false;
      }
    };
  }
  var OpenInkBridgeCanvas = class {
    constructor(canvas, options, bridge = openInkBridge) {
      this.strokeCallbacks = /* @__PURE__ */ new Set();
      this.document = {
        schemaVersion: INK_DOCUMENT_SCHEMA_VERSION,
        strokes: []
      };
      this.committedCanvas = null;
      this.committedContext = null;
      this.unsubscribeBridge = null;
      this.liveUnsubscribeStart = null;
      this.liveUnsubscribeUpdate = null;
      this.activeStrokeStyle = null;
      this.isDrawingActive = false;
      this.destroyed = false;
      this.cssWidth = 0;
      this.cssHeight = 0;
      this.lastLivePoint = null;
      this.canvas = canvas;
      this.bridge = bridge;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("OpenInkBridgeCanvas: Could not acquire 2D context from canvas element.");
      }
      this.ctx = context;
      this.options = {
        strokeColor: normalizeStrokeColor(options?.strokeColor, DEFAULT_STROKE_COLOR),
        strokeWidth: normalizeStrokeWidth(options?.strokeWidth, DEFAULT_STROKE_WIDTH),
        smoothing: options?.smoothing !== false,
        stylusOnly: options?.stylusOnly !== false
      };
      const canvasId = canvas.id || `canvas-${++canvasSequence}`;
      this.session = bridge.createSession(canvasId);
      this.createCommittedSurface();
      this.setupCanvasQuality();
      this.unsubscribeResize = subscribeToWindowResize(() => this.handleResize());
      void initOpenInkBridgeWasm();
    }
    enableDrawing() {
      this.assertNotDestroyed();
      if (this.isDrawingActive) return;
      this.isDrawingActive = true;
      this.unsubscribeBridge = this.session.onStrokeFinished((points) => this.commitStroke(points));
      if (!this.bridge.isSupported()) {
        this.liveUnsubscribeStart = this.session.onStrokeStarted((point) => {
          this.activeStrokeStyle = this.currentStyle();
          this.ctx.strokeStyle = this.activeStrokeStyle.color;
          this.lastLivePoint = point;
        });
        this.liveUnsubscribeUpdate = this.session.onStrokeUpdated((point) => this.drawLivePoint(point));
      }
      this.session.setWritingMode(true, this.drawingTarget(), this.currentStylingOptions());
    }
    disableDrawing() {
      if (!this.isDrawingActive || this.destroyed) return;
      this.isDrawingActive = false;
      this.session.setWritingMode(false, this.drawingTarget(), this.currentStylingOptions());
      this.unsubscribeInputCallbacks();
      this.activeStrokeStyle = null;
      this.lastLivePoint = null;
      this.restoreCommittedLayer();
    }
    /** Release all native, pointer, callback, resize, and backing-surface resources. */
    destroy() {
      if (this.destroyed) return;
      this.disableDrawing();
      this.unsubscribeResize();
      this.session.destroy();
      this.strokeCallbacks.clear();
      this.committedCanvas = null;
      this.committedContext = null;
      this.destroyed = true;
    }
    setStyle(color, width, stylusOnly) {
      this.assertNotDestroyed();
      this.options.strokeColor = normalizeStrokeColor(color, this.options.strokeColor);
      this.options.strokeWidth = normalizeStrokeWidth(width, this.options.strokeWidth);
      if (stylusOnly !== void 0) this.options.stylusOnly = stylusOnly;
      if (this.isDrawingActive) {
        this.session.setWritingMode(true, this.drawingTarget(), this.currentStylingOptions());
      }
    }
    clear() {
      this.assertNotDestroyed();
      this.document.strokes = [];
      this.activeStrokeStyle = null;
      this.lastLivePoint = null;
      this.clearContext(this.committedContext);
      this.clearContext(this.ctx);
      if (this.bridge.isSupported()) this.session.onStrokeDrawn();
    }
    /** Export an immutable snapshot of the styled document model. */
    getDocument() {
      return cloneInkDocument(this.document);
    }
    /** Backwards-compatible point-only export. Every nested value is defensively copied. */
    getStrokes() {
      return this.document.strokes.map((stroke) => cloneStrokePoints(stroke.points));
    }
    exportToSvg() {
      this.assertNotDestroyed();
      const width = formatSvgNumber(this.cssWidth || this.canvas.clientWidth);
      const height = formatSvgNumber(this.cssHeight || this.canvas.clientHeight);
      let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
      for (const stroke of this.document.strokes) {
        if (stroke.points.length < 2) continue;
        const path = stroke.points.map((point, index) => `${index === 0 ? "M" : "L"} ${formatSvgNumber(point.x)} ${formatSvgNumber(point.y)}`).join(" ");
        const safeColor = escapeXmlAttribute(normalizeStrokeColor(stroke.style.color, DEFAULT_STROKE_COLOR));
        const safeWidth = formatSvgNumber(normalizeStrokeWidth(stroke.style.width, DEFAULT_STROKE_WIDTH));
        svg += `<path d="${path}" stroke="${safeColor}" stroke-width="${safeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
      }
      return `${svg}</svg>`;
    }
    /** Listen only to strokes committed by this canvas session. */
    onStrokeFinished(callback) {
      this.assertNotDestroyed();
      this.strokeCallbacks.add(callback);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        this.strokeCallbacks.delete(callback);
      };
    }
    commitStroke(rawPoints) {
      if (this.destroyed || rawPoints.length === 0) return;
      const points = this.options.smoothing ? smoothStroke(rawPoints) : cloneStrokePoints(rawPoints);
      const stroke = {
        id: `stroke-${Date.now().toString(36)}-${++strokeSequence}`,
        points: cloneStrokePoints(points),
        style: this.activeStrokeStyle ? { ...this.activeStrokeStyle } : this.currentStyle()
      };
      this.document.strokes.push(stroke);
      if (this.committedContext) {
        this.drawStroke(this.committedContext, stroke);
        this.restoreCommittedLayer();
      } else {
        this.redrawCanvas();
      }
      this.activeStrokeStyle = null;
      this.lastLivePoint = null;
      this.session.onStrokeDrawn();
      this.notifyStrokeCallbacks(stroke.points);
    }
    notifyStrokeCallbacks(points) {
      for (const callback of Array.from(this.strokeCallbacks)) {
        try {
          callback(cloneStrokePoints(points));
        } catch (error) {
          logger.error(
            "JsBridge" /* JsBridge */,
            "CanvasCallback",
            "STROKE_CALLBACK_ERROR",
            `Canvas stroke callback failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
    drawLivePoint(point) {
      if (this.lastLivePoint) {
        const style = this.activeStrokeStyle || this.currentStyle();
        const averagePressure = (this.lastLivePoint.pressure + point.pressure) / 2;
        this.ctx.strokeStyle = style.color;
        this.ctx.lineWidth = Math.max(0.5, style.width * averagePressure);
        this.ctx.lineCap = "round";
        this.ctx.beginPath();
        this.ctx.moveTo(this.lastLivePoint.x, this.lastLivePoint.y);
        this.ctx.lineTo(point.x, point.y);
        this.ctx.stroke();
      }
      this.lastLivePoint = point;
    }
    createCommittedSurface() {
      const ownerDocument = this.canvas.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!ownerDocument) return;
      const committedCanvas = ownerDocument.createElement("canvas");
      const committedContext = committedCanvas.getContext("2d");
      if (!committedContext) return;
      this.committedCanvas = committedCanvas;
      this.committedContext = committedContext;
    }
    setupCanvasQuality() {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const rect = this.canvas.getBoundingClientRect();
      this.cssWidth = Math.max(0, Number.isFinite(rect.width) ? rect.width : 0);
      this.cssHeight = Math.max(0, Number.isFinite(rect.height) ? rect.height : 0);
      const physicalWidth = Math.max(0, Math.round(this.cssWidth * dpr));
      const physicalHeight = Math.max(0, Math.round(this.cssHeight * dpr));
      this.configureSurface(this.canvas, this.ctx, physicalWidth, physicalHeight, dpr);
      if (this.committedCanvas && this.committedContext) {
        this.configureSurface(this.committedCanvas, this.committedContext, physicalWidth, physicalHeight, dpr);
      }
    }
    configureSurface(canvas, context, physicalWidth, physicalHeight, dpr) {
      canvas.width = physicalWidth;
      canvas.height = physicalHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
    }
    handleResize() {
      if (this.destroyed) return;
      this.setupCanvasQuality();
      this.redrawCanvas();
      if (this.isDrawingActive) {
        this.session.setWritingMode(true, this.drawingTarget(), this.currentStylingOptions());
      }
    }
    redrawCanvas() {
      this.clearContext(this.committedContext);
      if (this.committedContext) {
        for (const stroke of this.document.strokes) this.drawStroke(this.committedContext, stroke);
        this.restoreCommittedLayer();
        return;
      }
      this.clearContext(this.ctx);
      for (const stroke of this.document.strokes) this.drawStroke(this.ctx, stroke);
    }
    restoreCommittedLayer() {
      this.clearContext(this.ctx);
      if (!this.committedCanvas || this.cssWidth === 0 || this.cssHeight === 0) return;
      this.ctx.drawImage(this.committedCanvas, 0, 0, this.cssWidth, this.cssHeight);
    }
    clearContext(context) {
      if (!context) return;
      context.clearRect(0, 0, this.cssWidth, this.cssHeight);
    }
    drawStroke(context, stroke) {
      const { points, style } = stroke;
      if (points.length < 2) return;
      context.strokeStyle = style.color;
      const totalSegments = points.length - 1;
      for (let index = 0; index < totalSegments; index++) {
        const first = points[index];
        const second = points[index + 1];
        const averagePressure = (first.pressure + second.pressure) / 2;
        context.lineWidth = Math.max(0.5, style.width * averagePressure);
        context.lineCap = totalSegments === 1 || index === 0 || index === totalSegments - 1 ? "round" : "butt";
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.stroke();
      }
    }
    unsubscribeInputCallbacks() {
      this.unsubscribeBridge?.();
      this.liveUnsubscribeStart?.();
      this.liveUnsubscribeUpdate?.();
      this.unsubscribeBridge = null;
      this.liveUnsubscribeStart = null;
      this.liveUnsubscribeUpdate = null;
    }
    currentStyle() {
      return {
        color: this.options.strokeColor,
        width: this.options.strokeWidth
      };
    }
    currentStylingOptions() {
      return {
        ...this.currentStyle(),
        stylusOnly: this.options.stylusOnly
      };
    }
    drawingTarget() {
      return this.canvas.parentElement || this.canvas;
    }
    assertNotDestroyed() {
      if (this.destroyed) throw new Error("OpenInkBridgeCanvas has been destroyed");
    }
  };
  return __toCommonJS(global_exports);
})();
