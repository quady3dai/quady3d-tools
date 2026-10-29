import * as z from "zod/v4";

const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/);
const choices = z.array(scalar).min(1).max(16);
function fields<S extends z.ZodType>(schema: S) {
  return z.record(name, schema).refine(value => Object.keys(value).length <= 32);
}
const field = z.strictObject({
  type: z.enum(["string", "integer", "number", "boolean"]),
  title: z.string().min(1).max(120), description: z.string().max(1000).optional(),
  default: scalar.optional(), enum: choices.optional(),
  minimum: z.number().finite().optional(), maximum: z.number().finite().optional(),
  maxLength: z.number().int().min(0).max(1000).optional(),
  "x-enum-labels": z.array(z.string().max(120)).max(16).optional(),
  "x-step": z.number().finite().positive().optional(), "x-advanced": z.boolean().optional(),
  "x-enabled-if": fields(choices).optional(),
});
type Field = z.infer<typeof field>;
function matches(value: z.infer<typeof scalar>, definition: Field) {
  const typed = definition.type === "integer" ? typeof value === "number" && Number.isInteger(value)
    : definition.type === "number" ? typeof value === "number" : typeof value === definition.type;
  return typed && (!definition.enum || definition.enum.includes(value))
    && (typeof value !== "number" || (definition.minimum === undefined || value >= definition.minimum) && (definition.maximum === undefined || value <= definition.maximum))
    && (typeof value !== "string" || definition.maxLength === undefined || value.length <= definition.maxLength);
}
const contract = z.strictObject({
  type: z.literal("object"), additionalProperties: z.literal(false), "x-quady3d-schema-version": z.literal(1),
  properties: fields(field),
  allOf: z.array(z.strictObject({
    if: z.strictObject({ properties: fields(z.strictObject({ enum: choices })), required: z.array(name).min(1).max(32) }),
    then: z.strictObject({ properties: fields(z.strictObject({ const: scalar.optional(), maximum: z.number().finite().optional() })) }),
  })).min(1).max(16).optional(),
}).superRefine((value, context) => {
  const invalid = () => context.addIssue({ code: "custom", message: "Unsupported model parameter definition" });
  for (const definition of Object.values(value.properties)) {
    if (definition.default !== undefined && !matches(definition.default, definition)) invalid();
    if (definition.enum?.some(choice => !matches(choice, { ...definition, enum: undefined }))) invalid();
    const numeric = definition.type === "integer" || definition.type === "number";
    if (!numeric && (definition.minimum !== undefined || definition.maximum !== undefined || definition["x-step"] !== undefined)) invalid();
    if (numeric && !definition.enum && (definition.minimum === undefined || definition.maximum === undefined)) invalid();
    if (definition.minimum !== undefined && definition.maximum !== undefined && definition.minimum > definition.maximum) invalid();
    if (definition.maxLength !== undefined && definition.type !== "string") invalid();
    if (definition.type === "string" && !definition.enum && definition.maxLength === undefined) invalid();
    if (definition["x-enum-labels"] && definition["x-enum-labels"].length !== definition.enum?.length) invalid();
    for (const [dependency, options] of Object.entries(definition["x-enabled-if"] ?? {})) {
      if (!Object.hasOwn(value.properties, dependency) || options.some(option => !matches(option, value.properties[dependency]))) invalid();
    }
  }
  for (const rule of value.allOf ?? []) {
    const conditions = Object.keys(rule.if.properties);
    if (!conditions.length || new Set(rule.if.required).size !== rule.if.required.length || conditions.length !== rule.if.required.length || conditions.some(key => !rule.if.required.includes(key))) invalid();
    for (const [key, condition] of Object.entries(rule.if.properties)) {
      if (!Object.hasOwn(value.properties, key) || condition.enum.some(choice => !matches(choice, value.properties[key]))) invalid();
    }
    if (!Object.keys(rule.then.properties).length) invalid();
    for (const [key, restriction] of Object.entries(rule.then.properties)) {
      const definition = value.properties[key];
      if (!Object.hasOwn(value.properties, key)) { invalid(); continue; }
      if (restriction.const === undefined && restriction.maximum === undefined) invalid();
      if (restriction.const !== undefined && !matches(restriction.const, definition)) invalid();
      if (restriction.maximum !== undefined && (definition.minimum === undefined || definition.maximum === undefined || restriction.maximum < definition.minimum || restriction.maximum > definition.maximum)) invalid();
    }
  }
});

// This is an explicitly versioned subset, not an arbitrary JSON Schema engine.
// Reject unknown constraints rather than silently presenting weakened metadata.
export const modelParameterSchema = z.preprocess((value, context) => {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string" && Buffer.byteLength(serialized, "utf8") <= 64 * 1024) return value;
  } catch { /* Invalid or excessively nested response. */ }
  context.addIssue({ code: "custom", message: "Model parameter definition is too large" });
  return z.NEVER;
}, contract);
