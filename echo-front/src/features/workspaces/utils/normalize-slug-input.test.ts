import { describe, expect, it } from "vitest";
import { createWorkspaceSchema } from "../schemas";
import { normalizeSlugInput, SLUG_MAX_LENGTH } from "./normalize-slug-input";

/**
 * The contract these tests protect: whatever the user types, the field's value
 * is either empty, mid-typing, or something `createWorkspaceSchema` accepts —
 * it is never a value that fails validation for a reason normalization could
 * have fixed (spaces, capitals, accents, punctuation).
 */
describe("normalizeSlugInput", () => {
  it("turns spaces into hyphens", () => {
    expect(normalizeSlugInput("Acme Corp")).toBe("acme-corp");
    expect(normalizeSlugInput("my   big   team")).toBe("my-big-team");
  });

  it("lowercases and strips accents", () => {
    expect(normalizeSlugInput("Café Déjà")).toBe("cafe-deja");
  });

  it("never opens with a hyphen", () => {
    expect(normalizeSlugInput("   acme")).toBe("acme");
    expect(normalizeSlugInput("---acme")).toBe("acme");
    expect(normalizeSlugInput("!!!acme")).toBe("acme");
  });

  it("keeps a trailing hyphen so hyphens and spaces stay typeable", () => {
    expect(normalizeSlugInput("acme-")).toBe("acme-");
    expect(normalizeSlugInput("acme ")).toBe("acme-");
  });

  it("collapses runs of punctuation into a single hyphen", () => {
    expect(normalizeSlugInput("acme // corp _ 2")).toBe("acme-corp-2");
  });

  it("caps at the schema's max length", () => {
    expect(normalizeSlugInput("a".repeat(80))).toHaveLength(SLUG_MAX_LENGTH);
  });

  it("is idempotent", () => {
    const once = normalizeSlugInput("Acme Corp!! 2024");
    expect(normalizeSlugInput(once)).toBe(once);
  });

  it("produces values the create schema accepts", () => {
    for (const typed of ["Acme Corp", "Café Déjà", "  My Big Team  ", "acme // corp _ 2"]) {
      const result = createWorkspaceSchema.safeParse({ slug: normalizeSlugInput(typed) });
      expect(result.success, `rejected "${typed}"`).toBe(true);
    }
  });
});
