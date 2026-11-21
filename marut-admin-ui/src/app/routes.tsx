import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout }               from "../layouts/AppLayout";
import { DashboardPage }           from "../pages/DashboardPage";
import { PlaceholderPage }         from "../pages/PlaceholderPage";
import { NotFoundPage }            from "../pages/NotFoundPage";
import { LoginPage }               from "../pages/auth/LoginPage";
import { ForgotPasswordPage }      from "../pages/auth/ForgotPasswordPage";
import { ResetPasswordPage }       from "../pages/auth/ResetPasswordPage";
import { RequireAuth }             from "../components/auth/RequireAuth";
import { UserManagementPage }      from "../pages/users/UserManagementPage";
import { AcceptInvitePage }        from "../pages/auth/AcceptInvitePage";
import { VerticalManagementPage }  from "../pages/verticals/VerticalManagementPage";
import { ProductsPage }            from "../pages/products/ProductsPage";
import { ProductCreationWizard }   from "../pages/products/ProductCreationWizard";
import { ProductWorkspacePage }    from "../pages/products/ProductWorkspacePage";
import { CategoriesPage }          from "../pages/products/CategoriesPage";
import { GlobalMinimumFloorsPage } from "../pages/products/GlobalMinimumFloorsPage";


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
      <Route path="/accept-invite"   element={<AcceptInvitePage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index                                         element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"                              element={<DashboardPage />}                    />
          <Route path="users"                                  element={<UserManagementPage/>}                />
          <Route path="verticals"                              element={<VerticalManagementPage />}           />
          <Route path="products"                               element={<ProductsPage />}                     />
          <Route path="products/categories"                    element={<CategoriesPage />}                   />
          <Route path="products/new"                           element={<ProductCreationWizard />}            />
          <Route path="products/:productId"                    element={<ProductWorkspacePage />}             />
          <Route path="products/pricing/global-minimum-floors" element={<GlobalMinimumFloorsPage />}          />
          {placeholders.map(([path, title]) => (
            <Route key={path} path={path} element={<PlaceholderPage title={title} />} />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
