import type { Metadata } from 'next';
import { AdminOrgPage } from '../../../screens/Org';
import { AccessDenied } from '../../../components/AccessDenied';
import { requireOrgAdmin } from '../../../lib/server/guards';

export const metadata: Metadata = { title: 'Organisasi' };

/** Guard server: hanya org_admin yang terikat organisasi dapat membuka halaman ini. */
export default async function Page() {
  const account = await requireOrgAdmin();
  if (!account) {
    return <AccessDenied detail="Halaman ini hanya tersedia untuk admin organisasi." />;
  }
  return <AdminOrgPage />;
}
