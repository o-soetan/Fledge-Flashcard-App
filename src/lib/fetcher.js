export async function fetchCoreVocabulary() {
  // We use Lexique-style frequency data via an open API or 
  // a raw data source specified in your backend doc
  const API_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fr/fr_50k.txt";
  
  try {
    const response = await fetch(API_URL);
    const text = await response.text();
    
    // Process the top 300 words
    const words = text.split('\n').slice(0, 300).map(line => {
      const [word, count] = line.split(' ');
      return { french: word, frequency: count };
    });

    return words;
  } catch (error) {
    console.error("Failed to fetch vocabulary:", error);
    return [];
  }
}