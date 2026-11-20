# Register a synthetic creator account (audit rehearsal)

This runbook exists for evidence only. It repeats the same steps a respondent or creator would take in the audit UI (`http://127.0.0.1:4320`, then `4321`/`4322`). It does not modify the product.

## Preconditions

- Audit UI/API/Next services running on ports 4320/4321/4322 with `svara_audit_ui`.
- A dedicated browser profile (context) that is not the user's own profile.
- Synthetic data only: `nama: Audit Creator`, `email: audit-creator+<timestamp>@example.invalid`, `password` 12+ characters with upper/lower/digit/symbol.

## Steps

1. Open `/auth/register`.
2. Fill the visible fields:
   - Nama lengkap
   - Email
   - Kata sandi
   - Ulangi kata sandi
   - Centang persetujuan/ketentuan
3. Submit.
4. Expected: session established and redirect to `/creator`.
5. Reload `/creator` to prove the session survives.

## Evidence to capture

- Screenshot of the filled form before submit (with the password masked).
- Screenshot of `/creator` after redirect.
- Console/network summary (status only; do not copy cookie values).
- Whether any hidden milestone banner appears or is absent.

## Not verified in this run

- Email delivery/verification (no SMTP in the audit environment).
- Password reset.
- Password-manager autofill.
- A real screen reader.
