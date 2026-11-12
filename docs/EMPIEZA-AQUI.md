# Empieza aquí: corre Nomade Business en tu computadora

**Para quién es:** cualquier persona. Un barbero, una dentista, una agencia de dos personas, o quien quiere probarlo en la computadora del trabajo. No necesitas saber qué es una terminal; esta página muestra dónde hacer clic.

**Qué obtienes:** un panel privado, en tu computadora, con tus leads, clientes, propuestas, links de pago, tareas y una IA que recuerda tu empresa. Nadie más lo ve.

**Qué no necesitas:** Docker, permisos de administrador, instalar programas.

**Tiempo:** unos 10 minutos, casi todo esperando descargas.

---

## 1. Descarga Nomade

1. Entra en https://github.com/LucasUltremare/nomade-bussines/releases
2. En la versión más nueva, abre **Assets** y haz clic en `nomade-business-<versión>.zip`.
3. Descomprímelo:
   - **Mac:** doble clic en el zip.
   - **Windows:** clic derecho en el zip → **Extraer todo** → **Extraer**. No lo abras desde dentro del zip sin extraer: no funciona.
4. Mueve la carpeta a un lugar fácil, como Documentos.

## 2. Ábrelo

- **Mac:** doble clic en **Nomade.command**. La primera vez macOS avisa que el archivo vino de internet. Cierra el aviso, haz **clic derecho** en Nomade.command → **Abrir** → **Abrir**. Después basta con doble clic.
- **Windows:** doble clic en **Nomade.cmd**. Si aparece la pantalla azul "Windows protegió su PC", haz clic en **Más información** → **Ejecutar de todas formas**.
- **Linux:** en una terminal, dentro de la carpeta: `./local/nomade.sh`

Se abre una ventana negra. Esa ventana mantiene Nomade encendido.

## 3. Responde cuatro preguntas

1. **Idioma**: escribe 1, 2 o 3.
2. **Nombre de la empresa**: lo que ven tus clientes.
3. **Tu correo**: será tu usuario.
4. **Una contraseña**: al menos 8 caracteres. Se ve como `****` mientras escribes. Anótala.

