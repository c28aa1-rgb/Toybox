import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

export const firebaseApp = initializeApp({
  apiKey: 'AIzaSyDTcK1momqAd8-Z76Bpg3yw7q1Z8wlCJ8c',
  authDomain: 'toybox-takedown.firebaseapp.com',
  projectId: 'toybox-takedown',
  appId: '1:138169689973:web:ec5a8bfb2f57fe3aead53c',
  messagingSenderId: '138169689973',
});
export const firebaseAuth = getAuth(firebaseApp);
