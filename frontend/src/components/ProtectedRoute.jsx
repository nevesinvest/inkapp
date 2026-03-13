import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute({ children, roles }) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div className="center-content">Carregando...</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (roles && roles.length > 0 && !roles.includes(user?.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
