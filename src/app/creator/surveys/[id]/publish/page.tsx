import { CreatorPage } from '../../../../../components/CreatorPage';
import { PublishPage } from '../../../../../screens/CreatorCore';

export const metadata = { title: 'Publikasi versi' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CreatorPage>
      <PublishPage id={id} />
    </CreatorPage>
  );
}
