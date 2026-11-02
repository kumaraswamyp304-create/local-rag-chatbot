const {
  askRAG
} = require("./rag");


async function main() {

  const question =
      "What programming languages does Kumaraswamy know?";


  console.log(
      "\nQUESTION:"
  );

  console.log(question);


  const result =
      await askRAG(question);


  console.log(
      "\n========== ANSWER ==========\n"
  );

  console.log(
      result.answer
  );


  console.log(
      "\n========== SOURCES ==========\n"
  );

  console.log(
      result.sources
  );

}


main().catch(error => {

  console.error(
      "RAG ERROR:",
      error
  );

});