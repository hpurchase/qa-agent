type OpenAIChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

export async function openaiJson<T>(params: {
  system: string;
  user: unknown;
  schemaHint: string;
  model?: string;
}) {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const model = params.model ?? "gpt-4.1-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        {
          role: "user",
          content: JSON.stringify(
            {
              input: params.user,
              output_schema_hint: params.schemaHint,
            },
            null,
            2,
          ),
        },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI error: ${res.status} ${res.statusText} ${t}`);
  }
  const json = (await res.json()) as OpenAIChatResponse;
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");
  return JSON.parse(content) as T;
}

