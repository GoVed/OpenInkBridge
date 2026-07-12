import { openInkBridge, StrokePoint, StylingOptions } from './bridge';
import init, { smooth_stroke_wasm } from './wasm/openinkbridge_core';

let isWasmInitialized = false;
let wasmInitPromise: Promise<void> | null = null;

/**
 * Dynamically loads and initializes the compiled Rust core math engine WebAssembly module.
 */
export async function initOpenInkBridgeWasm(wasmUrl?: string | URL): Promise<void> {
    if (isWasmInitialized) return;
    if (!wasmInitPromise) {
        wasmInitPromise = init(wasmUrl).then(() => {
            isWasmInitialized = true;
            console.log("OpenInkBridge: WebAssembly core math engine initialized successfully.");
        }).catch((err) => {
            console.warn("OpenInkBridge: WebAssembly initialization failed. Drawing will fallback to browser JS math.", err);
        });
    }
    return wasmInitPromise;
}

export interface CanvasOptions {
    strokeColor?: string;
    strokeWidth?: number;
    smoothing?: boolean;
    stylusOnly?: boolean;
}

export class OpenInkBridgeCanvas {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private options: Required<CanvasOptions>;
    private strokes: StrokePoint[][] = [];
    private unsubscribeBridge: (() => void) | null = null;
    private liveUnsubscribeStart: (() => void) | null = null;
    private liveUnsubscribeUpdate: (() => void) | null = null;
    private isDrawingActive = false;

    constructor(canvas: HTMLCanvasElement, options?: CanvasOptions) {
        this.canvas = canvas;
        const context = canvas.getContext('2d');
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
        
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', () => {
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
        
        // Trigger background WebAssembly module loading
        initOpenInkBridgeWasm().catch(() => {});
    }

    private setupCanvasQuality() {
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const rect = this.canvas.getBoundingClientRect();
        
        // Always configure high-DPI scaling matching element's bounding rect
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);

        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    /**
     * Enable E-Ink drawing mode. Hands over input rendering to the EPD overlay
     * if supported, otherwise configures local browser pointer capture fallback.
     */
    public enableDrawing() {
        if (this.isDrawingActive) return;
        this.isDrawingActive = true;

        const container = this.canvas.parentElement || this.canvas;
        
        // 1. Tell bridge to activate E-Ink overlay (or fallback pointer listeners)
        openInkBridge.setWritingMode(true, container, {
            color: this.options.strokeColor,
            width: this.options.strokeWidth,
            stylusOnly: this.options.stylusOnly
        });

        // 2. Subscribe to stroke completion events
        this.unsubscribeBridge = openInkBridge.onStrokeFinished((points) => {
            const processedPoints = this.options.smoothing ? this.smoothPoints(points) : points;
            this.strokes.push(processedPoints);
            // Redraw all completed strokes to snap raw preview strokes to the finalized smoothed vector paths
            this.redrawCanvas();
            openInkBridge.onStrokeDrawn();
        });

        // 3. Subscribe to live draw updates in fallback mode
        if (!openInkBridge.isSupported()) {
            let lastPoint: StrokePoint | null = null;
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
    public disableDrawing() {
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
    private redrawCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        for (const stroke of this.strokes) {
            this.drawStroke(stroke);
        }
    }

    public setStyle(color: string, width: number, stylusOnly?: boolean) {
        this.options.strokeColor = color;
        this.options.strokeWidth = width;
        if (stylusOnly !== undefined) {
            this.options.stylusOnly = stylusOnly;
        }
        
        if (this.isDrawingActive) {
            // Update overlay config
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
    public clear() {
        this.strokes = [];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Also clear native hardware E-Ink layer if present
        if (openInkBridge.isSupported()) {
            const container = this.canvas.parentElement || this.canvas;
            const rect = container.getBoundingClientRect();
            
            (window as any).OpenInkBridgeNative.setWritingMode(this.isDrawingActive, JSON.stringify({
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
    public exportToSvg(): string {
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

        svg += '</svg>';
        return svg;
    }

    /**
     * Export vector strokes.
     */
    public getStrokes(): StrokePoint[][] {
        return this.strokes;
    }

    /**
     * Listen to finished strokes.
     */
    public onStrokeFinished(callback: (stroke: StrokePoint[]) => void): () => void {
        return openInkBridge.onStrokeFinished(callback);
    }

    private drawStroke(points: StrokePoint[]) {
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

    private smoothPoints(points: StrokePoint[]): StrokePoint[] {
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

        // Standard JS double-exponential/moving-average math fallback
        const smoothed: StrokePoint[] = [points[0]];
        for (let i = 1; i < points.length - 1; i++) {
            smoothed.push({
                x: (points[i-1].x + points[i].x + points[i+1].x) / 3,
                y: (points[i-1].y + points[i].y + points[i+1].y) / 3,
                pressure: (points[i-1].pressure + points[i].pressure + points[i+1].pressure) / 3,
                tilt: (points[i-1].tilt + points[i].tilt + points[i+1].tilt) / 3,
                timestamp: points[i].timestamp
            });
        }
        smoothed.push(points[points.length - 1]);
        return smoothed;
    }
}
