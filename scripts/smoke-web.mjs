/**
 * Smoke test for the split web/API deployment.
 * Covers: web root, login page, nonce CSP, API rewrite health, login through
 * the rewrite, and authenticated bootstrap with the returned session cookie.
 */
const WEB = (process.env.SMOKE_WEB_ORIGIN ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@ci.local';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'CiStrongPass123!';
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS ?? 90_000);

const failures = [];

function pass(name, detail = '') {
  console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

function fail(name, detail) {
  failures.push(`${name}: ${detail}`);
  console.error(`FAIL ${name}: ${detail}`);
}

async function check(name, run) {
  try {
    await run();
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

async function waitForRoot() {
  const deadline = Date.now() + WAIT_MS;
  let last = 'belum ada respons';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${WEB}/`, { redirect: 'manual' });
      if (response.ok) return response;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`web tidak siap dalam ${WAIT_MS}ms: ${last}`);
}

let origin = WEB;

await check('web root', async () => {
  const response = await waitForRoot();
  origin = new URL(response.url).origin;
  const html = await response.text();
  if (!html.includes('Svara')) throw new Error('markup root tidak memuat Svara');
  pass('web root', `${response.status}`);
});

await check('login page', async () => {
  const response = await fetch(`${origin}/auth/login`);
  const html = await response.text();
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!html.includes('Masuk ke workspace')) throw new Error('judul login tidak ditemukan');
  pass('login page', `${response.status}`);
});

await check('nonce CSP', async () => {
  const response = await fetch(`${origin}/`);
  const csp = response.headers.get('content-security-policy') ?? '';
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  if (!nonce) throw new Error('header CSP tidak memuat nonce');
  if (/'unsafe-inline'/.test(csp.split(';').find((part) => part.trim().startsWith('script-src')) ?? '')) {
    throw new Error('script-src memuat unsafe-inline');
  }
  const html = await response.text();
  const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  if (tags.length === 0) throw new Error('tidak ada tag script untuk diperiksa');
  const missing = tags.filter((tag) => !tag.includes(`nonce="${nonce}"`) && !tag.includes(`nonce='${nonce}'`));
  if (missing.length > 0) throw new Error(`${missing.length} tag script tanpa nonce`);
  pass('nonce CSP', `${tags.length} script`);
});

await check('api rewrite health', async () => {
  const response = await fetch(`${origin}/api/v1/health`);
  const body = await response.json();
  if (!response.ok || body?.data?.ok !== true) throw new Error(`status ${response.status}`);
  pass('api rewrite health', `${response.status}`);
});

let cookie = '';
await check('login via rewrite', async () => {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-svara-client': 'web',
      origin,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `status ${response.status}`);
  if (body?.data?.account?.role !== 'super_admin') throw new Error('akun smoke bukan super_admin');
  const setCookie = response.headers.getSetCookie?.() ?? [];
  cookie = setCookie.map((value) => value.split(';')[0]).find((value) => value.startsWith('svara_session=')) ?? '';
  if (!cookie) throw new Error('Set-Cookie svara_session tidak diterima');
  pass('login via rewrite', 'super_admin');
});

await check('authenticated bootstrap', async () => {
  const response = await fetch(`${origin}/api/v1/bootstrap`, { headers: { cookie } });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `status ${response.status}`);
  if (!body?.data?.account?.id) throw new Error('bootstrap tanpa account');
  pass('authenticated bootstrap', body.data.account.role);
});

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke check gagal`);
  process.exit(1);
}
console.log('\nSemua smoke check lulus');
