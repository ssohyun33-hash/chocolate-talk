import React, { useState } from "react";
import { X, Users, Check, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { collection, doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { Friend, UserProfile } from "../types";

interface GroupChatModalProps {
  currentProfile: UserProfile;
  friendsList: Friend[];
  onClose: () => void;
  onGroupCreated: (newChatId: string) => void;
}

export default function GroupChatModal({ currentProfile, friendsList, onClose, onGroupCreated }: GroupChatModalProps) {
  const [groupName, setGroupName] = useState("");
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [errorText, setErrorText] = useState("");

  const toggleSelectFriend = (friendId: string) => {
    setSelectedFriendIds((prev) =>
      prev.includes(friendId) ? prev.filter((id) => id !== friendId) : [...prev, friendId]
    );
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) {
      setErrorText("Please state a group name.");
      return;
    }
    if (selectedFriendIds.length === 0) {
      setErrorText("Select at least one participant.");
      return;
    }

    setCreating(true);
    setErrorText("");

    try {
      const batch = writeBatch(db);
      const newChatId = "grp-" + Math.random().toString(36).substring(2, 11);
      const chatDocRef = doc(db, `chats/${newChatId}`);

      // 1. Write core Group Chat record
      const chatMetadata = {
        id: newChatId,
        name: groupName.trim(),
        isGroup: true,
        hostId: currentProfile.uid,
        createdAt: serverTimestamp(),
        lastMessageText: "Group was created",
        lastMessageTime: serverTimestamp(),
      };
      batch.set(chatDocRef, chatMetadata);

      // 2. Add Host as member under /chats/{chatId}/members/{hostUid}
      const hostMemberRef = doc(db, `chats/${newChatId}/members/${currentProfile.uid}`);
      batch.set(hostMemberRef, {
        userId: currentProfile.uid,
        displayName: currentProfile.displayName,
        photoURL: currentProfile.photoURL,
        role: "host",
        joinedAt: serverTimestamp(),
      });

      // 3. Write joined status for host: /users/{hostUid}/joinedChats/{chatId}
      const hostJoinedRef = doc(db, `users/${currentProfile.uid}/joinedChats/${newChatId}`);
      batch.set(hostJoinedRef, {
        chatId: newChatId,
        isGroup: true,
        displayName: groupName.trim(),
        joinedAt: serverTimestamp(),
      });

      // 4. Add all selected friends as members and create their joinedChats lists
      for (const friendId of selectedFriendIds) {
        const friend = friendsList.find((f) => f.friendId === friendId);
        if (!friend) continue;

        // Write as subcollection member
        const memberRef = doc(db, `chats/${newChatId}/members/${friendId}`);
        batch.set(memberRef, {
          userId: friendId,
          displayName: friend.displayName,
          photoURL: friend.photoURL,
          role: "member",
          joinedAt: serverTimestamp(),
        });

        // Write to user joined-chats index
        const friendJoinedRef = doc(db, `users/${friendId}/joinedChats/${newChatId}`);
        batch.set(friendJoinedRef, {
          chatId: newChatId,
          isGroup: true,
          displayName: groupName.trim(),
          joinedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      onGroupCreated(newChatId);
      onClose();
    } catch (err: any) {
      console.error(err);
      handleFirestoreError(err, OperationType.WRITE, `chats/newGroup`);
      setErrorText("Failed to initialize group chat in database.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-3xs p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white rounded-[2rem] border border-[#E8E1D5] shadow-xl overflow-hidden"
      >
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-[#E8E1D5] bg-white px-6 py-5">
          <div className="flex items-center space-x-2.5">
            <Users className="h-5 w-5 text-[#7B3F00]" />
            <span className="font-sans font-bold text-base text-[#2D1B08] select-none">Create a Group Chat</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-[#F5F1EB] hover:text-gray-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleCreateGroup} className="p-6 flex flex-col space-y-5">
          {/* Group Name form input */}
          <div className="flex flex-col space-y-2">
            <label className="text-xs font-bold text-gray-450 uppercase tracking-wide">
              Group Title / Name
            </label>
            <input
              type="text"
              required
              maxLength={40}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Chocolate Lovers Assembly"
              className="rounded-xl border border-[#E8E1D5] bg-white px-4 py-3 text-sm text-[#2D1B08] outline-none focus:border-[#7B3F00] font-sans shadow-3xs"
            />
          </div>

          {/* Friends Checklist */}
          <div className="flex flex-col space-y-2 flex-1 max-h-56 overflow-y-auto">
            <label className="text-xs font-bold text-gray-450 uppercase tracking-wide">
              Select Friends (Minimum 1)
            </label>
            {friendsList.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-[#E8E1D5] bg-[#FDFBF7] rounded-xl text-xs font-medium text-gray-400">
                You have no friends on your list yet. Add them first by ID!
              </div>
            ) : (
              <div className="space-y-1 bg-white border border-[#E8E1D5] rounded-xl p-2 max-h-48 overflow-y-auto">
                {friendsList.map((friend) => {
                  const isSelected = selectedFriendIds.includes(friend.friendId);
                  return (
                    <button
                      key={friend.friendId}
                      type="button"
                      onClick={() => toggleSelectFriend(friend.friendId)}
                      className={`flex w-full items-center justify-between rounded-lg p-2 transition outline-none ${
                        isSelected ? "bg-[#F5F1EB]" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center space-x-2.5">
                        <img
                          src={friend.photoURL}
                          referrerPolicy="no-referrer"
                          alt={friend.displayName}
                          className="h-8 w-8 rounded-lg object-cover border border-[#E8E1D5] bg-white"
                        />
                        <div className="text-left">
                          <span className="block font-sans font-bold text-xs text-[#2D1B08]">
                            {friend.displayName}
                          </span>
                          <span className="block font-mono text-[9px] text-[#7B3F00] font-semibold">
                            ID: {friend.uniqueId}
                          </span>
                        </div>
                      </div>

                      {/* Check indicator circle */}
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                          isSelected
                            ? "bg-[#7B3F00] border-[#7B3F00] text-white"
                            : "border-gray-300 bg-white text-transparent"
                        }`}
                      >
                        <Check className="h-3 w-3 stroke-[3]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {errorText && (
            <div className="flex items-start space-x-2 bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs font-medium">
              <AlertCircle className="h-4.5 w-4.5 text-red-600 shrink-0" />
              <span>{errorText}</span>
            </div>
          )}

          {/* Submittals buttons row */}
          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[#E8E1D5] py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !groupName.trim() || selectedFriendIds.length === 0}
              className="flex-1 rounded-xl bg-[#7B3F00] py-3 text-sm font-semibold text-white shadow-md hover:bg-[#5C2E00] disabled:bg-gray-100 disabled:text-gray-400 transition"
            >
              {creating ? "Launching group..." : "Launch Group"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
