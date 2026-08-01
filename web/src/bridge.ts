import { logger, LogLevel, Subsystem } from './logger';
import { collectDiagnostics, dumpConfiguration, createBugReport, DiagnosticsReport } from './diagnostics';
import {
    cloneStrokePoint,
    cloneStrokePoints,
    normalizeStrokeColor,
    normalizeStrokeWidth,
    StrokePoint,
    StylingOptions,
    validateStrokePoints
} from './model';

export { StrokePoint, StylingOptions } from './model';

export const BRIDGE_PROTOCOL_VERSION = 1 as const;
const MAX_NATIVE_PAYLOAD_LENGTH = 8 * 1024 * 1024;
const LEGACY_SESSION_ID = 'legacy';
const CALLBACK_REGISTRY_KEY = '__openInkBridgeCallbackRegistryV1';

export type StrokeCallback = (points: StrokePoint[]) => void;

export interface ParsedNativeStrokePayload {
    protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
    sessionId?: string;
    canvasId?: string;
    points: StrokePoint[];
}

export interface NativeStrokeEnvelope {
    protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
    type: 'strokeFinished';
    sessionId?: string;
    canvasId?: string;
    payload: {
        points: StrokePoint[];
    };
}

interface NativeBridgeApi {
    setWritingMode(enabled: boolean, optionsJson: string): void;
    onStrokeDrawn?(): void;
    onStrokeDrawnForSession?(messageJson: string): void;
}

interface SessionRecord {
    id: string;
    canvasId: string;
    strokeCallbacks: Set<StrokeCallback>;
    strokeStartCallbacks: Set<(point: StrokePoint) => void>;
    strokeUpdateCallbacks: Set<(point: StrokePoint) => void>;
    writingEnabled: boolean;
    activationOrder: number;
    targetElement: HTMLElement | null;
    options: StylingOptions;
    fallbackBinding: FallbackBinding | null;
    currentFallbackStroke: StrokePoint[];
    activePointerId: number | null;
}

interface FallbackBinding {
    element: HTMLElement;
    previousTouchAction: string;
    pointerDown: (event: PointerEvent) => void;
    pointerMove: (event: PointerEvent) => void;
    pointerUp: (event: PointerEvent) => void;
    pointerCancel: (event: PointerEvent) => void;
}

type NativePayloadHandler = (payload: unknown) => void;

interface NativeCallbackRegistry {
    protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
    handlers: Set<NativePayloadHandler>;
    dispatcher: (payload: unknown) => void;
    previous?: (payload: unknown) => void;
}

interface BridgeWindow extends Window {
    OpenInkBridgeNative?: NativeBridgeApi;
    onOpenInkBridgeStrokeFinished?: (payload: unknown) => void;
    [CALLBACK_REGISTRY_KEY]?: NativeCallbackRegistry;
}

let sessionSequence = 0;

/**
 * Accepts both the original raw point-array callback and protocol-v1 envelopes.
 * Invalid, oversized, non-finite, or future-version messages are rejected.
 */
export function parseNativeStrokePayload(input: unknown): ParsedNativeStrokePayload | null {
    let value = input;
    if (typeof input === 'string') {
        if (input.length > MAX_NATIVE_PAYLOAD_LENGTH) return null;
        try {
            value = JSON.parse(input);
        } catch {
            return null;
        }
    }

    if (Array.isArray(value)) {
        const points = validateStrokePoints(value);
        return points
            ? { protocolVersion: BRIDGE_PROTOCOL_VERSION, points }
            : null;
    }

    if (!isRecord(value)) return null;

    if (value.protocolVersion !== undefined && value.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
        return null;
    }
    if (value.type !== undefined && value.type !== 'strokeFinished') return null;

    const sessionId = readIdentifier(value.sessionId);
    const canvasId = readIdentifier(value.canvasId);
    if (value.sessionId !== undefined && !sessionId) return null;
    if (value.canvasId !== undefined && !canvasId) return null;

    let pointValue: unknown = value.points;
    if (pointValue === undefined && Array.isArray(value.payload)) {
        pointValue = value.payload;
    } else if (pointValue === undefined && isRecord(value.payload)) {
        pointValue = value.payload.points;
    }

    const points = validateStrokePoints(pointValue);
    if (!points) return null;

    return {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        ...(sessionId ? { sessionId } : {}),
        ...(canvasId ? { canvasId } : {}),
        points
    };
}

