import { redirect } from 'next/navigation';
import { AccessDenied } from '../../components/AccessDenied';
import { CreatorBootGate } from '../../components/CreatorBootGate';
import { CreatorListPage } from '../../screens/CreatorCore';
import { requireCreator } from '../../lib/server/guards';
import { ROUTES } from '../../lib/routes';

export const metadata = { title: 'Daftar survei' };

/** Daftar creator tetap di `/creator`; org_admin dialihkan ke daftar ber-chrome organisasi. */
export default async function Page() {
  const account = await requireCreator();
  if (!account) {
    return <AccessDenied detail="Super admin tidak membuka workspace creator. Gunakan ringkasan operasional." />;
  }
  if (account.role === 'org_admin') redirect(ROUTES.creatorOrg);
  return (
    <CreatorBootGate>
      <CreatorListPage />
    </CreatorBootGate>
  );
}
