# Auth smoke

Goal: verify sign-in route works and user can reach app shell.

Steps:

1. Navigate to `<target_url>/sign-in`
2. Complete valid sign-in flow
3. Confirm redirect to authenticated area (`/dashboard` or equivalent)
4. Confirm user menu/avatar is visible
5. Return failed with exact first broken step if any check fails
