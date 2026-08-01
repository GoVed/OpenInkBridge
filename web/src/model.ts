export const INK_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const DEFAULT_STROKE_COLOR = '#000000';
export const DEFAULT_STROKE_WIDTH = 4;

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

export interface StrokeStyle {
    color: string;
    width: number;
}

export interface InkStroke {
    id: string;
    points: StrokePoint[];
    style: StrokeStyle;
}

export interface InkDocument {
    schemaVersion: typeof INK_DOCUMENT_SCHEMA_VERSION;
    strokes: InkStroke[];
}

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED_COLOR = /^[a-z]{1,32}$/i;
const FUNCTION_COLOR = /^(?:rgb|rgba|hsl|hsla)\([0-9+\-.,%/\s]+\)$/i;
const SAFE_CSS_COLOR_CHARACTERS = /^[#(),.%+\-/\sa-z0-9]+$/i;

/**
 * Keep untrusted native/application strings out of canvas and SVG style fields.
 * Browsers with CSS.supports may accept newer color syntaxes, but only when the
 * value contains characters that cannot terminate an XML attribute.
 */
export function normalizeStrokeColor(value: unknown, fallback = DEFAULT_STROKE_COLOR): string {
    if (typeof value !== 'string') return fallback;

    const color = value.trim();
    if (color.length === 0 || color.length > 128 || !SAFE_CSS_COLOR_CHARACTERS.test(color)) {
        return fallback;
    }

    if (HEX_COLOR.test(color) || NAMED_COLOR.test(color) || FUNCTION_COLOR.test(color)) {
        return color;
    }

    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', color)) {
        return color;
    }

    return fallback;
}

export function normalizeStrokeWidth(value: unknown, fallback = DEFAULT_STROKE_WIDTH): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1024
        ? value
        : fallback;
}

export function isValidStrokePoint(value: unknown): value is StrokePoint {
    if (!isRecord(value)) return false;

    return isFiniteCoordinate(value.x)
        && isFiniteCoordinate(value.y)
        && isFiniteNumberInRange(value.pressure, 0, 16)
        && isFiniteNumberInRange(value.tilt, -180, 180)
        && isFiniteNumberInRange(value.timestamp, 0, Number.MAX_SAFE_INTEGER);
}

export function validateStrokePoints(value: unknown, maxPoints = 100_000): StrokePoint[] | null {
    if (!Array.isArray(value) || value.length > maxPoints) return null;

    const points: StrokePoint[] = [];
    for (const candidate of value) {
        if (!isValidStrokePoint(candidate)) return null;
        points.push(cloneStrokePoint(candidate));
    }
    return points;
}

export function cloneStrokePoint(point: StrokePoint): StrokePoint {
    return {
        x: point.x,
        y: point.y,
        pressure: point.pressure,
        tilt: point.tilt,
        timestamp: point.timestamp
    };
}

export function cloneStrokePoints(points: readonly StrokePoint[]): StrokePoint[] {
    return points.map(cloneStrokePoint);
}

export function cloneInkDocument(document: InkDocument): InkDocument {
    return {
        schemaVersion: INK_DOCUMENT_SCHEMA_VERSION,
        strokes: document.strokes.map(stroke => ({
            id: stroke.id,
            points: cloneStrokePoints(stroke.points),
            style: { ...stroke.style }
        }))
    };
}

export function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function formatSvgNumber(value: number): string {
    if (!Number.isFinite(value)) {
        throw new TypeError('SVG coordinates and dimensions must be finite numbers');
    }
    return Object.is(value, -0) ? '0' : String(value);
}

/** Matches the canonical Rust zero-phase kernel: 0.25, 0.50, 0.25. */
export function smoothStrokeJs(points: readonly StrokePoint[]): StrokePoint[] {
    if (points.length < 3) return cloneStrokePoints(points);

    const smoothed: StrokePoint[] = [cloneStrokePoint(points[0])];
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteCoordinate(value: unknown): value is number {
    return isFiniteNumberInRange(value, -10_000_000, 10_000_000);
}

function isFiniteNumberInRange(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}
