// ACP Node desktop shell — wraps the Web3.0 dashboard in a native window (WebView) so an operator
// double-clicks to run and manage a node. The bundled dashboard talks to a local node on :8787.
//
// Node process: this scaffold expects the node reachable at http://127.0.0.1:8787. To launch it
// automatically as a bundled sidecar, add the compiled node binary to tauri.conf.json `bundle.externalBin`
// and spawn it here via tauri-plugin-shell (see desktop/README.md). Kept out of the default build so
// the shell compiles cleanly without the (larger) node-bundling packaging step.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running the ACP Node desktop app");
}
