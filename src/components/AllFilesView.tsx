import React, { useState, useEffect } from "react";
import { 
  ArrowLeft, Search, Image as ImageIcon, Download, 
  UploadCloud, Share2, Clipboard, AppWindow, Clock, 
  Trash2, Filter, FolderClosed, Layers, FileImage
} from "lucide-react";
import { collection, onSnapshot, addDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { UserProfile } from "../types";

interface AllFilesViewProps {
  currentUser: any;
  profile: UserProfile;
  joinedChats: any[];
  onNavigateBack: () => void;
}

export default function AllFilesView({ 
  currentUser, 
  profile, 
  joinedChats, 
  onNavigateBack 
}: AllFilesViewProps) {
  const [allFiles, setAllFiles] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedChatFilter, setSelectedChatFilter] = useState("all");
  const [uploadTargetChat, setUploadTargetChat] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [selectedImg, setSelectedImg] = useState<any | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Populate first available chat as default uploader destination
  useEffect(() => {
    if (joinedChats.length > 0 && !uploadTargetChat) {
      setUploadTargetChat(joinedChats[0].chatId);
    }
  }, [joinedChats, uploadTargetChat]);

  // Aggregate files from all joined chats in real-time
  useEffect(() => {
    if (joinedChats.length === 0) return;

    const unsubscribes = joinedChats.map((chat) => {
      const messagesRef = collection(db, "chats", chat.chatId, "messages");
      
      return onSnapshot(messagesRef, (snap) => {
        const filesFromChat = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            if (!d.photoUrl) return null;
            return {
              id: docSnap.id,
              chatId: chat.chatId,
              chatName: chat.displayName || "Direct Message",
              senderId: d.senderId,
              senderName: d.senderName,
              senderPhoto: d.senderPhoto,
              text: d.text || "Shared photo",
              photoUrl: d.photoUrl,
              createdAt: d.createdAt?.toDate() || new Date(),
            };
          })
          .filter((item): item is any => item !== null);

        setAllFiles((prev) => {
          // Remove outdated entries of this chat to prevent state duplication
          const filtered = prev.filter((f) => f.chatId !== chat.chatId);
          const combined = [...filtered, ...filesFromChat];
          // Sort Chronologically descending
          return combined.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        });
      }, (error) => {
        console.warn(`Error compiling repository list for chat ${chat.chatId}:`, error);
      });
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [joinedChats]);

  // Handle local downscale compression and database insertion
  const processAndUploadFile = (file: File) => {
    if (!uploadTargetChat) {
      setUploadError("Please select a target chat thread first.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setUploadError("Only image file formats can be synchronized in the archive.");
      return;
    }

    setUploading(true);
    setUploadError("");
    setUploadSuccess(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = document.createElement("img");
      img.src = event.target?.result as string;
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const MAX_DIM = 600; // Premium high definition maximum dimension for files website
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

        const base64JPEG = canvas.toDataURL("image/jpeg", 0.75); // high visual crispness

        try {
          const messagesRef = collection(db, "chats", uploadTargetChat, "messages");
          const fileDocId = "archive-img-" + Math.random().toString(36).substring(2, 11);

          await addDoc(messagesRef, {
            id: fileDocId,
            senderId: profile.uid,
            senderName: profile.displayName,
            senderPhoto: profile.photoURL,
            text: `📁 Central Archive upload: ${file.name}`,
            photoUrl: base64JPEG,
            createdAt: serverTimestamp(),
            readBy: [profile.uid],
          });

          // Sync last state text on parent
          await updateDoc(doc(db, "chats", uploadTargetChat), {
            lastMessageText: `📁 Uploaded file: ${file.name}`,
            lastMessageTime: serverTimestamp(),
          });

          setUploadSuccess(true);
          setTimeout(() => setUploadSuccess(false), 4000);
        } catch (err: any) {
          console.error(err);
          setUploadError(`Failed archiving file metadata: ${err.message || err}`);
        } finally {
          setUploading(false);
        }
      };
    };
    reader.readAsDataURL(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processAndUploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processAndUploadFile(e.target.files[0]);
    }
  };

  const filteredFiles = allFiles.filter((f) => {
    const matchesSearch = 
      f.senderName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.chatName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesChat = selectedChatFilter === "all" || f.chatId === selectedChatFilter;
    return matchesSearch && matchesChat;
  });

  // Export full catalog summary
  const handleExportCatalog = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allFiles, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `CHOC-TALK-FILE-ARCHIVE.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div id="central-files-view" className="h-screen w-screen bg-[#FDFCFB] flex flex-col text-[#2D1B08] overflow-hidden">
      
      {/* Header Panel */}
      <header id="files-header" className="bg-white border-b border-[#E8E1D5] px-6 py-4 flex items-center justify-between z-10">
        <div className="flex items-center space-x-4">
          <button 
            id="back-to-chat-btn"
            onClick={onNavigateBack}
            className="group flex items-center justify-center h-10 w-10 rounded-full border border-[#E8E1D5] hover:bg-[#FDFCFB] transition"
            title="Return to the live chat messenger"
          >
            <ArrowLeft className="h-5 w-5 text-[#7B3F00] group-hover:-translate-x-0.5 transition-transform" />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-sans text-xl font-extrabold tracking-tight">Chocolate Talk File Repository</span>
              <span className="bg-[#7B3F00]/10 text-[#7B3F00] text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-extrabold">/all website</span>
            </div>
            <p className="text-xs text-gray-400">Integrated visual database and cloud media hub for your discussions</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            id="export-archive-btn"
            onClick={handleExportCatalog}
            disabled={allFiles.length === 0}
            className="flex items-center space-x-2 rounded-xl border border-[#E8E1D5] bg-white hover:bg-[#FDFCFB] text-[#7B3F00] px-4 py-2 text-xs font-bold shadow-xs cursor-pointer transition disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span>Export Archive JSON</span>
          </button>
        </div>
      </header>

      {/* Main Container Layout */}
      <main id="files-main-layout" className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-4">
        
        {/* Left Interactive Sidebar: Controls, upload and filters */}
        <section id="files-filter-sidebar" className="bg-white border-r border-[#E8E1D5] p-6 overflow-y-auto space-y-6 lg:col-span-1">
          
          {/* Section: Your Sweet Profile ID */}
          <div className="bg-[#FAF6F0] border border-[#E8E1D5] rounded-2.5xl p-5 space-y-3">
            <span className="text-[10px] font-mono text-[#7B3F00] font-extrabold uppercase tracking-widest block">Logged In Member</span>
            <div className="flex items-center space-x-3">
              <img 
                src={profile.photoURL} 
                alt={profile.displayName} 
                className="h-10 w-10 rounded-full ring-2 ring-[#7B3F00]/20 object-cover" 
              />
              <div className="min-w-0 flex-1">
                <h4 className="font-semibold text-xs text-[#2D1B08] truncate">{profile.displayName}</h4>
                <p className="text-[10px] font-mono text-gray-400 font-bold truncate">ID: {profile.uniqueId}</p>
              </div>
            </div>
          </div>

          {/* Section: Simple instant stats */}
          <div className="space-y-2">
            <span className="text-[10px] font-mono text-gray-400 font-extrabold uppercase tracking-widest block">Talk Metrics</span>
            <div className="grid grid-cols-2 gap-2">
              <div id="stat-files-count" className="bg-[#FAF6F0] p-3.5 rounded-2xl border border-[#E8E1D5] text-center">
                <span className="block text-xl font-extrabold text-[#7B3F00]">{allFiles.length}</span>
                <span className="text-[9px] font-bold text-gray-400 uppercase">Files Total</span>
              </div>
              <div id="stat-rooms-count" className="bg-[#FAF6F0] p-3.5 rounded-2xl border border-[#E8E1D5] text-center">
                <span className="block text-xl font-extrabold text-[#7B3F00]">{joinedChats.length}</span>
                <span className="text-[9px] font-bold text-gray-400 uppercase">Chat Threads</span>
              </div>
            </div>
          </div>

          {/* Section: Search and Channel Filters */}
          <div className="space-y-4">
            <span className="text-[10px] font-mono text-gray-400 font-extrabold uppercase tracking-widest block">Refine Search</span>
            
            <div className="relative">
              <input 
                id="files-search-input"
                type="text"
                placeholder="Search by caption, sender..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full text-xs bg-[#FDFCFB] border border-[#E8E1D5] rounded-xl pl-9 pr-3 py-2.5 focus:outline-none focus:border-[#7B3F00] transition"
              />
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            </div>

            <div className="space-y-1.5">
              <label id="channel-filter-label" className="text-[10px] font-bold text-gray-500 uppercase">Chat Source Folder</label>
              <select
                id="chat-filter-select"
                value={selectedChatFilter}
                onChange={(e) => setSelectedChatFilter(e.target.value)}
                className="w-full text-xs bg-[#FDFCFB] border border-[#E8E1D5] rounded-xl p-3 text-[#2D1B08] focus:outline-none focus:border-[#7B3F00]"
              >
                <option value="all">📁 All Shared Rooms</option>
                {joinedChats.map((room) => (
                  <option key={room.chatId} value={room.chatId}>
                    🍫 {room.displayName || "Direct Chat"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <hr className="border-t border-[#E8E1D5] my-4" />

          {/* Section: Premium Cloud Real-time Uploader */}
          <div className="space-y-3 pt-1">
            <span className="text-[10px] font-mono text-[#7B3F00] font-extrabold uppercase tracking-widest block">Upload to Archive</span>
            
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-gray-400 uppercase">Select Target Talk-Room</label>
              <select
                id="upload-chat-select"
                value={uploadTargetChat}
                onChange={(e) => setUploadTargetChat(e.target.value)}
                className="w-full text-xs bg-[#FDFCFB] border border-[#E8E1D5] rounded-xl p-2 text-[#2D1B08] focus:outline-none"
              >
                {joinedChats.map((room) => (
                  <option key={room.chatId} value={room.chatId}>
                    👉 {room.displayName || "Direct Session"}
                  </option>
                ))}
              </select>
            </div>

            <div 
              id="drag-file-uploader"
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-5 text-center flex flex-col items-center justify-center cursor-pointer transition-all ${
                dragActive 
                  ? "border-[#7B3F00] bg-[#7B3F00]/5" 
                  : "border-[#E8E1D5] hover:border-gray-400 bg-[#FDFCFB]"
              }`}
              onClick={() => document.getElementById("archive-file-input")?.click()}
            >
              <input 
                id="archive-file-input"
                type="file" 
                accept="image/*"
                className="hidden" 
                onChange={handleFileChange}
              />
              <UploadCloud className={`h-8 w-8 mb-2 ${dragActive ? "text-[#7B3F00]" : "text-gray-400"}`} />
              <p className="text-[10px] font-bold text-[#7B3F00]">Drag & drop files or click to upload</p>
              <p className="text-[8px] text-gray-400 mt-1">Accepts PNG, JPG, WEBP and saves to the talk</p>
            </div>

            {/* Upload notifications */}
            {uploading && (
              <p className="text-[10px] text-amber-600 font-semibold animate-pulse text-center">⏳ Compressing and uploading file...</p>
            )}
            {uploadSuccess && (
              <p className="text-[10px] text-green-600 font-bold bg-green-50 p-2 border border-green-200 rounded-xl text-center">✅ Successfully archived and sent to chat!</p>
            )}
            {uploadError && (
              <p className="text-[10px] text-red-600 bg-red-50 p-2 border border-red-200 rounded-xl text-center">⚠️ {uploadError}</p>
            )}
          </div>
        </section>

        {/* Right Content Stream: Masonry-style Grid of shared files */}
        <section id="files-gallery" className="lg:col-span-3 p-6 overflow-y-auto bg-[#FBF9F6]">
          {filteredFiles.length === 0 ? (
            <div id="no-files-card" className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto py-20">
              <div className="h-16 w-16 rounded-full bg-[#7B3F00]/5 flex items-center justify-center mb-4">
                <FolderClosed className="h-8 w-8 text-[#7B3F00]" />
              </div>
              <h3 className="font-sans text-base font-bold text-[#2D1B08]">No archived media matches found</h3>
              <p className="text-xs text-gray-400 mt-2 px-6">
                No images were found matching the selected filters. Use the side panel file uploader or join chat discussions to populate central files database!
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-2 border-b border-[#E8E1D5]">
                <span className="text-xs font-mono font-bold text-[#7B3F00] uppercase tracking-wider">
                  Archived Assets Grid ({filteredFiles.length} item{filteredFiles.length !== 1 ? 's' : ''})
                </span>
                <span className="text-[10px] text-gray-400">Chronological display</span>
              </div>

              {/* Grid of actual files */}
              <div id="media-grid-container" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredFiles.map((file) => (
                  <div 
                    key={file.id} 
                    id={`file-card-${file.id}`}
                    onClick={() => setSelectedImg(file)}
                    className="group bg-white rounded-2xl border border-[#E8E1D5] overflow-hidden hover:shadow-md hover:border-amber-400 cursor-pointer transition duration-300 flex flex-col justify-between"
                  >
                    {/* Media thumbnail */}
                    <div className="relative aspect-square bg-gray-50 flex items-center justify-center overflow-hidden border-b border-[#E8E1D5]">
                      <img 
                        src={file.photoUrl} 
                        alt={file.text} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute top-2 left-2 bg-black/50 text-white text-[8px] font-mono px-2 py-0.5 rounded-full backdrop-blur-xs">
                        {file.chatName}
                      </div>
                    </div>

                    {/* Meta info bottom card */}
                    <div className="p-3 space-y-2">
                      <p className="text-[10px] text-gray-500 font-semibold line-clamp-2 leading-snug">
                        {file.text || "Chocolate File Attachment"}
                      </p>
                      
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center space-x-1.5 min-w-0">
                          <img 
                            src={file.senderPhoto} 
                            alt={file.senderName} 
                            className="h-4.5 w-4.5 rounded-full object-cover" 
                          />
                          <span className="text-[9px] text-gray-400 font-bold truncate">{file.senderName}</span>
                        </div>
                        <span className="text-[8px] text-gray-400 shrink-0">
                          {file.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Lightbox High-Resolution Modal overlay */}
      {selectedImg && (
        <div 
          id="lightbox-overlay"
          className="fixed inset-0 bg-[#2D1B08]/90 z-[100] flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setSelectedImg(null)}
        >
          <div 
            id="lightbox-content-card"
            className="bg-white rounded-[2rem] border border-[#E8E1D5] max-w-3xl w-full flex flex-col overflow-hidden shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Cross button */}
            <button 
              id="close-lightbox"
              onClick={() => setSelectedImg(null)}
              className="absolute top-4 right-4 bg-[#FDFCFB] hover:bg-gray-100 h-9 w-9 rounded-full flex items-center justify-center border border-[#E8E1D5] transition shadow-md text-[#2D1B08] z-20 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4 rotate-45" />
            </button>

            {/* Layout box grid */}
            <div className="grid grid-cols-1 md:grid-cols-5 h-auto max-h-[85vh]">
              {/* Left visual stream */}
              <div className="md:col-span-3 bg-[#FAF6F0] p-6 flex items-center justify-center min-h-[300px] overflow-hidden border-b md:border-b-0 md:border-r border-[#E8E1D5]">
                <img 
                  src={selectedImg.photoUrl} 
                  alt={selectedImg.text} 
                  className="max-h-[50vh] object-contain rounded-xl shadow-sm"
                  referrerPolicy="no-referrer"
                />
              </div>

              {/* Right metadata profile details stream */}
              <div className="md:col-span-2 p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-4">
                  <div>
                    <span className="bg-[#7B3F00]/10 text-[#7B3F00] text-[8px] uppercase tracking-widest font-mono px-2 py-0.5 rounded-full font-extrabold">Archive File Record</span>
                    <h3 className="font-sans text-lg font-bold text-[#2D1B08] mt-2 leading-snug">
                      {selectedImg.text || "Chocolate File Attachment"}
                    </h3>
                  </div>

                  {/* Room name folder representation */}
                  <div className="bg-[#FAF6F0] rounded-xl p-3 border border-[#E8E1D5] flex items-center space-x-2">
                    <FolderClosed className="h-4 w-4 text-[#7B3F00]" />
                    <div>
                      <span className="block text-[8px] text-gray-400 uppercase font-mono leading-none">Chat Channel</span>
                      <span className="text-xs font-bold text-[#2D1B08]">{selectedImg.chatName}</span>
                    </div>
                  </div>

                  {/* Sender user profile */}
                  <div className="flex items-center space-x-3.5 pt-1">
                    <img 
                      src={selectedImg.senderPhoto} 
                      alt={selectedImg.senderName} 
                      className="h-9 w-9 rounded-full object-cover shadow-xs" 
                    />
                    <div>
                      <span className="block text-[8px] text-gray-400 uppercase font-mono leading-none">Shared By</span>
                      <span className="text-xs font-bold text-[#2D1B08]">{selectedImg.senderName}</span>
                    </div>
                  </div>

                  {/* Date sharing info */}
                  <div className="flex items-center space-x-2.5 text-xs text-gray-400 font-mono">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span>{selectedImg.createdAt.toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex space-x-2 pt-4 border-t border-[#E8E1D5]">
                  <a 
                    id="lightbox-download-href"
                    href={selectedImg.photoUrl} 
                    download={`choc-talk-attachment-${selectedImg.id}.jpg`}
                    className="flex-1 flex items-center justify-center space-x-2 bg-[#7B3F00] hover:bg-[#5C2E00] text-amber-50 rounded-xl py-3 text-xs font-bold tracking-tight shadow-md transition click-pointer cursor-copy text-center"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download file</span>
                  </a>
                  <button 
                    id="lightbox-copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedImg.photoUrl);
                      alert("Successfully copied image Base64 to clipboard!");
                    }}
                    className="flex items-center justify-center h-12 w-12 rounded-xl border border-[#E8E1D5] bg-[#FDFCFB] hover:bg-gray-100 transition text-[#2D1B08]"
                    title="Copy full base64 representation"
                  >
                    <Clipboard className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
