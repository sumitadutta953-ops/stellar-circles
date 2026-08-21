import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
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

async function clearOldCircles() {
  console.log("Fetching old circles from Firebase...");
  const circlesRef = collection(db, 'circles');
  const snapshot = await getDocs(circlesRef);
  
  let count = 0;
  for (const document of snapshot.docs) {
    await deleteDoc(doc(db, 'circles', document.id));
    count++;
  }
  
  console.log(`Successfully deleted ${count} legacy circles from Firebase!`);
  process.exit(0);
}

clearOldCircles().catch(console.error);
