import type { Metadata } from 'next';
import { AdminPage } from '../../../components/AdminPage';
import { AdminAccountsPage } from '../../../screens/Admin';

export const metadata: Metadata = { title: 'Akun dan izin' };

export default function Page() {
  return (
    <AdminPage>
      <AdminAccountsPage />
    </AdminPage>
  );
}
