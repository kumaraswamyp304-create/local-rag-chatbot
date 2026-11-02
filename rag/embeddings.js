async function createEmbedding(text) {
  const response = await fetch(
      "http://127.0.0.1:11434/api/embeddings",
      {
          method: "POST",
          headers: {
              "Content-Type": "application/json"
          },
          body: JSON.stringify({
              model: "nomic-embed-text",
              prompt: text
          })
      }
  );

  if (!response.ok) {
      throw new Error(
          `Embedding API error: ${response.status}`
      );
  }

  const data = await response.json();

  return data.embedding;
}

module.exports = {
  createEmbedding
};