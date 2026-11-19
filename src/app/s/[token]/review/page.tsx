import type { Metadata } from 'next';
import { ReviewPage } from '../../../../screens/Respondent';

export const metadata: Metadata = { title: 'Tinjau jawaban' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReviewPage token={token} />;
}
