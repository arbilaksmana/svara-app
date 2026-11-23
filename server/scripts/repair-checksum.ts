/**
 * `pnpm db:repair-checksum --version <nama-file.sql> --accept <checksum-tersimpan>`
 *
 * Menulis ulang checksum satu migrasi yang isinya berubah setelah sempat diterapkan. Hanya versi yang
 * terdaftar di server/migration-repair.ts yang diterima; diff isi lama vs baru dan baris audit dicetak
 * sebelum checksum diperbarui. Start aplikasi tidak pernah memanggil jalur ini.
 */
import { closePool } from '../db.ts';
import { repairChecksum } from '../migration-repair.ts';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const version = argument('--version');
const accept = argument('--accept');
if (!version || !accept) {
  console.error('Pemakaian: pnpm db:repair-checksum --version <nama-file.sql> --accept <checksum-tersimpan>');
  process.exitCode = 2;
} else {
  try {
    const result = await repairChecksum({ version, acceptChecksum: accept });
    if (!result.changed) {
      console.log(`[db] checksum ${result.version} sudah sesuai; tidak ada perubahan.`);
    } else {
      console.log(`[db] reparasi checksum ${result.version}`);
      console.log(`[db] checksum tersimpan: ${result.previousChecksum}`);
      console.log(`[db] checksum sekarang: ${result.checksum}`);
      console.log(`--- diff isi lama vs baru (${result.version}) ---`);
      console.log(result.diff);
      console.log(`[db] checksum diperbarui; audit ${result.auditId}`);
    }
  } catch (error) {
    console.error('[db]', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
