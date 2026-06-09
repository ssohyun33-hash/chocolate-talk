import React, { useRef, useState, useEffect } from "react";
import { Camera, X, RefreshCw, AlertCircle, Sparkles } from "lucide-react";
import { motion } from "motion/react";

interface ScannerProps {
  onScanSuccess: (scannedId: string) => void;
  onClose: () => void;
}

export default function Scanner({ onScanSuccess, onClose }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorHeader, setErrorHeader] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(
    "Align the unchangeable 8-digit ID in the camera view"
  );

  // Initialize camera
  useEffect(() => {
    async function startCamera() {
      try {
        setErrorHeader(null);
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err: any) {
        console.warn("Camera access failed inside iframe partition:", err);
        setErrorHeader(
          "Camera blocked or unsupported in current container layout. You can still input or paste the 8-digit ID below!"
        );
      }
    }

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const handleCaptureAndScan = async () => {
    if (loading) return;
    
    if (!videoRef.current || !canvasRef.current) {
      // Inline fallback if video stream wasn't set up
      setErrorHeader("Manual code configuration active");
      return;
    }

    setLoading(true);
    setStatusMessage("Capturing frame...");

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        // Match canvas dimensions to video feed
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to quality image base64
        const jpegBase64 = canvas.toDataURL("image/jpeg", 0.75);
        
        setStatusMessage("Gemini OCR is analyzing image snapshot...");
        
        // Request deep analysis OCR route on express endpoint
        const response = await fetch("/api/scan-id", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: jpegBase64 }),
        });

        if (!response.ok) {
          throw new Error("OCR Service reported an error parsing payload");
        }

        const data = await response.json();
        const detectedId = data.id;

        if (detectedId && detectedId !== "none" && /^\d{8}$/.test(detectedId)) {
          setStatusMessage(`Successfully detected User ID: ${detectedId}!`);
          setTimeout(() => {
            onScanSuccess(detectedId);
          }, 800);
        } else {
          setStatusMessage("No 8-digit code format was detected. Align and try again.");
        }
      }
    } catch (err: any) {
      console.error("Scanning failed:", err);
      setStatusMessage("Failed scanning. Check lighting and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = () => {
    const trimmed = manualInput.trim();
    if (/^\d{8}$/.test(trimmed)) {
      onScanSuccess(trimmed);
    } else {
      setStatusMessage("ID must be exactly an 8-digit number (e.g. 10492840)");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-amber-50 shadow-2xl border-4 border-amber-800"
      >
        {/* Header */}
        <div className="flex items-center justify-between bg-amber-900 px-4 py-3 text-amber-50">
          <div className="flex items-center space-x-2">
            <Sparkles className="h-5 w-5 text-amber-300 animate-spin-slow" />
            <span className="font-sans font-bold tracking-tight">Camera ID Scanner</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-amber-200 hover:bg-amber-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 flex flex-col items-center">
          {/* Video Preview viewport */}
          {!errorHeader ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-950 border-2 border-amber-700">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              {/* Target bracket laser outline overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-28 w-48 rounded-lg border-2 border-dashed border-yellow-400 opacity-60 animate-pulse flex items-center justify-center">
                  <span className="text-[10px] text-yellow-300 tracking-wide font-mono bg-black/50 px-1 rounded">
                    ALIGN 8 DIGITS
                  </span>
                </div>
              </div>
              {/* Laser scanning vertical banner logic */}
              <div className="absolute left-0 right-0 top-0 h-1 bg-yellow-400 opacity-80 animate-bounce shadow-[0_0_10px_#eab308]" />
            </div>
          ) : (
            <div className="w-full flex items-start space-x-3 rounded-xl bg-orange-100 p-3 border border-orange-200 mb-4 text-xs text-orange-800">
              <AlertCircle className="h-5 w-5 shrink-0 text-orange-600" />
              <span>{errorHeader}</span>
            </div>
          )}

          {/* Canvas referenced invisibly for capturing frame arrays */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Feedback Label status indicator */}
          <div className="mt-3 w-full text-center text-xs font-mono font-semibold text-amber-900 border border-amber-200 bg-amber-100/50 rounded-md py-1">
            {statusMessage}
          </div>

          {!errorHeader && (
            <button
              onClick={handleCaptureAndScan}
              disabled={loading}
              className="mt-4 flex w-full items-center justify-center space-x-2 rounded-xl bg-amber-700 py-3 text-sm font-semibold text-white shadow-md hover:bg-amber-800 disabled:bg-amber-400 transition"
            >
              {loading ? (
                <RefreshCw className="h-5 w-5 animate-spin" />
              ) : (
                <Camera className="h-5 w-5" />
              )}
              <span>{loading ? "Analyzing Frame..." : "Capture & Scan ID"}</span>
            </button>
          )}

          {/* Quick Manual Entry Fallback Row */}
          <div className="mt-4 w-full border-t border-amber-200 pt-4">
            <span className="block text-xs font-bold text-amber-800 mb-1.5 uppercase tracking-wide">
              Or entering the code manually:
            </span>
            <div className="flex space-x-2">
              <input
                type="text"
                maxLength={8}
                placeholder="e.g. 48201938"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value.replace(/\D/g, ""))}
                className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-amber-950 focus:border-amber-600 focus:outline-none font-mono tracking-widest text-center"
              />
              <button
                onClick={handleManualSubmit}
                className="rounded-lg bg-amber-900 px-4 py-2 text-xs font-bold text-amber-50 hover:bg-amber-950 transition"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
