import type { Metadata } from 'next';
import { AdminPage } from '../../../components/AdminPage';
import { AdminRequestsPage } from '../../../screens/Admin';

export const metadata: Metadata = { title: 'Permintaan data' };

export default function Page() {
  return (
    <AdminPage>
      <AdminRequestsPage />
    </AdminPage>
  );
}
