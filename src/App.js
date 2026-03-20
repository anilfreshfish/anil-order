import { useState, useEffect, useRef, useMemo } from "react";
import { auth, db } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { collection, doc, addDoc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";

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
  pending: { label: "대기중", color: "#f59e0b", bg: "#fef3c7" },
  approved: { label: "승인됨", color: "#10b981", bg: "#d1fae5" },
  rejected: { label: "반려됨", color: "#ef4444", bg: "#fee2e2" },
  delivered: { label: "입고완료", color: "#6366f1", bg: "#e0e7ff" },
};

function downloadCSV(orders) {
  const header = ["날짜","요청자","부서","우선순위","상태","합계금액","상품내역","비고"];
  const rows = orders.map(o => [o.date, o.requester, o.department, o.priority||"일반", STATUS_MAP[o.status]?.label, o.total, o.items?.map(i=>`${i.name}×${i.qty}`).join(" / "), o.note||""]);
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
          <div style={{width:"100%",background:color,borderRadius:"5px 5px 0 0",height:`${Math.max((d.value/max)*70,d.value>0?4:0)}px`,opacity:0.82}}/>
          <span style={{fontSize:11,color:"#94a3b8"}}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ segments }) {
  const total = segments.reduce((s,x)=>s+x.value,0)||1;
  let cum=0;
  const r=38,cx=50,cy=50,stroke=13,circ=2*Math.PI*r;
  return (
    <svg viewBox="0 0 100 100" width={110} height={110}>
      {segments.map((seg,i)=>{
        const frac=seg.value/total,rot=cum*360-90; cum+=frac;
        return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={stroke} strokeDasharray={`${circ*frac} ${circ*(1-frac)}`} transform={`rotate(${rot} ${cx} ${cy})`} opacity={0.88}/>;
      })}
      <text x="50" y="47" textAnchor="middle" style={{fontSize:12,fontWeight:700,fill:"#1a1d2e"}}>{total}</text>
      <text x="50" y="58" textAnchor="middle" style={{fontSize:8,fill:"#94a3b8"}}>전체</text>
    </svg>
  );
}

