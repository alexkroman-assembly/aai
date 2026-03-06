import knowledge from "./knowledge.json" with { type: "json" };

type FaqEntry = { question: string; answer: string };
const faqs: FaqEntry[] = knowledge.faqs;

export default defineAgent({
  name: "FAQ Bot",
  instructions:
    `You are a friendly FAQ assistant. Answer questions using ONLY the information \
from your embedded knowledge base. If the user asks something not covered by your \
knowledge base, say you don't have that information and suggest they check the official \
documentation.

Rules:
- Keep answers concise and conversational — this is a voice agent
- Quote the knowledge base accurately, do not embellish
- If a question is ambiguous, ask the user to clarify
- Always be helpful and polite`,
  greeting:
    "Hi! I'm your FAQ assistant. Ask me anything about the AAI agent framework and I'll look it up in my knowledge base.",
  voice: "luna",
  tools: {
    search_faq: {
      description:
        "Search the embedded knowledge base for a question. Returns the closest matching FAQ entry.",
      parameters: {
        query: "The user's question to search for",
      },
      execute: (args) => {
        const q = (args.query as string).toLowerCase();
        const match = faqs.find((f) =>
          f.question.toLowerCase().includes(q) ||
          q.includes(f.question.toLowerCase()) ||
          f.answer.toLowerCase().includes(q)
        );
        return match ?? { result: "No matching FAQ found." };
      },
    },
    list_topics: {
      description: "List all available FAQ topics in the knowledge base.",
      parameters: {},
      execute: () => faqs.map((f) => f.question),
    },
  },
});
