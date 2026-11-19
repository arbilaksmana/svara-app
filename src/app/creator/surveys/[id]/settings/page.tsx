import { CreatorPage } from '../../../../../components/CreatorPage';
import { SettingsPage } from '../../../../../screens/CreatorData';

export const metadata = { title: 'Pengaturan survei' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CreatorPage>
      <SettingsPage id={id} />
    </CreatorPage>
  );
}
