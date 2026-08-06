import { useCallback, useState } from "react";
import type { AttachmentWire } from "@server/infrastructure/realtime/protocol";
import { ApiError, apiFetch } from "@/lib/api";
import {
  formatBytes,
  resolveClientCategory,
  useAttachmentPolicy,
} from "./use-attachment-policy";

export type UploadStatus = "uploading" | "done" | "error";

export interface UploadItem {
  /** Local id (not the server attachment id). */
  id: string;
  file: File;
  status: UploadStatus;
  progress: number; // 0..100
  error?: string;
  key?: string; // S3 key, once uploaded
  url?: string; // public URL, once uploaded
  category?: AttachmentWire["category"];
}

interface PresignResponse {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  requiredHeaders: Record<string, string>;
}

/** PUT a file straight to S3 with real upload-progress (fetch can't report it). */
function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed (network error)"));
    xhr.send(file);
  });
}

/**
 * Manages the composer's pending attachments: validate (client-side, UX only —
 * the server re-validates), presign, PUT to S3 with progress, and track each
 * file's state. `doneItems` feed the send (their `{ key, filename }` refs); the
 * server HEAD-verifies them. The list is local component state, cleared on send.
 */
export function useAttachmentUploads(workspaceId: string, channelId: string) {
  const { data: policy } = useAttachmentPolicy();
  const [items, setItems] = useState<UploadItem[]>([]);

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const uploadOne = useCallback(
    async (item: UploadItem) => {
      try {
        const presign = await apiFetch<PresignResponse>(
          `/api/workspaces/${workspaceId}/channels/${channelId}/attachments/presign`,
          {
            method: "POST",
            body: {
              filename: item.file.name,
              contentType: item.file.type || "application/octet-stream",
              contentLength: item.file.size,
            },
          },
        );
        await putWithProgress(
          presign.uploadUrl,
          item.file,
          presign.requiredHeaders,
          (pct) => patch(item.id, { progress: pct }),
        );
        const category = policy
          ? (resolveClientCategory(
              policy,
              item.file.type || "application/octet-stream",
            ).category)
          : "file";
        patch(item.id, {
          status: "done",
          progress: 100,
          key: presign.key,
          url: presign.publicUrl,
          category,
        });
      } catch (err) {
        const message =
          err instanceof ApiError && err.code === "uploads_not_configured"
            ? "File uploads aren't enabled on this server."
            : err instanceof Error
              ? err.message
              : "Upload failed";
        patch(item.id, { status: "error", error: message });
      }
    },
    [workspaceId, channelId, policy, patch],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const room = Math.max(0, (policy?.maxPerMessage ?? 10) - items.length);
      const newItems: UploadItem[] = files.slice(0, room).map((file) => {
        const id = crypto.randomUUID();
        if (policy) {
          const cat = resolveClientCategory(
            policy,
            file.type || "application/octet-stream",
          );
          if (file.size > cat.maxBytes) {
            return {
              id,
              file,
              status: "error",
              progress: 0,
              error: `${cat.category} files must be under ${formatBytes(cat.maxBytes)}`,
            };
          }
        }
        return { id, file, status: "uploading", progress: 0 };
      });
      setItems((cur) => [...cur, ...newItems]);
      for (const it of newItems)
        if (it.status === "uploading") void uploadOne(it);
    },
    [policy, items.length, uploadOne],
  );

  const remove = useCallback((id: string) => {
    setItems((cur) => cur.filter((it) => it.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const doneItems = items.filter((it) => it.status === "done");
  const hasUploading = items.some((it) => it.status === "uploading");

  return {
    items,
    addFiles,
    remove,
    clear,
    doneItems,
    hasUploading,
    maxPerMessage: policy?.maxPerMessage ?? 10,
  };
}
