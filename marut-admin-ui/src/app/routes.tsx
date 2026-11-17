import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout }               from "../layouts/AppLayout";
import { DashboardPage }           from "../pages/DashboardPage";
import { PlaceholderPage }         from "../pages/PlaceholderPage";
import { NotFoundPage }            from "../pages/NotFoundPage";
import { LoginPage }               from "../pages/auth/LoginPage";
import { ForgotPasswordPage }      from "../pages/auth/ForgotPasswordPage";
import { ResetPasswordPage }       from "../pages/auth/ResetPasswordPage";
import { RequireAuth }             from "../components/auth/RequireAuth";

const placeholders = [
  ["orders", "Orders"],
  ["recurring-orders", "Recurring orders"],
  ["production", "Production"],
  ["harvest", "Harvest"],
  ["fulfilment", "Fulfilment"],
  ["products", "Products"],
  ["invoices", "Invoices"],
  ["payments", "Payments"],
  ["expenses", "Expenses"],
  ["cashbook", "Cashbook"],
  ["feedback", "Customer feedback"],
  ["reports", "Reports"],
  ["founders", "Founders"],
  ["settings", "Settings"],
  ["audit", "Audit history"],
] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login"           element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password"  element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          {placeholders.map(([path, title]) => (
            <Route key={path} path={path} element={<PlaceholderPage title={title} />} />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
