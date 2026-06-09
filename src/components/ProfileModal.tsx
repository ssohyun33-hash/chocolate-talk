import React, { useState } from "react";
import { User, X, Camera, Check, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { UserProfile } from "../types";

interface ProfileModalProps {
  profile: UserProfile;
  onSave: (displayName: string, photoURL: string) => Promise<void>;
  onClose: () => void;
}

// Preset gorgeous chocolate-themed avatars for quick selection
const PRESET_AVATARS = [
  "https://images.unsplash.com/photo-1511381939415-e44015466834?w=150&auto=format&fit=crop", // Dark chocolate bar
  "https://images.unsplash.com/photo-1606312440539-76884b404475?w=150&auto=format&fit=crop", // Truffle
  "https://images.unsplash.com/photo-1548907040-4d42b52115ca?w=150&auto=format&fit=crop", // Caramel bar
  "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?w=150&auto=format&fit=crop", // Sweet cup cake
];

export default function ProfileModal({ profile, onSave, onClose }: ProfileModalProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [photoURL, setPhotoURL] = useState(profile.photoURL || PRESET_AVATARS[0]);
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState("");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setImageError("Image size must be smaller than 2MB.");
      return;
    }

    setImageError("");
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = document.createElement("img");
      img.src = event.target?.result as string;
      img.onload = () => {
        // Create downscaled canvas representation
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 120;
        const MAX_HEIGHT = 120;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);

        const downsampledBase64 = canvas.toDataURL("image/jpeg", 0.7);
        setPhotoURL(downsampledBase64);
      };
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await onSave(displayName.trim(), photoURL);
      onClose();
    } catch (err: any) {
      console.error(err);
      setImageError("Failed to update profile values.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-3xs p-4">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-[2rem] border border-[#E8E1D5] shadow-xl overflow-hidden"
      >
        {/* Title header bar */}
        <div className="flex items-center justify-between border-b border-[#E8E1D5] bg-white px-6 py-5">
          <span className="font-sans font-bold text-base text-[#2D1B08] select-none">My Profile Settings</span>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-[#F5F1EB] hover:text-gray-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 flex flex-col space-y-5">
          {/* Avatar view section */}
          <div className="flex flex-col items-center space-y-4">
            <div className="relative group">
              <img
                src={photoURL}
                alt="Profile Avatar"
                referrerPolicy="no-referrer"
                className="h-24 w-24 rounded-full object-cover border border-[#E8E1D5] shadow-sm bg-white text-center"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = PRESET_AVATARS[0];
                }}
              />
              <label className="absolute bottom-0 right-0 p-2 bg-[#7B3F00] hover:bg-[#5C2E00] rounded-full text-white border border-white cursor-pointer shadow-md">
                <Camera className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Unique and unchangeable custom user token identification */}
            <div className="flex flex-col items-center bg-[#F5F1EB] px-4 py-2 rounded-xl border border-[#E8E1D5]">
              <span className="text-[9px] uppercase font-bold tracking-widest text-gray-400 mb-0.5">
                My Unchangeable ID
              </span>
              <span className="font-mono text-sm font-bold text-[#7B3F00] tracking-widest select-all">
                {profile.uniqueId}
              </span>
            </div>
          </div>

          {/* Preset Picker choices section */}
          <div>
            <span className="block text-xs font-semibold text-gray-400 mb-2">
              Select Chocolate Avatar Preset:
            </span>
            <div className="flex justify-center space-x-3.5">
              {PRESET_AVATARS.map((url, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setImageError("");
                    setPhotoURL(url);
                  }}
                  className={`relative rounded-full h-11 w-11 overflow-hidden border transition ${
                    photoURL === url ? "border-[#7B3F00] scale-105 ring-2 ring-[#7B3F00]/20" : "border-neutral-200 grayscale-30"
                  }`}
                >
                  <img src={url} className="h-full w-full object-cover" alt="Preset choice" />
                  {photoURL === url && (
                    <div className="absolute inset-0 bg-[#7B3F00]/40 flex items-center justify-center">
                      <Check className="h-4 w-4 text-white stroke-[3]" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Form input fields */}
          <div className="flex flex-col space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">
              Display Name
            </label>
            <input
              type="text"
              required
              maxLength={40}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Choc Lover"
              className="rounded-xl border border-[#E8E1D5] bg-white px-4 py-2.5 text-sm text-[#2D1B08] outline-none focus:border-[#7B3F00] focus:ring-1 focus:ring-[#7B3F00]/10 shadow-3xs"
            />
          </div>

          {imageError && (
            <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200 text-center font-medium">
              {imageError}
            </div>
          )}

          {/* Action buttons footer */}
          <div className="pt-2 flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[#E8E1D5] py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !displayName.trim()}
              className="flex-1 rounded-xl bg-[#7B3F00] py-3 text-sm font-semibold text-white shadow-md hover:bg-[#5C2E00] disabled:bg-gray-100 disabled:text-gray-600 transition"
            >
              {saving ? "Saving changes..." : "Save Profile"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
