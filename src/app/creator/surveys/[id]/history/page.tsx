import { CreatorPage } from '../../../../../components/CreatorPage';
import { HistoryPage } from '../../../../../screens/CreatorData';

export const metadata = { title: 'Riwayat versi' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CreatorPage>
      <HistoryPage id={id} />
    </CreatorPage>
  );
}
