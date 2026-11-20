import type { Metadata } from 'next';
import { AdminPage } from '../../../components/AdminPage';
import { AdminPlatformPage } from '../../../screens/Platform';

export const metadata: Metadata = { title: 'Profil platform' };

export default function Page() {
  return (
    <AdminPage>
      <AdminPlatformPage />
    </AdminPage>
  );
}
