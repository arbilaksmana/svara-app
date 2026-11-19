import type { ReactNode } from 'react';
import { requireCreator } from '../lib/server/guards';
import { AccessDenied } from './AccessDenied';
import { CreatorBootGate } from './CreatorBootGate';

/** Guard server untuk seluruh halaman creator; redirect ke login bila belum masuk. */
export async function CreatorPage({ children }: { children: ReactNode }) {
  const account = await requireCreator();
  if (!account) {
    return <AccessDenied detail="Super admin tidak membuka workspace creator. Gunakan ringkasan operasional." />;
  }
  return <CreatorBootGate>{children}</CreatorBootGate>;
}
