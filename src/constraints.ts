import Ajv from "ajv/dist/2020";
import { validateValue, type Value, type PropertyDefinition } from "./domain";
export function validateSchemaDefinition(schema: unknown): string[] {
  const errors: string[] = [];
  let nodes = 0;
  function walk(v: any, path: string, depth: number) {
    if (++nodes > 2000 || depth > 24) {
      errors.push(path + ": スキーマ上限");
      return;
    }
    if (!v || typeof v !== "object") return;
    for (const [key, val] of Object.entries(v)) {
      if (key === "$ref" && typeof val === "string" && !val.startsWith("#/"))
        errors.push(path + ": 外部参照は未対応");
      if (["pattern", "patternProperties"].includes(key))
        errors.push(path + ": 正規表現制約は未対応");
      walk(val, path + "." + key, depth + 1);
    }
  }
  walk(schema, "schema", 0);
  return errors;
}
export function validateProperty(
  value: Value,
  definition: PropertyDefinition,
): string[] {
  const errors = validateValue(value);
  if (definition.valueKind && !definition.valueKind.includes(value.kind))
    errors.push("value.kind: 許可されない型");
  if (definition.valueSchema) {
    errors.push(...validateSchemaDefinition(definition.valueSchema));
    if (!errors.length) {
      try {
        const ajv = new Ajv({
          strict: false,
          validateFormats: false,
          allErrors: true,
        });
        if (!ajv.validate(definition.valueSchema, value))
          errors.push(
            ...(ajv.errors || []).map(
              (e) => "value" + e.instancePath + ": " + e.message,
            ),
          );
      } catch {
        errors.push("valueSchema: スキーマが不正");
      }
    }
  }
  return errors;
}
