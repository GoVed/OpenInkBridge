import React, { useEffect, useRef } from 'react';
import { OpenInkBridgeCanvas, CanvasOptions } from './canvas';
import { StrokePoint } from './model';

export interface OpenInkBridgeCanvasProps extends CanvasOptions {
    onStrokeFinished?: (points: StrokePoint[]) => void;
    className?: string;
    style?: React.CSSProperties;
    width?: string | number;
    height?: string | number;
}

/**
 * A plug-and-play React component for OpenInkBridge stylus drawing.
 * Automatically initializes, scales, and manages drawing event cycles.
 */
export const OpenInkBridgeCanvasComponent: React.FC<OpenInkBridgeCanvasProps> = ({
    strokeColor = "#000000",
    strokeWidth = 4,
    smoothing = true,
    stylusOnly = true,
    onStrokeFinished,
    className,
    style,
    width = '100%',
    height = '100%'
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const osCanvasRef = useRef<OpenInkBridgeCanvas | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const osCanvas = new OpenInkBridgeCanvas(canvas, {
            strokeColor,
            strokeWidth,
            smoothing,
            stylusOnly
        });
        osCanvasRef.current = osCanvas;
        osCanvas.enableDrawing();

        const unsubscribe = onStrokeFinished 
            ? osCanvas.onStrokeFinished(onStrokeFinished) 
            : null;

        return () => {
            if (unsubscribe) unsubscribe();
            osCanvas.destroy();
            if (osCanvasRef.current === osCanvas) osCanvasRef.current = null;
        };
    }, [onStrokeFinished, smoothing, stylusOnly]);

    // Handle dynamic color/width changes
    useEffect(() => {
        if (osCanvasRef.current) {
            osCanvasRef.current.setStyle(strokeColor, strokeWidth, stylusOnly);
        }
    }, [strokeColor, strokeWidth, stylusOnly]);

    const containerStyle: React.CSSProperties = {
        position: 'relative',
        width: width,
        height: height,
        ...style
    };

    return (
        <div style={containerStyle} className={className}>
            <canvas 
                ref={canvasRef} 
                style={{ display: 'block', width: '100%', height: '100%' }} 
            />
        </div>
    );
};
