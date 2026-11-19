import { CreatorPage } from '../../components/CreatorPage';
import { CreatorListPage } from '../../screens/CreatorCore';

export const metadata = { title: 'Daftar survei' };

export default function Page() {
  return (
    <CreatorPage>
      <CreatorListPage />
    </CreatorPage>
  );
}
