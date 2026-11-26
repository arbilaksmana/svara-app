import type { Metadata } from 'next';
import { OrgEvidencePage } from '../../../../screens/OrgEvidence';
import { AccessDenied } from '../../../../components/AccessDenied';
import { requireOrgAdmin } from '../../../../lib/server/guards';

export const metadata: Metadata = { title: 'Bukti pendukung' };

/** Guard server: hanya org_admin yang terikat organisasi dapat meninjau bukti pendukung. */
export default async function Page() {
  const account = await requireOrgAdmin();
  if (!account) {
    return <AccessDenied detail="Halaman ini hanya tersedia untuk admin organisasi." />;
  }
  return <OrgEvidencePage />;
}
