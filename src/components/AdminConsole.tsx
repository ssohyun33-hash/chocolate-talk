import React, { useState, useEffect } from "react";
import { 
  db, handleFirestoreError 
} from "../firebase";
import { 
  collection, getDocs, doc, setDoc, deleteDoc, 
  query, where, addDoc, serverTimestamp, onSnapshot 
} from "firebase/firestore";
import { 
  Search, Users, ShieldAlert, Megaphone, UserX, 
  Trash, MessageCircle, RefreshCw, Check, AlertTriangle, Eye 
} from "lucide-react";
import { UserProfile, Chat, UserReport } from "../types";

interface AdminConsoleProps {
  onSelectChatId: (chatId: string) => void;
  onInspectUser: (user: UserProfile) => void;
  onClose: () => void;
  inspectingUser: UserProfile | null;
  onStopInspecting: () => void;
}

export default function AdminConsole({ 
  onSelectChatId, 
  onInspectUser, 
  onClose,
  inspectingUser,
  onStopInspecting
}: AdminConsoleProps) {
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{
    players: UserProfile[];
    chats: Chat[];
  }>({ players: [], chats: [] });

  // System overview lists
  const [allReports, setAllReports] = useState<UserReport[]>([]);
  const [bannedUids, setBannedUids] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Announcement tools
  const [announcementText, setAnnouncementText] = useState("");
  const [announcementStyle, setAnnouncementStyle] = useState<"ios" | "android" | "global">("ios");
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const [announcementSuccess, setAnnouncementSuccess] = useState(false);

  // 1. Subscribe to reports and bans lists in real time
  useEffect(() => {
    // Reports
    const unsubReports = onSnapshot(collection(db, "reports"), (snap) => {
      const list: UserReport[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          reporterId: d.reporterId,
          reporterName: d.reporterName,
          reportedUid: d.reportedUid,
          reportedName: d.reportedName,
          reason: d.reason,
          timestamp: d.timestamp,
        });
      });
      setAllReports(list);
      setLoading(false);
    });

    // Bans
    const unsubBans = onSnapshot(collection(db, "bans"), (snap) => {
      const list: string[] = [];
      snap.forEach((docSnap) => {
        list.push(docSnap.id);
      });
      setBannedUids(list);
    });

    return () => {
      unsubReports();
      unsubBans();
    };
  }, []);

  // 2. Perform safe, non-blocking search on change
  useEffect(() => {
    const triggerSearch = async () => {
      if (!searchQuery.trim()) {
        setSearchResults({ players: [], chats: [] });
        return;
      }
      
      try {
        const queryTerm = searchQuery.toLowerCase().trim();
        
        // Match users
        const usersSnap = await getDocs(collection(db, "users"));
        const matchedPlayers: UserProfile[] = [];
        usersSnap.forEach((docSnap) => {
          const d = docSnap.data();
          const displayName = (d.displayName || "").toLowerCase();
          const uniqueId = (d.uniqueId || "");
          if (displayName.includes(queryTerm) || uniqueId.includes(queryTerm)) {
            matchedPlayers.push({
              uid: d.uid,
              displayName: d.displayName,
              photoURL: d.photoURL,
              uniqueId: d.uniqueId,
              createdAt: d.createdAt,
            });
          }
        });

        // Match chats
        const chatsSnap = await getDocs(collection(db, "chats"));
        const matchedChats: Chat[] = [];
        chatsSnap.forEach((docSnap) => {
          const d = docSnap.data();
          const name = (d.name || "").toLowerCase();
          if (name.includes(queryTerm) && d.isGroup) {
            matchedChats.push({
              id: docSnap.id,
              name: d.name,
              isGroup: d.isGroup,
              hostId: d.hostId,
              createdAt: d.createdAt,
              lastMessageText: d.lastMessageText,
            });
          }
        });

        // Exclude admin if wanted, or retain all
        setSearchResults({ players: matchedPlayers, chats: matchedChats });
      } catch (err) {
        console.error("Searching database directories failed: ", err);
      }
    };

    const delayDebounceFn = setTimeout(() => {
      triggerSearch();
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  // 3. User Ban Management actions
  const handleToggleBan = async (uid: string, name: string) => {
    const isCurrentlyBanned = bannedUids.includes(uid);
    try {
      if (isCurrentlyBanned) {
        // Lift Ban
        await deleteDoc(doc(db, "bans", uid));
        alert(`Account ban removed for: ${name}`);
      } else {
        // Apply Ban
        await setDoc(doc(db, "bans", uid), {
          uid: uid,
          displayName: name,
          bannedAt: serverTimestamp(),
          reason: "Violated community guidelines (Reported by multiple users)",
        });
        alert(`Account successfully BANNED: ${name}`);
      }
    } catch (err) {
      console.error("Ban transaction failed: ", err);
    }
  };

  // 4. Send Custom Alert broadcasts
  const handlePublishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!announcementText.trim() || sendingAnnouncement) return;
    setSendingAnnouncement(true);
    setAnnouncementSuccess(false);

    try {
      const docId = "ann-" + Math.random().toString(36).substring(2, 11);
      await setDoc(doc(db, "announcements", docId), {
        id: docId,
        text: announcementText.trim(),
        type: announcementStyle,
        timestamp: serverTimestamp(),
      });
      setAnnouncementText("");
      setAnnouncementSuccess(true);
      setTimeout(() => setAnnouncementSuccess(false), 5000);
    } catch (err) {
      console.error("Announcement failed sending: ", err);
    } finally {
      setSendingAnnouncement(false);
    }
  };

  // 5. Delete specific user reports
  const handleDeleteReport = async (reportId: string) => {
    try {
      await deleteDoc(doc(db, "reports", reportId));
    } catch (err) {
      console.error("Deleting report failed:", err);
    }
  };

  // Helper check: has a player been reported at least once?
  const isPlayerReported = (uid: string) => {
    return allReports.some((r) => r.reportedUid === uid);
  };

  return (
    <div className="flex h-full w-full flex-col bg-white overflow-hidden select-none">
      {/* Search and Navigation Title block */}
      <div className="flex h-20 items-center justify-between border-b border-[#E8E1D5] bg-white px-8 shrink-0">
        <div className="flex items-center space-x-2.5">
          <ShieldAlert className="h-5 w-5 text-[#7B3F00]" />
          <div>
            <h1 className="font-sans font-bold text-sm text-[#2D1B08] tracking-tight leading-tight">
              Chocolate Talk Admin Console
            </h1>
            <p className="text-[10px] text-gray-400 font-mono leading-none mt-0.5 font-bold uppercase tracking-wider">
              Moderator Controls & Telemetry
            </p>
          </div>
        </div>

        {inspectingUser ? (
          <div className="flex items-center space-x-2 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl font-sans text-xs">
            <span className="font-bold text-amber-700">Currently Inspecting: {inspectingUser.displayName}</span>
            <button 
              onClick={onStopInspecting}
              className="text-amber-900 underline font-bold hover:text-amber-950 transition ml-1"
            >
              Stop Inspecting
            </button>
          </div>
        ) : (
          <span className="text-[10px] px-2.5 py-1 text-green-700 bg-green-50 border border-green-200 rounded-full font-bold select-none leading-none">
            ● Active
          </span>
        )}
      </div>

      {/* Main Workspace split panel split screen: Reports (Left) and Tools (Right) */}
      <div className="flex flex-1 overflow-hidden p-6 gap-6 bg-[#FAF8F5]">
        
        {/* Left Hand: Active user audits & reports list */}
        <div className="flex-1 flex flex-col min-w-0 bg-white border border-[#E8E1D5] rounded-3xl p-5 shadow-2xs">
          <div className="flex items-center justify-between border-b border-[#E8E1D5] pb-3 mb-4">
            <span className="font-sans font-bold text-xs text-[#2D1B08] uppercase tracking-wider">
              Submitted User Reports ({allReports.length})
            </span>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center py-20">
              <RefreshCw className="h-6 w-6 animate-spin text-gray-300" />
            </div>
          ) : allReports.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-[#E8E1D5] bg-[#FDFBF7] rounded-2xl">
              <Check className="h-8 w-8 text-green-500 mb-2" />
              <p className="text-xs font-bold text-gray-500 mb-0.5">Community Is Peaceful</p>
              <p className="text-[10px] text-gray-400 max-w-xs">No user reports have been issued. Maintain chocolate standards!</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {allReports.map((report) => {
                const isBanned = bannedUids.includes(report.reportedUid);
                return (
                  <div 
                    key={report.id} 
                    className="p-3.5 border border-[#E8E1D5] bg-[#FDFBF7] hover:bg-[#FAF6F0] transition rounded-2xl flex flex-col space-y-2.5 relative"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center space-x-1.5 flex-wrap">
                          <span className="text-xs font-bold text-[#2D1B08] truncate max-w-[124px]">
                            {report.reportedName}
                          </span>
                          <span className="text-[8px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-mono font-bold uppercase select-none leading-none">
                            UID: {report.reportedUid.slice(0, 6)}...
                          </span>
                          {isBanned && (
                            <span className="text-[8px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded font-mono font-bold uppercase select-none leading-none">
                              Banned
                            </span>
                          )}
                        </div>
                        <span className="block text-[10px] text-gray-400">
                          Reporter: {report.reporterName}
                        </span>
                      </div>

                      <button 
                        onClick={() => handleDeleteReport(report.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                        title="Dismiss Report"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-[#E8E1D5] text-[11px] text-gray-600 leading-relaxed font-sans italic">
                      "{report.reason}"
                    </div>

                    {/* Report Specific Actions */}
                    <div className="flex space-x-2 pt-0.5">
                      <button
                        onClick={() => handleToggleBan(report.reportedUid, report.reportedName)}
                        className={`flex-1 flex items-center justify-center space-x-1 py-1.5 rounded-xl font-sans text-[10px] font-bold transition border ${
                          isBanned 
                            ? "bg-green-50 border-green-200 text-green-700 hover:bg-green-100" 
                            : "bg-red-50 border-red-200 text-red-600 hover:bg-red-100"
                        }`}
                      >
                        <UserX className="h-3 w-3" />
                        <span>{isBanned ? "Pardon User" : "Ban Player"}</span>
                      </button>

                      <button
                        onClick={() => onInspectUser({
                          uid: report.reportedUid,
                          displayName: report.reportedName,
                          photoURL: "https://images.unsplash.com/photo-1511381939415-e44015466834?w=150&auto=format&fit=crop",
                          uniqueId: "REPORTED",
                          createdAt: null
                        })}
                        className="flex-1 flex items-center justify-center space-x-1 py-1.5 rounded-xl bg-[#7B3F00] hover:bg-[#5C2E00] text-amber-50 font-bold font-sans text-[10px] transition shadow-xs"
                      >
                        <Eye className="h-3 w-3" />
                        <span>Go In / Inspect Account</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Hand: Search directories & Broadcasting tools */}
        <div className="w-80 flex flex-col gap-6 shrink-0">
          
          {/* Box 1: Directory Search */}
          <div className="bg-white border border-[#E8E1D5] p-5 rounded-3xl flex flex-col min-h-[220px]">
            <span className="font-sans font-bold text-xs text-[#2D1B08] uppercase tracking-wider mb-2.5">
              Database Search
            </span>

            <div className="relative mb-3.5">
              <Search className="absolute top-2.5 left-2.5 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder="Search Group Chats or Players..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-8.5 pr-3 py-2.5 border border-[#E8E1D5] rounded-xl focus:outline-none focus:border-[#7B3F00] placeholder-gray-400 bg-white"
              />
            </div>

            {searchQuery.trim() ? (
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 max-h-48">
                {/* MATCHED PLAYERS LIST */}
                {searchResults.players.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="block text-[9px] uppercase tracking-wider text-gray-400 font-bold font-mono">
                      Players Matching
                    </span>
                    {searchResults.players.map((u) => {
                      const reported = isPlayerReported(u.uid);
                      return (
                        <div key={u.uid} className="flex items-center justify-between p-2 rounded-xl bg-[#FDFBF7] border border-[#E8E1D5] text-[11px]">
                          <div className="flex items-center space-x-2 truncate max-w-[140px]">
                            <img src={u.photoURL} className="h-6 w-6 rounded-full" alt="" />
                            <span className="font-bold text-[#2D1B08] truncate">{u.displayName}</span>
                          </div>
                          
                          {/* Admin can only inspect if reported by at least 1 person */}
                          {reported ? (
                            <button
                              onClick={() => onInspectUser(u)}
                              className="text-[9px] font-bold text-amber-50 bg-[#7B3F00] hover:bg-[#5C2E00] px-2 py-1 rounded shadow-3xs transition"
                              title="Inspect reported account"
                            >
                              Go In
                            </button>
                          ) : (
                            <span 
                              className="text-[8px] bg-gray-100 text-gray-400 font-bold px-1.5 py-0.5 rounded cursor-not-allowed select-none"
                              title="Only accounts reported by users can be inspected"
                            >
                              Locked
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* MATCHED CHATS LIST */}
                {searchResults.chats.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="block text-[9px] uppercase tracking-wider text-gray-400 font-bold font-mono">
                      Group Chats
                    </span>
                    {searchResults.chats.map((c) => (
                      <div key={c.id} className="flex items-center justify-between p-2 rounded-xl bg-[#FDFBF7] border border-[#E8E1D5] text-[11px]">
                        <div className="flex items-center space-x-2 truncate max-w-[140px]">
                          <MessageCircle className="h-3.5 w-3.5 text-[#7B3F00]" />
                          <span className="font-bold text-[#2D1B08] truncate">{c.name}</span>
                        </div>
                        <button
                          onClick={() => onSelectChatId(c.id)}
                          className="text-[9px] font-bold text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded shadow-3xs transition"
                        >
                          Spectate
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {searchResults.players.length === 0 && searchResults.chats.length === 0 && (
                  <div className="text-center text-[10px] text-gray-400 py-4 font-sans select-none">
                    No matching records found.
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center p-4">
                <p className="text-[10px] text-gray-400 font-sans max-w-[180px]">
                  Enter a keyword to inspect reported players or spectate any group chats.
                </p>
              </div>
            )}
          </div>

          {/* Box 2: System Broadcast announcements with iOS/Android alerts! */}
          <div className="bg-white border border-[#E8E1D5] p-5 rounded-3xl flex flex-col">
            <span className="font-sans font-bold text-xs text-[#2D1B08] uppercase tracking-wider mb-2.5 flex items-center space-x-1.5">
              <Megaphone className="h-4 w-4 text-[#7B3F00]" />
              <span>Broadcast Alerts</span>
            </span>

            <form onSubmit={handlePublishAnnouncement} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-gray-400 uppercase font-mono">
                  Payload text
                </label>
                <textarea
                  value={announcementText}
                  onChange={(e) => setAnnouncementText(e.target.value)}
                  placeholder="Publish global message (iOS/Android styled notifications will banner instantly on all client runtimes)..."
                  required
                  rows={2}
                  className="w-full text-xs p-2 rounded-lg border border-[#E8E1D5] bg-white focus:outline-none focus:border-[#7B3F00] placeholder-gray-300"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-gray-400 uppercase font-mono">
                  Banner Rendering style
                </label>
                <div className="grid grid-cols-3 gap-1 grid-flow-row text-[9px] font-bold font-sans text-center">
                  <button
                    type="button"
                    onClick={() => setAnnouncementStyle("ios")}
                    className={`p-1.5 rounded-lg border transition ${
                      announcementStyle === "ios" 
                        ? "bg-[#7B3F00] text-amber-50 border-[#7B3F00]" 
                        : "bg-[#FAF8F5] text-gray-500 border-[#E8E1D5] hover:bg-gray-50"
                    }`}
                  >
                    Apple iOS
                  </button>

                  <button
                    type="button"
                    onClick={() => setAnnouncementStyle("android")}
                    className={`p-1.5 rounded-lg border transition ${
                      announcementStyle === "android" 
                        ? "bg-[#7B3F00] text-amber-50 border-[#7B3F00]" 
                        : "bg-[#FAF8F5] text-gray-500 border-[#E8E1D5] hover:bg-gray-50"
                    }`}
                  >
                    Android
                  </button>

                  <button
                    type="button"
                    onClick={() => setAnnouncementStyle("global")}
                    className={`p-1.5 rounded-lg border transition ${
                      announcementStyle === "global" 
                        ? "bg-[#7B3F00] text-amber-50 border-[#7B3F00]" 
                        : "bg-[#FAF8F5] text-gray-500 border-[#E8E1D5] hover:bg-gray-50"
                    }`}
                  >
                    Classic banner
                  </button>
                </div>
              </div>

              {announcementSuccess && (
                <div className="text-[10px] text-green-600 bg-green-50 border border-green-200 p-2 rounded-lg font-sans font-medium text-center">
                  ✓ Broadcast payload synchronized!
                </div>
              )}

              <button
                type="submit"
                disabled={sendingAnnouncement || !announcementText.trim()}
                className="w-full py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-100 text-white font-sans text-[11px] font-bold rounded-xl shadow-xs transition"
              >
                {sendingAnnouncement ? "Broadcasting..." : "Synchronize System Announcement"}
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}
