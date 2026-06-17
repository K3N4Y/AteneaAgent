# Arquitectura del backend (motor del agente)

> "Backend" aquí significa **el motor del agente**: el código que habla con el
> modelo de IA, ejecuta herramientas en el sistema de archivos y orquesta la
> conversación. No es un servidor remoto; corre en la máquina del usuario.

## Decisión central: "todo en TypeScript" dentro de Tauri

Tauri normalmente pone la lógica pesada en **Rust** (los *commands*). Como en
esta etapa queremos **todo en TypeScript**, adoptamos este modelo:

```
┌─────────────────────────────────────────────────────────┐
│  App de escritorio (Tauri)                               │
│                                                          │
│  ┌────────────────┐         ┌─────────────────────────┐ │
│  │  Webview (UI)  │  IPC/WS │  Sidecar Node.js (TS)   │ │
│  │  React + TS    │◀───────▶│  Motor del agente       │ │
│  └────────────────┘         │  - agent loop           │ │
│         ▲                   │  - herramientas (fs/sh) │ │
│         │ lanza             │  - sesiones             │ │
│  ┌──────┴─────────┐         └────────────┬────────────┘ │
│  │  Cáscara Rust  │ administra sidecar    │             │
│  │  (mínima)      │───────────────────────┘             │
│  └────────────────┘                       │             │
└───────────────────────────────────────────┼─────────────┘
                                             ▼
                        API del proveedor LLM (Claude / OpenAI / …) — HTTPS
```

> El sidecar habla con el proveedor a través de una **capa de abstracción**
> (`providers/`), no directamente. Ver §2 más abajo.

- **Rust** solo: crea la ventana, lanza el sidecar y reenvía su salida. Cero
  lógica de negocio.
- **Sidecar Node.js (TypeScript):** contiene el motor del agente. Tiene acceso
  completo a Node (filesystem, `child_process`, red), que es lo que un agente
  de código necesita.
- **Webview (TypeScript/React):** la UI; ver
  [arquitectura-frontend.md](./arquitectura-frontend.md).

### ¿Por qué un sidecar y no todo en el webview?

El webview de Tauri puede acceder a `fs`/`shell` vía plugins, pero un agente
que corre comandos, instala dependencias y construye proyectos enteros necesita
un runtime de Node real (streams, procesos hijos, ecosistema npm). El sidecar
da ese poder manteniendo **un solo lenguaje (TS)**.

> **Decisión revisable.** Si más adelante queremos un único binario sin
> proceso Node aparte, se puede migrar el motor a *commands* de Rust o a las
> APIs JS de Tauri. Por ahora, sidecar = máxima velocidad de desarrollo en TS.

### ¿Por qué Tauri y no Electrobun?

Evaluamos **Electrobun** (Bun + webview de sistema, "Tauri sin Rust", todo TS,
sin sidecar). Era atractivo porque elimina el sidecar y trae RPC tipado de
fábrica, pero **elegimos Tauri** por:

- **Madurez multiplataforma.** Tauri es v2, con comunidad grande y muchas apps
  en producción; probado en distros diversas (incl. **Fedora**, nuestra
  máquina). Electrobun es un **v1 joven (feb-2026), de un solo mantenedor**, con
  Linux enfocado en Ubuntu → riesgo real en Fedora.
- **Reversibilidad barata.** El motor (`engine`/`tools`/`providers`) es TS puro
  y **agnóstico del host**; si algún día reconsideramos Electrobun, el cambio es
  acotado a la capa de host. Esa portabilidad es justamente lo que nos deja
  elegir Tauri sin pintarnos a una esquina.

> El costo aceptado: con Tauri necesitamos el **sidecar Node** para mantener
> "todo en TS" (Electrobun no lo necesitaría). Lo asumimos a cambio de la
> madurez y el soporte multiplataforma.

## Componentes del motor

