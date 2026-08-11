# OpenInk Protocol (OIP) Specification - Version 0.1

**Document Status:** Working Draft (`WD-OIP-0.1-20260810`)  
**Domain:** Digital Ink Standardization, Electrophoretic Display Interfaces, Low-Latency Hardware Handoff  
**License:** [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0)  
**Specification Source File:** [`spec/OIP_SPECIFICATION_v0.1.md`](./OIP_SPECIFICATION_v0.1.md)

---

## Abstract

The **OpenInk Protocol (OIP)** defines an open, hardware-agnostic, low-latency communication specification and runtime interface for digital stylus input and Electrophoretic Display Controller (EPDC) refresh routing. OIP enables host operating systems (Android, Linux, Windows), web runtimes (Wasm, HTML5 Canvas, WebSockets), and cross-platform UI frameworks to achieve zero-latency ink rendering on bi-stable e-paper displays while maintaining deterministic state synchronization between native hardware overlays and software viewports.

---

## Status of This Memo

This document specifies a Working Draft protocol for the Internet and Hardware Developer communities. Distribution of this memo is unlimited. Keywords for requirement levels in this document are to be interpreted as described in [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

---

## Table of Contents

1. [Introduction & Architecture](#1-introduction--architecture)
   - 1.1 Purpose & Scope
   - 1.2 Architectural Paradigms
2. [Terminology & Definitions](#2-terminology--definitions)
3. [Hardware Handshake & Capability Probing](#3-hardware-handshake--capability-probing)
   - 3.1 Handshake Protocol Flow
   - 3.2 Formal JSON Schema Definition
   - 3.3 Compliant Handshake Payload Example
4. [Live Stroke Streaming Protocol (Binary Wire Format)](#4-live-stroke-streaming-protocol-binary-wire-format)
   - 4.1 Byte Order & Data Types
   - 4.2 Binary Frame Layout (32-Byte Packet)
   - 4.3 Field Specifications
   - 4.4 Hybrid Touch Routing & Focus Handoff Protocol State Machine
5. [Waveform & Refresh Control Command Set](#5-waveform--refresh-control-command-set)
   - 5.1 Protocol Command Enumeration
   - 5.2 C-ABI & IPC Function Signatures
   - 5.3 IPC Protocol Payload Mapping
6. [Security & Isolation Considerations](#6-security--isolation-considerations)
7. [References](#7-references)

---

## 1. Introduction & Architecture

### 1.1 Purpose & Scope

Electrophoretic displays (E-Ink) operate under fundamental physical constraints: microencapsulated physical ink particles must be rearranged via electrostatic field pulses, introducing inherent visual display latency (typically 30ms to 250ms depending on gray-level state transitions). Traditional operating system graphics pipelines—which traverse compositors, UI event loops, and window managers—exacerbate this latency, rendering interactive stylus drawing unacceptable for real-time human interaction.

To bypass host compositor delays, hardware vendors implement proprietary direct-to-EPDC rendering pathways. However, these vendor SDKs lack common interfaces, causing extreme ecosystem fragmentation across Android, Linux, and Web environments.

The OpenInk Protocol (OIP) solves this by defining:
1. A standard hardware capability probing schema for EPDC and digitizer discovery.
2. A deterministic byte-level binary wire format for ultra-low-latency stroke streaming.
3. A standardized Waveform & Refresh command abstraction.
4. A Hybrid Touch Routing protocol governing hardware overlay to software viewport focus handoffs.

### 1.2 Architectural Paradigms

OIP relies on two fundamental architectural patterns:

#### A. Capability-Probed Rendering
Host software MUST NOT assume hardware acceleration parameters. Upon initialization, the host MUST execute an OIP Handshake. The hardware controller returns a structured Capability Probe detailing available EPDC waveform modes (e.g., A2, GL16, Regal, DU), hardware latency windows, digitizer sampling rates, and onboard vector smoothing filters. If hardware capabilities are absent, host software MUST gracefully degrade to software-calculated motion prediction and standard software rendering passes.

```
+-----------------------------------------------------------------------+
|                         Host Application / Web SDK                    |
+-----------------------------------+-----------------------------------+
                                    |
                            [ OIP Capability Probe ]
                                    |
                  +-----------------+-----------------+
                  |                                   |
                  v                                   v
    +---------------------------+       +---------------------------+
    | Accelerated EPDC Backend  |       |   Software Fallback Engine|
    | (Onyx, reMarkable, etc.)  |       | (Canvas / MotionPredict)  |
    +---------------------------+       +---------------------------+
```

#### B. Hybrid Overlay Bridge Pattern
To eliminate web runtime and OS window compositor latency, OIP specifies a transparent native hardware overlay situated directly above the web/native application viewport. When the stylus contacts the screen within an active OIP region, the hardware layer intercepting raw digitizer events IMMEDIATELY renders ink to the EPDC using fast monochrome waveforms. Upon stroke termination or region exit, OIP executes a deterministic **Focus Handoff**, transferring processed vector coordinates back to the software application layer.

```
       [ Stylus Contact ]
               |
               v
  +--------------------------+
  | Hardware EPDC Overlay    | ---> Direct Display Panel (Low Latency < 15ms)
  +------------+-------------+
               |
    [ Focus Handoff Stream ] (Binary OIP Packets)
               |
               v
  +--------------------------+
  | Host Viewport (JS/Native)| ---> High-Quality SVG/Canvas Render (Asynchronous)
  +--------------------------+
```

---

## 2. Terminology & Definitions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

* **Electrophoretic Display Controller (EPDC):** A dedicated hardware timing controller or integrated SoC display controller responsible for driving physical E-Ink panel electrodes.
* **Waveform Mode:** A Look-Up Table (LUT) voltage drive sequence programmed into the EPDC to transition pixels between microencapsulated optical states.
* **Hybrid Overlay:** A hardware-level or native surface overlay operating asynchronously from the host UI thread to directly output ink onto the EPDC framebuffer.
* **Capability Probing:** The mandatory protocol exchange occurring at session initialization to discover supported waveform modes, sampling capabilities, and hardware bounds.
* **Partial Refresh:** An EPDC hardware operation that updates only a specified sub-rectangle bounding box of the display panel without initiating a full-panel update.
* **Focus Handoff:** The deterministic transition of touch event processing between the raw hardware EPDC overlay pipeline and the software application event loop.
* **Zero-Phase Smoothing Contract:** The standard `0.25 / 0.50 / 0.25` FIR stroke position filter enforced by OIP to ensure spatial coordinate consistency across backends.

---

## 3. Hardware Handshake & Capability Probing

### 3.1 Handshake Protocol Flow

Upon session establishment, the host MUST issue an `OIP_PROBE_REQUEST` to the underlying OIP driver. The driver MUST respond with an `OIP_PROBE_RESPONSE` containing a JSON document adhering strictly to the schema defined in Section 3.2.

```
 Host Application / OS                         OIP Driver / Hardware
         |                                               |
         |------------ OIP_PROBE_REQUEST --------------->|
         |                                               |
         |<----------- OIP_PROBE_RESPONSE --------------|
         |          (JSON Capability Schema)             |
         |                                               |
```

### 3.2 Formal JSON Schema Definition

The `OIP_PROBE_RESPONSE` JSON payload MUST conform to the JSON Schema (Draft-07) defined below:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "OpenInkProtocolCapabilityResponse",
  "description": "Hardware handshake capability definition schema for the OpenInk Protocol (OIP) v0.1.",
  "type": "object",
  "required": [
    "schemaVersion",
    "deviceMetadata",
    "epdcCapabilities",
    "digitizerCapabilities",
    "strokeEngine",
    "hybridOverlayCapabilities"
  ],
  "properties": {
    "schemaVersion": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1,
      "description": "Monotonically increasing protocol schema version."
    },
    "deviceMetadata": {
      "type": "object",
      "required": ["vendor", "model", "firmwareVersion", "platformArchitecture"],
      "properties": {
        "vendor": { "type": "string" },
        "model": { "type": "string" },
        "firmwareVersion": { "type": "string" },
        "hardwareRevision": { "type": "string" },
        "platformArchitecture": {
          "type": "string",
          "enum": ["ANDROID_JNI", "LINUX_EVDEV", "EMBEDDED_C_ABI", "WASM_SYNTHETIC"]
        }
      }
    },
    "epdcCapabilities": {
      "type": "object",
      "required": [
        "supportedWaveforms",
        "maxRefreshHz",
        "minLatencyMs",
        "supportsPartialRefresh",
        "maxSubRegions"
      ],
      "properties": {
        "supportedWaveforms": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["A2", "GL16", "REGAL", "DU", "GC16", "PARTIAL_FAST"]
          },
          "minItems": 1
        },
        "maxRefreshHz": { "type": "number", "minimum": 1.0 },
        "minLatencyMs": { "type": "number", "minimum": 0.0 },
        "supportsPartialRefresh": { "type": "boolean" },
        "maxSubRegions": { "type": "integer", "minimum": 1 }
      }
    },
    "digitizerCapabilities": {
      "type": "object",
      "required": [
        "maxSamplingRateHz",
        "pressureLevels",
        "tiltSupported",
        "azimuthSupported",
        "spatialResolutionDpi"
      ],
      "properties": {
        "maxSamplingRateHz": { "type": "integer", "minimum": 1 },
        "pressureLevels": { "type": "integer", "minimum": 0 },
        "tiltSupported": { "type": "boolean" },
        "azimuthSupported": { "type": "boolean" },
        "spatialResolutionDpi": { "type": "number", "minimum": 1.0 }
      }
    },
    "strokeEngine": {
      "type": "object",
      "required": [
        "supportedSmoothingContracts",
        "ramerDouglasPeuckerSupported",
        "hardwareAccelerationAvailable"
      ],
      "properties": {
        "supportedSmoothingContracts": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["ZERO_PHASE_025_050_025", "NONE"]
          }
        },
        "ramerDouglasPeuckerSupported": { "type": "boolean" },
        "hardwareAccelerationAvailable": { "type": "boolean" }
      }
    },
    "hybridOverlayCapabilities": {
      "type": "object",
      "required": [
        "supportedRenderTargets",
        "focusHandoffLatencyMs",
        "hardwareInputIsolation"
      ],
      "properties": {
        "supportedRenderTargets": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["NATIVE_SURFACE", "DIRECT_FB", "EVDEV_OVERLAY", "WEBVIEW_BRIDGE"]
          }
        },
        "focusHandoffLatencyMs": { "type": "number", "minimum": 0.0 },
        "hardwareInputIsolation": { "type": "boolean" }
      }
    }
  },
  "additionalProperties": false
}
```

### 3.3 Compliant Handshake Payload Example

```json
{
  "schemaVersion": 1,
  "deviceMetadata": {
    "vendor": "Onyx",
    "model": "Boox Note Air 3 C",
    "firmwareVersion": "3.5.2-build2026",
    "hardwareRevision": "rev_b",
    "platformArchitecture": "ANDROID_JNI"
  },
  "epdcCapabilities": {
    "supportedWaveforms": ["A2", "GL16", "REGAL", "DU", "PARTIAL_FAST"],
    "maxRefreshHz": 85.0,
    "minLatencyMs": 12.5,
    "supportsPartialRefresh": true,
    "maxSubRegions": 8
  },
  "digitizerCapabilities": {
    "maxSamplingRateHz": 350,
    "pressureLevels": 4096,
    "tiltSupported": true,
    "azimuthSupported": false,
    "spatialResolutionDpi": 300.0
  },
  "strokeEngine": {
    "supportedSmoothingContracts": ["ZERO_PHASE_025_050_025"],
    "ramerDouglasPeuckerSupported": true,
    "hardwareAccelerationAvailable": true
  },
  "hybridOverlayCapabilities": {
    "supportedRenderTargets": ["NATIVE_SURFACE", "WEBVIEW_BRIDGE"],
    "focusHandoffLatencyMs": 2.1,
    "hardwareInputIsolation": true
  }
}
```

---

## 4. Live Stroke Streaming Protocol (Binary Wire Format)

### 4.1 Byte Order & Data Types

All binary packet data MUST be transmitted in **Network Byte Order (Big-Endian)**. 
Primitive data types are defined as follows:
* `uint8_t`: Unsigned 8-bit integer.
* `uint16_t`: Unsigned 16-bit integer.
* `int16_t`: Signed 16-bit integer (Two's complement).
* `uint32_t`: Unsigned 32-bit integer.
* `uint64_t`: Unsigned 64-bit integer.

### 4.2 Binary Frame Layout (32-Byte Fixed Packet Structure)

To prevent parsing overhead and garbage collection pauses in real-time execution, OIP stroke points MUST be packed into a fixed 32-byte binary frame structure.

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Magic Number         | Version (0x01)| Packet Type   |
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

### 4.3 Field Specifications

| Byte Offset | Field Name | Data Type | Units / Range | Description |
| :--- | :--- | :--- | :--- | :--- |
| `0 - 1` | `Magic Number` | `uint16_t` | `0x4F49` (`'O' 'I'`) | Fixed magic identifier validating OIP packet frames. |
| `2` | `Protocol Version` | `uint8_t` | `0x01` | Protocol version identifier. |
| `3` | `Packet Type` | `uint8_t` | Enum | `0x01` = Stroke Start, `0x02` = Point Update, `0x03` = Stroke End, `0x04` = Handoff Req, `0x05` = Handoff Ack. |
| `4 - 7` | `Sequence Number` | `uint32_t` | `0` to `4,294,967,295` | Monotonically increasing packet index for packet loss detection. |
| `8 - 15` | `Timestamp` | `uint64_t` | Microseconds (μs) | Microseconds elapsed since Unix Epoch (UTC). |
| `16 - 19` | `X Coordinate` | `uint32_t` | 16.16 Fixed Point | Sub-pixel X position (`[0, Display Width] × 65536`). |
| `20 - 23` | `Y Coordinate` | `uint32_t` | 16.16 Fixed Point | Sub-pixel Y position (`[0, Display Height] × 65536`). |
| `24 - 25` | `Normalized Pressure` | `uint16_t` | `0` to `65535` | Pressure ratio linearly mapped from `0.0` (`0x0000`) to `1.0` (`0xFFFF`). |
| `26 - 27` | `Tilt X` | `int16_t` | `-9000` to `+9000` | Angle off vertical in hundredths of a degree (`-90.00°` to `+90.00°`). |
| `28 - 29` | `Tilt Y` | `int16_t` | `-9000` to `+9000` | Angle off vertical in hundredths of a degree (`-90.00°` to `+90.00°`). |
| `30` | `Routing Flags` | `uint8_t` | Bitmask | Hybrid touch state, hardware ownership, and tool flags. |
| `31` | `CRC-8 Checksum` | `uint8_t` | Polynomial `0x07` | CRC-8-CCITT calculated over Bytes 0 to 30. |

#### Routing Flags Bitmask Definition (Byte 30):
* **Bit 0 (`0x01`):** `STYLUS_CONTACT` — Set if stylus tip is contacting digitizer surface.
* **Bit 1 (`0x02`):** `HW_OVERLAY_ACTIVE` — Set if hardware EPDC is currently intercepting direct draw.
* **Bit 2 (`0x04`):** `HANDOFF_REQUESTED` — Set when hardware requests yielding touch ownership to host software.
* **Bit 3 (`0x08`):** `ERASER_MODE` — Set if inverted stylus tail or secondary eraser button is active.
* **Bits 4–7:** Reserved for future standardization. MUST be set to `0`.

### 4.4 Hybrid Touch Routing & Focus Handoff State Machine

The transition of touch event ownership between the raw hardware EPDC overlay driver and the software host application MUST conform to the state machine defined below:

```
    +-------------------------------------------------------------+
    |                         IDLE STATE                          |
    |      (Software Viewport holds touch focus; HW idle)         |
    +------------------------------+------------------------------+
                                   |
                  Stylus Down in Active OIP Region
                (Packet Type 0x01, Routing Flag 0x03)
                                   v
    +-------------------------------------------------------------+
    |                      HARDWARE OVERLAY                       |
    |  (Hardware EPDC captures direct touch; latency < 15ms)      |
    +------------------------------+------------------------------+
                                   |
              Stylus Up OR Viewport Exit / Touch Release
                (Packet Type 0x03/0x04, Flag 0x04)
                                   v
    +-------------------------------------------------------------+
    |                        FOCUS HANDOFF                        |
    |   (HW flushes pending points; emits 0x05 ACK to Software)   |
    +------------------------------+------------------------------+
                                   |
                 Points Synced to JS/Native Canvas
                                   v
    +-------------------------------------------------------------+
    |                     SOFTWARE SYNCHRONIZED                   |
    |    (Host re-renders full-fidelity vector/SVG canvas)        |
    +-------------------------------------------------------------+
