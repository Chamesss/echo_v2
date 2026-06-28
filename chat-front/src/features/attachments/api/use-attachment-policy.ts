import { useQuery } from "@tanstack/react-query";
import type { ClientPolicy } from "@server/modules/attachments/attachment-policy";
import { apiFetch } from "@/lib/api";

export type { ClientPolicy };
export type PolicyCategory = ClientPolicy["categories"][number];

export const attachmentPolicyKey = ["attachments", "policy"] as const;

/**
 * The file-manager policy (categories, per-category caps, max-per-message),
 * resolved from server env so the client and server agree on limits. Depends
 * only on deploy config, so it's effectively static — cached indefinitely.
 */
export function useAttachmentPolicy() {
  return useQuery({
    queryKey: attachmentPolicyKey,
    queryFn: () => apiFetch<ClientPolicy>("/api/attachments/policy"),
    staleTime: Infinity,
  });
}

/** Resolve a MIME type to its category policy (mirrors the server; `file` fallback). */
export function resolveClientCategory(policy: ClientPolicy, contentType: string): PolicyCategory {
  const mime = contentType.toLowerCase().trim();
  for (const c of policy.categories) {
    if (c.mimeTypes === "*") return c;
    if (c.mimeTypes.includes(mime)) return c;
  }
  return policy.categories[policy.categories.length - 1]!;
}

/** Human-readable byte size ("3.2 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
