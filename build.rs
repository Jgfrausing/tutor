use std::fs;
use std::path::{Path, PathBuf};

fn files(dir: &Path, base: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            files(&p, base, out);
        } else {
            out.push(p.strip_prefix(base).unwrap().to_path_buf());
        }
    }
}

fn main() {
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("dist");
    println!("cargo:rerun-if-changed=dist");
    let mut list = Vec::new();
    files(&dist, &dist, &mut list);
    let mut code = String::from("pub static DIST: &[(&str, &[u8])] = &[\n");
    for rel in list {
        let name = rel.to_string_lossy().replace('\\', "/");
        code.push_str(&format!(
            "    ({name:?}, include_bytes!({:?})),\n",
            dist.join(&rel)
        ));
    }
    code.push_str("];\n");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("dist.rs");
    fs::write(out, code).unwrap();
}