```
sidecar/
├── server.ts            # arranque + transporte (WS o stdio) hacia la UI
├── engine/
│   ├── loop.ts          # el agent loop (agnóstico de proveedor): orquesta modelo + tools
│   ├── agents.ts        # los 3 perfiles: plan / build / e2e
│   └── events.ts        # tipos de eventos que se emiten a la UI
├── providers/               # ◀── capa de abstracción de LLM
│   ├── types.ts             # interfaz LlmProvider + tipos normalizados
│   ├── registry.ts          # registro/fábrica de proveedores por id
│   ├── anthropic.ts         # adaptador Claude (usa @anthropic-ai/sdk) — a futuro
│   └── openai-compatible.ts # adaptador OpenAI-compatible → OpenCode Zen (activo)
├── tools/
│   ├── types.ts         # interfaz Tool (neutral: esquema Zod + run)
│   ├── read-file.ts
│   ├── write-file.ts
│   ├── edit-file.ts
│   ├── list-dir.ts
│   ├── search.ts
│   └── run-command.ts   # ejecuta comandos de shell (con permisos)
├── session/
│   ├── store.ts         # historial de mensajes por sesión
│   └── types.ts
└── config/
    ├── secrets.ts       # credenciales por proveedor (desde env / config local)
    └── models.ts        # proveedor + modelo por defecto / selección
```

### 1. Transporte (UI ⇄ sidecar)

Dos opciones; elegir una para empezar:

- **WebSocket local** (recomendado): el sidecar abre `ws://127.0.0.1:<puerto>`
  y la UI se conecta. Simple, bidireccional, con streaming natural.
- **stdio**: Tauri lee stdout/stdin del sidecar. Menos código de red, pero más
  incómodo para mensajes estructurados.

El contrato es de **eventos**: la UI manda `{ type: "user_message", ... }` y el
sidecar responde con un *stream* de eventos (`assistant_delta`, `tool_call`,
`tool_result`, `plan`, `done`, `error`).

### 2. Capa de proveedores (abstracción de LLM)

El motor **no** depende de un proveedor concreto. Toda interacción con un modelo
pasa por una interfaz común `LlmProvider`. Agregar un proveedor nuevo (OpenAI,
otro) = **escribir un archivo adaptador + registrarlo con una línea**. El resto
del motor (loop, tools, agentes, UI) no cambia.

**Idea clave:** cada proveedor tiene su propio formato de mensajes, de
*function/tool calling* y de streaming. Cada adaptador **traduce** entre el
formato del proveedor y un conjunto de **tipos normalizados** (request, mensajes
y eventos). El `engine/loop.ts` solo habla en esos tipos normalizados.

```ts
// providers/types.ts — tipos normalizados, agnósticos del proveedor

export interface LlmProvider {
  id: string; // "anthropic" | "opencode" | ...
  stream(req: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent>;
  listModels?(): Promise<ModelInfo[]>; // opcional: para poblar el selector de la UI
}

export interface ModelInfo {
  id: string;       // id del modelo a pasar en LlmRequest.model
  label?: string;   // nombre legible para la UI
}

export interface LlmRequest {
  model: string;
  system?: string;
  messages: LlmMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  thinking?: boolean;
}

export type LlmMessage =
  | { role: "user"; content: ContentPart[] }
  | { role: "assistant"; content: ContentPart[] };

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; output: string; isError?: boolean };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema (derivado del Zod de la tool)
}

export type LlmStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "done"; stopReason: string; usage?: unknown }
  | { type: "error"; message: string };
```

**Registro / fábrica** (`providers/registry.ts`): agregar uno = una línea.

```ts
const registry = new Map<string, LlmProvider>();
export const registerProvider = (p: LlmProvider) => registry.set(p.id, p);
export function getProvider(id: string): LlmProvider {
  const p = registry.get(id);
  if (!p) throw new Error(`Proveedor desconocido: ${id}`);
  return p;
}

// al arrancar el sidecar:
registerProvider(new AnthropicProvider());
// registerProvider(new OpenAIProvider());   // ← agregar otro proveedor
```

