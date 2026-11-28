import type { Metadata } from 'next';
import { CreatorPage } from '../../../components/CreatorPage';
import { OrgSurveysPage } from '../../../screens/OrgSurveys';
import { AccessDenied } from '../../../components/AccessDenied';
import { requireOrgAdmin } from '../../../lib/server/guards';

export const metadata: Metadata = { title: 'Daftar survei' };

/** Guard server: daftar survei lingkup organisasi hanya untuk org_admin. */
export default async function Page() {
  const account = await requireOrgAdmin();
  if (!account) {
    return <AccessDenied detail="Halaman ini hanya tersedia untuk admin organisasi." />;
  }
  return (
    <CreatorPage>
      <OrgSurveysPage />
    </CreatorPage>
  );
}