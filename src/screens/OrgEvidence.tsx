'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import {
  Badge,
  Button,
  Card,
  Code,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  SectionTitle,
  Table,
  Td,
  TextArea,
} from '../components/ui';
import { StateView } from '../components/StateView';
import { useScreenState } from '../lib/state';
import { useToast } from '../components/Toast';
import {
  ApiError,
  guardianEvidenceFileUrl,
  listOrgGuardianEvidence,
  reviewOrgGuardianEvidence,
} from '../lib/api';
import { GUARDIAN_EVIDENCE_STATUS_LABEL, GUARDIAN_EVIDENCE_STATUS_TONE } from '../lib/labels';
import { formatBytes, formatWIB } from '../lib/summary';
import type { OrgGuardianEvidence } from '../lib/types';

type EvidenceFilter = 'self_attested' | 'verified' | 'rejected';
type Decision = 'verified' | 'rejected';

const FILTERS: Array<{ value: EvidenceFilter; label: string }> = [
  { value: 'self_attested', label: 'Menunggu tinjauan' },
  { value: 'verified', label: 'Terverifikasi' },
  { value: 'rejected', label: 'Ditolak' },
];

const DECISION_COPY: Record<Decision, { title: string; confirm: string }> = {
  verified: { title: 'Verifikasi bukti pendukung ini?', confirm: 'Verifikasi bukti' },
  rejected: { title: 'Tolak bukti pendukung ini?', confirm: 'Tolak bukti' },
};

const EMPTY_COPY: Record<EvidenceFilter, { title: string; detail: string }> = {
  self_attested: {
    title: 'Tidak ada bukti yang menunggu tinjauan',
    detail: 'Unggahan bukti pendukung dari responden organisasi Anda akan muncul di sini.',
  },
  verified: {
    title: 'Belum ada bukti terverifikasi',
    detail: 'Bukti yang Anda setujui akan tercatat di sini beserta waktu dan catatannya.',
  },
  rejected: {
    title: 'Belum ada bukti ditolak',
    detail: 'Bukti yang Anda tolak akan tercatat di sini beserta waktu dan catatannya.',
  },
};

function fileLabel(row: OrgGuardianEvidence): string {
  if (!row.guardian_evidence_file) return 'Tanpa berkas';
  return row.guardian_evidence_size === null
    ? row.guardian_evidence_file
    : `${row.guardian_evidence_file} · ${formatBytes(row.guardian_evidence_size)}`;
}

