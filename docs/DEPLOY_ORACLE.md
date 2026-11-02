# Free public demo on an Oracle Cloud "Always Free" VM

Use this if a free Hugging Face Space isn't available to you. It runs the same all-in-one demo image as the Space
([`DEPLOY_HUGGINGFACE.md`](DEPLOY_HUGGINGFACE.md)) on a free Oracle Cloud virtual machine. Caddy in front of it
gives you HTTPS automatically.

| What | Oracle Always Free (Ampere A1) |
|---|---|
| Cost | Free. Oracle asks for a card when you sign up, to verify identity; Always Free resources are not charged |
| Machine | Arm VM with up to 4 CPUs and 24 GB of memory in total on the free tier; this guide uses 2 CPUs and 12 GB |
| Address | `https://<your-ip-with-dashes>.sslip.io` (a free DNS name), or your own domain |
| Data | Synthetic demo data, reset whenever the container restarts (the same as the Space) |
| Sign-in | `scientist` / `scientist`, `viewer` / `viewer`; `admin` with the password the setup script writes |
| Sleeping | Never: the VM runs all the time |

Free Arm capacity is sometimes short in popular regions. If creating the VM fails with "Out of capacity", try
another availability domain, or try again later.

## 1. Make the GitHub repository public
The VM builds from `https://github.com/sprinriver/Tributary` (branch `main`), so the repository must be public.

## 2. Create an Oracle Cloud account
1. **Sign up:** go to https://www.oracle.com/cloud/free/ and choose **Start for free**.
2. **Home region:** pick one close to your users. It cannot be changed later, and Always Free resources live
   there.
3. **Verify:** confirm your email and add a card for identity verification. Stay on the free tier: don't upgrade
   to "Pay As You Go" unless you want paid resources.

## 3. Create the VM
1. **Start:** in the Oracle Cloud console, go to **☰ → Compute → Instances → Create instance**.
2. **Name:** `tributary`.
3. **Image and shape:**
   - Click **Edit**, then **Change image**, and choose **Canonical Ubuntu 24.04**. Pick the plain build, not
     "Minimal".
   - Then **Change shape**: **Ampere → VM.Standard.A1.Flex**, with **2 OCPUs** and **12 GB** memory. It is
     labelled "Always Free-eligible".
4. **Networking:** keep **Create new virtual cloud network**, with **Assign a public IPv4 address** set to
   **Yes**.
5. **SSH keys:** choose **Generate a key pair for me** and **download both keys**. You need the private key to log
   in.
6. **Boot volume:** the default (about 47 GB) is enough. Up to 200 GB in total is free.
7. **Setup script:** open **Show advanced options → Management → Initialization script**, choose **Paste
   cloud-init script**, and paste the whole of
   [`deploy/oracle/cloud-init.sh`](../deploy/oracle/cloud-init.sh).
   - **Optional:** before pasting, set `ADMIN_PASSWORD` at the top. Otherwise a random one is written to the VM.
8. **Create:** click **Create**. The instance shows **Running** after a minute or two. Note its **Public IP
   address**.

## 4. Open ports 80 and 443 in Oracle's network
The setup script opens the VM's own firewall. Oracle's virtual network blocks the ports as well:

1. **Find the security list:** on the instance page, click the **subnet** link, then **Security Lists → Default
   Security List for …**.
2. **Add ingress rules** twice, once for each port:

   | Field | Value |
   |---|---|
   | Source CIDR | `0.0.0.0/0` |
   | IP Protocol | TCP |
   | Destination Port Range | `80` for the first rule, `443` for the second |

## 5. Wait for the setup to finish
- **Build:** the script installs Docker and builds the image from GitHub, which takes about **20–30 minutes** on
  the free VM. Startup then takes 2–3 minutes more.
- **Follow it (optional):** log in over SSH and watch the log:

  ```sh
  chmod 600 ssh-key-*.key
  ssh -i ssh-key-*.key ubuntu@<public-ip>
  sudo tail -f /var/log/tributary-setup.log      # until "[setup] done: open https://…"
  docker logs -f tributary                       # until "web on :7860"
  ```

## 6. Open it
1. **The address:** `https://<public-ip-with-dashes>.sslip.io`. For example, IP `140.238.1.2` becomes
   `https://140-238-1-2.sslip.io`. The setup log prints the exact address.
2. **Sign in:** as `scientist` / `scientist`.
3. **Check it works:**
   - **Experiments** lists the demo experiments.
   - In **Explore**, choosing *sample* and **Run query** shows rows.
4. **As admin (optional):** the password is in `/etc/tributary.env` (`sudo cat /etc/tributary.env`).
   **Admin → Health** shows every dependency as OK. Pipeline runners show "not configured", which is expected.

## Updating to a newer `main` (or a release tag)
```sh
ssh -i ssh-key-*.key ubuntu@<public-ip>
curl -fsSL https://raw.githubusercontent.com/sprinriver/Tributary/main/deploy/huggingface/Dockerfile -o /tmp/Dockerfile
sudo docker build --pull -t tributary -f /tmp/Dockerfile /tmp
sudo docker rm -f tributary
sudo docker run -d --name tributary --restart unless-stopped --network tributary --env-file /etc/tributary.env tributary
```

For a release, add `--build-arg TRIBUTARY_REF=v2.0.0` to the build and download the Dockerfile from that tag.

## Your own domain
1. **DNS:** create an `A` record for the name (for example `tributary.example.com`) pointing at the VM's public
   IP.
2. **On the VM:** set `DOMAIN` and `PUBLIC_URL` in `/etc/tributary.env`, and put the name in
   `/etc/caddy/Caddyfile`.
3. **Restart:** `sudo docker restart caddy tributary`.

## Troubleshooting
| What you see | Fix |
|---|---|
| The page doesn't load at all | Check both ingress rules (step 4), and that `sudo docker ps` shows `tributary` and `caddy` |
| Browser warns about the certificate | Caddy needs port 80 reachable to get it; check the port 80 rule, then `sudo docker logs caddy` |
| "starting" or a 502 | The services take 2–3 minutes after a (re)start; see `sudo docker logs tributary` |
| Build failed in the setup log | Usually a network hiccup: run the update commands above |
| "Out of capacity" when creating the VM | Try another availability domain or region, or retry later |

## Notes
- **What keeps running:** the VM, Docker and both containers restart by themselves after a reboot. Demo data
  resets each time, as on the Space.
- **Arm build not yet tested:** the image has been tested on x86 only. Every base image is published for Arm
  (arm64), but this is the first Arm build. If it fails, `sudo tail -100 /var/log/tributary-setup.log` shows why.
- **Not for real data:** this setup is a public demo. For real use, see [`DEPLOY.md`](DEPLOY.md) (AWS).
