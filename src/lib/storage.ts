import { supabaseAdmin } from "@/lib/supabase/server";

export async function uploadAuditArtifact(params: {
  bucket: string;
  path: string;
  bytes: ArrayBuffer;
  contentType: string;
}) {
  const sb = supabaseAdmin();
  const { error } = await sb.storage
    .from(params.bucket)
    .upload(params.path, params.bytes, {
      contentType: params.contentType,
      upsert: true,
    });
  if (error) throw error;
}

export async function signAuditArtifactUrl(params: {
  bucket: string;
  path: string;
  expiresInSeconds: number;
}) {
  const sb = supabaseAdmin();
  const { data, error } = await sb.storage
    .from(params.bucket)
    .createSignedUrl(params.path, params.expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function downloadAuditArtifact(params: { bucket: string; path: string }) {
  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from(params.bucket).download(params.path);
  if (error) throw error;
  const bytes = await data.arrayBuffer();
  const contentType = data.type || "application/octet-stream";
  return { bytes, contentType };
}