La primera vez descarga Node.js (si la computadora no lo tiene) y la base de datos. Una sola vez, de 35 a 110 MB. Cuando diga **Listo**, abre el panel en el navegador (normalmente **http://localhost:5004**).

## 4. Entra y termina la configuración

Entra con tu correo y contraseña. El panel te guía: idioma, empresa, país y moneda, qué pantallas quieres usar, horario, primer link de registro, equipo, IA y, al final, **lo que funciona en esta computadora**. Puedes saltar cualquier paso y cambiarlo después en **Ajustes**.

Deja la ventana negra abierta mientras lo usas. Si la cierras, Nomade se apaga; los datos quedan guardados.

---

## En la computadora del trabajo

Casi todo funciona igual. Lo que cambia, y Nomade mismo lo avisa (en la ventana negra y en **Ajustes → Esta computadora**):

- **Los links que envías al cliente** (propuesta, pago, registro) solo abren en esta computadora. Para enviarlos a clientes de verdad necesitas una dirección pública. Mira "Enviar links al cliente" abajo.
- **Mercado Pago no puede avisar que pagaron**, porque no llega a tu computadora. El link de pago funciona; revisa el pago en Mercado Pago.
- **Mercado Libre y Shopee** solo se conectan a una dirección pública con HTTPS. "Probar como cliente" en Atención funciona.
- **La red de la empresa puede bloquear** la IA, Mercado Pago o la descarga de la base. Nomade dice qué dirección está bloqueada. Pide a TI que la libere.
- **Proxy de la empresa:** lo lee solo de la configuración de Windows o Mac. Si aun así no sale a internet, pide a TI la dirección del proxy y ponla en el archivo `config.env` (mira "Dónde están los datos"): `HTTPS_PROXY=http://proxy.empresa:8080`
- **Computadora suspendida = Nomade detenido.**
- Por defecto, nadie más en la red de la empresa puede abrir tu panel.

¿Quieres ver todo de una vez? Corre la revisión (mira la tabla de comandos).

## Qué hacer después

- **Crear un link de pago:** ve a **Pagos**, escribe nombre, correo y monto, haz clic en **Crear link**. Para cobrar de verdad, conecta **Mercado Pago** en **Integraciones** (pega el *Access token* de su página de desarrolladores).
- **Compartir el link de registro** en Instagram, WhatsApp o tu sitio. Está en **Ajustes → Links de registro**.
- **Invitar a tu equipo** en **Miembros**. Cada persona solo ve las pantallas que marques.
- **Poner la IA a trabajar:** pega una clave de Anthropic, OpenAI o Gemini en **Integraciones** y habla con ella en el **Chat**.
- **Ver otra vez dónde hacer clic:** presiona `?` en cualquier pantalla.

## Usarlo desde el celular u otra computadora

Corre el comando `configurar` (mira abajo) y responde **s** en "¿Abrir también desde el celular en el mismo Wi-Fi?". Luego abre Nomade otra vez: muestra la dirección con la IP de la computadora. En la computadora del trabajo, deja **no**: cualquiera en la red de la empresa vería la pantalla de entrada.

## Enviar links al cliente

El cliente necesita llegar a tu Nomade por internet. Dos caminos:

1. **Un servidor pequeño (VPS)** con Docker: la sección "Subir num servidor com Docker" del README. Media hora para alguien técnico.
2. **Un túnel hasta esta computadora** (Cloudflare Tunnel, ngrok y similares). Apunta el túnel a `http://localhost:5002` y pon la dirección que te dé en `config.env`: `BASE_URL=https://tu-tunel.ejemplo.com`. En la computadora del trabajo, pregunta antes a TI.

## Comandos del día a día

| Quieres… | Haz |
|---|---|
| Encender | Doble clic en Nomade.command / Nomade.cmd |
| Apagar | Cierra la ventana negra (o Ctrl+C en ella) |
| Actualizar | Descarga el zip nuevo, descomprime y ábrelo. Los datos no están en esa carpeta, así que no se pierde nada. Puedes borrar la carpeta vieja |
| Cambiar correo, contraseña, base o acceso por red | Mac/Linux: `./local/nomade.sh configurar` · Windows: en la barra de direcciones del Explorador, dentro de la carpeta, escribe `cmd` y Enter; en la ventana que se abre corre `Nomade.cmd configurar` |
| Revisar qué funciona aquí | Lo mismo, con `diagnostico` en lugar de `configurar` |
| Ver los logs | Carpeta `logs` dentro de la carpeta de datos |

## Dónde están los datos

Fuera de la carpeta de Nomade, en la carpeta de tu usuario:

- **Windows:** `%LOCALAPPDATA%\NomadeBusiness` (pégalo en la barra del Explorador)
- **Mac:** `~/Library/Application Support/NomadeBusiness` (Finder: Ir → Ir a la carpeta…)
- **Linux:** `~/.local/share/nomade-business`

Ahí están la base (`mongo`), los logs, el Node y la base descargados (`runtime`) y el `config.env` con tu configuración. Para empezar de cero, borra esa carpeta.

## Si algo sale mal

- **"No se pudo descargar"** (Node o base): la red lo bloqueó. La ventana muestra el link: descárgalo en el navegador y pon el archivo en la carpeta que indica (o déjalo en Descargas), luego abre Nomade otra vez. Para la base también puedes usar una gratis de [MongoDB Atlas](https://www.mongodb.com/atlas): te pide el link.
- **Windows: "falta el Visual C++"**: la base lo necesita. Pide a TI que instale "Microsoft Visual C++ Redistributable", o usa MongoDB Atlas.
- **La página no abre:** espera un minuto y recarga. Si sigue sin abrir, mira la ventana negra; dice qué se detuvo y qué archivo de log enviar.
- **"El puerto 5004 lo usa otro programa"**: no pasa nada, usa otro y muestra la dirección correcta.
- **Olvidaste la contraseña:** corre `configurar` y elige otra.

---

## ¿Prefieres Docker?

Si ya usas Docker (o lo vas a correr en un servidor), descarga el código (botón verde **Code** → **Download ZIP**), abre una terminal en la carpeta y corre `bash instalar.sh`. Hace las mismas cuatro preguntas y levanta todo con `docker compose`. Los datos quedan en el volumen `mongo-data`.