**Adaptador de Claude** (`providers/anthropic.ts`) — el **único** archivo que
importa `@anthropic-ai/sdk`:

```ts
import Anthropic from "@anthropic-ai/sdk";

export class AnthropicProvider implements LlmProvider {
  id = "anthropic";
  private client = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno

  async *stream(req: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const stream = this.client.messages.stream({
      model: req.model,                 // p. ej. "claude-opus-4-8"
      max_tokens: req.maxTokens ?? 64000,
      system: req.system,
      thinking: req.thinking ? { type: "adaptive" } : undefined,
      output_config: req.effort ? { effort: req.effort } : undefined,
      tools: req.tools?.map(toAnthropicTool),       // ToolSpec → formato Anthropic
      messages: req.messages.map(toAnthropicMessage),
    });
    for await (const ev of stream) {
      // traducir cada evento del SDK → LlmStreamEvent normalizado
      // (text_delta, thinking_delta, tool_call, done, error)
    }
  }
}
```

> **Notas del adaptador Anthropic (al día de hoy):** modelo `claude-opus-4-8`;
> `thinking: { type: "adaptive" }` (no usar `budget_tokens` → 400 en 4.7/4.8);
> `effort` `"high"`/`"xhigh"` para código/agéntico; **no** mandar
> `temperature`/`top_p`/`top_k` (→ 400); usar **streaming** con `max_tokens`
> alto. Estas particularidades quedan **encapsuladas aquí**, no se filtran al
> resto del motor.

> **Compatibilidad con la guía de Claude:** el adaptador Anthropic usa el SDK
> **oficial** (`@anthropic-ai/sdk`). Cada otro adaptador usa el SDK oficial de
> su proveedor. La abstracción vive por encima de los SDKs, no los reemplaza.

#### Adaptador OpenAI-compatible — proveedor activo: **OpenCode Zen**

OpenCode **Zen** expone una API **compatible con OpenAI**, así que se maneja con
el **SDK de OpenAI** apuntando a su `baseURL`. Aprovechamos eso para escribir
**un solo adaptador genérico** que sirve para cualquier endpoint
OpenAI-compatible: hoy lo instanciamos para `opencode`; mañana, OpenAI "real" u
otro gateway sería el **mismo adaptador con otra `baseURL` y otra key**.

Datos del proveedor (al día de hoy):

| Dato | Valor |
|------|-------|
| `baseURL` | `https://opencode.ai/zen/v1` |
| Auth | Bearer token, env `OPENCODE_ZEN_API_KEY` (key desde `https://opencode.ai/auth`) |
| Chat | `POST /zen/v1/chat/completions` (formato OpenAI) |
| Modelos | `GET /zen/v1/models` → `client.models.list()` |
| IDs de modelo | `gpt-5.5`, `minimax-m2.5-free`, etc. (sin el prefijo `opencode/` que usa la CLI) |

```ts
// providers/openai-compatible.ts — un adaptador para todo endpoint OpenAI-compatible
import OpenAI from "openai";

export interface OpenAICompatibleConfig {
  id: string;        // "opencode"
  baseURL: string;   // "https://opencode.ai/zen/v1"
  apiKeyEnv: string; // "OPENCODE_ZEN_API_KEY"
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly id: string;
  private client: OpenAI;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.client = new OpenAI({ baseURL: cfg.baseURL, apiKey: process.env[cfg.apiKeyEnv] });
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.client.models.list();        // GET /models
    return res.data.map((m) => ({ id: m.id }));
  }

  async *stream(req: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const stream = await this.client.chat.completions.create({
      model: req.model,                                 // p. ej. "gpt-5.5"
      max_completion_tokens: req.maxTokens,
      messages: toOpenAIMessages(req.system, req.messages),
      tools: req.tools?.map(toOpenAITool),              // ToolSpec → { type:"function", function:{...} }
      stream: true,
    });
    for await (const chunk of stream) {
      // delta.content → text_delta
      // delta.tool_calls → acumular (los argumentos llegan en TROZOS) y emitir tool_call
      // finish_reason → done
    }
  }
}
```

