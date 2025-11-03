import fs from "fs";
import path from "path";
import { parse as acornParse } from "acorn";
import { c } from "./utils/colors.js";
import chalk from "chalk";

type SimpleType = "str" | "num" | "mbool" | "arr" | "obj" | string | null;

class CompileError extends Error {
  constructor(public file: string, public line: number, public column: number, message: string) {
    super(`${file}:${line}:${column}  ${message}`);
    this.name = "CompileError";
  }
}

interface VarInfo {
  name: string;
  declaredKind: "let" | "const";
  declaredType: SimpleType;
  mutable: boolean;
  inmutedAtLine?: number;
  declaredLine: number;
  implicit?: boolean;
}

interface FuncInfo {
  name: string;
  params: { name: string; type: SimpleType }[];
  declaredLine: number;
  returnType?: SimpleType; // NUEVO: Para manejar tipos de retorno
  returnTypeCol?: number; // NUEVO: Para manejar tipos de retorno
}

interface InterfaceInfo {
  name: string;
  fields: Record<string, SimpleType>;
  declaredLine: number;
  optionalFields?: Set<string>;
  requiredKeys?: string[];
}

// Sistema de Scopes
interface Scope {
  parent: Scope | null;
  variables: Map<string, VarInfo>;
  type: 'global' | 'function' | 'block' | 'class';
}

class ScopeManager {
  private currentScope: Scope;
  private scopeStack: Scope[] = [];

  constructor() {
    this.currentScope = this.createScope('global', null);
    this.scopeStack.push(this.currentScope);
  }

  createScope(type: 'global' | 'function' | 'block' | 'class', parent: Scope | null): Scope {
    return {
      parent,
      variables: new Map(),
      type
    };
  }

  enterScope(type: 'function' | 'block' | 'class') {
    const newScope = this.createScope(type, this.currentScope);
    this.scopeStack.push(newScope);
    this.currentScope = newScope;
  }

  exitScope() {
    if (this.scopeStack.length > 1) {
      this.scopeStack.pop();
      this.currentScope = this.scopeStack[this.scopeStack.length - 1];
    }
  }

  getCurrentScope(): Scope {
    return this.currentScope;
  }

  // Buscar variable en el scope actual y padres
  findVariable(name: string): VarInfo | null {
    let scope: Scope | null = this.currentScope;
    while (scope) {
      if (scope.variables.has(name)) {
        return scope.variables.get(name)!;
      }
      scope = scope.parent;
    }
    return null;
  }

  // Verificar si variable existe en scope actual (sin buscar en padres)
  hasInCurrentScope(name: string): boolean {
    return this.currentScope.variables.has(name);
  }

  // Agregar variable al scope actual
  addVariable(name: string, info: VarInfo) {
    this.currentScope.variables.set(name, info);
  }

  // Obtener todas las variables accesibles desde el scope actual
  getAllAccessibleVariables(): Map<string, VarInfo> {
    const allVars = new Map<string, VarInfo>();
    let scope: Scope | null = this.currentScope;
    
    while (scope) {
      for (const [name, info] of scope.variables) {
        if (!allVars.has(name)) {
          allVars.set(name, info);
        }
      }
      scope = scope.parent;
    }
    
    return allVars;
  }
}

/* small helpers */

