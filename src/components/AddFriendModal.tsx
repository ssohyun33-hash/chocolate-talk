import React, { useState } from "react";
import { X, Search, Camera, UserPlus, MessageSquare, AlertCircle, RefreshCw, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { collection, query, where, getDocs, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { UserProfile } from "../types";
import Scanner from "./Scanner";

interface AddFriendModalProps {
  currentUserId: string;
  onClose: () => void;
  onFriendAdded: () => void;
}

export default function AddFriendModal({ currentUserId, onClose, onFriendAdded }: AddFriendModalProps) {
  const [targetId, setTargetId] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<UserProfile | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSearch = async (codeToSearch?: string) => {
    const idToQuery = codeToSearch || targetId.trim();
    if (!/^\d{8}$/.test(idToQuery)) {
      setErrorMessage("ID must be exactly an 8-digit number.");
      return;
    }

    setSearching(true);
    setErrorMessage("");
    setFoundUser(null);
    setSuccess(false);

    try {
      const q = query(collection(db, "users"), where("uniqueId", "==", idToQuery));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setErrorMessage("No user found with this chocolate ID.");
      } else {
        const docData = querySnapshot.docs[0].data();
        if (docData.uid === currentUserId) {
          setErrorMessage("That is you! Try scanning a friend's ID.");
        } else {
          setFoundUser({
            uid: docData.uid,
            displayName: docData.displayName,
            photoURL: docData.photoURL,
            uniqueId: docData.uniqueId,
            createdAt: docData.createdAt,
          });
        }
      }
    } catch (err) {
      console.error(err);
      setErrorMessage("Failed to search. Check configuration.");
    } finally {
      setSearching(false);
    }
  };

  const handleAddFriend = async () => {
    if (!foundUser) return;
    setSearching(true);
    setErrorMessage("");

    try {
      // 1. Persist as real friend in Firestore subcollection /users/{myUid}/friends/{friendUid}
      const refPath = `users/${currentUserId}/friends/${foundUser.uid}`;
      await setDoc(doc(db, refPath), {
        friendId: foundUser.uid,
        displayName: foundUser.displayName,
        photoURL: foundUser.photoURL,
        uniqueId: foundUser.uniqueId,
        addedAt: serverTimestamp(),
      });

      // 2. Also automatically try to add a symmetric friend record so they instantly see each other (optional but amazing user experience!)
      try {
        await setDoc(doc(db, `users/${foundUser.uid}/friends/${currentUserId}`), {
          friendId: currentUserId,
          displayName: "Friend back", // Fallback name, will show actual when profile gets read by them
          photoURL: foundUser.photoURL, // we will fill from cached values
          uniqueId: "", // we will fill as needed, but standard friend add works instantly
          addedAt: serverTimestamp(),
        });
      } catch (e) {
        // Safe to ignore if security rules block writing friend to others' accounts directly
        console.warn("Symmetric friend write skipped, standard local friend-add successful.");
      }

      setSuccess(true);
      onFriendAdded();
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.WRITE, `users/${currentUserId}/friends/${foundUser.uid}`);
      setErrorMessage("Failed to add friend to your profile.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-3xs p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-xl border border-[#E8E1D5]"
      >
        {/* Header toolbar */}
        <div className="flex items-center justify-between border-b border-[#E8E1D5] bg-white px-6 py-5">
          <span className="font-sans font-bold text-base text-[#2D1B08] select-none">Add Friend by Chocolate ID</span>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-[#F5F1EB] hover:text-gray-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Section */}
        <div className="p-6 flex flex-col space-y-5">
          {/* Option 1: Search panel */}
          <div className="flex flex-col space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">
              Type 8-digit User ID
            </label>
            <div className="flex space-x-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  maxLength={8}
                  placeholder="e.g. 52938402"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="w-full rounded-xl border border-[#E8E1D5] bg-white pl-9.5 pr-3 py-2.5 text-sm text-[#2D1B08] focus:border-[#7B3F00] focus:outline-none font-mono tracking-widest"
                />
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              </div>
              <button
                onClick={() => handleSearch()}
                disabled={searching || targetId.length !== 8}
                className="rounded-xl bg-[#7B3F00] px-5 text-sm font-semibold text-white hover:bg-[#5C2E00] disabled:bg-gray-100 disabled:text-gray-400 transition shrink-0"
              >
                {searching ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Search"}
              </button>
            </div>
          </div>

          {/* Sparkles separation partition */}
          <div className="flex items-center">
            <div className="flex-1 h-[1px] bg-[#E8E1D5]" />
            <span className="px-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Or Instant Snapshot
            </span>
            <div className="flex-1 h-[1px] bg-[#E8E1D5]" />
          </div>

          {/* Button trigger scanner camera */}
          <button
            onClick={() => setShowScanner(true)}
            className="flex w-full items-center justify-center space-x-2.5 rounded-xl border border-dashed border-[#E8E1D5] bg-[#FDFBF7] hover:bg-[#F5F1EB] py-3 text-sm font-bold text-[#7B3F00] transition"
          >
            <Camera className="h-5 w-5 text-[#7B3F00]" />
            <span>Scan unchangeable ID with Camera</span>
          </button>

          {/* Results Panel */}
          <AnimatePresence mode="wait">
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start space-x-2.5 bg-red-50 border border-red-200 p-3.5 rounded-xl text-red-700 text-xs"
              >
                <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
                <span>{errorMessage}</span>
              </motion.div>
            )}

            {foundUser && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center justify-between rounded-xl bg-[#FDFBF7] p-4 border border-[#E8E1D5]"
              >
                <div className="flex items-center space-x-3.5">
                  <img
                    src={foundUser.photoURL}
                    alt={foundUser.displayName}
                    referrerPolicy="no-referrer"
                    className="h-12 w-12 rounded-lg object-cover border border-[#E8E1D5] bg-white"
                  />
                  <div>
                    <span className="block font-sans font-bold text-[#2D1B08] text-sm">
                      {foundUser.displayName}
                    </span>
                    <span className="block font-mono text-[10px] text-[#7B3F00] font-semibold">
                      ID: {foundUser.uniqueId}
                    </span>
                  </div>
                </div>

                {!success ? (
                  <button
                    onClick={handleAddFriend}
                    disabled={searching}
                    className="flex items-center space-x-1.5 rounded-lg bg-[#7B3F00] hover:bg-[#5C2E00] text-white px-4 py-2 text-xs font-bold shadow-xs transition"
                  >
                    <UserPlus className="h-4 w-4" />
                    <span>Add Friend</span>
                  </button>
                ) : (
                  <div className="flex items-center space-x-1 border border-green-200 bg-green-50 text-green-700 rounded-lg px-4 py-2 text-xs font-bold font-sans">
                    <Check className="h-4 w-4" />
                    <span>Friend Added!</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Embedded Scanner */}
      <AnimatePresence>
        {showScanner && (
          <Scanner
            onScanSuccess={(scanned) => {
              setTargetId(scanned);
              setShowScanner(false);
              handleSearch(scanned);
            }}
            onClose={() => setShowScanner(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
