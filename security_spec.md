# Security Specification & Test Scenarios

## 1. Data Invariants
- **Profile Uniqueness**: Every user must have a unique unchangeable ID (`uniqueId` consisting of an 8-digit numeric code). Once chosen, it cannot be modified by the user.
- **Strict Read Bounds**: Direct and group message logs (`chats/{chatId}/messages/{msgId}`) can ONLY be read or listed by accounts registered in the chat's `members` subcollection.
- **Relational Integrity**: A user can only append messages to chats where they are an active, registered participant.
- **Host Immunity**: Only the visual custom chat host (the account matching `chats/{chatId}.hostId`) is permitted to delete the entire chat document.
- **Immutable Timestamps**: Messages must align with server time (`request.time`). Custom client timelines are strictly forbidden.

## 2. The "Dirty Dozen" Payloads (Threat Vectors)

1. **Anonymous Message Insertion**: Writing directly to `/chats/{chatId}/messages/{msgId}` without authenticating.
2. **Identity Theft / Spoofing**: Creating a user profile under `/users/{attackerUid}` with `displayName` belonging to another user, or writing with `uid` that does not match `request.auth.uid`.
3. **Change Locked customId**: Trying to perform an update on `/users/{userId}` to alter the computed `uniqueId` after the profile was created.
4. **Foreign Friend Spammer**: Writing a friend document under `/users/{targetUid}/friends/{addedId}` where `targetUid` is NOT the attacker's UID (i.e. adding friends on behalf of others).
5. **Private Message Snooping**: Listing `/chats/{secretChatId}/messages` when the attacker is not in `/chats/{secretChatId}/members`.
6. **Malicious Message Fabrication**: Posting a message with `senderId` set to a victim's UID instead of `request.auth.uid`.
7. **Time Distortion Attack**: Creating a message with a custom client-side `createdAt` set to a future or far-off date instead of `request.time`.
8. **Unauthorized Group Eradication**: A regular participant attempting to delete the chat document at `/chats/{chatId}` where `hostId` != attacker UID.
9. **Kicking the Group Host**: A regular member attempting to delete the host's membership record under `/chats/{chatId}/members/{hostUid}`.
10. **Shadow Field Injection**: Writing an undocumented field (`isAdmin: true`) inside `/users/{uid}` profile update.
11. **Spoofed Read Receipt Injection**: Modifying the `text` or `senderId` of a message when marking it as read (only `readBy` should be appended).
12. **Bloated Payload Submission**: Creating a message with a text field exceeding 10,000 characters to consume storage.

## 3. Test Runner Design (`firestore.rules.test.ts`)

```typescript
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";

describe("Chocolate Talk Security Rules", () => {
  let testEnv;

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "spartan-dolphin-p8gvj",
      firestore: {
        host: "localhost",
        port: 8080,
      },
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  it("Vector 1: Reject anonymous message insertion", async () => {
    const context = testEnv.unauthenticatedContext();
    const db = context.firestore();
    const docRef = db.collection("chats").doc("chat1").collection("messages").doc("msg1");
    await assertFails(docRef.set({ text: "Hello", senderId: "anon" }));
  });

  it("Vector 2: Reject user profile write if UID mismatches", async () => {
    const context = testEnv.authenticatedContext("attacker");
    const db = context.firestore();
    const docRef = db.collection("users").doc("victim");
    await assertFails(docRef.set({ uid: "victim", displayName: "Victim", uniqueId: "12345678", createdAt: new Date() }));
  });

  it("Vector 3: Prevent modifying uniqueId after creation", async () => {
    const context = testEnv.authenticatedContext("user1");
    const db = context.firestore();
    const docRef = db.collection("users").doc("user1");
    // Initial profile
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection("users").doc("user1").set({
        uid: "user1",
        displayName: "User One",
        uniqueId: "12345678",
        createdAt: new Date(),
      });
    });
    // Attempt update
    await assertFails(docRef.update({ uniqueId: "87654321" }));
  });

  it("Vector 4: Prevent adding friends on behalf of other users", async () => {
    const context = testEnv.authenticatedContext("attacker");
    const db = context.firestore();
    const docRef = db.collection("users").doc("victim").collection("friends").doc("friend1");
    await assertFails(docRef.set({ friendId: "friend1", displayName: "Friend", uniqueId: "88888888", addedAt: new Date() }));
  });

  it("Vector 5: Prevent message snooping in unjoined group chat", async () => {
    const context = testEnv.authenticatedContext("attacker");
    const db = context.firestore();
    const chatDoc = db.collection("chats").doc("secretGroup");
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await adminDb.collection("chats").doc("secretGroup").set({ id: "secretGroup", isGroup: true, hostId: "victim", createdAt: new Date() });
      await adminDb.collection("chats").doc("secretGroup").collection("messages").doc("m1").set({ text: "Secret stuff", senderId: "victim", readBy: ["victim"], createdAt: new Date() });
    });
    // Attacker was not added to /members/ subcollection
    await assertFails(chatDoc.collection("messages").get());
  });
});
```
