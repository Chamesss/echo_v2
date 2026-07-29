import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authClient } from '@/lib/auth-client';

/**
 * Data layer for the /admin dashboard, wrapping Better Auth's `admin` plugin
 * endpoints (`authClient.admin.*`).
 *
 * Every mutation invalidates the user list so the table reflects the change
 * immediately. Errors are normalized to `Error` so components can `toast`
 * `err.message` the same way the rest of the app does.
 */
export const adminUsersKey = (params: AdminUsersParams) =>
  ['admin-users', params] as const;

export interface AdminUsersParams {
  search: string;
  limit: number;
  offset: number;
}

export function useAdminUsers(params: AdminUsersParams) {
  return useQuery({
    queryKey: adminUsersKey(params),
    queryFn: async () => {
      const result = await authClient.admin.listUsers({
        query: {
          limit: params.limit,
          offset: params.offset,
          sortBy: 'createdAt',
          sortDirection: 'desc',
          ...(params.search
            ? {
                searchField: 'email',
                searchOperator: 'contains',
                searchValue: params.search,
              }
            : {}),
        },
      });
      if (result.error) {
        throw new Error(result.error.message ?? 'Could not load users');
      }
      return result.data;
    },
  });
}

/** Invalidate every `admin-users` query regardless of its params. */
function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });
}

export function useSetRole() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: { userId: string; role: 'admin' | 'user' }) => {
      const result = await authClient.admin.setRole({
        userId: input.userId,
        role: input.role,
      });
      if (result.error) throw new Error(result.error.message ?? 'Could not change role');
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useBanUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: { userId: string; banReason?: string }) => {
      const result = await authClient.admin.banUser({
        userId: input.userId,
        banReason: input.banReason,
      });
      if (result.error) throw new Error(result.error.message ?? 'Could not ban user');
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useUnbanUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: { userId: string }) => {
      const result = await authClient.admin.unbanUser({ userId: input.userId });
      if (result.error) throw new Error(result.error.message ?? 'Could not unban user');
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useRemoveUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: { userId: string }) => {
      const result = await authClient.admin.removeUser({ userId: input.userId });
      if (result.error) throw new Error(result.error.message ?? 'Could not delete user');
      return result.data;
    },
    onSuccess: invalidate,
  });
}

/**
 * Impersonate a user — the server swaps the current session for one scoped to
 * the target (recording the admin's id in `sessions.impersonatedBy`). On
 * success we send the browser to "/" so the app re-renders as that user.
 */
export function useImpersonateUser() {
  return useMutation({
    mutationFn: async (input: { userId: string }) => {
      const result = await authClient.admin.impersonateUser({ userId: input.userId });
      if (result.error) throw new Error(result.error.message ?? 'Could not impersonate user');
      return result.data;
    },
  });
}
