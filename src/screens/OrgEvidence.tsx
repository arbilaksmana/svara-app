'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { Code } from '../components/ui';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { BusyButton } from '../components/BusyButton';
import { Badge } from '../components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { DataTable } from '../components/data-table';
import { Field } from '../components/ui/field';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
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
import { Check } from 'runeicons-react/icons/Check';
import { X } from 'runeicons-react/icons/X';
import { withIconClass } from '../components/rune-icon';
import { formatBytes, formatWIB, formatWIBCompact } from '../lib/summary';
import type { ColumnDef } from '@tanstack/react-table';
import type { OrgGuardianEvidence } from '../lib/types';

type EvidenceFilter = 'all' | 'self_attested' | 'verified' | 'rejected';
type Decision = 'verified' | 'rejected';

const CheckIcon = withIconClass(Check);
const XIcon = withIconClass(X);

const FILTERS: Array<{ value: EvidenceFilter; label: string }> = [
  { value: 'self_attested', label: 'Menunggu tinjauan' },
  { value: 'verified', label: 'Terverifikasi' },
  { value: 'rejected', label: 'Ditolak' },
  { value: 'all', label: 'Semua bukti' },
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
  all: {
    title: 'Belum ada bukti pendukung',
    detail: 'Unggahan bukti pendukung dari survei organisasi Anda akan muncul di sini.',
  },
};

function fileLabel(row: OrgGuardianEvidence): string {
  if (!row.guardian_evidence_file) return 'Tanpa berkas';
  return row.guardian_evidence_size === null
    ? row.guardian_evidence_file
    : `${row.guardian_evidence_file} · ${formatBytes(row.guardian_evidence_size)}`;
}

