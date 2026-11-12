# Start here — run Nomade Business on your own computer

**Who this is for:** anyone. A barber, a dentist, a two-person agency. You don't need to know what a terminal is; this page shows you where to click.

**What you get:** a private website, on your computer, with your leads, clients, proposals, payment links, tasks and an AI that remembers your company. Nobody else can see it unless you put it online.

**Time:** about 20 minutes, mostly waiting for downloads.

---

## 1. Install Docker Desktop (once)

Docker is the program that runs Nomade for you. Free.

1. Go to https://www.docker.com/products/docker-desktop/
2. Click **Download** for your system (Mac or Windows) and install it like any app.
3. Open **Docker Desktop**. Wait until the little whale icon at the top (Mac) or bottom-right (Windows) stops moving. Leave it open.

> Windows: the installer may ask to enable **WSL 2**. Say yes and restart if asked.

## 2. Download Nomade

1. Open https://github.com/LucasUltremare/nomade-bussines
2. Click the green **Code** button → **Download ZIP**.
3. Unzip it. You get a folder called `nomade-bussines-main`. Move it somewhere easy, like your Desktop.

## 3. Open a terminal inside that folder

The terminal is the black window where you type one command. Here's how to open it **already inside the folder**:

- **Mac:** open Finder, find the folder, right-click it → **New Terminal at Folder**. (If you don't see it: open the Terminal app, type `cd ` with a space, drag the folder into the window, press Enter.)
- **Windows:** open the folder in Explorer, right-click an empty area → **Open Git Bash here**. Don't have Git Bash? Install it from https://git-scm.com/download/win (keep all defaults) — or use the **Ubuntu** app if Docker set up WSL for you.

## 4. Run the installer

Type this and press Enter:

```bash
bash instalar.sh
```

It asks four things:

1. **Language** — type 1, 2 or 3.
2. **Company name** — what your clients see.
3. **Your e-mail** — this becomes your login.
4. **A password** — at least 8 characters. Write it down.

Then it downloads and builds everything. The first time takes a few minutes. When it says **Ready**, it opens your browser at **http://localhost:5004**.

## 5. Sign in and answer the setup

Sign in with the e-mail and password you just chose. Nomade then walks you through a short setup: language, what you want to organize, your opening hours, your first **signup link** (a page your clients fill in; every submission lands in Leads), your team and the tools you already use. You can skip anything and change it later under **Settings**.

---

## What to do next

- **Get a link your clients can pay:** go to **Payments**, type the client's name, e-mail and the amount, click **Create link**. Send it on WhatsApp. To actually receive money, connect **Mercado Pago** under **Integrations** (you need a Mercado Pago account; paste the *Access token* from their developer page).
- **Share your signup link** on Instagram, WhatsApp or your site. It's under **Settings → Signup links**.
- **Invite your team** under **Members**. Each person gets only the modules you tick.
- **Let the AI work:** paste an Anthropic, OpenAI or Gemini key under **Integrations → AI models**, then talk to it in **Chat**.

## Using it from your phone or another computer

On the same Wi-Fi, open `http://<your computer's IP>:5004` (on Mac: System Settings → Wi-Fi → Details shows the IP; on Windows: `ipconfig`). Then in the `.env` file change `PAINEL_URL` and `BASE_URL` to that address and run `bash instalar.sh` again.

To use it from anywhere (internet), you need a small server (VPS) and a domain — that's the "Subir com Docker" section of the README. Ask someone technical or open an issue; it's a 30-minute job for them.

## Everyday commands (in the same terminal)

| You want to… | Type |
|---|---|
| Stop Nomade | `docker compose down` |
| Start it again | `docker compose up -d` |
| Update to a new version | download the new ZIP over the folder, then `bash instalar.sh` |
| See what's happening | `docker compose logs -f` (Ctrl+C to leave) |
| Change your password | open `.env` in any text editor, change `ADMIN_SENHA=`, save, run `bash instalar.sh` |

## If something goes wrong

- **"Docker is not running"** — open Docker Desktop and wait for the whale, then run the installer again.
- **The page doesn't open** — wait one more minute and refresh. Still nothing? Run `docker compose logs -f` and look for a red line; paste it in an issue.
- **"Port 5004 is already in use"** — another program uses that door. Edit `docker-compose.yml`, change `"5004:5004"` to `"5104:5004"` and open `http://localhost:5104`.
- **Lost the password** — see the table above.

Your data lives in a Docker volume called `mongo-data`. Deleting the folder doesn't delete your data; `docker compose down -v` does.
