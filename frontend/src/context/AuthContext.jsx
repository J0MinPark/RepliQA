import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
  const signup = useCallback(
    (email, password) => createUserWithEmailAndPassword(auth, email, password),
    []
  );
  const logout = useCallback(() => signOut(auth), []);

  return (
    <AuthContext.Provider value={{ user, tenantId, loading, login, signup, logout }}>
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