/** Kolom antrean bukti, gaya tabel dasbor: identitas, status, lalu aksi di ujung kanan. */
function evidenceColumns(
  onDecide: (row: OrgGuardianEvidence, decision: Decision) => void,
): ColumnDef<OrgGuardianEvidence>[] {
  return [
    {
      accessorKey: 'recorded_at',
      header: 'Waktu',
      meta: { className: 'hidden sm:table-cell align-top' },
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="text-body-sm text-foreground">
            <span className="sm:hidden">{formatWIBCompact(row.original.recorded_at)}</span>
            <span className="hidden sm:inline">{formatWIB(row.original.recorded_at)}</span>
          </p>
          <span className="hidden font-mono text-annotation tracking-mono text-muted-foreground sm:inline">
            <Code>{row.original.consent_id}</Code>
          </span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      meta: { className: 'min-w-40' },
      cell: ({ row }) => (
        <div className="min-w-0">
          <Badge
            variant={
              GUARDIAN_EVIDENCE_STATUS_TONE[row.original.guardian_evidence_status] ?? 'secondary'
            }
            aria-label={
              GUARDIAN_EVIDENCE_STATUS_LABEL[row.original.guardian_evidence_status] ??
              row.original.guardian_evidence_status
            }
          >
            <span className="sm:hidden" aria-hidden="true">
              {row.original.guardian_evidence_status === 'self_attested'
                ? 'Tunggu'
                : (GUARDIAN_EVIDENCE_STATUS_LABEL[row.original.guardian_evidence_status] ??
                  row.original.guardian_evidence_status)}
            </span>
            <span className="hidden sm:inline" aria-hidden="true">
              {GUARDIAN_EVIDENCE_STATUS_LABEL[row.original.guardian_evidence_status] ??
                row.original.guardian_evidence_status}
            </span>
          </Badge>
          {row.original.guardian_evidence_reviewed_at && (
            <p className="mt-1 text-caption text-muted-foreground">
              {formatWIB(row.original.guardian_evidence_reviewed_at)}
              {row.original.guardian_evidence_reviewed_by && (
                <>
                  {' · '}
                  <Code>{row.original.guardian_evidence_reviewed_by}</Code>
                </>
              )}
            </p>
          )}
          {row.original.guardian_evidence_review_note && (
            <p className="mt-1 break-words text-caption text-foreground">
              {row.original.guardian_evidence_review_note}
            </p>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'survey_title',
      header: 'Survei',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="min-w-0 truncate font-bold text-foreground">{row.original.survey_title}</p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {row.original.has_file ? (
              <span className="flex min-w-0 items-center gap-1.5">
                {row.original.guardian_evidence_mime?.startsWith('image/') && (
                  <img
                    src={guardianEvidenceFileUrl(row.original.consent_id)}
                    alt={`Pratinjau ${row.original.guardian_evidence_file ?? 'bukti pendukung'}`}
                    width={32}
                    height={32}
                    loading="lazy"
                    className="size-8 shrink-0 rounded-sm border border-border object-cover"
                  />
                )}
                <a
                  href={guardianEvidenceFileUrl(row.original.consent_id)}
                  aria-label={`Unduh berkas ${row.original.guardian_evidence_file ?? 'bukti pendukung'}`}
                  className="text-caption font-bold text-primary underline decoration-1 underline-offset-4"
                >
                  {fileLabel(row.original)}
                </a>
              </span>
            ) : (
              <span className="text-caption text-muted-foreground">Tanpa berkas</span>
            )}
            {row.original.guardian_evidence_ref && (
              <span className="min-w-0 break-words text-caption text-muted-foreground">
                {row.original.guardian_evidence_ref}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'decision',
      header: '',
      /** Aksi tetap terjangkau saat tabel bergulir horizontal di layar sempit. */
      meta: { className: 'sticky right-0 z-10 border-l border-border bg-card sm:static sm:border-l-0' },
      cell: ({ row }) =>
        row.original.guardian_evidence_status === 'self_attested' ? (
          <div className="flex flex-nowrap items-center justify-end gap-1 whitespace-nowrap">
            <BusyButton
              variant="ghost"
              size="icon"
              aria-label="Verifikasi bukti"
              title="Verifikasi"
              className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-500/15"
              onClick={() => onDecide(row.original, 'verified')}
            >
              <CheckIcon className="size-4" />
            </BusyButton>
            <BusyButton
              variant="ghost"
              size="icon"
              aria-label="Tolak bukti"
              title="Tolak"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDecide(row.original, 'rejected')}
            >
              <XIcon className="size-4" />
            </BusyButton>
          </div>
        ) : (
          <span className="block text-end text-caption text-muted-foreground">
            {row.original.guardian_evidence_status === 'pending' ? 'Belum diunggah' : '—'}
          </span>
        ),
    },
  ];
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
          <Card>
            <CardHeader>
              <CardTitle>Antrean tinjauan</CardTitle>
              <CardDescription>
                Berkas hanya dapat diunduh oleh admin organisasi pemilik survei; tautan unduhan
                memerlukan sesi aktif.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error ? (
                <Alert variant="destructive" className="flex flex-col items-start gap-3">
                  <AlertTitle>Bukti pendukung gagal dimuat</AlertTitle>
                  <AlertDescription className="text-body-sm">
                    <p>{error} Tabel kosong bukan berarti tidak ada bukti.</p>
                    <BusyButton
                      variant="outline"
                      className="mt-3"
                      onClick={() => setReloadKey((key) => key + 1)}
                    >
                      Coba lagi
                    </BusyButton>
                  </AlertDescription>
                </Alert>
              ) : rows === null ? (
                <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
                  <p className="text-body-sm text-muted-foreground">Memuat bukti pendukung…</p>
                  {Array.from({ length: 3 }, (_, index) => (
                    <Skeleton key={index} className="h-16 w-full rounded-md" />
                  ))}
                </div>
              ) : (
                <DataTable
                  columns={evidenceColumns(openDecision)}
                  data={rows}
                  caption="Antrean bukti pendukung, status, dan keputusan"
                  emptyMessage={EMPTY_COPY[filter].title}
                  filterPlaceholder="Cari survei atau kode"
                  filterText={(row) =>
                    `${row.survey_title} ${row.consent_id} ${row.guardian_evidence_file ?? ''} ${
                      row.guardian_evidence_ref ?? ''
                    } ${GUARDIAN_EVIDENCE_STATUS_LABEL[row.guardian_evidence_status] ?? ''}`
                  }
                  toolbarExtra={
                    <Select
                      value={filter}
                      onValueChange={(value) => setFilter(value as EvidenceFilter)}
                    >
                      <SelectTrigger aria-label="Filter status bukti" className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FILTERS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>

        <Dialog
          open={target !== null}
          onOpenChange={(next) => {
            if (!next && !busy) setTarget(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{target ? DECISION_COPY[target.decision].title : ''}</DialogTitle>
              <DialogDescription>
                {target
                  ? `${target.row.survey_title} · bukti dicatat ${formatWIB(target.row.recorded_at)}. Keputusan berlaku untuk catatan persetujuan ${target.row.consent_id} dan tercatat di audit organisasi.`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            <Field
              id="evidence-note"
              label="Catatan keputusan (opsional)"
              hint="Maksimal 500 karakter. Catatan tampil di riwayat bukti pendukung."
            >
              {(aria) => (
                <Textarea
                  {...aria}
                  value={note}
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
            <DialogFooter>
              <BusyButton variant="outline" disabled={busy} onClick={() => setTarget(null)}>
                Batal
              </BusyButton>
              <BusyButton
                variant={target?.decision === 'rejected' ? 'destructive' : 'default'}
                loading={busy}
                onClick={submitDecision}
              >
                {target ? DECISION_COPY[target.decision].confirm : ''}
              </BusyButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </StateView>
    </Shell>
  );
}