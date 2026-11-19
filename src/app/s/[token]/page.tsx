import type { Metadata } from 'next';
import { IntroPage } from '../../../screens/Respondent';

export const metadata: Metadata = { title: 'Pengantar survei' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <IntroPage token={token} />;
}
