# MyAgent

Agente de codificación de escritorio con chat tipo Codex. App nativa con **Tauri
v2** (cáscara Rust mínima), **toda la lógica en TypeScript**: UI con React/Vite y
un **sidecar Node** que corre el motor del agente.

> Contexto, visión y plan por fases en [`docs/`](./docs). Esto es lo justo para
> instalar y correr.

## Arquitectura (resumen)

```
UI (React/Vite, webview Tauri)  ──WebSocket──▶  Sidecar Node (motor del agente)  ──HTTPS──▶  Proveedor LLM
        ▲ lanza                                         ▲ lanza/mata
        └────────────  Cáscara Rust (Tauri)  ───────────┘
```

- `src/` — UI (chat, store Zustand, cliente WebSocket).
- `sidecar/` — motor en TS: capa de proveedores, agent loop, herramientas de
  archivos (hashline), transporte WebSocket. Proyecto Node independiente.
- `src-tauri/` — cáscara Rust: abre la ventana, **lanza el sidecar** al iniciar y
  lo termina al salir.

El proveedor LLM activo es **OpenCode Zen** (API compatible con OpenAI) detrás de
una capa intercambiable (`sidecar/providers/`).

## Requisitos

- Node ≥ 20 y **pnpm**.
- Rust + Cargo (toolchain estable).
- Linux: librerías de Tauri v2 (en Fedora: `webkit2gtk4.1-devel`, `gtk3-devel`,
  `libsoup3-devel`).

## Instalación

```bash
pnpm install            # deps del frontend
pnpm sidecar:install    # deps del sidecar
```

## API key del proveedor

El motor necesita la key de OpenCode Zen (obtenela en
<https://opencode.ai/auth>). **No se hardcodea**: se lee de una variable de
entorno. Exportala en la misma terminal donde lanzás la app:

```bash
export OPENCODE_ZEN_API_KEY="tu-key"
```

Opcionales:

```bash
export MYAGENT_MODEL="minimax-m2.5-free"   # modelo por defecto (def: gpt-5.5)
export MYAGENT_SIDECAR_PORT="8137"          # puerto del WebSocket local
```

Sin la key, la app abre igual y el chat conecta, pero al enviar un mensaje
responde con un error claro pidiendo la variable.

## Correr en desarrollo

```bash
pnpm tauri dev
```

Esto compila la cáscara Rust, levanta Vite y abre la ventana; la cáscara lanza el
sidecar y la UI se conecta por WebSocket.

> **Linux/Wayland:** si la ventana no aparece o crashea con un error de Wayland,
> usá el backend X11 (vía XWayland):
>
> ```bash
> pnpm app:x11
> # equivale a: GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 tauri dev
> ```

## Probar el motor sin la UI

```bash
# Tests deterministas de las herramientas hashline (read/edit/write):
pnpm --dir sidecar exec tsx smoke-tools.ts

# Transporte WebSocket (ready + manejo de "falta API key"):
pnpm --dir sidecar build && node sidecar/dist/server.js   # en una terminal
node sidecar/smoke-ws.mjs                                  # en otra
```

## Estado

**Fase 0** (base de punta a punta) implementada y verificada. Las fases
siguientes (3 agentes, UI rica, E2E, empaque) están en
[`docs/pendiente.md`](./docs/pendiente.md).
</content>
