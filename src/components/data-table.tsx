"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown } from "runeicons-react/icons/ArrowDown";
import { ArrowUp } from "runeicons-react/icons/ArrowUp";
import { ArrowUpDown } from "runeicons-react/icons/ArrowUpDown";
import { ChevronLeft } from "runeicons-react/icons/ChevronLeft";
import { ChevronRight } from "runeicons-react/icons/ChevronRight";
import { Columns3 } from "runeicons-react/icons/Columns3";
import { withIconClass } from "./rune-icon";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const PAGE_SIZES = [5, 10, 20];

const ArrowDownIcon = withIconClass(ArrowDown);
const ArrowUpIcon = withIconClass(ArrowUp);
const ArrowUpDownIcon = withIconClass(ArrowUpDown);
const ChevronLeftIcon = withIconClass(ChevronLeft);
const ChevronRightIcon = withIconClass(ChevronRight);
const Columns3Icon = withIconClass(Columns3);

/**
 * Data table gaya shadcn (@tanstack/react-table): sorting per kolom, pagination, dan toggle
 * visibilitas kolom. Dipakai tabel metrik halaman Ringkasan admin.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  caption,
  emptyMessage,
  title,
  plain = false,
  filterPlaceholder,
  filterText,
  subtitle,
  compact = false,
  toolbarExtra,
  filter: filterProp,
  onFilterChange,
  cellClassName,
}: {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Deskripsi tabel untuk screen reader (elemen <caption>). */
  caption: string;
  emptyMessage: string;
  /** Judul di baris kontrol, sejajar dengan "Baris per halaman" dan "Kolom". */
  title?: ReactNode;
  /** True: kontrol sorting, pagination, dan kolom disembunyikan; semua baris dirender. */
  plain?: boolean;
  /** Placeholder isian cari; mengisi ini menampilkan kontrol pencarian di baris kontrol. */
  filterPlaceholder?: string;
  /** Teks yang dicari per baris; bawaan: semua nilai aksesornya. */
  filterText?: (row: TData) => string;
  /** Keterangan singkat di bawah baris kontrol, sejajar kiri dengan judul. */
  subtitle?: string;
  /** Kontrol ringkas ala /admin/audit: tanpa label "Baris per halaman", opsi "{n} baris". */
  compact?: boolean;
  /** Kontrol tambahan sebelum isian cari, mis. filter jenis pada kolom tertentu. */
  toolbarExtra?: ReactNode;
  /** Nilai pencarian terkendali; kosongkan untuk state internal. */
  filter?: string;
  /** Perubahan pencarian saat nilai dikendalikan pemanggil. */
  onFilterChange?: (value: string) => void;
  /** Padding horizontal tambahan untuk sel dan tajuk, mis. "px-3" pada tabel padat 6 kolom. */
  cellClassName?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 5 });
  const [innerFilter, setInnerFilter] = useState("");
  const filter = filterProp ?? innerFilter;
  const updateFilter = (value: string | ((old: string) => string)) => {
    const next = typeof value === "function" ? value(filter) : value;
    if (onFilterChange) onFilterChange(next);
    else setInnerFilter(next);
  };

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, pagination, globalFilter: filter },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    onGlobalFilterChange: updateFilter,
    globalFilterFn: (row, _columnId, value) => {
      const query = String(value).trim().toLowerCase();
      if (!query) return true;
      const haystack = filterText
        ? filterText(row.original)
        : Object.values(row.original as Record<string, unknown>).join(" ");
      return haystack.toLowerCase().includes(query);
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const toggleable = table
    .getAllColumns()
    .filter((column) => column.getCanHide());
  // Ambang lebar minimum dihitung dari kolom yang terlihat: menyembunyikan kolom lewat menu
  // "Kolom" mengubah kebutuhan min-w.
  const visibleCount = table.getVisibleLeafColumns().length;
  // 4 kolom (mis. antrean bukti) harus muat di 390px tanpa menggeser kolom aksi; mulai 5 kolom
  // tabel diberi lebar minimum dan digulir di dalam kontainernya.
  const minWidth = visibleCount >= 6 ? "min-w-[44rem]" : visibleCount >= 5 ? "min-w-[36rem]" : "";
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  // Pagination boleh terkunci ke halaman kosong setelah pemanggil mengganti `data` (mis. filter status
  // baru). Tarik halaman ke halaman terakhir yang ada agar baris dengan aksi tidak tersembunyi.
  useEffect(() => {
    if (pageCount > 0 && pageIndex >= pageCount) {
      setPagination((current) => ({ ...current, pageIndex: pageCount - 1 }));
    }
  }, [pageCount, pageIndex]);
  // `plain` memakai baris sebelum pagination: kontrol halaman disembunyikan, jadi semua baris harus terlihat.
  const rows = plain ? table.getPrePaginationRowModel().rows : table.getPaginationRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
        hidden={plain}
      >
        {title ? (
          <div className="flex min-h-11 items-center text-body font-bold text-foreground">
            {title}
          </div>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
        {filterPlaceholder ? (
          <Input
            type="search"
            value={filter}
            onChange={(event) => updateFilter(event.target.value)}
            placeholder={filterPlaceholder}
            aria-label={filterPlaceholder}
            className="w-56"
          />
        ) : null}
        {toolbarExtra}
        {compact ? (
          <span className="w-32">
            <Select
              value={String(pageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger aria-label="Baris per halaman" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} baris
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        ) : (
          <label className="flex items-center gap-2 whitespace-nowrap text-caption text-muted-foreground">
            Baris per halaman
            <Select
              value={String(pageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger aria-label="Baris per halaman" className="h-11 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border bg-card px-3 text-body-sm font-bold text-foreground transition-colors duration-fast hover:bg-muted">
              <Columns3Icon aria-hidden="true" className="size-4" />
            Kolom
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Tampilkan kolom</DropdownMenuLabel>
            {toggleable.map((column) => {
              const header = column.columnDef.header;
              return (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                    onCheckedChange={(checked) =>
                      column.toggleVisibility(checked === true)
                    }
                >
                    {typeof header === "string" ? header : column.id}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>

      {!plain && subtitle ? (
        <p className="text-caption text-muted-foreground">{subtitle}</p>
      ) : null}

      <div className="rounded-md border border-border">
        <Table className={minWidth} scrollRegionLabel={minWidth ? caption : undefined}>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(cellClassName, (header.column.columnDef.meta as { className?: string } | undefined)?.className)}
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 font-bold text-muted-foreground transition-colors duration-fast hover:text-foreground"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sorted === "asc" ? (
                            <ArrowUpIcon
                              aria-hidden="true"
                              className="size-3.5"
                            />
                          ) : sorted === "desc" ? (
                            <ArrowDownIcon
                              aria-hidden="true"
                              className="size-3.5"
                            />
                          ) : (
                            <ArrowUpDownIcon
                              aria-hidden="true"
                              className="size-3.5 text-muted-foreground"
                            />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        cellClassName,
                        (cell.column.columnDef.meta as { className?: string } | undefined)?.className,
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="py-8 text-center text-muted-foreground"
                >
                  {filter.trim() ? "Tidak ada entri yang cocok dengan pencarian." : emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-2"
        hidden={plain}
      >
        <p className="text-caption text-muted-foreground">
          {filteredCount} baris
          {filteredCount !== data.length ? ` dari ${data.length}` : ""}
          {pageCount > 1 ? ` · halaman ${pageIndex + 1} dari ${pageCount}` : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Halaman sebelumnya"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
            Sebelumnya
          </Button>
          <Button
            variant="outline"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Halaman berikutnya"
          >
            Berikutnya
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
