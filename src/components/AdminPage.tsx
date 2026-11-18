import type { ReactNode } from 'react';
import { requireAdmin } from '../lib/server/guards';
import { AccessDenied } from './AccessDenied';

/** Guard server untuk seluruh halaman admin; redirect ke login bila belum masuk. */
export async function AdminPage({ children }: { children: ReactNode }) {
  const account = await requireAdmin();
  if (!account) {
    return <AccessDenied detail="Halaman ini hanya tersedia untuk super admin." />;
  }
  return <>{children}</>;
}
