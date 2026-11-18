import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ScreenStateProvider } from './lib/state';
import { ToastProvider } from './components/Toast';
import { LoginPage, NotFoundPage, PrivacyPage, TermsPage } from './pages/Public';
import { HomePage } from './pages/Landing';
import { CreatorListPage, EditorPage, PreviewPage, PublishPage } from './pages/CreatorCore';
import { SharePage, ResultsPage, SettingsPage, HistoryPage } from './pages/CreatorData';
import { IntroPage, FormPage, ReviewPage, ReceiptPage } from './pages/Respondent';
import { AdminSummaryPage, AdminAccountsPage, AdminAuditPage, AdminIntegrationPage, AdminRequestsPage } from './pages/Admin';
import { loadBootstrap, useStore } from './lib/store';
import { ActionLink, Card } from './components/ui';
import { ROUTES } from './lib/routes';

function LoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-n50 p-6" aria-busy="true">
      <Card className="w-full max-w-[420px]">
        <p className="text-body font-bold text-ink">Memuat workspace…</p>
        <p className="mt-2 text-body-sm text-muted">Sesi dan data terbaru sedang diverifikasi.</p>
      </Card>
    </div>
  );
}

function AccessDenied({ detail }: { detail: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[640px] flex-col justify-center gap-4 p-6">
      <Card>
        <h1 className="text-h2 font-bold text-ink">Akses ditolak</h1>
        <p className="mt-2 text-body text-muted">{detail}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <ActionLink to={ROUTES.home}>Kembali ke beranda</ActionLink>
          <ActionLink to={ROUTES.login} variant="secondary">Masuk dengan akun lain</ActionLink>
        </div>
      </Card>
    </div>
  );
}

function RequireRole({ role, children }: { role: 'creator' | 'admin'; children: React.ReactNode }) {
  const { ready, session } = useStore();
  const location = useLocation();
  if (!ready) return <LoadingScreen />;
  if (!session) {
    return <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />;
  }
  if (role === 'admin' && session.role !== 'admin') {
    return <AccessDenied detail="Halaman ini hanya tersedia untuk super admin." />;
  }
  if (role === 'creator' && session.serverRole === 'super_admin') {
    return <AccessDenied detail="Super admin tidak membuka workspace creator. Gunakan ringkasan operasional." />;
  }
  return <>{children}</>;
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const main = document.getElementById('konten-utama');
    main?.focus({ preventScroll: true });
  }, [pathname, hash]);
  return null;
}

/** Provider dan bootstrap sesi di rute induk. */
function RootLayout() {
  useEffect(() => {
    void loadBootstrap();
  }, []);

  return (
    <ToastProvider>
      <ScreenStateProvider>
        <ScrollToTop />
        <Outlet />
      </ScreenStateProvider>
    </ToastProvider>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/auth/login', element: <LoginPage /> },
      {
        path: '/creator',
        element: (
          <RequireRole role="creator">
            <CreatorListPage />
          </RequireRole>
        ),
      },
      {
        path: '/creator/surveys/:id/edit',
        element: (
          <RequireRole role="creator">
            <EditorPage />
          </RequireRole>
        ),
      },
      {
        path: '/creator/surveys/:id/preview',
        element: (
          <RequireRole role="creator">
            <PreviewPage />
          </RequireRole>
        ),
      },
      {
        path: '/creator/surveys/:id/publish',
        element: (
          <RequireRole role="creator">
            <PublishPage />
          </RequireRole>
        ),
      },
      {
        path: '/creator/surveys/:id/share',
        element: (
          <RequireRole role="creator">
            <SharePage />
          </RequireRole>
        ),
      },
      {
        path: '/creator/surveys/:id/results',
        element: (
          <RequireRole role="creator">
            <ResultsPage />
          </RequireRole>
        ),
      },
      {
        path: '/creator/surveys/:id/settings',
        element: (
          <RequireRole role="creator">
            <SettingsPage />
          </RequireRole>
        ),
      },
      {
        path: '/creator/surveys/:id/history',
        element: (
          <RequireRole role="creator">
            <HistoryPage />
          </RequireRole>
        ),
      },
      { path: '/s/:token', element: <IntroPage /> },
      { path: '/s/:token/form', element: <FormPage /> },
      { path: '/s/:token/review', element: <ReviewPage /> },
      { path: '/s/:token/receipt', element: <ReceiptPage /> },
      {
        path: '/admin',
        element: (
          <RequireRole role="admin">
            <AdminSummaryPage />
          </RequireRole>
        ),
      },
      {
        path: '/admin/accounts',
        element: (
          <RequireRole role="admin">
            <AdminAccountsPage />
          </RequireRole>
        ),
      },
      {
        path: '/admin/audit',
        element: (
          <RequireRole role="admin">
            <AdminAuditPage />
          </RequireRole>
        ),
      },
      {
        path: '/admin/integration',
        element: (
          <RequireRole role="admin">
            <AdminIntegrationPage />
          </RequireRole>
        ),
      },
      {
        path: '/admin/requests',
        element: (
          <RequireRole role="admin">
            <AdminRequestsPage />
          </RequireRole>
        ),
      },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