Registro (de momento **solo** opencode):

```ts
registerProvider(
  new OpenAICompatibleProvider({
    id: "opencode",
    baseURL: "https://opencode.ai/zen/v1",
    apiKeyEnv: "OPENCODE_ZEN_API_KEY",
  }),
);
```

**Particularidades a manejar en este adaptador:**

- **Tool calling de OpenAI:** el modelo responde `tool_calls` con
  `function.name` y `function.arguments` como **string JSON**. En streaming los
  argumentos llegan en trozos → hay que **acumularlos** antes de
  `JSON.parse`. Normalizar a `LlmStreamEvent.tool_call`.
- **Mapeo de mensajes:** `system` → mensaje role `system`; nuestros `tool_use`
  → mensaje assistant con `tool_calls`; nuestros `tool_result` → mensaje role
  `tool` con `tool_call_id`.
- **Capacidades de Claude no portables:** `thinking`/`effort` son de Anthropic;
  este adaptador los **ignora** (o, si el modelo lo soporta, los mapea a
  `reasoning_effort`). Es exactamente la decisión de "mapeo de capacidades por
  proveedor" del backlog.
- **Caveat del endpoint de modelos:** `GET /v1/models` de Zen ha sido
  inconsistente; si no responde, usar como **fallback** el catálogo de
  `https://models.dev/api.json` (campo `.opencode.models`).

### 3. Agent loop (`engine/loop.ts`) — agnóstico de proveedor

El corazón. Un **único bucle** que sirve para cualquier proveedor: pide un turno
al proveedor (vía `LlmProvider.stream`), ejecuta las herramientas que el modelo
pida y le devuelve los resultados, hasta que termina.

```ts
export async function runAgent(opts: RunOptions, emit: (e: EngineEvent) => void) {
  const provider = getProvider(opts.providerId);
  const toolSpecs = opts.tools.map(toToolSpec);   // Tool (Zod) → ToolSpec (JSON Schema)
  const messages: LlmMessage[] = [...opts.messages];

  while (true) {
    const calls: { id: string; name: string; input: unknown }[] = [];
    const assistantParts: ContentPart[] = [];

    for await (const ev of provider.stream({
      model: opts.model,
      system: opts.system,
      messages,
      tools: toolSpecs,
      effort: "high",
      thinking: true,
    })) {
      if (ev.type === "text_delta") {
        emit({ type: "assistant_delta", text: ev.text });
        assistantParts.push({ type: "text", text: ev.text });
      } else if (ev.type === "tool_call") {
        calls.push(ev);
        assistantParts.push({ type: "tool_use", id: ev.id, name: ev.name, input: ev.input });
      }
    }

    messages.push({ role: "assistant", content: assistantParts });
    if (calls.length === 0) break; // el agente terminó

    const results: ContentPart[] = [];
    for (const call of calls) {
      emit({ type: "tool_call", name: call.name, input: call.input });
      const tool = opts.tools.find((t) => t.name === call.name)!;
      const r = await tool.run(tool.schema.parse(call.input), opts.ctx); // valida con Zod
      emit({ type: "tool_result", name: call.name, output: r.output, isError: r.isError });
      results.push({ type: "tool_result", toolUseId: call.id, output: r.output, isError: r.isError });
    }
    messages.push({ role: "user", content: results });
  }
}
```

> **Tradeoff consciente:** dejamos de usar el *tool runner* automático del SDK de
> Anthropic (que es específico de Anthropic y corre el bucle entero) a cambio de
> **un solo loop** que funciona con cualquier proveedor. Además, ejecutar las
> tools en nuestro loop nos da el punto natural para aplicar la **política de
> permisos** (confirmación humana) de forma uniforme, sin importar el proveedor.

