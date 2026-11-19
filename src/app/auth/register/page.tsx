import type { Metadata } from 'next';
import { RegisterPage } from '../../../screens/Register';

export const metadata: Metadata = { title: 'Buat akun' };

export default function Page() {
  return <RegisterPage />;
}
