import React, { useState, useEffect, useRef } from "react";
import { X, Clipboard, Check, Search, UserPlus, RefreshCw, QrCode, Scan, Camera, Sparkles, AlertTriangle, Upload } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { UserProfile } from "../types";
import { collection, query, where, getDocs, doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import jsQR from "jsqr";
import QRCode from "qrcode";

const ensureEightDigitId = (uid: string, uniqueId?: string) => {
  const clean = (uniqueId || "").replace(/[^0-9]/g, "");
  if (clean.length === 8) return clean;
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = uid.charCodeAt(i) + ((hash << 5) - hash);
  }
  return (10000000 + (Math.abs(hash) % 90000000)).toString();
};

interface ShowIdModalProps {
  profile: UserProfile;
  onClose: () => void;
  theme: "white" | "black";
}

// Custom QR pattern code generator based on 8-digit unique ID
const generateDeterministicQRMatrix = (id: string): boolean[][] => {
  const size = 21;
  const matrix: boolean[][] = Array(size).fill(null).map(() => Array(size).fill(false));
  const idNum = parseInt(id) || 12345678;
  
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Draw 3 standard 7x7 QR alignment finder patterns at corners
      const isTopLeft = r < 7 && c < 7;
      const isTopRight = r < 7 && c >= 14;
      const isBottomLeft = r >= 14 && c < 7;
      
      if (isTopLeft || isTopRight || isBottomLeft) {
        const dr = isBottomLeft ? r - 14 : r;
        const dc = isTopRight ? c - 14 : c;
        const isOuterFrame = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const isInnerCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        matrix[r][c] = isOuterFrame || isInnerCore;
      } else {
        // Seeded pseudorandom algorithm with ID to generate unique, reproducible pattern
        const hashSeed = (r * 13 + c * 37 + idNum * 11) % 100;
        matrix[r][c] = hashSeed > 46;
      }
    }
  }
  return matrix;
};

// Play a nice digital "beep" sound natively using Web Audio API
const playBeep = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(1100, ctx.currentTime); // High pitch Kakao scan success tone
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (err) {
    console.warn("Audio context not allowed yet:", err);
  }
};

