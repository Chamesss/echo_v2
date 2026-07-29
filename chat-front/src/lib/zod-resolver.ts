import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";

/**
 * React Hook Form resolver for our Zod schemas.
 *
 * Use this everywhere instead of `zodResolver` from
 * `@hookform/resolvers/zod` — that export is silently broken against the Zod
 * version this app runs on.
 *
 * Why: `@hookform/resolvers@4`'s zod entry point detects a validation failure
 * with `Array.isArray(err.errors)`. Zod 3's `ZodError` exposed `.errors`; Zod 4
 * renamed it to `.issues`, so the check never matches, the resolver RE-THROWS
 * the ZodError instead of converting it to field errors, and React Hook Form
 * gets an unhandled promise rejection. The visible symptom is a form that does
 * nothing at all on submit when input is invalid — no field messages, no
 * request — which is how a workspace slug containing spaces used to fail.
 *
 * Zod 4 schemas implement the Standard Schema interface, and this resolver
 * reads `~standard` issues directly, so it stays correct regardless of what the
 * error object is called internally.
 *
 * Drop this module and go back to `zodResolver` once `@hookform/resolvers` is
 * on v5+, where the zod entry point handles Zod 4 natively.
 */
export const zodResolver = standardSchemaResolver;
