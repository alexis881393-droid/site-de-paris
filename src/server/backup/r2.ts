import { AwsClient } from "aws4fetch";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Db } from "../db/client";
import { logOperation } from "../log";
import { backupConfigStatus, retentionDays } from "./config";
import { buildBackup, verifyBackup } from "./export";

const PREFIX = "backups/";
const MIN_KEEP = 7; // toujours conserver au moins les 7 sauvegardes les plus récentes

function client() {
  const aws = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });
  const base = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}`;
  return { aws, base };
}

async function check(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** Sauvegarde complète vers R2 (gzip), vérification par relecture, puis rétention. */
export async function runR2Backup(db: Db) {
  const cfg = backupConfigStatus();
  if (!cfg.configured) throw new Error(`Sauvegardes automatiques non configurées (manquant : ${cfg.missing.join(", ")}).`);
  const { aws, base } = client();
  try {
    const backup = await buildBackup(db);
    const body = gzipSync(Buffer.from(JSON.stringify(backup), "utf8"));
    const sha = createHash("sha256").update(body).digest("hex");
    const key = `${PREFIX}racebet-${backup.exportedAt.replace(/[:.]/g, "-")}.json.gz`;

    await check(
      await aws.fetch(`${base}/${key}`, {
        method: "PUT",
        body,
        headers: { "content-type": "application/gzip", "x-amz-meta-sha256": sha },
      }),
      "Envoi R2",
    );

    // Contrôle d'intégrité : relecture, comparaison de l'empreinte, vérification du contenu.
    const got = Buffer.from(await (await check(await aws.fetch(`${base}/${key}`), "Relecture R2")).arrayBuffer());
    if (createHash("sha256").update(got).digest("hex") !== sha) throw new Error("Empreinte différente après relecture.");
    const verified = verifyBackup(JSON.parse(gunzipSync(got).toString("utf8")));
    if (!verified.ok) throw new Error(`Sauvegarde relue invalide : ${verified.error}`);

    const deleted = await applyRetention(aws, base);
    await logOperation(db, "backup_created", null, { key, bytes: body.length, sha256: sha, counts: backup.counts, deleted });
    return { key, bytes: body.length, sha256: sha, counts: backup.counts, deleted };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logOperation(db, "backup_failed", null, { message }).catch(() => {});
    throw e;
  }
}

async function applyRetention(aws: AwsClient, base: string): Promise<string[]> {
  const res = await check(await aws.fetch(`${base}?list-type=2&prefix=${encodeURIComponent(PREFIX)}`), "Liste R2");
  const xml = await res.text();
  const items = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)]
    .map((m) => {
      const block = m[1] ?? "";
      const key = /<Key>([^<]+)<\/Key>/.exec(block)?.[1];
      const at = /<LastModified>([^<]+)<\/LastModified>/.exec(block)?.[1];
      return key && at ? { key, at: new Date(at).getTime() } : null;
    })
    .filter((x): x is { key: string; at: number } => x !== null)
    .sort((a, b) => b.at - a.at);
  const limit = Date.now() - retentionDays() * 86_400_000;
  const toDelete = items.slice(MIN_KEEP).filter((i) => i.at < limit);
  for (const item of toDelete) {
    await check(await aws.fetch(`${base}/${item.key}`, { method: "DELETE" }), "Suppression R2");
  }
  return toDelete.map((i) => i.key);
}
