import { CreatorPage } from '../../../../../components/CreatorPage';
import { ResultsPage } from '../../../../../screens/CreatorData';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CreatorPage>
      <ResultsPage id={id} />
    </CreatorPage>
  );
}
