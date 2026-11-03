// AI-providers. Elke provider levert hetzelfde: één gestructureerde beurt + aantal tokens.
// Wisselen van provider = hier een nieuwe provider toevoegen en secret AI_PROVIDER aanpassen.
// De rest van de app (prompts, veiligheid, limieten, de app zelf) blijft gelijk.

export type Msg = { role: "user" | "assistant"; content: string };
export type TurnRequest = { model: string; system: string; messages: Msg[]; schema: Record<string, unknown>; maxTokens: number };
export type TurnResult = { turn: Record<string, any>; tokensIn: number; tokensOut: number };
export interface Provider { name: string; configured(): boolean; turn(r: TurnRequest): Promise<TurnResult> }

const anthropic: Provider = {
  name: "anthropic",
  configured: () => !!Deno.env.get("ANTHROPIC_API_KEY"),
  async turn({ model, system, messages, schema, maxTokens }) {
    // tot 3 pogingen bij drukte (429/529), met wachten
    for (let attempt = 0; ; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: maxTokens, system, messages,
        tools: [{ name: "masri_turn", description: "One turn of the language partner.", input_schema: schema }],
        tool_choice: { type: "tool", name: "masri_turn" },
      }),
    });
    if ((r.status === 429 || r.status === 529 || r.status === 503) && attempt < 2) {
      const wait = Math.min(20, Number(r.headers.get("retry-after")) || (attempt + 1) * 4);
      await r.body?.cancel(); await new Promise(res => setTimeout(res, wait * 1000)); continue;
    }
    const data = await r.json();
    if (!r.ok) throw new Error(`AI ${r.status}: ${data?.error?.message || "fout"}`);
    const block = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
    if (!block) throw new Error("AI gaf geen gestructureerd antwoord");
    return { turn: block.input, tokensIn: data.usage?.input_tokens || 0, tokensOut: data.usage?.output_tokens || 0 };
    }
  },
};

const PROVIDERS: Record<string, Provider> = { anthropic };
export function getProvider(): Provider {
  return PROVIDERS[(Deno.env.get("AI_PROVIDER") || "anthropic").toLowerCase()] || anthropic;
}
