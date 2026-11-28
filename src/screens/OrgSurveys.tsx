'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '../components/Shell';
import { Code } from '../components/ui';
import { Badge } from '../components/ui/badge';
import { BusyButton } from '../components/BusyButton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { StateView, SuccessBanner, ValidationSummary } from '../components/StateView';
import { DataTable } from '../components/data-table';
import { useScreenState } from '../lib/state';
import { useToast } from '../components/Toast';
import { ROUTES } from '../lib/routes';
import { STATUS_LABEL } from '../lib/labels';
import { canManageAs, duplicateVersion, useStore } from '../lib/store';
import { surveys, versionsFor } from '../lib/fixtures/surveys';
import { formatWIB } from '../lib/summary';
import type { ColumnDef } from '@tanstack/react-table';
import type { Survey } from '../lib/types';

type SurveyRow = Survey & { versions: number; manageable: boolean };

/** Inisial dua huruf untuk avatar pemilik survei. */
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?'
  );
}

const STATUS_VARIANT: Record<Survey['status'], 'success' | 'secondary' | 'warning' | 'outline'> = {
  draft: 'secondary',
  published: 'success',
  closed: 'warning',
  archived: 'outline',
};

const FILTERS = [
  { value: 'semua', label: 'Semua' },
  { value: 'draft', label: 'Draf' },
  { value: 'published', label: 'Terbit' },
  { value: 'closed', label: 'Ditutup' },
  { value: 'archived', label: 'Arsip' },
] as const;

function surveyColumns({
  duplicating,
  onEdit,
  onResults,
  onDuplicate,
}: {
  duplicating: string | null;
  onEdit: (title: string, id: string) => void;
  onResults: (title: string, id: string) => void;
  onDuplicate: (id: string) => void;
}): ColumnDef<SurveyRow>[] {
  return [
    {
      accessorKey: 'title',
      header: 'Survei',
      cell: ({ row }) => (
        <div className="flex min-w-0 items-start gap-3">
          <Avatar className="size-9 rounded-md bg-muted">
            <AvatarFallback className="rounded-md text-annotation font-bold text-muted-foreground">
              {initials(row.original.title)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-bold text-foreground">{row.original.title}</p>
            <p className="text-caption text-muted-foreground">
              {row.original.organization_id ? 'Lingkup organisasi' : 'Lingkup individu'} ·{' '}
              {row.original.versions} versi · diperbarui {formatWIB(row.original.updated_at)}
            </p>
            <p className="font-mono text-annotation tracking-mono text-muted-foreground">
              <Code>{row.original.id}</Code>
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status]}>
          {STATUS_LABEL[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'owner',
      accessorKey: 'owner_id',
      header: 'Pemilik',
      cell: ({ row }) =>
        row.original.manageable ? (
          <Badge variant="outline">Anda</Badge>
        ) : (
          <span className="text-caption text-muted-foreground">Diberikan akses</span>
        ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {row.original.manageable && (
            <BusyButton
              variant="ghost"
              className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
              onClick={() => onEdit(row.original.title, row.original.id)}
            >
              Buka editor
            </BusyButton>
          )}
          <BusyButton
            variant="ghost"
            onClick={() => onResults(row.original.title, row.original.id)}
          >
            Lihat hasil
          </BusyButton>
          {row.original.manageable && (
            <BusyButton
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              loading={duplicating === row.original.id}
              disabled={duplicating !== null}
              onClick={() => onDuplicate(row.original.id)}
            >
              Salin survei
            </BusyButton>
          )}
        </div>
      ),
    },
  ];
}

/**
 * Daftar survei untuk org_admin: tabel dasbor yang sama dengan halaman admin, tanpa
 * aksi yang hanya tersedia bagi creator (membuat draf).
 */
export function OrgSurveysPage() {
  const { state, link } = useScreenState('creator-list');
  const router = useRouter();
  const notify = useToast();
  const { session } = useStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('semua');
  const [duplicating, setDuplicating] = useState<string | null>(null);

  const rows: SurveyRow[] = surveys
    .filter((survey) => filter === 'semua' || survey.status === filter)
    .map((survey) => ({
      ...survey,
      versions: versionsFor(survey.id).length,
      manageable: canManageAs(session, survey),
    }));

  const columns = surveyColumns({
    duplicating,
    onEdit: (_title, id) => {
      router.push(link(ROUTES.creatorEdit(id)));
    },
    onResults: (_title, id) => {
      router.push(link(ROUTES.creatorResults(id)));
    },
    onDuplicate: (id) => {
      setDuplicating(id);
      void duplicateVersion(id)
        .then((newId) => {
          notify('Survei disalin tanpa respons, undangan, atau izin khusus.');
          router.push(link(ROUTES.creatorEdit(newId)));
        })
        .catch((error: unknown) =>
          notify(error instanceof Error ? error.message : 'Survei gagal disalin.', 'danger'),
        )
        .finally(() => setDuplicating(null));
    },
  });

  return (
    <Shell
      kind="creator"
      title="Daftar survei"
      subtitle="Kelola seluruh instrumen Anda, dari draf hingga versi yang diterbitkan."
    >
      <StateView
        routeId="creator-list"
        state={state}
        emptyTitle="Belum memiliki survei"
        emptyDetail="Survei organisasi Anda akan tampil di sini."
        permissionDetail="Daftar survei milik creator lain tidak dapat dibaca."
      >
        <div className="flex flex-col gap-5">
          {state === 'success' && (
            <SuccessBanner title="Draf tersimpan">
              Perubahan draf Anda sudah tersimpan di server.
            </SuccessBanner>
          )}
          {state === 'validation' && (
            <ValidationSummary items={['Judul survei tidak boleh kosong.']} />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Survei organisasi
              </CardTitle>
              <CardDescription>
                {session?.organizationId
                  ? 'Admin organisasi melihat dan mengelola survei lingkup organisasi; survei lingkup individu tetap milik creator-nya.'
                  : 'Daftar instrumen yang Anda kelola.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={columns}
                data={rows}
                caption="Daftar survei, status, pemilik, dan aksi"
                emptyMessage="Belum ada survei pada status ini."
                filterPlaceholder="Cari judul survei"
                filterText={(row) => `${row.title} ${row.id} ${STATUS_LABEL[row.status]}`}
                toolbarExtra={
                  <Select
                    value={filter}
                    onValueChange={(value) => setFilter(value as typeof filter)}
                  >
                    <SelectTrigger aria-label="Filter status" className="w-40">
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
            </CardContent>
          </Card>
        </div>
      </StateView>
    </Shell>
  );
}