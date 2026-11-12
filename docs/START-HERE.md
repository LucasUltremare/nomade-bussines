# Start here: run Nomade Business on your computer

**Who it's for:** anyone. A barber, a dentist, a two-person agency, or someone trying it on a work computer. You don't need to know what a terminal is; this page shows where to click.

**What you get:** a private panel, on your computer, with your leads, customers, proposals, payment links, tasks and an AI that remembers your company. Nobody else sees it.

**What you don't need:** Docker, admin rights, installing anything.

**Time:** about 10 minutes, mostly waiting for downloads.

---

## 1. Download Nomade

1. Go to https://github.com/LucasUltremare/nomade-bussines/releases
2. Under the newest version, open **Assets** and click `nomade-business-<version>.zip`.
3. Unzip it:
   - **Mac:** double-click the zip.
   - **Windows:** right-click the zip → **Extract All** → **Extract**. Don't open it from inside the zip without extracting: it won't work.
4. Move the folder somewhere easy, like Documents.

## 2. Open it

- **Mac:** double-click **Nomade.command**. The first time, macOS warns that the file came from the internet. Close the warning, **right-click** Nomade.command → **Open** → **Open**. After that, a double-click is enough.
- **Windows:** double-click **Nomade.cmd**. If the blue "Windows protected your PC" screen shows up, click **More info** → **Run anyway**.
- **Linux:** in a terminal, inside the folder: `./local/nomade.sh`

A black window opens. That window keeps Nomade running.

## 3. Answer four questions

1. **Language**: type 1, 2 or 3.
2. **Company name**: what your customers see.
3. **Your e-mail**: this is your login.
4. **A password**: at least 8 characters. It shows as `****` while you type. Write it down.

The first time it downloads Node.js (if the computer doesn't have it) and the database. Only once, 35 to 110 MB. When it says **Ready**, it opens the panel in your browser (usually **http://localhost:5004**).

## 4. Sign in and finish the setup

Sign in with your e-mail and password. The panel walks you through: language, company, country and currency, which screens you want, hours, first sign-up link, team, AI and, last, **what works on this computer**. You can skip any step and change it later in **Settings**.

Keep the black window open while you use it. Close it and Nomade turns off; your data stays saved.

---

## On a work computer

Almost everything works the same. What changes, and Nomade tells you itself (in the black window and in **Settings → This computer**):

- **Links you send to customers** (proposal, payment, sign-up) only open on this computer. To send them to real customers you need a public address. See "Sending links to customers" below.
- **Mercado Pago can't tell Nomade a payment went through**, because it can't reach your computer. The payment link works; check the payment in Mercado Pago.
- **Mercado Livre and Shopee** only connect to a public HTTPS address. "Try as a customer" in Customer service works.
- **The company network may block** the AI, Mercado Pago or the database download. Nomade says which address is blocked. Ask IT to allow it.
- **Company proxy:** it's read from the Windows or Mac settings automatically. If it still can't reach the internet, ask IT for the proxy address and put it in the `config.env` file (see "Where the data is"): `HTTPS_PROXY=http://proxy.company:8080`
- **Computer asleep = Nomade stopped.**
- By default, nobody else on the company network can open your panel.

Want to see it all at once? Run the check (see the commands table).

## What to do next

- **Create a payment link:** go to **Payments**, type name, e-mail and amount, click **Create link**. To actually get paid, connect **Mercado Pago** in **Integrations** (paste the *Access token* from their developer page).
- **Share the sign-up link** on Instagram, WhatsApp or your site. It's in **Settings → Sign-up links**.
- **Invite your team** in **Members**. Each person only sees the screens you tick.
- **Put the AI to work:** paste an Anthropic, OpenAI or Gemini key in **Integrations** and talk to it in **Chat**.
- **See where to click again:** press `?` on any screen.

## Use it from your phone or another computer

Run the `configurar` command (see below) and answer **y** to "Also open it from phones on the same Wi-Fi?". Then open Nomade again: it shows the address with the computer's IP. On a work computer, keep it **no**: anyone on the company network would see the sign-in page.

## Sending links to customers

The customer needs to reach your Nomade over the internet. Two ways:

1. **A small server (VPS)** with Docker: the "Run on a server with Docker" section of the README. Half an hour for someone technical.
2. **A tunnel to this computer** (Cloudflare Tunnel, ngrok and similar). Point the tunnel to `http://localhost:5002` and put the address it gives you in `config.env`: `BASE_URL=https://your-tunnel.example.com`. On a work computer, ask IT first.

## Everyday commands

| You want to… | Do |
|---|---|
| Start | Double-click Nomade.command / Nomade.cmd |
| Stop | Close the black window (or Ctrl+C in it) |
| Update | Download the new zip, unzip and open it. The data isn't in that folder, so nothing is lost. You can delete the old folder |
| Change e-mail, password, database or network access | Mac/Linux: `./local/nomade.sh configurar` · Windows: in Explorer's address bar, inside the folder, type `cmd` and Enter; in the window that opens run `Nomade.cmd configurar` |
| Check what works here | The same, with `diagnostico` instead of `configurar` |
| See the logs | `logs` folder inside the data folder |

## Where the data is

Outside the Nomade folder, in your user folder:

- **Windows:** `%LOCALAPPDATA%\NomadeBusiness` (paste it in Explorer's address bar)
- **Mac:** `~/Library/Application Support/NomadeBusiness` (Finder: Go → Go to Folder…)
- **Linux:** `~/.local/share/nomade-business`

It holds the database (`mongo`), the logs, the downloaded Node and database (`runtime`) and `config.env` with your settings. To start from scratch, delete that folder.

## If something goes wrong

- **"Download failed"** (Node or database): the network blocked it. The window shows the link: download it in the browser and put the file in the folder it says (or leave it in Downloads), then open Nomade again. For the database you can also use a free one from [MongoDB Atlas](https://www.mongodb.com/atlas): it asks for the link.
- **Windows: "missing the Visual C++ runtime"**: the database needs it. Ask IT to install "Microsoft Visual C++ Redistributable", or use MongoDB Atlas.
- **The page doesn't open:** wait a minute and reload. If it still doesn't, look at the black window; it says what stopped and which log file to send.
- **"Port 5004 is taken"**: that's fine, it uses another one and shows the right address.
- **Forgot the password:** run `configurar` and pick a new one.

---

## Prefer Docker?

If you already use Docker (or will run it on a server), download the code (green **Code** button → **Download ZIP**), open a terminal in the folder and run `bash instalar.sh`. It asks the same four questions and starts everything with `docker compose`. Data lives in the `mongo-data` volume.
