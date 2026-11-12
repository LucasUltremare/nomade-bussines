# Empieza aquí — corre Nomade Business en tu propia computadora

**Para quién es:** cualquiera. Un barbero, un dentista, una agencia de dos personas. No necesitas saber qué es una terminal; esta página te muestra dónde hacer clic.

**Qué obtienes:** un sitio privado, en tu computadora, con tus leads, clientes, propuestas, enlaces de pago, tareas y una IA que recuerda tu empresa. Nadie más lo ve, a menos que lo pongas en internet.

**Tiempo:** unos 20 minutos, casi todo esperando descargas.

---

## 1. Instala Docker Desktop (una sola vez)

Docker es el programa que corre Nomade por ti. Es gratis.

1. Entra a https://www.docker.com/products/docker-desktop/
2. Haz clic en **Download** para tu sistema (Mac o Windows) e instálalo como cualquier app.
3. Abre **Docker Desktop**. Espera a que el ícono de la ballena (arriba en Mac, abajo a la derecha en Windows) deje de moverse. Déjalo abierto.

> Windows: el instalador puede pedir activar **WSL 2**. Acepta y reinicia si lo pide.

## 2. Descarga Nomade

1. Abre https://github.com/LucasUltremare/nomade-bussines
2. Haz clic en el botón verde **Code** → **Download ZIP**.
3. Descomprímelo. Aparece una carpeta `nomade-bussines-main`. Muévela a un lugar fácil, como el Escritorio.

## 3. Abre una terminal dentro de esa carpeta

La terminal es la ventana negra donde escribes un comando. Cómo abrirla **ya dentro de la carpeta**:

- **Mac:** en Finder, encuentra la carpeta, clic derecho → **Nueva terminal en la carpeta**. (¿No aparece? Abre la app Terminal, escribe `cd ` con espacio, arrastra la carpeta a la ventana y pulsa Enter.)
- **Windows:** abre la carpeta en el Explorador, clic derecho en un espacio vacío → **Open Git Bash here**. ¿No tienes Git Bash? Instálalo desde https://git-scm.com/download/win (todo por defecto) — o usa la app **Ubuntu**, si Docker configuró WSL por ti.

## 4. Ejecuta el instalador

Escribe esto y pulsa Enter:

```bash
bash instalar.sh
```

Pregunta cuatro cosas:

1. **Idioma** — escribe 1, 2 o 3.
2. **Nombre de la empresa** — lo que ven tus clientes.
3. **Tu correo** — será tu usuario.
4. **Una contraseña** — mínimo 8 caracteres. Anótala.

Luego descarga y construye todo. La primera vez tarda unos minutos. Cuando diga **Listo**, abre el navegador en **http://localhost:5004**.

## 5. Entra y responde la configuración

Entra con el correo y la contraseña que elegiste. Nomade te guía por una configuración corta: idioma, qué quieres organizar, tu horario de atención, tu primer **enlace de registro** (una página que el cliente llena; cada envío cae en Leads), tu equipo y las herramientas que ya usas. Puedes saltar cualquier paso y cambiarlo después en **Ajustes**.

---

## Qué hacer después

- **Crear un enlace para que el cliente pague:** ve a **Pagos**, escribe nombre, correo y monto, haz clic en **Crear enlace**. Envíalo por WhatsApp. Para recibir dinero de verdad, conecta **Mercado Pago** en **Integraciones** (necesitas una cuenta de Mercado Pago; pega el *Access token* de su página de desarrolladores).
- **Compartir tu enlace de registro** en Instagram, WhatsApp o tu sitio. Está en **Ajustes → Enlaces de registro**.
- **Invitar a tu equipo** en **Miembros**. Cada persona solo ve los módulos que marques.
- **Poner la IA a trabajar:** pega una clave de Anthropic, OpenAI o Gemini en **Integraciones → Modelos de IA** y habla con ella en **Chat**.

## Usarlo desde el celular u otra computadora

En el mismo Wi-Fi, abre `http://<IP de tu computadora>:5004` (en Mac: Ajustes del Sistema → Wi-Fi → Detalles muestra la IP; en Windows: `ipconfig`). Luego, en el archivo `.env`, cambia `PAINEL_URL` y `BASE_URL` a esa dirección y ejecuta `bash instalar.sh` de nuevo.

Para usarlo desde cualquier lugar (internet), necesitas un servidor pequeño (VPS) y un dominio — es la sección "Subir com Docker" del README. Pídeselo a alguien técnico o abre un issue; para esa persona es media hora.

## Comandos del día a día (en la misma terminal)

| Quieres… | Escribe |
|---|---|
| Detener Nomade | `docker compose down` |
| Encenderlo de nuevo | `docker compose up -d` |
| Actualizar a una versión nueva | descarga el ZIP nuevo sobre la carpeta y ejecuta `bash instalar.sh` |
| Ver qué está pasando | `docker compose logs -f` (Ctrl+C para salir) |
| Cambiar la contraseña | abre `.env` en cualquier editor de texto, cambia `ADMIN_SENHA=`, guarda, ejecuta `bash instalar.sh` |

## Si algo sale mal

- **"Docker no está abierto"** — abre Docker Desktop, espera la ballena y ejecuta el instalador otra vez.
- **La página no abre** — espera un minuto más y recarga. ¿Nada? Ejecuta `docker compose logs -f`, busca una línea roja y pégala en un issue.
- **"Puerto 5004 en uso"** — otro programa usa ese puerto. Edita `docker-compose.yml`, cambia `"5004:5004"` por `"5104:5004"` y abre `http://localhost:5104`.
- **Perdiste la contraseña** — mira la tabla de arriba.

Tus datos viven en un volumen de Docker llamado `mongo-data`. Borrar la carpeta no borra tus datos; `docker compose down -v` sí.
