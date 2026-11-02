# Free public demo on Hugging Face Spaces

This puts Tributary online **for free** as a public demo, in a [Hugging Face](https://huggingface.co) Docker
Space. Everything runs in one container:

- Postgres with pgvector
- S3-compatible storage (SeaweedFS)
- Keycloak for sign-in
- the API, the query service and the statistics service
- Caddy on the Space's port

Data lives inside the container, so **the demo resets every time the Space restarts**. That is what you want for
a public demo with synthetic data.

| What | Free Space ("CPU basic") |
|---|---|
| Cost | Free |
| Address | `https://<your-hf-name>-<space-name>.hf.space` |
| Data | Synthetic demo data, reset on every restart |
| Sign-in | `scientist` / `scientist`, `viewer` / `viewer` (shown on the page); `admin` only with your secret password |
| Sleeping | Free Spaces sleep when nobody uses them; the next visit wakes them, and starting takes about 2–3 minutes |
| Not included | Pipelines (they need AWS Batch or HealthOmics). The AI assistant is off unless you add an API key. |

The image needs about 1.2 GB of memory when idle, well within the free hardware.

## 1. Make the GitHub repository public
The Space builds from `https://github.com/sprinriver/Tributary` (branch `main`), so the repository must be
public. Before you do that:
- Replace the contact address in `CODE_OF_CONDUCT.md`.
- Turn on **Settings → Security → Private vulnerability reporting** in GitHub.

## 2. Create the Space
1. Sign up or sign in at [huggingface.co](https://huggingface.co). A free account is enough.
2. Click **New → Space**:
   - **Space name:** `tributary` (or any name)
   - **License:** apache-2.0
   - **SDK:** **Docker**, then **Blank**
   - **Hardware:** **CPU basic · free**
   - **Visibility:** Public
   - then **Create Space**.
3. Add the two files from this repository's `deploy/huggingface/` folder to the Space:
   - `Dockerfile`
   - `README.md` (replace the Space's own README; its header tells Hugging Face to use port 7860)

   In the Space, use **Files → Add file → Upload files**, or with git:

   ```sh
   git clone https://huggingface.co/spaces/<your-hf-name>/tributary hf-space
   cp deploy/huggingface/Dockerfile deploy/huggingface/README.md hf-space/
   cd hf-space && git add . && git commit -m "Tributary demo" && git push
   ```

4. **Optional:** to be able to sign in as `admin`, open the Space's **Settings → Variables and secrets** and add a
   **secret** `TRIBUTARY_ADMIN_PASSWORD`. Without it, the admin account gets a random password nobody knows.

The first build takes about 15–25 minutes, and the Space then shows **Running**.

## 3. Open it
- **Use the direct address:** sign-in does not work inside the frame on the Space page (browsers block its
  cookies). Use `https://<your-hf-name>-tributary.hf.space`, or the **"Open Tributary in a new tab"** link on the
  page.
- **Sign in:** as `scientist` / `scientist`, or `viewer` / `viewer`.
- **Check it works:**
  - **Experiments** lists the demo experiments (ONC-…, IMM-…).
  - In **Explore**, choosing *sample* and **Run query** shows rows.
  - As admin, **Admin → Health** shows every dependency as OK.

## Updating
The Space builds from `main` at build time. After you merge changes on GitHub, open the Space's
**Settings → Factory rebuild**.

## Settings (Space variables and secrets)
| Name | Kind | Default | Purpose |
|---|---|---|---|
| `TRIBUTARY_ADMIN_PASSWORD` | secret | random | Password of the `admin` user (system administrator) |
| `DEMO_LOGINS` | variable | `scientist:scientist,viewer:viewer` | Published logins, also set as those users' passwords. Never list `admin`. |
| `INSTANCE_NAME`, `DEMO_NOTICE` | variable | | Banner text |
| `AI_PROVIDER` + `ANTHROPIC_API_KEY` | variable + secret | `none` | Set `anthropic` and a key to switch the assistant on (it uses your API credits) |
| `PUBLIC_URL` | variable | `https://$SPACE_HOST` | Only if the Space's log says to set it, or for a custom domain |

Changing a variable or secret restarts the Space, which also resets the demo data.

## Try the same container locally
```sh
docker build -f deploy/huggingface/Dockerfile --build-context source=. -t tributary-space .
docker run --rm -p 7860:7860 -e PUBLIC_URL=http://localhost:7860 -e TRIBUTARY_ADMIN_PASSWORD=admin-pass tributary-space
# open http://localhost:7860
```

`--build-context source=.` builds from your checkout instead of cloning GitHub.

## Troubleshooting
- **The Space log says "Set PUBLIC_URL":** add a variable `PUBLIC_URL` = `https://<your-hf-name>-<space>.hf.space`.
- **Sign-in shows an error, or the page reloads to the start:** you are inside the embedded frame. Open the direct
  address.
- **Build fails at `git clone`:** the GitHub repository is not public, or the branch name is wrong.
- **The app shows "starting":** the services take 2–3 minutes after a restart. The log lists each step
  (`[start] postgres`, `… keycloak`, `… api`, `web on :7860`).
- **A service stopped:** the container stops and Hugging Face restarts it. The last lines of each service's log
  are printed in the Space's logs.

## If a free Space isn't available
Use the same image on a free Oracle Cloud VM: [`DEPLOY_ORACLE.md`](DEPLOY_ORACLE.md).

## Paid alternative
For a demo whose data persists, with separate services, see [`DEPLOY_RENDER.md`](DEPLOY_RENDER.md) (Render paid
plans).