function isStringLiteral(s: string) { 
  const trimmed = s.trim();
  return (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
         (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
         (trimmed.startsWith("`") && trimmed.endsWith("`"));
}
function isNumberLiteral(s: string) { return /^-?\d+(\.\d+)?$/.test(s.trim()); }
function isMboolLiteral(s: string) { 
  const trimmed = s.trim();
  return trimmed === "(Math.random() < 0.5)" || trimmed === "true" || trimmed === "false" || trimmed === "maybe";
}

// Función mejorada para extraer tipo de array
function extractArrayType(declaredType: string): { baseType: string; innerType: string | null } {
  if (typeof declaredType !== 'string') return { baseType: String(declaredType), innerType: null };
  
  // Manejar arr<type>
  const match = declaredType.match(/^arr<(.+)>$/);
  if (match) {
    return { baseType: "arr", innerType: match[1] };
  }
  
  // Manejar arr[] (legacy)
  if (declaredType === 'arr[]') {
    return { baseType: "arr", innerType: null };
  }
  
  return { baseType: declaredType, innerType: null };
}

// CORRECCIÓN: Función mejorada para inferir tipos que considera interfaces
function inferTypeFromExpr(expr: string, vars?: Map<string, VarInfo>, interfaces?: Map<string, InterfaceInfo>): SimpleType {
  const s = expr.trim();
  if (!s) return null;
  if (isStringLiteral(s)) return "str";
  if (isNumberLiteral(s)) return "num";
  if (isMboolLiteral(s)) return "mbool";
  // Heuristics: .toString() => str
  if (/\.toString\s*\(\s*\)\s*$/.test(s)) return 'str';
  // Heuristics: string concatenations => str
  if (/\+/.test(s) && (/["'`]/.test(s) || /\.toString\s*\(\s*\)/.test(s))) return 'str';
  if (s.startsWith("[")) return "arr";
  if (s.startsWith("{")) return "obj";
  // CORRECCIÓN: Detectar 'new' y devolver el nombre de la clase
  if (s.startsWith("new ")) {
    // Extraer el nombre de la clase después de 'new'
    const match = s.match(/^new\s+([A-Za-z_$][\w$]*)/);
    if (match) {
      return match[1]; // Devolver el nombre de la clase como tipo
    }
    return "obj";
  }
  
  // CORRECCIÓN MEJORADA: Detectar llamadas a funciones
  if (/^[A-Za-z_$][\w$]*\s*\(/.test(s)) {
    // Es una llamada a función - no podemos inferir el tipo de retorno en tiempo de compilación
    // Pero podemos intentar buscar si es una función conocida con tipo de retorno
    const funcNameMatch = s.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (funcNameMatch && vars) {
      // Buscar si tenemos información de funciones con tipos de retorno
      // Por ahora, devolvemos null y confiamos en la anotación de tipo del usuario
    }
    return null;
  }
  
  if (/^[A-Za-z_$][\w$]*$/.test(s)) {
    // Si tenemos información de variables, buscar el tipo
    if (vars) {
      const varInfo = vars.get(s);
      if (varInfo) {
        // CORRECCIÓN: Si el tipo es una interfaz, tratarlo como "obj"
        if (varInfo.declaredType && interfaces && interfaces.has(String(varInfo.declaredType))) {
          return varInfo.declaredType; // IMPORTANTE: Mantener el tipo de interfaz, no convertirlo a "obj"
        }
        return varInfo.declaredType;
      }
    }

    return null; // variable name, unknown here
  }
  return null;
}

// Función MEJORADA para inferir tipos de elementos de array - CORREGIDA PARA INTERFACES
function inferArrayElementTypes(expr: string, vars?: Map<string, VarInfo>, interfaces?: Map<string, InterfaceInfo>): (SimpleType | null)[] {
  const s = expr.trim();
  if (!s.startsWith("[")) return [];
  
  try {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    
    const elements: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let inTemplate = false;
    
    for (let i = 0; i < inner.length; i++) {
      const char = inner[i];
      
      // Manejar strings y templates
      if ((char === '"' || char === "'") && !inString && !inTemplate) {
        inString = true;
        stringChar = char;
        current += char;
      } else if (inString && char === stringChar && (i === 0 || inner[i-1] !== '\\')) {
        inString = false;
        current += char;
      } else if (char === '`' && !inString && !inTemplate) {
        inTemplate = true;
        current += char;
      } else if (inTemplate && char === '`' && (i === 0 || inner[i-1] !== '\\')) {
        inTemplate = false;
        current += char;
      } else if (char === '[' && !inString && !inTemplate) {
        depth++;
        current += char;
      } else if (char === ']' && !inString && !inTemplate) {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0 && !inString && !inTemplate) {
        elements.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      elements.push(current.trim());
    }
    
    return elements.map(e => {
      const trimmed = e.trim();
      
      // Detectar strings explícitamente (entre comillas simples, dobles o backticks)
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || 
          (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
          (trimmed.startsWith("`") && trimmed.endsWith("`"))) {
        return "str";
      }
      
      // Detectar números
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) return "num";
      
      // Detectar booleanos
      if (trimmed === "true" || trimmed === "false") return "mbool";
      
      // Detectar maybe
      if (trimmed === "maybe") return "mbool";
      
      // Para identificadores/variables, usar la información de tipos disponible
      if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
        if (vars) {
          const varInfo = vars.get(trimmed);
          if (varInfo) {
            // CORRECCIÓN: Si el tipo es una interfaz, mantener el tipo específico
            if (varInfo.declaredType && interfaces && interfaces.has(String(varInfo.declaredType))) {
              return varInfo.declaredType;
            }
            return varInfo.declaredType;
          }
        }
        return null;
      }
      
      // Para objetos y arrays literales
      if (trimmed.startsWith("{")) return "obj";
      if (trimmed.startsWith("[")) return "arr";
      // CORRECCIÓN: Detectar 'new' y devolver el nombre de la clase
      if (trimmed.startsWith("new ")) {
        const match = trimmed.match(/^new\s+([A-Za-z_$][\w$]*)/);
        if (match) {
          return match[1];
        }
        return "obj";
      }
      
      // CORRECCIÓN: Detectar llamadas a funciones
      if (/^[A-Za-z_$][\w$]*\s*\(/.test(trimmed)) {
        return null; // No podemos inferir tipo de retorno
      }
      
      return null;
    });
  } catch (e) {
    return [];
  }
}

// Función AUXILIAR MEJORADA para extraer contenido de objetos
function extractObjectContent(objLiteral: string): string {
  const trimmed = objLiteral.trim();
  
  // Si no empieza con {, devolver tal cual
  if (!trimmed.startsWith("{")) {
    return trimmed;
  }
  
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let inTemplate = false;
  let contentStart = -1;
  
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    
    // Manejar strings y templates
    if ((char === '"' || char === "'") && !inString && !inTemplate) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && (i === 0 || trimmed[i-1] !== '\\')) {
      inString = false;
    } else if (char === '`' && !inString && !inTemplate) {
      inTemplate = true;
    } else if (inTemplate && char === '`' && (i === 0 || trimmed[i-1] !== '\\')) {
      inTemplate = false;
    } 
    // Solo contar llaves si no estamos en string/template
    else if (!inString && !inTemplate) {
      if (char === '{') {
        if (depth === 0) {
          contentStart = i + 1;
        }
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0 && contentStart !== -1) {
          // Encontramos el final del objeto principal
          return trimmed.slice(contentStart, i).trim();
        }
      }
    }
  }
  
  // Fallback: si no pudimos extraer correctamente, usar slice simple
  if (trimmed.endsWith('}')) {
    return trimmed.slice(1, -1).trim();
  }
  
  return trimmed.slice(1).trim();
}

// Función para verificar si todos los elementos de un array son del mismo tipo
function allElementsSameType(elementTypes: (SimpleType | null)[]): { allSame: boolean; type: SimpleType | null } {
  if (elementTypes.length === 0) return { allSame: true, type: null };
  
  // Filtrar elementos nulos (no podemos determinar su tipo)
  const knownTypes = elementTypes.filter(t => t !== null);
  if (knownTypes.length === 0) return { allSame: true, type: null };
  
  const firstType = knownTypes[0];
  for (let i = 1; i < knownTypes.length; i++) {
    if (knownTypes[i] !== firstType) {
      return { allSame: false, type: null };
    }
  }
  return { allSame: true, type: firstType };
}

/* Validate an object-literal (text) contains required keys of an interface (shallow) */
function objectLiteralHasKeys(objLiteral: string, keys: string[]): boolean {
  // Limpiar y normalizar el objeto literal
  let content = objLiteral.trim();
  
  // Si el objeto empieza y termina con llaves, quitarlas para obtener el contenido interno
  if (content.startsWith('{') && content.endsWith('}')) {
    content = content.slice(1, -1).trim();
  }
  
  // Buscar propiedades usando un enfoque más simple y directo
  const found: Record<string, boolean> = {};
  
  // Dividir por comas, pero teniendo en cuenta objetos y arrays anidados
  let inObject = 0;
  let inArray = 0;
  let inString = false;
  let stringChar = '';
  let currentProp = '';
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    // Manejar strings
    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && content[i-1] !== '\\') {
      inString = false;
    }
    // Manejar objetos y arrays solo si no estamos en string
    else if (!inString) {
      if (char === '{') inObject++;
      else if (char === '}') inObject--;
      else if (char === '[') inArray++;
      else if (char === ']') inArray--;
      else if (char === ',' && inObject === 0 && inArray === 0) {
        // Encontramos una propiedad completa
        const propMatch = currentProp.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
        if (propMatch) {
          found[propMatch[1]] = true;
        }
        currentProp = '';
        continue;
      }
    }
    
    currentProp += char;
  }
  
  // Procesar la última propiedad
  if (currentProp.trim()) {
    const propMatch = currentProp.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (propMatch) {
      found[propMatch[1]] = true;
    }
  }
  
  // También buscar propiedades directamente con regex en el contenido completo
  const propRegex = /([A-Za-z_$][\w$]*)\s*:/g;
  let match;
  while ((match = propRegex.exec(content)) !== null) {
    found[match[1]] = true;
  }
  
  // Verificar que todas las claves requeridas estén presentes
  const missingKeys = keys.filter(key => !found[key]);
  if (missingKeys.length > 0) {
    return false;
  }
  return true;
}

/* Main transpiler */
export function transpileSpark(sourceCode: string, filePath = "<input>.sp"): { code: string; diagnostics: Array<{ line: number; column: number; message: string }> } | string {
  const origLines = sourceCode.split(/\r?\n/);
  const diagnostics: Array<{ line: number; column: number; message: string }> = [];

  // Special-case: if the entire file is a single top-level object literal, treat it as a config module
  try {
    const trimmed = sourceCode.trim();
    if (/^\{[\s\S]*\}$/.test(trimmed)) {
      const wrapped = `export default ${trimmed}`;
      acornParse(wrapped, { ecmaVersion: "latest", sourceType: "module" });
      return { code: wrapped, diagnostics };
    }
  } catch {
    // fall through to normal pipeline
  }

  // --- 0) Extract interface blocks safely and remove them from the parsing source ---
  const interfaces = new Map<string, { name: string; fields: Record<string, SimpleType>; declaredLine: number; optionalFields: Set<string>; requiredKeys: string[] }>();
  // Type system additions: aliases, reserved, builtins
  const typeAliases = new Map<string, string>();
  const reservedTypeNames = new Set<string>([
    'func','function','class','mut','inmut','return','if','else','for','while','try','catch','finally','switch','let','const','var','new','throw','import','export','default','extends','implements','constructor','async','await','interface','type'
  ]);
  const builtinTypes = new Set<string>(['str','num','mbool','arr','obj','void']);
  let work = sourceCode;
  const ifaceKeywordRx = /interface\s+([A-Za-z_$][\w$]*)\s*\{/g;
  let im;
  
  // Primera pasada: encontrar y eliminar todas las interfaces
  let interfaceBlocks: {start: number, end: number}[] = [];
  while ((im = ifaceKeywordRx.exec(work)) !== null) {
    const name = im[1];
    const start = im.index;
    let idx = work.indexOf("{", start);
    if (idx === -1) break;
    
    let depth = 0;
    let end = -1;
    for (; idx < work.length; idx++) {
      if (work[idx] === "{") depth++;
      else if (work[idx] === "}") {
        depth--;
        if (depth === 0) { end = idx; break; }
      }
    }
    
    if (end === -1) {
      const lineNo = work.slice(0, start).split("\n").length;
      throw new CompileError(filePath, lineNo, 1, `Malformed interface '${name}', missing '}'`);
    }
    
    const body = work.slice(im.index + im[0].length, end);
    const fields: Record<string, SimpleType> = {};
    const optionalFields = new Set<string>();
    // Support optional marker: field?::Type; (Type may include spaces)
    const fieldRx = /([A-Za-z_$][\w$]*)(\?)?\s*::\s*([^;]+);?/g;
    let fm;
    while ((fm = fieldRx.exec(body)) !== null) {
      const fname = fm[1];
      const isOpt = !!fm[2];
      let raw = fm[3].trim();
      if (raw.endsWith('[]')) raw = 'arr'; // legacy normalize
      const t = (["str","num","mbool","arr","obj"].includes(raw) ? (raw as SimpleType) : raw);
      fields[fname] = t;
      if (isOpt) optionalFields.add(fname);
    }
    // Fallback scan to ensure optional markers are recorded
    try {
      const optScan = /([A-Za-z_$][\w$]*)\?\s*::/g;
      let om;
      while ((om = optScan.exec(body)) !== null) {
        optionalFields.add(om[1]);
      }
    } catch {}
    const declaredLine = work.slice(0, im.index).split("\n").length;
    const requiredKeys = Object.keys(fields).filter(k => !optionalFields.has(k));
    interfaces.set(name, { name, fields, declaredLine, optionalFields, requiredKeys });
    interfaceBlocks.push({start: im.index, end: end + 1});
  }

  // Eliminar todas las interfaces del código de trabajo
  let cleanedWork = work;
  for (let i = interfaceBlocks.length - 1; i >= 0; i--) {
    const block = interfaceBlocks[i];
    cleanedWork = cleanedWork.slice(0, block.start) + cleanedWork.slice(block.end);
  }
  // --- 0.1) Extract simple type aliases: type Name = <Type> ; ---
  const typeRx = /\btype\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)\s*;?/g;
  let tm: RegExpExecArray | null;
  while ((tm = typeRx.exec(sourceCode)) !== null) {
    const name = tm[1];
    const rhs = tm[2].trim();
    const declLine = sourceCode.slice(0, tm.index).split("\n").length;
    if (reservedTypeNames.has(name) || builtinTypes.has(name)) {
      throw new CompileError(filePath, declLine, 1, `Invalid type alias name '${name}': reserved`);
    }
    if (interfaces.has(name)) {
      throw new CompileError(filePath, declLine, 1, `Invalid type alias '${name}': conflicts with interface`);
    }
    typeAliases.set(name, rhs);
  }

  // Para parse-phase usamos el código sin interfaces
  const parseLines = cleanedWork.split(/\r?\n/);

  // --- 1) Preprocess parseLines into cleanedForParseLines (makes code parseable) ---
  const cleanedForParseLines: string[] = [];
  
  for (let i = 0; i < parseLines.length; i++) {
    let L = parseLines[i];

    if (/^\s*$/.test(L) || /^\s*\/\//.test(L) || /^\s*\/\*/.test(L)) {
      cleanedForParseLines.push(L);
      continue;
    }

    // rewrite imports/exports from .ds -> .js (static forms)
    L = L.replace(/from\s+(['"])(.+?)\.ds\1/g, (_m, q, p) => {
      const spec = (/^(\.|\/|[A-Za-z]:\\)/.test(p) ? p : `./${p}`) + '.js';
      return `from ${q}${spec}${q}`;
    });
    L = L.replace(/\bexport\s+[^;]*?\sfrom\s+(['"])(.+?)\.ds\1/g, (_m, q, p) => {
      const spec = (/^(\.|\/|[A-Za-z]:\\)/.test(p) ? p : `./${p}`) + '.js';
      return _m.replace(`${p}.ds`, spec);
    });
    // bare import specifiers and dynamic import()
    L = L.replace(/\bimport\s*\(\s*(['"])(.+?)\.ds\1\s*\)/g, (_m, q, p) => {
      const spec = (/^(\.|\/|[A-Za-z]:\\)/.test(p) ? p : `./${p}`) + '.js';
      return `import(${q}${spec}${q})`;
    });
    L = L.replace(/\bimport\s+(['"])(.+?)\.ds\1/g, (_m, q, p) => {
      const spec = (/^(\.|\/|[A-Za-z]:\\)/.test(p) ? p : `./${p}`) + '.js';
      return `import ${q}${spec}${q}`;
    });

    // Strip type alias declarations entirely to keep JS parseable
    if (/^\s*type\s+([A-Za-z_$][\w$]*)\s*=/.test(L)) {
      cleanedForParseLines.push('');
      continue;
    }
    // remove inline ::types (x::Type -> x)
    L = L.replace(/([A-Za-z_$][\w$]*)::([A-Za-z_$<>\[\]]+)/g, "$1");

    // maybe -> random boolean
    L = L.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");

    // func -> function (strip optional ::ReturnType so acorn parses JS)
    // Case A: brace on same line - manejar cualquier tipo de return type
    L = L.replace(/\bfunc\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*::\s*([^{}]+?)\s*\{/g, "function $1($2){");
    L = L.replace(/\basync\s+func\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*::\s*([^{}]+?)\s*\{/g, "async function $1($2){");

    // Case B: header ends here, brace on next line - manejar cualquier tipo de return type
    L = L.replace(/^\s*async\s+func\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*::\s*([^{}\n]+)\s*(?:([\/]{2}.*))?$/, (m, fn, args, _rt, com) => `async function ${fn}(${args})${com ? ' ' + com : ''}`);
    L = L.replace(/^\s*func\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*::\s*([^{}\n]+)\s*(?:([\/]{2}.*))?$/, (m, fn, args, _rt, com) => `function ${fn}(${args})${com ? ' ' + com : ''}`);
    // Generic func
    L = L.replace(/\bfunc\s+([A-Za-z_$][\w$]*)\s*\(/g, "function $1(");

    // Strip class method ::ReturnType so acorn parses class bodies
    // Case A: brace on same line
    L = L.replace(/^\s*((?:async\s+)?(?:static\s+)?(?:(?:get|set)\s+)?(?:constructor|[A-Za-z_$][\w$]*)\s*\([^)]*\))\s*::\s*([^{}\n]+)\s*\{/, (m, head) => `${head} {`);
    // Case B: header ends here, brace on next line
    L = L.replace(/^\s*((?:async\s+)?(?:static\s+)?(?:(?:get|set)\s+)?(?:constructor|[A-Za-z_$][\w$]*)\s*\([^)]*\))\s*::\s*([^{}\n]+)\s*(?:([\/]{2}.*))?$/, (m, head, _rt, com) => `${head}${com ? ' ' + com : ''}`);

    // call -> función normal (la verificación se hace en semantic pass)
    L = L.replace(/\bcall\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g, (_m, fname, args) => {
      if (args && args.trim()) return `${fname}(${args})`;
      return `${fname}()`;
    });

    // mut -> assignment only (no let)
    L = L.replace(/^\s*mut\s+([A-Za-z_$][\w$]*)\s*=\s*(.+);?/g, (_m, n, expr) => `${n} = ${expr.trim()};`);

    // inmut assignment -> assignment (we'll mark in semantic pass), inmut alone -> comment
    L = L.replace(/^\s*inmut\s+([A-Za-z_$][\w$]*)\s*=\s*(.+);?/g, (_m, n, expr) => `${n} = ${expr.trim()};`);
    L = L.replace(/^\s*inmut\s+([A-Za-z_$][\w$]*);?/g, (_m, n) => `/* inmut ${n} */`);

    cleanedForParseLines.push(L);
  }

  const cleanedForParse = cleanedForParseLines.join("\n");

  // --- 2) Quick parse to detect syntax errors early (interfaces already removed) ---
  // Build a parsed->source line map by simulating interface stripping line-by-line
  function buildParsedToSourceMap(src: string): number[] {
    const lines = src.split(/\r?\n/);
    const map: number[] = [];
    let inIface = false;
    let depth = 0;
    let parsedLine = 1;
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (!inIface && /^\s*interface\s+[A-Za-z_$][\w$]*\s*\{/.test(L)) {
        inIface = true; depth = 1;
      } else if (inIface) {
        for (let k = 0; k < L.length; k++) {
          const ch = L[k];
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { inIface = false; } }
        }
      } else {
        map[parsedLine - 1] = i + 1;
        parsedLine++;
      }
    }
    return map;
  }
  const parsedToSourceMap = buildParsedToSourceMap(sourceCode);
  try {
    acornParse(cleanedForParse, { ecmaVersion: "latest", sourceType: "module" });
  } catch (err: any) {
    const loc = err.loc ?? { line: 0, column: 0 };
    const parsedLine = loc.line || 1;
    const line = parsedToSourceMap[parsedLine - 1] || parsedLine;
    diagnostics.push({ line, column: loc.column ?? 0, message: `Syntax error (mapped): ${err.message}` });
    return { code: "", diagnostics };
  }

  // Helper to validate that a referenced type exists and is allowed
  function validateTypeRef(typeStr: string | null | undefined, lineNo: number, col: number) {
    if (!typeStr) return;
    const t = String(typeStr).trim();
    // Allow unions: A | B | "literal"
    if (t.includes('|')) {
      const parts = t.split('|').map(s => s.trim()).filter(Boolean);
      for (const p of parts) validateTypeRef(p, lineNo, col);
      return;
    }
    // Allow string literals as types in unions (e.g., "ok" | "err")
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return;
    // Array generic arr<T>
    const mt = t.match(/^arr<(.+)>$/);
    if (mt) { validateTypeRef(mt[1].trim(), lineNo, col); return; }
    // Builtins
    if (builtinTypes.has(t)) return;
    // Interfaces
    if (interfaces.has(t)) return;
    // Type aliases
    if (typeAliases.has(t)) return;
    // Reserved
    if (reservedTypeNames.has(t)) {
      throw new CompileError(filePath, lineNo, col, `Invalid type reference '${t}': reserved keyword`);
    }
    throw new CompileError(filePath, lineNo, col, `Unknown type '${t}'`);
  }

  // --- 3) Semantic pass line-by-line on the ORIGINAL source (origLines) ---
  const outLines: string[] = [];
  const outLineToSourceLine: number[] = [];
  const emit = (text: string, srcLine: number) => {
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      outLines.push(parts[i]);
      outLineToSourceLine.push(srcLine + i);
    }
  };
  const scopeManager = new ScopeManager();
  const funcs = new Map<string, FuncInfo>();
  const calledViaCall = new Map<string, number>();
  // Class -> (method -> returnType)
  const classMethods = new Map<string, Map<string, SimpleType>>();

  // --- helpers to validate object literal types against interface field specs (safe/minimal) ---
  function parseObjectProps(objLiteral: string): Array<{ key: string; value: string }> {
    let content = extractObjectContent(objLiteral);
    const props: Array<{ key: string; value: string }> = [];
    let i = 0, cur = '', depthObj = 0, depthArr = 0, inStr = false, strCh = '', inTpl = false;
    const pushProp = (s: string) => {
      const m = s.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/);
      if (m) props.push({ key: m[1], value: m[2].trim() });
    };
    while (i < content.length) {
      const ch = content[i];
      if (!inStr && !inTpl && (ch === '"' || ch === "'")) { inStr = true; strCh = ch; cur += ch; i++; continue; }
      if (inStr) { cur += ch; if (ch === strCh && content[i-1] !== '\\') { inStr = false; } i++; continue; }
      if (!inStr && ch === '`') { inTpl = !inTpl; cur += ch; i++; continue; }
      if (!inStr && !inTpl && ch === '{') { depthObj++; cur += ch; i++; continue; }
      if (!inStr && !inTpl && ch === '}') { depthObj--; cur += ch; i++; continue; }
      if (!inStr && !inTpl && ch === '[') { depthArr++; cur += ch; i++; continue; }
      if (!inStr && !inTpl && ch === ']') { depthArr--; cur += ch; i++; continue; }
      if (!inStr && !inTpl && depthObj === 0 && depthArr === 0 && ch === ',') { pushProp(cur); cur = ''; i++; continue; }
      cur += ch; i++;
    }
    if (cur.trim()) pushProp(cur);
    return props;
  }

  function matchesSimple(expected: string, inferred: SimpleType, rawExpr: string): boolean {
    // Support unions separated by '|'
    const options = expected.split('|').map(s => s.trim()).filter(Boolean);
    const exprTrim = (rawExpr || '').trim();
    const isArrayLiteral = exprTrim.startsWith('[');
    const isStringLiteral = (
      (exprTrim.startsWith('"') && exprTrim.endsWith('"')) ||
      (exprTrim.startsWith("'") && exprTrim.endsWith("'")) ||
      (exprTrim.startsWith('`') && exprTrim.endsWith('`'))
    );
    const stringValue = isStringLiteral ? exprTrim.slice(1, -1) : null;
    // heuristic: concatenations with strings or .toString() are strings
    const looksLikeStringConcat = /\+/.test(exprTrim) && (/["'`]/.test(exprTrim) || /\.toString\s*\(\s*\)/.test(exprTrim));
    const inferredEff = looksLikeStringConcat ? 'str' : inferred;
    const resolveAlias = (name: string): string[] => {
      const n = name.trim();
      if (typeAliases.has(n)) {
        const rhs = String(typeAliases.get(n) || '').trim();
        if (!rhs) return [n];
        if (rhs.includes('|')) return rhs.split('|').map(s => s.trim());
        return [rhs];
      }
      return [n];
    };
    const checkOne = (opt: string): boolean => {
      // expand aliases recursively (simple 1-level union expansion)
      const expanded = resolveAlias(opt);
      if (expanded.length > 1) {
        return expanded.some(e => checkOne(e));
      }
      const t = expanded[0];
      // literal string option
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        const lit = t.slice(1, -1);
        return stringValue !== null && stringValue === lit;
      }
      // arrays (arr<T>)
      if (/^arr<[^>]+>$/.test(t)) {
        return inferredEff === 'arr' || isArrayLiteral;
      }
      // primitives
      if (t === 'arr' || t === 'obj' || t === 'str' || t === 'num' || t === 'mbool') {
        return inferredEff === t;
      }
      // interface or alias name (treat object literals as compatible)
      return inferredEff === t || inferredEff === 'obj' || inferredEff === null;
    };
    for (const opt of options) {
      if (checkOne(opt)) return true;
    }
    return false;
  }

  function validateObjectFieldTypes(objLiteral: string, iface: InterfaceInfo, accessibleVars: Map<string, VarInfo>, lineNo: number, varName: string) {
    const props = parseObjectProps(objLiteral);
    for (const p of props) {
      const expected = iface.fields[p.key];
      if (!expected) continue; // unknown props are allowed for now
      const inferred = inferTypeFromExpr(p.value, accessibleVars, interfaces);
      if (!matchesSimple(String(expected), inferred, p.value)) {
        throw new CompileError(filePath, lineNo, 1, `Interface type error: field '${p.key}' of '${varName}' expected ${expected}`);
      }
    }
  }

  // Deep RHS expression analyzer (top-level '+' splits, literals, identifiers, function return types, .toString())
  function splitTopLevel(expr: string, sep: string): string[] {
    const s = String(expr ?? '');
    const out: string[] = [];
    let cur = '';
    let depthP = 0, depthB = 0, depthC = 0;
    let inStr = false, strCh = '';
    let inTpl = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (!inStr && ch === '`') { inTpl = !inTpl; cur += ch; continue; }
      if (!inTpl && (ch === '"' || ch === "'")) {
        if (!inStr) { inStr = true; strCh = ch; cur += ch; continue; }
        else if (inStr && ch === strCh && s[i-1] !== '\\') { inStr = false; cur += ch; continue; }
      }
      if (inStr || inTpl) { cur += ch; continue; }
      if (ch === '(') { depthP++; cur += ch; continue; }
      if (ch === ')') { depthP--; cur += ch; continue; }
      if (ch === '[') { depthB++; cur += ch; continue; }
      if (ch === ']') { depthB--; cur += ch; continue; }
      if (ch === '{') { depthC++; cur += ch; continue; }
      if (ch === '}') { depthC--; cur += ch; continue; }
      if (depthP === 0 && depthB === 0 && depthC === 0 && ch === sep) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim().length) out.push(cur.trim());
    return out;
  }

  function stripParens(expr: string): string {
    let s = String(expr ?? '').trim();
    while (s.startsWith('(') && s.endsWith(')')) {
      let bal = 0, ok = true;
      for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === '(') bal++; else if (ch === ')') bal--; if (bal === 0 && i < s.length - 1) { ok = false; break; } }
      if (!ok) break;
      s = s.slice(1, -1).trim();
    }
    return s;
  }

  // Parse top-level ternary: cond ? a : b
  function parseTopLevelTernary(s: string): { cond: string; whenTrue: string; whenFalse: string } | null {
    const src = String(s ?? '');
    let depthP = 0, depthB = 0, depthC = 0;
    let inStr = false, strCh = '';
    let inTpl = false;
    let qIdx = -1, colonIdx = -1;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (!inStr && ch === '`') { inTpl = !inTpl; continue; }
      if (!inTpl && (ch === '"' || ch === "'")) {
        if (!inStr) { inStr = true; strCh = ch; continue; }
        else if (inStr && ch === strCh && src[i-1] !== '\\') { inStr = false; continue; }
      }
      if (inStr || inTpl) continue;
      if (ch === '(') { depthP++; continue; }
      if (ch === ')') { depthP--; continue; }
      if (ch === '[') { depthB++; continue; }
      if (ch === ']') { depthB--; continue; }
      if (ch === '{') { depthC++; continue; }
      if (ch === '}') { depthC--; continue; }
      if (depthP === 0 && depthB === 0 && depthC === 0) {
        if (ch === '?' && qIdx === -1) {
          const prev = src[i-1] || '';
          const next = src[i+1] || '';
          // ignore optional chaining '?.' and nullish '??'
          if (next === '.' || next === '?' || prev === '?') {
            // skip
          } else {
            qIdx = i;
          }
        } else if (ch === ':' && qIdx !== -1) { colonIdx = i; break; }
      }
    }
    if (qIdx !== -1 && colonIdx !== -1) {
      const cond = src.slice(0, qIdx).trim();
      const whenTrue = src.slice(qIdx + 1, colonIdx).trim();
      const whenFalse = src.slice(colonIdx + 1).trim();
      return { cond, whenTrue, whenFalse };
    }
    return null;
  }

  function analyzeExprType(expr: string, accessibleVars: Map<string, VarInfo>): SimpleType {
    const s0 = stripParens(expr);
    if (!s0) return null;
    // Direct maybe/bool literals
    if (s0 === 'maybe' || s0 === 'true' || s0 === 'false') return 'mbool';
    // Ternary expressions: infer from branches, not condition (do this BEFORE boolean heuristics)
    const tern = parseTopLevelTernary(s0);
    if (tern) {
      const tA = analyzeExprType(tern.whenTrue, accessibleVars);
      const tB = analyzeExprType(tern.whenFalse, accessibleVars);
      if (tA && tB) {
        if (tA === tB) return tA;
        if (tA === 'str' || tB === 'str') return 'str';
        if (tA === 'arr' || tB === 'arr') return 'arr';
        return tA ?? tB;
      }
      return tA ?? tB ?? null;
    }
    // Top-level comparisons imply mbool (do NOT classify &&/|| as boolean; they yield an operand)
    const isTopLevelBool = (() => {
      const s = String(s0);
      let depthP = 0, depthB = 0, depthC = 0;
      let inStr = false, strCh = '';
      let inTpl = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (!inStr && ch === '`') { inTpl = !inTpl; continue; }
        if (!inTpl && (ch === '"' || ch === "'")) {
          if (!inStr) { inStr = true; strCh = ch; continue; }
          else if (inStr && ch === strCh && s[i-1] !== '\\') { inStr = false; continue; }
        }
        if (inStr || inTpl) continue;
        if (ch === '(') { depthP++; continue; }
        if (ch === ')') { depthP--; continue; }
        if (ch === '[') { depthB++; continue; }
        if (ch === ']') { depthB--; continue; }
        if (ch === '{') { depthC++; continue; }
        if (ch === '}') { depthC--; continue; }
        if (depthP === 0 && depthB === 0 && depthC === 0) {
          // detect comparison operators at top-level
          const two = s.slice(i, i+2);
          const three = s.slice(i, i+3);
          if (three === '===' || three === '!==' || two === '==' || two === '!=' || two === '>=' || two === '<=' || ch === '<' || ch === '>') {
            return true;
          }
          if (ch === '!') {
            // unary not at top-level also implies boolean expression
            return true;
          }
        }
      }
      return false;
    })();
    if (isTopLevelBool) return 'mbool';
    const simple = inferTypeFromExpr(s0, accessibleVars, interfaces);
    if (simple) return simple;
    // Known native/global functions
    if (/^parseFloat\s*\(/.test(s0)) return 'num';
    if (/^parseInt\s*\(/.test(s0)) return 'num';
    if (/^Number\s*\(/.test(s0)) return 'num';
    if (/^String\s*\(/.test(s0)) return 'str';
    if (/^Boolean\s*\(/.test(s0)) return 'mbool';
    if (/^JSON\.stringify\s*\(/.test(s0)) return 'str';
    if (/^Array\.isArray\s*\(/.test(s0)) return 'mbool';
    if (/^Math\.[A-Za-z_$][\w$]*\s*\(/.test(s0)) return 'num';
    if (s0.includes('+')) {
      const parts = splitTopLevel(s0, '+');
      if (parts.length > 1) {
        for (const p of parts) {
          const t = analyzeExprType(p, accessibleVars);
          if (t === 'str') return 'str';
        }
        if (/["'`]/.test(s0) || /\.toString\s*\(\s*\)/.test(s0)) return 'str';
      }
    }
    const callM = s0.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (callM) {
      const fname = callM[1];
      const fmeta = funcs.get(fname);
      if (fmeta && fmeta.returnType) return fmeta.returnType;
      return null;
    }
    // Member calls: <recv>.<method>(...)
    const membCall = s0.match(/^(.*)(?:\.|\?\.)\s*([A-Za-z_$][\w$]*)\s*\(/);
    if (membCall) {
      const recvExpr = membCall[1].trim();
      const mname = membCall[2];
      const recvType = inferTypeFromExpr(recvExpr, accessibleVars, interfaces) || analyzeExprType(recvExpr, accessibleVars);
      if (recvType && classMethods.has(String(recvType))) {
        const mt = classMethods.get(String(recvType))!;
        const rt = mt.get(mname);
        if (rt) return rt;
      }
    }
    // Known instance methods
    if (/\.toString\s*\(\s*\)\s*$/.test(s0)) return 'str';
    if (/\.join\s*\(\s*\)/.test(s0)) return 'str';
    if (/\.includes\s*\(\s*/.test(s0)) return 'mbool';
    if (/^[A-Za-z_$][\w$]*$/.test(s0)) {
      const v = accessibleVars.get(s0);
      return v?.declaredType ?? null;
    }
    return null;
  }

  // Pre-scan func declarations in original source (capture param types incl custom and optional return type)
  const funcDeclRx = /\bfunc\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:::\s*([^{}\n]+))?\s*\{/g;
  let fd;
  while ((fd = funcDeclRx.exec(sourceCode)) !== null) {
    const fname = fd[1];
    const paramsRaw = fd[2].trim();
    const retRaw = (fd[3] || '').trim();
    const params = paramsRaw.length === 0 ? [] : paramsRaw.split(",").map(p => p.trim()).filter(Boolean).map(p => {
      const noDefault = p.replace(/=.*/, '').trim();
      const parts = noDefault.split("::").map(s => s.trim());
      const name = parts[0].trim();
      const typeStr = parts[1] ? parts[1].replace(/=.*/, '').trim() : null;
      return { name, type: (typeStr as SimpleType) };
    });
    const declaredLine = sourceCode.slice(0, fd.index).split("\n").length;
    const returnType = retRaw ? (retRaw as SimpleType) : undefined;
    // Compute column for '::' if present (1-based)
    let returnTypeCol: number | undefined;
    try {
      const head = sourceCode.slice(fd.index, funcDeclRx.lastIndex);
      const rel = head.indexOf('::');
      if (rel >= 0) {
        const abs = fd.index + rel;
        const lastNl = sourceCode.lastIndexOf("\n", abs);
        returnTypeCol = abs - (lastNl >= 0 ? lastNl : -1);
      }
    } catch {}
    funcs.set(fname, { name: fname, params, declaredLine, returnType, returnTypeCol } as any);
  }

  // Also record plain function declarations from cleaned parse (no param types)
  const jsFuncRx = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  while ((fd = jsFuncRx.exec(cleanedForParse)) !== null) {
    const fname = fd[1];
    const paramsRaw = fd[2].trim();
    const params = paramsRaw.length === 0 ? [] : paramsRaw.split(",").map(p => p.trim()).filter(Boolean).map(p => ({ name: p, type: null }));
    const declaredLine = cleanedForParse.slice(0, fd.index).split("\n").length;
    if (!funcs.has(fname)) funcs.set(fname, { name: fname, params, declaredLine });
  }

  // Estado para rastrear estructuras anidadas
  let inInterfaceBlock = false;
  let interfaceDepth = 0;
  // Pila de tipos de scope que SÍ introducen bloque real: 'function' | 'class' | 'block'
  let scopeTypeStack: ("function" | "class" | "block")[] = [];
  let inFunction = false;
  // Return type enforcement state
  let pendingFunctionName: string | null = null;
  // Class methods (multiline headers) pending info
  let pendingMethodName: string | null = null;
  let pendingMethodReturnType: SimpleType | undefined;
  const funcContextStack: Array<{ name: string; expected?: SimpleType; hasValueReturn: boolean; sawReturnAttempt?: boolean; startLine: number; headerLine?: number; headerCol?: number }>=[];
  // Soporte para cabeceras multilínea (cuando '{' va en la línea siguiente)
  let pendingOpenScope: null | "function" | "class" | "block" = null;

  // iterate original lines to apply semantic rules and emit final JS lines
  for (let idx = 0; idx < origLines.length; idx++) {
    const raw = origLines[idx];
    const lineNo = idx + 1;
    let L = raw;
    try {

    // Manejar bloques de interfaz - saltarlos completamente
    if (/^\s*interface\s/.test(L)) {
      inInterfaceBlock = true;
      interfaceDepth = 1;
      // count any extra '{' on same line after keyword, if a '{' exists
      const braceIdx = L.indexOf('{');
      if (braceIdx !== -1) {
        const rest = L.slice(braceIdx + 1);
        interfaceDepth += (rest.match(/\{/g) || []).length;
        interfaceDepth -= (rest.match(/\}/g) || []).length;
      }
      if (interfaceDepth <= 0) { inInterfaceBlock = false; interfaceDepth = 0; }
      continue;
    }

    if (inInterfaceBlock) {
      // adjust depth by counting braces on this line (rough but effective)
      interfaceDepth += (L.match(/\{/g) || []).length;
      interfaceDepth -= (L.match(/\}/g) || []).length;
      if (interfaceDepth <= 0) { inInterfaceBlock = false; interfaceDepth = 0; }
      continue;
    }

    // Detectar SI la línea abre un nuevo scope real (no por literales de objeto)
    const funcHeaderWithBrace = /^\s*(?:async\s+)?(func|function)\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:::\s*[^{]+)?\s*\{/.test(L);
    const funcHeaderNoBrace = /^\s*(?:async\s+)?(func|function)\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:::\s*[^{}\n]+)?\s*$/.test(L);
    const classHeaderWithBrace = /^\s*(?:export\s+)?(?:default\s+)?class\s+[A-Za-z_$][\w$]*\s*\{/.test(L);
    const classHeaderNoBrace = /^\s*(?:export\s+)?(?:default\s+)?class\s+[A-Za-z_$][\w$]*\s*$/.test(L);
    const controlHeaderWithBrace = /^\s*(if|else|for|while|try|catch|finally|switch)\b[^\{]*\{/.test(L);
    const controlHeaderNoBrace = /^\s*(if|else|for|while|try|catch|finally|switch)\b.*$/.test(L) && /\($/.test(L.trim());
    // Detect class method-like headers (supports async/static/get/set), even if class scope wasn't recognized
    const classMethodWithBrace =
      /^\s*(?:async\s+)?(?:static\s+)?(?:(?:get|set)\s+)?(?:constructor|[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:::\s*[^\{\n]+)?\s*\{/.test(L);
    const classMethodNoBrace =
      /^\s*(?:async\s+)?(?:static\s+)?(?:(?:get|set)\s+)?(?:constructor|[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:::\s*[^\{\n]+)?\s*$/.test(L);

    // Apertura inmediata si la llave está en la misma línea
    if (funcHeaderWithBrace || classMethodWithBrace) {
      scopeManager.enterScope('function');
      scopeTypeStack.push('function');
      inFunction = true;
      // when it's a real function (not class method), push return context
      if (funcHeaderWithBrace) {
        const m = L.match(/^\s*(?:async\s+)?(?:func|function)\s+([A-Za-z_$][\w$]*)/);
        const fname = m ? m[1] : "";
        const fmeta = fname ? funcs.get(fname) : undefined;
        funcContextStack.push({ name: fname, expected: fmeta?.returnType, hasValueReturn: false, sawReturnAttempt: false, startLine: lineNo, headerLine: fmeta?.declaredLine, headerCol: (fmeta as any)?.returnTypeCol });
      } else if (classMethodWithBrace) {
        // Extract method name and optional ::ReturnType
        const mm = L.match(/^\s*(?:async\s+)?(?:static\s+)?(?:(?:get|set)\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:::\s*([^\{\n]+))?\s*\{/);
        const mname = mm ? mm[1] : "";
        let mret = mm && mm[2] ? (mm[2].trim() as SimpleType) : undefined;
        if (mname === 'constructor') mret = undefined; // constructors are effectively void
        if (mret) { try { validateTypeRef(mret, lineNo, L.indexOf('::') + 3); } catch (e) { throw e; } }
        funcContextStack.push({ name: mname, expected: mret, hasValueReturn: false, startLine: lineNo });
      }
    } else if (classHeaderWithBrace) {
      scopeManager.enterScope('class');
      scopeTypeStack.push('class');
    } else if (controlHeaderWithBrace) {
      scopeManager.enterScope('block');
      scopeTypeStack.push('block');
    }

    // Marcar apertura pendiente si no hay llave en esta línea
    if (funcHeaderNoBrace || classMethodNoBrace) pendingOpenScope = 'function';
    // capture pending function/method name for later open
    if (funcHeaderNoBrace) {
      const m = L.match(/^\s*(?:async\s+)?(?:func|function)\s+([A-Za-z_$][\w$]*)/);
      pendingFunctionName = m ? m[1] : null;
      pendingMethodName = null; // clear method pending
      pendingMethodReturnType = undefined;
    } else if (classMethodNoBrace) {
      const mm = L.match(/^\s*(?:async\s+)?(?:static\s+)?(?:(?:get|set)\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:::\s*([^\{\n]+))?\s*$/);
      pendingMethodName = mm ? mm[1] : null;
      pendingMethodReturnType = mm && mm[2] ? (mm[2].trim() as SimpleType) : undefined;
      if (pendingMethodName === 'constructor') pendingMethodReturnType = undefined;
      if (pendingMethodReturnType) { validateTypeRef(pendingMethodReturnType, lineNo, L.indexOf('::') + 3); }
      pendingFunctionName = null; // make sure we treat it as method
    }
    else if (classHeaderNoBrace) pendingOpenScope = 'class';
    else if (controlHeaderNoBrace) pendingOpenScope = 'block';

    // Si hay una apertura pendiente y esta línea comienza con '{', abrir ahora
    if (pendingOpenScope && /^\s*\{/.test(L)) {
      scopeManager.enterScope(pendingOpenScope);
      scopeTypeStack.push(pendingOpenScope);
      if (pendingOpenScope === 'function') inFunction = true;
      if (pendingOpenScope === 'function') {
        if (pendingMethodName) {
          funcContextStack.push({ name: pendingMethodName, expected: pendingMethodReturnType, hasValueReturn: false, startLine: lineNo });
        } else {
          const fname = pendingFunctionName || "";
          const fmeta = fname ? funcs.get(fname) : undefined;
          funcContextStack.push({ name: fname, expected: fmeta?.returnType, hasValueReturn: false, startLine: lineNo, headerLine: fmeta?.declaredLine, headerCol: (fmeta as any)?.returnTypeCol });
        }
        pendingFunctionName = null;
        pendingMethodName = null;
        pendingMethodReturnType = undefined;
      }
      pendingOpenScope = null;
    }

    // Manejar cierre de scopes SOLO cuando corresponden a cierres de bloque reales al inicio de la línea
    // Evita contar '}' que pertenecen a objetos/arrays (p. ej., '},' o '}:' )
    const closeMatch = L.match(/^\s*\}+/);
    if (closeMatch) {
      const remainder = L.slice(closeMatch[0].length).trim();
      const looksLikeObjectContinuation = /^[,:]/.test(remainder) || /,\s*(?:$|\/\/)/.test(remainder);
      if (!looksLikeObjectContinuation) {
        const braceCount = (closeMatch[0].match(/\}/g) || []).length;
        for (let i = 0; i < braceCount; i++) {
          const lastScope = scopeTypeStack.pop();
          if (lastScope) {
            scopeManager.exitScope();
            if (lastScope === 'function') {
              inFunction = false;
              // on function end, check missing return if required
              const ctx = funcContextStack.pop();
              if (ctx && ctx.expected && String(ctx.expected) !== 'void' && !ctx.sawReturnAttempt) {
                const dl = ctx.headerLine || lineNo;
                const dc = ctx.headerCol || 1;
                throw new CompileError(filePath, dl, dc, `Function '${ctx.name}' declares return type ${ctx.expected} but has no return`);
              }
            }
          }
        }
      }
    }

    // preserve comments/blank lines
    if (/^\s*$/.test(L) || /^\s*\/\//.test(L) || /^\s*\/\*/.test(L)) {
      emit(L, lineNo);
      continue;
    }

    // Do NOT transform 'maybe' here; keep original text for type inference.

    // Ensure function declarations are valid JS in emitted code
    // Support both `func Name(` and `async func Name(` and optional ::ReturnType
    L = L.replace(/\basync\s+func\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*::\s*([^\{]+)\{/g, "async function $1($2){");
    L = L.replace(/\bfunc\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*::\s*([^\{]+)\{/g, "function $1($2){");
    L = L.replace(/\basync\s+func\s+([A-Za-z_$][\w$]*)\s*\(/g, "async function $1(");
    L = L.replace(/\bfunc\s+([A-Za-z_$][\w$]*)\s*\(/g, "function $1(");

    // rewrite imports/exports .ds -> .js in emitted code as well
    L = L.replace(/from\s+(['"])(.+?)\.ds\1/g, (_m, q, p) => {
      const spec = (/^(\.|\/|[A-Za-z]:\\)/.test(p) ? p : `./${p}`) + '.js';
      return `from ${q}${spec}${q}`;
    });
    L = L.replace(/\bexport\s+[^;]*?\sfrom\s+(['"])(.+?)\.ds\1/g, (_m, q, p) => {
      const spec = (/^(\.|\/|[A-Za-z]:\\)/.test(p) ? p : `./${p}`) + '.js';
      return _m.replace(`${p}.ds`, spec);
    });
    L = L.replace(/\bimport\s*\(\s*(['"])(.+?)\.ds\1\s*\)/g, (_m, q, p) => {
      const spec = (/^(\.|\/|[A-Za-z]:\\)/.test(p) ? p : `./${p}`) + '.js';
      return `import(${q}${spec}${q})`;
    });
    L = L.replace(/\bimport\s+(['"])(.+?)\.ds\1/g, (_m, q, p) => {
      const spec = (/^(\.|\/|[A-Za-z]:\\)/.test(p) ? p : `./${p}`) + '.js';
      return `import ${q}${spec}${q}`;
    });

    // Clean return/assignment expression for type inference
    const cleanExpr = (expr: string): string => {
      let s = String(expr ?? "");
      // strip line comments
      s = s.replace(/\/\/.*$/, "");
      s = s.trim();
      // if there's a semicolon, keep only up to the first one
      const semi = s.indexOf(';');
      if (semi >= 0) s = s.slice(0, semi);
      // helper: compute balance for pairs
      const bal = (str: string, o: string, c: string) => {
        let b = 0;
        for (let i = 0; i < str.length; i++) {
          const ch = str[i];
          if (ch === o) b++; else if (ch === c) b--;
        }
        return b;
      };
      // trim trailing unmatched closers from the right (belonging to outer scopes)
      while (bal(s, '{', '}') < 0) s = s.replace(/\s*\}\s*$/, '').trim();
      while (bal(s, '(', ')') < 0) s = s.replace(/\s*\)\s*$/, '').trim();
      // final tidy of trailing semicolons/spaces
      s = s.replace(/;+$/, '').trim();
      return s;
    };

    // Enforce return statement types when inside a function with declared return type
    // Detect 'return' anywhere on the line (supports single-line bodies)
    if (/(^|[;{])\s*return\b/.test(L)) {
      const ctx = funcContextStack.length > 0 ? funcContextStack[funcContextStack.length - 1] : undefined;
      if (ctx && ctx.expected) {
        // Extract substring after the last 'return' token on this line
        const retIdx = (() => {
          const m = [...L.matchAll(/(^|[;{])\s*return\b/g)];
          if (m.length === 0) return -1;
          const last = m[m.length - 1];
          return last.index! + last[0].length;
        })();
        const after = retIdx >= 0 ? L.slice(retIdx) : L;
        const before = retIdx >= 0 ? L.slice(0, retIdx) : '';
        const exprText = cleanExpr(after);
        const hasValue = exprText.length > 0;
        const expected = String(ctx.expected);
        // Mark that a return was attempted regardless of validity, to avoid duplicate missing-return
        ctx.sawReturnAttempt = true;
        if (expected === 'void') {
          if (hasValue) {
            throw new CompileError(filePath, lineNo, 1, `Return type mismatch: function '${ctx.name}' expects void`);
          }
        } else {
          if (!hasValue) {
            throw new CompileError(filePath, lineNo, 1, `Return type mismatch: function '${ctx.name}' expects ${expected}`);
          }
          const accessibleVars = scopeManager.getAllAccessibleVariables();
          // Merge inline let/const declarations that occur before return on the same line
          try {
            const declRx = /(^|[;{])\s*(let|const)\s+([A-Za-z_$][\w$]*)\s*(?:::\s*([A-Za-z_$<>\[\]]+))?\s*=\s*([^;]*)/g;
            let dm: RegExpExecArray | null;
            while ((dm = declRx.exec(before)) !== null) {
              const vname = dm[3];
              const vtypeRaw = (dm[4] || '').trim();
              let vtype: SimpleType = null;
              if (vtypeRaw) vtype = vtypeRaw.endsWith('[]') ? 'arr' : (vtypeRaw as SimpleType);
              accessibleVars.set(vname, {
                name: vname,
                declaredKind: dm[2] as 'let' | 'const',
                declaredType: vtype,
                mutable: (dm[2] === 'let'),
                declaredLine: lineNo
              });
            }
          } catch {}
          const inferred = inferTypeFromExpr(exprText, accessibleVars, interfaces);
          if (interfaces.has(expected) && exprText.trim().startsWith("{")) {
            const iface = interfaces.get(expected)!;
            const req = (iface.requiredKeys && iface.requiredKeys.length > 0)
              ? iface.requiredKeys
              : Object.keys(iface.fields).filter(k => !iface.optionalFields?.has(k));
            if (!objectLiteralHasKeys(exprText, req)) {
              throw new CompileError(filePath, lineNo, 1, `Return type mismatch: function '${ctx.name}' expects ${expected} (missing required: ${req.join(", ")})`);
            }
            validateObjectFieldTypes(exprText, iface, accessibleVars, lineNo, ctx.name);
          } else if (!matchesSimple(expected, inferred, exprText)) {
            throw new CompileError(filePath, lineNo, 1, `Return type mismatch: function '${ctx.name}' expects ${expected}`);
          }
          ctx.hasValueReturn = true;
        }
      }
    }

    // Detectar funciones y manejar parámetros en scope
    const funcHeader = L.match(/^\s*(func|function)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/);
    if (funcHeader) {
      const [, funcType, fname, paramsRaw] = funcHeader;
      const params = paramsRaw.trim().length === 0 ? [] : paramsRaw.split(",").map(p => p.trim()).filter(Boolean);
      
      // Registrar parámetros en el scope de la función
      for (const param of params) {
        const paramNoDefault = param.replace(/=.*/, '').trim();
        const paramName = paramNoDefault.split('::')[0].trim();
        const paramType = paramNoDefault.includes('::') ? paramNoDefault.split('::')[1].replace(/=.*/, '').trim() as SimpleType : null;
        
        scopeManager.addVariable(paramName, {
          name: paramName,
          declaredKind: "let",
          declaredType: paramType,
          mutable: true,
          declaredLine: lineNo
        });
      }
    }

    // Registrar parámetros también para métodos de clase
    if (!funcHeader && (classMethodWithBrace || classMethodNoBrace)) {
      const methodMatch = L.match(/^\s*(?:async\s+)?(?:static\s+)?(?:(?:get|set)\s+)?(?:constructor|[A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:\{)?$/);
      const paramsRaw = methodMatch ? methodMatch[1] : "";
      const params = paramsRaw.trim().length === 0 ? [] : paramsRaw.split(",").map(p => p.trim()).filter(Boolean);
      for (const param of params) {
        const paramNoDefault = param.replace(/=.*/, '').trim();
        const paramName = paramNoDefault.split('::')[0].trim();
        const paramType = paramNoDefault.includes('::') ? paramNoDefault.split('::')[1].replace(/=.*/, '').trim() as SimpleType : null;
        scopeManager.addVariable(paramName, {
          name: paramName,
          declaredKind: "let",
          declaredType: paramType,
          mutable: true,
          declaredLine: lineNo
        });
      }
    }

    // variable declaration with optional ::type 
    const varDecl = L.match(/^\s*(let|const)\s+([A-Za-z_$][\w$]*)\s*(?:::([A-Za-z_$<>\[\]]+))?\s*=\s*(.*)$/);
    if (varDecl) {
      const [, kind, name, typeRaw, exprStart] = varDecl;
      
      // VERIFICACIÓN CON SCOPE: Solo verificar en el scope actual
      let upgradingImplicit = false;
      if (scopeManager.hasInCurrentScope(name)) {
        const cur = scopeManager.getCurrentScope().variables.get(name);
        if (cur && cur.implicit) {
          upgradingImplicit = true;
        } else {
          throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, `Redeclaration of variable '${name}' in the same scope`);
        }
      }
      
      let declaredType: SimpleType = null;
      if (typeRaw) {
        if (typeRaw.endsWith('[]')) {
          declaredType = 'arr';
        } else {
          declaredType = typeRaw as SimpleType;
        }
      }
      
      // Reconstruir la expresión completa si es un objeto multilínea
      let expr = exprStart;
      let localBraceCount = (exprStart.match(/{/g) || []).length - (exprStart.match(/}/g) || []).length;
      let currentIdx = idx;
      
      // Si hay llaves sin cerrar, buscar en las líneas siguientes
      while (localBraceCount > 0 && currentIdx < origLines.length - 1) {
        currentIdx++;
        const nextLine = origLines[currentIdx];
        expr += " " + nextLine.trim();
        localBraceCount += (nextLine.match(/{/g) || []).length - (nextLine.match(/}/g) || []).length;
        
        // Si encontramos el final, salir
        if (localBraceCount <= 0) {
          break;
        }
      }
      
      // Limpiar la expresión
      expr = cleanExpr(expr);
      
      // Type checking at declaration - USANDO VARIABLES ACCESIBLES
      const accessibleVars = scopeManager.getAllAccessibleVariables();
      
      if (expr !== undefined && declaredType) {
        
        // CORRECCIÓN MEJORADA: Inferir tipo preciso para arrays literales CON INTERFACES
        let rhsType: SimpleType = null;
        if (expr.trim().startsWith("[")) {
          const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
          const { allSame, type } = allElementsSameType(elementTypes);
          if (allSame && type) {
            // Si todos los elementos son del mismo tipo, inferir arr<T>
            rhsType = `arr<${type}>`;
          } else {
            // Si hay mixed types, inferir arr
            rhsType = "arr";
          }
        } else {
          rhsType = analyzeExprType(expr, accessibleVars) ?? (accessibleVars.get(expr)?.declaredType ?? null);
        }
        
        // CORRECCIÓN IMPORTANTE: Si rhsType es null (como en llamadas a funciones), confiar en el tipo declarado
        if (rhsType === null) {
          // No podemos inferir el tipo (probablemente es una llamada a función), confiamos en la anotación del usuario
          rhsType = declaredType;
        }
        
        // Validación especial para arrays tipados - CORREGIDA CON INTERFACES
        const declaredArrayType = extractArrayType(String(declaredType));
        const rhsArrayType = extractArrayType(String(rhsType));
        
        if (declaredArrayType.baseType === "arr" && rhsArrayType.baseType === "arr") {
          // Ambos son arrays, verificar tipos internos
          if (declaredArrayType.innerType && rhsArrayType.innerType) {
            // arr<T> = arr<U> - deben ser el mismo tipo
            if (declaredArrayType.innerType !== rhsArrayType.innerType) {
              // CORRECCIÓN: Permitir que obj sea compatible con interfaces
              if (!(declaredArrayType.innerType === "obj" && interfaces.has(String(rhsArrayType.innerType)))) {
                throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                  `Type error: cannot assign arr<${rhsArrayType.innerType}> to arr<${declaredArrayType.innerType}> '${name}'`);
              }
            }
          } else if (declaredArrayType.innerType && !rhsArrayType.innerType) {
            // arr<T> = arr (unknown inner)
            if (expr.trim().startsWith("[")) {
              const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
              let hasIncompatibleElement = false;
              
              for (const elementType of elementTypes) {
                // CORRECCIÓN: Si el array espera obj, permitir elementos que sean interfaces
                if (elementType && declaredArrayType.innerType === "obj" && interfaces.has(String(elementType))) {
                  // Permitido: elemento de tipo interfaz en array de obj
                  continue;
                } else if (elementType && elementType !== declaredArrayType.innerType) {
                  hasIncompatibleElement = true;
                  break;
                }
              }
              
              if (hasIncompatibleElement) {
                throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                  `Type error: cannot assign mixed array to typed array arr<${declaredArrayType.innerType}> '${name}'`);
              }
            } else {
              // Non-literal array with unknown inner type: accept (runtime value)
              // No static element check possible
            }
          }
          // arr = arr<T> o arr = arr están permitidos
        } else if (declaredType !== rhsType && !(interfaces.has(String(declaredType)) && rhsType === "obj")) {
          // STRICT TYPE CHECKING: No automatic conversion between primitive types
          // Pero permitir interfaces
          throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
            `Type error: cannot assign ${rhsType} to ${declaredType} '${name}'`);
        }
        
        // Validación de elementos en arrays literales para arrays tipados - CORREGIDA CON INTERFACES
        if (declaredArrayType.baseType === "arr" && declaredArrayType.innerType && expr.trim().startsWith("[")) {
          const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
          for (let i = 0; i < elementTypes.length; i++) {
            const elementType = elementTypes[i];
            // Si el elemento es una variable, verificar su tipo declarado
            if (elementType) {
              const elementVarType = accessibleVars.get(expr)?.declaredType;
              // CORRECCIÓN: Permitir que interfaces sean tratadas como obj en arrays de obj
              if (elementVarType && elementVarType !== declaredArrayType.innerType) {
                if (!(declaredArrayType.innerType === "obj" && interfaces.has(String(elementVarType)))) {
                  throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                    `Type error: array element type ${elementVarType} does not match array type arr<${declaredArrayType.innerType}>`);
                }
              } else if (!elementVarType && elementType !== declaredArrayType.innerType) {
                if (!(declaredArrayType.innerType === "obj" && interfaces.has(String(elementType)))) {
                  throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                    `Type error: array element type ${elementType} does not match array type arr<${declaredArrayType.innerType}>`);
                }
              }
            }
          }
        }
        
        if (declaredType && interfaces.has(String(declaredType)) && expr.trim().startsWith("{")) {
          const iface = interfaces.get(String(declaredType))!;
          {
            const requiredKeys = (iface.requiredKeys && iface.requiredKeys.length > 0)
              ? iface.requiredKeys
              : Object.keys(iface.fields).filter(k => !iface.optionalFields?.has(k));
            if (!objectLiteralHasKeys(expr, requiredKeys)) {
              throw new CompileError(filePath, lineNo, 1,
                `Interface error: object assigned to '${name}' does not satisfy interface '${declaredType}'. Required fields: ${requiredKeys.join(", ")}`);
            }
          }
          // Per-field validation for present properties
          validateObjectFieldTypes(expr, iface, accessibleVars, lineNo, name)
        }
      }
      
      // AGREGAR VARIABLE AL SCOPE ACTUAL (o actualizar si era implícita)
      if (upgradingImplicit) {
        const cur = scopeManager.getCurrentScope().variables.get(name)!;
        cur.declaredKind = (kind as "let" | "const");
        cur.declaredType = declaredType ?? cur.declaredType;
        cur.mutable = kind === "let";
        cur.implicit = false;
      } else {
        scopeManager.addVariable(name, { 
          name, 
          declaredKind: (kind as "let" | "const"), 
          declaredType, 
          mutable: kind === "let", 
          declaredLine: lineNo,
          implicit: false
        });
      }
      
      // Para objetos multilínea, necesitamos reconstruir la línea de salida
      let outputLine = L;
      if (upgradingImplicit) {
        // Evitar segunda declaración; convertir a asignación simple
        outputLine = `${name} = ${expr};`;
      }
      if (currentIdx > idx) {
        // Juntar todas las líneas del objeto
        outputLine = origLines.slice(idx, currentIdx + 1).join("\n");
      }
      
      outputLine = outputLine.replace(/::[A-Za-z_$<>\[\]]+/g, "");
      outputLine = outputLine.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
      outLines.push(outputLine);
      
      // Si procesamos múltiples líneas, saltar las que ya procesamos
      if (currentIdx > idx) {
        idx = currentIdx;
      }
      continue;
    }

    // mut name = expr;
    const mutMatch = L.match(/^\s*mut\s+([A-Za-z_$][\w$]*)\s*=\s*(.+);?\s*$/);
    if (mutMatch) {
      const [, name, exprRaw] = mutMatch;
      const expr = cleanExpr(exprRaw);
      const accessibleVars = scopeManager.getAllAccessibleVariables();
      
      // BUSCAR VARIABLE EN TODOS LOS SCOPES ACCESIBLES
      const existingVar = scopeManager.findVariable(name);
      
      if (!existingVar) {
        // CORRECCIÓN MEJORADA: Inferir tipo preciso para arrays literales CON INTERFACES
        let inferredType: SimpleType = null;
        if (expr.trim().startsWith("[")) {
          const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
          const { allSame, type } = allElementsSameType(elementTypes);
          if (allSame && type) {
            inferredType = `arr<${type}>`;
          } else {
            inferredType = "arr";
          }
        } else {
          inferredType = analyzeExprType(expr, accessibleVars);
        }
        
        // CORRECCIÓN: Si no podemos inferir el tipo, usar null (será any en JS)
        if (inferredType === null) {
          inferredType = null;
        }
        
        scopeManager.addVariable(name, { 
          name, 
          declaredKind: "let", 
          declaredType: inferredType, 
          mutable: true, 
          declaredLine: lineNo,
          implicit: true
        });
        let outputLine = `${name} = ${expr};`;
        outputLine = outputLine.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
        emit(outputLine, lineNo);
      } else {
        // VERIFICACIÓN CORREGIDA: Solo verificar inmut si la línea actual es después de la línea de inmut
        if (existingVar.inmutedAtLine !== undefined && lineNo > existingVar.inmutedAtLine) {
          throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
            `cannot reassign ${name} after inmut at line ${existingVar.inmutedAtLine}`);
        }
        existingVar.mutable = true;
        
        // CORRECCIÓN MEJORADA: Inferir tipo preciso para arrays literales CON INTERFACES
        let rhsType: SimpleType = null;
        if (expr.trim().startsWith("[")) {
          const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
          const { allSame, type } = allElementsSameType(elementTypes);
          if (allSame && type) {
            rhsType = `arr<${type}>`;
          } else {
            rhsType = "arr";
          }
        } else {
          rhsType = inferTypeFromExpr(expr, accessibleVars, interfaces) ?? (accessibleVars.get(expr)?.declaredType ?? null);
        }
        
        // CORRECCIÓN: Si rhsType es null (como en llamadas a funciones), no fallar la validación
        if (rhsType === null) {
          // No podemos inferir el tipo, confiamos en que el usuario sabe lo que hace
          rhsType = existingVar.declaredType;
        }
        
        // Validación especial para arrays tipados - CORREGIDA CON INTERFACES
        const declaredArrayType = extractArrayType(String(existingVar.declaredType));
        const rhsArrayType = extractArrayType(String(rhsType));
        
        if (declaredArrayType.baseType === "arr" && rhsArrayType.baseType === "arr") {
          // Ambos son arrays, verificar tipos internos
          if (declaredArrayType.innerType && rhsArrayType.innerType) {
            // arr<T> = arr<U> - deben ser el mismo tipo
            if (declaredArrayType.innerType !== rhsArrayType.innerType) {
              // CORRECCIÓN: Permitir que obj sea compatible con interfaces
              if (!(declaredArrayType.innerType === "obj" && interfaces.has(String(rhsArrayType.innerType)))) {
                throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                  `Type error: cannot assign arr<${rhsArrayType.innerType}> to arr<${declaredArrayType.innerType}> '${name}'`);
              }
            }
          } else if (declaredArrayType.innerType && !rhsArrayType.innerType) {
            // arr<T> = arr (mixed) - verificar si los elementos son compatibles
            if (expr.trim().startsWith("[")) {
              const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
              let hasIncompatibleElement = false;
              
              for (const elementType of elementTypes) {
                // CORRECCIÓN: Si el array espera obj, permitir elementos que sean interfaces
                if (elementType && declaredArrayType.innerType === "obj" && interfaces.has(String(elementType))) {
                  // Permitido: elemento de tipo interfaz en array de obj
                  continue;
                } else if (elementType && elementType !== declaredArrayType.innerType) {
                  hasIncompatibleElement = true;
                  break;
                }
              }
              
              if (hasIncompatibleElement) {
                throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                  `Type error: cannot assign mixed array to typed array arr<${declaredArrayType.innerType}> '${name}'`);
              }
            } else {
              throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                `Type error: cannot assign mixed array to typed array arr<${declaredArrayType.innerType}> '${name}'`);
            }
          }
          // arr = arr<T> o arr = arr están permitidos
        } else if (existingVar.declaredType && rhsType && existingVar.declaredType !== rhsType && 
                  !(interfaces.has(String(existingVar.declaredType)) && rhsType === "obj")) {
          throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
            `Type error: cannot assign ${rhsType} to ${existingVar.declaredType} '${name}'`);
        }
        
        // Validación de elementos en arrays literales para arrays tipados - CORREGIDA CON INTERFACES
        if (declaredArrayType.baseType === "arr" && declaredArrayType.innerType && expr.trim().startsWith("[")) {
          const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
          for (let i = 0; i < elementTypes.length; i++) {
            const elementType = elementTypes[i];
            // Si el elemento es una variable, verificar su tipo declarado
            if (elementType) {
              const elementVarType = accessibleVars.get(expr)?.declaredType;
              // CORRECCIÓN: Permitir que interfaces sean tratadas como obj en arrays de obj
              if (elementVarType && elementVarType !== declaredArrayType.innerType) {
                if (!(declaredArrayType.innerType === "obj" && interfaces.has(String(elementVarType)))) {
                  throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                    `Type error: array element type ${elementVarType} does not match array type arr<${declaredArrayType.innerType}>`);
                }
              } else if (!elementVarType && elementType !== declaredArrayType.innerType) {
                if (!(declaredArrayType.innerType === "obj" && interfaces.has(String(elementType)))) {
                  throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                    `Type error: array element type ${elementType} does not match array type arr<${declaredArrayType.innerType}>`);
                }
              }
            }
          }
        }
        
        let outputLine = `${name} = ${expr};`;
        outputLine = outputLine.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
        outLines.push(outputLine);
      }
      continue;
    }

    // inmut name or inmut name = expr - CORRECCIÓN MEJORADA PARA COMENTARIOS
    const inmutMatch = L.match(/^\s*inmut\s+([A-Za-z_$][\w$]*)(?:\s*=\s*(.+))?;?\s*(\/\/.*)?$/);
    if (inmutMatch) {
      const [, name, exprRaw] = inmutMatch;
      
      // BUSCAR VARIABLE EN TODOS LOS SCOPES ACCESIBLES
      const existingVar = scopeManager.findVariable(name);
      if (!existingVar) {
        throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, `inmut on undeclared variable '${name}'`);
      }
      
      const accessibleVars = scopeManager.getAllAccessibleVariables();
      
      // Si hay una expresión, es una asignación con inmut
      if (exprRaw !== undefined) {
        const expr = cleanExpr(exprRaw);
        
        // Validación de tipos (igual que en mut)
        let rhsType: SimpleType = null;
        if (expr.trim().startsWith("[")) {
          const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
          const { allSame, type } = allElementsSameType(elementTypes);
          if (allSame && type) {
            rhsType = `arr<${type}>`;
          } else {
            rhsType = "arr";
          }
        } else {
          rhsType = inferTypeFromExpr(expr, accessibleVars, interfaces) ?? (accessibleVars.get(expr)?.declaredType ?? null);
        }
        
        // CORRECCIÓN: Si rhsType es null, confiar en el tipo declarado
        if (rhsType === null) {
          rhsType = existingVar.declaredType;
        }
        
        // Validación de tipos
        if (existingVar.declaredType && rhsType && existingVar.declaredType !== rhsType && 
            !(interfaces.has(String(existingVar.declaredType)) && rhsType === "obj")) {
          throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
            `Type error: cannot assign ${rhsType} to ${existingVar.declaredType} '${name}'`);
        }
        
        // Marcar como inmutable y emitir la asignación
        existingVar.inmutedAtLine = lineNo;
        existingVar.mutable = false;
        let outputLine = `${name} = ${expr};`;
        outputLine = outputLine.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
        outLines.push(outputLine);
      } else {
        // Solo inmut sin asignación - marcar como inmutable a partir de ahora
        existingVar.inmutedAtLine = lineNo;
        existingVar.mutable = false;
        
        // Extraer el comentario si existe (es el cuarto elemento del match)
        const comment = inmutMatch[3];
        let outputLine = `/* inmut ${name} */`;
        if (comment) {
          outputLine += ` ${comment}`; // Preservar el comentario original
        }
        outLines.push(outputLine);
      }
      continue;
    }

    // assignment name = expr;
    const assignMatch = L.match(/^\s*([A-Za-z_$][\w$]*)\s*=\s*(.+);?\s*$/);
    if (assignMatch) {
      const [, name, exprRaw] = assignMatch;
      const expr = cleanExpr(exprRaw);
      const accessibleVars = scopeManager.getAllAccessibleVariables();
      
      // BUSCAR VARIABLE EN TODOS LOS SCOPES ACCESIBLES
      const existingVar = scopeManager.findVariable(name);
      
      if (!existingVar) {
        // CORRECCIÓN MEJORADA: Inferir tipo preciso para arrays literales CON INTERFACES
        let inferred: SimpleType = null;
        if (expr.trim().startsWith("[")) {
          const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
          const { allSame, type } = allElementsSameType(elementTypes);
          if (allSame && type) {
            inferred = `arr<${type}>`;
          } else {
            inferred = "arr";
          }
        } else {
          inferred = analyzeExprType(expr, accessibleVars);
        }
        
        scopeManager.addVariable(name, { 
          name, 
          declaredKind: "let", 
          declaredType: inferred, 
          mutable: true, 
          declaredLine: lineNo,
          implicit: true
        });
        let outputLine = `${name} = ${expr};`;
        outputLine = outputLine.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
        outLines.push(outputLine);
        continue;
      }
      
      if (existingVar.declaredKind === "const") {
        throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, `cannot reassign const ${name}`);
      }
      
      // VERIFICACIÓN CORREGIDA: Solo verificar inmut si la línea actual es después de la línea de inmut
      if (existingVar.inmutedAtLine !== undefined && lineNo > existingVar.inmutedAtLine) {
        throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
          `cannot reassign ${name} after inmut at line ${existingVar.inmutedAtLine}`);
      }
      
      // CORRECCIÓN MEJORADA: Inferir tipo preciso para arrays literales CON INTERFACES
      let rhsType: SimpleType = null;
      if (expr.trim().startsWith("[")) {
        const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
        const { allSame, type } = allElementsSameType(elementTypes);
        if (allSame && type) {
          rhsType = `arr<${type}>`;
        } else {
          rhsType = "arr";
        }
      } else {
        rhsType = analyzeExprType(expr, accessibleVars) ?? (accessibleVars.get(expr)?.declaredType ?? null);
      }
      
      // CORRECCIÓN: Si rhsType es null, confiar en el tipo declarado existente
      if (rhsType === null) {
        rhsType = existingVar.declaredType;
      }
      
      // Validación especial para arrays tipados - CORREGIDA CON INTERFACES
      const declaredArrayType = extractArrayType(String(existingVar.declaredType));
      const rhsArrayType = extractArrayType(String(rhsType));
      
      if (declaredArrayType.baseType === "arr" && rhsArrayType.baseType === "arr") {
        // Ambos son arrays, verificar tipos internos
        if (declaredArrayType.innerType && rhsArrayType.innerType) {
          // arr<T> = arr<U> - deben ser el mismo tipo
          if (declaredArrayType.innerType !== rhsArrayType.innerType) {
            // CORRECCIÓN: Permitir que obj sea compatible con interfaces
            if (!(declaredArrayType.innerType === "obj" && interfaces.has(String(rhsArrayType.innerType)))) {
              throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                `Type error: cannot assign arr<${rhsArrayType.innerType}> to arr<${declaredArrayType.innerType}> '${name}'`);
            }
          }
        } else if (declaredArrayType.innerType && !rhsArrayType.innerType) {
          // arr<T> = arr (mixed) - verificar si los elementos son compatibles
          if (expr.trim().startsWith("[")) {
            const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
            let hasIncompatibleElement = false;
            
            for (const elementType of elementTypes) {
              // CORRECCIÓN: Si el array espera obj, permitir elementos que sean interfaces
              if (elementType && declaredArrayType.innerType === "obj" && interfaces.has(String(elementType))) {
                // Permitido: elemento de tipo interfaz en array de obj
                continue;
              } else if (elementType && elementType !== declaredArrayType.innerType) {
                hasIncompatibleElement = true;
                break;
              }
            }
            
            if (hasIncompatibleElement) {
              throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                `Type error: cannot assign mixed array to typed array arr<${declaredArrayType.innerType}> '${name}'`);
            }
          } else {
            throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
              `Type error: cannot assign mixed array to typed array arr<${declaredArrayType.innerType}> '${name}'`);
          }
        }
        // arr = arr<T> o arr = arr están permitidos
      } else if (existingVar.declaredType && rhsType && existingVar.declaredType !== rhsType && 
                !(interfaces.has(String(existingVar.declaredType)) && rhsType === "obj")) {
        throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
          `Type error: cannot assign ${rhsType} to ${existingVar.declaredType} '${name}'`);
      }
      
      // Validación de elementos en arrays literales para arrays tipados - CORREGIDA CON INTERFACES
      if (declaredArrayType.baseType === "arr" && declaredArrayType.innerType && expr.trim().startsWith("[")) {
        const elementTypes = inferArrayElementTypes(expr, accessibleVars, interfaces);
        for (let i = 0; i < elementTypes.length; i++) {
          const elementType = elementTypes[i];
          // Si el elemento es una variable, verificar su tipo declarado
          if (elementType) {
            const elementVarType = accessibleVars.get(expr)?.declaredType;
            // CORRECCIÓN: Permitir que interfaces sean tratadas como obj en arrays de obj
            if (elementVarType && elementVarType !== declaredArrayType.innerType) {
              if (!(declaredArrayType.innerType === "obj" && interfaces.has(String(elementVarType)))) {
                throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                  `Type error: array element type ${elementVarType} does not match array type arr<${declaredArrayType.innerType}>`);
              }
            } else if (!elementVarType && elementType !== declaredArrayType.innerType) {
              if (!(declaredArrayType.innerType === "obj" && interfaces.has(String(elementType)))) {
                throw new CompileError(filePath, lineNo, L.indexOf(name) + 1, 
                  `Type error: array element type ${elementType} does not match array type arr<${declaredArrayType.innerType}>`);
              }
            }
          }
        }
      }
      
      // Interface validation for object literals
      if (existingVar.declaredType && interfaces.has(String(existingVar.declaredType)) && expr.trim().startsWith("{")) {
        const iface = interfaces.get(String(existingVar.declaredType))!;
        {
          const requiredKeys = (iface.requiredKeys && iface.requiredKeys.length > 0)
            ? iface.requiredKeys
            : Object.keys(iface.fields).filter(k => !iface.optionalFields?.has(k));
          if (!objectLiteralHasKeys(expr, requiredKeys)) {
            throw new CompileError(filePath, lineNo, 1,
              `Interface error: assignment to '${name}' does not satisfy interface '${existingVar.declaredType}'. Required fields: ${requiredKeys.join(", ")}`);
          }
        }
        // Per-field validation disabled for now (stability)
      }
      
      if (!existingVar.declaredType && rhsType) existingVar.declaredType = rhsType;
      let outputLine = `${name} = ${expr};`;
      outputLine = outputLine.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
      emit(outputLine, lineNo);
      continue;
    }

    // call F(...) - verificación en tiempo de compilación (permitir comentario al final)
    const callMatch = L.match(/^\s*call\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*;?\s*(\/\/.*)?$/);
    if (callMatch) {
      const [, fname, argsRaw, trailingComment] = callMatch;
      if (!funcs.has(fname)) {
        throw new CompileError(filePath, lineNo, L.indexOf(fname) + 1, `call error: function '${fname}' not found`);
      }
      if (calledViaCall.has(fname)) {
        const prev = calledViaCall.get(fname)!;
        throw new CompileError(filePath, lineNo, L.indexOf(fname) + 1, 
          `call error: function '${fname}' already called by 'call' at line ${prev}`);
      }
      calledViaCall.set(fname, lineNo);
      let args = argsRaw.trim();
      args = args.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
      if (args.length) emit(`${fname}(${args});${trailingComment ? ` ${trailingComment}` : ''}`, lineNo);
      else emit(`${fname}();${trailingComment ? ` ${trailingComment}` : ''}`, lineNo);
      continue;
    }

    // normal invocation F(...) - check if function was previously 'call'-ed (permitir comentario al final)
    const normalCall = L.match(/^\s*([A-Za-z_$][\w$]*)\s*\((.*)\)\s*;?\s*(\/\/.*)?$/);
    if (normalCall) {
      const [, fname, argsRaw, trailingComment] = normalCall;
      if (calledViaCall.has(fname)) {
        const prev = calledViaCall.get(fname)!;
        throw new CompileError(filePath, lineNo, L.indexOf(fname) + 1, 
          `call error: function '${fname}' was marked call-once at line ${prev} and cannot be called again`);
      }
      if (funcs.has(fname)) {
        const finfo = funcs.get(fname)!;
        let argsList = argsRaw.trim().length ? argsRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
        argsList = argsList.map(arg => arg.replace(/\bmaybe\b/g, "(Math.random() < 0.5)"));
        if (argsList.length !== finfo.params.length) {
          throw new CompileError(filePath, lineNo, L.indexOf(fname) + 1, 
            `Call error: function '${fname}' expects ${finfo.params.length} args but got ${argsList.length}`);
        }
        
        // USAR VARIABLES ACCESIBLES PARA LA INFERENCIA DE TIPOS
        const accessibleVars = scopeManager.getAllAccessibleVariables();
        
        for (let k = 0; k < argsList.length; k++) {
          const pinfo = finfo.params[k];
          const arg = argsList[k];
          let argType = inferTypeFromExpr(arg, accessibleVars, interfaces) ?? (accessibleVars.get(arg)?.declaredType ?? null);
          
          // CORRECCIÓN IMPORTANTE: Si el tipo del argumento es null (desconocido), usar el tipo de la variable si existe
          if (argType === null && accessibleVars.has(arg)) {
            const varInfo = accessibleVars.get(arg)!;
            if (varInfo.declaredType) {
              argType = varInfo.declaredType;
            }
          }
          
          // if pinfo.type is custom interface, check
          if (pinfo.type && interfaces.has(String(pinfo.type))) {
            if (arg.trim().startsWith("{")) {
              // object literal -> check required keys
              const iface = interfaces.get(String(pinfo.type))!;
              if (!objectLiteralHasKeys(arg, Object.keys(iface.fields))) {
                throw new CompileError(filePath, lineNo, 1, 
                  `Type error: argument ${k+1} of '${fname}' does not satisfy interface '${pinfo.type}'. Required fields: ${Object.keys(iface.fields).join(", ")}`);
              }
            } else {
              // arg is variable -> must have declaredType matching interface
              const av = accessibleVars.get(arg);
              if (!av || (av.declaredType !== pinfo.type && !(interfaces.has(String(av.declaredType)) && pinfo.type === "obj"))) {
                throw new CompileError(filePath, lineNo, L.indexOf(arg) + 1, 
                  `Type error: argument ${k+1} of '${fname}' expects '${pinfo.type}' but got '${av?.declaredType ?? "unknown"}'`);
              }
            }
          } else if (pinfo.type && argType && pinfo.type !== argType) {
            // CORRECCIÓN: Permitir asignación de interfaces a obj
            if (!(pinfo.type === "obj" && interfaces.has(String(argType)))) {
              throw new CompileError(filePath, lineNo, L.indexOf(arg) + 1, 
                `Type error: argument ${k+1} of '${fname}' expects ${pinfo.type} but got ${argType}`);
            }
          }
        }
      }
      let outputLine = L.replace(/::[A-Za-z_$<>\[\]]+/g, "");
      outputLine = outputLine.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
      outLines.push(outputLine);
      continue;
    }

    // function header 'func Name(...)' -> register and emit as JS function header w/o type annotations
    const funcHeaderMatch = L.match(/^\s*func\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/);
    if (funcHeaderMatch) {
      const [, fname, paramsRaw] = funcHeaderMatch;
      if (!funcs.has(fname)) {
        const params = paramsRaw.trim().length === 0 ? [] : paramsRaw.split(",").map(p => p.trim()).filter(Boolean).map(p => {
          const noDefault = p.replace(/=.*/, '').trim();
          const parts = noDefault.split("::").map(s => s.trim());
          const name = parts[0].trim();
          const typeStr = parts[1] ? parts[1].replace(/=.*/, '').trim() : null;
          return { name, type: (typeStr as SimpleType) };
        });
        funcs.set(fname, { name: fname, params, declaredLine: lineNo });
      }
      // emit sanitized header: replace func -> function and strip ::types
      let clean = L.replace(/\bfunc\b/, "function").replace(/::[A-Za-z_$<>\[\]]+/g, "");
      clean = clean.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
      emit(clean, lineNo);
      continue;
    }

    // js function header already (defensive)
    const jsFuncHeaderMatch = L.match(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/);
    if (jsFuncHeaderMatch) {
      let outputLine = L.replace(/::[A-Za-z_$<>\[\]]+/g, "");
      outputLine = outputLine.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
      outLines.push(outputLine);
      continue;
    }

    // default: strip ::type remnants defensively and push
    let outputLine = L.replace(/::[A-Za-z_$<>\[\]]+/g, "");
    outputLine = outputLine.replace(/\bmaybe\b/g, "(Math.random() < 0.5)");
    outLines.push(outputLine);
    } catch (err: any) {
      if (err instanceof CompileError) {
        diagnostics.push({ line: err.line, column: err.column, message: err.message });
      } else {
        diagnostics.push({ line: lineNo, column: 1, message: String(err?.message || err) });
      }
      // continue with next line
    }
  }

  // --- 4) Interface shallow checks for variable declarations assigned the object literal at declaration time ---
  // detect patterns like: let x::Person = { ... };
  const typedObjRx = /\b(let|const)\s+([A-Za-z_$][\w$]*)::([A-Za-z_$][\w$]*)\s*=\s*({[\s\S]*?});/g;
  const isInBlockComment = (idx: number): boolean => {
    // naive scan for /* ... */ balance up to idx
    let i = 0, depth = 0;
    while (i < idx) {
      const ch = sourceCode[i];
      const nxt = sourceCode[i + 1];
      if (ch === '/' && nxt === '*') { depth++; i += 2; continue; }
      if (ch === '*' && nxt === '/' && depth > 0) { depth--; i += 2; continue; }
      i++;
    }
    return depth > 0;
  };
  let tom;
  while ((tom = typedObjRx.exec(sourceCode)) !== null) {
    const [, , varname, ifaceName, objLiteral] = tom;
    // skip if this match is on a line commented with //
    const lineStart = sourceCode.lastIndexOf('\n', tom.index) + 1;
    const prefix = sourceCode.slice(lineStart, tom.index);
    if (/^\s*\/\//.test(prefix)) continue;
    // skip if inside a block comment
    if (isInBlockComment(tom.index)) continue;
    if (interfaces.has(ifaceName)) {
      const iface = interfaces.get(ifaceName)!;
      const requiredKeys = (iface.requiredKeys && iface.requiredKeys.length > 0) ? iface.requiredKeys : Object.keys(iface.fields);
      if (!objectLiteralHasKeys(objLiteral, requiredKeys)) {
        const pre = sourceCode.slice(0, tom.index);
        const lineNo = pre.split("\n").length;
        throw new CompileError(filePath, lineNo, 1, `Interface error: object assigned to '${varname}' does not satisfy interface '${ifaceName}'. Required fields: ${requiredKeys.join(", ")}`);
      }
    }
  }

  // --- 5) Assemble and final cleanup (collapse double semicolons) ---
  let outCode = outLines.join("\n");
  outCode = outCode.replace(/;{2,}/g, ";"); // collapse ;; -> ;
  outCode = outCode.replace(/\r\n/g, "\n");

  // Normalizar mapping: para líneas sin mapping explícito, usar su propio número
  for (let i = 0; i < outLines.length; i++) {
    if (outLineToSourceLine[i] == null) {
      outLineToSourceLine[i] = i + 1;
    }
  }

  // Si ya hay diagnósticos, devolver sin intentar parsear el JS final para evitar errores redundantes
  if (diagnostics.length > 0) {
    return { code: outCode, diagnostics };
  }

  // final parse check
  try {
    acornParse(outCode, { ecmaVersion: "latest", sourceType: "module" });
  } catch (err: any) {
    // Retry parse after stripping comments to avoid false positives due to tricky comment content
    try {
      const noComments = outCode
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      acornParse(noComments, { ecmaVersion: "latest", sourceType: "module" });
      // If parsing succeeds without comments, accept the output as valid JS
      return { code: outCode, diagnostics };
    } catch {}
    const loc = err.loc ?? { line: 0, column: 0 };
    const jsLine = loc.line || 1;
    const srcLine = outLineToSourceLine[jsLine - 1] || jsLine;
    diagnostics.push({ line: srcLine, column: loc.column ?? 0, message: `Emitted JS Syntax error: ${err.message}` });
    return { code: outCode, diagnostics };
  }
  return { code: outCode, diagnostics };
}

/* File helper */
export function transpileFile(inPath: string, outPath: string) {
  const src = fs.readFileSync(inPath, "utf8");
  try {
    const res = transpileSpark(src, inPath);
    let code = '';
    let diags: Array<{ line: number; column: number; message: string }> = [];
    if (typeof res === 'string') {
      code = res;
    } else {
      code = String(res.code || '');
      diags = Array.isArray(res.diagnostics) ? res.diagnostics : [];
    }
    if (diags.length > 0) {
      console.error(c ? c.error(`✖ Compile errors`) + ' ' + chalk.bold(inPath) : `Errors in ${inPath}`);
      for (const d of diags) {
        console.error(c ? `  ${chalk.bold(String(d.line))}:${chalk.yellow(String(d.column))} ${chalk.white(d.message)}` : `  ${d.line}:${d.column} ${d.message}`);
      }
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, code, "utf8");
    console.log(c ? c.success(`✔ Compiled`) + ' ' + chalk.bold(inPath) + ' ' + c.gray('→') + ' ' + chalk.bold(outPath) : `Compiled ${inPath} -> ${outPath}`);
  } catch (err: any) {
    if (err instanceof CompileError) {
      console.error(c ? c.error(`✖ Compile error`) + ' ' + chalk.bold(err.file) + ':' + chalk.yellow(String(err.line)) + ':' + chalk.yellow(String(err.column)) + ' ' + chalk.white(err.message) : `Error: ${err.message}`);
    } else {
      console.error(c ? c.error(`✖ Compile error`) + ' ' + chalk.bold(inPath) + ' ' + chalk.white(err.message || String(err)) : `Error: ${err}`);
    }
  }
}

// Minimal JS syntax highlighter for frames (strings, numbers, keywords)
function highlightJs(line: string): string {
  let s = line
    .replace(/(\/\/.*$)/, (_m, g1) => chalk.gray(g1))
    .replace(/(['"][^'"\\]*(?:\\.[^'"\\]*)*['"])/g, (_m) => chalk.green(_m))
    .replace(/\b(\d+(?:\.\d+)?)\b/g, (_m) => chalk.yellow(_m))
    .replace(/\b(function|return|if|else|for|while|try|catch|finally|class|let|const|var|new|throw)\b/g, (_m) => chalk.cyanBright(_m));
  return s;
}