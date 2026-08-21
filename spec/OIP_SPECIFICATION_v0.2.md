# OpenInk Protocol (OIP) Specification - Version 0.2

**Document Status:** Working Draft (`WD-OIP-0.2-20260820`)  
**Domain:** Digital Ink Standardization, Electrophoretic Display Interfaces, Low-Latency Hardware Handoff, Cross-Platform Bridging  
**License:** [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0)  
**Specification Source File:** [`spec/OIP_SPECIFICATION_v0.2.md`](./OIP_SPECIFICATION_v0.2.md)  
**Previous Version:** [`spec/OIP_SPECIFICATION_v0.1.md`](./OIP_SPECIFICATION_v0.1.md)

---

## Abstract

The **OpenInk Protocol (OIP)** defines an open, hardware-agnostic, low-latency communication specification and runtime interface for digital stylus input, stroke vector synchronization, and Electrophoretic Display Controller (EPDC) refresh routing. OIP enables host operating systems (Android, Linux, Windows), web runtimes (Wasm, HTML5 Canvas, WebSockets, WebMessagePort), and cross-platform UI frameworks to achieve zero-latency ink rendering on bi-stable e-paper displays while maintaining deterministic state synchronization between native hardware overlays and software viewports.

Version 0.2 formalizes the dual-profile protocol architecture:
1. **High-Level JSON Bridge Profile:** The asynchronous IPC protocol governing native WebViews, web runtimes, multi-canvas session routing (`sessionId` / `canvasId`), and vector document persistence.
2. **Low-Level Native Streaming Profile:** The byte-level wire format and evdev/C-ABI interfaces for direct-to-EPDC daemons and embedded digitizer streaming.
3. **Canonical Math Contracts:** Deterministic zero-phase stroke smoothing and iterative Ramer-Douglas-Peucker (RDP) simplification.
4. **Hardware Capability Probing & Developer Diagnostics:** Discovery schemas for EPDC waveform modes, digitizer sampling, fallback reasons, and circular log buffers.

---

## Status of This Memo

