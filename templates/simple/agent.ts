export default defineAgent({
  name: "Simple Assistant",
  builtinTools: [
    "web_search",
    "visit_webpage",
    "fetch_json",
    "run_code",
    "user_input",
    "final_answer",
  ],
});