export function OrgEvidencePage() {
  const notify = useToast();
  const { state } = useScreenState('admin-org-evidence');
  const [filter, setFilter] = useState<EvidenceFilter>('self_attested');
  const [rows, setRows] = useState<OrgGuardianEvidence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [target, setTarget] = useState<{ row: OrgGuardianEvidence; decision: Decision } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    void listOrgGuardianEvidence(filter)
      .then((evidence) => {
        if (!cancelled) setRows(evidence);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setRows(null);
        setError(loadError instanceof ApiError ? loadError.message : 'Bukti pendukung gagal dimuat. Periksa koneksi lalu coba lagi.');
      });
    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey]);

  const openDecision = (row: OrgGuardianEvidence, decision: Decision) => {
    setNote('');
    setTarget({ row, decision });
  };

  const submitDecision = () => {
    if (!target) return;
    setBusy(true);
    void reviewOrgGuardianEvidence(target.row.consent_id, target.decision, note)
      .then(() => {
        notify(target.decision === 'verified' ? 'Bukti pendukung diverifikasi.' : 'Bukti pendukung ditolak.');
        setTarget(null);
        setNote('');
        setReloadKey((key) => key + 1);
      })
      .catch((reviewError: unknown) => {
        notify(reviewError instanceof Error ? reviewError.message : 'Keputusan gagal disimpan.', 'danger');
      })
      .finally(() => setBusy(false));
  };

  return (
    <Shell
      kind="admin"
      title="Bukti pendukung"
      subtitle="Tinjau unggahan bukti persetujuan dari survei organisasi Anda. Keputusan tercatat di log audit."
    >
      <StateView
        routeId="admin-org-evidence"
        state={state}
        permissionDetail="Halaman ini hanya tersedia untuk admin organisasi."
        emptyTitle={EMPTY_COPY[filter].title}
        emptyDetail={EMPTY_COPY[filter].detail}
      >
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-4">
            <SectionTitle>Antrean tinjauan</SectionTitle>
            <Field id="evidence-status" label="Status bukti">
              {(aria) => (
                <select
                  {...aria}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as EvidenceFilter)}
                  className="min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink focus:border-action md:max-w-xs"
                >
                  {FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              )}
            </Field>
            <p className="text-body-sm text-ink-muted">
              Berkas hanya dapat diunduh oleh admin organisasi pemilik survei; tautan unduhan memerlukan sesi aktif.
            </p>

            {error ? (
              <ErrorState
                title="Bukti pendukung gagal dimuat"
                detail={`${error} Tabel kosong bukan berarti tidak ada bukti.`}
                action={<Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>Coba lagi</Button>}
              />
            ) : rows === null ? (
              <LoadingState label="Memuat bukti pendukung…" rows={3} />
            ) : rows.length === 0 ? (
              <EmptyState title={EMPTY_COPY[filter].title}>{EMPTY_COPY[filter].detail}</EmptyState>
            ) : (
              <Table head={['Waktu', 'Survei', 'Berkas', 'Catatan', 'Status', 'Keputusan']}>
                {rows.map((row) => (
                  <tr key={row.consent_id}>
                    <Td>
                      {formatWIB(row.recorded_at)}
                      <span className="mt-1 block font-mono text-annotation tracking-mono text-ink-muted"><Code>{row.consent_id}</Code></span>
                    </Td>
                    <Td>{row.survey_title}</Td>
                    <Td>
                      {row.has_file ? (
                        <div className="flex min-w-0 items-center gap-2">
                          {row.guardian_evidence_mime?.startsWith('image/') && (
                            <img
                              src={guardianEvidenceFileUrl(row.consent_id)}
                              alt={`Pratinjau ${row.guardian_evidence_file ?? 'bukti pendukung'}`}
                              width={44}
                              height={44}
                              loading="lazy"
                              className="size-11 shrink-0 rounded-sm border border-n200 object-cover"
                            />
                          )}
                          <div className="min-w-0">
                            <a
                              href={guardianEvidenceFileUrl(row.consent_id)}
                              aria-label={`Unduh berkas ${row.guardian_evidence_file ?? 'bukti pendukung'}`}
                              className="inline-flex min-h-[24px] items-center text-body-sm font-bold text-action underline decoration-1 underline-offset-4"
                            >
                              Unduh berkas
                            </a>
                            <p className="break-words text-caption text-ink-muted">{fileLabel(row)}</p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-caption text-ink-muted">Tanpa berkas</span>
                      )}
                    </Td>
                    <Td>{row.guardian_evidence_ref ?? <span className="text-ink-muted">—</span>}</Td>
                    <Td>
                      <Badge tone={GUARDIAN_EVIDENCE_STATUS_TONE[row.guardian_evidence_status] ?? 'neutral'}>
                        {GUARDIAN_EVIDENCE_STATUS_LABEL[row.guardian_evidence_status] ?? row.guardian_evidence_status}
                      </Badge>
                      {row.guardian_evidence_reviewed_at && (
                        <p className="mt-1 text-caption text-ink-muted">
                          {formatWIB(row.guardian_evidence_reviewed_at)}
                          {row.guardian_evidence_reviewed_by && <> · <Code>{row.guardian_evidence_reviewed_by}</Code></>}
                        </p>
                      )}
                      {row.guardian_evidence_review_note && (
                        <p className="mt-1 break-words text-caption text-ink">{row.guardian_evidence_review_note}</p>
                      )}
                    </Td>
                    <Td>
                      {row.guardian_evidence_status === 'self_attested' ? (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => openDecision(row, 'verified')}>Verifikasi</Button>
                          <Button variant="danger" onClick={() => openDecision(row, 'rejected')}>Tolak</Button>
                        </div>
                      ) : (
                        <span className="text-caption text-ink-muted">Sudah diputuskan</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <ConfirmDialog
          open={target !== null}
          title={target ? DECISION_COPY[target.decision].title : ''}
          detail={target ? `${target.row.survey_title} · bukti dicatat ${formatWIB(target.row.recorded_at)}. Keputusan berlaku untuk catatan persetujuan ${target.row.consent_id} dan tercatat di audit organisasi.` : ''}
          confirmLabel={target ? DECISION_COPY[target.decision].confirm : ''}
          tone={target?.decision === 'rejected' ? 'danger' : 'primary'}
          busy={busy}
          onClose={() => { if (!busy) setTarget(null); }}
          onConfirm={submitDecision}
        >
          <Field
            id="evidence-note"
            label="Catatan keputusan (opsional)"
            hint="Maksimal 500 karakter. Catatan tampil di riwayat bukti pendukung."
          >
            {(aria) => (
              <TextArea
                {...aria}
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </ConfirmDialog>
      </StateView>
    </Shell>
  );
}
