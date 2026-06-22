import React, { useState } from "react";
import { X, Users, Check, AlertCircle, Search, Sparkles, UserPlus } from "lucide-react";
import { motion } from "motion/react";
import { collection, doc, writeBatch, serverTimestamp, query, where, getDocs } from "firebase/firestore";
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
  const [customParticipants, setCustomParticipants] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Search input state (handles single queries or comma-separated tokens like j@gmail.com, g@gmail.com, or 8-digit IDs)
  const [inviteInput, setInviteInput] = useState("");
  const [searchingUser, setSearchingUser] = useState(false);

  const toggleSelectFriend = (friendId: string) => {
    setSelectedFriendIds((prev) =>
      prev.includes(friendId) ? prev.filter((id) => id !== friendId) : [...prev, friendId]
    );
  };

  const handleSearchAndAdd = async () => {
    const rawVal = inviteInput.trim();
    if (!rawVal) return;

    setSearchingUser(true);
    setErrorText("");
    setSuccessMsg("");

    // Split input tokens by commas to handle multi-entry cases like "j@gmail.com, g@gmail.com"
    const tokens = rawVal.split(",").map((s) => s.trim()).filter(Boolean);
    let addedCount = 0;
    let ignoredCount = 0;

    try {
      const usersCol = collection(db, "users");

      for (const token of tokens) {
        // Skip current user
        if (token === currentProfile.email || token === currentProfile.uniqueId || token === currentProfile.uid) {
          ignoredCount++;
          continue;
        }

        // Check if already in standard friendsList
        const friendMatch = friendsList.find(
          (f) => f.uniqueId === token || f.displayName.toLowerCase() === token.toLowerCase() || f.friendId === token
        );

        if (friendMatch) {
          if (!selectedFriendIds.includes(friendMatch.friendId)) {
            setSelectedFriendIds((prev) => [...prev, friendMatch.friendId]);
          }
          addedCount++;
          continue;
        }

        // Check if already in customParticipants
        const customMatch = customParticipants.find(
          (p) => p.uniqueId === token || p.email === token || p.uid === token
        );

        if (customMatch) {
          if (!selectedFriendIds.includes(customMatch.uid)) {
            setSelectedFriendIds((prev) => [...prev, customMatch.uid]);
          }
          addedCount++;
          continue;
        }

        // Otherwise query database by email OR uniqueId (as string/number)
        let foundProfile: any = null;

        if (token.includes("@")) {
          // Query by Email
          const q = query(usersCol, where("email", "==", token));
          const snap = await getDocs(q);
          if (!snap.empty) {
            foundProfile = snap.docs[0].data();
          }
        } else {
          // Query by Unique ID
          const q1 = query(usersCol, where("uniqueId", "==", token));
          const snap1 = await getDocs(q1);
          if (!snap1.empty) {
            foundProfile = snap1.docs[0].data();
          } else {
            const q2 = query(usersCol, where("uniqueId", "==", Number(token)));
            const snap2 = await getDocs(q2);
            if (!snap2.empty) {
              foundProfile = snap2.docs[0].data();
            }
          }
        }

        if (foundProfile) {
          setCustomParticipants((prev) => {
            if (prev.some((p) => p.uid === foundProfile.uid)) return prev;
            return [...prev, foundProfile];
          });
          setSelectedFriendIds((prev) => {
            if (prev.includes(foundProfile.uid)) return prev;
            return [...prev, foundProfile.uid];
          });
          addedCount++;
        } else {
          ignoredCount++;
        }
      }

      if (addedCount > 0) {
        setSuccessMsg(`Successfully found and added ${addedCount} user(s) to the group selection!`);
        setInviteInput("");
      } else {
        setErrorText("No users found matching that ID or email.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorText("Error lookup manual invites: " + err.message);
    } finally {
      setSearchingUser(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) {
      setErrorText("Please state a group name.");
      return;
    }
    if (selectedFriendIds.length === 0) {
      setErrorText("Select or enter at least one participant.");
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

      // 4. Add all selected custom + standard participants
      for (const participantId of selectedFriendIds) {
        // Try to locate in standard friends
        const friend = friendsList.find((f) => f.friendId === participantId);
        // Try to locate in dynamically lookup custom list
        const customPart = customParticipants.find((p) => p.uid === participantId);

        if (!friend && !customPart) continue;

        const displayName = friend ? friend.displayName : customPart.displayName || "Unknown ChocTalker";
        const photoURL = friend ? friend.photoURL : customPart.photoURL || "";

        // Write as subcollection member
        const memberRef = doc(db, `chats/${newChatId}/members/${participantId}`);
        batch.set(memberRef, {
          userId: participantId,
          displayName,
          photoURL,
          role: "member",
          joinedAt: serverTimestamp(),
        });

        // Write to user joined-chats index
        const friendJoinedRef = doc(db, `users/${participantId}/joinedChats/${newChatId}`);
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

  // Combine lists of friends and custom participants for unified rendering
  const unifiedList = [
    ...friendsList.map((f) => ({ ...f, uid: f.friendId, isFriend: true })),
    ...customParticipants.map((p) => ({ ...p, isFriend: false })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-3xs p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white rounded-[2rem] border border-[#E8E1D5] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-[#E8E1D5] bg-[#FAF6F0] px-6 py-4.5 shrink-0">
          <div className="flex items-center space-x-2.5">
            <Users className="h-5 w-5 text-[#7B3F00]" />
            <span className="font-sans font-extrabold text-[#2D1B08] text-sm sm:text-base select-none">Create a Group Chat</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-[#F5F1EB] hover:text-gray-600 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Container Form */}
        <form onSubmit={handleCreateGroup} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Group Name form input */}
          <div className="flex flex-col space-y-1.5">
            <label className="text-[10px] font-bold text-gray-450 uppercase tracking-widest leading-none">
              Group Name / Title
            </label>
            <input
              type="text"
              required
              maxLength={40}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Chocolate Lovers Assembly"
              className="rounded-xl border border-[#E8E1D5] bg-[#FAF8F4]/40 px-4 py-2.5 text-xs sm:text-sm text-[#2D1B08] outline-none focus:border-[#7B3F00] font-sans shadow-3xs transition"
            />
          </div>

          {/* Search Up & Multi-Invite Field with Comma handling */}
          <div className="flex flex-col space-y-1.5">
            <label className="text-[10px] font-bold text-gray-450 uppercase tracking-widest leading-none">
              Search & Add Unrecognized Members
            </label>
            <span className="text-[9px] text-gray-400 leading-normal">
              Type standard emails or 8-digit IDs, separated by commas (e.g. <b>j@gmail.com, 52093849</b>) to find people not currently in your friends list! Their profile avatar will showed <b>"?"</b> in Group.
            </span>
            <div className="flex space-x-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  placeholder="e.g. a@gmail.com, 84920485"
                  className="w-full rounded-xl border border-[#E8E1D5] bg-white pl-9 pr-4 py-2 text-xs text-[#2D1B08] outline-none focus:border-[#7B3F00] font-sans transition"
                />
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              </div>
              <button
                type="button"
                onClick={handleSearchAndAdd}
                disabled={searchingUser || !inviteInput.trim()}
                className="px-4 bg-[#7B3F00] hover:bg-[#5C2E00] text-white text-xs font-bold rounded-xl transition disabled:bg-gray-100 disabled:text-gray-400 cursor-pointer flex items-center space-x-1.5"
              >
                <span>Add</span>
              </button>
            </div>
            {successMsg && (
              <p className="text-[10px] text-green-600 font-bold leading-none">{successMsg}</p>
            )}
          </div>

          {/* Combined Selection Checklist */}
          <div className="flex flex-col space-y-2">
            <label className="text-[10px] font-bold text-gray-450 uppercase tracking-widest leading-none">
              Participants List ({selectedFriendIds.length} chosen)
            </label>
            {unifiedList.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-[#E8E1D5] bg-[#FAF8F4]/40 rounded-2xl text-xs font-semibold text-gray-400">
                List is blank. Add companions above!
              </div>
            ) : (
              <div className="space-y-1 bg-[#FAF6F0]/30 border border-[#E8E1D5] rounded-2xl p-2 max-h-48 overflow-y-auto">
                {unifiedList.map((participant) => {
                  const isSelected = selectedFriendIds.includes(participant.uid);
                  return (
                    <button
                      key={participant.uid}
                      type="button"
                      onClick={() => toggleSelectFriend(participant.uid)}
                      className={`flex w-full items-center justify-between rounded-xl p-2.5 transition outline-none ${
                        isSelected ? "bg-[#FAF1E4] border border-[#7B3F00]/20" : "hover:bg-[#FAF8F4] border border-transparent"
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        {participant.isFriend ? (
                          <img
                            src={participant.photoURL}
                            referrerPolicy="no-referrer"
                            alt={participant.displayName}
                            className="h-8 w-8 rounded-full object-cover border border-[#E8E1D5] bg-white"
                          />
                        ) : (
                          // If they are unrecognized/foreigner: "their profile will be showned '?'"
                          <div className="h-8 w-8 rounded-full flex items-center justify-center font-bold font-sans text-sm border bg-[#FAF6F0] border-[#E8E1D5] text-[#7B3F00] shrink-0" title="Unrecognized User">
                            ?
                          </div>
                        )}
                        <div className="text-left">
                          <span className="block font-sans font-extrabold text-xs text-[#2D1B08]">
                            {participant.displayName}
                            {!participant.isFriend && (
                              <span className="ml-1.5 text-[9px] bg-amber-500/25 text-[#7B3F00] px-1.5 py-0.5 rounded-full font-sans font-bold select-none">
                                ? stranger
                              </span>
                            )}
                          </span>
                          <span className="block font-mono text-[9px] text-gray-405 leading-none mt-0.5">
                            ID: {participant.uniqueId}
                          </span>
                        </div>
                      </div>

                      {/* Check indicator circle */}
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded-full border transition shrink-0 ${
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
            <div className="flex items-start space-x-2 bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs font-medium shrink-0">
              <AlertCircle className="h-4.5 w-4.5 text-red-600 shrink-0" />
              <span>{errorText}</span>
            </div>
          )}

          {/* Submittals buttons row */}
          <div className="flex space-x-3 pt-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[#E8E1D5] py-2.5 text-xs sm:text-sm font-semibold text-gray-500 hover:bg-gray-50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !groupName.trim() || selectedFriendIds.length === 0}
              className="flex-1 rounded-xl bg-[#7B3F00] hover:bg-[#5C2E00] py-2.5 text-xs sm:text-sm font-semibold text-white shadow-md disabled:bg-gray-100 disabled:text-gray-400 transition cursor-pointer"
            >
              {creating ? "Launching group..." : "Launch Group"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
