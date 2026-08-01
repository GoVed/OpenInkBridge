import { logger, Subsystem } from './logger';
import { smoothStrokeJs, StrokePoint, validateStrokePoints } from './model';

export interface OpenInkBridgeWasmBindings {
    default(wasmUrl?: string | URL | Request): Promise<unknown>;
    smooth_stroke_wasm(pointsJson: string): string;
}

export type OpenInkBridgeWasmLoader = () => Promise<OpenInkBridgeWasmBindings>;

// This is intentionally a variable expression. A clean checkout has no generated
// module, so TypeScript and esbuild leave it as an optional runtime import instead
// of trying to resolve a file that only `npm run build:wasm` creates.
const GENERATED_WASM_MODULE_PATH = './wasm/openinkbridge_core.js';

let configuredLoader: OpenInkBridgeWasmLoader | null = null;
let bindings: OpenInkBridgeWasmBindings | null = null;
let initialization: Promise<boolean> | null = null;

export function configureOpenInkBridgeWasmLoader(loader: OpenInkBridgeWasmLoader | null): void {
    configuredLoader = loader;
    bindings = null;
    initialization = null;
}

/**
 * Initialize optional wasm-pack output. Missing generated output is a supported
 * state: drawing continues with the byte-for-byte equivalent JavaScript kernel.
 */
export function initOpenInkBridgeWasm(
    wasmUrl?: string | URL | Request,
    loader?: OpenInkBridgeWasmLoader
): Promise<boolean> {
    if (bindings) return Promise.resolve(true);
    if (initialization) return initialization;

    const selectedLoader = loader || configuredLoader || loadGeneratedBindings;
    initialization = selectedLoader()
        .then(async loadedBindings => {
            if (!isBindings(loadedBindings)) {
                throw new TypeError('Generated WASM module does not expose the expected bindings');
            }
            await loadedBindings.default(wasmUrl);
            bindings = loadedBindings;
            logger.info(Subsystem.Core, 'WasmCore', 'INITIALIZED', 'WebAssembly stroke processing initialized');
            return true;
        })
        .catch(error => {
            logger.debug(
                Subsystem.Core,
                'JsCore',
                'WASM_UNAVAILABLE',
                `Using JavaScript stroke processing fallback: ${errorMessage(error)}`
            );
            return false;
        });

    return initialization;
}

export function smoothStroke(points: readonly StrokePoint[]): StrokePoint[] {
    if (!bindings) return smoothStrokeJs(points);

    try {
        const output = bindings.smooth_stroke_wasm(JSON.stringify(points));
        const parsed = validateStrokePoints(JSON.parse(output));
        if (parsed) return parsed;
        throw new TypeError('WASM returned an invalid stroke payload');
    } catch (error) {
        logger.error(
            Subsystem.Core,
            'WasmCore',
            'SMOOTHING_ERROR',
            `WASM smoothing failed; using JavaScript fallback: ${errorMessage(error)}`
        );
        return smoothStrokeJs(points);
    }
}

export function isOpenInkBridgeWasmInitialized(): boolean {
    return bindings !== null;
}

async function loadGeneratedBindings(): Promise<OpenInkBridgeWasmBindings> {
    return import(GENERATED_WASM_MODULE_PATH) as Promise<OpenInkBridgeWasmBindings>;
}

function isBindings(value: unknown): value is OpenInkBridgeWasmBindings {
    return typeof value === 'object'
        && value !== null
        && typeof (value as Partial<OpenInkBridgeWasmBindings>).default === 'function'
        && typeof (value as Partial<OpenInkBridgeWasmBindings>).smooth_stroke_wasm === 'function';
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