export default function ShowIdModal({ profile, onClose, theme }: ShowIdModalProps) {
  const isDark = theme === "black";
  
  // Tab selector: "card" or "scanner"
  const [activeTab, setActiveTab] = useState<"card" | "scanner">("card");
  const [copied, setCopied] = useState(false);

  // Friends Database querying & invite states
  const [targetIdInput, setTargetIdInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [success, setSuccess] = useState(false);

  // Active Camera states
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);

  // Simulator choices list
  const [otherUsers, setOtherUsers] = useState<any[]>([]);
  const [selectedSimUser, setSelectedSimUser] = useState<string>("");
  const [simulating, setSimulating] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");

  useEffect(() => {
    if (profile.uniqueId) {
      QRCode.toDataURL(profile.uniqueId, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 180,
        color: {
          dark: "#2D1B08",
          light: "#FFFFFF"
        }
      })
      .then((url) => {
        setQrCodeUrl(url);
      })
      .catch((err) => {
        console.error("Failed to generate QR Code data URL:", err);
      });
    }
  }, [profile.uniqueId]);

  // Generate matrix once for this account
  const qrMatrix = generateDeterministicQRMatrix(profile.uniqueId);

  // Query other users from Firestore to allow simulated QR scans easily
  useEffect(() => {
    async function fetchOthers() {
      try {
        const snap = await getDocs(collection(db, "users"));
        const list: any[] = [];
        snap.forEach((d) => {
          const u = d.data();
          if (u.uid !== profile.uid && u.uniqueId && u.uniqueId !== "--------") {
            list.push({
              uid: u.uid,
              displayName: u.displayName,
              uniqueId: u.uniqueId,
              photoURL: u.photoURL,
              email: u.email || "",
            });
          }
        });
        setOtherUsers(list);
        if (list.length > 0) {
          setSelectedSimUser(list[0].uniqueId);
        }
      } catch (e) {
        console.warn("Could not retrieve other user list for scanning simulator:", e);
      }
    }
    fetchOthers();
  }, [profile.uid]);

  const handleCopy = () => {
    navigator.clipboard.writeText(profile.uniqueId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Start devices web camera access
  const startCamera = async () => {
    setCameraError("");
    setCameraActive(false);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      streamRef.current = stream;
      setCameraActive(true);
    } catch (err: any) {
      console.warn("Web camera blocked or inaccessible inside frame:", err);
      setCameraError("Camera permission blocked by browser sandbox/iframe or missing hardware. Try scanning with our custom QR Image Uploader below!");
    }
  };

  // Keep video source synced up reliably on mount
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      try {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.play().catch(e => console.log("Video playback delayed:", e));
      } catch (err) {
        console.warn("Video stream sync failed:", err);
      }
    }
  }, [cameraActive, videoRef.current]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // Live video frame processing with jsQR
  useEffect(() => {
    let animId: number;
    let canvas: HTMLCanvasElement | null = null;

    const processFrame = () => {
      if (!cameraActive || !videoRef.current) {
        animId = requestAnimationFrame(processFrame);
        return;
      }

      const video = videoRef.current;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        if (!canvas) {
          canvas = document.createElement("canvas");
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const decoded = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: "dontInvert"
          });

          if (decoded && decoded.data) {
            const clean = decoded.data.replace(/[^0-9]/g, "");
            if (clean.length === 8) {
              playBeep();
              stopCamera();
              performSearchById(clean);
              return; // stop the loop
            }
          }
        }
      }
      animId = requestAnimationFrame(processFrame);
    };

    if (cameraActive) {
      animId = requestAnimationFrame(processFrame);
    }

    return () => {
      if (animId) {
        cancelAnimationFrame(animId);
      }
    };
  }, [cameraActive]);

  // Support image file QR decoding as a reliable fallback
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setErrorMessage("");
    setFoundUser(null);
    setSuccess(false);

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, img.width, img.height);
          const decoded = jsQR(imgData.data, imgData.width, imgData.height);

          if (decoded && decoded.data) {
            const clean = decoded.data.replace(/[^0-9]/g, "");
            if (clean.length === 8) {
              playBeep();
              performSearchById(clean);
            } else {
              setErrorMessage(`Decoded text "${decoded.data}" is not a valid 8-digit Choc Talk ID.`);
            }
          } else {
            setErrorMessage("No valid QR Code pattern could be detected in this image. Clean up orientation or zoom.");
          }
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Gracefully clear tracks on unmount / change tab
  useEffect(() => {
    if (activeTab !== "scanner") {
      stopCamera();
    }
    return () => stopCamera();
  }, [activeTab]);

  // Execute Search Database manually with robust multi-stage fallbacks
  const performSearchById = async (searchId: string) => {
    const rawVal = searchId.trim();
    if (!rawVal) {
      setErrorMessage("Please select or enter an 8-digit numeric chocolate link code.");
      return;
    }

    // Filter validation: strictly accept only 8-digit numeric IDs
    const cleanId = rawVal.replace(/[^0-9]/g, "");
    if (cleanId.length !== 8) {
      setErrorMessage("Failed to detect. This is not a Chocolate styled 8-digit numeric profile barcode.");
      return;
    }

    setSearching(true);
    setErrorMessage("");
    setFoundUser(null);
    setSuccess(false);

    try {
      let foundDoc: any = null;

      // 1. Direct query as string
      const q = query(collection(db, "users"), where("uniqueId", "==", cleanId));
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        foundDoc = snap.docs[0];
      } else {
        // 2. Direct query as number in case it was stored as integer
        const qNum = query(collection(db, "users"), where("uniqueId", "==", Number(cleanId)));
        const snapNum = await getDocs(qNum);
        if (!snapNum.empty) {
          foundDoc = snapNum.docs[0];
        } else {
          // 3. Robust client fallback scanning all users (handles formatting mismatches or security rules details)
          const allUsersSnap = await getDocs(collection(db, "users"));
          const matchDoc = allUsersSnap.docs.find((d) => {
            const uData = d.data();
            const uniqueIdStr = String(uData.uniqueId || "").trim();
            const cleanUniqueId = uniqueIdStr.replace(/[^0-9]/g, "");
            return cleanUniqueId === cleanId || uniqueIdStr.toLowerCase() === cleanId.toLowerCase();
          });
          if (matchDoc) {
            foundDoc = matchDoc;
          }
        }
      }

      if (!foundDoc) {
        setErrorMessage(`Chocolatier address "${cleanId}" not found in database.`);
      } else {
        const data = foundDoc.data();
        if (data.uid === profile.uid) {
          setErrorMessage("That QR code is your own! Scan a friend's Chocolate QR code.");
        } else {
          setFoundUser({
            uid: data.uid,
            displayName: data.displayName || "ChocTalk Friend",
            photoURL: data.photoURL || "",
            uniqueId: String(data.uniqueId || cleanId),
            email: data.email || "",
          });
        }
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage("An unexpected error occurred during database lookup. Please check connection.");
    } finally {
      setSearching(false);
    }
  };

  // Run Simulated laser scan workflow with audio feedback
  const triggerSimulatedScan = () => {
    if (!selectedSimUser) {
      setErrorMessage("No other registered users available to simulate scan.");
      return;
    }
    setSimulating(true);
    setErrorMessage("");
    setFoundUser(null);
    setSuccess(false);

    setTimeout(() => {
      playBeep();
      setSimulating(false);
      performSearchById(selectedSimUser);
    }, 1500); // 1.5 seconds simulated scan sweep
  };

  const handleSendInvite = async () => {
    if (!foundUser) return;
    setSearching(true);
    setErrorMessage("");

    try {
      const batch = writeBatch(db);

      const receiverUniqueId = ensureEightDigitId(foundUser.uid, foundUser.uniqueId);
      const senderUniqueId = ensureEightDigitId(profile.uid, profile.uniqueId);

      // Save outbound request
      const outboundRef = doc(db, `users/${profile.uid}/friends/${foundUser.uid}`);
      batch.set(outboundRef, {
        friendId: foundUser.uid,
        displayName: foundUser.displayName || "ChocTalk Friend",
        photoURL: foundUser.photoURL || "",
        uniqueId: receiverUniqueId,
        email: foundUser.email || "",
        status: "outbound",
        addedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      // Save inbound request
      const inboundRef = doc(db, `users/${foundUser.uid}/friends/${profile.uid}`);
      batch.set(inboundRef, {
        friendId: profile.uid,
        displayName: profile.displayName || "ChocTalk Friend",
        photoURL: profile.photoURL || "",
        uniqueId: senderUniqueId,
        email: profile.email || "",
        status: "inbound",
        addedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setSuccess(true);
      setTargetIdInput("");
      setFoundUser(null);
    } catch (err: any) {
      console.error(err);
      handleFirestoreError(err, OperationType.WRITE, `users/${profile.uid}/friends/${foundUser.uid}`);
      setErrorMessage("Could not submit friend proposal successfully.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-3xs p-2 sm:p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className={`w-full max-w-lg max-h-[96vh] sm:max-h-[90vh] flex flex-col rounded-[2rem] border overflow-hidden shadow-2xl transition-all duration-200 ${
          isDark 
            ? "bg-[#09090b] border-zinc-800 text-white" 
            : "bg-white border-[#E8E1D5] text-[#2D1B08]"
        }`}
      >
        {/* Modal Window Header */}
        <div className={`flex items-center justify-between border-b px-6 py-4 shrink-0 ${
          isDark ? "border-zinc-850 bg-zinc-950" : "border-[#E8E1D5] bg-[#FAF6F0]"
        }`}>
          <div className="flex items-center space-x-2">
            <Sparkles className={`h-4.5 w-4.5 ${isDark ? "text-yellow-400" : "text-[#7B3F00]"}`} />
            <span className="font-sans font-extrabold text-[#7B3F00] text-xs sm:text-sm select-none">
              ChocTalk My ID Center
            </span>
          </div>
          <button
            onClick={onClose}
            className={`rounded-full p-1.5 transition ${
              isDark ? "text-zinc-400 hover:bg-[#18181b] hover:text-white" : "text-gray-400 hover:bg-[#F5F1EB] hover:text-gray-600"
            }`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className={`grid grid-cols-2 text-center border-b font-sans text-xs font-bold ${
          isDark ? "border-zinc-850 bg-[#000]" : "border-[#E8E1D5] bg-[#FDFBF7]"
        }`}>
          <button
            onClick={() => setActiveTab("card")}
            className={`py-3.5 border-r border-[#E8E1D5]/30 cursor-pointer transition-all ${
              activeTab === "card"
                ? isDark 
                  ? "bg-[#18181b] text-yellow-500 border-b-2 border-yellow-500"
                  : "bg-white text-[#7B3F00] border-b-2 border-[#7B3F00]"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <span className="flex items-center justify-center space-x-1.5">
              <QrCode className="h-4 w-4" />
              <span>My QR Card</span>
            </span>
          </button>
          
          <button
            onClick={() => setActiveTab("scanner")}
            className={`py-3.5 cursor-pointer transition-all ${
              activeTab === "scanner"
                ? isDark 
                  ? "bg-[#18181b] text-yellow-500 border-b-2 border-yellow-500"
                  : "bg-white text-[#7B3F00] border-b-2 border-[#7B3F00]"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <span className="flex items-center justify-center space-x-1.5">
              <Scan className="h-4 w-4" />
              <span>Chocolate QR Scanner</span>
            </span>
          </button>
        </div>

        {/* Modal Panels wrapper */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 sm:space-y-6">
          <AnimatePresence mode="wait">
            
            {/* VIEW TAB 1: USER ID QR CARD */}
            {activeTab === "card" && (
              <motion.div
                key="card-tab"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6 flex flex-col items-center"
              >
                {/* Visual Premium ChocTalk Card Display */}
                <div className={`w-full max-w-sm rounded-[2.25rem] border p-6 text-center select-none relative overflow-hidden transition-all shadow-md ${
                  isDark 
                    ? "bg-[#141417] border-zinc-800" 
                    : "bg-[#FFEB33] border-[#7B3F00]/20 text-[#3C1E1E]"
                }`}>
                  {/* Decorative Header banner inside card */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <div className="h-2 w-2 rounded-full bg-yellow-600 animate-ping" />
                      <span className="text-[9px] uppercase font-mono tracking-widest font-black opacity-80">
                        ChocTalk ID Center
                      </span>
                    </div>
                    <span className="text-[8px] font-mono opacity-60">Verified Member</span>
                  </div>

                  <h3 className="text-sm font-black font-sans tracking-tight mb-4">
                    {profile.displayName && profile.displayName.toUpperCase()}
                  </h3>

                  {/* REAL Standard-compliant Decodable QR Barcode render */}
                  <div className="flex justify-center my-5">
                    <div className="bg-white p-4.5 rounded-3xl shadow-lg border border-[#3C1E1E]/10 flex flex-col items-center">
                      {qrCodeUrl ? (
                        <img 
                          src={qrCodeUrl} 
                          alt="ChocTalk Card Barcode" 
                          className="w-[154px] h-[154px] rounded-xl object-contain select-none"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-[154px] h-[154px] flex items-center justify-center bg-gray-50 rounded-xl">
                          <RefreshCw className="h-6 w-6 animate-spin text-[#7B3F00]/30" />
                        </div>
                      )}
                      
                      {/* Logo watermark centered inside the custom QR layout */}
                      <div className="font-mono text-[7px] font-extrabold uppercase bg-yellow-400 text-[#7B3F00] px-1.5 py-0.5 rounded-md tracking-wider mt-2.5 shadow-3xs">
                        CHOC-TALK
                      </div>
                    </div>
                  </div>

                  {/* 8-Digit Code text */}
                  <div className="mt-4 flex flex-col items-center space-y-2">
                    <div className="text-[10px] uppercase font-mono tracking-widest font-bold opacity-60">
                      My Permanent Code
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xl sm:text-2xl font-black tracking-widest text-[#2D1B08]">
                        {profile.uniqueId}
                      </span>
                      <button
                        onClick={handleCopy}
                        className={`p-1.5 rounded-xl border transition cursor-pointer ${
                          copied 
                            ? "bg-green-100 border-green-300 text-green-700" 
                            : "bg-white hover:bg-gray-100 border-gray-300 text-gray-700"
                        }`}
                        title="Copy my code number"
                      >
                        {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* VIEW TAB 2: QR CAMERA SCANNER */}
            {activeTab === "scanner" && (
              <motion.div
                key="scanner-tab"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-4"
              >
                {/* Camera feedback screen with animated scanning layout */}
                <div className={`relative w-full h-56 rounded-2.5xl overflow-hidden flex flex-col items-center justify-center border ${
                  isDark ? "bg-black border-zinc-800" : "bg-neutral-900 border-[#E8E1D5]"
                }`}>
                  {/* Flashing green alignment tracking box */}
                  <div className="absolute inset-0 z-10 pointer-events-none border-[1.5rem] border-black/55 flex items-center justify-center">
                    <div className="w-32 h-32 border-2 border-dashed border-green-500 rounded-xl relative">
                      <div className="absolute top-0 left-0 w-3 h-3 border-t-4 border-l-4 border-emerald-400" />
                      <div className="absolute top-0 right-0 w-3 h-3 border-t-4 border-r-4 border-emerald-400" />
                      <div className="absolute bottom-0 left-0 w-3 h-3 border-b-4 border-l-4 border-emerald-400" />
                      <div className="absolute bottom-0 right-0 w-3 h-3 border-b-4 border-r-4 border-emerald-400" />
                      
                      {/* Laser sweeping bar */}
                      <div className="w-full h-1 bg-green-400 absolute top-0 animate-bounce shadow-glow shrink-0" />
                    </div>
                  </div>

                  {/* Video element always rendered in DOM to keep ref bound correctly, avoiding React mount race condition */}
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`absolute inset-0 w-full h-full object-cover ${cameraActive ? "block" : "hidden"}`}
                  />

                  {!cameraActive && (
                    <div className="z-10 text-center p-6 space-y-3">
                      <Camera className="h-10 w-10 text-gray-500 mx-auto animate-pulse" />
                      <p className="text-xs text-gray-400 font-medium">Camera tracking is offline.</p>
                      <div className="flex items-center justify-center space-x-2">
                        <button
                          onClick={startCamera}
                          className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-[#7B3F00] text-white hover:bg-[#5C2E00] cursor-pointer transition shadow-sm"
                        >
                          Enable Video Feed
                        </button>
                        <label className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-gray-500 text-gray-400 hover:text-white hover:bg-zinc-800 cursor-pointer transition shadow-sm flex items-center space-x-1">
                          <Upload className="h-3 w-3" />
                          <span>Upload QR Photo</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {cameraError && (
                    <div className="absolute bottom-2 left-2 right-2 z-20 bg-black/85 p-2 rounded-lg text-[9px] text-yellow-300 flex flex-col items-center space-y-1.5 border border-yellow-500">
                      <div className="flex items-start space-x-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span>{cameraError}</span>
                      </div>
                      <label className="text-[10px] bg-yellow-500 text-black px-2 py-0.5 rounded font-black cursor-pointer hover:bg-yellow-400 transition">
                        Select QR Image From Device
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}

                  {simulating && (
                    <div className="absolute inset-0 z-30 bg-black/90 flex flex-col items-center justify-center space-y-3">
                      <div className="h-8 w-8 border-2 border-[#7B3F00] border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs text-yellow-500 font-mono font-black animate-pulse uppercase tracking-wider">
                        📟 Intercepting Chocolate Datastream...
                      </p>
                    </div>
                  )}
                </div>

                {/* Simulated testing device launcher */}
                <div className={`p-4 rounded-2xl border ${
                  isDark ? "bg-[#141417] border-zinc-800" : "bg-[#FAF6F0] border-[#E8E1D5]"
                }`}>
                  <h4 className="text-xs font-extrabold text-[#7B3F00] mb-2 uppercase tracking-wide flex items-center space-x-1">
                    <span>💡 Tester Instant Chocolate Scanner Simulation</span>
                  </h4>
                  <p className="text-[10px] text-gray-400 mb-3 leading-relaxed">
                    Test the scanner immediately by choosing any companion in the workspace DB below. This simulates holding your phone up to inspect their custom QR Card!
                  </p>
                  
                  <div className="flex space-x-2">
                    <select
                      value={selectedSimUser}
                      onChange={(e) => setSelectedSimUser(e.target.value)}
                      className={`flex-1 rounded-xl text-xs px-3 py-2 border transition focus:outline-none ${
                        isDark 
                          ? "bg-zinc-900 border-zinc-700 text-white" 
                          : "bg-white border-gray-300 text-[#2D1B08]"
                      }`}
                    >
                      {otherUsers.length === 0 ? (
                        <option value="">No other accounts in DB to simulate</option>
                      ) : (
                        otherUsers.map((u) => (
                          <option key={u.uid} value={u.uniqueId}>
                            {u.displayName} ({u.uniqueId})
                          </option>
                        ))
                      )}
                    </select>

                    <button
                      onClick={triggerSimulatedScan}
                      disabled={simulating || otherUsers.length === 0}
                      className="px-4 py-2 bg-[#7B3F00] hover:bg-[#5C2E00] text-white text-xs font-bold rounded-xl transition cursor-pointer disabled:bg-gray-100 disabled:text-gray-400 select-none animate-pulse-slow"
                    >
                      Scan QR Now
                    </button>
                  </div>
                </div>

                <hr className={`border-t ${isDark ? "border-zinc-850" : "border-[#E8E1D5]"}`} />

                {/* Manual text key parser fallback */}
                <div className="space-y-2">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-gray-400">
                    Or Enter Friend's 8-Digit ID Number
                  </div>
                  <div className="flex space-x-2">
                    <input
                      id="friend-direct-code-input"
                      type="text"
                      maxLength={8}
                      placeholder="e.g. 58291048"
                      value={targetIdInput}
                      onChange={(e) => setTargetIdInput(e.target.value)}
                      className={`flex-1 rounded-xl border px-3.5 py-2 text-xs transition focus:outline-none ${
                        isDark 
                          ? "bg-zinc-900 border-zinc-700 text-white placeholder-zinc-500 focus:border-zinc-500" 
                          : "bg-white border-gray-300 text-[#2D1B08] placeholder-gray-400 focus:border-[#7B3F00]"
                      }`}
                    />
                    <button
                      onClick={() => performSearchById(targetIdInput)}
                      className="px-5 text-xs font-bold bg-[#7B3F00] hover:bg-[#5C2E00] text-white rounded-xl transition cursor-pointer select-none"
                    >
                      Verify
                    </button>
                  </div>
                </div>

              </motion.div>
            )}
          </AnimatePresence>

          {/* Validation Feedback Display boxes */}
          <AnimatePresence mode="wait">
            {errorMessage && (
              <motion.div
                key="err-alert"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs text-red-600 bg-red-50 border border-red-200 p-3 rounded-2xl font-bold text-center leading-relaxed"
              >
                ⚠️ {errorMessage}
              </motion.div>
            )}

            {success && (
              <motion.div
                key="ok-alert"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs text-green-700 bg-green-50 border border-green-200 p-3.5 rounded-2xl font-black text-center leading-relaxed shadow-sm"
              >
                🎉 Sweet connection request submitted! Once approved, they will join your list.
              </motion.div>
            )}

            {foundUser && (
              <motion.div
                key="user-found"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`p-4 rounded-2.5xl border flex items-center justify-between shadow-xs ${
                  isDark ? "bg-[#18181b] border-zinc-800" : "bg-[#FAF6F0] border-[#E8E1D5]"
                }`}
              >
                <div className="flex items-center space-x-3.5">
                  <img
                    src={foundUser.photoURL}
                    alt={foundUser.displayName}
                    className="h-11 w-11 rounded-full object-cover ring-2 ring-[#7B3F00]/20 bg-white border"
                  />
                  <div>
                    <h4 className="font-extrabold text-xs">{foundUser.displayName}</h4>
                    <p className={`text-[10px] font-mono leading-none mt-1 ${isDark ? "text-zinc-500" : "text-gray-400"}`}>
                      Choc ID: {foundUser.uniqueId}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleSendInvite}
                  disabled={searching}
                  className="flex items-center space-x-1 px-4 py-2.5 bg-[#7B3F00] hover:bg-[#5C2E00] text-white text-[11px] font-black rounded-xl shadow-xs transition cursor-pointer"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>Link Friend</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
