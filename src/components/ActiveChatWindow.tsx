import React, { useState, useEffect, useRef } from "react";
import { 
  Send, Image, Users, Trash2, LogOut, UserMinus, UserPlus, 
  Check, CheckCheck, Smile, Settings, X, Plus, BellRing, AlertTriangle, ShieldAlert
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  collection, query, orderBy, onSnapshot, addDoc, 
  updateDoc, doc, deleteDoc, writeBatch, serverTimestamp, getDocs, setDoc
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { Chat, ChatMember, ChatMessage, UserProfile, Friend } from "../types";

interface ActiveChatWindowProps {
  chatId: string;
  currentProfile: UserProfile;
  friendsList: Friend[];
  onChatDeletedOrLeft: () => void;
  theme?: "white" | "black";
}

export default function ActiveChatWindow({ 
  chatId, 
  currentProfile, 
  friendsList, 
  onChatDeletedOrLeft,
  theme = "white"
}: ActiveChatWindowProps) {
  const isDark = theme === "black";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [chatMeta, setChatMeta] = useState<Chat | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showInviteDrawer, setShowInviteDrawer] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // User Reporting state
  const [reportTarget, setReportTarget] = useState<ChatMember | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  // Blocked users subscription lists
  const [blockedUids, setBlockedUids] = useState<string[]>([]);

  useEffect(() => {
    const blocksRef = collection(db, "users", currentProfile.uid, "blocks");
    const unsubscribeBlocks = onSnapshot(blocksRef, (snap) => {
      const uids: string[] = [];
      snap.forEach((docSnap) => {
        uids.push(docSnap.id);
      });
      setBlockedUids(uids);
    }, (error) => {
      console.warn("Blocked subcollection skipped:", error);
    });
    return () => unsubscribeBlocks();
  }, [currentProfile.uid]);

  // Determine counterparty and checking statuses
  const otherMember = chatMeta && !chatMeta.isGroup 
    ? members.find((m) => m.userId !== currentProfile.uid) 
    : null;

  const isFriend = otherMember 
    ? friendsList.some((f) => f.friendId === otherMember.userId) 
    : true;

  const isBlocked = otherMember 
    ? blockedUids.includes(otherMember.userId) 
    : false;

  const handleAddFriendFromBanner = async () => {
    if (!otherMember) return;
    try {
      const batch = writeBatch(db);
      
      // 1. Add to current user's friends subcollection
      const myFriendDoc = doc(db, "users", currentProfile.uid, "friends", otherMember.userId);
      batch.set(myFriendDoc, {
        friendId: otherMember.userId,
        displayName: otherMember.displayName,
        photoURL: otherMember.photoURL,
        uniqueId: "", 
        addedAt: serverTimestamp()
      });

      // 2. Symmetrically write to their friends list so they are immediately mutually linked
      const theirFriendDoc = doc(db, "users", otherMember.userId, "friends", currentProfile.uid);
      batch.set(theirFriendDoc, {
        friendId: currentProfile.uid,
        displayName: currentProfile.displayName,
        photoURL: currentProfile.photoURL,
        uniqueId: currentProfile.uniqueId || "",
        addedAt: serverTimestamp()
      });

      await batch.commit();
    } catch (err) {
      console.error("Error adding friend from banner: ", err);
    }
  };

  const handleBlockUserFromBanner = async () => {
    if (!otherMember) return;
    try {
      const blockRef = doc(db, "users", currentProfile.uid, "blocks", otherMember.userId);
      await setDoc(blockRef, {
        blocked: true,
        blockedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error blocking user: ", err);
    }
  };

  const handleUnblockUserFromBanner = async () => {
    if (!otherMember) return;
    try {
      const blockRef = doc(db, "users", currentProfile.uid, "blocks", otherMember.userId);
      await deleteDoc(blockRef);
    } catch (err) {
      console.error("Error unblocking user: ", err);
    }
  };

  // 1. Subscribe to Chat Metadata
  useEffect(() => {
    const chatRef = doc(db, "chats", chatId);
    const unsubscribeMeta = onSnapshot(chatRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setChatMeta({
          id: snap.id,
          name: data.name,
          isGroup: data.isGroup,
          hostId: data.hostId,
          createdAt: data.createdAt,
          lastMessageText: data.lastMessageText,
        });
      }
    }, (error) => {
      console.warn("Active Chat unmounted/missing:", error);
    });

    return () => unsubscribeMeta();
  }, [chatId]);

  // 2. Subscribe to Members list
  useEffect(() => {
    const listRef = collection(db, "chats", chatId, "members");
    const unsubscribeMembers = onSnapshot(listRef, (snap) => {
      const list: ChatMember[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          userId: d.userId,
          displayName: d.displayName,
          photoURL: d.photoURL,
          role: d.role,
          joinedAt: d.joinedAt,
        });
      });
      setMembers(list);
    }, (error) => {
       console.warn("Err reading members subcollection: ", error);
    });

    return () => unsubscribeMembers();
  }, [chatId]);

  // 3. Subscribe to Real-Time messages & Handle Read Confirmation Markups
  useEffect(() => {
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"));

    const unsubscribeMessages = onSnapshot(q, (snap) => {
      const msgsList: ChatMessage[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        msgsList.push({
          id: docSnap.id,
          senderId: d.senderId,
          senderName: d.senderName,
          senderPhoto: d.senderPhoto,
          text: d.text,
          photoUrl: d.photoUrl,
          createdAt: d.createdAt,
          readBy: d.readBy || [],
        });
      });
      setMessages(msgsList);

      // Trigger standard local Notification when window is passive and document hidden
      if (document.hidden && msgsList.length > 0) {
        const newest = msgsList[msgsList.length - 1];
        if (newest.senderId !== currentProfile.uid) {
          if (Notification.permission === "granted") {
            newest.photoUrl ? new Notification(`Chocolate Talk: Photo`, { body: `${newest.senderName} sent a photo.` }): new Notification(`Chocolate Talk: ${newest.senderName}`, { body: newest.text });
          }
        }
      }

      // Automatically sync our ReadReceipt indicator
      snap.docs.forEach((docSnap) => {
        const d = docSnap.data();
        const readArray = d.readBy || [];
        if (!readArray.includes(currentProfile.uid)) {
          const freshArray = [...readArray, currentProfile.uid];
          updateDoc(docSnap.ref, { readBy: freshArray }).catch((err) => {
            console.warn("Soft update read confirmation skipped.", err);
          });
        }
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `chats/${chatId}/messages`);
    });

    return () => unsubscribeMessages();
  }, [chatId, currentProfile.uid]);

  // Scroll to bottom helper
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 4. Send generic Text Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanText = inputText.trim();
    if (!cleanText || sending) return;

    setSending(true);
    setInputText("");

    try {
      const messagesRef = collection(db, "chats", chatId, "messages");
      const subDocId = "msg-" + Math.random().toString(36).substring(2, 11);
      
      const payload = {
        id: subDocId,
        senderId: currentProfile.uid,
        senderName: currentProfile.displayName,
        senderPhoto: currentProfile.photoURL,
        text: cleanText,
        createdAt: serverTimestamp(),
        readBy: [currentProfile.uid],
      };

      await addDoc(messagesRef, payload);

      // Update parent metadata block for listing sidebar refresh
      const parentChatRef = doc(db, "chats", chatId);
      await updateDoc(parentChatRef, {
        lastMessageText: cleanText,
        lastMessageTime: serverTimestamp(),
      });
    } catch (err: any) {
      console.error(err);
      handleFirestoreError(err, OperationType.CREATE, `chats/${chatId}/messages`);
    } finally {
      setSending(false);
    }
  };

  // 5. Downscale Photo file and send immediately
  const handleSendPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = document.createElement("img");
      img.src = event.target?.result as string;
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const MAX_DIM = 400; // Efficient size for instant Base64 synchronization
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_DIM) {
            height *= MAX_DIM / width;
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width *= MAX_DIM / height;
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Compact JPEG string to store safely on the fast Firestore free limits!
        const base64JPEG = canvas.toDataURL("image/jpeg", 0.6);

        try {
          const messagesRef = collection(db, "chats", chatId, "messages");
          const subDocId = "msg-photo-" + Math.random().toString(36).substring(2, 11);

          await addDoc(messagesRef, {
            id: subDocId,
            senderId: currentProfile.uid,
            senderName: currentProfile.displayName,
            senderPhoto: currentProfile.photoURL,
            text: "📷 Sent a photo",
            photoUrl: base64JPEG,
            createdAt: serverTimestamp(),
            readBy: [currentProfile.uid],
          });

          await updateDoc(doc(db, "chats", chatId), {
            lastMessageText: "📷 Sent a photo",
            lastMessageTime: serverTimestamp(),
          });
        } catch (err) {
          console.error("Failed sending downscaled base64 image:", err);
        }
      };
    };
    reader.readAsDataURL(file);
  };

  // 6. Invite new Friends into current Group
  const handleInviteFriend = async (friend: Friend) => {
    try {
      const batch = writeBatch(db);

      // Add as subcollection member
      const memberRef = doc(db, `chats/${chatId}/members/${friend.friendId}`);
      batch.set(memberRef, {
        userId: friend.friendId,
        displayName: friend.displayName,
        photoURL: friend.photoURL,
        role: "member",
        joinedAt: serverTimestamp(),
      });

      // Write to friend joined-chats list
      const friendJoinedRef = doc(db, `users/${friend.friendId}/joinedChats/${chatId}`);
      batch.set(friendJoinedRef, {
        chatId: chatId,
        isGroup: true,
        displayName: chatMeta?.name || "Group Chat",
        joinedAt: serverTimestamp(),
      });

      await batch.commit();
      setShowInviteDrawer(false);
    } catch (err) {
      console.error(err);
    }
  };

  // 7. Kick a member (Only possible for Chat Host)
  const handleKickMember = async (targetUserId: string) => {
    if (chatMeta?.hostId !== currentProfile.uid) return;
    try {
      const batch = writeBatch(db);
      
      // Delete member registry record
      batch.delete(doc(db, `chats/${chatId}/members/${targetUserId}`));
      // Delete member index record
      batch.delete(doc(db, `users/${targetUserId}/joinedChats/${chatId}`));

      await batch.commit();
    } catch (err) {
      console.error("Failed to kick participant:", err);
    }
  };

  // 8. Leave Group voluntarily
  const handleLeaveGroup = async () => {
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, `chats/${chatId}/members/${currentProfile.uid}`));
      batch.delete(doc(db, `users/${currentProfile.uid}/joinedChats/${chatId}`));

      await batch.commit();
      onChatDeletedOrLeft();
    } catch (err) {
      console.error(err);
    }
  };

  // 9. Terminate / Delete entire Chat and members (Only possible for Host)
  const handleDeleteChat = async () => {
    if (chatMeta?.hostId !== currentProfile.uid) return;
    try {
      // 1. Fetch all members first to clean their metadata keys
      const membersQuery = await getDocs(collection(db, "chats", chatId, "members"));
      const batch = writeBatch(db);

      membersQuery.forEach((docSnap) => {
        const uid = docSnap.id;
        batch.delete(doc(db, `users/${uid}/joinedChats/${chatId}`));
        batch.delete(docSnap.ref);
      });

      // 2. Delete the actual Chat Document
      batch.delete(doc(db, `chats/${chatId}`));
      await batch.commit();

      onChatDeletedOrLeft();
    } catch (err) {
      console.error(err);
    }
  };

  const handleReportUser = (member: ChatMember) => {
    setReportTarget(member);
    setReportReason("");
    setReportSuccess(false);
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportTarget || !reportReason.trim() || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      const reportsRef = collection(db, "reports");
      const repId = "rep-" + Math.random().toString(36).substring(2, 11);
      await addDoc(reportsRef, {
        id: repId,
        reporterId: currentProfile.uid,
        reporterName: currentProfile.displayName,
        reportedUid: reportTarget.userId,
        reportedName: reportTarget.displayName,
        reportedPhoto: reportTarget.photoURL,
        reason: reportReason.trim(),
        timestamp: serverTimestamp()
      });
      setReportSuccess(true);
    } catch (err) {
      console.error("Failed to submit member report: ", err);
    } finally {
      setReportSubmitting(false);
    }
  };

  const isHost = chatMeta?.hostId === currentProfile.uid;
  const isGroup = chatMeta?.isGroup;

  // Render a clean title name depending on direct message or group
  const getChatDisplayName = () => {
    if (!chatMeta) return "...";
    if (chatMeta.isGroup) return chatMeta.name;
    // For direct message, show counter-party name
    const counterParty = members.find((m) => m.userId !== currentProfile.uid);
    return counterParty ? counterParty.displayName : "Direct Message";
  };

  // Calculate invite candidates (all friends not already in this group)
  const inviteCandidates = friendsList.filter(
    (f) => !members.some((m) => m.userId === f.friendId)
  );

  return (
    <div className={`flex flex-1 flex-col overflow-hidden h-full transition-colors duration-200 ${
      isDark ? "bg-[#09090b] text-white" : "bg-white text-[#2D1B08]"
    }`}>
      {/* Top Banner Control bar */}
      <div className={`flex h-20 items-center justify-between border-b px-8 transition-colors duration-200 ${
        isDark ? "border-zinc-800 bg-[#0c0c0e]" : "border-[#E8E1D5] bg-white"
      }`}>
        <div className="flex items-center space-x-4">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold font-sans border ${
            isDark ? "bg-zinc-900 border-zinc-750 text-white" : "bg-[#F5F1EB] border-[#E8E1D5] text-[#7B3F00]"
          }`}>
            {isGroup ? (
              <Users className={`h-5 w-5 ${isDark ? "text-white" : "text-[#7B3F00]"}`} />
            ) : (
              members.find((m) => m.userId !== currentProfile.uid)?.displayName[0] || "@"
            )}
          </div>
          <div>
            <h3 className={`text-sm font-bold font-sans tracking-tight ${
              isDark ? "text-zinc-100" : "text-gray-800"
            }`}>{getChatDisplayName()}</h3>
            <span className="text-[10px] text-green-500 font-semibold block mt-0.5">
              {isGroup ? `${members.length} Members` : "Direct encrypted chat"}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              if (Notification.permission === "default") {
                Notification.requestPermission();
              }
            }}
            title="Enable native push notifications"
            className={`flex items-center justify-center rounded-lg p-2.5 border transition ${
              isDark 
                ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white" 
                : "border-[#E8E1D5] text-gray-500 hover:bg-gray-50"
            }`}
          >
            <BellRing className="h-4 w-4" />
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center justify-center rounded-lg p-2.5 border transition ${
              isDark 
                ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white" 
                : "border-[#E8E1D5] text-gray-500 hover:bg-gray-50"
            }`}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* KakaoTalk Unrecognized Sender Banner */}
      {otherMember && !isFriend && !isBlocked && (
        <div className={`flex flex-col sm:flex-row items-center justify-between px-6 py-4.5 border-b shadow-xs gap-3 select-none ${
          isDark 
            ? "bg-amber-950/20 border-amber-900/30 text-amber-200" 
            : "bg-[#FFEB33] border-[#7B3F00]/10 text-amber-950"
        }`}>
          <div className="flex items-center space-x-3 text-center sm:text-left">
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 animate-pulse" />
            <div className="text-xs">
              <span className="font-extrabold block sm:inline">Unrecognized Sender Warning!</span>{" "}
              <span className="opacity-80">This person is not in your local Friend Contacts. Be careful about sending them links or credentials.</span>
            </div>
          </div>
          <div className="flex items-center space-x-2 w-full sm:w-auto justify-center">
            <button
              onClick={handleAddFriendFromBanner}
              className="flex-1 sm:flex-initial flex items-center justify-center space-x-1 px-4 py-2 bg-[#7B3F00] text-amber-50 hover:bg-[#5C2E00] text-[11px] font-black rounded-full shadow-3xs hover:scale-102 active:scale-98 transition cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Add Friend</span>
            </button>
            <button
              onClick={handleBlockUserFromBanner}
              className="flex-1 sm:flex-initial flex items-center justify-center space-x-1 px-4 py-2 bg-red-650 text-white hover:bg-red-700 text-[11px] font-black rounded-full shadow-3xs hover:scale-102 active:scale-98 transition cursor-pointer"
            >
              <UserMinus className="h-3.5 w-3.5" />
              <span>Block User</span>
            </button>
          </div>
        </div>
      )}

      {/* Blocked Sender Indicator banner */}
      {otherMember && isBlocked && (
        <div className="flex items-center justify-between px-6 py-3 border-b text-xs select-none bg-red-50 text-red-800 dark:bg-red-950/20 dark:border-red-900/30 dark:text-red-300">
          <div className="flex items-center space-x-2.5">
            <X className="h-4 w-4 shrink-0 text-red-500" />
            <span>You have blocked this contact. Messages from them are muted.</span>
          </div>
          <button
            onClick={handleUnblockUserFromBanner}
            className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold rounded-xl transition cursor-pointer"
          >
            Unblock Contacts
          </button>
        </div>
      )}

      {/* Primary Message Stream Body */}
      <div className={`flex-1 overflow-y-auto p-8 space-y-6 transition-colors duration-200 ${
        isDark ? "bg-[#121214]" : "bg-[#FDFBF7]"
      }`}>
        {messages.map((msg, index) => {
          const isMe = msg.senderId === currentProfile.uid;
          
          // Calculate if this message was read by anyone else
          const otherReaders = msg.readBy.filter(u => u !== msg.senderId);
          const isRead = otherReaders.length > 0;

          return (
            <div
              key={index}
              className={`flex items-start space-x-3 ${isMe ? "justify-end" : "justify-start"}`}
            >
              {!isMe && (
                <img
                  src={msg.senderPhoto}
                  referrerPolicy="no-referrer"
                  alt={msg.senderName}
                  className={`h-8 w-8 rounded-lg object-cover border shrink-0 ${
                    isDark ? "border-zinc-700 bg-zinc-800" : "border-[#E8E1D5] bg-white"
                  }`}
                />
              )}

              <div className="max-w-[70%]">
                {!isMe && (
                  <span className={`text-[10px] font-sans font-bold ml-1 mb-1 block ${
                    isDark ? "text-zinc-500" : "text-gray-400"
                  }`}>
                    {msg.senderName}
                  </span>
                )}

                <div className={`p-3 rounded-2xl shadow-xs border ${
                  isMe 
                    ? "bg-[#7B3F00] text-white border-transparent rounded-tr-none" 
                    : isDark 
                      ? "bg-zinc-900 text-zinc-100 border-zinc-800 rounded-tl-none" 
                      : "bg-white text-gray-700 border-[#E8E1D5] rounded-tl-none"
                }`}>
                  {msg.photoUrl ? (
                    <div className="rounded-lg overflow-hidden border border-[#E8E1D5] max-w-[220px] p-0.5 bg-white">
                      <img src={msg.photoUrl} alt="Chat file Attachment" className="w-full object-contain rounded-md" />
                    </div>
                  ) : (
                    <p className="text-sm break-words leading-relaxed font-sans">{msg.text}</p>
                  )}
                </div>

                {/* Micro info line containing meta status */}
                <div className="flex items-center space-x-1.5 mt-1 px-1 text-[10px]">
                  {isMe && isRead && (
                    <span className="text-[#7B3F00] font-bold">
                      {isGroup ? `(read by ${otherReaders.length})` : "(read)"}
                    </span>
                  )}
                  <span className="text-gray-400">
                    {msg.createdAt?.seconds 
                      ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                      : "now"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Message Input Panel bar */}
      <footer className={`p-6 transition-colors duration-200 ${
        isDark ? "bg-[#09090b] border-t border-zinc-850" : "bg-white border-t border-[#E8E1D5]"
      }`}>
        {isBlocked ? (
          <div className="max-w-4xl mx-auto py-3 px-6 text-center text-xs font-bold text-red-650 bg-red-50/60 dark:bg-red-950/20 rounded-2xl border border-red-200/50 flex items-center justify-center space-x-2">
            <span>🚫 Chat is locked because you have blocked this contact. Unblock them to resume conversations.</span>
          </div>
        ) : (
          <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex items-center space-x-4">
            <label className="p-2 text-gray-400 hover:text-[#7B3F00] transition cursor-pointer">
              <Image className="h-6 w-6" />
              <input
                type="file"
                accept="image/*"
                onChange={handleSendPhoto}
                className="hidden"
              />
            </label>

            <div className={`flex-1 rounded-full px-6 py-3 border transition-all flex items-center ${
              isDark 
                ? "bg-[#18181b] border-zinc-800 focus-within:border-zinc-650 focus-within:bg-[#000000]" 
                : "bg-[#F5F1EB] border-transparent focus-within:border-[#7B3F00] focus-within:bg-white"
            }`}>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type a message..."
                className={`bg-transparent text-sm w-full outline-none ${
                  isDark ? "text-zinc-100 placeholder:text-zinc-500" : "text-gray-800 placeholder:text-gray-400"
                }`}
              />
            </div>

            <button
              type="submit"
              disabled={sending || !inputText.trim()}
              className="w-12 h-12 bg-[#7B3F00] hover:bg-[#5C2E00] rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-105 active:scale-95 shrink-0 outline-none disabled:opacity-40"
            >
              <svg className="w-5 h-5 transform rotate-90" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
              </svg>
            </button>
          </form>
        )}
      </footer>

      {/* Chat Settings overlay drawpanel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-3xs flex justify-end z-30"
          >
            <motion.div
              initial={{ x: 260 }}
              animate={{ x: 0 }}
              exit={{ x: 260 }}
              className="w-64 max-w-sm bg-white h-full border-l border-[#E8E1D5] p-6 flex flex-col justify-between shadow-xl"
            >
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-[#E8E1D5] pb-3">
                  <span className="font-sans font-bold text-sm text-[#2D1B08] tracking-tight">
                    Chat Members
                  </span>
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="p-1.5 rounded-full text-gray-400 hover:bg-[#F5F1EB] hover:text-gray-600 transition"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {isGroup && (
                  <button
                    onClick={() => setShowInviteDrawer(true)}
                    className="w-full flex items-center justify-center space-x-1.5 rounded-lg border border-[#E8E1D5] bg-[#F5F1EB] hover:bg-gray-50 py-2.5 text-xs font-bold text-gray-700 transition shadow-3xs"
                  >
                    <Plus className="h-3.5 w-3.5 text-[#7B3F00]" />
                    <span>Invite Friends</span>
                  </button>
                )}

                {/* Sublist of registered members */}
                <div className="space-y-3 overflow-y-auto max-h-80 pr-1">
                  {members.map((member) => (
                    <div key={member.userId} className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <img 
                          src={member.photoURL} 
                          referrerPolicy="no-referrer"
                          className="h-7 w-7 rounded-full object-cover border border-[#E8E1D5] bg-white" 
                          alt={member.displayName} 
                        />
                        <div>
                          <span className="block text-xs font-bold text-[#2D1B08] truncate max-w-[120px]">
                            {member.displayName} {member.userId === currentProfile.uid && " (You)"}
                          </span>
                          <span className="block text-[8px] font-bold text-[#7B3F00] leading-none mt-0.5">
                            {member.role === "host" ? "👑 Owner" : "Member"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1">
                        {/* Report button */}
                        {member.userId !== currentProfile.uid && (
                          <button
                            onClick={() => handleReportUser(member)}
                            title="Report User"
                            className="p-1.5 rounded-full text-amber-600 hover:bg-amber-100/50 transition"
                          >
                            <BellRing className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Display kick button ONLY for host kicking others, or for the admin */}
                        {isGroup && (isHost || currentProfile.uid === "jaein8080" || currentProfile.uid === "jaein8080@gmail.com") && member.userId !== currentProfile.uid && (
                          <button
                            onClick={() => handleKickMember(member.userId)}
                            title="Kick participant"
                            className="p-1.5 rounded-full text-red-500 hover:bg-red-50 transition cursor-pointer"
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Delete / Leave Button Footer */}
              <div className="border-t border-[#E8E1D5] pt-4 space-y-2">
                {isGroup ? (
                  isHost ? (
                    <button
                      onClick={handleDeleteChat}
                      className="w-full flex items-center justify-center space-x-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 py-2.5 text-xs font-bold transition shadow-3xs"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Delete Group Chat</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleLeaveGroup}
                      className="w-full flex items-center justify-center space-x-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100/70 text-red-600 py-2.5 text-xs font-bold transition"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Leave Group Chat</span>
                    </button>
                  )
                ) : (
                  // Direct message deletion
                  isHost && (
                    <button
                      onClick={handleDeleteChat}
                      className="w-full flex items-center justify-center space-x-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 py-2.5 text-xs font-bold transition"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Close DM Chat</span>
                    </button>
                  )
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invite Friends Modal Drawer overlay */}
      <AnimatePresence>
        {showInviteDrawer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-3xs p-4">
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="w-full max-w-sm bg-white rounded-2xl border border-[#E8E1D5] p-6 shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-[#E8E1D5] pb-3 mb-4">
                <span className="font-sans font-bold text-sm text-[#2D1B08]">
                  Invite Friend to Group
                </span>
                <button
                  onClick={() => setShowInviteDrawer(false)}
                  className="p-1 rounded-full text-gray-400 hover:bg-[#F5F1EB]"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              {inviteCandidates.length === 0 ? (
                <div className="text-center py-6 text-xs text-gray-400 bg-[#FDFBF7] rounded-xl border border-dashed border-[#E8E1D5]">
                  All your friends are already in this group!
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {inviteCandidates.map((f) => (
                    <div
                      key={f.friendId}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-[#E8E1D5] shadow-3xs"
                    >
                      <div className="flex items-center space-x-2.5">
                        <img 
                          src={f.photoURL} 
                          referrerPolicy="no-referrer"
                          alt={f.displayName} 
                          className="h-8 w-8 rounded-full object-cover border border-[#E8E1D5]"
                        />
                        <span className="text-xs font-bold text-[#2D1B08]">{f.displayName}</span>
                      </div>
                      <button
                        onClick={() => handleInviteFriend(f)}
                        className="flex items-center space-x-1 rounded-lg bg-[#7B3F00] text-amber-50 hover:bg-[#5C2E00] px-2.5 py-1.5 text-[10px] font-bold shadow-xs transition"
                      >
                        <UserPlus className="h-3 w-3" />
                        <span>Invite</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Report User Modal Dialog overlay */}
      <AnimatePresence>
        {reportTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-3xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm bg-white rounded-2xl border border-[#E8E1D5] p-6 shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-[#E8E1D5] pb-3 mb-4">
                <span className="font-sans font-bold text-sm text-[#2D1B08] flex items-center space-x-1.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>Report Account</span>
                </span>
                <button
                  onClick={() => setReportTarget(null)}
                  className="p-1 rounded-full text-gray-400 hover:bg-[#F5F1EB]"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              {reportSuccess ? (
                <div className="text-center py-6">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-600 mb-3 border border-green-200">
                    <Check className="h-6 w-6" />
                  </div>
                  <h4 className="font-sans font-bold text-[#2D1B08] text-sm mb-1">
                    Report Submitted
                  </h4>
                  <p className="text-xs text-gray-500 mb-4 px-2">
                    Thank you. We have received your query. The administrators will look into {reportTarget.displayName}'s chat activities immediately.
                  </p>
                  <button
                    onClick={() => {
                      setReportTarget(null);
                      setReportSuccess(false);
                    }}
                    className="w-full py-2 bg-[#7B3F00] text-amber-50 hover:bg-[#5C2E00] rounded-xl text-xs font-bold shadow-xs transition"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmitReport} className="space-y-4">
                  <div className="flex items-center space-x-3 p-3 bg-[#FDFBF7] rounded-xl border border-[#E8E1D5]">
                    <img
                      src={reportTarget.photoURL}
                      referrerPolicy="no-referrer"
                      className="h-10 w-10 rounded-full border border-[#E8E1D5] object-cover"
                      alt={reportTarget.displayName}
                    />
                    <div>
                      <span className="block text-xs font-bold text-[#2D1B08]">
                        {reportTarget.displayName}
                      </span>
                      <span className="block text-[10px] text-gray-500">
                        Chat Participant
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-bold text-gray-500">
                      Reason for Report
                    </label>
                    <textarea
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      placeholder="Please describe why you are reporting this user (e.g., offense language, malicious acts, spamming)..."
                      required
                      rows={3}
                      className="w-full text-xs p-2.5 rounded-xl border border-[#E8E1D5] focus:outline-none focus:border-[#7B3F00] placeholder-gray-400 bg-white"
                    />
                  </div>

                  <div className="flex space-x-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setReportTarget(null)}
                      className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={reportSubmitting || !reportReason.trim()}
                      className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-200 text-white font-bold rounded-xl text-xs transition flex items-center justify-center space-x-1.5 shadow-xs"
                    >
                      {reportSubmitting ? (
                        <span>Submitting...</span>
                      ) : (
                        <>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>Submit Report</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
