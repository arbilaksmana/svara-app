import type { Metadata } from 'next';
import { AdminPage } from '../../../components/AdminPage';
import { AdminAuditPage } from '../../../screens/Admin';

export const metadata: Metadata = { title: 'Log audit' };

export default function Page() {
  return (
    <AdminPage>
      <AdminAuditPage />
    </AdminPage>
  );
}
