export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  uniqueId: string; // Unchangeable 8-digit ID
  createdAt: any;
  email?: string;
}

export interface Friend {
  friendId: string;
  displayName: string;
  photoURL: string;
  uniqueId: string;
  addedAt: any;
}

export interface Chat {
  id: string;
  name: string;
  isGroup: boolean;
  hostId: string;
  createdAt: any;
  lastMessageText?: string;
  lastMessageTime?: any;
}

export interface ChatMember {
  userId: string;
  displayName: string;
  photoURL: string;
  role: 'host' | 'member';
  joinedAt: any;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderPhoto: string;
  text: string;
  photoUrl?: string; // Optional image base64
  createdAt: any;
  readBy: string[]; // List of user IDs who opened this chat and viewed this message
}

export interface UserReport {
  id: string;
  reporterId: string;
  reporterName: string;
  reportedUid: string;
  reportedName: string;
  reason: string;
  timestamp: any;
}

export interface BanRecord {
  uid: string;
  reason: string;
  bannedAt: any;
}
