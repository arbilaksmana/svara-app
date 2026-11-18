import { IntroPage } from '../../../screens/Respondent';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <IntroPage token={token} />;
}
