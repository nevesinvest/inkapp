import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ArtistsPage } from "./pages/ArtistsPage";
import { ArtistProfilePage } from "./pages/ArtistProfilePage";
import { BookingPage } from "./pages/BookingPage";
import { CalendarManagementPage } from "./pages/CalendarManagementPage";
import { CashierPage } from "./pages/CashierPage";
import { CommissionsPage } from "./pages/CommissionsPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { FinancePage } from "./pages/FinancePage";
import { FinancialSummaryPage } from "./pages/FinancialSummaryPage";
import { ManagerDashboardPage } from "./pages/ManagerDashboardPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { QuotesPage } from "./pages/QuotesPage";
import { RegisterPage } from "./pages/RegisterPage";
import { RegistryPage } from "./pages/RegistryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StockControlPage } from "./pages/StockControlPage";
import { StorePage } from "./pages/StorePage";
import { TattooerDashboardPage } from "./pages/TattooerDashboardPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/cadastro" element={<RegisterPage />} />
        <Route path="/artistas" element={<ArtistsPage />} />
        <Route path="/artistas/:id" element={<ArtistProfilePage />} />
        <Route
          path="/agendar"
          element={
            <ProtectedRoute roles={["cliente", "gerente"]}>
              <BookingPage />
            </ProtectedRoute>
          }
        />
        <Route path="/orcamento" element={<QuotesPage />} />
        <Route path="/loja" element={<StorePage />} />
        <Route
          path="/painel-tatuador"
          element={
            <ProtectedRoute roles={["tatuador"]}>
              <TattooerDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/painel-gerente"
          element={
            <ProtectedRoute roles={["gerente"]}>
              <ManagerDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/agenda-gerencial"
          element={
            <ProtectedRoute roles={["gerente"]}>
              <CalendarManagementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cadastros"
          element={
            <ProtectedRoute roles={["gerente", "tatuador"]}>
              <RegistryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/configuracoes"
          element={
            <ProtectedRoute roles={["gerente"]}>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/controle-estoque"
          element={
            <ProtectedRoute roles={["gerente"]}>
              <StockControlPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/controle-comissoes"
          element={
            <ProtectedRoute roles={["gerente"]}>
              <CommissionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/caixa"
          element={
            <ProtectedRoute roles={["gerente"]}>
              <CashierPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/financeiro"
          element={
            <ProtectedRoute roles={["gerente"]}>
              <FinancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/financeiro/contas-pagar"
          element={
            <ProtectedRoute roles={["gerente"]}>
              <FinancePage section="payable" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/financeiro/contas-receber"
          element={
            <ProtectedRoute roles={["gerente"]}>
              <FinancePage section="receivable" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/painel-diretoria"
          element={
            <ProtectedRoute roles={["gerente"]}>
              <FinancialSummaryPage />
            </ProtectedRoute>
          }
        />
        <Route path="/bi-dashboard" element={<Navigate to="/painel-diretoria" replace />} />
        <Route path="/resumo-financeiro" element={<Navigate to="/painel-diretoria" replace />} />
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </Layout>
  );
}
