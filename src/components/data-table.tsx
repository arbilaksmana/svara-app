"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
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
import { Button } from "./ui/button";
import { Select } from "./ui/select";
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

/**
 * True saat isi tabel melebihi lebarnya. Petunjuk geser mengikuti keadaan nyata, bukan ambang
 * viewport: lebar tabel tergantung jumlah kolom dan merek, jadi breakpoint tebakan selalu salah
 * di satu sisi (mis. 768px: tabel audit muat, tabel lain belum).
 */
function useOverflowX<T extends HTMLElement>(dependency: unknown) {
  const ref = useRef<T>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setOverflows(node.scrollWidth > node.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [dependency]);
  return [ref, overflows] as const;
}

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
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 5 });

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, pagination },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const toggleable = table
    .getAllColumns()
    .filter((column) => column.getCanHide());
  // Ambang lebar minimum dihitung dari kolom yang terlihat: menyembunyikan kolom lewat menu
  // "Kolom" mengubah kebutuhan min-w, dan petunjuk geser ikut diukur ulang (`useOverflowX`).
  const visibleCount = table.getVisibleLeafColumns().length;
  const minWidth =
    visibleCount >= 6
      ? "min-w-[44rem]"
      : visibleCount >= 5
        ? "min-w-[40rem]"
        : visibleCount >= 4
          ? "min-w-[34rem]"
          : "";
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const [viewportRef, overflows] = useOverflowX<HTMLDivElement>(visibleCount);
  // `plain` memakai baris sebelum pagination: kontrol halaman disembunyikan, jadi semua baris harus terlihat.
  const rows = plain ? table.getPrePaginationRowModel().rows : table.getPaginationRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
        hidden={plain}
      >
        {title ? (
          <div className="flex min-h-9 items-center text-body font-bold text-[color:var(--ad-text)]">
            {title}
          </div>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-caption text-[color:var(--ad-muted)]">
          Baris per halaman
          <Select
            value={String(pageSize)}
              onChange={(event) =>
                table.setPageSize(Number(event.target.value))
              }
            aria-label="Baris per halaman"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[var(--ad-border)] bg-[var(--ad-surface)] px-3 text-body-sm font-bold text-[color:var(--ad-text)] transition-colors duration-fast hover:bg-[var(--ad-soft)]">
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
                    onCheckedChangeAction={(checked) =>
                      column.toggleVisibility(checked)
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

      {minWidth && overflows ? (
        <p className="text-caption text-[color:var(--ad-muted)]">
          Geser tabel ke samping untuk melihat semua kolom.
        </p>
      ) : null}
      <div className="rounded-md border border-[var(--ad-border)]">
        <Table
          scrollRegionLabel={minWidth ? caption : undefined}
          className={minWidth}
          viewportRef={minWidth ? viewportRef : undefined}
          measureKey={visibleCount}
        >
          <TableCaption>{caption}</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
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
                          className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 font-bold text-[color:var(--ad-muted)] transition-colors duration-fast hover:text-[color:var(--ad-text)]"
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
                              className="size-3.5 text-[color:var(--ad-icon-low)]"
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
                    <TableCell key={cell.id}>
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
                  colSpan={columns.length}
                  className="py-8 text-center text-[color:var(--ad-muted)]"
                >
                  {emptyMessage}
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
        <p className="text-caption text-[color:var(--ad-muted)]">
          {data.length} baris
          {pageCount > 1 ? ` · halaman ${pageIndex + 1} dari ${pageCount}` : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Halaman sebelumnya"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
            Sebelumnya
          </Button>
          <Button
            variant="outline"
            size="sm"
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