```

---

## 5. Waveform & Refresh Control Command Set

### 5.1 Protocol Command Enumeration

An OIP-compliant implementation MUST expose a control interface capable of processing four primary operation op-codes:

| Op-Code | Command Name | Purpose |
| :--- | :--- | :--- |
| `0x01` | `OIP_CMD_SET_WRITING_MODE` | Configures active drawing canvas bounding box, stroke color, width, and hardware isolation. |
| `0x02` | `OIP_CMD_REQUEST_REFRESH` | Requests explicit EPDC waveform refresh over a target bounding box. |
| `0x03` | `OIP_CMD_HANDOFF_CONTROL` | Forces explicit focus transfer between hardware overlay and software application. |
| `0x04` | `OIP_CMD_CLEAR_REGION` | Triggers high-quality flash clearing waveform to remove ghosting artifacts. |

### 5.2 C-ABI & IPC Function Signatures

For native platform implementations (C/C++, Rust, Android JNI, Linux drivers), the runtime MUST export the following C-ABI interface signatures:

```c
/* Standard return codes */
typedef int32_t oip_status_t;
#define OIP_SUCCESS               0
#define OIP_ERROR_INVALID_PARAM  -1
#define OIP_ERROR_UNSUPPORTED    -2
#define OIP_ERROR_HARDWARE_FAULT -3

