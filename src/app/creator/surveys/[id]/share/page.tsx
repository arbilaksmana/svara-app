import { CreatorPage } from '../../../../../components/CreatorPage';
import { SharePage } from '../../../../../screens/CreatorData';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CreatorPage>
      <SharePage id={id} />
    </CreatorPage>
  );
}
