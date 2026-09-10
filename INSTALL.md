# Installing Family Graph

Family Graph runs as a small Cloudflare application:

- **Workers** serve the API and application entry point
- **Static Assets** serve the browser UI
- **D1** stores people, relationships, revisions, metadata, media records, and face data
- **R2** stores original image bytes

There is no separate application server or frontend build service to provision.

---

## Prerequisites

You will need:

- a Cloudflare account with Workers, D1, and R2
- Node.js and npm
- Git
- Wrangler access to the Cloudflare account
- optionally, a Cloudflare-managed domain
- optionally, a GeoNames account for place autocomplete

Wrangler is invoked through `npx`; a global installation is not required.

## Configuration model

The project deliberately separates **deployment credentials** from **Worker runtime configuration**.

| File / setting | Purpose | Example |
| --- | --- | --- |
| `.env` | Credentials used by `setup.sh` / `deploy.sh` to operate Cloudflare | `CLOUDFLARE_API_TOKEN` |
| `.dev.vars` | Runtime values exposed to the Worker during local development | `GEONAMES_USERNAME` |
| Cloudflare Worker secrets / variables | Runtime values exposed to the deployed Worker | `GEONAMES_USERNAME` |

These are separate scopes. In particular, adding `GEONAMES_USERNAME` to `.env` does **not** configure it on the deployed Worker.

### Operator credentials — `.env`

`setup.sh` and `deploy.sh` source `.env` when it exists. This file is for credentials used by Wrangler itself:

```bash
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

For token-based authentication:

```bash
cp .env.example .env
```

Fill in the real values locally. Never commit `.env`.

If you use interactive Wrangler authentication instead, run:

```bash
npx wrangler login
```

and `.env` is optional.

### Local Worker runtime — `.dev.vars`

Values that application code reads through the Worker `env` object belong in Worker runtime configuration.

For local development:

```bash
cp .dev.vars.example .dev.vars
```

The current optional runtime value is:

```bash
GEONAMES_USERNAME=your_geonames_username
```

Keep Cloudflare account IDs and API tokens out of `.dev.vars`.

When `.dev.vars` is present, Wrangler uses it for local Worker runtime variables instead of loading `.env` into the Worker environment. This keeps application configuration separate from deployment credentials.

## 1. Clone and install

```bash
git clone <repository-url>
cd family_tree
npm install
```

Authenticate Wrangler either with:

```bash
npx wrangler login
```

or by configuring `.env` from `.env.example` for API-token authentication.

## 2. Create the R2 media bucket

The default configuration expects:

```text
family-tree-media
```

Create it with:

```bash
npx wrangler r2 bucket create family-tree-media
```

If you choose another name, update the binding in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "MEDIA"
bucket_name = "your-media-bucket"
```

## 3. Create D1 and apply migrations

For a fresh installation:

```bash
./setup.sh
```

The script will:

1. create the `family_tree_db` D1 database
2. pause so you can copy the returned `database_id` into `wrangler.toml`
3. apply repository migrations locally and remotely

Update:

```toml
[[d1_databases]]
binding = "DB"
database_name = "family_tree_db"
database_id = "<your-database-id>"
```

Then continue the setup script.

### Schema ownership

The canonical schema lives in:

```text
migrations/
```

Runtime requests assume migrations have already been applied. Do not perform schema creation, `ALTER TABLE`, index setup, or topology backfills from HTTP handlers.

Future schema changes should be added as numbered D1 migrations.

Manual migration commands:

```bash
npx wrangler d1 migrations apply family_tree_db --local
npx wrangler d1 migrations apply family_tree_db --remote
```

## 4. Configure the deployment route

Replace the route in `wrangler.toml` with your own hostname:

```toml
[[routes]]
pattern = "tree.example.com"
custom_domain = true
```

If you prefer the Cloudflare-provided Workers.dev hostname, remove the custom-domain route and configure the Worker accordingly.

Review the route, D1 database ID, and R2 bucket before the first production deployment.

## 5. Configure GeoNames place autocomplete (optional)

Place fields work as free-form text without GeoNames. GeoNames only enables structured place suggestions.

The Worker looks for exactly:

```text
GEONAMES_USERNAME
```

### Production

From the project directory, configure the deployed Worker runtime value with:

```bash
npx wrangler secret put GEONAMES_USERNAME
```

Wrangler will prompt for the value. Do **not** put the username in `.env` and expect `deploy.sh` to publish it to the Worker; `.env` is used by the shell scripts for Cloudflare operator credentials.

You can verify that the binding exists with:

```bash
npx wrangler secret list
```

`GEONAMES_USERNAME` is not especially sensitive, but using a Worker secret keeps deployment-specific runtime configuration out of the repository.

### Local development

Create the local runtime file:

```bash
cp .dev.vars.example .dev.vars
```

Then edit `.dev.vars`:

```bash
GEONAMES_USERNAME=your_geonames_username
```

Run:

```bash
npx wrangler dev
```

If `GEONAMES_USERNAME` is absent, external place suggestions are simply disabled.

## 6. Run locally

Once local migrations are applied:

```bash
npx wrangler dev
```

The browser application is served through the Worker together with the configured D1, R2, and static-asset bindings.

## 7. Test

```bash
npm test
```

The suite covers graph invariants, selection, browser graph state, API behavior, mutations, faces, rendering, layout, and JavaScript syntax.

## 8. Deploy

```bash
./deploy.sh
```

Deployment intentionally happens in this order:

1. apply pending remote D1 migrations
2. deploy the Worker and static assets with the current Git SHA and UTC build time

A normal update cycle is:

```bash
git pull
npm test
./deploy.sh
```

The deployed build is visible at:

```text
GET /api/version
```

## Existing installations

Do not run `setup.sh` for ordinary updates. It is for first-time database creation.

Use:

```bash
git pull
npm test
./deploy.sh
```

D1 applies only migrations that have not already been recorded as applied.

## Data and backups

Graph import/export produces readable JSON for the genealogy structure.

Photo bytes live in R2; media metadata and face identity records live in D1. A graph JSON export is therefore not a complete backup.

For a full deployment backup, preserve both:

- the D1 database
- the R2 media bucket

## Production access

Family Graph does not implement application-level authentication.

If the deployment contains private information, protect the Worker or custom domain with an access-control layer before adding real data.

## Troubleshooting

### `database_id` errors

Confirm that the D1 database exists in the Cloudflare account Wrangler is using and that `wrangler.toml` contains its actual ID.

### R2 binding errors

Confirm that the configured bucket exists and matches the `MEDIA` binding.

### Schema/table errors

Apply migrations:

```bash
npx wrangler d1 migrations apply family_tree_db --remote
```

Use `--local` for the local database.

### Place autocomplete returns no suggestions

For production, verify that the Worker has the runtime binding:

```bash
npx wrangler secret list
```

For local development, verify `.dev.vars` contains:

```bash
GEONAMES_USERNAME=your_geonames_username
```

Remember: adding it only to `.env` does not configure the Worker runtime.

### The graph renders from cache while the server is unavailable

This is intentional. The browser keeps the last valid graph snapshot so startup can remain usable during transient backend failures. Cache-covered server failures are logged in the developer console.
