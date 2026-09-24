# Supabase setup

The app uses Supabase Auth for username/password verification and a same-origin Next.js backend for every browser operation. The browser does not connect to Supabase directly. Do not restore the former anon-key/browser RLS design.

## Production migrations

The production project is deployed from the `K1tKaLL0s/ftdw1101` GitHub repository. Configure the Supabase GitHub integration with working directory `.`, production branch `codex/vercel-deploy`, and Deploy to production enabled. Leave Automatic branching disabled on the Free plan. Database initialization is complete only after the integration logs and remote migration history confirm success.

When enabled, the integration applies new files from `supabase/migrations/` in timestamp order on commits to the configured production branch. Use this integration as the sole production migration runner. Do not also run these same files through the SQL Editor, `supabase db push`, or Supabase MCP; that can apply duplicate DDL or desynchronize migration history. After deployment, inspect the integration's migration logs and read-only migration history, and confirm all four versions are present and successful:

- `202609240001`
- `202609240002`
- `202609240003`
- `202609240004`

If an integration migration fails, stop and inspect its actual log before changing anything. Do not mark it applied manually or reset the production database.

`config.toml` is the repository's local Supabase CLI configuration. Its `project_id = "ftdw1101"` is a local label, not the hosted project's reference ID or a link to production. The file records PostgreSQL 17, enables migrations, and disables seed data. GitHub production deploys apply migration files; they do not synchronize hosted Auth/API settings or seed files. Configure hosted Auth settings separately in the Dashboard before user registration. `schema.sql` is only a pointer to the migrations.

For local CLI development, link only when you have intentionally selected a target project. `supabase link --project-ref <project-ref>` writes local CLI link state; use local test databases for `supabase db reset`. Do not link this repository to production and use `supabase db push` as a second production deploy path.

Create the first password account through the application, then run the one-time operator bootstrap from a trusted machine using the deployment server's service role secret:

```powershell
$env:SUPABASE_URL = "https://project-ref.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-secret>"
node scripts/bootstrap-admin.mjs first_username
```

This accepts an existing active username once. It does not create accounts or send email. After success, bootstrap cannot run again. Keep the service role secret off shared machines and clear the shell environment when finished.

## Auth configuration

Set hosted Auth minimum password length to 8 and configure upstream rate limits. The app enforces new/reset passwords as at least 8 Unicode code points, one uppercase English letter, one printable ASCII punctuation symbol, and at most 72 UTF-8 bytes. Existing passwords remain valid for login. The hosted Auth policy enum does not offer this exact character combination; do not require lowercase or digits there. The app's rule is enforced by the BFF registration and reset routes. Hosted Auth endpoints may still be called directly, so configure Auth-level rate limits and verify after deployment that a rejected direct sign-up rolls back at the database trigger.

Registration is public. The device ceiling is two account registrations per browser-device random signed cookie, not a person limit; it does not fingerprint hardware. Clearing browser data or switching browsers changes the device token. The Auth trigger remains the authoritative atomic quota enforcement and direct sign-up guard.