export class OpenInkBridgeSession {
    public readonly id: string;
    public readonly canvasId: string;
    private destroyed = false;

    constructor(private readonly owner: OpenInkBridge, record: SessionRecord) {
        this.id = record.id;
        this.canvasId = record.canvasId;
    }

    public setWritingMode(enabled: boolean, targetElement: HTMLElement, options?: StylingOptions): void {
        this.assertActive();
        this.owner.configureSession(this.id, enabled, targetElement, options);
    }

    public onStrokeFinished(callback: StrokeCallback): () => void {
        this.assertActive();
        return this.owner.subscribeToSession(this.id, 'finished', callback);
    }

    public onStrokeStarted(callback: (point: StrokePoint) => void): () => void {
        this.assertActive();
        return this.owner.subscribeToSession(this.id, 'started', callback);
    }

    public onStrokeUpdated(callback: (point: StrokePoint) => void): () => void {
        this.assertActive();
        return this.owner.subscribeToSession(this.id, 'updated', callback);
    }

    public onStrokeDrawn(): void {
        if (!this.destroyed) this.owner.onStrokeDrawn(this.id);
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.owner.destroySession(this.id);
    }

    private assertActive(): void {
        if (this.destroyed) throw new Error('OpenInkBridgeSession has been destroyed');
    }
}

export class OpenInkBridge {
    private readonly sessions = new Map<string, SessionRecord>();
    private readonly strokeCallbacks = new Set<StrokeCallback>();
    private readonly strokeStartCallbacks = new Set<(point: StrokePoint) => void>();
    private readonly strokeUpdateCallbacks = new Set<(point: StrokePoint) => void>();
    private readonly nativePayloadHandler = (payload: unknown) => this.handleNativePayload(payload);
    private activeNativeSessionId: string | null = null;
    private activationSequence = 0;
    private destroyed = false;

    constructor() {
        this.sessions.set(LEGACY_SESSION_ID, this.createSessionRecord(LEGACY_SESSION_ID, LEGACY_SESSION_ID));
        this.installNativeCallback();
        logger.info(Subsystem.JsBridge, 'Browser', 'INITIALIZE', 'OpenInkBridge JS SDK initialized');
    }

    /** Create an isolated event and fallback-input scope for one canvas. */
    public createSession(canvasId?: string): OpenInkBridgeSession {
        this.assertActive();
        const normalizedCanvasId = sanitizeIdentifier(canvasId) || `canvas-${++sessionSequence}`;
        const sessionId = `oib-${normalizedCanvasId}-${Date.now().toString(36)}-${++sessionSequence}`;
        const record = this.createSessionRecord(sessionId, normalizedCanvasId);
        this.sessions.set(sessionId, record);
        return new OpenInkBridgeSession(this, record);
    }

    /** Check whether a callable native OpenInkBridge interface is present. */
    public isSupported(): boolean {
        const nativeBridge = getNativeBridge();
        const supported = typeof nativeBridge?.setWritingMode === 'function';
        logger.debug(
            Subsystem.Backend,
            supported ? 'NativeBridge' : 'PointerFallback',
            'SUPPORTED_CHECK',
            supported
                ? 'Native OpenInkBridge interface detected'
                : 'Native OpenInkBridge interface not present; using browser fallbacks'
        );
        return supported;
    }

    /** Backwards-compatible singleton API, scoped internally as the legacy session. */
    public setWritingMode(enabled: boolean, targetElement: HTMLElement, options?: StylingOptions): void {
        this.configureSession(LEGACY_SESSION_ID, enabled, targetElement, options);
    }

