import { createBrowserRouter, Outlet } from 'react-router-dom';
import { ScreenStateProvider } from './lib/state';
import { HomePage, LoginPage, NotFoundPage, PrivacyPage, TermsPage } from './pages/Public';
import { CreatorListPage, EditorPage, PreviewPage, PublishPage } from './pages/CreatorCore';
import { SharePage, ResultsPage, SettingsPage, HistoryPage } from './pages/CreatorData';
import { IntroPage, FormPage, ReviewPage, ReceiptPage } from './pages/Respondent';
import { AdminSummaryPage, AdminAccountsPage, AdminAuditPage, AdminIntegrationPage } from './pages/Admin';

/**
 * Provider state dipasang di elemen rute induk agar useSearchParams aktif,
 * lalu Outlet merender halaman yang cocok di dalamnya.
 */
function RootLayout() {
  return (
    <ScreenStateProvider>
      <Outlet />
    </ScreenStateProvider>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/auth/login', element: <LoginPage /> },
      { path: '/creator', element: <CreatorListPage /> },
      { path: '/creator/surveys/:id/edit', element: <EditorPage /> },
      { path: '/creator/surveys/:id/preview', element: <PreviewPage /> },
      { path: '/creator/surveys/:id/publish', element: <PublishPage /> },
      { path: '/creator/surveys/:id/share', element: <SharePage /> },
      { path: '/creator/surveys/:id/results', element: <ResultsPage /> },
      { path: '/creator/surveys/:id/settings', element: <SettingsPage /> },
      { path: '/creator/surveys/:id/history', element: <HistoryPage /> },
      { path: '/s/:token', element: <IntroPage /> },
      { path: '/s/:token/form', element: <FormPage /> },
      { path: '/s/:token/review', element: <ReviewPage /> },
      { path: '/s/:token/receipt', element: <ReceiptPage /> },
      { path: '/admin', element: <AdminSummaryPage /> },
      { path: '/admin/accounts', element: <AdminAccountsPage /> },
      { path: '/admin/audit', element: <AdminAuditPage /> },
      { path: '/admin/integration', element: <AdminIntegrationPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
