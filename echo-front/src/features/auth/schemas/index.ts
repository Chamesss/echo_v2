import { z } from 'zod';

/**
 * Zod schemas for every form in the auth module.
 *
 * Imported by both the React Hook Form `useForm({ resolver: zodResolver(...) })`
 * calls in `features/auth/components/*` and by the mutation hooks in
 * `features/auth/api/*` (via the inferred input types).
 *
 * Keeping all four schemas in one file avoids the four-file-tax for what is
 * really one small module of related shapes.
 */
export const signInSchema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const signUpSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(80),
  email: z.email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const forgotPasswordSchema = z.object({
  email: z.email('Enter a valid email'),
});

export const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
