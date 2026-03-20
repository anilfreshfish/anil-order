import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBmrOL1Yc9qSzFfAjZmRuMsmdPmPJ4CBP4",
  authDomain: "anil-order.firebaseapp.com",
  projectId: "anil-order",
  storageBucket: "anil-order.firebasestorage.app",
  messagingSenderId: "559711561961",
  appId: "1:559711561961:web:561a72e4afb937bd992878"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
