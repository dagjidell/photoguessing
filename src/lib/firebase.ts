import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInAnonymously, signInWithPopup, signOut } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
}

export const missingFirebaseEnvKeys = Object.entries({
  VITE_FIREBASE_API_KEY: firebaseConfig.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  VITE_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: firebaseConfig.storageBucket,
  VITE_FIREBASE_MESSAGING_SENDER_ID: firebaseConfig.messagingSenderId,
  VITE_FIREBASE_APP_ID: firebaseConfig.appId,
})
  .filter(([, value]) => !value)
  .map(([key]) => key)

export const firebaseConfigReady = missingFirebaseEnvKeys.length === 0

const app = firebaseConfigReady ? initializeApp(firebaseConfig) : null
const googleProvider = new GoogleAuthProvider()

export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null

export async function signInWithGoogle() {
  if (!auth) {
    throw new Error('Firebase is not configured yet.')
  }

  return signInWithPopup(auth, googleProvider)
}

export async function ensurePlayerAuth() {
  if (!auth) {
    throw new Error('Firebase is not configured yet.')
  }

  if (auth.currentUser) {
    return auth.currentUser
  }

  const result = await signInAnonymously(auth)
  return result.user
}

export async function signOutCurrentUser() {
  if (!auth) {
    return
  }

  await signOut(auth)
}
