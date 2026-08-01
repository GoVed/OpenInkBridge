import {
    OpenInkBridge,
    OpenInkBridgeSession,
    openInkBridge,
    StrokeCallback
} from './bridge';
import {
    cloneInkDocument,
    cloneStrokePoints,
    DEFAULT_STROKE_COLOR,
    DEFAULT_STROKE_WIDTH,
    escapeXmlAttribute,
    formatSvgNumber,
    InkDocument,
    InkStroke,
    INK_DOCUMENT_SCHEMA_VERSION,
    normalizeStrokeColor,
    normalizeStrokeWidth,
    StrokePoint,
    StrokeStyle
} from './model';
import {
    configureOpenInkBridgeWasmLoader,
    initOpenInkBridgeWasm,
    isOpenInkBridgeWasmInitialized,
    OpenInkBridgeWasmBindings,
    OpenInkBridgeWasmLoader,
    smoothStroke
} from './wasm';
import { logger, Subsystem } from './logger';

export {
    configureOpenInkBridgeWasmLoader,
    initOpenInkBridgeWasm,
    isOpenInkBridgeWasmInitialized,
    OpenInkBridgeWasmBindings,
    OpenInkBridgeWasmLoader
} from './wasm';

export interface CanvasOptions {
    strokeColor?: string;
    strokeWidth?: number;
    smoothing?: boolean;
    stylusOnly?: boolean;
}

interface ResolvedCanvasOptions {
    strokeColor: string;
    strokeWidth: number;
    smoothing: boolean;
    stylusOnly: boolean;
}

const resizeSubscribers = new Set<() => void>();
let resizeListenerInstalled = false;
let strokeSequence = 0;
let canvasSequence = 0;

function dispatchResize(): void {
    for (const subscriber of Array.from(resizeSubscribers)) subscriber();
}

function subscribeToWindowResize(subscriber: () => void): () => void {
    if (typeof window === 'undefined') return () => {};

    resizeSubscribers.add(subscriber);
    if (!resizeListenerInstalled) {
        window.addEventListener('resize', dispatchResize);
        resizeListenerInstalled = true;
    }

    let subscribed = true;
    return () => {
        if (!subscribed) return;
        subscribed = false;
        resizeSubscribers.delete(subscriber);
        if (resizeSubscribers.size === 0 && resizeListenerInstalled) {
            window.removeEventListener('resize', dispatchResize);
            resizeListenerInstalled = false;
        }
    };
}

export class OpenInkBridgeCanvas {
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly bridge: OpenInkBridge;
    private readonly session: OpenInkBridgeSession;
    private readonly strokeCallbacks = new Set<StrokeCallback>();
    private readonly unsubscribeResize: () => void;
    private options: ResolvedCanvasOptions;
    private document: InkDocument = {
        schemaVersion: INK_DOCUMENT_SCHEMA_VERSION,
        strokes: []
    };
    private committedCanvas: HTMLCanvasElement | null = null;
    private committedContext: CanvasRenderingContext2D | null = null;
    private unsubscribeBridge: (() => void) | null = null;
    private liveUnsubscribeStart: (() => void) | null = null;
    private liveUnsubscribeUpdate: (() => void) | null = null;
    private activeStrokeStyle: StrokeStyle | null = null;
    private isDrawingActive = false;
    private destroyed = false;
    private cssWidth = 0;
    private cssHeight = 0;

    constructor(canvas: HTMLCanvasElement, options?: CanvasOptions, bridge: OpenInkBridge = openInkBridge) {
        this.canvas = canvas;
        this.bridge = bridge;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('OpenInkBridgeCanvas: Could not acquire 2D context from canvas element.');
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

        // Generated WASM is optional; the promise resolves false on a clean checkout.
        void initOpenInkBridgeWasm();
    }

    public enableDrawing(): void {
        this.assertNotDestroyed();
        if (this.isDrawingActive) return;
        this.isDrawingActive = true;

        this.unsubscribeBridge = this.session.onStrokeFinished(points => this.commitStroke(points));
        if (!this.bridge.isSupported()) {
            this.liveUnsubscribeStart = this.session.onStrokeStarted(point => {
                this.activeStrokeStyle = this.currentStyle();
                this.ctx.strokeStyle = this.activeStrokeStyle.color;
                this.lastLivePoint = point;
            });
            this.liveUnsubscribeUpdate = this.session.onStrokeUpdated(point => this.drawLivePoint(point));
        }

        this.session.setWritingMode(true, this.drawingTarget(), this.currentStylingOptions());
    }