function NotifBell({ notifications, onRead, onClear }) {
  const [open,setOpen]=useState(false);
  const ref=useRef();
  const unread=notifications.filter(n=>!n.read).length;
  useEffect(()=>{
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);
  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>{setOpen(o=>!o);if(unread)onRead();}} style={{background:"rgba(255,255,255,0.08)",border:"none",borderRadius:8,width:40,height:40,cursor:"pointer",color:"#fff",fontSize:18,position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
        🔔
        {unread>0&&<span style={{position:"absolute",top:4,right:4,background:"#ef4444",borderRadius:10,width:16,height:16,fontSize:10,fontWeight:700,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}>{unread}</span>}
      </button>
      {open&&(
        <div style={{position:"absolute",top:48,right:0,width:310,background:"#fff",borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,0.18)",zIndex:1000,overflow:"hidden"}}>
          <div style={{padding:"13px 16px",borderBottom:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontWeight:700,fontSize:14}}>🔔 알림</span>
            <button onClick={onClear} style={{background:"none",border:"none",color:"#94a3b8",fontSize:12,cursor:"pointer"}}>모두 지우기</button>
          </div>
          <div style={{maxHeight:300,overflowY:"auto"}}>
            {notifications.length===0?<div style={{padding:"24px",textAlign:"center",color:"#94a3b8",fontSize:13}}>알림이 없습니다</div>
            :notifications.map(n=>(<div key={n.id} style={{padding:"11px 16px",borderBottom:"1px solid #f8fafc",background:n.read?"#fff":"#f0f4ff"}}><div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{n.title}</div><div style={{fontSize:12,color:"#64748b"}}>{n.body}</div><div style={{fontSize:11,color:"#94a3b8",marginTop:3}}>{n.time}</div></div>))}
          </div>
        </div>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:18,padding:28,minWidth:350,maxWidth:500,width:"90%",boxShadow:"0 16px 48px rgba(0,0,0,0.22)",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <span style={{fontWeight:800,fontSize:17}}>{title}</span>
          <button onClick={onClose} style={{background:"#f1f5f9",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [user,setUser]=useState(null);
  const [userProfile,setUserProfile]=useState(null);
  const [authLoading,setAuthLoading]=useState(true);
  const [loginForm,setLoginForm]=useState({email:"",password:"",error:""});
  const [registerMode,setRegisterMode]=useState(false);
  const [registerForm,setRegisterForm]=useState({name:"",email:"",password:"",department:"",role:"user"});
  const [tab,setTab]=useState("order");
  const [products,setProducts]=useState([]);
  const [orders,setOrders]=useState([]);
  const [category,setCategory]=useState("전체");
  const [productSearch,setProductSearch]=useState("");
  const [cart,setCart]=useState([]);
  const [form,setForm]=useState({note:"",priority:"일반"});
  const [submitted,setSubmitted]=useState(false);
  const [historySearch,setHistorySearch]=useState("");
  const [historyStatus,setHistoryStatus]=useState("전체");
  const [historyDept,setHistoryDept]=useState("전체");
  const [adminFilter,setAdminFilter]=useState("전체");
  const [adminSearch,setAdminSearch]=useState("");
  const [rejectModal,setRejectModal]=useState(null);
  const [rejectReason,setRejectReason]=useState("");
  const [orderDetail,setOrderDetail]=useState(null);
  const [productModal,setProductModal]=useState(null);
  const [productForm,setProductForm]=useState({name:"",category:"어패류",unit:"kg",price:"",stock:""});
  const [notifications,setNotifications]=useState([]);
  const [toast,setToast]=useState(null);
  const [loading,setLoading]=useState(false);

  const showToast=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),2800);};
  const addNotif=(title,body)=>setNotifications(prev=>[{id:Date.now(),title,body,time:"방금",read:false},...prev]);

  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async(firebaseUser)=>{
      if(firebaseUser){setUser(firebaseUser);const profileDoc=await getDoc(doc(db,"users",firebaseUser.uid));if(profileDoc.exists())setUserProfile(profileDoc.data());}
      else{setUser(null);setUserProfile(null);}
      setAuthLoading(false);
    });
    return()=>unsub();
  },[]);

  useEffect(()=>{
    if(!user)return;
    const unsub=onSnapshot(collection(db,"products"),(snap)=>{
      const data=snap.docs.map(d=>({id:d.id,...d.data()}));
      if(data.length===0){INITIAL_PRODUCTS.forEach(async(p)=>{await addDoc(collection(db,"products"),p);});}
      else{setProducts(data);}
    });
    return()=>unsub();
  },[user]);

  useEffect(()=>{
    if(!user)return;
    const q=query(collection(db,"orders"),orderBy("createdAt","desc"));
    const unsub=onSnapshot(q,(snap)=>{setOrders(snap.docs.map(d=>({id:d.id,...d.data()})));});
    return()=>unsub();
  },[user]);

  const handleLogin=async()=>{
    setLoading(true);
    try{await signInWithEmailAndPassword(auth,loginForm.email,loginForm.password);showToast("로그인 성공!");}
    catch(e){setLoginForm(p=>({...p,error:"이메일 또는 비밀번호가 올바르지 않습니다."}));}
    setLoading(false);
  };

  const handleRegister=async()=>{
    if(!registerForm.name||!registerForm.email||!registerForm.password||!registerForm.department){showToast("모든 항목을 입력해주세요","error");return;}
    setLoading(true);
    try{
      const cred=await createUserWithEmailAndPassword(auth,registerForm.email,registerForm.password);
      await setDoc(doc(db,"users",cred.user.uid),{name:registerForm.name,email:registerForm.email,department:registerForm.department,role:registerForm.role,avatar:registerForm.role==="admin"?"👩‍💼":"👤",createdAt:serverTimestamp()});
      showToast("계정이 생성되었습니다!");setRegisterMode(false);
    }catch(e){showToast("계정 생성 실패: "+e.message,"error");}
    setLoading(false);
  };

  const handleLogout=async()=>{await signOut(auth);setCart([]);setTab("order");};

  const CATEGORIES=["전체",...new Set(products.map(p=>p.category))];
  const filteredProducts=products.filter(p=>(category==="전체"||p.category===category)&&(productSearch===""||p.name.includes(productSearch)));

  const addToCart=(product)=>{
    setCart(prev=>{const ex=prev.find(c=>c.id===product.id);if(ex)return prev.map(c=>c.id===product.id?{...c,qty:c.qty+1}:c);return[...prev,{...product,qty:1}];});
    showToast(`${product.name} 추가 ✓`);
  };
  const updateQty=(id,d)=>setCart(prev=>prev.map(c=>c.id===id?{...c,qty:Math.max(1,c.qty+d)}:c));
  const removeFromCart=(id)=>setCart(prev=>prev.filter(c=>c.id!==id));
  const totalPrice=cart.reduce((s,c)=>s+c.price*c.qty,0);
  const cartCount=cart.reduce((s,c)=>s+c.qty,0);

  const submitOrder=async()=>{
    if(!userProfile?.name){showToast("프로필 정보가 없습니다","error");return;}
    if(cart.length===0){showToast("장바구니가 비어 있습니다","error");return;}
    setLoading(true);
    try{
      await addDoc(collection(db,"orders"),{date:new Date().toISOString().slice(0,10),requester:userProfile.name,department:userProfile.department,userId:user.uid,items:cart.map(c=>({name:c.name,qty:c.qty,price:c.price})),total:totalPrice,status:"pending",note:form.note,priority:form.priority,createdAt:serverTimestamp()});
      setCart([]);setForm(p=>({...p,note:"",priority:"일반"}));setSubmitted(true);
      showToast("발주 요청 제출 완료! 🎉");addNotif("발주 접수","발주가 접수되었습니다.");
      setTimeout(()=>{setSubmitted(false);setTab("history");},1600);
    }catch(e){showToast("제출 실패: "+e.message,"error");}
    setLoading(false);
  };

  const changeStatus=async(id,status,reason="")=>{
    try{const updateData={status};if(reason)updateData.note=reason;await updateDoc(doc(db,"orders",id),updateData);showToast(`"${STATUS_MAP[status].label}" 처리 완료`);addNotif(`발주 ${STATUS_MAP[status].label}`,`발주가 ${STATUS_MAP[status].label} 처리되었습니다.`);}
    catch(e){showToast("처리 실패","error");}
  };

  const saveProduct=async()=>{
    if(!productForm.name||!productForm.price){showToast("상품명과 단가를 입력하세요","error");return;}
    try{
      const data={...productForm,price:parseInt(productForm.price),stock:parseInt(productForm.stock)||0};
      if(productModal==="add"){await addDoc(collection(db,"products"),data);showToast("상품 추가 완료");}
      else{await updateDoc(doc(db,"products",productModal.id),data);showToast("상품 수정 완료");}
      setProductModal(null);
    }catch(e){showToast("저장 실패","error");}
  };

  const deleteProduct=async(id)=>{try{await deleteDoc(doc(db,"products",id));showToast("상품 삭제 완료");}catch(e){showToast("삭제 실패","error");}};

  const depts=["전체",...new Set(orders.map(o=>o.department))];
  const filteredHistory=orders.filter(o=>(historyStatus==="전체"||o.status===historyStatus)&&(historyDept==="전체"||o.department===historyDept)&&(historySearch===""||o.requester?.includes(historySearch)));
  const adminOrders=orders.filter(o=>(adminFilter==="전체"||o.status===adminFilter)&&(adminSearch===""||o.requester?.includes(adminSearch)||o.department?.includes(adminSearch)));

  const monthlyData=useMemo(()=>{const map={};orders.forEach(o=>{const m=parseInt((o.date||"").slice(5,7))-1;map[m]=(map[m]||0)+o.total;});return["1월","2월","3월"].map((label,i)=>({label,value:map[i]||0}));},[orders]);
  const statusCounts=Object.keys(STATUS_MAP).map(k=>({label:STATUS_MAP[k].label,value:orders.filter(o=>o.status===k).length,color:STATUS_MAP[k].color}));
  const topProducts=useMemo(()=>{const map={};orders.forEach(o=>o.items?.forEach(item=>{map[item.name]=(map[item.name]||0)+item.qty;}));return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5);},[orders]);
  const deptSpend=useMemo(()=>{const map={};orders.filter(o=>o.status!=="rejected").forEach(o=>{map[o.department]=(map[o.department]||0)+o.total;});return Object.entries(map).sort((a,b)=>b[1]-a[1]);},[orders]);

  const iStyle={width:"100%",padding:"9px 13px",border:"1.5px solid #e2e8f0",borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"};
  const fc="#6366f1";
  const isAdmin=userProfile?.role==="admin";

  if(authLoading)return(<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#1a1d2e,#2d3154)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"sans-serif"}}><div style={{color:"#fff",fontSize:18,fontWeight:700}}>🔥 로딩 중...</div></div>);

  if(!user)return(
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#1a1d2e 0%,#2d3154 100%)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Apple SD Gothic Neo',sans-serif"}}>
      <div style={{background:"#fff",borderRadius:24,padding:40,width:380,boxShadow:"0 24px 64px rgba(0,0,0,0.35)"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:56,height:56,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 16px"}}>🐟</div>
          <div style={{fontWeight:800,fontSize:22}}>Anil Fresh Fish</div>
          <div style={{color:"#94a3b8",fontSize:13,marginTop:4}}>내부 발주 시스템</div>
        </div>
        {!registerMode?(
          <>
            {loginForm.error&&<div style={{background:"#fee2e2",color:"#ef4444",borderRadius:10,padding:"10px 14px",fontSize:13,marginBottom:16,fontWeight:600}}>{loginForm.error}</div>}
            {[{label:"이메일",key:"email",type:"email",ph:"이메일 입력"},{label:"비밀번호",key:"password",type:"password",ph:"비밀번호 입력"}].map(f=>(
              <div key={f.key} style={{marginBottom:14}}>
                <label style={{fontSize:13,fontWeight:600,color:"#475569",display:"block",marginBottom:6}}>{f.label}</label>
                <input type={f.type} value={loginForm[f.key]} placeholder={f.ph} onChange={e=>setLoginForm(p=>({...p,[f.key]:e.target.value,error:""}))} onKeyDown={e=>e.key==="Enter"&&handleLogin()} style={{...iStyle}} onFocus={e=>e.target.style.borderColor=fc} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
              </div>
            ))}
            <button onClick={handleLogin} disabled={loading} style={{width:"100%",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",border:"none",borderRadius:12,padding:14,fontWeight:700,fontSize:15,cursor:"pointer",marginTop:8,opacity:loading?0.7:1}}>{loading?"로그인 중...":"로그인"}</button>
            <div style={{textAlign:"center",marginTop:16}}><button onClick={()=>setRegisterMode(true)} style={{background:"none",border:"none",color:"#6366f1",fontSize:13,cursor:"pointer",fontWeight:600}}>새 계정 만들기 →</button></div>
          </>
        ):(
          <>
            <div style={{fontWeight:700,fontSize:16,marginBottom:16}}>새 계정 만들기</div>
            {[{label:"이름",key:"name",ph:"홍길동"},{label:"이메일",key:"email",ph:"hong@email.com"},{label:"비밀번호",key:"password",ph:"6자 이상"},{label:"부서",key:"department",ph:"구매팀"}].map(f=>(
              <div key={f.key} style={{marginBottom:11}}>
                <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:4}}>{f.label}</label>
                <input value={registerForm[f.key]} placeholder={f.ph} type={f.key==="password"?"password":"text"} onChange={e=>setRegisterForm(p=>({...p,[f.key]:e.target.value}))} style={{...iStyle,padding:"8px 12px"}} onFocus={e=>e.target.style.borderColor=fc} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
              </div>
            ))}
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:4}}>역할</label>
              <select value={registerForm.role} onChange={e=>setRegisterForm(p=>({...p,role:e.target.value}))} style={{...iStyle,padding:"8px 12px"}}>
                <option value="user">일반 사용자 (거래처)</option>
                <option value="admin">관리자</option>
              </select>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setRegisterMode(false)} style={{flex:1,background:"#f1f5f9",border:"none",borderRadius:10,padding:12,cursor:"pointer",fontWeight:600}}>취소</button>
              <button onClick={handleRegister} disabled={loading} style={{flex:1,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",border:"none",borderRadius:10,padding:12,cursor:"pointer",fontWeight:700,opacity:loading?0.7:1}}>{loading?"생성 중...":"계정 만들기"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const NAV=[{key:"order",label:"발주하기",icon:"🛍️"},{key:"history",label:"주문 내역",icon:"📋"},...(isAdmin?[{key:"admin",label:"관리자",icon:"⚙️"},{key:"products",label:"상품 관리",icon:"🗂️"},{key:"stats",label:"통계",icon:"📊"}]:[])];

  return(
    <div style={{fontFamily:"'Apple SD Gothic Neo',sans-serif",minHeight:"100vh",background:"#f0f2f7",color:"#1a1d2e"}}>
      {toast&&<div style={{position:"fixed",top:24,right:24,zIndex:9999,background:toast.type==="error"?"#ef4444":"#1a1d2e",color:"#fff",borderRadius:12,padding:"13px 20px",fontWeight:600,fontSize:14,boxShadow:"0 8px 24px rgba(0,0,0,0.22)"}}>{toast.type==="error"?"⚠️ ":"✓ "}{toast.msg}</div>}
      {rejectModal&&<Modal title="반려 사유 입력" onClose={()=>setRejectModal(null)}><textarea value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="반려 사유를 입력하세요..." rows={4} style={{...iStyle,resize:"none"}} onFocus={e=>e.target.style.borderColor="#ef4444"} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/><div style={{display:"flex",gap:10,marginTop:16}}><button onClick={()=>setRejectModal(null)} style={{flex:1,background:"#f1f5f9",border:"none",borderRadius:10,padding:12,cursor:"pointer",fontWeight:600}}>취소</button><button onClick={()=>{changeStatus(rejectModal,"rejected",rejectReason||"반려됨");setRejectModal(null);setRejectReason("");}} style={{flex:1,background:"#ef4444",color:"#fff",border:"none",borderRadius:10,padding:12,cursor:"pointer",fontWeight:700}}>반려 확정</button></div></Modal>}
      {orderDetail&&<Modal title="발주 상세" onClose={()=>setOrderDetail(null)}>{[["날짜",orderDetail.date],["요청자",orderDetail.requester],["부서",orderDetail.department],["우선순위",orderDetail.priority||"일반"],["비고",orderDetail.note||"—"]].map(([k,v])=>(<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f1f5f9",fontSize:14}}><span style={{color:"#64748b",fontWeight:600}}>{k}</span><span style={{fontWeight:700}}>{v}</span></div>))}<div style={{marginTop:16,background:"#f8fafc",borderRadius:10,padding:14}}>{orderDetail.items?.map((item,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"4px 0"}}><span>{item.name} × {item.qty}</span><span style={{fontWeight:700}}>₩{(item.price*item.qty).toLocaleString()}</span></div>))}<div style={{borderTop:"1.5px solid #e2e8f0",marginTop:8,paddingTop:8,display:"flex",justifyContent:"space-between",fontWeight:800,fontSize:15}}><span>합계</span><span style={{color:"#6366f1"}}>₩{orderDetail.total?.toLocaleString()}</span></div></div><div style={{marginTop:14,textAlign:"center"}}><span style={{background:STATUS_MAP[orderDetail.status]?.bg,color:STATUS_MAP[orderDetail.status]?.color,borderRadius:20,padding:"6px 20px",fontWeight:700,fontSize:14}}>{STATUS_MAP[orderDetail.status]?.label}</span></div></Modal>}
      {productModal&&<Modal title={productModal==="add"?"상품 추가":"상품 수정"} onClose={()=>setProductModal(null)}>{[{label:"상품명",key:"name",ph:"상품명"},{label:"단가 (원)",key:"price",ph:"35000"},{label:"단위",key:"unit",ph:"kg"},{label:"재고",key:"stock",ph:"0"}].map(f=>(<div key={f.key} style={{marginBottom:12}}><label style={{fontSize:13,fontWeight:600,color:"#475569",display:"block",marginBottom:5}}>{f.label}</label><input value={productForm[f.key]} onChange={e=>setProductForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.ph} style={{...iStyle}} onFocus={e=>e.target.style.borderColor=fc} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/></div>))}<div style={{marginBottom:16}}><label style={{fontSize:13,fontWeight:600,color:"#475569",display:"block",marginBottom:5}}>카테고리</label><select value={productForm.category} onChange={e=>setProductForm(p=>({...p,category:e.target.value}))} style={{...iStyle}}><option>어패류</option></select></div><div style={{display:"flex",gap:10}}><button onClick={()=>setProductModal(null)} style={{flex:1,background:"#f1f5f9",border:"none",borderRadius:10,padding:12,cursor:"pointer",fontWeight:600}}>취소</button><button onClick={saveProduct} style={{flex:1,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",border:"none",borderRadius:10,padding:12,cursor:"pointer",fontWeight:700}}>저장</button></div></Modal>}

      <header style={{background:"#1a1d2e",color:"#fff",padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:64,boxShadow:"0 2px 16px rgba(0,0,0,0.25)",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🐟</div>
          <div><div style={{fontWeight:800,fontSize:15}}>Anil Fresh Fish</div><div style={{fontSize:10,color:"#6366f1"}}>발주 시스템</div></div>
        </div>
        <nav style={{display:"flex",gap:2}}>{NAV.map(t=>(<button key={t.key} onClick={()=>setTab(t.key)} style={{background:tab===t.key?"rgba(99,102,241,0.35)":"transparent",color:tab===t.key?"#a5b4fc":"#94a3b8",border:"none",borderRadius:8,padding:"8px 13px",cursor:"pointer",fontWeight:tab===t.key?700:400,fontSize:13,transition:"all .2s"}}>{t.icon} {t.label}</button>))}</nav>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <NotifBell notifications={notifications} onRead={()=>setNotifications(p=>p.map(n=>({...n,read:true})))} onClear={()=>setNotifications([])}/>
          <div style={{display:"flex",alignItems:"center",gap:7,background:"rgba(255,255,255,0.08)",borderRadius:10,padding:"5px 11px"}}>
            <span style={{fontSize:18}}>{userProfile?.avatar||"👤"}</span>
            <div><div style={{fontSize:13,fontWeight:700}}>{userProfile?.name||"사용자"}</div><div style={{fontSize:10,color:"#6366f1"}}>{isAdmin?"관리자":userProfile?.department}</div></div>
          </div>
          <button onClick={handleLogout} style={{background:"rgba(239,68,68,0.15)",color:"#f87171",border:"none",borderRadius:8,padding:"7px 12px",cursor:"pointer",fontWeight:600,fontSize:12}}>로그아웃</button>
        </div>
      </header>

      <main style={{maxWidth:1200,margin:"0 auto",padding:"26px 20px"}}>
        {tab==="order"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 360px",gap:22,alignItems:"start"}}>
            <div>
              <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
                <input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="🔍 상품 검색..." style={{flex:1,minWidth:160,padding:"8px 13px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,outline:"none",background:"#fff"}} onFocus={e=>e.target.style.borderColor=fc} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
                {CATEGORIES.map(c=>(<button key={c} onClick={()=>setCategory(c)} style={{background:category===c?"#6366f1":"#fff",color:category===c?"#fff":"#64748b",border:"1.5px solid",borderColor:category===c?"#6366f1":"#e2e8f0",borderRadius:20,padding:"6px 13px",cursor:"pointer",fontWeight:600,fontSize:12}}>{c}</button>))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))",gap:12}}>
                {filteredProducts.map(p=>(<div key={p.id} style={{background:"#fff",borderRadius:14,padding:16,boxShadow:"0 1px 8px rgba(0,0,0,0.06)",border:"1.5px solid #f1f5f9"}} onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(99,102,241,0.12)";}} onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 1px 8px rgba(0,0,0,0.06)";}}>
                  <div style={{fontSize:11,color:"#6366f1",fontWeight:700,background:"#eef2ff",borderRadius:6,padding:"2px 7px",display:"inline-block",marginBottom:7}}>{p.category}</div>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{p.name}</div>
                  <div style={{color:"#64748b",fontSize:12,marginBottom:3}}>단위: {p.unit}</div>
                  <div style={{fontSize:11,color:p.stock<=10?"#ef4444":"#10b981",fontWeight:600,marginBottom:10}}>재고 {p.stock} {p.stock<=10?"⚠️ 부족":"✓"}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontWeight:800,fontSize:14}}>₩{p.price?.toLocaleString()}</span>
                    <button onClick={()=>addToCart(p)} style={{background:"#6366f1",color:"#fff",border:"none",borderRadius:8,width:30,height:30,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}} onMouseEnter={e=>e.currentTarget.style.background="#4f46e5"} onMouseLeave={e=>e.currentTarget.style.background="#6366f1"}>+</button>
                  </div>
                </div>))}
              </div>
            </div>
            <div style={{position:"sticky",top:84}}>
              <div style={{background:"#fff",borderRadius:18,boxShadow:"0 2px 20px rgba(0,0,0,0.09)",overflow:"hidden"}}>
                <div style={{background:"#1a1d2e",color:"#fff",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontWeight:700,fontSize:15}}>🛒 장바구니</span>
                  <div style={{display:"flex",gap:7,alignItems:"center"}}>
                    {cartCount>0&&<span style={{background:"#6366f1",borderRadius:20,padding:"2px 9px",fontSize:12,fontWeight:700}}>{cartCount}건</span>}
                    {cart.length>0&&<button onClick={()=>setCart([])} style={{background:"rgba(239,68,68,0.25)",color:"#f87171",border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:600}}>비우기</button>}
                  </div>
                </div>
                <div style={{padding:"12px 16px",maxHeight:220,overflowY:"auto"}}>
                  {cart.length===0?<div style={{textAlign:"center",color:"#94a3b8",padding:"24px 0",fontSize:13}}>상품을 추가해주세요</div>
                  :cart.map(c=>(<div key={c.id} style={{display:"flex",alignItems:"center",gap:7,marginBottom:9,paddingBottom:9,borderBottom:"1px solid #f1f5f9"}}>
                    <div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</div><div style={{color:"#6366f1",fontWeight:700,fontSize:12}}>₩{(c.price*c.qty).toLocaleString()}</div></div>
                    <div style={{display:"flex",alignItems:"center",gap:3}}>
                      {["−","＋"].map((sym,di)=>(<button key={sym} onClick={()=>updateQty(c.id,di===0?-1:1)} style={{width:22,height:22,border:"1.5px solid #e2e8f0",borderRadius:5,background:"#f8fafc",cursor:"pointer",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>{sym}</button>))}
                      <span style={{fontWeight:700,width:20,textAlign:"center",fontSize:13}}>{c.qty}</span>
                    </div>
                    <button onClick={()=>removeFromCart(c.id)} style={{color:"#ef4444",background:"none",border:"none",cursor:"pointer",fontSize:14}}>✕</button>
                  </div>))}
                </div>
                {cart.length>0&&<div style={{background:"#f8fafc",padding:"9px 16px",display:"flex",justifyContent:"space-between",borderTop:"1px solid #f1f5f9"}}><span style={{fontWeight:600,color:"#64748b",fontSize:13}}>합계</span><span style={{fontWeight:800,fontSize:15}}>₩{totalPrice.toLocaleString()}</span></div>}
                <div style={{padding:"14px 16px",borderTop:"1px solid #f1f5f9"}}>
                  <div style={{background:"#f0f4ff",borderRadius:10,padding:"10px 14px",marginBottom:12}}><div style={{fontSize:12,color:"#64748b",marginBottom:2}}>발주자</div><div style={{fontWeight:700,fontSize:14}}>{userProfile?.name} · {userProfile?.department}</div></div>
                  <div style={{marginBottom:9}}><label style={{fontSize:11,color:"#64748b",fontWeight:600,display:"block",marginBottom:3}}>우선순위</label><div style={{display:"flex",gap:5}}>{["일반","긴급","매우긴급"].map(p=>(<button key={p} onClick={()=>setForm(prev=>({...prev,priority:p}))} style={{flex:1,background:form.priority===p?(p==="매우긴급"?"#ef4444":p==="긴급"?"#f59e0b":"#6366f1"):"#f1f5f9",color:form.priority===p?"#fff":"#64748b",border:"none",borderRadius:7,padding:"6px 0",cursor:"pointer",fontWeight:600,fontSize:11}}>{p}</button>))}</div></div>
                  <div style={{marginBottom:12}}><label style={{fontSize:11,color:"#64748b",fontWeight:600,display:"block",marginBottom:3}}>비고</label><textarea value={form.note} onChange={e=>setForm(p=>({...p,note:e.target.value}))} placeholder="발주 사유나 메모..." rows={2} style={{...iStyle,resize:"none",fontSize:12,padding:"7px 11px"}} onFocus={e=>e.target.style.borderColor=fc} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/></div>
                  <button onClick={submitOrder} disabled={loading} style={{width:"100%",background:submitted?"#10b981":"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",border:"none",borderRadius:11,padding:12,fontWeight:700,fontSize:14,cursor:"pointer",opacity:loading?0.7:1}}>{loading?"저장 중...":submitted?"✓ 제출 완료!":"발주 요청 제출"}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab==="history"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,flexWrap:"wrap",gap:10}}>
              <h2 style={{fontWeight:800,fontSize:21,margin:0}}>📋 주문 내역</h2>
              <button onClick={()=>downloadCSV(filteredHistory)} style={{background:"#1a1d2e",color:"#fff",border:"none",borderRadius:10,padding:"9px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>⬇ CSV 내보내기</button>
            </div>
            <div style={{display:"flex",gap:9,marginBottom:16,flexWrap:"wrap"}}>
              <input value={historySearch} onChange={e=>setHistorySearch(e.target.value)} placeholder="🔍 요청자 검색" style={{flex:1,minWidth:160,padding:"8px 13px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,outline:"none",background:"#fff"}} onFocus={e=>e.target.style.borderColor=fc} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
              <select value={historyStatus} onChange={e=>setHistoryStatus(e.target.value)} style={{padding:"8px 11px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,outline:"none",background:"#fff"}}><option value="전체">전체 상태</option>{Object.keys(STATUS_MAP).map(k=><option key={k} value={k}>{STATUS_MAP[k].label}</option>)}</select>
              <select value={historyDept} onChange={e=>setHistoryDept(e.target.value)} style={{padding:"8px 11px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,outline:"none",background:"#fff"}}>{depts.map(d=><option key={d}>{d}</option>)}</select>
            </div>
            <div style={{fontSize:13,color:"#94a3b8",marginBottom:12}}>총 {filteredHistory.length}건</div>
            {filteredHistory.length===0?<div style={{textAlign:"center",color:"#94a3b8",padding:"56px 0",fontSize:14}}>발주 내역이 없습니다</div>
            :filteredHistory.map(o=>{const s=STATUS_MAP[o.status];return(
              <div key={o.id} style={{background:"#fff",borderRadius:13,padding:18,marginBottom:11,boxShadow:"0 1px 8px rgba(0,0,0,0.06)",border:"1.5px solid #f1f5f9",cursor:"pointer"}} onClick={()=>setOrderDetail(o)} onMouseEnter={e=>e.currentTarget.style.boxShadow="0 4px 20px rgba(99,102,241,0.1)"} onMouseLeave={e=>e.currentTarget.style.boxShadow="0 1px 8px rgba(0,0,0,0.06)"}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:9}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:14,marginBottom:2,display:"flex",alignItems:"center",gap:7}}>{o.date} · {o.requester}{o.priority==="긴급"&&<span style={{background:"#fef3c7",color:"#f59e0b",fontSize:10,fontWeight:700,borderRadius:5,padding:"1px 6px"}}>긴급</span>}{o.priority==="매우긴급"&&<span style={{background:"#fee2e2",color:"#ef4444",fontSize:10,fontWeight:700,borderRadius:5,padding:"1px 6px"}}>매우긴급</span>}</div>
                    <div style={{color:"#64748b",fontSize:12}}>{o.department}</div>
                    {o.note&&<div style={{color:"#94a3b8",fontSize:11,marginTop:2}}>"{o.note}"</div>}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}><span style={{background:s?.bg,color:s?.color,borderRadius:20,padding:"3px 12px",fontWeight:700,fontSize:11}}>{s?.label}</span><span style={{fontWeight:800,fontSize:14}}>₩{o.total?.toLocaleString()}</span></div>
                </div>
                <div style={{background:"#f8fafc",borderRadius:8,padding:"7px 11px"}}>{o.items?.map((item,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"2px 0"}}><span style={{color:"#475569"}}>{item.name} × {item.qty}</span><span style={{fontWeight:600}}>₩{(item.price*item.qty).toLocaleString()}</span></div>))}</div>
              </div>
            );})}
          </div>
        )}

        {tab==="admin"&&isAdmin&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,flexWrap:"wrap",gap:10}}>
              <h2 style={{fontWeight:800,fontSize:21,margin:0}}>⚙️ 관리자 대시보드</h2>
              <button onClick={()=>downloadCSV(adminOrders)} style={{background:"#1a1d2e",color:"#fff",border:"none",borderRadius:10,padding:"9px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>⬇ CSV 내보내기</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:22}}>
              {[{label:"전체 발주",value:orders.length,icon:"📦",color:"#6366f1"},{label:"대기중",value:orders.filter(o=>o.status==="pending").length,icon:"⏳",color:"#f59e0b"},{label:"총 금액",value:`₩${orders.reduce((s,o)=>s+o.total,0).toLocaleString()}`,icon:"💰",color:"#10b981"},{label:"입고완료",value:orders.filter(o=>o.status==="delivered").length,icon:"✅",color:"#8b5cf6"}].map(card=>(<div key={card.label} style={{background:"#fff",borderRadius:13,padding:18,boxShadow:"0 1px 8px rgba(0,0,0,0.06)",borderTop:`4px solid ${card.color}`}}><div style={{fontSize:22,marginBottom:5}}>{card.icon}</div><div style={{fontWeight:800,fontSize:20,color:card.color}}>{card.value}</div><div style={{color:"#64748b",fontSize:12,marginTop:2}}>{card.label}</div></div>))}
            </div>
            <div style={{display:"flex",gap:9,marginBottom:14,flexWrap:"wrap"}}>
              <input value={adminSearch} onChange={e=>setAdminSearch(e.target.value)} placeholder="🔍 요청자 / 부서 검색" style={{flex:1,minWidth:180,padding:"8px 13px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,outline:"none",background:"#fff"}} onFocus={e=>e.target.style.borderColor=fc} onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
              {["전체",...Object.keys(STATUS_MAP)].map(s=>(<button key={s} onClick={()=>setAdminFilter(s)} style={{background:adminFilter===s?"#1a1d2e":"#fff",color:adminFilter===s?"#fff":"#64748b",border:"1.5px solid",borderColor:adminFilter===s?"#1a1d2e":"#e2e8f0",borderRadius:20,padding:"6px 13px",cursor:"pointer",fontWeight:600,fontSize:12}}>{s==="전체"?"전체":STATUS_MAP[s].label}</button>))}
            </div>
            <div style={{background:"#fff",borderRadius:13,overflow:"auto",boxShadow:"0 1px 8px rgba(0,0,0,0.06)"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:640}}>
                <thead><tr style={{background:"#1a1d2e",color:"#94a3b8"}}>{["날짜","요청자","부서","우선순위","금액","상태","처리"].map(h=>(<th key={h} style={{padding:"12px 13px",textAlign:"left",fontSize:11,fontWeight:700}}>{h}</th>))}</tr></thead>
                <tbody>
                  {adminOrders.map((o,i)=>{const s=STATUS_MAP[o.status];return(
                    <tr key={o.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafbfd"}}>
                      <td style={{padding:"12px 13px",color:"#64748b",fontSize:12}}>{o.date}</td>
                      <td style={{padding:"12px 13px",fontSize:12,cursor:"pointer",color:"#6366f1",fontWeight:700}} onClick={()=>setOrderDetail(o)}>{o.requester}</td>
                      <td style={{padding:"12px 13px",fontSize:12,color:"#64748b"}}>{o.department}</td>
                      <td style={{padding:"12px 13px"}}>{o.priority&&o.priority!=="일반"?<span style={{background:o.priority==="매우긴급"?"#fee2e2":"#fef3c7",color:o.priority==="매우긴급"?"#ef4444":"#f59e0b",borderRadius:5,padding:"2px 7px",fontSize:11,fontWeight:700}}>{o.priority}</span>:<span style={{color:"#cbd5e1",fontSize:11}}>일반</span>}</td>
                      <td style={{padding:"12px 13px",fontWeight:700,fontSize:12}}>₩{o.total?.toLocaleString()}</td>
                      <td style={{padding:"12px 13px"}}><span style={{background:s?.bg,color:s?.color,borderRadius:20,padding:"3px 10px",fontWeight:700,fontSize:11}}>{s?.label}</span></td>
                      <td style={{padding:"12px 13px"}}><div style={{display:"flex",gap:4}}>
                        {o.status==="pending"&&<><button onClick={()=>changeStatus(o.id,"approved")} style={{background:"#d1fae5",color:"#10b981",border:"none",borderRadius:6,padding:"4px 9px",fontSize:11,fontWeight:700,cursor:"pointer"}}>승인</button><button onClick={()=>{setRejectModal(o.id);setRejectReason("");}} style={{background:"#fee2e2",color:"#ef4444",border:"none",borderRadius:6,padding:"4px 9px",fontSize:11,fontWeight:700,cursor:"pointer"}}>반려</button></>}
                        {o.status==="approved"&&<button onClick={()=>changeStatus(o.id,"delivered")} style={{background:"#e0e7ff",color:"#6366f1",border:"none",borderRadius:6,padding:"4px 9px",fontSize:11,fontWeight:700,cursor:"pointer"}}>입고완료</button>}
                        {(o.status==="rejected"||o.status==="delivered")&&<span style={{color:"#cbd5e1",fontSize:11}}>완료</span>}
                      </div></td>
                    </tr>
                  );})}
                </tbody>
              </table>
              {adminOrders.length===0&&<div style={{textAlign:"center",color:"#94a3b8",padding:"36px 0",fontSize:13}}>발주가 없습니다</div>}
            </div>
          </div>
        )}

        {tab==="products"&&isAdmin&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <h2 style={{fontWeight:800,fontSize:21,margin:0}}>🗂️ 상품 관리</h2>
              <button onClick={()=>{setProductModal("add");setProductForm({name:"",category:"어패류",unit:"kg",price:"",stock:""});}} style={{background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",border:"none",borderRadius:10,padding:"9px 18px",cursor:"pointer",fontWeight:700,fontSize:13}}>+ 상품 추가</button>
            </div>
            <div style={{background:"#fff",borderRadius:13,overflow:"auto",boxShadow:"0 1px 8px rgba(0,0,0,0.06)"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{background:"#1a1d2e",color:"#94a3b8"}}>{["카테고리","상품명","단위","단가","재고","관리"].map(h=><th key={h} style={{padding:"12px 14px",textAlign:"left",fontSize:11,fontWeight:700}}>{h}</th>)}</tr></thead>
                <tbody>{products.map((p,i)=>(<tr key={p.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafbfd"}}><td style={{padding:"11px 14px"}}><span style={{background:"#eef2ff",color:"#6366f1",borderRadius:6,padding:"2px 7px",fontSize:11,fontWeight:600}}>{p.category}</span></td><td style={{padding:"11px 14px",fontWeight:600,fontSize:13}}>{p.name}</td><td style={{padding:"11px 14px",color:"#64748b",fontSize:12}}>{p.unit}</td><td style={{padding:"11px 14px",fontWeight:700,fontSize:13}}>₩{p.price?.toLocaleString()}</td><td style={{padding:"11px 14px"}}><span style={{color:p.stock<=10?"#ef4444":"#10b981",fontWeight:700,fontSize:13}}>{p.stock} {p.stock<=10?"⚠️":"✓"}</span></td><td style={{padding:"11px 14px"}}><div style={{display:"flex",gap:6}}><button onClick={()=>{setProductModal(p);setProductForm({name:p.name,category:p.category,unit:p.unit,price:String(p.price),stock:String(p.stock)});}} style={{background:"#eef2ff",color:"#6366f1",border:"none",borderRadius:6,padding:"4px 9px",fontSize:11,fontWeight:700,cursor:"pointer"}}>수정</button><button onClick={()=>deleteProduct(p.id)} style={{background:"#fee2e2",color:"#ef4444",border:"none",borderRadius:6,padding:"4px 9px",fontSize:11,fontWeight:700,cursor:"pointer"}}>삭제</button></div></td></tr>))}</tbody>
              </table>
            </div>
          </div>
        )}

        {tab==="stats"&&isAdmin&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
              <h2 style={{fontWeight:800,fontSize:21,margin:0}}>📊 발주 통계</h2>
              <button onClick={()=>downloadCSV(orders)} style={{background:"#1a1d2e",color:"#fff",border:"none",borderRadius:10,padding:"9px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>⬇ 전체 CSV</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
              <div style={{background:"#fff",borderRadius:16,padding:22,boxShadow:"0 1px 8px rgba(0,0,0,0.06)"}}><div style={{fontWeight:700,fontSize:14,marginBottom:18}}>📅 월별 발주 금액</div><BarChart data={monthlyData} color="#6366f1"/><div style={{marginTop:14}}>{monthlyData.map(d=>(<div key={d.label} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"4px 0",borderBottom:"1px solid #f8fafc"}}><span style={{color:"#64748b"}}>{d.label}</span><span style={{fontWeight:700}}>₩{d.value.toLocaleString()}</span></div>))}</div></div>
              <div style={{background:"#fff",borderRadius:16,padding:22,boxShadow:"0 1px 8px rgba(0,0,0,0.06)"}}><div style={{fontWeight:700,fontSize:14,marginBottom:18}}>🥧 상태별 현황</div><div style={{display:"flex",alignItems:"center",gap:20}}><DonutChart segments={statusCounts}/><div style={{flex:1}}>{statusCounts.map(s=>(<div key={s.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #f8fafc"}}><div style={{display:"flex",alignItems:"center",gap:7}}><div style={{width:9,height:9,borderRadius:"50%",background:s.color}}/><span style={{fontSize:13,color:"#475569"}}>{s.label}</span></div><span style={{fontWeight:700,fontSize:14}}>{s.value}건</span></div>))}</div></div></div>
              <div style={{background:"#fff",borderRadius:16,padding:22,boxShadow:"0 1px 8px rgba(0,0,0,0.06)"}}><div style={{fontWeight:700,fontSize:14,marginBottom:16}}>🏢 부서별 발주 금액</div>{deptSpend.length===0?<div style={{color:"#94a3b8",fontSize:13}}>데이터 없음</div>:deptSpend.map(([dept,amt],i)=>{const max=deptSpend[0][1];return(<div key={dept} style={{marginBottom:12}}><div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}><span style={{fontWeight:600}}>{dept}</span><span style={{color:"#6366f1",fontWeight:700}}>₩{amt.toLocaleString()}</span></div><div style={{height:8,background:"#f1f5f9",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${(amt/max)*100}%`,background:`hsl(${240-i*28},65%,58%)`,borderRadius:4}}/></div></div>);})}</div>
              <div style={{background:"#fff",borderRadius:16,padding:22,boxShadow:"0 1px 8px rgba(0,0,0,0.06)"}}><div style={{fontWeight:700,fontSize:14,marginBottom:16}}>🏆 인기 발주 상품 TOP 5</div>{topProducts.length===0?<div style={{color:"#94a3b8",fontSize:13}}>데이터 없음</div>:topProducts.map(([name,qty],i)=>(<div key={name} style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}><div style={{width:26,height:26,borderRadius:"50%",background:i===0?"#fbbf24":i===1?"#94a3b8":i===2?"#cd7c3f":"#e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:12,color:i<3?"#fff":"#64748b",flexShrink:0}}>{i+1}</div><div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{name}</div></div><span style={{fontWeight:800,color:"#6366f1",fontSize:14}}>{qty}건</span></div>))}</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
