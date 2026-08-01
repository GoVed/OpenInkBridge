const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const windowListeners = new Map();
const windowListenerCounts = { add: 0, remove: 0 };
const nativeCalls = [];

global.window = {
    devicePixelRatio: 2,
    navigator: { userAgent: 'OpenInkBridge test', maxTouchPoints: 1 },
    screen: { width: 800, height: 600 },
    PointerEvent: function PointerEvent() {},
    OpenInkBridgeNative: {
        setWritingMode(enabled, payload) {
            nativeCalls.push({ enabled, payload: JSON.parse(payload) });
        },
        onStrokeDrawn() {}
    },
    addEventListener(type, callback) {
        windowListenerCounts.add += 1;
        if (!windowListeners.has(type)) windowListeners.set(type, new Set());
        windowListeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
        windowListenerCounts.remove += 1;
        windowListeners.get(type)?.delete(callback);
    }
};

const model = require('../dist/model.js');
const bridgeModule = require('../dist/bridge.js');
const canvasModule = require('../dist/canvas.js');
const diagnostics = require('../dist/diagnostics.js');
const packageMetadata = require('../package.json');

function point(x, y, pressure = 0.5, tilt = 0, timestamp = 1) {
    return { x, y, pressure, tilt, timestamp };
}

function createElement(id = '') {
    const listeners = new Map();
    return {
        id,
        style: { touchAction: 'pan-x' },
        parentElement: null,
        clientWidth: 200,
        clientHeight: 100,
        ownerDocument: null,
        getBoundingClientRect() {
            return { left: 10, top: 20, width: 200, height: 100 };
        },
        addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
        },
        removeEventListener(type, callback) {
            listeners.get(type)?.delete(callback);
        },
        setPointerCapture() {},
        releasePointerCapture() {},
        dispatch(type, event) {
            for (const callback of listeners.get(type) || []) callback(event);
        },
        listenerCount(type) {
            return listeners.get(type)?.size || 0;
        }
    };
}

function createContext() {
    return {
        strokeStyle: '',
        lineWidth: 0,
        lineCap: 'round',
        lineJoin: 'round',
        setTransform() {},
        clearRect() {},
        drawImage() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {}
    };
}

function createCanvas(id) {
    const element = createElement(id);
    const context = createContext();
    Object.assign(element, {
        width: 0,
        height: 0,
        getContext(type) {
            return type === '2d' ? context : null;
        }
    });
    element.ownerDocument = {
        createElement(tag) {
            assert.equal(tag, 'canvas');
            const backing = createElement();
            const backingContext = createContext();
            Object.assign(backing, {
                width: 0,
                height: 0,
                getContext: () => backingContext
            });
            return backing;
        }
    };
    return element;
}

test('JavaScript smoothing matches the shared protocol-v1 golden vectors', () => {
    const fixturePath = path.resolve(__dirname, '..', '..', 'contracts', 'stroke-processing-v1.json');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    assert.equal(fixture.schemaVersion, 1);
    assert.deepEqual(fixture.kernel, [0.25, 0.5, 0.25]);
    for (const vector of fixture.vectors) {
        assert.deepEqual(model.smoothStrokeJs(vector.input), vector.expected, vector.name);
    }
});

test('native payload parser accepts legacy and scoped v1 messages and rejects malformed data', () => {
    const points = [point(1, 2)];
    assert.deepEqual(bridgeModule.parseNativeStrokePayload(JSON.stringify(points)).points, points);

    const parsed = bridgeModule.parseNativeStrokePayload({
        protocolVersion: 1,
        type: 'strokeFinished',
        sessionId: 'session-1',
        canvasId: 'canvas-1',
        payload: { points }
    });
    assert.equal(parsed.sessionId, 'session-1');
    assert.deepEqual(parsed.points, points);

    assert.equal(bridgeModule.parseNativeStrokePayload('{broken'), null);
    assert.equal(bridgeModule.parseNativeStrokePayload({ protocolVersion: 2, points }), null);
    assert.equal(bridgeModule.parseNativeStrokePayload([point(Number.NaN, 2)]), null);
    assert.equal(bridgeModule.parseNativeStrokePayload({ type: 'unexpected', points }), null);
});

