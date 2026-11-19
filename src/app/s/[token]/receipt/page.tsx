import type { Metadata } from 'next';
import { ReceiptPage } from '../../../../screens/Respondent';

export const metadata: Metadata = { title: 'Bukti pengiriman' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReceiptPage token={token} />;
}
