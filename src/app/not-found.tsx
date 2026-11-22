import type { Metadata } from 'next';
import { NotFoundPage } from '../screens/Public';

export const metadata: Metadata = { title: 'Halaman tidak ditemukan' };

export default function NotFound() {
  return <NotFoundPage />;
}
