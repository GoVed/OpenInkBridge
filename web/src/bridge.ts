import { logger, LogLevel, Subsystem } from './logger';
import { collectDiagnostics, dumpConfiguration, createBugReport, DiagnosticsReport } from './diagnostics';

export interface StrokePoint {
    x: number;
    y: number;
    pressure: number;
    tilt: number;
    timestamp: number;
}

export interface StylingOptions {
    color: string;
    width: number;
    stylusOnly?: boolean;
}

export type StrokeCallback = (points: StrokePoint[]) => void;

class OpenInkBridge {
    private strokeCallbacks: StrokeCallback[] = [];
    private strokeStartCallbacks: ((point: StrokePoint) => void)[] = [];
    private strokeUpdateCallbacks: ((point: StrokePoint) => void)[] = [];
    private currentFallbackStroke: StrokePoint[] = [];
    private isDrawingFallback = false;

    constructor() {
        if (typeof window !== 'undefined') {
            logger.info(Subsystem.JsBridge, 'Browser', 'INITIALIZE', 'OpenInkBridge JS SDK initialized');
            // Register the global native callback hook
            (window as any).onOpenInkBridgeStrokeFinished = (strokeJson: string) => {
                try {
                    const points: StrokePoint[] = JSON.parse(strokeJson);
                    logger.debug(
                        Subsystem.Synchronization,
                        'NativeBridge',
                        'STROKE_RECEIVED',
                        `Received finalized stroke with ${points.length} points from native client`
                    );
                    this.notifyStrokeCallbacks(points);
                } catch (e: any) {
                    logger.error(
                        Subsystem.Synchronization,
                        'NativeBridge',
                        'PARSE_ERROR',
                        `Failed to parse stroke data from native client: ${e?.message || e}`
                    );
                }
            };
        }
    }

    /**
     * Check if the web app is running inside a native OpenInkBridge container.
     */
    public isSupported(): boolean {
        const supported = typeof window !== 'undefined' && typeof (window as any).OpenInkBridgeNative !== 'undefined';
        if (supported) {
            logger.debug(Subsystem.Backend, 'NativeBridge', 'SUPPORTED_CHECK', 'Native OpenInkBridge interface detected');
        } else {
            logger.debug(Subsystem.Backend, 'PointerFallback', 'SUPPORTED_CHECK', 'Native OpenInkBridge interface not present; using browser fallbacks');
        }
        return supported;
    }

    /**
     * Set writing mode. 
     * If supported, it enables the high-performance native E-Ink overlay.
     * If running in a standard web browser, it sets up standard pointer fallback listeners.
     */
    public setWritingMode(enabled: boolean, targetElement: HTMLElement, options?: StylingOptions) {
        if (this.isSupported()) {
            const rect = targetElement.getBoundingClientRect();
            const payload = {
                color: options?.color || '#000000',
                width: options?.width || 4,
                stylusOnly: options?.stylusOnly !== false,
                rect: {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height
                }
            };
            logger.info(
                Subsystem.JsBridge,
                'NativeBridge',
                'SET_WRITING_MODE',
                `Enabling native writing mode: enabled=${enabled}, rect=${rect.width}x${rect.height} at (${rect.left}, ${rect.top})`,
                payload
            );
            (window as any).OpenInkBridgeNative.setWritingMode(enabled, JSON.stringify(payload));
            return;
        }

        logger.info(
            Subsystem.JsBridge,
            'PointerFallback',
            'SET_WRITING_MODE',
            `Setting browser pointer fallback writing mode: enabled=${enabled}`
        );

        // Fallback implementation for standard browsers
        if (enabled) {
            this.setupFallbackListeners(targetElement, options);
        } else {
            this.removeFallbackListeners(targetElement);
        }
    }

    /**
     * Notify the native bridge that the stroke has been successfully redrawn on the software canvas.
     */
    public onStrokeDrawn() {
        if (this.isSupported() && typeof (window as any).OpenInkBridgeNative.onStrokeDrawn === 'function') {
            logger.debug(Subsystem.Synchronization, 'NativeBridge', 'ON_STROKE_DRAWN', 'Notifying native bridge that stroke was redrawn');
            (window as any).OpenInkBridgeNative.onStrokeDrawn();
        }
    }

    /**
     * Listen to finalized strokes.
     */
    public onStrokeFinished(callback: StrokeCallback): () => void {
        this.strokeCallbacks.push(callback);
        return () => {
            this.strokeCallbacks = this.strokeCallbacks.filter(cb => cb !== callback);
        };
    }

    /**
     * Listen to the start of a stylus stroke (pen down).
     */
    public onStrokeStarted(callback: (point: StrokePoint) => void): () => void {
        this.strokeStartCallbacks.push(callback);
        return () => {
            this.strokeStartCallbacks = this.strokeStartCallbacks.filter(cb => cb !== callback);
        };
    }

