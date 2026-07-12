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
    private fallbackCanvas: HTMLCanvasElement | null = null;
    private fallbackCtx: CanvasRenderingContext2D | null = null;
    private currentFallbackStroke: StrokePoint[] = [];
    private isDrawingFallback = false;

    constructor() {
        if (typeof window !== 'undefined') {
            // Register the global native callback hook
            (window as any).onOpenInkBridgeStrokeFinished = (strokeJson: string) => {
                try {
                    const points: StrokePoint[] = JSON.parse(strokeJson);
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
    public isSupported(): boolean {
        return typeof window !== 'undefined' && typeof (window as any).OpenInkBridgeNative !== 'undefined';
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
            (window as any).OpenInkBridgeNative.setWritingMode(enabled, JSON.stringify(payload));
            return;
        }

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
            // Explicitly prevent scrolling/gestures
            e.preventDefault();
            try {
                element.setPointerCapture(e.pointerId);
            } catch (err) {
                // Ignore if platform does not support pointer capture on target element
            }
            this.isDrawingFallback = true;
            const pt = this.getPointFromEvent(e, element);
            this.currentFallbackStroke = [pt];
            this.notifyStrokeStarted(pt);
        };

        const handlePointerMove = (e: PointerEvent) => {
            if (!this.isDrawingFallback) return;
            if (options?.stylusOnly && e.pointerType !== 'pen') return;
            e.preventDefault();
            const pt = this.getPointFromEvent(e, element);
            this.currentFallbackStroke.push(pt);
            this.notifyStrokeUpdated(pt);
        };

        const handlePointerUp = (e: PointerEvent) => {
            if (!this.isDrawingFallback) return;
            this.isDrawingFallback = false;
            try {
                element.releasePointerCapture(e.pointerId);
            } catch (err) {}
            
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
        element.style.touchAction = 'none'; // Prevent scrolling while drawing
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
            tilt: e.tiltX || 0, // Simplified tilt
            timestamp: Date.now()
        };
    }
}

export const openInkBridge = new OpenInkBridge();