test('bridge routes scoped messages to one session and legacy messages to the active session', () => {
    const bridge = new bridgeModule.OpenInkBridge();
    const first = bridge.createSession('first');
    const second = bridge.createSession('second');
    const firstElement = createElement();
    const secondElement = createElement();
    const received = { first: [], second: [] };

    first.onStrokeFinished(points => {
        received.first.push(points);
        points[0].x = 999;
    });
    first.onStrokeFinished(points => assert.equal(points[0].x, 1, 'callbacks receive defensive copies'));
    second.onStrokeFinished(points => received.second.push(points));
    first.setWritingMode(true, firstElement, { color: '#111', width: 2 });
    second.setWritingMode(true, secondElement, { color: '#222', width: 3 });

    window.onOpenInkBridgeStrokeFinished(JSON.stringify({
        protocolVersion: 1,
        type: 'strokeFinished',
        sessionId: first.id,
        payload: { points: [point(1, 2)] }
    }));
    assert.equal(received.first.length, 1);
    assert.equal(received.second.length, 0);

    window.onOpenInkBridgeStrokeFinished(JSON.stringify([point(3, 4)]));
    assert.equal(received.first.length, 1);
    assert.equal(received.second.length, 1);

    first.destroy();
    second.destroy();
    bridge.destroy();
});

test('fallback setup is idempotent and destroy restores element state', () => {
    const savedNative = window.OpenInkBridgeNative;
    delete window.OpenInkBridgeNative;
    const bridge = new bridgeModule.OpenInkBridge();
    const session = bridge.createSession('fallback');
    const element = createElement();
    const finished = [];
    session.onStrokeFinished(points => finished.push(points));

    session.setWritingMode(true, element, { color: '#000', width: 4, stylusOnly: false });
    session.setWritingMode(true, element, { color: '#000', width: 4, stylusOnly: false });
    assert.equal(element.listenerCount('pointerdown'), 1);
    assert.equal(element.listenerCount('pointermove'), 1);

    const baseEvent = {
        pointerId: 7,
        pointerType: 'mouse',
        pressure: 0.5,
        tiltX: 0,
        preventDefault() {}
    };
    element.dispatch('pointerdown', { ...baseEvent, clientX: 11, clientY: 22 });
    element.dispatch('pointermove', { ...baseEvent, clientX: 15, clientY: 26 });
    element.dispatch('pointerup', { ...baseEvent, clientX: 15, clientY: 26 });
    assert.equal(finished.length, 1);
    assert.equal(finished[0].length, 2);

    session.destroy();
    assert.equal(element.listenerCount('pointerdown'), 0);
    assert.equal(element.style.touchAction, 'pan-x');
    bridge.destroy();
    window.OpenInkBridgeNative = savedNative;
});

test('canvas stores per-stroke style, isolates copies, sanitizes SVG, and cleans up resize', () => {
    const bridge = new bridgeModule.OpenInkBridge();
    const canvasElement = createCanvas('document-canvas');
    const resizeAddsBefore = windowListenerCounts.add;
    const resizeRemovesBefore = windowListenerCounts.remove;
    const canvas = new canvasModule.OpenInkBridgeCanvas(canvasElement, {
        strokeColor: '#123456',
        strokeWidth: 6,
        smoothing: false
    }, bridge);
    canvas.enableDrawing();

    const latestEnable = nativeCalls.filter(call => call.enabled).at(-1);
    assert.equal(latestEnable.payload.protocolVersion, 1);
    assert.equal(latestEnable.payload.canvasId, 'document-canvas');
    window.onOpenInkBridgeStrokeFinished(JSON.stringify({
        protocolVersion: 1,
        type: 'strokeFinished',
        sessionId: latestEnable.payload.sessionId,
        payload: { points: [point(0, 0), point(10, 10)] }
    }));

    canvas.setStyle('red', 2);
    const secondEnable = nativeCalls.filter(call => call.enabled).at(-1);
    window.onOpenInkBridgeStrokeFinished(JSON.stringify({
        protocolVersion: 1,
        type: 'strokeFinished',
        sessionId: secondEnable.payload.sessionId,
        payload: { points: [point(4, 4), point(8, 8)] }
    }));

    const document = canvas.getDocument();
    assert.deepEqual(document.strokes.map(stroke => stroke.style), [
        { color: '#123456', width: 6 },
        { color: 'red', width: 2 }
    ]);
    document.strokes[0].points[0].x = 999;
    assert.equal(canvas.getDocument().strokes[0].points[0].x, 0);
    canvas.getStrokes()[0][0].x = 888;
    assert.equal(canvas.getStrokes()[0][0].x, 0);

    canvas.setStyle('red" onload="alert(1)', 2);
    assert.doesNotMatch(canvas.exportToSvg(), /onload|alert/);
    assert.match(canvas.exportToSvg(), /stroke="#123456"[^>]+stroke-width="6"/);
    assert.match(canvas.exportToSvg(), /stroke="red"[^>]+stroke-width="2"/);

    assert.equal(windowListenerCounts.add, resizeAddsBefore + 1);
    canvas.destroy();
    canvas.destroy();
    assert.equal(windowListenerCounts.remove, resizeRemovesBefore + 1);
    bridge.destroy();
});

test('diagnostics version is derived from package.json', () => {
    assert.equal(diagnostics.collectDiagnostics(undefined, true).version, packageMetadata.version);
});