    public disableDrawing(): void {
        if (!this.isDrawingActive || this.destroyed) return;
        this.isDrawingActive = false;
        this.session.setWritingMode(false, this.drawingTarget(), this.currentStylingOptions());
        this.unsubscribeInputCallbacks();
        this.activeStrokeStyle = null;
        this.lastLivePoint = null;
        this.restoreCommittedLayer();
    }

    /** Release all native, pointer, callback, resize, and backing-surface resources. */
    public destroy(): void {
        if (this.destroyed) return;
        this.disableDrawing();
        this.unsubscribeResize();
        this.session.destroy();
        this.strokeCallbacks.clear();
        this.committedCanvas = null;
        this.committedContext = null;
        this.destroyed = true;
    }

    public setStyle(color: string, width: number, stylusOnly?: boolean): void {
        this.assertNotDestroyed();
        this.options.strokeColor = normalizeStrokeColor(color, this.options.strokeColor);
        this.options.strokeWidth = normalizeStrokeWidth(width, this.options.strokeWidth);
        if (stylusOnly !== undefined) this.options.stylusOnly = stylusOnly;

        if (this.isDrawingActive) {
            this.session.setWritingMode(true, this.drawingTarget(), this.currentStylingOptions());
        }
    }

    public clear(): void {
        this.assertNotDestroyed();
        this.document.strokes = [];
        this.activeStrokeStyle = null;
        this.lastLivePoint = null;
        this.clearContext(this.committedContext);
        this.clearContext(this.ctx);

        // The legacy native implementation uses this acknowledgement to clear its hardware layer.
        if (this.bridge.isSupported()) this.session.onStrokeDrawn();
    }

    /** Export an immutable snapshot of the styled document model. */
    public getDocument(): InkDocument {
        return cloneInkDocument(this.document);
    }

    /** Backwards-compatible point-only export. Every nested value is defensively copied. */
    public getStrokes(): StrokePoint[][] {
        return this.document.strokes.map(stroke => cloneStrokePoints(stroke.points));
    }

