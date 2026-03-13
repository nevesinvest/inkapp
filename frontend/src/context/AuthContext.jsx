import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

const STORAGE_KEY = "inkapp_auth";
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      setLoading(false);
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      if (parsed.token && parsed.user) {
        setToken(parsed.token);
        setUser(parsed.user);
      }
    } catch (_error) {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  async function refreshProfile(currentToken = token) {
    if (!currentToken) return null;
    try {
      const profile = await api.request("/users/me", { token: currentToken });
      const mergedUser = {
        ...user,
        ...profile
      };
      setUser(mergedUser);
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          token: currentToken,
          user: mergedUser
        })
      );
      return mergedUser;
    } catch (_error) {
      logout();
      return null;
    }
  }

  function login(payload) {
    setToken(payload.token);
    setUser(payload.user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      isAuthenticated: Boolean(token),
      login,
      logout,
      refreshProfile
    }),
    [token, user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  }
  return context;
}
