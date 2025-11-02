import fs from "fs";
import path from "path";
import { c } from "./utils/colors.js";

export interface SparkConfig {
  module?: "esm" | "cjs";
  outDir?: string;
  entry?: string;
  include?: string[];
  exclude?: string[];
  builtins?: boolean;
}

export function loadConfig(projectPath = process.cwd()): SparkConfig {
  const configPath = path.join(projectPath, "dsk.config.ds");
  if (!fs.existsSync(configPath)) {
    console.log(c.warn("⚠ No se encontró 'dsk.config.ds', usando configuración por defecto."));
    return { module: "cjs", builtins: true };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const jsonLike = raw
    .replace(/^\s*export\s+default\s+/, "")
    .replace(/;\s*$/, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":')
    .replace(/'/g, '"');
  try {
    const parsed = JSON.parse(jsonLike);
    if (typeof parsed.builtins === 'undefined') parsed.builtins = true;
    return parsed;
  } catch (e) {
    console.error(c.error("Error al parsear el archivo de configuración dsk.config.ds"));
    console.error(e);
    return { module: "cjs", builtins: true };
  }
}
