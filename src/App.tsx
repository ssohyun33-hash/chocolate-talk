import React, { useState, useEffect } from "react";
import { 
  auth, db, handleFirestoreError, OperationType 
} from "./firebase";
import { 
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup
} from "firebase/auth";
import { 
  doc, getDoc, setDoc, collection, onSnapshot, 
  serverTimestamp, writeBatch, getDocs, addDoc, query, where, deleteDoc
} from "firebase/firestore";
import { 
  MessageSquare, Users, UserPlus, LogOut, ChevronRight, FolderClosed,
  MessageCircle, Sparkles, Smile, RefreshCw, UserCheck, ShieldCheck, Search, Megaphone, UserX, ShieldAlert, BellRing, Trash
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { UserProfile, Friend, Chat } from "./types";
import AddFriendModal from "./components/AddFriendModal";
import GroupChatModal from "./components/GroupChatModal";
import ProfileModal from "./components/ProfileModal";
import ShowIdModal from "./components/ShowIdModal";
import ActiveChatWindow from "./components/ActiveChatWindow";
import AdminConsole from "./components/AdminConsole";

const generateSweetID = () => {
  // Pure 8-digit random number as string
  return Math.floor(10000000 + Math.random() * 90000000).toString();
};

const getDeterministicNumericID = (uid: string) => {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = uid.charCodeAt(i) + ((hash << 5) - hash);
  }
  return (10000000 + (Math.abs(hash) % 90000000)).toString();
};

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
  const [signEmail, setSignEmail] = useState("");
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

  // Theme state: white or black mode
  const [theme, setTheme] = useState<"white" | "black">(() => {
    return (localStorage.getItem("chocolate_talk_theme") as "white" | "black") || "white";
  });

  const handleThemeChange = (newTheme: "white" | "black") => {
    setTheme(newTheme);
    localStorage.setItem("chocolate_talk_theme", newTheme);
  };

  // Show ID modal visibility state
  const [showShowId, setShowShowId] = useState(false);

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

        // Real-time Announcements Listener (iOS/Android alerts) - Runs only for authenticated users!
        if (!unsubAnnouncements) {
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
          }, (error) => {
            console.warn("Announcements subscription: Missing or restricted permissions:", error);
          });
        }

        // Determine Admin Status
        const emailLower = (user.email || "").toLowerCase();
        const uidLower = (user.uid || "").toLowerCase();
        const userIsAdmin = emailLower === "jaein8080@gmail.com" || uidLower === "jaein8080" || uidLower === "jaein8080@gmail.com";
        setIsAdmin(userIsAdmin);

        try {
          await initUserProfile(user);
        } catch (initErr: any) {
          console.error("Profile setup failed on state change:", initErr);
          setAuthError(`Profile initialization failed: ${initErr.message || initErr}`);
        }
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
        if (unsubAnnouncements) {
          unsubAnnouncements();
          unsubAnnouncements = null;
        }
      }
      setAuthenticating(false);
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
    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      const userEmail = user.email || "";

      if (userSnap.exists()) {
        const d = userSnap.data();
        let currentId = d.uniqueId;

        // Auto-heal empty, placeholder, or non-numeric (old sweet IDs) to proper 8-digit number
        if (!currentId || currentId === "--------" || isNaN(Number(currentId))) {
          currentId = generateSweetID();
          await setDoc(userRef, { uniqueId: currentId }, { merge: true });
        }

        const profileData: UserProfile = {
          uid: d.uid,
          displayName: d.displayName,
          photoURL: d.photoURL,
          uniqueId: currentId,
          createdAt: d.createdAt,
          email: d.email || userEmail,
        };
        // If the email field isn't saved in database yet, update it
        if (!d.email && userEmail) {
          await setDoc(userRef, { email: userEmail }, { merge: true });
        }
        setProfile(profileData);
      } else {
        // Generate a sweet custom chocolate flavor profile ID
        const generatedId = generateSweetID();
        
        const freshProfile: UserProfile = {
          uid: user.uid,
          displayName: user.displayName || "Sweet Chocolatier",
          photoURL: user.photoURL || "https://images.unsplash.com/photo-1511381939415-e44015466834?w=150&auto=format&fit=crop",
          uniqueId: generatedId,
          createdAt: serverTimestamp(),
          email: userEmail,
        };

        await setDoc(userRef, freshProfile);
        setProfile(freshProfile);
      }
    } catch (err: any) {
      console.error("Profile synchronization: init failed:", err);
      // Fallback with stable deterministic details to prevent blank/placeholder IDs
      const fallbackId = getDeterministicNumericID(user.uid);
      setProfile({
        uid: user.uid,
        displayName: user.displayName || "Sweet Chocolatier",
        photoURL: user.photoURL || "https://images.unsplash.com/photo-1511381939415-e44015466834?w=150&auto=format&fit=crop",
        uniqueId: fallbackId,
        createdAt: null,
        email: user.email || ""
      });
      setAuthError(`Profile loaded locally. Database access might be limited: ${err.message || err}`);
    } finally {
      setProfileSetupLoading(false);
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

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    setIsSigningIn(true);
    setAuthError("");
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("Google login failed:", err);
      if (err.code === "auth/popup-closed-by-user") {
        setAuthError("Sign-in popup closed before completion.");
      } else if (err.code === "auth/blocked-by-popup-killer") {
        setAuthError("Sign-in popup blocked by browser. Please allow popups for this site.");
      } else {
        setAuthError(err.message || "Sign in with Google failed!");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handlePasswordLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanNick = signName.trim();
    if (!cleanNick || !signPassword.trim()) {
      setAuthError("Please fill in all credentials!");
      return;
    }

    setAuthError("");
    setIsSigningIn(true);
    try {
      let email = "";
      if (cleanNick.includes("@")) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanNick)) {
          setAuthError("Please enter a valid email address!");
          setIsSigningIn(false);
          return;
        }
        email = cleanNick.toLowerCase();
      } else {
        // Look up mapped email address in the usernames collection to support nickname login with real email accounts
        const normalized = cleanNick.toLowerCase();
        const usernameDocRef = doc(db, "usernames", normalized);
        let usernameSnap = null;
        try {
          usernameSnap = await getDoc(usernameDocRef);
        } catch (dbErr: any) {
          console.warn("Username database lookup failed, calling fallback mapping:", dbErr);
        }

        if (usernameSnap && usernameSnap.exists()) {
          const uData = usernameSnap.data();
          if (uData && uData.email) {
            email = uData.email;
          } else {
            email = getEmailFromUsername(cleanNick);
          }
        } else {
          // Backward compatibility fallback
          email = getEmailFromUsername(cleanNick);
        }
      }

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
    const cleanEmail = signEmail.trim();

    if (!cleanNick || !cleanEmail || !signPassword.trim()) {
      setAuthError("Please fill in all fields (Username, Email, and Password)!");
      return;
    }
    if (cleanNick.length < 3) {
      setAuthError("Username must be at least 3 characters!");
      return;
    }

    // Direct Alphanumeric Check on Display Name
    const usernameRegex = /^[a-zA-Z0-9_\-]+$/;
    if (!usernameRegex.test(cleanNick)) {
      setAuthError("Username can only contain alphanumeric letters, numbers, underscores, and hyphens (no spaces or @ characters).");
      return;
    }

    // Direct Email Syntax check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setAuthError("Please enter a valid format for your Email address!");
      return;
    }

    setAuthError("");
    setIsSigningIn(true);
    try {
      // Step 1: Pre-verify username uniqueness in database
      const normalized = cleanNick.toLowerCase();
      const usernameDocRef = doc(db, "usernames", normalized);
      let usernameSnap = null;
      try {
        usernameSnap = await getDoc(usernameDocRef);
      } catch (getDocError: any) {
        console.error("Uniqueness lookup failed with error:", getDocError);
        setAuthError(`Uniqueness lookup denied: ${getDocError.message || getDocError}`);
        setIsSigningIn(false);
        return;
      }

      if (usernameSnap && usernameSnap.exists()) {
        setAuthError("This username is already used! Please choose another name.");
        setIsSigningIn(false);
        return;
      }

      // Step 2: Attempt standard Firebase auth record creation
      let credential;
      try {
        credential = await createUserWithEmailAndPassword(auth, cleanEmail, signPassword);
      } catch (authErr: any) {
        console.error("Auth user registration failed:", authErr);
        if (authErr.code === "auth/email-already-in-use") {
          setAuthError("This email address is already registered or in use!");
        } else if (authErr.code === "auth/weak-password") {
          setAuthError("Password is too weak! Try a longer password.");
        } else {
          setAuthError(`Auth registration error: ${authErr.message || authErr}`);
        }
        setIsSigningIn(false);
        return;
      }

      const user = credential.user;

      // Step 3: Set Username Lock document synchronously after creation
      try {
        await setDoc(usernameDocRef, {
          uid: user.uid,
          email: cleanEmail,
          createdAt: serverTimestamp()
        });
      } catch (setDocUsernameError: any) {
        console.error("Setting username unique lock failed:", setDocUsernameError);
        setAuthError(`Username unique-lock write failed: ${setDocUsernameError.message || setDocUsernameError}`);
        setIsSigningIn(false);
        return;
      }

      // Step 4: Set the central user profile document
      const userRef = doc(db, "users", user.uid);
      const generatedId = generateSweetID();
      
      const freshProfile: UserProfile = {
        uid: user.uid,
        displayName: cleanNick,
        photoURL: "https://images.unsplash.com/photo-1511381939415-e44015466834?w=150&auto=format&fit=crop",
        uniqueId: generatedId,
        createdAt: serverTimestamp(),
      };

      try {
        await setDoc(userRef, freshProfile);
        setProfile(freshProfile);
      } catch (setDocUserError: any) {
        console.error("Setting user profile failed:", setDocUserError);
        setAuthError(`Profile document registration failed: ${setDocUserError.message || setDocUserError}`);
        setIsSigningIn(false);
        return;
      }

      // Successful Registration cleanup
      setSignName("");
      setSignEmail("");
      setSignPassword("");
    } catch (err: any) {
      console.error("Unhandled registration error branch:", err);
      if (err.code === "auth/email-already-in-use" || err?.message?.includes("already")) {
        setAuthError("This account registration is already used.");
      } else {
        setAuthError(err.message || "Registration encountered an unexpected issue.");
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

          <div className="flex flex-col items-center space-y-4 w-full pt-2">
            {authError && (
              <div className="text-[10px] text-red-600 bg-red-50 border border-red-200 p-2.5 rounded-xl font-sans font-semibold text-center leading-normal w-full">
                ⚠️ {authError}
              </div>
            )}

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
              className="w-full flex items-center justify-center space-x-2.5 rounded-2xl border border-[#E8E1D5] bg-white hover:bg-[#FDFCFB] text-[#2D1B08] py-4 text-sm font-bold shadow-md transition-all sm:hover:scale-[1.01] active:scale-[0.98] outline-none disabled:opacity-50 cursor-pointer"
            >
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{isSigningIn ? "Signing you in..." : "Continue with Google"}</span>
            </button>
          </div>
          </div>
        </motion.div>
      </div>
    );
  }
  // Logged-in application space layout Dashboard
  return (
    <div className="h-screen w-screen bg-white flex flex-col relative overflow-hidden">
      
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

      <div className={`w-full h-full flex overflow-hidden transition-colors duration-200 ${
        theme === "black" ? "bg-[#09090b] text-white" : "bg-white text-[#2D1B08]"
      }`}>
        
        {/* Left Side: Sidebar Column */}
        <div className={`w-80 border-r flex flex-col justify-between transition-colors duration-200 ${
          theme === "black" ? "bg-black border-zinc-800 text-white" : "bg-white border-[#E8E1D5] text-[#2D1B08]"
        }`}>
          
          {/* Top Panel: Profiler metadata & Settings trigger */}
          <div className={`p-6 border-b transition-colors duration-200 ${
            theme === "black" ? "bg-black border-zinc-800" : "bg-white border-[#E8E1D5]"
          }`}>
            <div className="flex items-center justify-between mb-4 leading-none">
              <div 
                onClick={() => setShowEditProfile(true)}
                className="flex items-center space-x-2.5 cursor-pointer group"
              >
                <img
                  src={profile.photoURL}
                  referrerPolicy="no-referrer"
                  alt={profile.displayName}
                  className={`h-10 w-10 rounded-full object-cover border group-hover:border-[#7B3F00] transition shadow-sm ${
                    theme === "black" ? "border-zinc-700 bg-zinc-900" : "border-[#E8E1D5] bg-white"
                  }`}
                />
                <div className="text-left select-none">
                  <span className={`block font-sans font-bold text-sm leading-tight group-hover:text-[#7B3F00] transition truncate max-w-[120px] ${
                    theme === "black" ? "text-zinc-100" : "text-[#2D1B08]"
                  }`}>
                    {profile.displayName}
                  </span>
                  <span className="block font-mono text-[9px] text-gray-400 leading-none mt-0.5">
                    Settings & Profile
                  </span>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className={`rounded-full p-2 transition shadow-sm ${
                  theme === "black" 
                    ? "bg-[#18181b] text-zinc-400 hover:bg-zinc-800 hover:text-white" 
                    : "bg-[#F5F1EB] text-gray-500 hover:bg-[#E8E1D5] hover:text-[#7B3F00]"
                }`}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

            {/* Display Unique non-changeable numeric ID button to launch newly added scanning/writing view */}
            <button
              id="sidebar-show-id-trigger"
              onClick={() => setShowShowId(true)}
              className={`w-full flex items-center justify-between rounded-lg px-3 py-2 border transition font-mono text-left cursor-pointer group ${
                theme === "black" 
                  ? "bg-[#18181b] border-zinc-800 hover:bg-zinc-800" 
                  : "bg-[#F5F1EB] border-[#E8E1D5] hover:bg-[#E8E1D5]"
              }`}
            >
              <span className={`text-[8px] font-bold uppercase tracking-widest leading-none ${
                theme === "black" ? "text-zinc-500" : "text-gray-400"
              }`}>
                My Choc ID:
              </span>
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-bold text-[#7B3F00] tracking-widest leading-none">
                  {profile.uniqueId}
                </span>
                <span className="text-[8px] bg-[#7B3F00]/10 text-[#7B3F00] px-1 py-0.5 rounded font-extrabold uppercase leading-none">
                  Show
                </span>
              </div>
            </button>
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
        <div className={`flex-1 flex items-center justify-center p-0 relative h-full transition-colors duration-200 ${
          theme === "black" ? "bg-black" : "bg-white"
        }`}>
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
              theme={theme}
            />
          ) : (
            <div className="text-center p-8 flex flex-col items-center space-y-4 choose-prompt select-none">
              <div className={`h-16 w-16 rounded-full flex items-center justify-center border shadow-sm animate-pulse ${
                theme === "black" ? "bg-zinc-900 border-zinc-800 text-white" : "bg-[#FDFBF7] border-[#E8E1D5] text-[#7B3F00]"
              }`}>
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
            theme={theme}
            onThemeChange={handleThemeChange}
          />
        )}

        {showShowId && (
          <ShowIdModal
            profile={profile}
            onClose={() => setShowShowId(false)}
            theme={theme}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
