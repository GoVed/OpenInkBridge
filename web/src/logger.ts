export enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3,
    TRACE = 4
}

export enum Subsystem {
    Core = 'Core',
    Backend = 'Backend',
    Renderer = 'Renderer',
    PenInput = 'PenInput',
    Refresh = 'Refresh',
    Synchronization = 'Synchronization',
    JsBridge = 'JsBridge',
    Android = 'Android',
    Linux = 'Linux',
    Performance = 'Performance',
    Configuration = 'Configuration',
    Networking = 'Networking'
}

export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    subsystem: Subsystem;
    backend: string;
    event: string;
    message: string;
    parameters?: Record<string, any>;
}

export class OpenInkBridgeLogger {
    private activeLogLevel: LogLevel = LogLevel.INFO;
    private ringBuffer: LogEntry[] = [];
    private maxBufferCapacity = 500;
    private lastTraceTimestamp = 0;

    public setLogLevel(level: LogLevel | string) {
        if (typeof level === 'string') {
            switch (level.toUpperCase()) {
                case 'ERROR': this.activeLogLevel = LogLevel.ERROR; break;
                case 'WARN': case 'WARNING': this.activeLogLevel = LogLevel.WARN; break;
                case 'INFO': this.activeLogLevel = LogLevel.INFO; break;
                case 'DEBUG': this.activeLogLevel = LogLevel.DEBUG; break;
                case 'TRACE': this.activeLogLevel = LogLevel.TRACE; break;
                default: this.activeLogLevel = LogLevel.INFO; break;
            }
        } else {
            this.activeLogLevel = level;
        }
    }

    public getLogLevel(): LogLevel {
        return this.activeLogLevel;
    }

    public log(
        level: LogLevel,
        subsystem: Subsystem,
        backend: string,
        event: string,
        message: string,
        parameters?: Record<string, any>
    ) {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            subsystem,
            backend: backend || 'Browser',
            event,
            message,
            parameters
        };

        // Ring Buffer Storage
        if (this.ringBuffer.length >= this.maxBufferCapacity) {
            this.ringBuffer.shift();
        }
        this.ringBuffer.push(entry);

        // Console Output
        if (level <= this.activeLogLevel && typeof console !== 'undefined') {
            const levelStr = LogLevel[level];
            const prefix = `[${levelStr}][${subsystem}][${entry.backend}] ${event}:`;
            const args = parameters ? [prefix, message, parameters] : [prefix, message];

            switch (level) {
                case LogLevel.ERROR:
                    console.error(...args);
                    break;
                case LogLevel.WARN:
                    console.warn(...args);
                    break;
                case LogLevel.INFO:
                    console.info(...args);
                    break;
                case LogLevel.DEBUG:
                case LogLevel.TRACE:
                    console.log(...args);
                    break;
            }
        }
    }

    public shouldLogTrace(minIntervalMs: number = 20): boolean {
        const now = Date.now();
        if (now >= this.lastTraceTimestamp + minIntervalMs) {
            this.lastTraceTimestamp = now;
            return true;
        }
        return false;
    }

    public error(subsystem: Subsystem, backend: string, event: string, message: string, params?: Record<string, any>) {
        this.log(LogLevel.ERROR, subsystem, backend, event, message, params);
    }

    public warn(subsystem: Subsystem, backend: string, event: string, message: string, params?: Record<string, any>) {
        this.log(LogLevel.WARN, subsystem, backend, event, message, params);
    }

    public info(subsystem: Subsystem, backend: string, event: string, message: string, params?: Record<string, any>) {
        this.log(LogLevel.INFO, subsystem, backend, event, message, params);
    }

    public debug(subsystem: Subsystem, backend: string, event: string, message: string, params?: Record<string, any>) {
        this.log(LogLevel.DEBUG, subsystem, backend, event, message, params);
    }

    public trace(subsystem: Subsystem, backend: string, event: string, message: string, params?: Record<string, any>) {
        this.log(LogLevel.TRACE, subsystem, backend, event, message, params);
    }

    public getRingBufferLogs(): LogEntry[] {
        return [...this.ringBuffer];
    }

    public clearRingBuffer() {
        this.ringBuffer = [];
    }
}

export const logger = new OpenInkBridgeLogger();
