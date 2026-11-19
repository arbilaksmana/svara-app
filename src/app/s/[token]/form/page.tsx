import type { Metadata } from 'next';
import { FormPage } from '../../../../screens/Respondent';

export const metadata: Metadata = { title: 'Formulir survei' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FormPage token={token} />;
}
