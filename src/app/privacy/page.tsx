import type { Metadata } from 'next';
import { PrivacyPage } from '../../screens/Public';

export const metadata: Metadata = { title: 'Kebijakan privasi' };

export default function Page() {
  return <PrivacyPage />;
}
