# Authentication and account recovery

This guide covers first-time instance setup, local accounts, Google OAuth,
custom OpenID Connect, OAuth-only accounts, and recovery.

## First account and owner access

On an empty instance, create the first account from the login page. It becomes
the single instance owner and can open `/admin`. Existing installations promote
their oldest account during the authentication migration.

After the owner exists, local registration is closed by default. The owner can
change it to open registration in `/admin`. Authentication-setting changes are
loaded when the server starts, so restart the API server after saving them.

Keep the owner recovery codes and confirm that the machine-local recovery
command works before disabling the owner's password.

## Local accounts

Local accounts use an email-shaped identifier and password, but Conduit does
not send verification or reset email. It does not collect an account name.
Household profile names remain separate.

New local accounts receive ten one-time recovery codes. Codes can also be
replaced from profile Settings. Generating a new set invalidates every old code.
The current recovery-code flow deliberately restores a local password.

## Google login

Google is integrated directly; Authentik, Keycloak, or another identity server
is not required.

1. Create a dedicated Google Cloud project for Conduit so it has independent
   OAuth branding.
2. In Google Auth Platform, configure Branding and Audience. While testing, add
   the intended Google accounts as test users.
3. Create an OAuth client with application type **Web application**.
4. Leave Authorized JavaScript origins empty.
5. Add the callback shown in Conduit's admin screen as an Authorized redirect
   URI. Local development uses:

   ```text
   http://localhost:3000/api/auth/callback/google
   ```

6. Paste the Client ID and Client Secret into Conduit.
7. Enable automatic account creation if new Google users may join.
8. Save, restart the API server, and test in a private browser window.

Conduit fixes the button label to `Continue with Google` and requests
`openid email`. Google identities with the same verified email may link to an
existing local account. Different-email linking is prohibited.

For production, add the production callback to Google and set:

```env
BETTER_AUTH_URL=https://api.conduit.example
WEB_ORIGIN=https://conduit.example
VITE_API_URL=https://api.conduit.example
```

The exact values depend on the chosen public web and API origins.

## Custom OpenID Connect

Select **Custom OpenID Connect** in `/admin` and provide:

- Discovery URL, normally ending in `/.well-known/openid-configuration`
- Client ID and client secret
- Login-button label
- Scopes, normally `openid email`
- The callback URL displayed by Conduit

Custom providers are not automatically trusted for same-email account linking.
This avoids treating an incorrectly configured or untrusted identity server as
proof of ownership of an existing account.

## Linking OAuth and disabling passwords

Profile Settings shows the account's current login methods. Connect the
configured OAuth provider there, then sign out and verify it in another browser
before disabling the password.

Conduit refuses to disable a password unless at least one OAuth identity is
stored for the user. Disabling local login clears the password hash while
retaining the credential record so it can be restored safely.

Recommended sequence:

1. Generate and save fresh recovery codes.
2. Connect Google or the configured OIDC provider.
3. Sign out in a separate/private browser and prove OAuth login succeeds.
4. Return to the existing session.
5. Disable local password login.

OAuth-only removes the remotely usable password, but it is not unrecoverable.
A recovery code or a machine-local recovery link can explicitly restore a new
local password.

## Machine-local administrator recovery

An operator with database configuration and shell access can run:

```sh
pnpm admin:recover
```

The command prompts:

```text
Account email:
```

It does not list users, emails, or roles. If the account exists, it prints a
cryptographically random, single-use URL based on `WEB_ORIGIN`. The link:

- Expires in ten minutes
- Is stored only as an HMAC hash
- Can be used once
- Can only set a new local password
- Revokes all existing sessions after use
- Does not create a normal browser session

For a built server package:

```sh
node apps/server/dist/cli.js admin recover
```

If packaging Conduit as a container, expose the same CLI as the container
entrypoint and run it with the platform's equivalent of `exec`. Do not place a
recovery password or permanent recovery token in environment variables.

After recovering an owner, sign in with the new password, repair OAuth settings,
reconnect OAuth if necessary, regenerate recovery codes, and optionally disable
the password again.

## Profile exports are separate

Profile exports contain profile configuration, library, progress, and optional
add-on URLs. They do not contain account credentials or OAuth relationships.
Export regularly so media state remains portable even if account recovery is
impossible.