    /**
     * Listen to live updates during a stylus stroke (pen drag).
     */
    public onStrokeUpdated(callback: (point: StrokePoint) => void): () => void {
        this.strokeUpdateCallbacks.push(callback);
        return () => {
            this.strokeUpdateCallbacks = this.strokeUpdateCallbacks.filter(cb => cb !== callback);
        };
    }

    /**
     * Diagnostics & Logging Public API Methods
     */
    public setLogLevel(level: LogLevel | string) {
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

    private notifyStrokeCallbacks(points: StrokePoint[]) {
        this.strokeCallbacks.forEach(cb => cb(points));
    }

    private notifyStrokeStarted(point: StrokePoint) {
        this.strokeStartCallbacks.forEach(cb => cb(point));
    }

    private notifyStrokeUpdated(point: StrokePoint) {
        this.strokeUpdateCallbacks.forEach(cb => cb(point));
    }

    private setupFallbackListeners(element: HTMLElement, options?: StylingOptions) {
        // Fallback uses pointer events to capture pressure and coordinates
        const handlePointerDown = (e: PointerEvent) => {
            if (options?.stylusOnly && e.pointerType !== 'pen') return;
            e.preventDefault();
            try {
                element.setPointerCapture(e.pointerId);
            } catch (err) {}
            this.isDrawingFallback = true;
            const pt = this.getPointFromEvent(e, element);
            this.currentFallbackStroke = [pt];
            logger.debug(Subsystem.PenInput, 'PointerFallback', 'PEN_DOWN', `Pen down at (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}) pressure=${pt.pressure}`);
            this.notifyStrokeStarted(pt);
        };

        const handlePointerMove = (e: PointerEvent) => {
            if (!this.isDrawingFallback) return;
            if (options?.stylusOnly && e.pointerType !== 'pen') return;
            e.preventDefault();
            const pt = this.getPointFromEvent(e, element);
            this.currentFallbackStroke.push(pt);
            if (logger.shouldLogTrace(30)) {
                logger.trace(Subsystem.PenInput, 'PointerFallback', 'PEN_MOVE', `Pen move (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}) pressure=${pt.pressure}`);
            }
            this.notifyStrokeUpdated(pt);
        };

        const handlePointerUp = (e: PointerEvent) => {
            if (!this.isDrawingFallback) return;
            this.isDrawingFallback = false;
            try {
                element.releasePointerCapture(e.pointerId);
            } catch (err) {}
            
            logger.debug(Subsystem.PenInput, 'PointerFallback', 'PEN_UP', `Pen up stroke finished with ${this.currentFallbackStroke.length} points`);
            if (this.currentFallbackStroke.length > 0) {
                this.notifyStrokeCallbacks(this.currentFallbackStroke);
            }
            this.currentFallbackStroke = [];
        };

        const handlePointerCancel = (e: PointerEvent) => {
            if (!this.isDrawingFallback) return;
            this.isDrawingFallback = false;
            try {
                element.releasePointerCapture(e.pointerId);
            } catch (err) {}
            logger.warn(Subsystem.PenInput, 'PointerFallback', 'PEN_CANCEL', 'Pointer stroke cancelled');
            this.currentFallbackStroke = [];
        };

        (element as any)._openInkBridgeDown = handlePointerDown;
        (element as any)._openInkBridgeMove = handlePointerMove;
        (element as any)._openInkBridgeUp = handlePointerUp;
        (element as any)._openInkBridgeCancel = handlePointerCancel;

        element.addEventListener('pointerdown', handlePointerDown, { passive: false });
        element.addEventListener('pointermove', handlePointerMove, { passive: false });
        element.addEventListener('pointerup', handlePointerUp);
        element.addEventListener('pointercancel', handlePointerCancel);
        element.style.touchAction = 'none';
    }

    private removeFallbackListeners(element: HTMLElement) {
        const down = (element as any)._openInkBridgeDown;
        const move = (element as any)._openInkBridgeMove;
        const up = (element as any)._openInkBridgeUp;
        const cancel = (element as any)._openInkBridgeCancel;

        if (down) element.removeEventListener('pointerdown', down);
        if (move) element.removeEventListener('pointermove', move);
        if (up) element.removeEventListener('pointerup', up);
        if (cancel) element.removeEventListener('pointercancel', cancel);
        element.style.touchAction = '';
    }

    private getPointFromEvent(e: PointerEvent, element: HTMLElement): StrokePoint {
        const rect = element.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            pressure: e.pressure || 0.5,
            tilt: e.tiltX || 0,
            timestamp: Date.now()
        };
    }
}

export const openInkBridge = new OpenInkBridge();

