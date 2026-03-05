export default defineAgent({
  name: "PhoneAgent",
  instructions: `You are a helpful phone assistant.`,
  greeting: "Hello, I'm your phone assistant. How can I help you today?",
  voice: "tara",
  builtinTools: ["web_search", "visit_webpage", "final_answer"],
});
