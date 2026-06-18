// Cáscara Tauri mínima de MyAgent.
//
// Su única responsabilidad de negocio es **lanzar el sidecar Node** (el motor
// del agente, en TypeScript) al arrancar y **matarlo al salir**, para que no
// queden procesos huérfanos ocupando el puerto del WebSocket. Toda la lógica
// del agente vive en el sidecar; aquí no hay nada del dominio.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

/// Guarda el proceso hijo del sidecar para poder terminarlo al cerrar la app.
struct SidecarProcess(Mutex<Option<Child>>);

/// Puerto por defecto del WebSocket local del sidecar. Debe coincidir con el
/// que usa la UI en `src/transport/client.ts`. Override con MYAGENT_SIDECAR_PORT.
const DEFAULT_SIDECAR_PORT: &str = "8137";

/// Ruta a la raíz del proyecto (carpeta MyAgent) resuelta en tiempo de
/// compilación. En `tauri dev` esto apunta al checkout real; el empaquetado de
/// release (Fase 4) usará una resolución basada en recursos del bundle.
fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri siempre tiene un padre (la raíz del proyecto)")
        .to_path_buf()
}

/// Lanza `node sidecar/dist/server.js`. Hereda stdout/stderr para que los logs
/// del sidecar aparezcan en la consola de `tauri dev`.
fn spawn_sidecar() -> std::io::Result<Child> {
    let root = project_root();
    let server = root.join("sidecar").join("dist").join("server.js");
    let port = std::env::var("MYAGENT_SIDECAR_PORT")
        .unwrap_or_else(|_| DEFAULT_SIDECAR_PORT.to_string());

    eprintln!("[myagent] lanzando sidecar: node {}", server.display());
    Command::new("node")
        .arg(&server)
        .env("MYAGENT_SIDECAR_PORT", port)
        // El sidecar vigila este PID y se autotermina si la cáscara muere (p. ej.
        // Ctrl-C o crash), para no quedar huérfano ocupando el puerto del WS.
        .env("MYAGENT_PARENT_PID", std::process::id().to_string())
        // El CWD del sidecar es la raíz del proyecto: por defecto el agente
        // opera sobre estos archivos hasta que la UI elija otra carpeta.
        .current_dir(&root)
        .spawn()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarProcess(Mutex::new(None)))
        .setup(|app| {
            match spawn_sidecar() {
                Ok(child) => {
                    let state = app.state::<SidecarProcess>();
                    *state.0.lock().unwrap() = Some(child);
                }
                // No abortamos la ventana si el sidecar falla: la UI mostrará
                // "desconectado" y el error queda en la consola de dev.
                Err(e) => eprintln!("[myagent] no se pudo lanzar el sidecar: {e}"),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error al construir la app Tauri")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                // Acotamos el guard del Mutex para que se libere antes de usar el
                // Child (evita que el MutexGuard temporal sobreviva a `state`).
                let child = {
                    let state = app_handle.state::<SidecarProcess>();
                    let taken = state.0.lock().unwrap().take();
                    taken
                };
                if let Some(mut child) = child {
                    let pid = child.id();
                    eprintln!("[myagent] terminando sidecar (pid {pid})");
                    #[cfg(unix)]
                    {
                        // SIGKILL seco no le da tiempo al sidecar de matar las
                        // apps de larga duración (start_app). Le mandamos SIGTERM
                        // y esperamos hasta 2s a que cierre solo.
                        let _ = std::process::Command::new("kill")
                            .arg("-TERM")
                            .arg(pid.to_string())
                            .status();
                        for _ in 0..20 {
                            if matches!(child.try_wait(), Ok(Some(_))) { break; }
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}
