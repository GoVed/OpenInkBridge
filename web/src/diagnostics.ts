import { logger, LogEntry, LogLevel } from './logger';

export interface CapabilitiesReport {
    pressure: boolean;
    tilt: boolean;
    hover: boolean;
    eraser: boolean;
    refreshModes: string[];
    hardwareAcceleration: boolean;
}

export interface DiagnosticsReport {
    version: string;
    platform: string;
    userAgent: string;
    devicePixelRatio: number;
    screenResolution: string;
    hasPointerEvents: boolean;
    maxTouchPoints: number;
    selectedBackend: string;
    availableBackends: string[];
    fallbackReason: string | null;
    capabilities: CapabilitiesReport;
    refreshMode: string;
    recentLogs: LogEntry[];
}

export function collectDiagnostics(activeBackend?: string, isNativeSupported?: boolean): DiagnosticsReport {
    const isBrowser = typeof window !== 'undefined';
    const ua = isBrowser ? window.navigator.userAgent : 'Node.js / Server Environment';
    const dpr = isBrowser ? window.devicePixelRatio || 1 : 1;
    const res = isBrowser ? `${window.screen?.width || 0}x${window.screen?.height || 0}` : '0x0';
    const hasPointer = isBrowser && typeof window.PointerEvent !== 'undefined';
    const maxTouch = isBrowser ? window.navigator.maxTouchPoints || 0 : 0;

    const backend = activeBackend || (isNativeSupported ? 'NativeOpenInkBridge' : 'PointerEventFallback');
    const fallbackReason = isNativeSupported
        ? null
        : 'OpenInkBridgeNative bridge object not detected on window; using HTML5 PointerEvents fallback';

    return {
        version: '0.1.2',
        platform: 'Web SDK',
        userAgent: ua,
        devicePixelRatio: dpr,
        screenResolution: res,
        hasPointerEvents: hasPointer,
        maxTouchPoints: maxTouch,
        selectedBackend: backend,
        availableBackends: ['NativeOpenInkBridge', 'PointerEventFallback', 'WasmCore'],
        fallbackReason: fallbackReason,
        capabilities: {
            pressure: true,
            tilt: true,
            hover: true,
            eraser: true,
            refreshModes: ['Fast', 'Partial', 'Full', 'Clear'],
            hardwareAcceleration: !!isNativeSupported
        },
        refreshMode: isNativeSupported ? 'Fast' : 'Software',
        recentLogs: logger.getRingBufferLogs()
    };
}

export function dumpConfiguration(activeBackend?: string, isNativeSupported?: boolean): string {
    const diag = collectDiagnostics(activeBackend, isNativeSupported);
    let out = '';
    out += '========== OpenInkBridge Diagnostics ==========\n';
    out += `Version: ${diag.version}\n`;
    out += `Platform: ${diag.platform}\n`;
    out += `User Agent: ${diag.userAgent}\n`;
    out += `Screen: ${diag.screenResolution} (DPR: ${diag.devicePixelRatio})\n`;
    out += `Pointer Events: ${diag.hasPointerEvents ? 'Supported' : 'Unsupported'} (Max Touch: ${diag.maxTouchPoints})\n`;
    out += `Selected Backend: ${diag.selectedBackend}\n`;
    out += `Available Backends: ${diag.availableBackends.join(', ')}\n`;
    if (diag.fallbackReason) {
        out += `Fallback Reason: ${diag.fallbackReason}\n`;
    }
    out += 'Capabilities:\n';
    out += `  - Pressure: ${diag.capabilities.pressure ? 'Supported' : 'Unsupported'}\n`;
    out += `  - Tilt: ${diag.capabilities.tilt ? 'Supported' : 'Unsupported'}\n`;
    out += `  - Hover: ${diag.capabilities.hover ? 'Supported' : 'Unsupported'}\n`;
    out += `  - Eraser: ${diag.capabilities.eraser ? 'Supported' : 'Unsupported'}\n`;
    out += `  - Refresh Modes: [${diag.capabilities.refreshModes.join(', ')}]\n`;
    out += `  - Hardware Acceleration: ${diag.capabilities.hardwareAcceleration ? 'Enabled' : 'Disabled'}\n`;
    out += `Refresh Mode: ${diag.refreshMode}\n`;
    out += '===============================================\n';
    return out;
}

export function createBugReport(activeBackend?: string, isNativeSupported?: boolean): string {
    let out = dumpConfiguration(activeBackend, isNativeSupported);
    out += '\n========== Recent Warnings & Errors ==========\n';
    const warnErrorLogs = logger.getRingBufferLogs().filter(e => e.level === LogLevel.WARN || e.level === LogLevel.ERROR);

    if (warnErrorLogs.length === 0) {
        out += 'No warnings or errors reported in recent log buffer.\n';
    } else {
        for (const entry of warnErrorLogs) {
            const levelStr = LogLevel[entry.level];
            out += `[${levelStr}][${entry.subsystem}][${entry.backend}] ${entry.event}: ${entry.message}\n`;
        }
    }
    out += '===============================================\n';
    return out;
}