This document specifies a Working Draft protocol for the Internet, Open Source, and Hardware Developer communities. Distribution of this memo is unlimited. Keywords for requirement levels in this document are to be interpreted as described in [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

---

## Table of Contents

1. [1. Architecture & Profiles](#1-architecture-profiles)
   - [1.1 Purpose & Problem Statement](#11-purpose-problem-statement)
   - [1.2 Dual-Profile Architecture Overview](#12-dual-profile-architecture-overview)
   - [1.3 Hybrid Overlay Bridge Pattern](#13-hybrid-overlay-bridge-pattern)
2. [2. Terminology & Definitions](#2-terminology-definitions)
3. [3. Mathematical Contracts & Stroke Processing](#3-mathematical-contracts-stroke-processing)
   - [3.1 Zero-Phase Smoothing Filter Contract](#31-zero-phase-smoothing-filter-contract)
   - [3.2 Iterative Ramer-Douglas-Peucker (RDP) Simplification](#32-iterative-ramer-douglas-peucker-rdp-simplification)
   - [3.3 Stroke Point Data Model & SVG Schema](#33-stroke-point-data-model-svg-schema)
4. [4. High-Level JSON Bridge Protocol (Profile A)](#4-high-level-json-bridge-protocol-profile-a)
   - [4.1 Message Transport & Scoping (`sessionId` & `canvasId`)](#41-message-transport-scoping-sessionid-canvasid)
   - [4.2 Formal Protocol Schema & Command Set](#42-formal-protocol-schema-command-set)
   - [4.3 Command Specifications](#43-command-specifications)
   - [4.4 Multi-Canvas Lifecycle & State Transitions](#44-multi-canvas-lifecycle-state-transitions)
5. [5. Low-Level Streaming Protocol (Profile B)](#5-low-level-streaming-protocol-profile-b)
   - [5.1 Byte Order & Data Types](#51-byte-order-data-types)
   - [5.2 32-Byte Fixed Binary Frame Layout](#52-32-byte-fixed-binary-frame-layout)
   - [5.3 Field Specifications & Routing Bitmask](#53-field-specifications-routing-bitmask)
   - [5.4 Evdev Direct Linux Pipeline](#54-evdev-direct-linux-pipeline)
6. [6. Waveform & Refresh Control Abstraction](#6-waveform-refresh-control-abstraction)
   - [6.1 Standardized Refresh Modes](#61-standardized-refresh-modes)
   - [6.2 Focus Handoff State Machine](#62-focus-handoff-state-machine)
7. [7. Capability Probing & Diagnostics System](#7-capability-probing-diagnostics-system)
   - [7.1 Hardware Capability Discovery Schema](#71-hardware-capability-discovery-schema)
   - [7.2 Developer Diagnostics & Telemetry Schema](#72-developer-diagnostics-telemetry-schema)
   - [7.3 Thread-Safe Circular Ring Buffer Logging](#73-thread-safe-circular-ring-buffer-logging)
8. [8. Security & Isolation Considerations](#8-security-isolation-considerations)
   - [8.1 Origin-Scoped Bridge Allowlisting](#81-origin-scoped-bridge-allowlisting)
   - [8.2 Input Clamping & Memory Bounds](#82-input-clamping-memory-bounds)
   - [8.3 Non-Recursive Stack Protection](#83-non-recursive-stack-protection)
9. [9. References](#9-references)

---

## 1. Architecture & Profiles

### 1.1 Purpose & Problem Statement

Electrophoretic displays (E-Ink) operate under fundamental physical constraints: microencapsulated physical ink particles must be rearranged via electrostatic field pulses, introducing physical display transition latency (typically 15ms to 250ms depending on gray-level state transitions). Traditional operating system graphics pipelines—which traverse compositors, UI event loops, layout engines, and window managers—exacerbate this latency, rendering interactive stylus drawing sluggish.

To bypass host compositor delays, hardware vendors implement proprietary direct-to-EPDC rendering pathways. However, these vendor SDKs lack common interfaces, causing extreme ecosystem fragmentation across Android, Linux, and Web environments.

The OpenInk Protocol (OIP) establishes a unified abstraction layer across diverse hardware backends (Onyx Boox, reMarkable, Bigme, generic Android, desktop WebViews) with deterministic fallback behaviors.

### 1.2 Dual-Profile Architecture Overview

OIP v0.2 defines two protocol profiles suited to different integration tiers:

```
+-----------------------------------------------------------------------------------+
|                            APPLICATION / UI LAYER                                 |
|          HTML5 Canvas / React WebApps  |  Native Android / Desktop Applications   |
+----------------------------------------+------------------------------------------+
                                         |
                       [ Profile A: High-Level JSON Bridge ]
                         (sessionId, canvasId, setWritingMode)
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                               OPENINKBRIDGE CORE                                  |
|         - Zero-Phase Smoothing Filter (0.25 / 0.50 / 0.25)                        |
|         - Non-Recursive Ramer-Douglas-Peucker Simplifier                           |
|         - Bounding Box Coordinate Transformation & Input Sanitization             |
+-------------------+------------------------------------+--------------------------+
                    |                                    |
  [ Profile B: Low-Level Streaming ]         [ Vendor-Specific Native SDKs ]
  (32-Byte Binary Wire / Linux evdev)         (Onyx Pen SDK / EpdController)
                    |                                    |
                    v                                    v
+------------------------------------+   +------------------------------------------+
|  reMarkable / Linux Framebuffer    |   |  Onyx Boox / Android EPDC Hardware       |
|  (/dev/fb0, direct memory mapping) |   |  (SurfaceView Direct Draw Overlay)       |
+------------------------------------+   +------------------------------------------+
```

* **Profile A (High-Level JSON Bridge):** Designed for web browsers, hybrid WebViews (Android `OpenInkBridgeWebView`, Electron, CEF), and cross-platform UI frameworks. Operates over structured JSON payloads using asynchronous message channels (`postMessage`, Android `WebMessagePort`, Unix Domain Sockets).
* **Profile B (Low-Level Streaming):** Designed for bare-metal Linux daemons (such as reMarkable tablets), microcontroller digitizers, serial interfaces, and raw UDP/IPC streams requiring sub-millisecond serialization without garbage collection overhead.

### 1.3 Hybrid Overlay Bridge Pattern

To eliminate web runtime and OS window compositor latency, OIP specifies a transparent native hardware overlay situated directly above the web/native application viewport:

1. **Stylus Contact:** When the stylus touches the screen within an active OIP region, the hardware overlay immediately intercepts raw digitizer events and renders ink directly to the EPDC using fast monochrome waveforms.
2. **Focus Handoff:** Upon stroke termination (`ACTION_UP` / pen release), the native layer flushes the captured coordinates, applies canonical stroke smoothing, and transmits the finalized stroke vector to the host application viewport via `strokeFinished`.
3. **Canvas Synchronization:** The host application commits the vector stroke to its document model (e.g., HTML5 2D Canvas, WebGL, SVG) and notifies the native overlay via `strokeDrawn`, releasing temporary overlay scribbles.

```
       [ Stylus Contact ]
               |
               v
  +--------------------------+
  | Hardware EPDC Overlay    | ---> Direct Display Panel (Low Latency < 15ms)
  +------------+-------------+
               |
    [ Stroke Finished Event ] (Profile A JSON or Profile B Points)
               |
               v
  +--------------------------+
  | Host Viewport (JS/Native)| ---> High-Quality SVG/Canvas Render (Asynchronous)
  +------------+-------------+
               |
     [ Stroke Drawn Ack ]
               |
               v
  +--------------------------+
  | Overlay Release Scribble |
  +--------------------------+
```

---

## 2. Terminology & Definitions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

* **Electrophoretic Display Controller (EPDC):** A dedicated hardware timing controller or integrated SoC display controller driving physical E-Ink panel electrodes.
* **Waveform Mode:** A Look-Up Table (LUT) voltage drive sequence programmed into the EPDC to transition pixels between microencapsulated optical states.
* **Hybrid Overlay:** A hardware-level or native surface overlay operating asynchronously from the host UI thread to directly output ink onto the EPDC framebuffer.
* **Session ID (`sessionId`):** A unique, alphanumeric identifier assigned to a specific runtime bridge lifecycle instance.
* **Canvas ID (`canvasId`):** A stable, alphanumeric identifier identifying a specific drawing surface or element within an application, enabling multi-canvas routing.
* **Zero-Phase Smoothing:** A 3-point FIR position filter with kernel weights `[0.25, 0.50, 0.25]` that eliminates sensor jitter without introducing curve drift or spatial lag.
* **Focus Handoff:** The deterministic transition of touch event ownership between the raw hardware EPDC overlay pipeline and the software application event loop.

---

## 3. Mathematical Contracts & Stroke Processing

### 3.1 Zero-Phase Smoothing Filter Contract

To guarantee identical stroke rendering across backends (Rust core, WebAssembly, JavaScript fallback, and Kotlin/Java SDKs), all OIP-compliant implementations MUST implement the zero-phase weighted smoothing filter defined in `contracts/stroke-processing-v1.json`.

#### Kernel Definition:
For any sequence of stroke points $P = [p_0, p_1, \dots, p_{n-1}]$ where $n \ge 3$:

* The first point $p_0$ and last point $p_{n-1}$ MUST remain unchanged (anchored endpoints):
  $$\hat{p}_0 = p_0, \quad \hat{p}_{n-1} = p_{n-1}$$
* For every intermediate point $i \in [1, n-2]$, the smoothed coordinates, pressure, and tilt MUST be computed using the symmetric kernel:
  $$\hat{p}_i.x = 0.25 \cdot p_{i-1}.x + 0.50 \cdot p_i.x + 0.25 \cdot p_{i+1}.x$$
  $$\hat{p}_i.y = 0.25 \cdot p_{i-1}.y + 0.50 \cdot p_i.y + 0.25 \cdot p_{i+1}.y$$
  $$\hat{p}_i.pressure = 0.25 \cdot p_{i-1}.pressure + 0.50 \cdot p_i.pressure + 0.25 \cdot p_{i+1}.pressure$$
  $$\hat{p}_i.tilt = 0.25 \cdot p_{i-1}.tilt + 0.50 \cdot p_i.tilt + 0.25 \cdot p_{i+1}.tilt$$
  $$\hat{p}_i.timestamp = p_i.timestamp$$
* For stroke sequences with $n < 3$, smoothing is identity ($\hat{P} = P$).

#### Formal Golden Vector Test Suite:
Compliant engines MUST produce bit-exact or IEEE 754 single-precision float-equivalent results for the following canonical vector:

```json
{
  "schemaVersion": 1,
  "algorithm": "zero-phase-weighted-average",
  "kernel": [0.25, 0.5, 0.25],
  "vectors": [
    {
      "name": "four-point-pressure-and-tilt",
      "input": [
        { "x": 0.0, "y": 0.0, "pressure": 0.2, "tilt": 0.0, "timestamp": 1 },
        { "x": 4.0, "y": 8.0, "pressure": 0.6, "tilt": 4.0, "timestamp": 2 },
        { "x": 8.0, "y": 4.0, "pressure": 1.0, "tilt": 8.0, "timestamp": 3 },
        { "x": 12.0, "y": 12.0, "pressure": 0.4, "tilt": 12.0, "timestamp": 4 }
      ],
      "expected": [
        { "x": 0.0, "y": 0.0, "pressure": 0.2, "tilt": 0.0, "timestamp": 1 },
        { "x": 4.0, "y": 5.0, "pressure": 0.6, "tilt": 4.0, "timestamp": 2 },
        { "x": 8.0, "y": 7.0, "pressure": 0.75, "tilt": 8.0, "timestamp": 3 },
        { "x": 12.0, "y": 12.0, "pressure": 0.4, "tilt": 12.0, "timestamp": 4 }
      ]
    }
  ]
}
```

### 3.2 Iterative Ramer-Douglas-Peucker (RDP) Simplification

For vector storage, transmission, and SVG serialization, implementations MAY perform polygonal curve simplification using the Ramer-Douglas-Peucker algorithm with perpendicular distance threshold $\epsilon \ge 0.0$.

#### Stack-Safety Requirement:
To prevent runtime stack exhaustion when processing large strokes containing upwards of $100,000$ points, implementations MUST use an **iterative work-stack algorithm** rather than recursive function calls. Invalid or non-finite $\epsilon$ values (e.g., negative numbers, `NaN`, $\infty$) MUST NOT cause infinite loops or data loss, and MUST safely return the original input slice.

### 3.3 Stroke Point Data Model & SVG Schema

#### Stroke Point:
```typescript
interface StrokePoint {
    x: number;          // Sub-pixel X coordinate
    y: number;          // Sub-pixel Y coordinate
    pressure: number;   // Normalized pressure ratio [0.0, 1.0] (or [0.0, 16.0] clamp)
    tilt: number;       // Stylus tilt angle in degrees [-180.0, 180.0]
    timestamp: number;  // Monotonic or Unix timestamp in milliseconds
}
```

#### Ink Document Schema:
```json
{
  "schemaVersion": 1,
  "strokes": [
    {
      "id": "stroke-01h8",
      "points": [
        { "x": 10.5, "y": 20.0, "pressure": 0.5, "tilt": 0.0, "timestamp": 1724180000000 }
      ],
      "style": {
        "color": "#000000",
        "width": 4.0
      }
    }
  ]
}
```

---

## 4. High-Level JSON Bridge Protocol (Profile A)

Profile A governs communications between host WebViews/browsers and native platform wrappers (Android `OpenInkBridgeWebView`, desktop shells, and WebSockets).

### 4.1 Message Transport & Scoping (`sessionId` & `canvasId`)

All Profile A messages MUST be valid JSON strings conforming to `contracts/bridge-protocol-v1.json`.

* **`protocolVersion` (integer):** MUST equal `1`.
* **`sessionId` (string):** An alphanumeric session identifier (e.g. `oib-editor-l8f9-1`) generated per session instance.
* **`canvasId` (string):** A stable identifier for the targeted canvas element (e.g. `main-canvas`, `note-layer`). Enables multiple independent canvases on a single page without cross-talk.

### 4.2 Formal Protocol Schema & Command Set

The message schema defines three primary command/event types:

```
+-----------------------------------------------------------------------------+
|                            Profile A JSON Messages                          |
+-----------------------------------------------------------------------------+
|  Host -> Native:   setWritingMode   (Configure bounds, brush style, toggle) |
|  Host -> Native:   strokeDrawn      (Acknowledge vector commit)             |
|  Native -> Host:   strokeFinished   (Emit smoothed stroke point array)      |
+-----------------------------------------------------------------------------+
```

### 4.3 Command Specifications

#### 1. `setWritingMode` (Host $\to$ Native)
Sent by the Web SDK to activate, update, or deactivate the low-latency native hardware overlay over a target element.

```json
{
  "protocolVersion": 1,
  "type": "setWritingMode",
  "sessionId": "oib-canvas-1-mt27x-1",
  "canvasId": "canvas-1",
  "enabled": true,
  "color": "#000000",
  "width": 4.0,
  "stylusOnly": true,
  "rect": {
    "left": 0.0,
    "top": 120.0,
    "width": 1404.0,
    "height": 1752.0
  }
}
```

* **`enabled` (boolean):** `true` to activate overlay capture; `false` to disable.
* **`color` (string):** CSS hex color string (e.g. `"#000000"`). MUST be validated against safe color patterns.
* **`width` (number):** Stroke preview thickness in pixels (clamped between `0.5` and `128.0`).
* **`stylusOnly` (boolean):** `true` to reject finger touch input; `false` to allow dual touch drawing.
* **`rect` (object, optional):** Bounding box of the target canvas relative to the viewport.

#### 2. `strokeFinished` (Native $\to$ Host)
Emitted by the native hardware bridge upon stylus release (`ACTION_UP` / evdev pen release) containing the raw/smoothed vector points.

```json
{
  "protocolVersion": 1,
  "type": "strokeFinished",
  "sessionId": "oib-canvas-1-mt27x-1",
  "canvasId": "canvas-1",
  "payload": {
    "points": [
      { "x": 100.5, "y": 150.2, "pressure": 0.65, "tilt": 5.0, "timestamp": 1724180123456 },
      { "x": 105.0, "y": 158.4, "pressure": 0.70, "tilt": 5.2, "timestamp": 1724180123470 }
    ]
  }
}
```

#### 3. `strokeDrawn` (Host $\to$ Native)
Sent by the Web SDK once the host application has completed rendering the stroke into its persistent backing store.

```json
{
  "protocolVersion": 1,
  "type": "strokeDrawn",
  "sessionId": "oib-canvas-1-mt27x-1",
  "canvasId": "canvas-1"
}
```

Upon receiving `strokeDrawn`, the native overlay clears its temporary fast-waveform preview scribbles to prevent ghosting or duplicate stroke overlap.

### 4.4 Multi-Canvas Lifecycle & State Transitions

When multiple canvases exist on a single page:
1. Each canvas creates an isolated `OpenInkBridgeSession` with a distinct `canvasId`.
2. When a canvas is focused or active, `setWritingMode` activates its bounding rect.
3. If another canvas activates, the native bridge updates its active bounding box.
4. Incoming `strokeFinished` payloads MUST be routed to the matching session's listener based on `sessionId` or `canvasId`.

---

## 5. Low-Level Streaming Protocol (Profile B)

Profile B is an optional, high-throughput binary protocol designed for raw digitizer daemons (e.g. standalone Linux on reMarkable, USB/Serial digitizers, or IPC pipes).

### 5.1 Byte Order & Data Types

All binary packet data MUST be transmitted in **Network Byte Order (Big-Endian)**.
* `uint8_t`: Unsigned 8-bit integer.
* `uint16_t`: Unsigned 16-bit integer.
* `int16_t`: Signed 16-bit integer.
* `uint32_t`: Unsigned 32-bit integer.
* `uint64_t`: Unsigned 64-bit integer.

### 5.2 32-Byte Fixed Binary Frame Layout

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Magic Number         | Version (0x02)| Packet Type   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Sequence Number                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                       Timestamp (Microseconds)                +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    X Coordinate (16.16 Fixed)                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Y Coordinate (16.16 Fixed)                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|       Normalized Pressure     |             Tilt X            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|             Tilt Y            | Routing Flags |  CRC-8 Check  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### 5.3 Field Specifications & Routing Bitmask

| Byte Offset | Field Name | Data Type | Units / Range | Description |
| :--- | :--- | :--- | :--- | :--- |
| `0 - 1` | `Magic Number` | `uint16_t` | `0x4F49` (`'O' 'I'`) | Fixed magic identifier. |
| `2` | `Protocol Version` | `uint8_t` | `0x02` | Protocol version identifier. |
| `3` | `Packet Type` | `uint8_t` | Enum | `0x01` = Stroke Start, `0x02` = Point Update, `0x03` = Stroke End, `0x04` = Handoff Req, `0x05` = Handoff Ack. |
| `4 - 7` | `Sequence Number` | `uint32_t` | `0` to $2^{32}-1$ | Monotonic packet counter. |
| `8 - 15` | `Timestamp` | `uint64_t` | Microseconds ($\mu$s) | Epoch timestamp. |
| `16 - 19` | `X Coordinate` | `uint32_t` | 16.16 Fixed Point | Sub-pixel X coordinate. |
| `20 - 23` | `Y Coordinate` | `uint32_t` | 16.16 Fixed Point | Sub-pixel Y coordinate. |
| `24 - 25` | `Pressure` | `uint16_t` | `0` to `65535` | Linearly mapped pressure. |
| `26 - 27` | `Tilt X` | `int16_t` | `-9000` to `+9000` | Hundredths of a degree. |
| `28 - 29` | `Tilt Y` | `int16_t` | `-9000` to `+9000` | Hundredths of a degree. |
| `30` | `Routing Flags` | `uint8_t` | Bitmask | Bit 0: Stylus Contact; Bit 1: HW Overlay Active; Bit 2: Handoff Requested; Bit 3: Eraser Mode. |
| `31` | `CRC-8 Checksum` | `uint8_t` | CRC-8-CCITT (`0x07`) | Calculated over Bytes 0 to 30. |

### 5.4 Evdev Direct Linux Pipeline

For Linux-based devices (such as reMarkable 1/2), the daemon processes Linux input events (`/dev/input/event*`) in non-blocking batches, maps raw digitizer coordinate extents (e.g. $15725 \times 20967$) to display pixel space ($1404 \times 1872$), draws previews directly to mapped framebuffer memory (`/dev/fb0`), and emits finalized JSON or Profile B packets.

---

## 6. Waveform & Refresh Control Abstraction

### 6.1 Standardized Refresh Modes

OIP abstracts underlying vendor-specific waveform modes into standard semantics:

| OIP Mode | Onyx Equivalent | reMarkable / Linux | Semantics |
| :--- | :--- | :--- | :--- |
| **`FAST` / `SPEED`** | `DU` / `A2` | Fast monochrome direct | Lowest latency (<15ms), 1-bit or 2-bit preview, minimal contrast. |
| **`PARTIAL`** | `REGAL` / `GU` | Rectangular partial update | High quality update localized to the stroke's bounding box rectangle. |
| **`FULL` / `QUALITY`**| `GC16` | Full screen flash | High fidelity 16-level grayscale pass; eliminates ghosting. |
| **`CLEAR`** | Deep Clear Flash | Framebuffer zero & flash | Inverts panel to purge residual electrostatic charges. |

### 6.2 Focus Handoff State Machine

The transition of touch event ownership between the raw hardware EPDC overlay and software application event loop MUST follow the state machine:

```
    +-------------------------------------------------------------+
    |                         IDLE STATE                          |
    |      (Software Viewport holds touch focus; HW idle)         |
    +------------------------------+------------------------------+
                                   |
                   Stylus Down in Active OIP Region
                 (type: setWritingMode enabled, Touch Inside)
                                   v
    +-------------------------------------------------------------+
    |                      HARDWARE OVERLAY                       |
    |  (Hardware EPDC captures direct touch; latency < 15ms)      |
    +------------------------------+------------------------------+
                                   |
               Stylus Up OR Viewport Exit / Touch Release
                                   v
    +-------------------------------------------------------------+
    |                        FOCUS HANDOFF                        |
    |   (HW flushes pending points; emits strokeFinished event)   |
    +------------------------------+------------------------------+
                                   |
              Host commits vector & emits strokeDrawn
                                   v
    +-------------------------------------------------------------+
    |                     SOFTWARE SYNCHRONIZED                   |
    |    (Host re-renders full-fidelity vector/SVG canvas)        |
    +-------------------------------------------------------------+
```

---

## 7. Capability Probing & Diagnostics System

### 7.1 Hardware Capability Discovery Schema

Upon session initialization, platforms supporting direct hardware discovery MAY query the underlying driver for an `OipHardwareCapabilities` payload:

```json
{
  "schemaVersion": 1,
  "device": {
    "manufacturer": "Onyx",
    "model": "Note Air 3 C",
    "platform": "Android SDK"
  },
  "epdc": {
    "supportedWaveforms": ["SPEED", "BALANCED", "QUALITY", "REGAL", "DU"],
    "supportsPartialRefresh": true,
    "hardwareAcceleration": true
  },
  "digitizer": {
    "pressure": true,
    "tilt": true,
    "hover": true,
    "eraser": true
  }
}
```

### 7.2 Developer Diagnostics & Telemetry Schema

To aid cross-platform debugging and issue reporting, all OIP runtimes MUST provide `collectDiagnostics()` and `createBugReport()` producing structured reports:

```json
{
  "version": "0.1.3",
  "platform": "Android SDK",
  "osVersion": "14",
  "apiLevel": 34,
  "deviceModel": "Boox Note Air 3",
  "selectedBackend": "OnyxBooxEpdAdapter",
  "availableBackends": ["OnyxBooxEpdAdapter", "JetpackInkAdapter", "FallbackCanvasAdapter"],
  "fallbackReason": null,
  "capabilities": {
    "pressure": true,
    "tilt": true,
    "hover": true,
    "eraser": true,
    "refreshModes": ["SPEED", "BALANCED", "QUALITY", "REGAL", "DU"],
    "hardwareAcceleration": true,
    "motionPrediction": false,
    "refreshModeControl": true
  },
  "refreshMode": "SPEED",
  "directDrawingActive": true,
  "recentLogs": [
    {
      "timestamp": 1724180000000,
      "level": "INFO",
      "subsystem": "Backend",
      "backend": "BOOX",
      "event": "INITIALIZATION",
      "message": "Onyx hardware acceleration active"
    }
  ]
}
```

### 7.3 Thread-Safe Circular Ring Buffer Logging

All OIP implementations MUST maintain an in-memory, thread-safe circular ring buffer retaining at least the **last 500 log entries** across all subsystems (`Core`, `Backend`, `Renderer`, `PenInput`, `Refresh`, `Synchronization`, `JsBridge`, `Android`, `Linux`).

---

## 8. Security & Isolation Considerations

### 8.1 Origin-Scoped Bridge Allowlisting

In web runtime wrappers (`OpenInkBridgeWebView`), the native bridge MUST enforce origin allowlisting:
1. Only explicit HTTPS domains (e.g. `https://editor.example.com`) or trusted local assets (`file:///android_asset/`, `https://appassets.androidplatform.net`) MAY receive native bridge bindings.
2. Injected JS interfaces MUST NOT be accessible to third-party iframes embedded within the web page.

### 8.2 Input Clamping & Memory Bounds

1. Bounding box coordinates and stroke widths received from untrusted IPC channels MUST be clamped to finite ranges ($[-1{,}000{,}000, 1{,}000{,}000]$ and $[0.5, 128.0]$ px).
2. Maximum point payload count MUST be strictly bounded (maximum $100{,}000$ points per stroke) to prevent memory allocation denial-of-service.

### 8.3 Non-Recursive Stack Protection

Algorithms processing arbitrary user stroke paths (such as RDP simplification) MUST avoid recursive call stacks to guarantee protection against stack overflow crashes in resource-constrained environments (WebAssembly and embedded ARM).

---

## 9. References

* **[RFC 2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, DOI 10.17487/RFC2119, March 1997, <https://www.rfc-editor.org/info/rfc2119>.
* **[RFC 8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, DOI 10.17487/RFC8174, May 2017, <https://www.rfc-editor.org/info/rfc8174>.
* **[JSON Schema Draft-07]** Andrews, H., Wright, A., "JSON Schema Validation: A Vocabulary for Structural Validation of JSON", Internet-Draft `draft-handrews-json-schema-validation-01`, March 2018, <https://json-schema.org/draft-07/json-schema-validation.html>.
* **[W3C Pointer Events]** Lauke, P. H., Flack, R., Eds., "Pointer Events - Level 3", W3C Recommendation, June 2026, <https://www.w3.org/TR/pointerevents3/>.
* **[W3C InkML]** Chee, Y. M., Froumentin, M., Seni, G., Eds., "Ink Markup Language (InkML)", W3C Recommendation, September 2011, <https://www.w3.org/TR/InkML/>.
* **[Ramer 1972]** Ramer, U., "An iterative procedure for the polygonal approximation of plane curves", *Computer Graphics and Image Processing*, Vol. 1, No. 3, pp. 244–256, DOI 10.1016/S0146-664X(72)80017-0, 1972.
* **[Douglas & Peucker 1973]** Douglas, D. H., Peucker, T. K., "Algorithms for the reduction of the number of points required to represent a digitized line or its caricature", *The Canadian Cartographer*, Vol. 10, No. 2, pp. 112–122, DOI 10.3138/FM57-6770-U75U-7727, 1973.
* **[OIP Contracts]** OpenInkBridge Architecture, [`contracts/bridge-protocol-v1.json`](../contracts/bridge-protocol-v1.json) and [`contracts/stroke-processing-v1.json`](../contracts/stroke-processing-v1.json).
