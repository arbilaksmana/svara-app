import type { Metadata } from 'next';
import { LoginPage } from '../../../screens/Public';

export const metadata: Metadata = { title: 'Masuk' };

export default function Page() {
  return <LoginPage />;
}
