const REQUIRED = ["CRON_SECRET", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;

export function backupConfigStatus() {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  return { configured: missing.length === 0, missing: [...missing] };
}

export function retentionDays(): number {
  const n = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : 30;
}