### 4. Perfiles de agente (`engine/agents.ts`)

Los 3 agentes = mismo loop, distinto `system` y distinto **set de
herramientas** (= permisos):

| Agente | Herramientas habilitadas | System prompt (idea) |
|--------|--------------------------|----------------------|
| `plan`  | `read_file`, `list_dir`, `search` | "Eres un planificador. Analiza y propón un plan paso a paso. **No modifiques archivos ni ejecutes comandos.**" |
| `build` | + `write_file`, `edit_file`, `run_command` | "Implementa los cambios pedidos de forma iterativa. Lee antes de editar. Corre los tests." |
| `e2e`   | + scaffolding, `run_command` para arrancar la app | "Construye el programa completo desde cero: estructura, deps, código, UI, pruebas y ejecución." |

Restringir las herramientas por agente es la forma más robusta de garantizar
que `plan` no toque nada: si la tool no está en la lista, el modelo no puede
invocarla.

### 5. Herramientas (`tools/`)

Las tools se definen **una sola vez** de forma neutral al proveedor: nombre,
descripción, esquema Zod y función `run`. Cada adaptador las convierte al
formato de *function calling* de su proveedor (el Zod se transforma a JSON
Schema). Así, una tool nueva funciona con todos los proveedores sin tocarlos.

```ts
// tools/types.ts
export interface Tool<I = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<I>;                 // valida el input del modelo
  run(input: I, ctx: ToolContext): Promise<{ output: string; isError: boolean }>;
}
```

Diseño:

- **`read_file` y `edit_file` siguen el modelo _hashline_** (lectura numerada
  con hash de archivo + edición por número de línea verificada por hash),
  inspirado en oh-my-pi. Es más robusto que el `edit` por reemplazo de strings.
  Diseño detallado en [herramientas-read-edit.md](./herramientas-read-edit.md).
- **Rutas siempre relativas a la raíz del proyecto activo** y validadas para
  evitar salir de ese directorio (sin `../` que escape).
- `run_command` debe pasar por una **política de permisos** (ver abajo): para
  empezar puede pedir confirmación al usuario antes de ejecutar.
- Errores se devuelven como resultado de la tool (`is_error: true`) para que el
  agente pueda reaccionar, no como excepciones que matan el loop.

### 6. Sesiones (`session/`)

- Una sesión = historial de mensajes + proyecto activo + agente seleccionado.
- La API de Claude es *stateless*: en cada llamada se manda el historial
  completo. El `session/store.ts` lo mantiene.
- Para conversaciones largas se podrá activar **compaction** más adelante
  (resumen del contexto del lado del servidor).

### 7. Seguridad y permisos

- Las **credenciales son por proveedor** (`config/secrets.ts`): cada adaptador
  lee su propia API key de variable de entorno o config local. Nunca se
  hardcodean ni se mandan a la UI.
- **Confirmación humana** para acciones difíciles de revertir (`run_command`,
  borrar/sobrescribir archivos). Para empezar: "pregunta antes de actuar".
- El motor opera solo dentro del **directorio del proyecto** elegido por el
  usuario.

## Eventos que el motor emite a la UI

Contrato mínimo (ver [arquitectura-frontend.md](./arquitectura-frontend.md)):

```ts
type EngineEvent =
  | { type: "assistant_delta"; text: string }      // texto en streaming
  | { type: "thinking_delta"; text: string }       // razonamiento (si visible)
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: string; isError: boolean }
  | { type: "plan"; markdown: string }             // del agente Plan
  | { type: "done"; usage?: unknown }
  | { type: "error"; message: string };
```

## Lo que NO está resuelto aún

Ver [pendiente.md](./pendiente.md). En particular: elegir WS vs stdio, empacar
el sidecar Node dentro del bundle de Tauri, y la política fina de permisos.
