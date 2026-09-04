import crypto from "node:crypto";
import type { DocumentStorageProvider, StoredFile } from "./types";

// ============================================================
// S3ObjectStorageProvider (P12, sections 8/9) - client SigV4 fait main
// (aucune dépendance ajoutée), compatible tout endpoint S3 "path-style"
// (Cloudflare R2, AWS S3, Scaleway Object Storage, OVH compatible S3...).
// Configuration 100% par variables d'environnement, AUCUN secret en dur.
// Bucket privé obligatoire côté fournisseur - cette classe ne construit
// jamais d'URL publique non signée.
// ============================================================

export type S3Config = {
  endpoint: string; // ex. https://<account>.r2.cloudflarestorage.com (SANS le bucket)
  region: string; // "auto" accepté par R2 ; une vraie région pour S3/Scaleway/OVH
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function s3ConfigFromEnv(): S3Config | null {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const bucket = process.env.STORAGE_BUCKET;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint: endpoint.replace(/\/$/, ""), region: process.env.STORAGE_REGION || "auto", bucket, accessKeyId, secretAccessKey };
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function amzDate(now: Date): { date: string; dateTime: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { date: iso.slice(0, 8), dateTime: iso };
}

// Encodage RFC 3986 strict requis par SigV4 (encodeURIComponent laisse
// passer !'()* qui doivent être encodés en pourcentage pour AWS).
function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function encodePath(key: string): string {
  return "/" + key.split("/").map(rfc3986Encode).join("/");
}

function signingKey(config: S3Config, date: string): Buffer {
  const kDate = hmac("AWS4" + config.secretAccessKey, date);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

/** Requête signée (en-tête Authorization) pour PUT/GET/DELETE directs - payload réellement hashé (jamais UNSIGNED-PAYLOAD ici). */
function signedHeadersRequest(
  config: S3Config,
  method: "GET" | "PUT" | "DELETE",
  key: string,
  body: Buffer | null,
  extraHeaders: Record<string, string> = {}
): { url: string; headers: Record<string, string> } {
  const now = new Date();
  const { date, dateTime } = amzDate(now);
  const host = new URL(config.endpoint).host;
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));

  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": dateTime, ...extraHeaders };
  const sortedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = sortedHeaderNames.map((h) => `${h}:${headers[Object.keys(headers).find((k) => k.toLowerCase() === h)!].trim()}\n`).join("");
  const signedHeadersList = sortedHeaderNames.join(";");

  const canonicalUri = encodePath(`${config.bucket}/${key}`);
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeadersList, payloadHash].join("\n");

  const credentialScope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateTime, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(config, date), stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;

  return { url: `${config.endpoint}${canonicalUri}`, headers: { ...headers, Authorization: authorization } };
}

/** URL présignée (query-string auth) pour un GET direct courte durée (section 9) - jamais de bucket public. */
export function buildPresignedGetUrl(config: S3Config, key: string, expiresInSeconds: number): string {
  const now = new Date();
  const { date, dateTime } = amzDate(now);
  const host = new URL(config.endpoint).host;
  const credentialScope = `${date}/${config.region}/s3/aws4_request`;

  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", dateTime],
    ["X-Amz-Expires", String(Math.min(Math.max(expiresInSeconds, 1), 604800))],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query
    .map(([k, v]) => [rfc3986Encode(k), rfc3986Encode(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalUri = encodePath(`${config.bucket}/${key}`);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, canonicalHeaders, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", dateTime, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(config, date), stringToSign).toString("hex");

  return `${config.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export class S3ObjectStorageProvider implements DocumentStorageProvider {
  readonly name = "s3";
  constructor(private readonly config: S3Config) {}

  async save(dossierId: string, file: { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<StoredFile> {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
    const key = `${dossierId}/${crypto.randomUUID()}${ext}`;
    const contentType = file.type || "application/octet-stream";
    const { url, headers } = signedHeadersRequest(this.config, "PUT", key, buffer, { "content-type": contentType });

    const response = await fetch(url, { method: "PUT", headers, body: new Uint8Array(buffer) });
    if (!response.ok) throw new Error(`Échec de l'upload vers le stockage objet (HTTP ${response.status}).`);

    return { key, nomFichier: file.name, mimeType: contentType, tailleOctets: buffer.length };
  }

  /** Upload à une clé EXACTE (jamais générée) - réservé au script de migration (P12, section 10), qui doit préserver la clé déjà référencée en base. */
  async putRaw(key: string, buffer: Buffer, contentType: string): Promise<void> {
    const { url, headers } = signedHeadersRequest(this.config, "PUT", key, buffer, { "content-type": contentType });
    const response = await fetch(url, { method: "PUT", headers, body: new Uint8Array(buffer) });
    if (!response.ok) throw new Error(`Échec de l'upload vers le stockage objet (HTTP ${response.status}).`);
  }

  async read(key: string): Promise<Buffer> {
    const { url, headers } = signedHeadersRequest(this.config, "GET", key, null);
    const response = await fetch(url, { method: "GET", headers });
    if (!response.ok) throw new Error(`Fichier introuvable dans le stockage objet (HTTP ${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const { url, headers } = signedHeadersRequest(this.config, "DELETE", key, null);
    await fetch(url, { method: "DELETE", headers }).catch(() => {});
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    return buildPresignedGetUrl(this.config, key, expiresInSeconds);
  }
}
