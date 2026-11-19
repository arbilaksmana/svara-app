import { CreatorPage } from '../../../../../components/CreatorPage';
import { PreviewPage } from '../../../../../screens/CreatorCore';

export const metadata = { title: 'Pratinjau instrumen' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CreatorPage>
      <PreviewPage id={id} />
    </CreatorPage>
  );
}
