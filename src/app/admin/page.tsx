import type { Metadata } from 'next';
import { AdminPage } from '../../components/AdminPage';
import { AdminSummaryPage } from '../../screens/Admin';

export const metadata: Metadata = { title: 'Ringkasan operasional' };

export default function Page() {
  return (
    <AdminPage>
      <AdminSummaryPage />
    </AdminPage>
  );
}
