# Installing Family Graph

Family Graph is designed to run as a small Cloudflare application:

- **Workers** serve the API and application entry point.
- **Static Assets** serve the browser UI.
- **D1** stores people, relationships, revisions, metadata, media records, and face data.
- **R2** stores original image bytes.

There is no separate application server, build pipeline, or frontend framework to provision.

---

## Prerequisites

You will need:

- a Cloudflare account with Workers, D1, and R2 available
- Node.js and npm
- Git
- Wrangler access to the Cloudflare account
- optionally, a domain managed through Cloudflare
- optionally, a GeoNames account for place autocomplete

Wrangler is invoked through `npx`, so a global Wrangler installation is not required.

## 1. Clone and install

```bash
git clone <repository-url>
cd family_tree
npm install
```

Authenticate Wrangler if this machine is not already connected to your Cloudflare account:

```bash
npx wrangler login
```

For non-interactive environments you can instead provide the appropriate Cloudflare API credentials through environment variables or your deployment environment.

## 2. Create the R2 media bucket

The default Worker configuration expects an R2 bucket named:

```text
family-tree-media
```

Create it with:

```bash
npx wrangler r2 bucket create family-tree-media
```

If you choose another bucket name, update the R2 binding in `wrangler.toml` before deploying.

```toml
[[r2_buckets]]
binding = "MEDIA"
bucket_name = "your-media-bucket"
```

## 3. Create D1 and apply the initial schema

For a fresh installation, run:

```bash
./setup.sh
```

The script will:

1. create the `family_tree_db` D1 database
2. pause so you can copy the returned `database_id` into `wrangler.toml`
3. apply the repository migrations to both the local and remote D1 databases

Update the D1 block in `wrangler.toml` with the ID returned by Cloudflare:

```toml
[[d1_databases]]
binding = "DB"
database_name = "family_tree_db"
database_id = "<your-database-id>"
```

Then continue the setup script.

### Schema ownership

The canonical database schema lives in:

```text
migrations/
```

Do not add schema creation, `ALTER TABLE`, index setup, or backfill work to HTTP request handlers. Runtime requests assume migrations have already been applied.

For future schema changes, add a new numbered D1 migration rather than modifying production schema from application code.

You can apply migrations manually at any time with:

```bash
npx wrangler d1 migrations apply family_tree_db --local
npx wrangler d1 migrations apply family_tree_db --remote
```

## 4. Configure the deployment route

`wrangler.toml` contains a route block for the deployment environment. Replace it with your own hostname before deploying:

```toml
[[routes]]
pattern = "tree.example.com"
custom_domain = true
```

If you do not want a custom domain, remove the custom route block and configure the Worker for the Cloudflare-provided Workers.dev hostname instead.

The route, D1 database ID, and R2 bucket are deployment-specific values and should be reviewed before the first production deploy.

## 5. Optional place autocomplete

Place fields work as free-form text without any external service.

To enable structured place suggestions, configure a GeoNames username as a Worker secret:

```bash
npx wrangler secret put GEONAMES_USERNAME
```

For a local development session, you can pass it directly:

```bash
npx wrangler dev --var "GEONAMES_USERNAME:your_username"
```

If `GEONAMES_USERNAME` is absent, the application simply leaves external place autocomplete disabled.

## 6. Run locally

Once local migrations have been applied:

```bash
npx wrangler dev
```

Wrangler provides local Worker execution together with the configured D1, R2, and static-asset bindings.

The browser application is served by the Worker; there is no separate frontend development server.

## 7. Run the test suite

Before deploying:

```bash
npm test
```

The suite covers graph invariants, selection, browser graph state, API behavior, mutations, face geometry, visual roles, render ownership, layout behavior, and JavaScript syntax checks.

## 8. Deploy

Deploy with:

```bash
./deploy.sh
```

The deployment script intentionally does two things in order:

1. applies any pending remote D1 migrations
2. deploys the Worker and static assets with the current Git SHA and UTC build time

The deployed build can be checked through:

```text
GET /api/version
```

A typical development/deployment cycle is therefore:

```bash
git pull
npm test
./deploy.sh
```

## Environment and credentials

Both `setup.sh` and `deploy.sh` load `.env` when it exists. The repository ignores `.env` and `.env.*`, so local Cloudflare credentials can be kept outside version control.

Do not commit API tokens, account credentials, or private deployment secrets.

The optional `GEONAMES_USERNAME` should be configured as a Worker binding/secret for production rather than relying on a shell-only value.

## Existing installations

For an existing deployment, do **not** run `setup.sh` just to deploy a new version. `setup.sh` is intended for first-time database creation.

Use:

```bash
git pull
npm test
./deploy.sh
```

`deploy.sh` will apply only migrations that D1 has not already recorded as applied.

## Moving or cloning data

The application exposes graph import/export in the UI. The exported graph document is human-readable JSON and is the simplest way to move the genealogy structure between installations.

Photo bytes are stored separately in R2, while media metadata and face identity records live in D1. A graph JSON export is therefore not a complete media backup.

For a full deployment backup or migration, preserve both:

- the D1 database
- the R2 media bucket

## Production access

Family Graph does not implement application-level authentication.

If the deployment contains private information, protect the Worker/custom domain with an access-control layer before adding real data. The application should not be assumed private merely because its URL is unlisted.

## Troubleshooting

### `database_id` errors

Confirm that the D1 database exists in the same Cloudflare account Wrangler is using and that `wrangler.toml` contains its actual ID.

### R2 binding errors

Confirm that the configured bucket exists and that its name matches the `MEDIA` binding in `wrangler.toml`.

### Schema/table errors

Apply migrations:

```bash
npx wrangler d1 migrations apply family_tree_db --remote
```

For local development, use `--local` instead.

### Place autocomplete returns no suggestions

Free-form place editing still works. If external suggestions are expected, verify that `GEONAMES_USERNAME` is configured for the Worker.

### The graph loads from cache while the server is unavailable

The browser intentionally keeps the last valid graph snapshot so startup can remain usable during transient backend failures. When a server failure is covered by cached graph or media data, the browser logs a warning in the developer console.

## Updating the schema

Keep schema evolution explicit and deployment-time only:

```text
migrations/0001_initial_schema.sql
migrations/0002_example_change.sql
migrations/0003_another_change.sql
```

Then deploy normally:

```bash
./deploy.sh
```

This keeps database setup out of latency-sensitive request paths and makes schema history reviewable alongside the application code.
