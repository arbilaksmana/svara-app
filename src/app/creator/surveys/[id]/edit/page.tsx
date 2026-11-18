import { CreatorPage } from '../../../../../components/CreatorPage';
import { EditorPage } from '../../../../../screens/CreatorCore';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CreatorPage>
      <EditorPage id={id} />
    </CreatorPage>
  );
}