    public configureSession(
        sessionId: string,
        enabled: boolean,
        targetElement: HTMLElement,
        options?: StylingOptions
    ): void {
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
    public onStrokeDrawn(sessionId = LEGACY_SESSION_ID): void {
        const nativeBridge = getNativeBridge();
        if (!nativeBridge) return;

        try {
            if (typeof nativeBridge.onStrokeDrawnForSession === 'function') {
                nativeBridge.onStrokeDrawnForSession(JSON.stringify({
                    protocolVersion: BRIDGE_PROTOCOL_VERSION,
                    type: 'strokeDrawn',
                    sessionId
                }));
            } else if (typeof nativeBridge.onStrokeDrawn === 'function') {
                nativeBridge.onStrokeDrawn();
            }
        } catch (error) {
            logger.error(
                Subsystem.Synchronization,
                'NativeBridge',
                'ON_STROKE_DRAWN_ERROR',
                `Failed to acknowledge native stroke: ${errorMessage(error)}`
            );
        }
    }

    /** Global observers are retained for source compatibility and receive every valid stroke. */
    public onStrokeFinished(callback: StrokeCallback): () => void {
        return subscribe(this.strokeCallbacks, callback);
    }

    public onStrokeStarted(callback: (point: StrokePoint) => void): () => void {
        return subscribe(this.strokeStartCallbacks, callback);
    }

    public onStrokeUpdated(callback: (point: StrokePoint) => void): () => void {
        return subscribe(this.strokeUpdateCallbacks, callback);
    }

    public subscribeToSession(
        sessionId: string,
        event: 'finished',
        callback: StrokeCallback
    ): () => void;
    public subscribeToSession(
        sessionId: string,
        event: 'started' | 'updated',
        callback: (point: StrokePoint) => void
    ): () => void;
    public subscribeToSession(
        sessionId: string,
        event: 'finished' | 'started' | 'updated',
        callback: StrokeCallback | ((point: StrokePoint) => void)
    ): () => void {
        const record = this.requireSession(sessionId);
        if (event === 'finished') {
            return subscribe(record.strokeCallbacks, callback as StrokeCallback);
        }
        if (event === 'started') {
            return subscribe(record.strokeStartCallbacks, callback as (point: StrokePoint) => void);
        }
        return subscribe(record.strokeUpdateCallbacks, callback as (point: StrokePoint) => void);
    }

    public destroySession(sessionId: string): void {
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

    public setLogLevel(level: LogLevel | string): void {
        logger.setLogLevel(level);
    }

    public collectDiagnostics(): DiagnosticsReport {
        return collectDiagnostics(undefined, this.isSupported());
    }

    public dumpConfiguration(): string {
        return dumpConfiguration(undefined, this.isSupported());
    }

    public createBugReport(): string {
        return createBugReport(undefined, this.isSupported());
    }

    public getRingBufferLogs() {
        return logger.getRingBufferLogs();
    }

    /** Primarily useful for isolated runtimes and tests; the exported singleton normally lives for the page. */
    public destroy(): void {
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

    private createSessionRecord(id: string, canvasId: string): SessionRecord {
        return {
            id,
            canvasId,
            strokeCallbacks: new Set(),
            strokeStartCallbacks: new Set(),
            strokeUpdateCallbacks: new Set(),
            writingEnabled: false,
            activationOrder: 0,
            targetElement: null,
            options: {
                color: '#000000',
                width: 4,
                stylusOnly: true
            },
            fallbackBinding: null,
            currentFallbackStroke: [],
            activePointerId: null
        };
    }

    private requireSession(sessionId: string): SessionRecord {
        const record = this.sessions.get(sessionId);
        if (!record) throw new Error(`Unknown OpenInkBridge session: ${sessionId}`);
        return record;
    }

    private installNativeCallback(): void {
        const bridgeWindow = getBridgeWindow();
        if (!bridgeWindow) return;

        let registry = bridgeWindow[CALLBACK_REGISTRY_KEY];
        if (!registry || registry.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
            const previous = typeof bridgeWindow.onOpenInkBridgeStrokeFinished === 'function'
                ? bridgeWindow.onOpenInkBridgeStrokeFinished
                : undefined;
            const handlers = new Set<NativePayloadHandler>();
            registry = {
                protocolVersion: BRIDGE_PROTOCOL_VERSION,
                handlers,
                previous,
                dispatcher: (payload: unknown) => {
                    for (const handler of Array.from(handlers)) handler(payload);
                    if (previous && previous !== registry?.dispatcher) previous(payload);
                }
            };
            bridgeWindow[CALLBACK_REGISTRY_KEY] = registry;
            bridgeWindow.onOpenInkBridgeStrokeFinished = registry.dispatcher;
        }
        registry.handlers.add(this.nativePayloadHandler);
    }

    private removeNativeCallback(): void {
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

    private handleNativePayload(payload: unknown): void {
        const parsed = parseNativeStrokePayload(payload);
        if (!parsed) {
            logger.error(
                Subsystem.Synchronization,
                'NativeBridge',
                'INVALID_STROKE_PAYLOAD',
                'Rejected malformed or unsupported native stroke payload'
            );
            return;
        }

        let record: SessionRecord | undefined;
        if (parsed.sessionId) record = this.sessions.get(parsed.sessionId);
        if (!record && parsed.canvasId) {
            record = Array.from(this.sessions.values()).find(candidate => candidate.canvasId === parsed.canvasId);
        }
        if (!record && !parsed.sessionId && !parsed.canvasId && this.activeNativeSessionId) {
            record = this.sessions.get(this.activeNativeSessionId);
        }
        if (!record && !parsed.sessionId && !parsed.canvasId) record = this.sessions.get(LEGACY_SESSION_ID);

        if (!record) {
            logger.warn(
                Subsystem.Synchronization,
                'NativeBridge',
                'UNKNOWN_SESSION',
                `Ignoring stroke for unknown session ${parsed.sessionId || parsed.canvasId || '(none)'}`
            );
            return;
        }

        logger.debug(
            Subsystem.Synchronization,
            'NativeBridge',
            'STROKE_RECEIVED',
            `Received finalized stroke with ${parsed.points.length} points for session ${record.id}`
        );
        this.notifyFinished(record, parsed.points);
    }

    private notifyFinished(record: SessionRecord, points: readonly StrokePoint[]): void {
        invokeStrokeCallbacks(record.strokeCallbacks, points);
        if (record.id !== LEGACY_SESSION_ID) invokeStrokeCallbacks(this.strokeCallbacks, points);
    }

    private notifyStarted(record: SessionRecord, point: StrokePoint): void {
        invokePointCallbacks(record.strokeStartCallbacks, point);
        if (record.id !== LEGACY_SESSION_ID) invokePointCallbacks(this.strokeStartCallbacks, point);
    }

    private notifyUpdated(record: SessionRecord, point: StrokePoint): void {
        invokePointCallbacks(record.strokeUpdateCallbacks, point);
        if (record.id !== LEGACY_SESSION_ID) invokePointCallbacks(this.strokeUpdateCallbacks, point);
    }

    private invokeNativeWritingMode(record: SessionRecord, enabled: boolean): void {
        const nativeBridge = getNativeBridge();
        if (!nativeBridge || !record.targetElement) return;

        const rect = record.targetElement.getBoundingClientRect();
        const payload = {
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            type: 'setWritingMode',
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
            nativeBridge.setWritingMode(enabled, JSON.stringify(payload));
            logger.info(
                Subsystem.JsBridge,
                'NativeBridge',
                'SET_WRITING_MODE',
                `Native writing mode enabled=${enabled} for session ${record.id}`,
                payload
            );
        } catch (error) {
            logger.error(
                Subsystem.JsBridge,
                'NativeBridge',
                'SET_WRITING_MODE_ERROR',
                `Native bridge rejected writing mode update: ${errorMessage(error)}`
            );
        }
    }

    private findMostRecentlyActivatedNativeSession(excludedId: string): SessionRecord | undefined {
        return Array.from(this.sessions.values())
            .filter(record => record.id !== excludedId && record.writingEnabled && record.targetElement)
            .sort((left, right) => right.activationOrder - left.activationOrder)[0];
    }

    private setupFallbackListeners(record: SessionRecord, element: HTMLElement): void {
        if (record.fallbackBinding?.element === element) return;
        this.removeFallbackListeners(record);

        const pointerDown = (event: PointerEvent) => {
            if (record.activePointerId !== null) return;
            if (record.options.stylusOnly && event.pointerType !== 'pen') return;
            event.preventDefault();
            tryCapturePointer(element, event.pointerId);

            record.activePointerId = event.pointerId;
            const point = pointFromEvent(event, element);
            record.currentFallbackStroke = [point];
            this.notifyStarted(record, point);
        };

        const pointerMove = (event: PointerEvent) => {
            if (record.activePointerId !== event.pointerId) return;
            event.preventDefault();
            const point = pointFromEvent(event, element);
            record.currentFallbackStroke.push(point);
            this.notifyUpdated(record, point);
        };

        const pointerUp = (event: PointerEvent) => {
            if (record.activePointerId !== event.pointerId) return;
            event.preventDefault();
            tryReleasePointer(element, event.pointerId);
            record.activePointerId = null;

            const points = record.currentFallbackStroke;
            record.currentFallbackStroke = [];
            if (points.length > 0) this.notifyFinished(record, points);
        };

        const pointerCancel = (event: PointerEvent) => {
            if (record.activePointerId !== event.pointerId) return;
            tryReleasePointer(element, event.pointerId);
            record.activePointerId = null;
            record.currentFallbackStroke = [];
            logger.warn(Subsystem.PenInput, 'PointerFallback', 'PEN_CANCEL', 'Pointer stroke cancelled');
        };

        record.fallbackBinding = {
            element,
            previousTouchAction: element.style.touchAction,
            pointerDown,
            pointerMove,
            pointerUp,
            pointerCancel
        };

        element.addEventListener('pointerdown', pointerDown, { passive: false });
        element.addEventListener('pointermove', pointerMove, { passive: false });
        element.addEventListener('pointerup', pointerUp, { passive: false });
        element.addEventListener('pointercancel', pointerCancel);
        element.style.touchAction = 'none';
    }

    private removeFallbackListeners(record: SessionRecord): void {
        const binding = record.fallbackBinding;
        if (!binding) return;

        binding.element.removeEventListener('pointerdown', binding.pointerDown);
        binding.element.removeEventListener('pointermove', binding.pointerMove);
        binding.element.removeEventListener('pointerup', binding.pointerUp);
        binding.element.removeEventListener('pointercancel', binding.pointerCancel);
        binding.element.style.touchAction = binding.previousTouchAction;
        record.fallbackBinding = null;
        record.currentFallbackStroke = [];
        record.activePointerId = null;
    }

    private assertActive(): void {
        if (this.destroyed) throw new Error('OpenInkBridge has been destroyed');
    }
}

function normalizeOptions(options: StylingOptions | undefined, previous: StylingOptions): StylingOptions {
    return {
        color: normalizeStrokeColor(options?.color, previous.color),
        width: normalizeStrokeWidth(options?.width, previous.width),
        stylusOnly: options?.stylusOnly ?? previous.stylusOnly ?? true
    };
}

function pointFromEvent(event: PointerEvent, element: HTMLElement): StrokePoint {
    const rect = element.getBoundingClientRect();
    return {
        x: finiteOrZero(event.clientX - rect.left),
        y: finiteOrZero(event.clientY - rect.top),
        pressure: Number.isFinite(event.pressure) ? Math.max(0, Math.min(16, event.pressure)) : 0.5,
        tilt: Number.isFinite(event.tiltX) ? Math.max(-180, Math.min(180, event.tiltX)) : 0,
        timestamp: Date.now()
    };
}

function invokeStrokeCallbacks(callbacks: Set<StrokeCallback>, points: readonly StrokePoint[]): void {
    for (const callback of Array.from(callbacks)) {
        try {
            callback(cloneStrokePoints(points));
        } catch (error) {
            logger.error(
                Subsystem.JsBridge,
                'Callback',
                'STROKE_CALLBACK_ERROR',
                `Stroke callback failed: ${errorMessage(error)}`
            );
        }
    }
}

function invokePointCallbacks(callbacks: Set<(point: StrokePoint) => void>, point: StrokePoint): void {
    for (const callback of Array.from(callbacks)) {
        try {
            callback(cloneStrokePoint(point));
        } catch (error) {
            logger.error(
                Subsystem.JsBridge,
                'Callback',
                'POINT_CALLBACK_ERROR',
                `Point callback failed: ${errorMessage(error)}`
            );
        }
    }
}

function subscribe<T>(callbacks: Set<T>, callback: T): () => void {
    callbacks.add(callback);
    let subscribed = true;
    return () => {
        if (!subscribed) return;
        subscribed = false;
        callbacks.delete(callback);
    };
}

function getBridgeWindow(): BridgeWindow | null {
    return typeof window === 'undefined' ? null : window as BridgeWindow;
}

function getNativeBridge(): NativeBridgeApi | undefined {
    return getBridgeWindow()?.OpenInkBridgeNative;
}

function readIdentifier(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const identifier = sanitizeIdentifier(value);
    return identifier || undefined;
}

function sanitizeIdentifier(value: unknown): string {
    return typeof value === 'string' && /^[a-z0-9._:-]{1,128}$/i.test(value) ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOrZero(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function tryCapturePointer(element: HTMLElement, pointerId: number): void {
    try {
        element.setPointerCapture(pointerId);
    } catch {
        // Pointer capture is best-effort (some WebViews expose only partial PointerEvent support).
    }
}

function tryReleasePointer(element: HTMLElement, pointerId: number): void {
    try {
        element.releasePointerCapture(pointerId);
    } catch {
        // It is safe to continue when capture was never acquired or was already lost.
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export const openInkBridge = new OpenInkBridge();
