import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { api } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenantId, setTenantId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setTenantId(null);
        setLoading(false);
        return;
      }

      const tokenResult = await firebaseUser.getIdTokenResult();
      if (tokenResult.claims.tenantId) {
        setTenantId(tokenResult.claims.tenantId);
      } else {
        // 최초 로그인: 서버가 테넌트를 만들고 커스텀 클레임을 심을 때까지 기다린 뒤
        // 토큰을 강제로 새로 받아와야 claims.tenantId가 보인다.
        try {
          await api.bootstrapTenant();
          const refreshed = await firebaseUser.getIdTokenResult(true);
          setTenantId(refreshed.claims.tenantId || null);
        } catch (err) {
          console.error('테넌트 부트스트랩 실패:', err);
        }
      }
      setLoading(false);
    });
  }, []);

  const login = useCallback((email, password) => signInWithEmailAndPassword(auth, email, password), []);
  const signup = useCallback(async (email, password) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // 가입 직후 인증 메일 발송 — 오타 이메일로 가입한 사용자가 나중에 비밀번호를
    // 잊었을 때 복구 불가능해지는 걸 막기 위한 최소 안전망.
    await sendEmailVerification(cred.user);
    return cred;
  }, []);
  // Google은 로그인 화면에서 이미 이메일을 검증하므로, 우리 쪽에서 별도 인증 메일을
  // 또 보낼 필요가 없다(emailVerified가 구글 계정 자체에서 true로 넘어옴).
  const loginWithGoogle = useCallback(() => signInWithPopup(auth, new GoogleAuthProvider()), []);
  const logout = useCallback(() => signOut(auth), []);
  const resetPassword = useCallback((email) => sendPasswordResetEmail(auth, email), []);
  const resendVerification = useCallback(() => {
    if (!auth.currentUser) throw new Error('로그인이 필요합니다.');
    return sendEmailVerification(auth.currentUser);
  }, []);
  // reload()는 auth.currentUser를 제자리에서 갱신할 뿐 참조가 안 바뀌어서, 새 객체로
  // 복사해 넣어야 emailVerified 변경이 리렌더로 이어진다.
  const refreshUser = useCallback(async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    setUser({ ...auth.currentUser });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        tenantId,
        loading,
        login,
        signup,
        loginWithGoogle,
        logout,
        resetPassword,
        resendVerification,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- Context 파일에서 짝을 이루는 훅을 함께 export하는 표준 패턴
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth는 AuthProvider 내부에서만 사용할 수 있습니다.');
  return ctx;
}