    public exportToSvg(): string {
        this.assertNotDestroyed();
        const width = formatSvgNumber(this.cssWidth || this.canvas.clientWidth);
        const height = formatSvgNumber(this.cssHeight || this.canvas.clientHeight);
        let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

        for (const stroke of this.document.strokes) {
            if (stroke.points.length < 2) continue;
            const path = stroke.points
                .map((point, index) => `${index === 0 ? 'M' : 'L'} ${formatSvgNumber(point.x)} ${formatSvgNumber(point.y)}`)
                .join(' ');
            const safeColor = escapeXmlAttribute(normalizeStrokeColor(stroke.style.color, DEFAULT_STROKE_COLOR));
            const safeWidth = formatSvgNumber(normalizeStrokeWidth(stroke.style.width, DEFAULT_STROKE_WIDTH));
            svg += `<path d="${path}" stroke="${safeColor}" stroke-width="${safeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
        }

        return `${svg}</svg>`;
    }

    /** Listen only to strokes committed by this canvas session. */
    public onStrokeFinished(callback: StrokeCallback): () => void {
        this.assertNotDestroyed();
        this.strokeCallbacks.add(callback);
        let subscribed = true;
        return () => {
            if (!subscribed) return;
            subscribed = false;
            this.strokeCallbacks.delete(callback);
        };
    }

    private lastLivePoint: StrokePoint | null = null;

    private commitStroke(rawPoints: StrokePoint[]): void {
        if (this.destroyed || rawPoints.length === 0) return;

        const points = this.options.smoothing ? smoothStroke(rawPoints) : cloneStrokePoints(rawPoints);
        const stroke: InkStroke = {
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

    private notifyStrokeCallbacks(points: readonly StrokePoint[]): void {
        for (const callback of Array.from(this.strokeCallbacks)) {
            try {
                callback(cloneStrokePoints(points));
            } catch (error) {
                logger.error(
                    Subsystem.JsBridge,
                    'CanvasCallback',
                    'STROKE_CALLBACK_ERROR',
                    `Canvas stroke callback failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    private drawLivePoint(point: StrokePoint): void {
        if (this.lastLivePoint) {
            const style = this.activeStrokeStyle || this.currentStyle();
            const averagePressure = (this.lastLivePoint.pressure + point.pressure) / 2;
            this.ctx.strokeStyle = style.color;
            this.ctx.lineWidth = Math.max(0.5, style.width * averagePressure);
            this.ctx.lineCap = 'round';
            this.ctx.beginPath();
            this.ctx.moveTo(this.lastLivePoint.x, this.lastLivePoint.y);
            this.ctx.lineTo(point.x, point.y);
            this.ctx.stroke();
        }
        this.lastLivePoint = point;
    }

    private createCommittedSurface(): void {
        const ownerDocument = this.canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (!ownerDocument) return;

        const committedCanvas = ownerDocument.createElement('canvas');
        const committedContext = committedCanvas.getContext('2d');
        if (!committedContext) return;
        this.committedCanvas = committedCanvas;
        this.committedContext = committedContext;
    }

    private setupCanvasQuality(): void {
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
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

    private configureSurface(
        canvas: HTMLCanvasElement,
        context: CanvasRenderingContext2D,
        physicalWidth: number,
        physicalHeight: number,
        dpr: number
    ): void {
        canvas.width = physicalWidth;
        canvas.height = physicalHeight;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.lineCap = 'round';
        context.lineJoin = 'round';
    }

    private handleResize(): void {
        if (this.destroyed) return;
        this.setupCanvasQuality();
        this.redrawCanvas();
        if (this.isDrawingActive) {
            this.session.setWritingMode(true, this.drawingTarget(), this.currentStylingOptions());
        }
    }

    private redrawCanvas(): void {
        this.clearContext(this.committedContext);
        if (this.committedContext) {
            for (const stroke of this.document.strokes) this.drawStroke(this.committedContext, stroke);
            this.restoreCommittedLayer();
            return;
        }

        this.clearContext(this.ctx);
        for (const stroke of this.document.strokes) this.drawStroke(this.ctx, stroke);
    }

    private restoreCommittedLayer(): void {
        this.clearContext(this.ctx);
        if (!this.committedCanvas || this.cssWidth === 0 || this.cssHeight === 0) return;
        this.ctx.drawImage(this.committedCanvas, 0, 0, this.cssWidth, this.cssHeight);
    }

    private clearContext(context: CanvasRenderingContext2D | null): void {
        if (!context) return;
        context.clearRect(0, 0, this.cssWidth, this.cssHeight);
    }

    private drawStroke(context: CanvasRenderingContext2D, stroke: InkStroke): void {
        const { points, style } = stroke;
        if (points.length < 2) return;

        context.strokeStyle = style.color;
        const totalSegments = points.length - 1;
        for (let index = 0; index < totalSegments; index++) {
            const first = points[index];
            const second = points[index + 1];
            const averagePressure = (first.pressure + second.pressure) / 2;
            context.lineWidth = Math.max(0.5, style.width * averagePressure);
            context.lineCap = totalSegments === 1 || index === 0 || index === totalSegments - 1 ? 'round' : 'butt';
            context.beginPath();
            context.moveTo(first.x, first.y);
            context.lineTo(second.x, second.y);
            context.stroke();
        }
    }

    private unsubscribeInputCallbacks(): void {
        this.unsubscribeBridge?.();
        this.liveUnsubscribeStart?.();
        this.liveUnsubscribeUpdate?.();
        this.unsubscribeBridge = null;
        this.liveUnsubscribeStart = null;
        this.liveUnsubscribeUpdate = null;
    }

    private currentStyle(): StrokeStyle {
        return {
            color: this.options.strokeColor,
            width: this.options.strokeWidth
        };
    }

    private currentStylingOptions() {
        return {
            ...this.currentStyle(),
            stylusOnly: this.options.stylusOnly
        };
    }

    private drawingTarget(): HTMLElement {
        return this.canvas.parentElement || this.canvas;
    }

    private assertNotDestroyed(): void {
        if (this.destroyed) throw new Error('OpenInkBridgeCanvas has been destroyed');
    }
}
