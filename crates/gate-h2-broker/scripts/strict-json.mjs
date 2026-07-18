export function parseStrictJson(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error("JSON BOM forbidden");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let index = 0;
  const ws = () => { while (/[\t\n\r ]/.test(source[index] ?? "")) index += 1; };
  const string = () => {
    const start = index++;
    let escaped = false;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (!escaped && code === 0x22) {
        index += 1;
        return JSON.parse(source.slice(start, index));
      }
      if (!escaped && code < 0x20) throw new Error("unescaped JSON control");
      escaped = !escaped && code === 0x5c;
      index += 1;
    }
    throw new Error("unterminated JSON string");
  };
  const value = () => {
    ws();
    if (source[index] === "{") {
      index += 1; const output = Object.create(null); const keys = new Set(); ws();
      if (source[index] === "}") { index += 1; return output; }
      while (true) {
        ws(); if (source[index] !== '"') throw new Error("JSON object key required");
        const key = string(); if (keys.has(key)) throw new Error(`duplicate JSON field: ${key}`); keys.add(key);
        ws(); if (source[index++] !== ":") throw new Error("JSON colon required"); output[key] = value(); ws();
        const delimiter = source[index++]; if (delimiter === "}") return output; if (delimiter !== ",") throw new Error("JSON object delimiter required");
      }
    }
    if (source[index] === "[") {
      index += 1; const output = []; ws(); if (source[index] === "]") { index += 1; return output; }
      while (true) { output.push(value()); ws(); const delimiter = source[index++]; if (delimiter === "]") return output; if (delimiter !== ",") throw new Error("JSON array delimiter required"); }
    }
    if (source[index] === '"') return string();
    for (const [token, output] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(token, index)) { index += token.length; return output; }
    }
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(source.slice(index));
    if (!match) throw new Error("invalid JSON token");
    if (/[.eE]/.test(source[index + match[0].length] ?? "")) throw new Error("non-integer JSON number");
    index += match[0].length; const output = Number(match[0]);
    if (!Number.isSafeInteger(output) || Object.is(output, -0)) throw new Error("unsafe JSON integer");
    return output;
  };
  const output = value(); ws(); if (index !== source.length) throw new Error("trailing JSON content"); return output;
}

export function exactFields(value, fields, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} fields differ: ${actual.join(",")}`);
}
