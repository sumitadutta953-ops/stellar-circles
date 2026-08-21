import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../frontend/.env') });

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function bumpCircles() {
  const circlesRef = collection(db, 'circles');
  const snapshot = await getDocs(circlesRef);
  
  for (const document of snapshot.docs) {
    const data = document.data();
    if (data.currentCycle === 0) {
      const memberCount = Object.keys(data.memberProfiles || {}).length;
      if (memberCount > 0) { // Just force it to start if anyone joined
        await updateDoc(doc(db, 'circles', document.id), { currentCycle: 1 });
        console.log(`Bumped circle ${document.id} to cycle 1`);
      }
    }
  }
  process.exit(0);
}

bumpCircles().catch(console.error);
