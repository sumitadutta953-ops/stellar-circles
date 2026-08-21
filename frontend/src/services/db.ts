// db.ts - Real Firebase Integration
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, deleteField, collection, onSnapshot, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);

export interface UserProfile {
  id: string;
  name: string;
  reputationScore: number;
}

export interface CircleMetadata {
  id: string; // The on-chain circle ID
  name: string;
  description: string;
  contributionAmount: string;
  memberCap: number; // Max members before cycle starts
  currentCycle: number;
  status: 'active' | 'completed' | 'deleted';
  organizer: string;
  inviteCode: string;
  memberProfiles: Record<string, UserProfile>;
  // Tracking contributions per cycle: cycleNumber -> array of wallet addresses who paid
  contributions: Record<number, string[]>;
}

class FirestoreDB {
  subscribeToCircles(walletAddress: string, callback: (circles: CircleMetadata[]) => void): () => void {
    return onSnapshot(collection(firestore, "circles"), (querySnapshot) => {
      const circles: CircleMetadata[] = [];
      querySnapshot.forEach((doc) => {
        const c = doc.data() as CircleMetadata;
        // Only include circles where the user is the organizer or a member
        if (c.organizer === walletAddress || (c.memberProfiles && c.memberProfiles[walletAddress])) {
          circles.push(c);
        }
      });
      callback(circles);
    });
  }

  async getCircle(id: string): Promise<CircleMetadata | null> {
    const docRef = doc(firestore, "circles", id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as CircleMetadata;
    }
    return null;
  }

  async getAllCircles(): Promise<CircleMetadata[]> {
    const querySnapshot = await getDocs(collection(firestore, "circles"));
    const circles: CircleMetadata[] = [];
    querySnapshot.forEach((doc) => {
      circles.push(doc.data() as CircleMetadata);
    });
    return circles;
  }

  async createCircle(metadata: CircleMetadata): Promise<void> {
    const docRef = doc(firestore, "circles", metadata.id);
    await setDoc(docRef, metadata);
  }

  async updateCircle(id: string, updates: Partial<CircleMetadata>): Promise<void> {
    const docRef = doc(firestore, "circles", id);
    await updateDoc(docRef, updates as any);
  }

  async removeMemberFromCircle(circleId: string, walletAddress: string): Promise<void> {
    const docRef = doc(firestore, "circles", circleId);
    await updateDoc(docRef, {
      [`memberProfiles.${walletAddress}`]: deleteField()
    });
  }

  async deleteCircle(id: string): Promise<void> {
    const docRef = doc(firestore, "circles", id);
    await deleteDoc(docRef);
  }

  async getUser(id: string): Promise<UserProfile | null> {
    const docRef = doc(firestore, "users", id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as UserProfile;
    }
    return null;
  }

  async saveUser(profile: UserProfile): Promise<void> {
    const docRef = doc(firestore, "users", profile.id);
    await setDoc(docRef, profile, { merge: true });
  }
}

export const db = new FirestoreDB();
