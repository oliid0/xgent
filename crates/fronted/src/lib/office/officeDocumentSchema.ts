import { Type } from "typebox";

const text = Type.String({ maxLength: 32767 });
const color = Type.String({ pattern: "^[0-9a-fA-F]{6}$" });
const object = <T extends import("typebox").TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });

export const officeDocumentSchema = Type.Union([
  object({
    format: Type.Literal("docx"),
    paragraphs: Type.Array(
      object({
        text,
        heading: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)])),
        bold: Type.Optional(Type.Boolean()),
      }),
      { minItems: 1, maxItems: 10000 },
    ),
    tables: Type.Optional(
      Type.Array(
        Type.Array(Type.Array(text, { minItems: 1, maxItems: 100 }), {
          minItems: 1,
          maxItems: 1000,
        }),
        { maxItems: 100 },
      ),
    ),
  }),
  object({
    format: Type.Literal("xlsx"),
    sheets: Type.Array(
      object({
        name: Type.String({ minLength: 1, maxLength: 31 }),
        rows: Type.Array(
          Type.Array(
            Type.Union([
              text,
              Type.Number(),
              Type.Boolean(),
              Type.Null(),
              object({ formula: Type.String({ minLength: 1, maxLength: 32767 }) }),
            ]),
            { maxItems: 1000 },
          ),
          { minItems: 1, maxItems: 10000 },
        ),
      }),
      { minItems: 1, maxItems: 100 },
    ),
  }),
  object({
    format: Type.Literal("pptx"),
    slides: Type.Array(
      object({
        background: Type.Optional(color),
        notes: Type.Optional(text),
        elements: Type.Array(
          object({
            type: Type.Union([Type.Literal("text"), Type.Literal("rectangle")]),
            x: Type.Number({ minimum: 0 }),
            y: Type.Number({ minimum: 0 }),
            width: Type.Number({ exclusiveMinimum: 0 }),
            height: Type.Number({ exclusiveMinimum: 0 }),
            text: Type.Optional(text),
            color: Type.Optional(color),
            fontSize: Type.Optional(Type.Number({ minimum: 6, maximum: 200 })),
            bold: Type.Optional(Type.Boolean()),
          }),
          { minItems: 1, maxItems: 500 },
        ),
      }),
      { minItems: 1, maxItems: 200 },
    ),
  }),
]);
