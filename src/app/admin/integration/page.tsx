import type { Metadata } from 'next';
import { AdminPage } from '../../../components/AdminPage';
import { AdminIntegrationPage } from '../../../screens/Admin';

export const metadata: Metadata = { title: 'Status integrasi' };

export default function Page() {
  return (
    <AdminPage>
      <AdminIntegrationPage />
    </AdminPage>
  );
}
