import React, { useState, useEffect } from "react";
import { 
  auth, db, handleFirestoreError, OperationType 
} from "./firebase";
import { 
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "firebase/auth";
import { 
  doc, getDoc, setDoc, collection, onSnapshot, 
  serverTimestamp, writeBatch, getDocs, addDoc, query, where, deleteDoc
} from "firebase/firestore";
import { 
  MessageSquare, Users, UserPlus, LogOut, ChevronRight, 
  MessageCircle, Sparkles, Smile, RefreshCw, UserCheck, ShieldCheck, Search, Megaphone, UserX, ShieldAlert, BellRing, Trash
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { UserProfile, Friend, Chat } from "./types";
import AddFriendModal from "./components/AddFriendModal";
import GroupChatModal from "./components/GroupChatModal";
import ProfileModal from "./components/ProfileModal";
import ActiveChatWindow from "./components/ActiveChatWindow";
import AdminConsole from "./components/AdminConsole";

export default function App() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authenticating, setAuthenticating] = useState(true);
  const [profileSetupLoading, setProfileSetupLoading] = useState(false);
  
  // Modals active state
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  // Lists persistence
  const [friends, setFriends] = useState<Friend[]>([]);
  const [joinedChats, setJoinedChats] = useState<any[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Authentication Form States
  const [signName, setSignName] = useState("");
  const [signPassword, setSignPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Admin States
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminConsole, setShowAdminConsole] = useState(false);
  const [inspectingUser, setInspectingUser] = useState<UserProfile | null>(null);
  const [isBanned, setIsBanned] = useState(false);

  // Announcement Toast Overlay States
  const [activeAnnouncement, setActiveAnnouncement] = useState<{ id: string; text: string; type: "ios" | "android" | "global" } | null>(null);

  // 1. Subscribe to Authentication State changes
  useEffect(() => {
    let unsubBan: (() => void) | null = null;
    let unsubAnnouncements: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthenticating(true);
      if (user) {
        setCurrentUser(user);
        
        // Listen to ban status
        unsubBan = onSnapshot(doc(db, "bans", user.uid), (snap) => {
          if (snap.exists()) {
            setIsBanned(true);
            signOut(auth);
          } else {
            setIsBanned(false);
          }
        });

        // Determine Admin Status
        const emailLower = (user.email || "").toLowerCase();
        const uidLower = (user.uid || "").toLowerCase();
        const userIsAdmin = emailLower === "jaein8080@gmail.com" || uidLower === "jaein8080" || uidLower === "jaein8080@gmail.com";
        setIsAdmin(userIsAdmin);

        await initUserProfile(user);
      } else {
        setCurrentUser(null);
        setProfile(null);
        setFriends([]);
        setJoinedChats([]);
        setActiveChatId(null);
        setIsAdmin(false);
        if (unsubBan) {
          unsubBan();
          unsubBan = null;
        }
      }
      setAuthenticating(false);
    });

    // Real-time Announcements Listener (iOS/Android alerts)
    const announcementsRef = collection(db, "announcements");
    unsubAnnouncements = onSnapshot(announcementsRef, (snap) => {
      if (!snap.empty) {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        docs.sort((a,b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
        const latest = docs[0];
        
        if (latest && latest.text) {
          const shownId = localStorage.getItem("last_shown_ann_id");
          if (shownId !== latest.id) {
            localStorage.setItem("last_shown_ann_id", latest.id);
            setActiveAnnouncement({
              id: latest.id,
              text: latest.text,
              type: latest.type || "global"
            });
            setTimeout(() => {
              setActiveAnnouncement(null);
            }, 8000);
          }
        }
      }
    });

    return () => {
      unsubscribe();
      if (unsubBan) unsubBan();
      if (unsubAnnouncements) unsubAnnouncements();
    };
  }, []);

  // 2. Initialize or fetch current user record
  const initUserProfile = async (user: any) => {
    setProfileSetupLoading(true);
    const userRef = doc(db, "users", user.uid);
    let userSnap;
    try {
      userSnap = await getDoc(userRef);
    } catch (err) {
      console.error("Profile synchronization: Fetching profile failed:", err);
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      return;
    }

    if (userSnap.exists()) {
      const d = userSnap.data();
      setProfile({
        uid: d.uid,
        displayName: d.displayName,
        photoURL: d.photoURL,
        uniqueId: d.uniqueId,
        createdAt: d.createdAt,
      });
      setProfileSetupLoading(false);
    } else {
      // Generate an unchangeable unique 8-digit identification ID
      const generatedId = Math.floor(10000000 + Math.random() * 90000000).toString();
      
      const freshProfile: UserProfile = {
        uid: user.uid,
        displayName: user.displayName || "Sweet Chocolatier",
        photoURL: user.photoURL || "https://images.unsplash.com/photo-1511381939415-e44015466834?w=150&auto=format&fit=crop",
        uniqueId: generatedId,
        createdAt: serverTimestamp(),
      };

      try {
        await setDoc(userRef, freshProfile);
        setProfile(freshProfile);
      } catch (err) {
        console.error("Profile synchronization: Creating profile failed:", err);
        handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}`);
      } finally {
        setProfileSetupLoading(false);
      }
    }
  };

  // 3. Keep real-time subscriptions for friends list and joined chat indices
  useEffect(() => {
    const targetUid = inspectingUser ? inspectingUser.uid : (profile ? profile.uid : null);
    if (!targetUid) return;

    // Subscribe to Friends
    const friendsRef = collection(db, "users", targetUid, "friends");
    const unsubFriends = onSnapshot(friendsRef, (snap) => {
      const list: Friend[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          friendId: d.friendId,
          displayName: d.displayName,
          photoURL: d.photoURL,
          uniqueId: d.uniqueId,
          addedAt: d.addedAt,
        });
      });
      setFriends(list);
    }, (error) => {
      console.warn("Could not read friends:", error);
    });

    // Subscribe to Joined Chats Index
    const joinedChatsRef = collection(db, "users", targetUid, "joinedChats");
    const unsubJoinedChats = onSnapshot(joinedChatsRef, (snap) => {
      const list: any[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          chatId: d.chatId,
          isGroup: d.isGroup,
          displayName: d.displayName,
          joinedAt: d.joinedAt,
        });
      });
      setJoinedChats(list);
    }, (error) => {
       console.warn("Could not read joined chats:", error);
    });

    return () => {
      unsubFriends();
      unsubJoinedChats();
    };
  }, [profile, inspectingUser]);

  // Request standard Web Notification permission on initial loading
  useEffect(() => {
    if ("Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, []);

  const getEmailFromUsername = (name: string) => {
    const norm = name.trim().toLowerCase();
    if (norm === "jaein8080" || norm === "jaein8080@gmail.com") {
      return "jaein8080@gmail.com";
    }
    if (norm.includes("@")) {
      return norm;
    }
    return `${norm}@chocolatetalk.local`;
  };

  const handlePasswordLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!signName.trim() || !signPassword.trim()) {
      setAuthError("Please fill in all credentials!");
      return;
    }
    setAuthError("");
    setIsSigningIn(true);
    try {
      const email = getEmailFromUsername(signName);
      await signInWithEmailAndPassword(auth, email, signPassword);
      setSignName("");
      setSignPassword("");
    } catch (err: any) {
      console.error(err);
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found" || err.code === "auth/invalid-email") {
        setAuthError("Invalid username or password!");
      } else {
        setAuthError(err.message || "Sign in failed!");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handlePasswordRegister = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanNick = signName.trim();
    if (!cleanNick || !signPassword.trim()) {
      setAuthError("Please fill in all credentials!");
      return;
    }
    if (cleanNick.length < 3) {
      setAuthError("Username must be at least 3 characters!");
      return;
    }
    setAuthError("");
    setIsSigningIn(true);
    try {
      // 1. Check if name is already registered/used!
      const normalized = cleanNick.toLowerCase();
      const usernameDocRef = doc(db, "usernames", normalized);
      const usernameSnap = await getDoc(usernameDocRef);
      if (usernameSnap.exists()) {
        setAuthError("This name is already used! Choose another name.");
        setIsSigningIn(false);
        return;
      }

      // 2. Map username to local email
      const email = getEmailFromUsername(cleanNick);

      // 3. Create Firebase auth record
      const credential = await createUserWithEmailAndPassword(auth, email, signPassword);
      const user = credential.user;

      // 4. Set Username Uniqueness lock in database
      await setDoc(usernameDocRef, {
        uid: user.uid,
        createdAt: serverTimestamp()
      });

      // 5. Initialize user record
      const userRef = doc(db, "users", user.uid);
      const generatedId = Math.floor(10000000 + Math.random() * 90000000).toString();
      
      const freshProfile: UserProfile = {
        uid: user.uid,
        displayName: cleanNick, // Use exact casing typed
        photoURL: "https://images.unsplash.com/photo-1511381939415-e44015466834?w=150&auto=format&fit=crop",
        uniqueId: generatedId,
        createdAt: serverTimestamp(),
      };

      await setDoc(userRef, freshProfile);
      setProfile(freshProfile);
      
      // Clear fields
      setSignName("");
      setSignPassword("");
    } catch (err: any) {
      console.error(err);
      if (err.code === "auth/email-already-in-use" || err.code === "auth/username-already-in-use" || err?.message?.includes("already")) {
        setAuthError("This name is already used! Choose another name.");
      } else {
        setAuthError(err.message || "Registration failed!");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(error);
    }
  };

  const handleProfileSave = async (display: string, photo: string) => {
    if (!profile) return;
    try {
      const userRef = doc(db, "users", profile.uid);
      await setDoc(userRef, {
        ...profile,
        displayName: display,
        photoURL: photo,
      });
      setProfile((prev) => prev ? { ...prev, displayName: display, photoURL: photo } : null);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleSelectFriendAndChat = async (friend: Friend) => {
    if (!profile) return;
    
    // Sort UIDs alphabetically for deterministic Private Chat ID string mapping
    const sorted = [profile.uid, friend.friendId].sort();
    const dmId = `dm-${sorted[0]}-${sorted[1]}`;

    try {
      const chatDocRef = doc(db, "chats", dmId);
      const chatSnap = await getDoc(chatDocRef);

      if (!chatSnap.exists()) {
        const batch = writeBatch(db);
        
        batch.set(chatDocRef, {
          id: dmId,
          name: `Direct Chat`,
          isGroup: false,
          hostId: profile.uid,
          createdAt: serverTimestamp(),
          lastMessageText: "Direct Message Started",
          lastMessageTime: serverTimestamp()
        });

        // Add Me as host inside Members subcollection
        batch.set(doc(db, `chats/${dmId}/members/${profile.uid}`), {
          userId: profile.uid,
          displayName: profile.displayName,
          photoURL: profile.photoURL,
          role: "host",
          joinedAt: serverTimestamp()
        });

        // Add Me Joined-Chats Index list
        batch.set(doc(db, `users/${profile.uid}/joinedChats/${dmId}`), {
          chatId: dmId,
          isGroup: false,
          displayName: friend.displayName,
          joinedAt: serverTimestamp()
        });

        // Add Friend as member inside subcollection
        batch.set(doc(db, `chats/${dmId}/members/${friend.friendId}`), {
          userId: friend.friendId,
          displayName: friend.displayName,
          photoURL: friend.photoURL,
          role: "member",
          joinedAt: serverTimestamp()
        });

        // Add Friend Joined-Chats Index list
        batch.set(doc(db, `users/${friend.friendId}/joinedChats/${dmId}`), {
          chatId: dmId,
          isGroup: false,
          displayName: profile.displayName,
          joinedAt: serverTimestamp()
        });

        await batch.commit();
      }

      setActiveChatId(dmId);
    } catch (err) {
      console.error("Direct Message orchestration failed: ", err);
    }
  };

  if (authenticating || profileSetupLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F9F7F2]">
        <div className="flex flex-col items-center space-y-3.5">
          <RefreshCw className="h-10 w-10 animate-spin text-[#7B3F00]" />
          <span className="font-sans font-semibold text-[#2D1B08] tracking-wide select-none">
            Brewing Chocolate Talk...
          </span>
        </div>
      </div>
    );
  }

  // Not signed-in view landing
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F9F7F2] px-4 select-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-sm rounded-[2rem] bg-white p-8 border border-[#E8E1D5] shadow-xl text-center relative overflow-hidden"
        >
          {/* Sweet cream backdrop décor */}
          <div className="absolute top-0 right-0 h-40 w-40 bg-[#7B3F00]/5 blur-xl rounded-full" />
          
          <div className="flex flex-col items-center space-y-5">
            {/* Visual Chocolate Bar logo icon */}
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#7B3F00] shadow-md">
              <Smile className="h-9 w-9 text-[#F9F7F2]" />
            </div>

            <div>
              <h1 className="font-sans text-3xl font-extrabold text-[#2D1B08] tracking-tight leading-none mb-1">
                Chocolate Talk
              </h1>
              <p className="text-xs font-mono text-[#7B3F00] font-bold uppercase tracking-widest leading-none">
                Tasteful Conversations
              </p>
            </div>

            <p className="text-gray-500 text-xs font-sans font-medium px-4 leading-relaxed">
              Real-time messaging using durable Firebase engines. Exchange persistent friends list, photos, group invites, and secure camera verification.
            </p>

          <div className="flex flex-col items-center space-y-4 w-full">
            {/* Login / Register Toggle Tabs */}
            <div className="flex w-full bg-[#F5F1EB] p-1 rounded-xl border border-[#E8E1D5] leading-none mb-1">
              <button
                type="button"
                onClick={() => { setAuthMode("login"); setAuthError(""); }}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                  authMode === "login" 
                    ? "bg-[#7B3F00] text-amber-50 shadow-xs" 
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => { setAuthMode("register"); setAuthError(""); }}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                  authMode === "register" 
                    ? "bg-[#7B3F00] text-amber-50 shadow-xs" 
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                Register
              </button>
            </div>

            {/* Credentials Fields Form */}
            <form 
              onSubmit={authMode === "login" ? handlePasswordLogin : handlePasswordRegister} 
              className="w-full space-y-3"
            >
              <div className="space-y-1 text-left">
                <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider font-mono">
                  Username / Name
                </label>
                <input
                  type="text"
                  placeholder={authMode === "login" ? "Enter your name..." : "Choose a name..."}
                  value={signName}
                  onChange={(e) => setSignName(e.target.value)}
                  required
                  autoCapitalize="none"
                  className="w-full text-xs p-3 rounded-xl border border-[#E8E1D5] bg-white focus:outline-none focus:border-[#7B3F00] text-[#2C1B08]"
                />
              </div>

              <div className="space-y-1 text-left">
                <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider font-mono">
                  Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={signPassword}
                  onChange={(e) => setSignPassword(e.target.value)}
                  required
                  className="w-full text-xs p-3 rounded-xl border border-[#E8E1D5] bg-white focus:outline-none focus:border-[#7B3F00] text-[#2C1B08]"
                />
              </div>

              {authError && (
                <div className="text-[10px] text-red-600 bg-red-50 border border-red-200 p-2.5 rounded-xl font-sans font-semibold text-center leading-normal">
                  ⚠️ {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSigningIn}
                className="w-full flex items-center justify-center space-x-2 rounded-2xl bg-[#7B3F00] hover:bg-[#5C2E00] text-white py-3.5 text-xs font-bold shadow-md transition leading-none outline-none disabled:bg-gray-200 cursor-pointer"
              >
                {isSigningIn ? (
                  <span>Wait a moment...</span>
                ) : (
                  <span>{authMode === "login" ? "Chocolatier Sign In" : "Register New Account"}</span>
                )}
              </button>
            </form>
          </div>
          </div>
        </motion.div>
      </div>
    );
  }
  // Logged-in application space layout Dashboard
  return (
    <div className="min-h-screen bg-[#F9F7F2] flex flex-col p-3 md:p-5 items-center justify-center relative overflow-hidden">
      
      {/* Real-time iOS / Android Notification Alert toasts */}
      <AnimatePresence>
        {activeAnnouncement && activeAnnouncement.type === "ios" && (
          <motion.div
            key={activeAnnouncement.id}
            initial={{ opacity: 0, y: -80, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -80, scale: 0.95 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm bg-black/85 text-white backdrop-blur-md rounded-[1.3rem] p-4 shadow-2xl border border-white/10 flex items-start space-x-3 outline-none"
          >
            <div className="h-9 w-9 bg-amber-600 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md">
              <Smile className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-sans font-extrabold text-[10px] text-gray-300 uppercase tracking-widest font-mono">CHOCOLATE TALK</span>
                <span className="font-mono text-[9px] text-gray-500">now</span>
              </div>
              <p className="text-xs font-sans text-white font-semibold mt-1 leading-relaxed">
                {activeAnnouncement.text}
              </p>
            </div>
          </motion.div>
        )}

        {activeAnnouncement && activeAnnouncement.type === "android" && (
          <motion.div
            key={activeAnnouncement.id}
            initial={{ opacity: 0, x: 80 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 80 }}
            className="fixed top-4 right-4 z-[100] w-full max-w-xs bg-gray-950 border border-gray-800 text-white rounded-2xl p-4 shadow-2xl flex items-start space-x-3 leading-snug"
          >
            <div className="h-8 w-8 bg-[#7B3F00] rounded-full flex items-center justify-center text-[#FAF8F5] shrink-0 border border-amber-900 shadow-sm">
              <BellRing className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-mono text-[#7B3F00] font-extrabold uppercase tracking-wider mb-1 leading-none">System Alert</p>
              <p className="text-xs font-sans text-gray-100 font-medium">
                {activeAnnouncement.text}
              </p>
            </div>
          </motion.div>
        )}

        {activeAnnouncement && activeAnnouncement.type === "global" && (
          <motion.div
            key={activeAnnouncement.id}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-0 left-0 right-0 z-[100] bg-[#7B3F00] text-[#F9F7F2] py-2.5 px-6 text-center select-none shadow-lg border-b border-[#5C2E00] flex items-center justify-center space-x-2 font-bold font-sans text-xs"
          >
            <Megaphone className="h-3.5 w-3.5 animate-pulse shrink-0 text-amber-100" />
            <span>{activeAnnouncement.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ⚡ Impersonation / Audit active Banner */}
      {inspectingUser && (
        <div className="w-full max-w-5xl mb-3 bg-amber-500 border border-amber-600 text-white rounded-2xl py-2.5 px-5 flex items-center justify-between shadow-md text-xs font-sans leading-none shrink-0">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="h-4 w-4 animate-bounce text-white shrink-0" />
            <span>
              <strong>Spectator/Audit Mode Active</strong>: You are viewing Chocolate Talk as <strong>{inspectingUser.displayName}</strong> (Read-Only)
            </span>
          </div>
          <button
            onClick={() => setInspectingUser(null)}
            className="bg-amber-700 hover:bg-amber-800 transition text-amber-50 px-3.5 py-1.5 rounded-xl font-bold shrink-0 cursor-pointer text-[10px] uppercase tracking-wider"
          >
            Exit Audit Mode
          </button>
        </div>
      )}

      <div className="w-full max-w-5xl h-[85vh] bg-white rounded-[2rem] border border-[#E8E1D5] flex overflow-hidden shadow-xl">
        
        {/* Left Side: Sidebar Column */}
        <div className="w-80 border-r border-[#E8E1D5] flex flex-col justify-between bg-white">
          
          {/* Top Panel: Profiler metadata */}
          <div className="p-6 border-b border-[#E8E1D5] bg-white">
            <div className="flex items-center justify-between mb-4 leading-none">
              <div 
                onClick={() => setShowEditProfile(true)}
                className="flex items-center space-x-2.5 cursor-pointer group"
              >
                <img
                  src={profile.photoURL}
                  referrerPolicy="no-referrer"
                  alt={profile.displayName}
                  className="h-10 w-10 rounded-full object-cover border border-[#E8E1D5] group-hover:border-[#7B3F00] transition shadow-sm bg-white"
                />
                <div className="text-left select-none">
                  <span className="block font-sans font-bold text-sm text-[#2D1B08] leading-tight group-hover:text-[#7B3F00] transition truncate max-w-[120px]">
                    {profile.displayName}
                  </span>
                  <span className="block font-mono text-[9px] text-gray-400 leading-none mt-0.5">
                    Change Profile
                  </span>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="rounded-full p-2 bg-[#F5F1EB] text-gray-500 hover:bg-[#E8E1D5] hover:text-[#7B3F00] transition shadow-sm"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

            {/* Display Unique non-changeable numeric ID */}
            <div className="flex items-center justify-between bg-[#F5F1EB] rounded-lg px-3 py-1.5 border border-[#E8E1D5] select-all font-mono">
              <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                My Choc ID:
              </span>
              <span className="text-xs font-bold text-[#7B3F00] tracking-widest leading-none">
                {profile.uniqueId}
              </span>
            </div>
          </div>

          {/* Center Scroll Workspace: Friends & Conversations */}
          <div className="flex-1 overflow-y-auto py-2 space-y-6">
            
            {/* Friends Registry list */}
            <div>
              <div className="flex items-center justify-between px-6 mb-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none select-none">
                  Friends ({friends.length})
                </span>
                <button
                  onClick={() => setShowAddFriend(true)}
                  className="rounded-lg bg-[#7B3F00] hover:bg-[#5C2E00] text-white p-1.5 transition shadow-sm"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </button>
              </div>

              {friends.length === 0 ? (
                <div className="mx-6 text-center py-5 border border-dashed border-[#E8E1D5] rounded-xl text-[10px] text-gray-400 font-medium select-none">
                  No friends added. Tap '+' to scan or find by ID!
                </div>
              ) : (
                <div className="space-y-0.5">
                  {friends.map((friend) => (
                    <button
                      key={friend.friendId}
                      onClick={() => handleSelectFriendAndChat(friend)}
                      className="flex w-full items-center justify-between px-6 py-3 hover:bg-[#F5F1EB] transition text-left group"
                    >
                      <div className="flex items-center space-x-3">
                        <img
                          src={friend.photoURL}
                          referrerPolicy="no-referrer"
                          alt={friend.displayName}
                          className="h-9 w-9 rounded-full object-cover border border-[#E8E1D5] bg-white"
                        />
                        <div>
                          <span className="block font-sans font-bold text-xs text-[#2D1B08] group-hover:text-[#7B3F00] transition leading-tight">
                            {friend.displayName}
                          </span>
                          <span className="block font-mono text-[8px] text-gray-400 leading-none mt-0.5">
                            ID: {friend.uniqueId}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-gray-300 group-hover:translate-x-0.5 group-hover:text-[#7B3F00] transition" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Separator line */}
            <div className="h-[1px] bg-[#E8E1D5] mx-6" />

            {/* Active Group / Chat discussions */}
            <div>
              <div className="flex items-center justify-between px-6 mb-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none select-none">
                  Recent Chats
                </span>
                <button
                  onClick={() => setShowCreateGroup(true)}
                  className="rounded-lg bg-[#7B3F00] hover:bg-[#5C2E00] text-white p-1.5 transition shadow-sm"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </button>
              </div>

              {joinedChats.length === 0 ? (
                <div className="mx-6 text-center py-5 border border-dashed border-[#E8E1D5] rounded-xl text-[10px] text-gray-400 font-medium select-none">
                  Create a Group or click a Friend to start chatting!
                </div>
              ) : (
                <div className="space-y-0.5">
                  {joinedChats.map((room) => {
                    const isActive = activeChatId === room.chatId;
                    return (
                      <button
                        key={room.chatId}
                        onClick={() => setActiveChatId(room.chatId)}
                        className={`flex w-full items-center justify-between py-3.5 transition text-left group ${
                          isActive 
                            ? "bg-[#FDFBF7] border-l-4 border-[#7B3F00] px-5 pl-[20px]" 
                            : "hover:bg-[#F5F1EB] px-6"
                        }`}
                      >
                        <div className="flex items-center space-x-3 overflow-hidden">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-full bg-[#F5F1EB] border shrink-0 text-xs text-[#7B3F00] font-sans font-bold ${
                            isActive ? "border-[#7B3F00]" : "border-[#E8E1D5]"
                          }`}>
                            {room.isGroup ? <Users className="h-3.5 w-3.5 text-[#7B3F00]" /> : (room.displayName[0] || "#")}
                          </div>
                          <div className="overflow-hidden">
                            <span className="block font-sans font-bold text-xs leading-tight text-[#2D1B08] group-hover:text-[#7B3F00] truncate">
                              {room.displayName}
                            </span>
                            <span className="block font-mono text-[8px] text-gray-400 leading-none mt-0.5">
                              {room.isGroup ? "Group chat" : "Encrypted DM"}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          {/* Admin Console Toggle on bottom of sidebar if user is Admin */}
          {isAdmin && (
            <div className="p-4 border-t border-[#E8E1D5] bg-[#FAF8F5]">
              <button
                type="button"
                onClick={() => {
                  setActiveChatId(null);
                  setShowAdminConsole(!showAdminConsole);
                }}
                className={`flex w-full items-center justify-center space-x-2 rounded-xl py-2.5 text-xs font-bold border transition cursor-pointer ${
                  showAdminConsole 
                    ? "bg-red-50 border-red-200 text-red-600 hover:bg-red-100" 
                    : "bg-[#7B3F00] text-amber-50 border-[#7B3F00] hover:bg-[#5C2E00]"
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                <span>{showAdminConsole ? "Exit Admin Console" : "Open Admin Console"}</span>
              </button>
            </div>
          )}

        </div>

        {/* Right Side: Active Conversation panel workspace */}
        <div className="flex-1 bg-white flex items-center justify-center p-0 relative h-full">
          {showAdminConsole ? (
            <AdminConsole
              onSelectChatId={(cId) => {
                setActiveChatId(cId);
                setShowAdminConsole(false);
              }}
              onInspectUser={(u) => {
                setInspectingUser(u);
                setShowAdminConsole(false);
              }}
              onClose={() => setShowAdminConsole(false)}
              inspectingUser={inspectingUser}
              onStopInspecting={() => setInspectingUser(null)}
            />
          ) : activeChatId ? (
            <ActiveChatWindow
              key={activeChatId}
              chatId={activeChatId}
              currentProfile={profile}
              friendsList={friends}
              onChatDeletedOrLeft={() => setActiveChatId(null)}
            />
          ) : (
            <div className="text-center p-8 flex flex-col items-center space-y-4 choose-prompt select-none">
              <div className="h-16 w-16 bg-[#FDFBF7] rounded-full flex items-center justify-center text-[#7B3F00] border border-[#E8E1D5] shadow-sm animate-pulse">
                <MessageSquare className="h-7 w-7" />
              </div>
              <div>
                <h4 className="font-sans font-bold text-[#7B3F00] text-sm leading-none mb-1.5 uppercase tracking-wider">
                  Tasteful Chat Selected
                </h4>
                <p className="text-[10px] text-gray-400 font-sans font-medium max-w-xs leading-relaxed">
                  Click a friend or chat room on the sidebar to read and write messages.
                </p>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* MODAL LIGHTBOXES */}
      <AnimatePresence>
        {showAddFriend && (
          <AddFriendModal
            currentUserId={profile.uid}
            onClose={() => setShowAddFriend(false)}
            onFriendAdded={() => {}}
          />
        )}

        {showCreateGroup && (
          <GroupChatModal
            currentProfile={profile}
            friendsList={friends}
            onClose={() => setShowCreateGroup(false)}
            onGroupCreated={(newId) => setActiveChatId(newId)}
          />
        )}

        {showEditProfile && (
          <ProfileModal
            profile={profile}
            onSave={handleProfileSave}
            onClose={() => setShowEditProfile(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