/* Rectangle structure for sub-region bounding boxes */
typedef struct {
    uint32_t left;
    uint32_t top;
    uint32_t width;
    uint32_t height;
} oip_rect_t;

/* Writing mode configuration structure */
typedef struct {
    uint32_t struct_size;       /* MUST equal sizeof(oip_writing_mode_t) */
    uint32_t stroke_color_argb; /* 32-bit ARGB color value */
    float    stroke_width_px;   /* Target rendering stroke width in pixels */
    uint8_t  stylus_only_input; /* 1 = Ignore touch finger input; 0 = Allow dual input */
    oip_rect_t active_bounds;   /* Bounding box where hardware overlay intercept is enabled */
} oip_writing_mode_t;

/* Standard C-ABI API Declarations */
oip_status_t oip_initialize(const char* init_params_json, char* response_buffer, uint32_t buffer_len);
oip_status_t oip_set_writing_mode(const oip_writing_mode_t* mode_config);
oip_status_t oip_request_refresh(oip_rect_t bounds, uint8_t waveform_mode, uint8_t synchronous);
oip_status_t oip_handoff_control(uint8_t release_to_software);
oip_status_t oip_clear_region(oip_rect_t bounds, uint8_t flash_mode);
```

### 5.3 IPC Protocol Payload Mapping

For web browsers and IPC-bound microservices (using WebSockets, Android WebMessagePort, or Unix Domain Sockets), commands MUST be wrapped in JSON payloads matching the OIP IPC Schema:

#### `OIP_CMD_SET_WRITING_MODE` Payload Example:
```json
{
  "protocolVersion": 1,
  "command": "OIP_CMD_SET_WRITING_MODE",
  "sessionId": "sess-8f92a10c",
  "payload": {
    "enabled": true,
    "strokeColor": "#000000",
    "strokeWidthPx": 3.5,
    "stylusOnlyInput": true,
    "activeBounds": { "left": 0, "top": 120, "width": 1404, "height": 1752 }
  }
}
```

#### `OIP_CMD_REQUEST_REFRESH` Payload Example:
```json
{
  "protocolVersion": 1,
  "command": "OIP_CMD_REQUEST_REFRESH",
  "sessionId": "sess-8f92a10c",
  "payload": {
    "waveformMode": "REGAL",
    "synchronous": false,
    "targetBounds": { "left": 100, "top": 200, "width": 500, "height": 400 }
  }
}
```

---

## 6. Security & Isolation Considerations

1. **Input Isolation & Privileged HW Intercept:** Implementations MUST ensure that enabling hardware overlay drawing does NOT grant unprivileged applications access to system-wide digitizer inputs outside their designated viewport bounds.
2. **Buffer Integrity:** Binary 32-byte stroke frames MUST be validated using the trailing `CRC-8` byte. Corrupted frames MUST be discarded immediately without crashing the live hardware rendering thread.
3. **Denial-of-Service Mitigations:** Drivers MUST enforce rate-limiting on high-latency EPDC clear commands (`OIP_CMD_CLEAR_REGION`) to prevent malicious web applications from locking the physical panel in continuous flash-refresh loops.

---

## 7. References

* **[RFC 2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
* **[JSON Schema Draft-07]** Wright, A., Andrews, H., Hutton, B., "JSON Schema Validation: A Vocabulary for Structural Validation of JSON", Draft-07, 2020.
* **[W3C Pointer Events]** W3C Recommendation, "Pointer Events - Level 3", 2023.
