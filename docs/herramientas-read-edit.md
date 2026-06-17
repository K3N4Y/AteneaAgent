# Herramientas `read` y `edit` (estilo hashline de oh-my-pi)

> Diseño de nuestras dos herramientas centrales de archivos, modeladas sobre el
> enfoque **hashline** de [oh-my-pi (`can1357/oh-my-pi`)](https://github.com/can1357/oh-my-pi).
> Objetivo: que las ediciones del modelo "aterricen" de forma confiable, sin los
> errores típicos del `edit` por reemplazo de strings.

## El problema que resuelve

El `edit` clásico recibe `old_string` + `new_string` y hace reemplazo textual.
Falla seguido por dos razones:

1. **Ambigüedad:** el `old_string` aparece varias veces → no se sabe cuál editar.
2. **Staleness:** el archivo cambió desde que el modelo lo leyó → se edita contra
   una versión vieja y se corrompe.

Cada fallo fuerza reintentos y "ensucia" al modelo. oh-my-pi resuelve esto
anclando las ediciones a **números de línea + un hash del contenido del
archivo** (de ahí "hashline"). Reportan que la tasa de aciertos del edit **más
que se duplicó** con el mismo modelo y prompt.

## Cómo lo hace oh-my-pi (resumen del modelo)

### `read` emite líneas numeradas con un hash de archivo

La salida no es texto plano; es:

```text
[src/foo.ts#0A1B]
41:def alpha():
42:    return 1
43:
```

- `[PATH#TAG]` — `TAG` son **4 hex** derivados del hash del **archivo entero
  normalizado** (`computeFileHash()`).
- Cada línea: `NÚMERO:TEXTO`.
- Al leer, oh-my-pi **graba un snapshot** del archivo (sus líneas exactas) en un
  *snapshot store* de sesión, indexado por ese hash, para verificar/recuperar la
  edición después.

(En oh-my-pi `read` hace mucho más — directorios, archivos comprimidos, SQLite,
URLs `pr://`/`issue://`, imágenes, notebooks, resúmenes estructurales — todo
detrás de un único parámetro `path`. Eso es alcance extra que **no** copiamos al
inicio; ver "Recortes" abajo.)

### `edit` opera por número de línea y verifica el hash

`edit` recibe **un solo string `input`** con una o más secciones. Cada sección
empieza con el **mismo `[PATH#TAG]`** que emitió `read`, y dentro van las
operaciones:

| Operación | Qué hace | ¿Cuerpo? |
|-----------|----------|----------|
| `SWAP N.=M:` | reemplaza las líneas `N..M` por las filas `+TEXT` de abajo | sí |
| `DEL N.=M` | borra las líneas `N..M` | no |
| `INS.PRE N:` | inserta antes de la línea `N` | sí |
| `INS.POST N:` | inserta después de la línea `N` | sí |
| `INS.HEAD:` | inserta al inicio del archivo | sí |
| `INS.TAIL:` | inserta al final del archivo | sí |
| `SWAP.BLK N:` / `DEL.BLK N` / `INS.BLK.POST N:` | igual pero sobre un **bloque sintáctico** resuelto con tree-sitter desde la línea N | según |

- Las filas de cuerpo son `+TEXTO`; `+` solo = línea en blanco. `DEL` no lleva
  cuerpo. No existen filas `-` (el rango ya nombra qué se cambia).
- El separador de rango es `.=` (`SWAP 41.=42:`).

**La verificación es lo importante:** al aplicar, el "patcher" comprueba que el
hash actual del archivo coincida con el `TAG` de la cabecera. Si el archivo
cambió desde la lectura, intenta una recuperación basada en el snapshot; si no
puede probar un resultado válido, tira `MismatchError` (mostrando el hash actual
y contexto alrededor del ancla) y obliga a re-leer. Tras un edit exitoso
devuelve una **cabecera nueva `[path#TAG]`** con el hash del contenido ya
escrito, para encadenar ediciones sin re-leer.

Ejemplo (formato exacto):

```text
[a.ts#0A3B]      ← cabecera que devolvió read
1:const X = "a";
2:const Y = X;
```
```text
[a.ts#0A3B]      ← el edit copia la misma cabecera
SWAP 1.=1:
+const X = "b";
+export const Y = X;
```

---

## Diseño para MyAgent (versión mínima viable)

Portamos el **núcleo** del modelo: lectura numerada con hash + edición por línea
con verificación. Dejamos fuera (por ahora) tree-sitter, archivos comprimidos,
SQLite, URLs, recuperación avanzada y LSP.

### Módulos en el sidecar

```
sidecar/
├── tools/
│   ├── read.ts                 # herramienta read_file
│   └── edit.ts                 # herramienta edit_file
└── edit/hashline/
    ├── hash.ts                 # normalización + computeFileHash → 4 hex
    ├── snapshot-store.ts       # snapshots por sesión (path → versiones)
    ├── format.ts               # cabecera [PATH#TAG] + líneas LINE:TEXT
    ├── parser.ts               # parsea input: secciones + operaciones
    └── apply.ts                # verifica hash y aplica ops por línea
```

### Hash y normalización (`edit/hashline/hash.ts`)

El hash debe ser **estable**: se calcula sobre el archivo *normalizado*
(CRLF→LF, etc.) para que no cambie por detalles invisibles.

```ts
export function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n"); // CRLF/CR → LF
}

// Tag corto: detector de "cambió el archivo", NO es seguridad.
export function computeFileHash(text: string): string {
  const h = sha256(normalize(text));       // p. ej. node:crypto
  return h.slice(0, 4).toUpperCase();       // 4 hex como oh-my-pi
}
```

> El hash de 4 hex es solo una **etiqueta rápida**. La verificación real se apoya
> en el snapshot (las líneas exactas que se leyeron), así una colisión de 1/65536
> no basta para aplicar sobre contenido drifteado.

### Snapshot store (`edit/hashline/snapshot-store.ts`)

Por sesión, en memoria. Guarda lo que `read` leyó para poder verificar/recuperar
en `edit`.

```ts
interface Snapshot { hash: string; lines: string[]; }

class SnapshotStore {
  private byPath = new Map<string, Snapshot[]>(); // últimas N versiones por path
  record(path: string, lines: string[], hash: string): void { /* push, cap */ }
  find(path: string, hash: string): Snapshot | undefined { /* match por hash */ }
}
```

oh-my-pi guarda hasta 4 versiones por path y 30 paths; arrancamos con algo así.

### Herramienta `read_file` (`tools/read.ts`)

```ts
export const readFile: Tool<{ path: string; range?: string }> = {
  name: "read_file",
  description:
    "Lee un archivo de texto del proyecto y lo devuelve numerado con un hash " +
    "de archivo. Copia la cabecera [PATH#TAG] y los números de línea para editar.",
  schema: z.object({
    path: z.string(),
    range: z.string().optional(), // "41-80", "10+5", "5-16,200-210"
  }),
  async run({ path, range }, ctx) {
    const text = await readWithinProject(path, ctx);       // valida ruta segura
    const lines = normalize(text).split("\n");
    const hash = computeFileHash(text);
    ctx.snapshots.record(path, lines, hash);               // ← clave
    const body = selectRange(lines, range)                 // numeración 1-indexada
      .map((line, i) => `${startLine + i}:${line}`)
      .join("\n");
    return { output: `[${path}#${hash}]\n${body}`, isError: false };
  },
};
```

Salida (lo que ve el modelo):

```text
[src/foo.ts#0A1B]
41:def alpha():
42:    return 1
```

### Herramienta `edit_file` (`tools/edit.ts`)

```ts
export const editFile: Tool<{ input: string }> = {
  name: "edit_file",
  description:
    "Aplica ediciones en formato hashline. Cada sección empieza con la cabecera " +
    "[PATH#TAG] que te dio read_file, y usa ops SWAP/DEL/INS por número de línea.",
  schema: z.object({ input: z.string() }),
  async run({ input }, ctx) {
    const sections = parseHashline(input);     // [{ path, tag, ops }]
    const results = [];
    for (const sec of sections) {
      const current = await readWithinProject(sec.path, ctx);
      const currentHash = computeFileHash(current);
      // verificación: el archivo no cambió desde la lectura
      if (currentHash !== sec.tag) {
        const snap = ctx.snapshots.find(sec.path, sec.tag);
        // (MVP: si no coincide, error claro pidiendo re-leer; recuperación = después)
        throw new ToolError(mismatchMessage(sec.path, sec.tag, currentHash));
      }
      const next = applyOps(normalize(current).split("\n"), sec.ops);
      await writeWithinProject(sec.path, next.join("\n"), ctx);
      const newHash = computeFileHash(next.join("\n"));
      ctx.snapshots.record(sec.path, next, newHash);
      results.push(`[${sec.path}#${newHash}]\n${diffPreview(current, next)}`);
    }
    return { output: results.join("\n\n"), isError: false };
  },
};
```

`applyOps` aplica las operaciones **ordenadas de mayor a menor número de línea**,
para que insertar/borrar no corra los índices de las ops siguientes.

### Operaciones del MVP

Empezamos con las **no-`.BLK`** (sin tree-sitter): `SWAP N.=M:`, `DEL N.=M`,
`INS.PRE N:`, `INS.POST N:`, `INS.HEAD:`, `INS.TAIL:`. Cubren casi todo. Las
`.BLK` (reemplazar un bloque sintáctico entero) se agregan cuando integremos
tree-sitter.

---

## Recortes de alcance (qué dejamos para después)

Para no morir en la orilla, **no** copiamos al inicio:

- `read`: archivos comprimidos, SQLite, URLs (`pr://`/`issue://`/web), imágenes,
  notebooks y resúmenes estructurales. Solo **archivos de texto locales + rangos**.
- `edit`: las ops `.BLK` con tree-sitter, la recuperación avanzada basada en
  snapshots (merge de 3 vías), el sobre `*** Begin/End Patch`, y la escritura a
  través del LSP. En el MVP, si el hash no coincide → error y re-leer.
- Toda la familia de selectores exóticos del `read` de oh-my-pi
  (`:conflicts`, `:raw`, multi-rango complejo): empezamos con rango simple.

Estos recortes mantienen el **núcleo de valor** (lectura numerada + edición por
línea verificada por hash) con una fracción del código.

## Flujo completo (read → edit)

```
1. read_file({ path })
   → graba snapshot { path, hash, lines } en la sesión
   → devuelve  [path#HASH] + líneas "N:texto"
2. El modelo arma un edit copiando la cabecera y números de línea:
   [path#HASH]
   SWAP 41.=42:
   +nueva línea 41
   +nueva línea 42
3. edit_file({ input })
   → verifica que computeFileHash(archivo) == HASH  (si no: error, re-leer)
   → aplica ops por número de línea, escribe el archivo
   → graba nuevo snapshot, devuelve [path#NUEVOHASH] + diff
```

## Encaje con nuestra arquitectura

- Ambas son `Tool` neutrales (esquema Zod + `run`), así que funcionan con
  cualquier proveedor (Claude, opencode) sin cambios. Ver
  [arquitectura-backend.md](./arquitectura-backend.md) §5 y §2.
- El `ctx` que recibe `run` debe exponer el **snapshot store de la sesión** y los
  helpers de ruta segura (`readWithinProject` / `writeWithinProject`) que validan
  que todo quede dentro del proyecto activo.
- `edit_file` es una acción que **modifica** → entra en la política de permisos
  (confirmación) descrita en §7 del backend, igual que `run_command`.

## Referencias

- Repo: <https://github.com/can1357/oh-my-pi>
- Doc del `read`: `docs/tools/read.md` — formato `[PATH#TAG]` + `LINE:TEXT`,
  snapshot store, selectores.
- Doc del `edit`: `docs/tools/edit.md` — gramática hashline (`SWAP`/`DEL`/`INS`),
  verificación por hash, `MismatchError`, ejemplos.
- Paquete del núcleo en oh-my-pi: `packages/hashline/` (`format.ts`, `input.ts`,
  `parser.ts`, `apply.ts`, `snapshots.ts`, `recovery.ts`, `mismatch.ts`).
