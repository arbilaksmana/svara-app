import type { Metadata } from 'next';
import { TermsPage } from '../../screens/Public';

export const metadata: Metadata = { title: 'Ketentuan layanan' };

export default function Page() {
  return <TermsPage />;
}
