import { useState, useEffect, useRef, useMemo } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "firebase/auth";
import {
  collection, doc, addDoc, setDoc, getDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "firebase/firestore";

const INITIAL_PRODUCTS = [
  { category: "어패류", name: "광어 (1kg)", unit: "kg", price: 35000, stock: 20 },
  { category: "어패류", name: "광어 (500g)", unit: "팩", price: 18000, stock: 30 },
  { category: "어패류", name: "도미 (1kg)", unit: "kg", price: 28000, stock: 25 },
  { category: "어패류", name: "도미 (500g)", unit: "팩", price: 15000, stock: 18 },
  { category: "어패류", name: "점성어 (1kg)", unit: "kg", price: 22000, stock: 15 },
  { category: "어패류", name: "점성어 (500g)", unit: "팩", price: 12000, stock: 22 },
  { category: "어패류", name: "방어 (1kg)", unit: "kg", price: 45000, stock: 10 },
  { category: "어패류", name: "방어 (500g)", unit: "팩", price: 24000, stock: 14 },
];

const STATUS_MAP = {
  pending:   { label: "대기중",   color: "#f59e0b", bg: "#fef3c7" },
  approved:  { label: "승인됨",   color: "#10b981", bg: "#d1fae5" },
  rejected:  { label: "반려됨",   color: "#ef4444", bg: "#fee2e2" },
  delivered: { label: "입고완료", color: "#6366f1", bg: "#e0e7ff" },
};

function downloadCSV(orders) {
  const header = ["날짜","요청자","부서","우선순위","상태","합계금액","상품내역","비고"];
  const rows = orders.map(o => [
    o.date, o.requester, o.department, o.priority||"일반",
    STATUS_MAP[o.status]?.label, o.total,
    o.items?.map(i=>`${i.name}×${i.qty}`).join(" / "), o.note||""
  ]);
  const csv = [header,...rows].map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`발주내역_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function BarChart({ data, color="#6366f1" }) {
  const max = Math.max(...data.map(d=>d.value),1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:8,height:90}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
