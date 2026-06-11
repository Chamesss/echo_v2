import { z } from "zod";

/**
 * Zod schemas for the account settings forms.
 *
 * Imported by the corresponding form components (via `zodResolver`) and by
 * their mutation hooks (for input types). Password rules mirror the
 * backend's `minPasswordLength: 8` so the server can't reject what the form
 * considers valid.
 */
export const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
    revokeOtherSessions: z.boolean().default(true),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const changeEmailSchema = z.object({
  newEmail: z.email("Enter a valid email"),
});

export const enableTwoFactorSchema = z.object({
  password: z.string().min(1, "Password is required to enable two-factor"),
});

export const verifyTotpSchema = z.object({
  code: z
    .string()
    .min(6, "Enter the 6-digit code")
    .max(6, "Enter the 6-digit code")
    .regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1, "Password is required to disable two-factor"),
});

/**
 * Account deletion requires two confirmations:
 *   - typing the literal word DELETE so the action can't be muscle-memory'd
 *   - the current password so a stolen session cookie alone can't nuke the
 *     account
 */
export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE", { message: "Type DELETE to confirm" }),
  password: z.string().min(1, "Password is required"),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type EnableTwoFactorInput = z.infer<typeof enableTwoFactorSchema>;
export type VerifyTotpInput = z.infer<typeof verifyTotpSchema>;
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
